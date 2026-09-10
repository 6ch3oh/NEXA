'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createNexaControllerBinding } = require('../../src/shared/nexaControllerBinding');
const { createNexaModuleController } = require('../../src/shared/nexaModuleController');
const { createNexaModuleRegistry } = require('../../src/shared/nexaModuleRegistry');
const {
  NexaShellHostError,
  createNexaShellHost
} = require('../../src/shared/nexaShellHost');

const EMPTY_CONTEXT = Object.freeze({ reservedChannels: Object.freeze([]) });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function descriptor(moduleId) {
  return {
    moduleId,
    contractVersion: 1,
    invokeChannels: [`nexa:${moduleId}:get`],
    pushChannels: [`nexa:${moduleId}:changed`]
  };
}

function controller(overrides = {}) {
  return {
    start: async () => undefined,
    stop: async () => undefined,
    getSnapshot: () => ({}),
    execute: async (command) => command,
    ...overrides
  };
}

function binding(moduleIds, factories) {
  const moduleRegistry = createNexaModuleRegistry(moduleIds.map(descriptor), EMPTY_CONTEXT);
  return createNexaControllerBinding(moduleRegistry, factories);
}

function expectHostCode(code) {
  return (error) => error instanceof NexaShellHostError && error.code === code;
}

test('constructs a frozen minimal host without creating or starting controllers', () => {
  let factoryCalls = 0;
  let startCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example() {
      factoryCalls += 1;
      return controller({ start: async () => { startCalls += 1; } });
    }
  }));

  assert.equal(Object.isFrozen(host), true);
  assert.deepEqual(Object.keys(host).sort(), [
    'executeModule',
    'getDescriptor',
    'getModuleSnapshot',
    'listModuleIds',
    'startModule',
    'stopAll',
    'stopModule'
  ]);
  assert.equal(factoryCalls, 0);
  assert.equal(startCalls, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(host, 'controllers'), false);
});

test('rejects malformed bindings with a stable error', () => {
  const malformed = [null, {}, { has() {}, getDescriptor() {}, listModuleIds() {} }];
  for (const candidate of malformed) {
    assert.throws(() => createNexaShellHost(candidate), expectHostCode('INVALID_BINDING'));
  }

  const accessor = {};
  Object.defineProperty(accessor, 'has', { get() { throw new Error('getter'); } });
  assert.throws(() => createNexaShellHost(accessor), expectHostCode('INVALID_BINDING'));
});

test('delegates module and descriptor queries while snapshot remains lazy', () => {
  let factoryCalls = 0;
  const sourceBinding = binding(['zulu', 'alpha'], {
    alpha: () => { factoryCalls += 1; return controller(); },
    zulu: () => { factoryCalls += 1; return controller(); }
  });
  const host = createNexaShellHost(sourceBinding);

  assert.deepEqual(host.listModuleIds(), sourceBinding.listModuleIds());
  assert.deepEqual(host.getDescriptor('alpha'), sourceBinding.getDescriptor('alpha'));
  assert.equal(host.getModuleSnapshot('alpha'), undefined);
  assert.equal(factoryCalls, 0);
  assert.throws(() => host.getModuleSnapshot('missing'), expectHostCode('MODULE_NOT_FOUND'));
});

test('first start lazily creates and repeated starts reuse one owned controller', async () => {
  let factoryCalls = 0;
  let startCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example() {
      factoryCalls += 1;
      return controller({ start: async () => { startCalls += 1; return startCalls; } });
    }
  }));

  assert.equal(await host.startModule('example'), 1);
  assert.equal(await host.startModule('example'), 2);
  assert.equal(factoryCalls, 1);
  assert.equal(startCalls, 2);
});

test('factory failures are not cached and a later start can retry creation', async () => {
  const failure = new Error('factory failed');
  let factoryCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example() {
      factoryCalls += 1;
      if (factoryCalls === 1) throw failure;
      return controller();
    }
  }));

  await assert.rejects(host.startModule('example'), (error) => error === failure);
  await host.startModule('example');
  assert.equal(factoryCalls, 2);
});

test('start failure stays inactive and retry reuses the same controller', async () => {
  const failure = new Error('start failed');
  let factoryCalls = 0;
  let startCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example() {
      factoryCalls += 1;
      return controller({
        start: async () => {
          startCalls += 1;
          if (startCalls === 1) throw failure;
        }
      });
    }
  }));

  await assert.rejects(host.startModule('example'), (error) => error === failure);
  await assert.rejects(host.executeModule('example', {}), expectHostCode('MODULE_NOT_ACTIVE'));
  await host.startModule('example');
  assert.equal(factoryCalls, 1);
  assert.equal(startCalls, 2);
});

test('composes with the real Controller and delegates snapshots after creation and stop', async () => {
  let snapshots = 0;
  const host = createNexaShellHost(binding(['example'], {
    example: () => createNexaModuleController(controller({
      getSnapshot(context) {
        snapshots += 1;
        return { state: context.state };
      }
    }))
  }));

  await host.startModule('example');
  assert.deepEqual(host.getModuleSnapshot('example'), { state: 'running' });
  await host.stopModule('example');
  assert.deepEqual(host.getModuleSnapshot('example'), { state: 'stopped' });
  assert.equal(snapshots, 2);
});

test('execute is fail-closed until active, never auto-creates, and preserves controller errors', async () => {
  const failure = new Error('execute failed');
  let factoryCalls = 0;
  let executeCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example() {
      factoryCalls += 1;
      return controller({
        execute: async (command) => {
          executeCalls += 1;
          if (command.fail) throw failure;
          return { accepted: command.value };
        }
      });
    }
  }));

  await assert.rejects(host.executeModule('example', {}), expectHostCode('MODULE_NOT_ACTIVE'));
  assert.equal(factoryCalls, 0);
  await host.startModule('example');
  assert.deepEqual(await host.executeModule('example', { value: 7 }), { accepted: 7 });
  await assert.rejects(host.executeModule('example', { fail: true }), (error) => error === failure);
  assert.equal(executeCalls, 2);
  await assert.rejects(host.executeModule('missing', {}), expectHostCode('MODULE_NOT_FOUND'));
});

test('stop of an uncreated module is a no-op and successful stop is idempotent', async () => {
  let factoryCalls = 0;
  let stopCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example() {
      factoryCalls += 1;
      return controller({ stop: async () => { stopCalls += 1; } });
    }
  }));

  await host.stopModule('example');
  assert.equal(factoryCalls, 0);
  await host.startModule('example');
  await host.stopModule('example');
  await host.stopModule('example');
  assert.equal(stopCalls, 1);
  await assert.rejects(host.stopModule('missing'), expectHostCode('MODULE_NOT_FOUND'));
});

test('stop failure blocks work, supports cleanup retry, and permits restart afterward', async () => {
  const failure = new Error('stop failed');
  let stopCalls = 0;
  let startCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example: () => controller({
      start: async () => { startCalls += 1; },
      stop: async () => {
        stopCalls += 1;
        if (stopCalls === 1) throw failure;
      }
    })
  }));

  await host.startModule('example');
  await assert.rejects(host.stopModule('example'), (error) => error === failure);
  await assert.rejects(host.executeModule('example', {}), expectHostCode('MODULE_NOT_ACTIVE'));
  await assert.rejects(host.startModule('example'), expectHostCode('MODULE_CLEANUP_PENDING'));
  await host.stopModule('example');
  await host.startModule('example');
  assert.equal(stopCalls, 2);
  assert.equal(startCalls, 2);
});

test('stop and restart move a module to the newest deterministic start position', async () => {
  const stopLog = [];
  const factories = Object.fromEntries(['alpha', 'beta', 'gamma'].map((moduleId) => [
    moduleId,
    () => controller({ stop: async () => { stopLog.push(moduleId); } })
  ]));
  const host = createNexaShellHost(binding(['alpha', 'beta', 'gamma'], factories));

  await host.startModule('alpha');
  await host.startModule('beta');
  await host.startModule('gamma');
  await host.stopModule('beta');
  stopLog.length = 0;
  await host.startModule('beta');
  await host.stopAll();
  assert.deepEqual(stopLog, ['beta', 'gamma', 'alpha']);
});

test('stopAll uses reverse start order and an empty host resolves without factories', async () => {
  const stopLog = [];
  const factories = Object.fromEntries(['alpha', 'beta', 'gamma'].map((moduleId) => [
    moduleId,
    () => controller({ stop: async () => { stopLog.push(moduleId); } })
  ]));
  const host = createNexaShellHost(binding(['alpha', 'beta', 'gamma'], factories));
  const emptyHost = createNexaShellHost(binding([], {}));

  await host.startModule('alpha');
  await host.startModule('beta');
  await host.startModule('gamma');
  await host.stopAll();
  await emptyHost.stopAll();
  assert.deepEqual(stopLog, ['gamma', 'beta', 'alpha']);
});

test('stopAll continues after failure, reports IDs, and retries only incomplete cleanup', async () => {
  const stopLog = [];
  let gammaStops = 0;
  const host = createNexaShellHost(binding(['alpha', 'beta', 'gamma'], {
    alpha: () => controller({ stop: async () => { stopLog.push('alpha'); } }),
    beta: () => controller({ stop: async () => { stopLog.push('beta'); } }),
    gamma: () => controller({
      stop: async () => {
        stopLog.push('gamma');
        gammaStops += 1;
        if (gammaStops === 1) throw new Error('gamma cleanup failed');
      }
    })
  }));

  await host.startModule('alpha');
  await host.startModule('beta');
  await host.startModule('gamma');
  await assert.rejects(host.stopAll(), (error) => {
    assert.equal(error instanceof NexaShellHostError, true);
    assert.equal(error.code, 'STOP_ALL_INCOMPLETE');
    assert.deepEqual(error.failedModuleIds, ['gamma']);
    assert.equal(Object.isFrozen(error.failedModuleIds), true);
    return true;
  });
  assert.deepEqual(stopLog, ['gamma', 'beta', 'alpha']);
  await assert.rejects(host.executeModule('gamma', {}), expectHostCode('MODULE_NOT_ACTIVE'));

  await host.stopAll();
  assert.deepEqual(stopLog, ['gamma', 'beta', 'alpha', 'gamma']);
});

test('concurrent stopAll calls share one attempt and never duplicate controller stop', async () => {
  const gate = deferred();
  let stopCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example: () => controller({
      stop: async () => {
        stopCalls += 1;
        return gate.promise;
      }
    })
  }));
  await host.startModule('example');

  const first = host.stopAll();
  const second = host.stopAll();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(stopCalls, 1);
  gate.resolve();
  await first;
  await second;
});

test('stopAll blocks new start, execute, and external stop while snapshots remain readable', async () => {
  const gate = deferred();
  const host = createNexaShellHost(binding(['example'], {
    example: () => controller({
      stop: async () => gate.promise,
      getSnapshot: () => ({ readable: true })
    })
  }));
  await host.startModule('example');

  const stopping = host.stopAll();
  await assert.rejects(host.startModule('example'), expectHostCode('HOST_STOPPING'));
  await assert.rejects(host.executeModule('example', {}), expectHostCode('HOST_STOPPING'));
  await assert.rejects(host.stopModule('example'), expectHostCode('HOST_STOPPING'));
  assert.deepEqual(host.getModuleSnapshot('example'), { readable: true });
  gate.resolve();
  await stopping;
});

test('unknown module lifecycle calls fail closed without creating a controller', async () => {
  let factoryCalls = 0;
  const host = createNexaShellHost(binding(['example'], {
    example: () => { factoryCalls += 1; return controller(); }
  }));

  await assert.rejects(host.startModule('missing'), expectHostCode('MODULE_NOT_FOUND'));
  await assert.rejects(host.stopModule('missing'), expectHostCode('MODULE_NOT_FOUND'));
  await assert.rejects(host.executeModule('missing', {}), expectHostCode('MODULE_NOT_FOUND'));
  assert.equal(factoryCalls, 0);
});

test('host source is pure shared ownership without discovery, host adapters, or bulk startup', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'shared', 'nexaShellHost.js'),
    'utf8'
  );

  assert.doesNotMatch(source, /node:fs|require\(['"]fs['"]\)|readdir|glob|import\s*\(|node:electron|child_process|node:net|node:http|process\.env/i);
  assert.doesNotMatch(source, /\b(startAll|restartAll|register|unregister|reload)\b/);
});
