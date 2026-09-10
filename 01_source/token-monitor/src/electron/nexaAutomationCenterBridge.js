'use strict';

const path = require('node:path');
const { createNexaModuleController } = require('../shared/nexaModuleController');

const AUTOMATION_CENTER_MODULE_ID = 'automation-center';
const AUTOMATION_CENTER_COMPOSITION_VERSION = 'NEXA_DAILY_OPS_PRODUCTION_COMPOSITION_V0_1';
const AUTOMATION_CENTER_BRIDGE_VERSION = 'NEXA_DAILY_OPS_DESKTOP_BRIDGE_V0_1';
const AUTOMATION_CENTER_DEFAULT_INTERVAL_MS = 60_000;
const AUTOMATION_CENTER_CHANNELS = Object.freeze({
  capabilities: 'nexa:automation-center:capabilities',
  availableAiRoutes: 'nexa:automation-center:available-ai-routes',
  listAutomations: 'nexa:automation-center:list-automations',
  getAutomation: 'nexa:automation-center:get-automation',
  getAutomationStatus: 'nexa:automation-center:get-automation-status',
  getNextScheduledRun: 'nexa:automation-center:get-next-scheduled-run',
  getLatestRun: 'nexa:automation-center:get-latest-run',
  listRecentRuns: 'nexa:automation-center:list-recent-runs',
  createAutomation: 'nexa:automation-center:create-automation',
  updateAutomation: 'nexa:automation-center:update-automation',
  enableAutomation: 'nexa:automation-center:enable-automation',
  disableAutomation: 'nexa:automation-center:disable-automation',
  archiveAutomation: 'nexa:automation-center:archive-automation',
  manualRun: 'nexa:automation-center:manual-run',
  evaluateSchedules: 'nexa:automation-center:evaluate-schedules',
  runDueSchedules: 'nexa:automation-center:run-due-schedules',
  retryFailedOccurrence: 'nexa:automation-center:retry-failed-occurrence'
});
const NEXA_AUTOMATION_CENTER_DESCRIPTOR = Object.freeze({
  moduleId: AUTOMATION_CENTER_MODULE_ID,
  contractVersion: 1,
  invokeChannels: Object.freeze(Object.values(AUTOMATION_CENTER_CHANNELS)),
  pushChannels: Object.freeze([])
});
const BRIDGE_METHOD_BY_OPERATION = Object.freeze({
  capabilities: 'capabilities',
  'available-ai-routes': 'availableAiRoutes',
  'list-automations': 'listAutomations',
  'get-automation': 'getAutomation',
  'get-automation-status': 'getAutomationStatus',
  'get-next-scheduled-run': 'getNextScheduledRun',
  'get-latest-run': 'getLatestRun',
  'list-recent-runs': 'listRecentRuns',
  'create-automation': 'createAutomation',
  'update-automation': 'updateAutomation',
  'enable-automation': 'enableAutomation',
  'disable-automation': 'disableAutomation',
  'archive-automation': 'archiveAutomation',
  'manual-run': 'manualRun',
  'evaluate-schedules': 'evaluateSchedules',
  'run-due-schedules': 'runDueSchedules',
  'retry-failed-occurrence': 'retryFailedOccurrence'
});
const SECRET_KEY = /^(?:api_?key|secret|password|authorization_header|credential_value|permit_secret|lease_secret|access_token|refresh_token)$/iu;
const SECRET_VALUE = /(?:bearer\s+[A-Za-z0-9._~+/-]{12,}|(?:sk|ds)-[A-Za-z0-9_-]{20,})/iu;

class NexaAutomationCenterBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaAutomationCenterBridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NexaAutomationCenterBridgeError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsSecret(value) {
  if (typeof value === 'string') return SECRET_VALUE.test(value);
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => SECRET_KEY.test(key) || containsSecret(child));
  }
  return false;
}

function clonePublicValue(value) {
  let cloned;
  try { cloned = structuredClone(value); }
  catch { fail('UNSAFE_AUTOMATION_CENTER_RESULT', 'Automation Center returned a non-cloneable result'); }
  if (containsSecret(cloned)) {
    fail('UNSAFE_AUTOMATION_CENTER_RESULT', 'Automation Center result crossed the Credential-Free boundary');
  }
  return cloned;
}

function validateAutomationCenterPublicApi(publicApi) {
  if (publicApi?.DAILY_OPS_PRODUCTION_COMPOSITION_VERSION !== AUTOMATION_CENTER_COMPOSITION_VERSION ||
      typeof publicApi?.createDailyOpsProductionComposition !== 'function') {
    fail('INVALID_AUTOMATION_CENTER_PUBLIC_API', 'Daily Ops production composition V0.1 is required');
  }
  return publicApi;
}

function validateProductionComposition(composition) {
  const bridge = composition?.bridge;
  if (composition?.version !== AUTOMATION_CENTER_COMPOSITION_VERSION ||
      composition?.bridge_version !== AUTOMATION_CENTER_BRIDGE_VERSION ||
      composition?.credential_free !== true ||
      composition?.lifecycle?.host_owned !== true ||
      composition?.lifecycle?.starts_runtime_on_import !== false ||
      typeof composition?.lifecycle?.start !== 'function' ||
      typeof composition?.lifecycle?.stop !== 'function' ||
      typeof composition?.readiness !== 'function') {
    fail('INVALID_AUTOMATION_CENTER_COMPOSITION', 'Daily Ops production composition contract is incomplete');
  }
  for (const method of Object.values(BRIDGE_METHOD_BY_OPERATION)) {
    if (typeof bridge?.[method] !== 'function') {
      fail('INVALID_AUTOMATION_CENTER_COMPOSITION', 'Daily Ops Desktop Bridge contract is incomplete');
    }
  }
  return composition;
}

function validateDataRoot(dataRoot) {
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot) ||
      path.resolve(dataRoot) === path.parse(path.resolve(dataRoot)).root) {
    fail('INVALID_AUTOMATION_CENTER_DATA_ROOT', 'Automation Center data root must be an absolute non-root path');
  }
}

function readinessProjection(value) {
  const runtimeReady = value?.runtime === 'READY';
  return Object.freeze({
    state: runtimeReady ? 'READY' : 'LIMITED',
    code: runtimeReady ? 'READY' : 'RUNTIME_UNAVAILABLE',
    registry: value?.automation_registry === 'READY' ? 'READY' : 'UNAVAILABLE',
    scheduler: 'READY',
    dispatch: value?.dispatch === 'READY' ? 'READY' : 'UNAVAILABLE',
    runtime: runtimeReady ? 'READY' : 'UNAVAILABLE',
    runtimeStatus: typeof value?.runtime_status === 'string' ? value.runtime_status : 'UNKNOWN',
    credentialFree: true
  });
}

function createNexaAutomationCenterController({
  publicApi,
  dataRoot,
  intervalMs = AUTOMATION_CENTER_DEFAULT_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date()
} = {}) {
  validateAutomationCenterPublicApi(publicApi);
  validateDataRoot(dataRoot);
  if (!Number.isInteger(intervalMs) || intervalMs <= 0 || typeof setIntervalFn !== 'function' ||
      typeof clearIntervalFn !== 'function' || typeof now !== 'function') {
    fail('INVALID_AUTOMATION_CENTER_HOST_CONFIG', 'Automation Center host timer configuration is invalid');
  }

  let composition = null;
  let timer = null;
  let tickPromise = null;
  let readiness = Object.freeze({
    state: 'OFFLINE', code: 'MODULE_INACTIVE', registry: 'UNAVAILABLE', scheduler: 'OFFLINE',
    dispatch: 'UNAVAILABLE', runtime: 'UNAVAILABLE', runtimeStatus: 'UNKNOWN', credentialFree: true
  });
  let immediateEvaluationCount = 0;
  let scheduledEvaluationCount = 0;
  let lastEvaluation = null;

  function runSchedulerTick(source) {
    if (!composition) return Promise.resolve();
    if (tickPromise) return tickPromise;
    const ownedComposition = composition;
    if (source === 'immediate') immediateEvaluationCount += 1;
    else scheduledEvaluationCount += 1;
    const attempt = Promise.resolve()
      .then(() => ownedComposition.bridge.runDueSchedules(now()))
      .then((result) => {
        lastEvaluation = clonePublicValue(result);
        return result;
      })
      .catch(() => {
        lastEvaluation = Object.freeze({
          bridge_version: AUTOMATION_CENTER_BRIDGE_VERSION,
          ok: false,
          data: null,
          error: Object.freeze({
            code: 'SCHEDULER_EVALUATION_FAILED',
            message: 'Automation schedule evaluation failed.',
            retryable: true,
            action_required: 'RETRY_OR_CHECK_EXECUTIONHUB'
          })
        });
      })
      .finally(() => {
        if (tickPromise === attempt) tickPromise = null;
      });
    tickPromise = attempt;
    return attempt;
  }

  return createNexaModuleController({
    async start() {
      const candidate = validateProductionComposition(
        await publicApi.createDailyOpsProductionComposition({ product_data_root: dataRoot, now })
      );
      composition = candidate;
      try {
        await candidate.lifecycle.start();
        let readinessValue;
        try { readinessValue = await candidate.readiness(); }
        catch { readinessValue = { runtime: 'UNAVAILABLE', runtime_status: 'READINESS_UNAVAILABLE' }; }
        readiness = readinessProjection(readinessValue);
        await runSchedulerTick('immediate');
        timer = setIntervalFn(() => { void runSchedulerTick('scheduled'); }, intervalMs);
        return clonePublicValue({
          bridgeVersion: AUTOMATION_CENTER_BRIDGE_VERSION,
          compositionVersion: AUTOMATION_CENTER_COMPOSITION_VERSION,
          readiness,
          runtimeStarted: false,
          schedulerIntervalMs: intervalMs
        });
      } catch (error) {
        if (timer !== null) clearIntervalFn(timer);
        timer = null;
        composition = null;
        try { await candidate.lifecycle.stop(); } catch {}
        throw error;
      }
    },
    async stop() {
      if (timer !== null) clearIntervalFn(timer);
      timer = null;
      if (tickPromise) await tickPromise;
      const ownedComposition = composition;
      composition = null;
      if (ownedComposition) await ownedComposition.lifecycle.stop();
      readiness = Object.freeze({
        state: 'OFFLINE', code: 'MODULE_INACTIVE', registry: 'UNAVAILABLE', scheduler: 'OFFLINE',
        dispatch: 'UNAVAILABLE', runtime: 'UNAVAILABLE', runtimeStatus: 'UNKNOWN', credentialFree: true
      });
    },
    getSnapshot() {
      return Object.freeze({
        hostStatus: composition ? (readiness.state === 'READY' ? 'ready' : 'limited') : 'stopped',
        publicApiVersion: AUTOMATION_CENTER_BRIDGE_VERSION,
        compositionVersion: AUTOMATION_CENTER_COMPOSITION_VERSION,
        readiness,
        scheduler: Object.freeze({
          intervalMs,
          timerActive: timer !== null,
          immediateEvaluationCount,
          scheduledEvaluationCount,
          evaluationInFlight: tickPromise !== null,
          lastEvaluation: lastEvaluation === null ? null : clonePublicValue(lastEvaluation)
        })
      });
    },
    async execute(command) {
      if (!composition || !isPlainObject(command) ||
          typeof command.operation !== 'string' || !Array.isArray(command.arguments) ||
          Object.keys(command).some((key) => !['operation', 'arguments'].includes(key))) {
        fail('INVALID_AUTOMATION_CENTER_COMMAND', 'Automation Center command is invalid');
      }
      const method = BRIDGE_METHOD_BY_OPERATION[command.operation];
      if (!method) fail('UNKNOWN_AUTOMATION_CENTER_COMMAND', 'Automation Center command is not supported');
      const args = clonePublicValue(command.arguments);
      return clonePublicValue(await composition.bridge[method](...args));
    }
  });
}

function safeHostFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)
    ? error.code
    : 'AUTOMATION_CENTER_HOST_REQUEST_FAILED';
  return Object.freeze({
    bridge_version: AUTOMATION_CENTER_BRIDGE_VERSION,
    ok: false,
    data: null,
    error: Object.freeze({
      code,
      message: 'Automation Center host request failed.',
      retryable: false,
      action_required: null
    })
  });
}

function createNexaAutomationCenterIpcHandlers(control) {
  if (!control || typeof control.startModule !== 'function' || typeof control.executeModule !== 'function') {
    fail('INVALID_CONTROL', 'NEXA module control is required');
  }
  const handler = (operation) => async (_event, ...args) => {
    try {
      await control.startModule(AUTOMATION_CENTER_MODULE_ID);
      return await control.executeModule(AUTOMATION_CENTER_MODULE_ID, {
        operation,
        arguments: clonePublicValue(args)
      });
    } catch (error) {
      return safeHostFailure(error);
    }
  };
  return Object.freeze({
    [AUTOMATION_CENTER_CHANNELS.capabilities]: handler('capabilities'),
    [AUTOMATION_CENTER_CHANNELS.availableAiRoutes]: handler('available-ai-routes'),
    [AUTOMATION_CENTER_CHANNELS.listAutomations]: handler('list-automations'),
    [AUTOMATION_CENTER_CHANNELS.getAutomation]: handler('get-automation'),
    [AUTOMATION_CENTER_CHANNELS.getAutomationStatus]: handler('get-automation-status'),
    [AUTOMATION_CENTER_CHANNELS.getNextScheduledRun]: handler('get-next-scheduled-run'),
    [AUTOMATION_CENTER_CHANNELS.getLatestRun]: handler('get-latest-run'),
    [AUTOMATION_CENTER_CHANNELS.listRecentRuns]: handler('list-recent-runs'),
    [AUTOMATION_CENTER_CHANNELS.createAutomation]: handler('create-automation'),
    [AUTOMATION_CENTER_CHANNELS.updateAutomation]: handler('update-automation'),
    [AUTOMATION_CENTER_CHANNELS.enableAutomation]: handler('enable-automation'),
    [AUTOMATION_CENTER_CHANNELS.disableAutomation]: handler('disable-automation'),
    [AUTOMATION_CENTER_CHANNELS.archiveAutomation]: handler('archive-automation'),
    [AUTOMATION_CENTER_CHANNELS.manualRun]: handler('manual-run'),
    [AUTOMATION_CENTER_CHANNELS.evaluateSchedules]: handler('evaluate-schedules'),
    [AUTOMATION_CENTER_CHANNELS.runDueSchedules]: handler('run-due-schedules'),
    [AUTOMATION_CENTER_CHANNELS.retryFailedOccurrence]: handler('retry-failed-occurrence')
  });
}

module.exports = {
  AUTOMATION_CENTER_BRIDGE_VERSION,
  AUTOMATION_CENTER_CHANNELS,
  AUTOMATION_CENTER_COMPOSITION_VERSION,
  AUTOMATION_CENTER_DEFAULT_INTERVAL_MS,
  AUTOMATION_CENTER_MODULE_ID,
  NEXA_AUTOMATION_CENTER_DESCRIPTOR,
  NexaAutomationCenterBridgeError,
  createNexaAutomationCenterController,
  createNexaAutomationCenterIpcHandlers,
  validateAutomationCenterPublicApi
};
