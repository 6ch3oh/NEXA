'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NexaModuleControlError,
  createNexaModuleControl,
  normalizeNexaModuleControlPreferences
} = require('../../src/shared/nexaModuleControl');

function createHost(options = {}) {
  const active = new Set();
  const calls = [];
  return {
    calls,
    active,
    async startModule(moduleId) {
      calls.push(['start', moduleId]);
      if (options.failStart === moduleId) throw Object.assign(new Error('start failed'), { code: 'START_FAILED' });
      active.add(moduleId);
      return { moduleId };
    },
    async stopModule(moduleId) {
      calls.push(['stop', moduleId]);
      if (options.failStop === moduleId) throw Object.assign(new Error('stop failed'), { code: 'STOP_FAILED' });
      active.delete(moduleId);
    },
    getModuleSnapshot(moduleId) { return active.has(moduleId) ? { moduleId } : undefined; },
    async executeModule(moduleId, command) { calls.push(['execute', moduleId, command]); return command; },
    async stopAll() { calls.push(['stopAll']); active.clear(); }
  };
}

test('normalizes corrupt, unknown, deleted, and newly registered module preferences safely', () => {
  assert.deepEqual(normalizeNexaModuleControlPreferences(['alpha'], null), {
    version: 1,
    modules: { alpha: { enabled: true, autoStart: false } }
  });
  assert.deepEqual(normalizeNexaModuleControlPreferences(['alpha', 'new-module'], {
    version: 1,
    modules: {
      alpha: { enabled: false, autoStart: true },
      deleted: { enabled: false, autoStart: true }
    }
  }), {
    version: 1,
    modules: {
      alpha: { enabled: false, autoStart: true },
      'new-module': { enabled: true, autoStart: false }
    }
  });
});

test('persists changes before exposure and preserves prior state when persistence fails', async () => {
  const host = createHost();
  let writes = 0;
  const control = createNexaModuleControl({
    moduleIds: ['alpha'],
    host,
    persist: async () => { writes += 1; throw new Error('disk full'); }
  });
  await assert.rejects(
    control.setEnabled('alpha', false),
    (error) => error instanceof NexaModuleControlError && error.code === 'PERSISTENCE_FAILED'
  );
  assert.equal(writes, 1);
  assert.equal(control.getSnapshot().modules[0].enabled, true);
  assert.deepEqual(host.calls, []);
});

test('disabled modules fail closed while enabling never forces startup', async () => {
  const host = createHost();
  const persisted = [];
  const control = createNexaModuleControl({
    moduleIds: ['alpha'], host, persist: async (value) => persisted.push(value)
  });
  await control.setEnabled('alpha', false);
  await assert.rejects(control.startModule('alpha'), (error) => (
    error instanceof NexaModuleControlError && error.code === 'MODULE_DISABLED'
  ));
  await assert.rejects(control.executeModule('alpha', {}), (error) => error.code === 'MODULE_DISABLED');
  await control.setEnabled('alpha', true);
  assert.equal(host.calls.some(([type]) => type === 'start'), false);
  assert.equal(persisted.length, 2);
});

test('disabling a running module stops it and keeps the disabled preference on stop failure', async () => {
  const host = createHost({ failStop: 'alpha' });
  const control = createNexaModuleControl({ moduleIds: ['alpha'], host });
  await control.startModule('alpha');
  await assert.rejects(control.setEnabled('alpha', false), /stop failed/);
  const snapshot = control.getSnapshot().modules[0];
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.runtimeStatus, 'error');
  assert.equal(snapshot.errorCode, 'STOP_FAILED');
});

test('disabling during an in-flight start waits for startup and then stops the module', async () => {
  let releaseStart;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  const calls = [];
  const host = {
    async startModule(moduleId) { calls.push(['start', moduleId]); await startGate; },
    async stopModule(moduleId) { calls.push(['stop', moduleId]); },
    getModuleSnapshot() { return undefined; },
    async executeModule() {},
    async stopAll() {}
  };
  const control = createNexaModuleControl({ moduleIds: ['alpha'], host });
  const starting = control.startModule('alpha');
  await Promise.resolve();
  const disabling = control.setEnabled('alpha', false);
  releaseStart();
  await starting;
  await disabling;
  assert.deepEqual(calls, [['start', 'alpha'], ['stop', 'alpha']]);
  assert.equal(control.getSnapshot().modules[0].runtimeStatus, 'inactive');
});

test('autoStart starts only enabled opted-in modules and isolates failures', async () => {
  const host = createHost({ failStart: 'beta' });
  const control = createNexaModuleControl({
    moduleIds: ['alpha', 'beta', 'gamma'],
    host,
    preferences: {
      version: 1,
      modules: {
        alpha: { enabled: true, autoStart: true },
        beta: { enabled: true, autoStart: true },
        gamma: { enabled: false, autoStart: true }
      }
    }
  });
  assert.deepEqual(await control.startAutoModules(), {
    startedModuleIds: ['alpha'], failedModuleIds: ['beta']
  });
  assert.deepEqual(host.calls, [['start', 'alpha'], ['start', 'beta']]);
});

test('Enable All and AutoStart All change policy without starting modules', async () => {
  const host = createHost();
  const control = createNexaModuleControl({ moduleIds: ['alpha', 'beta'], host });
  await control.setAllEnabled(true);
  await control.setAllAutoStart(true);
  assert.equal(host.calls.some(([type]) => type === 'start'), false);
  assert.deepEqual(control.getSnapshot().modules.map(({ enabled, autoStart }) => ({ enabled, autoStart })), [
    { enabled: true, autoStart: true },
    { enabled: true, autoStart: true }
  ]);
});

test('returned control snapshots are defensive and unknown modules never reach the host', async () => {
  const host = createHost();
  const control = createNexaModuleControl({ moduleIds: ['alpha'], host });
  const first = control.getSnapshot();
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.modules), true);
  assert.equal(Object.isFrozen(first.modules[0]), true);
  assert.throws(() => { first.modules[0].enabled = false; }, TypeError);
  await assert.rejects(control.startModule('unknown'), (error) => error.code === 'MODULE_NOT_FOUND');
  assert.deepEqual(host.calls, []);
});

test('adds bounded readiness to the existing control snapshot without a second registry', async () => {
  const host = createHost();
  const control = createNexaModuleControl({
    moduleIds: ['alpha', 'device-center'],
    host,
    readinessByModuleId: { 'device-center': { ready: true, code: 'READY', secret: 'discarded' } }
  });
  assert.deepEqual(control.getSnapshot().modules, [
    {
      moduleId: 'alpha', enabled: true, autoStart: false, runtimeStatus: 'inactive',
      readiness: { state: 'OFFLINE', code: 'MODULE_INACTIVE' }
    },
    {
      moduleId: 'device-center', enabled: true, autoStart: false, runtimeStatus: 'inactive',
      readiness: { state: 'READY' }
    }
  ]);
  await control.startModule('alpha');
  assert.deepEqual(control.getSnapshot().modules[0].readiness, { state: 'READY' });
  await control.setEnabled('alpha', false);
  assert.deepEqual(control.getSnapshot().modules[0].readiness, {
    state: 'OFFLINE', code: 'MODULE_DISABLED'
  });
  assert.throws(() => createNexaModuleControl({
    moduleIds: ['alpha'], host, readinessByModuleId: { unknown: 'READY' }
  }), (error) => error.code === 'INVALID_MODULE_READINESS');
});

test('projects controller-reported readiness through the existing control snapshot', async () => {
  const host = createHost();
  host.getModuleSnapshot = (moduleId) => host.active.has(moduleId) ? {
    moduleId,
    readiness: { state: 'LIMITED', code: 'LOCAL_CACHE_STALE', private: 'discarded' }
  } : undefined;
  const control = createNexaModuleControl({ moduleIds: ['market'], host });
  await control.startModule('market');
  assert.deepEqual(control.getSnapshot().modules[0].readiness, {
    state: 'LIMITED', code: 'LOCAL_CACHE_STALE'
  });
});
