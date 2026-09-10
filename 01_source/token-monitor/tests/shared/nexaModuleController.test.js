'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NexaModuleControllerError,
  createNexaModuleController
} = require('../../src/shared/nexaModuleController');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function implementation(overrides = {}) {
  return {
    start: () => undefined,
    stop: () => undefined,
    getSnapshot: (context) => ({ generation: context.generation, state: context.state }),
    execute: (command, context) => ({ command, generation: context.generation }),
    ...overrides
  };
}

function isControllerCode(code) {
  return (error) => error instanceof NexaModuleControllerError && error.code === code;
}

test('creates a frozen controller with exactly the minimal public lifecycle API', () => {
  const controller = createNexaModuleController(implementation());

  assert.equal(Object.isFrozen(controller), true);
  assert.deepEqual(Object.keys(controller).sort(), ['execute', 'getSnapshot', 'start', 'stop']);
  assert.throws(() => { controller.start = () => {}; }, TypeError);
});

test('rejects missing, non-function, and malformed implementation hooks', () => {
  for (const malformed of [null, [], 'controller', () => {}]) {
    assert.throws(
      () => createNexaModuleController(malformed),
      isControllerCode('INVALID_CONTROLLER_IMPLEMENTATION')
    );
  }

  for (const hook of ['start', 'stop', 'getSnapshot', 'execute']) {
    const missing = implementation();
    delete missing[hook];
    assert.throws(
      () => createNexaModuleController(missing),
      isControllerCode('INVALID_CONTROLLER_IMPLEMENTATION')
    );

    assert.throws(
      () => createNexaModuleController(implementation({ [hook]: true })),
      isControllerCode('INVALID_CONTROLLER_IMPLEMENTATION')
    );
  }
});

test('captures implementation hooks so they cannot be replaced after construction', async () => {
  let originalStarts = 0;
  let replacementStarts = 0;
  const adapter = implementation({ start: () => { originalStarts += 1; } });
  const controller = createNexaModuleController(adapter);
  adapter.start = () => { replacementStarts += 1; };

  await controller.start();
  assert.equal(originalStarts, 1);
  assert.equal(replacementStarts, 0);
});

test('start is idempotent after running and passes the first generation once', async () => {
  const contexts = [];
  const controller = createNexaModuleController(implementation({
    start(context) {
      contexts.push(context);
      return 'started';
    }
  }));

  assert.equal(await controller.start(), 'started');
  assert.equal(await controller.start(), 'started');
  assert.equal(contexts.length, 1);
  assert.deepEqual(contexts[0], { generation: 1, state: 'starting' });
  assert.equal(Object.isFrozen(contexts[0]), true);
});

test('concurrent start calls share one in-flight start and one implementation call', async () => {
  const gate = deferred();
  let starts = 0;
  const controller = createNexaModuleController(implementation({
    start() {
      starts += 1;
      return gate.promise;
    }
  }));

  const first = controller.start();
  const second = controller.start();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(starts, 1);
  gate.resolve('ready');
  assert.equal(await first, 'ready');
  assert.equal(await second, 'ready');
});

test('start failure preserves the original error and retries with a new generation', async () => {
  const failure = new Error('start failed');
  const generations = [];
  let attempts = 0;
  const controller = createNexaModuleController(implementation({
    start(context) {
      generations.push(context.generation);
      attempts += 1;
      if (attempts === 1) throw failure;
      return 'ready';
    }
  }));

  await assert.rejects(controller.start(), (error) => error === failure);
  await assert.rejects(controller.execute({ action: 'read' }), isControllerCode('CONTROLLER_NOT_RUNNING'));
  assert.equal(await controller.start(), 'ready');
  assert.deepEqual(generations, [1, 2]);
});

test('stop is idempotent and invalidates execute before cleanup completes', async () => {
  const gate = deferred();
  const stopContexts = [];
  const controller = createNexaModuleController(implementation({
    stop(context) {
      stopContexts.push(context);
      return gate.promise;
    }
  }));
  await controller.start();

  const first = controller.stop();
  const second = controller.stop();
  assert.strictEqual(first, second);
  await assert.rejects(controller.execute({ action: 'read' }), isControllerCode('CONTROLLER_NOT_RUNNING'));
  await Promise.resolve();
  assert.equal(stopContexts.length, 1);
  assert.deepEqual(stopContexts[0], { generation: 1, state: 'stopping' });
  gate.resolve('stopped');
  assert.equal(await first, 'stopped');
  assert.equal(await second, 'stopped');
  await controller.stop();
  assert.equal(stopContexts.length, 1);
});

test('stop failure stays fail-closed until an explicit cleanup retry succeeds', async () => {
  const stopFailure = new Error('stop failed');
  const startGenerations = [];
  const stopGenerations = [];
  let stopAttempts = 0;
  const controller = createNexaModuleController(implementation({
    start(context) {
      startGenerations.push(context.generation);
    },
    stop(context) {
      stopGenerations.push(context.generation);
      stopAttempts += 1;
      if (stopAttempts === 1) throw stopFailure;
    }
  }));

  await controller.start();
  await assert.rejects(controller.stop(), (error) => error === stopFailure);
  await assert.rejects(controller.start(), isControllerCode('STOP_INCOMPLETE'));
  await assert.rejects(controller.execute({ action: 'read' }), isControllerCode('CONTROLLER_NOT_RUNNING'));
  await controller.stop();
  await controller.start();

  assert.deepEqual(startGenerations, [1, 2]);
  assert.deepEqual(stopGenerations, [1, 1]);
});

test('start-stop-start uses monotonic generations for normal execute results', async () => {
  const startGenerations = [];
  const stopGenerations = [];
  const controller = createNexaModuleController(implementation({
    start(context) { startGenerations.push(context.generation); },
    stop(context) { stopGenerations.push(context.generation); }
  }));

  await controller.start();
  assert.deepEqual(await controller.execute('first'), { command: 'first', generation: 1 });
  await controller.stop();
  await controller.start();
  assert.deepEqual(await controller.execute('second'), { command: 'second', generation: 2 });

  assert.deepEqual(startGenerations, [1, 2]);
  assert.deepEqual(stopGenerations, [1]);
});

test('a pending execute success is rejected as stale after stop', async () => {
  const gate = deferred();
  let executeContext;
  const controller = createNexaModuleController(implementation({
    execute(_command, context) {
      executeContext = context;
      return gate.promise;
    }
  }));
  await controller.start();

  const pending = controller.execute('old');
  await Promise.resolve();
  assert.equal(executeContext.generation, 1);
  await controller.stop();
  gate.resolve('old result');

  await assert.rejects(pending, isControllerCode('STALE_GENERATION'));
});

test('a pending execute from an old cycle cannot pollute a restarted generation', async () => {
  const oldGate = deferred();
  const controller = createNexaModuleController(implementation({
    execute(command, context) {
      if (command === 'old') return oldGate.promise;
      return { command, generation: context.generation };
    }
  }));
  await controller.start();

  const oldPending = controller.execute('old');
  await Promise.resolve();
  await controller.stop();
  await controller.start();
  assert.deepEqual(await controller.execute('new'), { command: 'new', generation: 2 });

  oldGate.resolve('old result');
  await assert.rejects(oldPending, isControllerCode('STALE_GENERATION'));
  assert.deepEqual(await controller.execute('still-new'), { command: 'still-new', generation: 2 });
});

test('execute preserves a current implementation error', async () => {
  const failure = new Error('execute failed');
  const controller = createNexaModuleController(implementation({
    execute() { throw failure; }
  }));
  await controller.start();

  await assert.rejects(controller.execute('command'), (error) => error === failure);
});

test('a stale execute error is replaced with the stable stale-generation error', async () => {
  const gate = deferred();
  const oldFailure = new Error('old execute failed');
  const controller = createNexaModuleController(implementation({
    execute() { return gate.promise; }
  }));
  await controller.start();

  const pending = controller.execute('old');
  await Promise.resolve();
  await controller.stop();
  gate.reject(oldFailure);

  await assert.rejects(pending, isControllerCode('STALE_GENERATION'));
});

test('execute is rejected before start and after a completed stop', async () => {
  const controller = createNexaModuleController(implementation());

  await assert.rejects(controller.execute('before'), isControllerCode('CONTROLLER_NOT_RUNNING'));
  await controller.start();
  await controller.stop();
  await assert.rejects(controller.execute('after'), isControllerCode('CONTROLLER_NOT_RUNNING'));
});

test('getSnapshot is side-effect-free and receives the current lifecycle context', async () => {
  let starts = 0;
  let stops = 0;
  const snapshotContexts = [];
  const controller = createNexaModuleController(implementation({
    start() { starts += 1; },
    stop() { stops += 1; },
    getSnapshot(context) {
      snapshotContexts.push(context);
      return { generation: context.generation, state: context.state };
    }
  }));

  assert.deepEqual(controller.getSnapshot(), { generation: null, state: 'created' });
  assert.equal(starts, 0);
  assert.equal(stops, 0);
  await controller.start();
  assert.deepEqual(controller.getSnapshot(), { generation: 1, state: 'running' });
  await controller.stop();
  assert.deepEqual(controller.getSnapshot(), { generation: null, state: 'stopped' });

  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.equal(snapshotContexts.every((context) => Object.isFrozen(context)), true);
  assert.equal(snapshotContexts.every((context) => Object.keys(context).sort().join(',') === 'generation,state'), true);
});

test('stop during an in-flight start invalidates that attempt and permits restart after cleanup', async () => {
  const firstStart = deferred();
  const startGenerations = [];
  let startAttempts = 0;
  const controller = createNexaModuleController(implementation({
    start(context) {
      startGenerations.push(context.generation);
      startAttempts += 1;
      return startAttempts === 1 ? firstStart.promise : 'ready';
    }
  }));

  const pendingStart = controller.start();
  await Promise.resolve();
  await controller.stop();
  firstStart.resolve('late start');
  await assert.rejects(pendingStart, isControllerCode('STALE_GENERATION'));
  assert.equal(await controller.start(), 'ready');
  assert.deepEqual(startGenerations, [1, 2]);
});
