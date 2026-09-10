'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  NexaControllerBindingError,
  createNexaControllerBinding
} = require('../../src/shared/nexaControllerBinding');
const { createNexaModuleController } = require('../../src/shared/nexaModuleController');
const { createNexaModuleRegistry } = require('../../src/shared/nexaModuleRegistry');

const EMPTY_CONTEXT = Object.freeze({ reservedChannels: Object.freeze([]) });

function descriptor(moduleId) {
  return {
    moduleId,
    contractVersion: 1,
    invokeChannels: [`nexa:${moduleId}:get`],
    pushChannels: [`nexa:${moduleId}:changed`]
  };
}

function registry(...moduleIds) {
  return createNexaModuleRegistry(moduleIds.map(descriptor), EMPTY_CONTEXT);
}

function controller(overrides = {}) {
  return {
    start: () => undefined,
    stop: () => undefined,
    getSnapshot: () => ({}),
    execute: () => undefined,
    ...overrides
  };
}

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) => error instanceof NexaControllerBindingError && error.code === code,
    `expected controller binding error code ${code}`
  );
}

test('creates a frozen empty binding with only the four query and factory methods', () => {
  const binding = createNexaControllerBinding(registry(), {});

  assert.equal(Object.isFrozen(binding), true);
  assert.deepEqual(Object.keys(binding).sort(), [
    'createController',
    'getDescriptor',
    'has',
    'listModuleIds'
  ]);
  assert.deepEqual(binding.listModuleIds(), []);
  assert.equal(binding.has('missing'), false);
  assert.equal(binding.getDescriptor('missing'), undefined);
});

test('binds one and multiple registry modules with deterministic registry ordering', () => {
  const single = createNexaControllerBinding(registry('single'), { single: () => controller() });
  const multiple = createNexaControllerBinding(registry('zulu', 'alpha'), {
    zulu: () => controller(),
    alpha: () => controller()
  });

  assert.deepEqual(single.listModuleIds(), ['single']);
  assert.deepEqual(multiple.listModuleIds(), ['alpha', 'zulu']);
});

test('fails closed for malformed or inconsistent registries', () => {
  const malformed = [null, {}, { has() {}, get() {} }, { has() {}, get() {}, listModuleIds: true }];
  for (const candidate of malformed) {
    expectCode(() => createNexaControllerBinding(candidate, {}), 'INVALID_REGISTRY');
  }

  expectCode(
    () => createNexaControllerBinding({
      has: () => false,
      get: () => undefined,
      listModuleIds: () => ['example']
    }, { example: () => controller() }),
    'INVALID_REGISTRY'
  );
  expectCode(
    () => createNexaControllerBinding({
      has: () => true,
      get: () => ({ moduleId: 'example' }),
      listModuleIds: () => ['example', 'example']
    }, { example: () => controller() }),
    'INVALID_REGISTRY'
  );
});

test('rejects non-plain factory maps without reading accessor values', () => {
  for (const factories of [null, [], new Map(), () => {}, Object.create({})]) {
    expectCode(
      () => createNexaControllerBinding(registry(), factories),
      'INVALID_CONTROLLER_FACTORIES'
    );
  }

  let getterReads = 0;
  const factories = {};
  Object.defineProperty(factories, 'example', {
    enumerable: true,
    get() {
      getterReads += 1;
      return () => controller();
    }
  });
  expectCode(
    () => createNexaControllerBinding(registry('example'), factories),
    'INVALID_CONTROLLER_FACTORY'
  );
  assert.equal(getterReads, 0);
});

test('enforces an exact one-to-one registry and factory key set', () => {
  expectCode(
    () => createNexaControllerBinding(registry('alpha', 'beta'), { alpha: () => controller() }),
    'MISSING_CONTROLLER_FACTORY'
  );
  expectCode(
    () => createNexaControllerBinding(registry('alpha'), {
      alpha: () => controller(),
      beta: () => controller()
    }),
    'UNEXPECTED_CONTROLLER_FACTORY'
  );
  expectCode(
    () => createNexaControllerBinding(registry(), { unexpected: () => controller() }),
    'UNEXPECTED_CONTROLLER_FACTORY'
  );
  expectCode(
    () => createNexaControllerBinding(registry('alpha'), { alpha: true }),
    'INVALID_CONTROLLER_FACTORY'
  );
});

test('construction snapshots factory references without invoking them', () => {
  let calls = 0;
  const originalFactory = () => {
    calls += 1;
    return controller();
  };
  const factories = { example: originalFactory };
  const binding = createNexaControllerBinding(registry('example'), factories);

  assert.equal(calls, 0);
  factories.example = () => {
    throw new Error('replacement must not run');
  };
  binding.createController('example');
  assert.equal(calls, 1);
});

test('delegates safe presence, descriptor, and ordered ID queries to the registry', () => {
  const sourceRegistry = registry('zulu', 'alpha');
  const binding = createNexaControllerBinding(sourceRegistry, {
    alpha: () => controller(),
    zulu: () => controller()
  });

  assert.equal(binding.has('alpha'), true);
  assert.equal(binding.has('missing'), false);
  assert.equal(binding.has(null), false);
  assert.equal(binding.has({}), false);
  assert.deepEqual(binding.getDescriptor('alpha'), sourceRegistry.get('alpha'));
  assert.equal(binding.getDescriptor('missing'), undefined);
  assert.equal(binding.getDescriptor(1), undefined);
  assert.deepEqual(binding.listModuleIds(), sourceRegistry.listModuleIds());
});

test('creates the corresponding controller once per request without auto-start or caching', () => {
  let factoryCalls = 0;
  let startCalls = 0;
  const binding = createNexaControllerBinding(registry('example'), {
    example() {
      factoryCalls += 1;
      return controller({ start: () => { startCalls += 1; } });
    }
  });

  const first = binding.createController('example');
  const second = binding.createController('example');
  assert.equal(factoryCalls, 2);
  assert.equal(startCalls, 0);
  assert.notStrictEqual(first, second);
});

test('accepts controllers created by the real module controller factory', () => {
  const binding = createNexaControllerBinding(registry('example'), {
    example: () => createNexaModuleController(controller())
  });
  const created = binding.createController('example');

  assert.equal(Object.isFrozen(created), true);
  assert.deepEqual(Object.keys(created).sort(), ['execute', 'getSnapshot', 'start', 'stop']);
});

test('rejects missing modules and malformed controller results with stable codes', () => {
  const binding = createNexaControllerBinding(registry('example'), {
    example: () => ({ start() {}, stop() {}, getSnapshot() {} })
  });

  expectCode(() => binding.createController('missing'), 'MODULE_NOT_FOUND');
  expectCode(() => binding.createController(null), 'MODULE_NOT_FOUND');
  expectCode(() => binding.createController('example'), 'INVALID_CONTROLLER');
});

test('propagates factory failures unchanged', () => {
  const failure = new Error('factory failed');
  const binding = createNexaControllerBinding(registry('example'), {
    example() {
      throw failure;
    }
  });

  assert.throws(() => binding.createController('example'), (error) => error === failure);
});

test('isolates the binding from later add, delete, and replacement mutations to the factory map', () => {
  let alphaCalls = 0;
  let betaCalls = 0;
  const factories = {
    alpha: () => { alphaCalls += 1; return controller(); },
    beta: () => { betaCalls += 1; return controller(); }
  };
  const binding = createNexaControllerBinding(registry('alpha', 'beta'), factories);

  factories.added = () => controller();
  delete factories.alpha;
  factories.beta = () => { throw new Error('replacement must not run'); };

  binding.createController('alpha');
  binding.createController('beta');
  assert.equal(alphaCalls, 1);
  assert.equal(betaCalls, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(binding, 'controllerFactories'), false);
});

test('does not duplicate descriptor truth and returns registry-owned defensive query results', () => {
  const sourceRegistry = registry('example');
  const binding = createNexaControllerBinding(sourceRegistry, { example: () => controller() });
  const returned = binding.getDescriptor('example');
  returned.invokeChannels.push('nexa:example:mutated');

  assert.deepEqual(binding.getDescriptor('example'), descriptor('example'));
  const ids = binding.listModuleIds();
  ids.push('mutated');
  assert.deepEqual(binding.listModuleIds(), ['example']);
});

test('binding source is pure static wiring with no discovery, host effects, or lifecycle orchestration', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'shared', 'nexaControllerBinding.js'),
    'utf8'
  );

  assert.doesNotMatch(source, /node:fs|require\(['"]fs['"]\)|readdir|glob|import\s*\(|node:electron|child_process|node:net|node:http/i);
  assert.doesNotMatch(source, /\b(startAll|stopAll|register|unregister|dispatch)\b/);
});
