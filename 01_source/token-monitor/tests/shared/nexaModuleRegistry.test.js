'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createNexaModuleRegistry } = require('../../src/shared/nexaModuleRegistry');
const { NexaModuleDescriptorValidationError } = require('../../src/shared/nexaModuleDescriptor');

const EMPTY_CONTEXT = Object.freeze({ reservedChannels: Object.freeze([]) });

function descriptor(moduleId, overrides = {}) {
  return {
    moduleId,
    contractVersion: 1,
    invokeChannels: [`nexa:${moduleId}:get`],
    pushChannels: [`nexa:${moduleId}:changed`],
    ...overrides
  };
}

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) => error instanceof NexaModuleDescriptorValidationError && error.code === code,
    `expected descriptor validation error code ${code}`
  );
}

test('creates an immutable empty registry with empty deterministic queries', () => {
  const registry = createNexaModuleRegistry([], EMPTY_CONTEXT);

  assert.equal(Object.isFrozen(registry), true);
  assert.deepEqual(Object.keys(registry).sort(), [
    'get',
    'getInvokeChannels',
    'getPushChannels',
    'has',
    'list',
    'listModuleIds'
  ]);
  assert.equal(registry.has('missing'), false);
  assert.equal(registry.get('missing'), undefined);
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(registry.listModuleIds(), []);
  assert.deepEqual(registry.getInvokeChannels(), []);
  assert.deepEqual(registry.getPushChannels(), []);
});

test('indexes and queries a single validated descriptor', () => {
  const input = descriptor('example');
  const registry = createNexaModuleRegistry([input], EMPTY_CONTEXT);

  assert.equal(registry.has('example'), true);
  assert.deepEqual(registry.get('example'), input);
  assert.deepEqual(registry.list(), [input]);
  assert.deepEqual(registry.listModuleIds(), ['example']);
  assert.deepEqual(registry.getInvokeChannels(), ['nexa:example:get']);
  assert.deepEqual(registry.getPushChannels(), ['nexa:example:changed']);
});

test('orders modules and flattened channels independently of descriptor input order', () => {
  const inputs = [
    descriptor('zulu', {
      invokeChannels: ['nexa:zulu:refresh', 'nexa:zulu:get'],
      pushChannels: ['nexa:zulu:updated']
    }),
    descriptor('alpha', {
      invokeChannels: ['nexa:alpha:execute'],
      pushChannels: ['nexa:alpha:changed', 'nexa:alpha:alert']
    }),
    descriptor('middle')
  ];
  const registry = createNexaModuleRegistry(inputs, EMPTY_CONTEXT);

  assert.deepEqual(registry.listModuleIds(), ['alpha', 'middle', 'zulu']);
  assert.deepEqual(registry.list().map((item) => item.moduleId), ['alpha', 'middle', 'zulu']);
  assert.deepEqual(registry.getInvokeChannels(), [
    'nexa:alpha:execute',
    'nexa:middle:get',
    'nexa:zulu:get',
    'nexa:zulu:refresh'
  ]);
  assert.deepEqual(registry.getPushChannels(), [
    'nexa:alpha:alert',
    'nexa:alpha:changed',
    'nexa:middle:changed',
    'nexa:zulu:updated'
  ]);
});

test('missing and non-string module queries are side-effect-free', () => {
  const registry = createNexaModuleRegistry([descriptor('example')], EMPTY_CONTEXT);

  for (const query of ['missing', null, undefined, 1, {}, []]) {
    assert.equal(registry.has(query), false);
    assert.equal(registry.get(query), undefined);
  }
  assert.deepEqual(registry.listModuleIds(), ['example']);
});

test('directly preserves validator rejection for duplicate moduleId', () => {
  expectCode(
    () => createNexaModuleRegistry([descriptor('example'), descriptor('example')], EMPTY_CONTEXT),
    'DUPLICATE_MODULE_ID'
  );
});

test('directly preserves validator rejection for duplicate channels', () => {
  expectCode(
    () => createNexaModuleRegistry([
      descriptor('alpha'),
      descriptor('beta', { invokeChannels: ['nexa:alpha:get'] })
    ], EMPTY_CONTEXT),
    'DUPLICATE_CHANNEL'
  );
});

test('directly preserves validator rejection for wrong channel prefixes', () => {
  expectCode(
    () => createNexaModuleRegistry([
      descriptor('alpha', { invokeChannels: ['nexa:beta:inspect'] }),
      descriptor('beta')
    ], EMPTY_CONTEXT),
    'CHANNEL_PREFIX_MISMATCH'
  );
});

test('directly preserves validator rejection for reserved channel collisions', () => {
  expectCode(
    () => createNexaModuleRegistry(
      [descriptor('example')],
      { reservedChannels: ['nexa:example:get'] }
    ),
    'RESERVED_CHANNEL_COLLISION'
  );
});

test('directly preserves validator rejection for malformed validation context', () => {
  expectCode(() => createNexaModuleRegistry([descriptor('example')]), 'INVALID_VALIDATION_CONTEXT');
  expectCode(() => createNexaModuleRegistry([descriptor('example')], {}), 'INVALID_VALIDATION_CONTEXT');
});

test('isolates registry state from later descriptor and source channel mutations', () => {
  const input = descriptor('example');
  const registry = createNexaModuleRegistry([input], EMPTY_CONTEXT);

  input.moduleId = 'changed';
  input.invokeChannels.push('nexa:example:later');
  input.pushChannels[0] = 'nexa:example:replaced';

  assert.equal(registry.has('example'), true);
  assert.equal(registry.has('changed'), false);
  assert.deepEqual(registry.getInvokeChannels(), ['nexa:example:get']);
  assert.deepEqual(registry.getPushChannels(), ['nexa:example:changed']);
});

test('isolates registry state from mutations to get results', () => {
  const registry = createNexaModuleRegistry([descriptor('example')], EMPTY_CONTEXT);
  const result = registry.get('example');

  result.moduleId = 'changed';
  result.invokeChannels.push('nexa:example:later');
  result.pushChannels.length = 0;

  assert.deepEqual(registry.get('example'), descriptor('example'));
});

test('isolates registry state from mutations to list results', () => {
  const registry = createNexaModuleRegistry([descriptor('beta'), descriptor('alpha')], EMPTY_CONTEXT);
  const results = registry.list();

  results.reverse();
  results[0].moduleId = 'changed';
  results[0].invokeChannels.length = 0;

  assert.deepEqual(registry.list().map((item) => item.moduleId), ['alpha', 'beta']);
  assert.deepEqual(registry.getInvokeChannels(), ['nexa:alpha:get', 'nexa:beta:get']);
});

test('isolates registry state from mutations to returned channel and module ID lists', () => {
  const registry = createNexaModuleRegistry([descriptor('example')], EMPTY_CONTEXT);
  const moduleIds = registry.listModuleIds();
  const invokeChannels = registry.getInvokeChannels();
  const pushChannels = registry.getPushChannels();

  moduleIds.push('changed');
  invokeChannels[0] = 'nexa:changed:get';
  pushChannels.length = 0;

  assert.deepEqual(registry.listModuleIds(), ['example']);
  assert.deepEqual(registry.getInvokeChannels(), ['nexa:example:get']);
  assert.deepEqual(registry.getPushChannels(), ['nexa:example:changed']);
});

test('registry source has no filesystem discovery or dynamic module loading', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'shared', 'nexaModuleRegistry.js'),
    'utf8'
  );

  assert.doesNotMatch(source, /node:fs|require\(['"]fs['"]\)|readdir|glob|dynamic import|import\s*\(/i);
  assert.doesNotMatch(source, /register|unregister|dispatch|start\s*\(|stop\s*\(/i);
});
