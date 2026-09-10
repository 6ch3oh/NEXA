'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NEXA_CORE_CONTROL_DESCRIPTOR,
  NexaCoreControlBridgeError,
  createNexaCoreControlController,
  createNexaCoreControlIpcHandlers
} = require('../../src/electron/nexaCoreControlBridge');

test('declares one static Core control descriptor with no push surface', () => {
  assert.equal(NEXA_CORE_CONTROL_DESCRIPTOR.moduleId, 'core-control');
  assert.equal(NEXA_CORE_CONTROL_DESCRIPTOR.invokeChannels.length, 6);
  assert.equal(NEXA_CORE_CONTROL_DESCRIPTOR.pushChannels.length, 0);
  assert.equal(NEXA_CORE_CONTROL_DESCRIPTOR.invokeChannels.every(
    (channel) => channel.startsWith('nexa:core-control:')
  ), true);
});

test('controller exposes only safe control snapshots and allowlisted mutations', async () => {
  const calls = [];
  const control = {
    getSnapshot: () => ({ version: 1, modules: [] }),
    setEnabled: async (...args) => calls.push(['setEnabled', ...args]),
    setAutoStart: async (...args) => calls.push(['setAutoStart', ...args]),
    setAllEnabled: async (...args) => calls.push(['setAllEnabled', ...args]),
    setAllAutoStart: async (...args) => calls.push(['setAllAutoStart', ...args])
  };
  const controller = createNexaCoreControlController(() => control);
  await controller.start();
  assert.deepEqual(controller.getSnapshot(), { version: 1, modules: [] });
  await controller.execute({ type: 'set-enabled', moduleId: 'alpha', enabled: false });
  await controller.execute({ type: 'set-auto-start', moduleId: 'alpha', autoStart: true });
  await controller.execute({ type: 'set-all-enabled', enabled: true });
  await controller.execute({ type: 'set-all-auto-start', autoStart: false });
  assert.deepEqual(calls, [
    ['setEnabled', 'alpha', false],
    ['setAutoStart', 'alpha', true],
    ['setAllEnabled', true],
    ['setAllAutoStart', false]
  ]);
  await assert.rejects(
    controller.execute({ type: 'start-all' }),
    (error) => error instanceof NexaCoreControlBridgeError && error.code === 'UNKNOWN_COMMAND'
  );
});

test('IPC handlers demand-start only the permanent Core control module', async () => {
  const calls = [];
  const host = {
    async startModule(moduleId) { calls.push(['start', moduleId]); },
    getModuleSnapshot(moduleId) { calls.push(['snapshot', moduleId]); return { version: 1, modules: [] }; },
    async executeModule(moduleId, command) { calls.push(['execute', moduleId, command]); return command; }
  };
  const handlers = createNexaCoreControlIpcHandlers(host);
  assert.deepEqual(Object.keys(handlers).sort(), [...NEXA_CORE_CONTROL_DESCRIPTOR.invokeChannels].sort());
  await handlers['nexa:core-control:get-snapshot']({});
  await handlers['nexa:core-control:set-enabled']({}, 'alpha', false);
  assert.deepEqual(calls, [
    ['start', 'core-control'],
    ['snapshot', 'core-control'],
    ['start', 'core-control'],
    ['execute', 'core-control', { type: 'set-enabled', moduleId: 'alpha', enabled: false }]
  ]);
});

test('IPC handlers replace arbitrary implementation errors with stable safe semantics', async () => {
  const secret = 'sensitive-local-path';
  const host = {
    async startModule() {},
    getModuleSnapshot() { return { version: 1, modules: [] }; },
    async executeModule() { throw new Error(secret); }
  };
  const handlers = createNexaCoreControlIpcHandlers(host);
  await assert.rejects(
    handlers['nexa:core-control:set-all-enabled']({}, false),
    (error) => (
      error instanceof NexaCoreControlBridgeError
      && error.code === 'CORE_CONTROL_FAILED'
      && !error.message.includes(secret)
      && !Object.hasOwn(error, 'cause')
    )
  );
});
