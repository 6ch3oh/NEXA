'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  AUTOMATION_CENTER_BRIDGE_VERSION,
  AUTOMATION_CENTER_CHANNELS,
  AUTOMATION_CENTER_COMPOSITION_VERSION,
  AUTOMATION_CENTER_DEFAULT_INTERVAL_MS,
  AUTOMATION_CENTER_MODULE_ID,
  NEXA_AUTOMATION_CENTER_DESCRIPTOR,
  NexaAutomationCenterBridgeError,
  createNexaAutomationCenterController,
  createNexaAutomationCenterIpcHandlers,
  createUnavailableNexaAutomationCenterPublicApi,
  validateAutomationCenterPublicApi
} = require('../../src/electron/nexaAutomationCenterBridge');

function bridgeEnvelope(data) {
  return Object.freeze({
    bridge_version: AUTOMATION_CENTER_BRIDGE_VERSION,
    ok: true,
    data: Object.freeze(data),
    error: null
  });
}

function fixture(overrides = {}) {
  const calls = [];
  const callbacks = [];
  const timerHandles = [];
  let compositionCreates = 0;
  const bridge = {};
  for (const method of [
    'capabilities', 'availableAiRoutes', 'listAutomations', 'getAutomation',
    'getAutomationStatus', 'getNextScheduledRun', 'getLatestRun', 'listRecentRuns',
    'createAutomation', 'updateAutomation', 'enableAutomation', 'disableAutomation',
    'archiveAutomation', 'manualRun', 'evaluateSchedules', 'runDueSchedules',
    'retryFailedOccurrence'
  ]) {
    bridge[method] = async (...args) => {
      calls.push([method, ...args]);
      return bridgeEnvelope({ method, argument_count: args.length });
    };
  }
  Object.assign(bridge, overrides.bridge);
  const composition = {
    version: AUTOMATION_CENTER_COMPOSITION_VERSION,
    bridge_version: AUTOMATION_CENTER_BRIDGE_VERSION,
    credential_free: true,
    bridge,
    readiness: async () => ({
      automation_registry: 'READY', dispatch: 'READY', runtime: 'UNAVAILABLE',
      runtime_status: 'OWNER_RUNTIME_NOT_READY'
    }),
    lifecycle: {
      host_owned: true,
      starts_runtime_on_import: false,
      async start() { calls.push(['lifecycle.start']); return { status: 'STARTED', runtime_started: false }; },
      async stop() { calls.push(['lifecycle.stop']); return { status: 'STOPPED', runtime_stopped: false }; }
    },
    ...overrides.composition
  };
  const publicApi = {
    DAILY_OPS_PRODUCTION_COMPOSITION_VERSION: AUTOMATION_CENTER_COMPOSITION_VERSION,
    DAILY_OPS_DESKTOP_BRIDGE_VERSION: AUTOMATION_CENTER_BRIDGE_VERSION,
    async createDailyOpsProductionComposition(options) {
      compositionCreates += 1;
      calls.push(['createComposition', options.product_data_root]);
      return composition;
    }
  };
  const controller = createNexaAutomationCenterController({
    publicApi,
    dataRoot: path.join(os.tmpdir(), 'nexa-automation-center-controller'),
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    setIntervalFn(callback, intervalMs) {
      callbacks.push(callback);
      const handle = { intervalMs, id: timerHandles.length + 1 };
      timerHandles.push(handle);
      calls.push(['setInterval', intervalMs]);
      return handle;
    },
    clearIntervalFn(handle) { calls.push(['clearInterval', handle.id]); }
  });
  return { bridge, callbacks, calls, composition, controller, publicApi, timerHandles, get compositionCreates() { return compositionCreates; } };
}

test('exports one static Automation Center module descriptor and exact production contract versions', () => {
  assert.equal(AUTOMATION_CENTER_MODULE_ID, 'automation-center');
  assert.equal(AUTOMATION_CENTER_DEFAULT_INTERVAL_MS, 60_000);
  assert.equal(NEXA_AUTOMATION_CENTER_DESCRIPTOR.moduleId, AUTOMATION_CENTER_MODULE_ID);
  assert.deepEqual(NEXA_AUTOMATION_CENTER_DESCRIPTOR.invokeChannels, Object.values(AUTOMATION_CENTER_CHANNELS));
  assert.equal(Object.isFrozen(NEXA_AUTOMATION_CENTER_DESCRIPTOR), true);
  assert.throws(
    () => validateAutomationCenterPublicApi({ createDailyOpsProductionComposition() {} }),
    (error) => error instanceof NexaAutomationCenterBridgeError &&
      error.code === 'INVALID_AUTOMATION_CENTER_PUBLIC_API'
  );
});

test('hosts one immediate evaluation and one 60-second timer without starting a Runtime', async () => {
  const value = fixture();
  const first = await Promise.all([value.controller.start(), value.controller.start()]);

  assert.equal(value.compositionCreates, 1);
  assert.equal(first[0].runtimeStarted, false);
  assert.equal(value.calls.filter(([name]) => name === 'lifecycle.start').length, 1);
  assert.equal(value.calls.filter(([name]) => name === 'runDueSchedules').length, 1);
  assert.equal(value.timerHandles.length, 1);
  assert.equal(value.timerHandles[0].intervalMs, 60_000);
  assert.deepEqual(value.controller.getSnapshot().readiness, {
    state: 'LIMITED', code: 'RUNTIME_UNAVAILABLE', registry: 'READY', scheduler: 'READY',
    dispatch: 'READY', runtime: 'UNAVAILABLE', runtimeStatus: 'OWNER_RUNTIME_NOT_READY',
    credentialFree: true
  });
  assert.equal(value.controller.getSnapshot().scheduler.immediateEvaluationCount, 1);
  assert.equal(value.controller.getSnapshot().scheduler.timerActive, true);

  value.callbacks[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(value.calls.filter(([name]) => name === 'runDueSchedules').length, 2);
  assert.equal(value.controller.getSnapshot().scheduler.scheduledEvaluationCount, 1);

  const response = await value.controller.execute({ operation: 'manual-run', arguments: ['automation-1', {}] });
  assert.equal(response.ok, true);
  assert.equal(response.data.method, 'manualRun');

  await value.controller.stop();
  assert.deepEqual(value.calls.filter(([name]) => name === 'clearInterval'), [['clearInterval', 1]]);
  assert.equal(value.calls.filter(([name]) => name === 'lifecycle.stop').length, 1);
  assert.equal(value.controller.getSnapshot().scheduler.timerActive, false);
});

test('keeps runtime-unavailable truth and scheduler failures safe instead of manufacturing success', async () => {
  const value = fixture({
    bridge: { async runDueSchedules() { throw Object.assign(new Error('private runtime path'), { code: 'OWNER_RUNTIME_NOT_READY' }); } }
  });
  await value.controller.start();
  const snapshot = value.controller.getSnapshot();

  assert.equal(snapshot.readiness.runtime, 'UNAVAILABLE');
  assert.equal(snapshot.scheduler.immediateEvaluationCount, 1);
  assert.equal(snapshot.scheduler.lastEvaluation.ok, false);
  assert.equal(snapshot.scheduler.lastEvaluation.error.code, 'SCHEDULER_EVALUATION_FAILED');
  assert.equal(JSON.stringify(snapshot).includes('private runtime path'), false);
  await value.controller.stop();
});

test('maps every IPC channel through Module Control and returns safe host failures', async () => {
  const calls = [];
  const control = {
    async startModule(moduleId) { calls.push(['start', moduleId]); },
    async executeModule(moduleId, command) {
      calls.push(['execute', moduleId, command]);
      if (command.operation === 'manual-run') {
        throw Object.assign(new Error('sensitive internal failure'), { code: 'RUNTIME_UNAVAILABLE' });
      }
      return bridgeEnvelope({ operation: command.operation });
    }
  };
  const handlers = createNexaAutomationCenterIpcHandlers(control);

  assert.deepEqual(Object.keys(handlers), Object.values(AUTOMATION_CENTER_CHANNELS));
  const listed = await handlers[AUTOMATION_CENTER_CHANNELS.listAutomations]({}, { lifecycle: 'ACTIVE' });
  assert.equal(listed.ok, true);
  assert.deepEqual(calls.slice(0, 2), [
    ['start', AUTOMATION_CENTER_MODULE_ID],
    ['execute', AUTOMATION_CENTER_MODULE_ID, {
      operation: 'list-automations', arguments: [{ lifecycle: 'ACTIVE' }]
    }]
  ]);
  const failed = await handlers[AUTOMATION_CENTER_CHANNELS.manualRun]({}, 'automation-1', {});
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'RUNTIME_UNAVAILABLE');
  assert.equal(JSON.stringify(failed).includes('sensitive internal failure'), false);
});

test('public runtime fallback stays credential-free and exposes only limited Automation state', async () => {
  const publicApi = createUnavailableNexaAutomationCenterPublicApi();
  const timers = [];
  const controller = createNexaAutomationCenterController({
    publicApi,
    dataRoot: path.join(os.tmpdir(), 'nexa-automation-center-public-fallback'),
    setIntervalFn(callback, intervalMs) {
      const handle = { callback, intervalMs, id: timers.length + 1 };
      timers.push(handle);
      return handle;
    },
    clearIntervalFn() {}
  });

  const started = await controller.start();
  assert.equal(started.runtimeStarted, false);
  assert.deepEqual(controller.getSnapshot().readiness, {
    state: 'LIMITED',
    code: 'RUNTIME_UNAVAILABLE',
    registry: 'UNAVAILABLE',
    scheduler: 'READY',
    dispatch: 'UNAVAILABLE',
    runtime: 'UNAVAILABLE',
    runtimeStatus: 'AUTOMATION_RUNTIME_UNAVAILABLE',
    credentialFree: true
  });
  assert.equal(timers.length, 1);

  const result = await controller.execute({ operation: 'list-automations', arguments: [] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTOMATION_RUNTIME_UNAVAILABLE');
  assert.equal(result.error.retryable, false);
  assert.equal(JSON.stringify(result).includes('credential'), false);
  await controller.stop();
});
