'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createNexaModuleRegistry } = require('../../src/shared/nexaModuleRegistry');
const {
  NexaIpcRegistrationError,
  applyNexaIpcRegistrationPlan,
  createNexaIpcRegistrationPlan
} = require('../../src/electron/nexaIpcRegistration');

const EMPTY_CONTEXT = Object.freeze({ reservedChannels: Object.freeze([]) });

function createRegistry(invokeChannels = [], pushChannels = []) {
  if (invokeChannels.length === 0 && pushChannels.length === 0) {
    return createNexaModuleRegistry([], EMPTY_CONTEXT);
  }
  return createNexaModuleRegistry([{
    moduleId: 'example',
    contractVersion: 1,
    invokeChannels,
    pushChannels
  }], EMPTY_CONTEXT);
}

function createFakeIpcMain(initialHandlers = []) {
  const calls = [];
  const handlers = new Map(initialHandlers);
  return {
    calls,
    handlers,
    handle(channel, handler) {
      calls.push(['handle', channel]);
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      calls.push(['removeHandler', channel]);
      handlers.delete(channel);
    }
  };
}

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) => error instanceof NexaIpcRegistrationError && error.code === code,
    `expected NEXA IPC registration error code ${code}`
  );
}

async function expectRejection(callback, code) {
  await assert.rejects(
    callback,
    (error) => error instanceof NexaIpcRegistrationError && error.code === code,
    `expected NEXA IPC registration rejection code ${code}`
  );
}

test('creates a frozen empty plan from an empty real Registry and empty handler maps', () => {
  for (const handlers of [{}, new Map()]) {
    const plan = createNexaIpcRegistrationPlan(createRegistry(), handlers);

    assert.equal(Object.isFrozen(plan), true);
    assert.deepEqual(Object.keys(plan).sort(), ['listInvokeChannels', 'listPushChannels']);
    assert.deepEqual(plan.listInvokeChannels(), []);
    assert.deepEqual(plan.listPushChannels(), []);
  }
});

test('captures sorted invoke and push snapshots without construction side effects', () => {
  let handlerCalls = 0;
  const handler = () => {
    handlerCalls += 1;
  };
  const registry = createRegistry(
    ['nexa:example:zulu', 'nexa:example:alpha'],
    ['nexa:example:updated', 'nexa:example:changed']
  );
  const before = registry.list();
  const plan = createNexaIpcRegistrationPlan(registry, {
    'nexa:example:zulu': handler,
    'nexa:example:alpha': handler
  });

  assert.deepEqual(plan.listInvokeChannels(), ['nexa:example:alpha', 'nexa:example:zulu']);
  assert.deepEqual(plan.listPushChannels(), ['nexa:example:changed', 'nexa:example:updated']);
  assert.equal(handlerCalls, 0);
  assert.deepEqual(registry.list(), before);
});

test('isolates Plan lists from Registry result and caller list mutations', () => {
  const invokeResult = ['nexa:example:get'];
  const pushResult = ['nexa:example:changed'];
  let invokeQueries = 0;
  let pushQueries = 0;
  const registry = {
    getInvokeChannels() {
      invokeQueries += 1;
      return invokeResult;
    },
    getPushChannels() {
      pushQueries += 1;
      return pushResult;
    }
  };
  const plan = createNexaIpcRegistrationPlan(registry, {
    'nexa:example:get': () => {}
  });
  const listedInvoke = plan.listInvokeChannels();
  const listedPush = plan.listPushChannels();

  invokeResult[0] = 'nexa:example:replaced';
  pushResult.length = 0;
  listedInvoke.push('nexa:example:later');
  listedPush[0] = 'nexa:example:other';

  assert.equal(invokeQueries, 1);
  assert.equal(pushQueries, 1);
  assert.deepEqual(plan.listInvokeChannels(), ['nexa:example:get']);
  assert.deepEqual(plan.listPushChannels(), ['nexa:example:changed']);
});

test('requires a structurally valid Registry with unique NEXA channels', () => {
  for (const registry of [null, {}, { getInvokeChannels() {}, getPushChannels() {} }]) {
    expectCode(() => createNexaIpcRegistrationPlan(registry, {}), 'INVALID_REGISTRY');
  }

  expectCode(
    () => createNexaIpcRegistrationPlan({
      getInvokeChannels: () => ['settings:get'],
      getPushChannels: () => []
    }, { 'settings:get': () => {} }),
    'INVALID_REGISTRY'
  );
  expectCode(
    () => createNexaIpcRegistrationPlan({
      getInvokeChannels: () => ['nexa:example:get'],
      getPushChannels: () => ['nexa:example:get']
    }, { 'nexa:example:get': () => {} }),
    'INVALID_REGISTRY'
  );
});

test('fails closed for malformed, missing, unexpected, and non-function handlers', () => {
  const registry = createRegistry(['nexa:example:get']);

  for (const handlers of [null, [], 'handler', new Map([[42, () => {}]])]) {
    expectCode(() => createNexaIpcRegistrationPlan(registry, handlers), 'INVALID_INVOKE_HANDLERS');
  }
  expectCode(() => createNexaIpcRegistrationPlan(registry, {}), 'MISSING_INVOKE_HANDLER');
  expectCode(
    () => createNexaIpcRegistrationPlan(registry, {
      'nexa:example:get': () => {},
      'nexa:example:extra': () => {}
    }),
    'UNEXPECTED_INVOKE_HANDLER'
  );
  expectCode(
    () => createNexaIpcRegistrationPlan(registry, { 'nexa:example:get': true }),
    'INVALID_INVOKE_HANDLER'
  );
});

test('snapshots handler bindings against later Map mutation and replacement', async () => {
  const originalGet = () => 'original-get';
  const originalSet = () => 'original-set';
  const handlers = new Map([
    ['nexa:example:get', originalGet],
    ['nexa:example:set', originalSet]
  ]);
  const plan = createNexaIpcRegistrationPlan(
    createRegistry(['nexa:example:set', 'nexa:example:get']),
    handlers
  );

  handlers.set('nexa:example:get', () => 'replacement');
  handlers.delete('nexa:example:set');
  handlers.set('nexa:example:extra', () => 'extra');

  const ipcMain = createFakeIpcMain();
  await applyNexaIpcRegistrationPlan(plan, ipcMain);

  assert.strictEqual(ipcMain.handlers.get('nexa:example:get'), originalGet);
  assert.strictEqual(ipcMain.handlers.get('nexa:example:set'), originalSet);
  assert.equal(ipcMain.handlers.has('nexa:example:extra'), false);
});

test('rejects malformed ipcMain adapters before registration', async () => {
  const plan = createNexaIpcRegistrationPlan(createRegistry(), {});

  for (const ipcMain of [null, {}, { handle() {} }, { removeHandler() {} }]) {
    await expectRejection(() => applyNexaIpcRegistrationPlan(plan, ipcMain), 'INVALID_IPC_MAIN');
  }
});

test('registers each invoke once in string order, never registers push, and freezes the handle', async () => {
  const handler = () => {};
  const plan = createNexaIpcRegistrationPlan(
    createRegistry(
      ['nexa:example:zulu', 'nexa:example:alpha', 'nexa:example:middle'],
      ['nexa:example:changed']
    ),
    {
      'nexa:example:zulu': handler,
      'nexa:example:alpha': handler,
      'nexa:example:middle': handler
    }
  );
  const ipcMain = createFakeIpcMain();
  const registration = await applyNexaIpcRegistrationPlan(plan, ipcMain);

  assert.deepEqual(ipcMain.calls, [
    ['handle', 'nexa:example:alpha'],
    ['handle', 'nexa:example:middle'],
    ['handle', 'nexa:example:zulu']
  ]);
  assert.equal(ipcMain.handlers.has('nexa:example:changed'), false);
  assert.equal(Object.isFrozen(registration), true);
  assert.deepEqual(Object.keys(registration), ['dispose']);
});

test('rolls back earlier registrations and stops after a middle handle failure', async () => {
  const plan = createNexaIpcRegistrationPlan(
    createRegistry(['nexa:example:alpha', 'nexa:example:beta', 'nexa:example:gamma']),
    {
      'nexa:example:alpha': () => {},
      'nexa:example:beta': () => {},
      'nexa:example:gamma': () => {}
    }
  );
  const calls = [];
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      calls.push(['handle', channel]);
      if (channel === 'nexa:example:beta') throw new Error('injected handle failure');
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      calls.push(['removeHandler', channel]);
      handlers.delete(channel);
    }
  };

  await expectRejection(
    () => applyNexaIpcRegistrationPlan(plan, ipcMain),
    'IPC_REGISTRATION_FAILED'
  );
  assert.deepEqual(calls, [
    ['handle', 'nexa:example:alpha'],
    ['handle', 'nexa:example:beta'],
    ['removeHandler', 'nexa:example:alpha']
  ]);
  assert.deepEqual([...handlers.keys()], []);
});

test('rolls back in reverse order after a later registration failure', async () => {
  const channels = ['nexa:example:alpha', 'nexa:example:beta', 'nexa:example:gamma'];
  const plan = createNexaIpcRegistrationPlan(
    createRegistry(channels),
    Object.fromEntries(channels.map((channel) => [channel, () => {}]))
  );
  const calls = [];
  const ipcMain = {
    handle(channel) {
      calls.push(['handle', channel]);
      if (channel === 'nexa:example:gamma') throw new Error('injected handle failure');
    },
    removeHandler(channel) {
      calls.push(['removeHandler', channel]);
    }
  };

  await expectRejection(
    () => applyNexaIpcRegistrationPlan(plan, ipcMain),
    'IPC_REGISTRATION_FAILED'
  );
  assert.deepEqual(calls.slice(-2), [
    ['removeHandler', 'nexa:example:beta'],
    ['removeHandler', 'nexa:example:alpha']
  ]);
});

test('reports rollback failure while continuing rollback of earlier channels', async () => {
  const channels = ['nexa:example:alpha', 'nexa:example:beta', 'nexa:example:gamma'];
  const plan = createNexaIpcRegistrationPlan(
    createRegistry(channels),
    Object.fromEntries(channels.map((channel) => [channel, () => {}]))
  );
  const removals = [];
  const ipcMain = {
    handle(channel) {
      if (channel === 'nexa:example:gamma') throw new Error('injected handle failure');
    },
    removeHandler(channel) {
      removals.push(channel);
      if (channel === 'nexa:example:beta') throw new Error('injected rollback failure');
    }
  };

  await expectRejection(
    () => applyNexaIpcRegistrationPlan(plan, ipcMain),
    'IPC_REGISTRATION_ROLLBACK_FAILED'
  );
  assert.deepEqual(removals, ['nexa:example:beta', 'nexa:example:alpha']);
});

test('dispose removes only its registrations in reverse order and is idempotent', async () => {
  const legacyHandler = () => {};
  const channels = ['nexa:example:alpha', 'nexa:example:beta'];
  const plan = createNexaIpcRegistrationPlan(
    createRegistry(channels),
    Object.fromEntries(channels.map((channel) => [channel, () => {}]))
  );
  const ipcMain = createFakeIpcMain([['settings:get', legacyHandler]]);
  const registration = await applyNexaIpcRegistrationPlan(plan, ipcMain);

  await registration.dispose();
  await registration.dispose();

  assert.deepEqual(ipcMain.calls.filter(([method]) => method === 'removeHandler'), [
    ['removeHandler', 'nexa:example:beta'],
    ['removeHandler', 'nexa:example:alpha']
  ]);
  assert.strictEqual(ipcMain.handlers.get('settings:get'), legacyHandler);
});

test('concurrent dispose calls share cleanup without duplicate removal', async () => {
  const channels = ['nexa:example:alpha', 'nexa:example:beta'];
  const plan = createNexaIpcRegistrationPlan(
    createRegistry(channels),
    Object.fromEntries(channels.map((channel) => [channel, () => {}]))
  );
  let releaseRemoval;
  const removalGate = new Promise((resolve) => {
    releaseRemoval = resolve;
  });
  const removals = [];
  const ipcMain = {
    handle() {},
    async removeHandler(channel) {
      removals.push(channel);
      await removalGate;
    }
  };
  const registration = await applyNexaIpcRegistrationPlan(plan, ipcMain);

  const firstDispose = registration.dispose();
  const secondDispose = registration.dispose();
  assert.strictEqual(firstDispose, secondDispose);
  releaseRemoval();
  await Promise.all([firstDispose, secondDispose]);

  assert.deepEqual(removals, ['nexa:example:beta', 'nexa:example:alpha']);
});

test('dispose continues after failure and retries only the failed channel', async () => {
  const channels = ['nexa:example:alpha', 'nexa:example:beta', 'nexa:example:gamma'];
  const plan = createNexaIpcRegistrationPlan(
    createRegistry(channels),
    Object.fromEntries(channels.map((channel) => [channel, () => {}]))
  );
  const removals = [];
  let betaAttempts = 0;
  const ipcMain = {
    handle() {},
    removeHandler(channel) {
      removals.push(channel);
      if (channel === 'nexa:example:beta' && betaAttempts++ === 0) {
        throw new Error('injected dispose failure');
      }
    }
  };
  const registration = await applyNexaIpcRegistrationPlan(plan, ipcMain);

  await expectRejection(() => registration.dispose(), 'IPC_DISPOSE_INCOMPLETE');
  assert.deepEqual(removals, [
    'nexa:example:gamma',
    'nexa:example:beta',
    'nexa:example:alpha'
  ]);

  await registration.dispose();
  assert.deepEqual(removals, [
    'nexa:example:gamma',
    'nexa:example:beta',
    'nexa:example:alpha',
    'nexa:example:beta'
  ]);
  await registration.dispose();
  assert.equal(removals.length, 4);
});

test('legacy handlers cannot enter a Plan and are never registered or removed', async () => {
  const registry = createRegistry(['nexa:example:get']);
  expectCode(
    () => createNexaIpcRegistrationPlan(registry, {
      'nexa:example:get': () => {},
      'settings:get': () => {}
    }),
    'UNEXPECTED_INVOKE_HANDLER'
  );

  const legacyHandler = () => {};
  const ipcMain = createFakeIpcMain([['settings:get', legacyHandler]]);
  const registration = await applyNexaIpcRegistrationPlan(
    createNexaIpcRegistrationPlan(registry, { 'nexa:example:get': () => {} }),
    ipcMain
  );
  await registration.dispose();

  assert.strictEqual(ipcMain.handlers.get('settings:get'), legacyHandler);
  assert.equal(ipcMain.calls.some(([, channel]) => channel === 'settings:get'), false);
});

test('source imports no Electron singleton and implements no discovery or push transport', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'electron', 'nexaIpcRegistration.js'),
    'utf8'
  );

  assert.doesNotMatch(source, /require\s*\(\s*['"]electron['"]\s*\)/);
  assert.doesNotMatch(source, /webContents|\.send\s*\(|readdir|glob|dynamic import|import\s*\(/i);
});
