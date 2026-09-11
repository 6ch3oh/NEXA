'use strict';

const { createNexaModuleController } = require('../shared/nexaModuleController');

const DASHI_PUBLIC_API_VERSION = '0.1';
const DASHI_OPERATIONS = Object.freeze({
  'get-source-health': Object.freeze({
    channel: 'nexa:dashi:get-source-health', method: 'getSourceHealth', argument: 'none'
  }),
  'get-board-overview': Object.freeze({
    channel: 'nexa:dashi:get-board-overview', method: 'getBoardOverview', argument: 'none'
  }),
  'list-projects': Object.freeze({
    channel: 'nexa:dashi:list-projects', method: 'listProjects', argument: 'none'
  }),
  'get-project-detail': Object.freeze({
    channel: 'nexa:dashi:get-project-detail', method: 'getProjectDetail', argument: 'projectId'
  }),
  'list-tasks': Object.freeze({
    channel: 'nexa:dashi:list-tasks', method: 'listTasks', argument: 'options'
  }),
  'get-task-detail': Object.freeze({
    channel: 'nexa:dashi:get-task-detail', method: 'getTaskDetail', argument: 'taskId'
  }),
  'get-task-execution-context': Object.freeze({
    channel: 'nexa:dashi:get-task-execution-context', method: 'getTaskExecutionContext', argument: 'taskId'
  })
});

const NEXA_DASHI_DESCRIPTOR = Object.freeze({
  moduleId: 'dashi',
  contractVersion: 1,
  invokeChannels: Object.freeze(Object.values(DASHI_OPERATIONS).map(({ channel }) => channel)),
  pushChannels: Object.freeze([])
});

class NexaDashiReadBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaDashiReadBridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NexaDashiReadBridgeError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const SENSITIVE_KEYS = /^(?:authorization|credential|credentials|token|secret|api_?key|password|raw(?:error|providerresponse)|stack|cause)$/i;
const WINDOWS_PATH = /(?:file:\/\/\/)?[A-Za-z]:[\\/](?:[^\s"'<>|]+[\\/]?)+/g;

function sanitizeTransportValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value.replace(WINDOWS_PATH, '[LOCAL_PATH]');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) fail('UNSAFE_PUBLIC_RESULT', 'Dashi Public Read API returned a cyclic result');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeTransportValue(item, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SENSITIVE_KEYS.test(key)) result[key] = sanitizeTransportValue(item, seen);
  }
  seen.delete(value);
  return result;
}

function clonePublicResult(value) {
  try {
    return structuredClone(sanitizeTransportValue(value));
  } catch {
    fail('UNSAFE_PUBLIC_RESULT', 'Dashi Public Read API returned a non-serializable result');
  }
}

function validatePublicApi(publicApi) {
  const contract = publicApi?.DASHI_DESKTOP_ENTRY_CONTRACT;
  const methods = Object.values(DASHI_OPERATIONS).map(({ method }) => method);
  if (publicApi?.DASHI_APPLICATION_API_VERSION !== DASHI_PUBLIC_API_VERSION ||
      typeof publicApi.createDashiReadApplication !== 'function' ||
      contract?.moduleId !== 'dashi' || contract?.handoffVersion !== '0.1' ||
      contract?.applicationApiVersion !== DASHI_PUBLIC_API_VERSION ||
      contract?.facade !== 'STABLE_NEXA_READ_FACADE' || contract?.access !== 'READ_ONLY' ||
      contract?.homepageWidgetRequired !== false ||
      !Array.isArray(contract?.pushChannels) || contract.pushChannels.length !== 0 ||
      !Array.isArray(contract?.methods) || contract.methods.length !== methods.length ||
      !methods.every((method, index) => contract.methods[index] === method)) {
    fail('INVALID_PUBLIC_API', 'Dashi Desktop Entry Handoff V0.1 is required');
  }
}

function createUnavailableNexaDashiPublicApi(code = 'DASHI_PUBLIC_API_UNAVAILABLE') {
  const methods = Object.values(DASHI_OPERATIONS).map(({ method }) => method);
  return Object.freeze({
    DASHI_APPLICATION_API_VERSION: DASHI_PUBLIC_API_VERSION,
    DASHI_DESKTOP_ENTRY_CONTRACT: Object.freeze({
      moduleId: 'dashi',
      handoffVersion: '0.1',
      applicationApiVersion: DASHI_PUBLIC_API_VERSION,
      dataContractVersion: '0.1',
      authority: 'DASHI_AUTHORITATIVE_BUSINESS_MAINLINE',
      facade: 'STABLE_NEXA_READ_FACADE',
      access: 'READ_ONLY',
      lifecycle: 'LOAD_ON_MODULE_START_READ_ON_DEMAND_RELEASE_ON_MODULE_STOP',
      homepageWidgetRequired: false,
      pushChannels: Object.freeze([]),
      methods: Object.freeze(methods)
    }),
    createDashiReadApplication() {
      fail(code, 'Dashi Desktop Entry is unavailable in this public runtime');
    }
  });
}

function validateApplication(application) {
  if (application?.version !== DASHI_PUBLIC_API_VERSION) {
    fail('INVALID_APPLICATION', 'Dashi read application version is not supported');
  }
  for (const { method } of Object.values(DASHI_OPERATIONS)) {
    if (typeof application[method] !== 'function') {
      fail('INVALID_APPLICATION', 'Dashi read application surface is incomplete');
    }
  }
}

function validateCommand(command) {
  if (!isPlainObject(command) || typeof command.operation !== 'string' ||
      !Object.hasOwn(DASHI_OPERATIONS, command.operation)) {
    fail('INVALID_COMMAND', 'Dashi command must name a registered read operation');
  }
  return DASHI_OPERATIONS[command.operation];
}

function createNexaDashiReadController({ publicApi }) {
  validatePublicApi(publicApi);
  let application = null;

  return createNexaModuleController({
    start() {
      application = publicApi.createDashiReadApplication();
      validateApplication(application);
      return Object.freeze({
        hostStatus: 'ready',
        publicApiVersion: DASHI_PUBLIC_API_VERSION
      });
    },
    stop() {
      application = null;
    },
    getSnapshot() {
      return Object.freeze({
        hostStatus: application ? 'ready' : 'stopped',
        publicApiVersion: DASHI_PUBLIC_API_VERSION
      });
    },
    async execute(command) {
      if (!application) fail('APPLICATION_NOT_STARTED', 'Dashi read application is not started');
      const operation = validateCommand(command);
      let result;
      if (operation.argument === 'none') {
        result = await application[operation.method]();
      } else if (operation.argument === 'options') {
        if (command.value !== undefined && !isPlainObject(command.value)) {
          fail('INVALID_ARGUMENT', 'Dashi list options must be a plain object');
        }
        result = await application[operation.method](structuredClone(command.value || {}));
      } else {
        result = await application[operation.method](command.value);
      }
      return clonePublicResult(result);
    }
  });
}

function safeHostError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'DASHI_HOST_REQUEST_FAILED';
  return Object.freeze({
    ok: false,
    hostStatus: 'request-failed',
    error: Object.freeze({ code, message: 'Dashi host request failed' })
  });
}

function createNexaDashiReadIpcHandlers(control) {
  if (!control || typeof control.startModule !== 'function' || typeof control.executeModule !== 'function') {
    fail('INVALID_CONTROL', 'NEXA module control is required');
  }
  const handlers = {};
  for (const [operation, definition] of Object.entries(DASHI_OPERATIONS)) {
    handlers[definition.channel] = async (_event, value) => {
      try {
        await control.startModule('dashi');
        const result = await control.executeModule('dashi', { operation, value });
        return Object.freeze({ ok: true, hostStatus: 'ready', value: result });
      } catch (error) {
        return safeHostError(error);
      }
    };
  }
  return Object.freeze(handlers);
}

module.exports = {
  DASHI_PUBLIC_API_VERSION,
  NEXA_DASHI_DESCRIPTOR,
  NexaDashiReadBridgeError,
  createNexaDashiReadController,
  createNexaDashiReadIpcHandlers,
  createUnavailableNexaDashiPublicApi
};
