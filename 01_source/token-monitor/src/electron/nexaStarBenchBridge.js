'use strict';

const path = require('node:path');
const { createNexaModuleController } = require('../shared/nexaModuleController');

const STARBENCH_DESKTOP_HANDOFF_VERSION = '0.1.0';
const STARBENCH_RUNTIME_BINDING_VERSION = '0.1.0';
const STARBENCH_MODULE_ID = 'starbench';
const STARBENCH_CAPABILITIES = Object.freeze([
  'evaluation_results',
  'evaluation_history',
  'evidence',
  'request_records',
  'token_cost_observations',
  'external_identity_evidence'
]);
const STARBENCH_CHANNELS = Object.freeze({
  start: 'nexa:starbench:start',
  stop: 'nexa:starbench:stop',
  getReadiness: 'nexa:starbench:get-readiness',
  read: 'nexa:starbench:read'
});
const NEXA_STARBENCH_DESCRIPTOR = Object.freeze({
  moduleId: STARBENCH_MODULE_ID,
  contractVersion: 1,
  invokeChannels: Object.freeze(Object.values(STARBENCH_CHANNELS)),
  pushChannels: Object.freeze([])
});

class NexaStarBenchBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaStarBenchBridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NexaStarBenchBridgeError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateStarBenchPublicApi(publicApi) {
  const contract = publicApi?.STARBENCH_DESKTOP_HANDOFF_CONTRACT;
  const runtimeContract = publicApi?.STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT;
  if (publicApi?.STARBENCH_DESKTOP_HANDOFF_VERSION !== STARBENCH_DESKTOP_HANDOFF_VERSION ||
      typeof publicApi.createStarBenchDesktopApplication !== 'function' ||
      publicApi?.STARBENCH_DESKTOP_RUNTIME_READER_BINDING_VERSION !== STARBENCH_RUNTIME_BINDING_VERSION ||
      typeof publicApi.createStarBenchDesktopRuntimeReaderBindings !== 'function' ||
      contract?.contract_version !== STARBENCH_DESKTOP_HANDOFF_VERSION ||
      contract?.module_id !== '04_STARBENCH' ||
      contract?.factory_export !== 'createStarBenchDesktopApplication' ||
      contract?.navigation?.placement !== 'INDEPENDENT_MODULE_ENTRY' ||
      contract?.navigation?.label !== '星测' ||
      contract?.navigation?.homepage_widget !== false ||
      contract?.ui_host?.owner !== 'NEXA_CORE_ASSEMBLY' ||
      contract?.authority?.canonical_identity !== 'STARBENCH' ||
      contract?.authority?.external_identity_engine !== 'UNTRUSTED_EXTERNAL_EVIDENCE' ||
      contract?.authority?.officiality_inference !== 'NOT_ALLOWED' ||
      runtimeContract?.contract_version !== STARBENCH_RUNTIME_BINDING_VERSION ||
      runtimeContract?.factory_export !== 'createStarBenchDesktopRuntimeReaderBindings' ||
      runtimeContract?.ownership !== 'STARBENCH_INTERNAL_COMPOSITION' ||
      runtimeContract?.private_store_exposure !== false ||
      runtimeContract?.write_capability_exposed !== false ||
      runtimeContract?.canonical_identity_authority !== 'STARBENCH' ||
      runtimeContract?.external_identity_engine_role !== 'UNTRUSTED_EXTERNAL_EVIDENCE' ||
      runtimeContract?.officiality_inference !== 'NOT_ALLOWED' ||
      runtimeContract?.provider_calls !== false ||
      runtimeContract?.network_required !== false ||
      !Array.isArray(runtimeContract?.capabilities) ||
      runtimeContract.capabilities.length !== STARBENCH_CAPABILITIES.length ||
      !STARBENCH_CAPABILITIES.every((value, index) => runtimeContract.capabilities[index] === value) ||
      !Array.isArray(publicApi.STARBENCH_DESKTOP_CAPABILITIES) ||
      publicApi.STARBENCH_DESKTOP_CAPABILITIES.length !== STARBENCH_CAPABILITIES.length ||
      !STARBENCH_CAPABILITIES.every((value, index) => publicApi.STARBENCH_DESKTOP_CAPABILITIES[index] === value)) {
    fail('INVALID_STARBENCH_PUBLIC_API', 'StarBench Desktop Entry Handoff V0.1.0 is required');
  }
  return publicApi;
}

function validateRuntimeReaderBindings(readers) {
  if (!isPlainObject(readers) ||
      Object.keys(readers).length !== STARBENCH_CAPABILITIES.length ||
      !STARBENCH_CAPABILITIES.every((capability) => typeof readers[capability] === 'function')) {
    fail('INVALID_STARBENCH_READER_BINDINGS', 'StarBench runtime reader bindings must expose the six public ports');
  }
  return readers;
}

function validateApplication(application) {
  for (const method of ['start', 'stop', 'getReadiness', 'read']) {
    if (typeof application?.[method] !== 'function') {
      fail('INVALID_STARBENCH_APPLICATION', 'StarBench Desktop application surface is incomplete');
    }
  }
  return application;
}

function clonePublicValue(value) {
  try { return structuredClone(value); }
  catch { fail('INVALID_STARBENCH_PUBLIC_RESULT', 'StarBench returned a non-cloneable public result'); }
}

function createNexaStarBenchController({ publicApi, dataRoot, readers } = {}) {
  validateStarBenchPublicApi(publicApi);
  const injectedReaders = readers === undefined ? null : validateRuntimeReaderBindings(readers);
  if (dataRoot !== undefined && (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot) ||
      path.resolve(dataRoot) === path.parse(path.resolve(dataRoot)).root)) {
    fail('INVALID_STARBENCH_DATA_ROOT', 'StarBench dataRoot must be an absolute non-root opaque path');
  }
  let application = null;

  return createNexaModuleController({
    async start() {
      const runtimeReaders = injectedReaders || validateRuntimeReaderBindings(
        publicApi.createStarBenchDesktopRuntimeReaderBindings(dataRoot === undefined ? {} : { dataRoot })
      );
      const candidate = validateApplication(publicApi.createStarBenchDesktopApplication({ readers: runtimeReaders }));
      application = candidate;
      try {
        return clonePublicValue(await candidate.start());
      } catch {
        application = null;
        try { await candidate.stop(); } catch {}
        fail('STARBENCH_START_FAILED', 'StarBench Desktop application could not start');
      }
    },
    async stop() {
      const ownedApplication = application;
      application = null;
      if (ownedApplication) await ownedApplication.stop();
    },
    getSnapshot() {
      const readiness = application?.getReadiness?.() || {
        contract_version: STARBENCH_DESKTOP_HANDOFF_VERSION,
        lifecycle: 'stopped',
        status: 'unavailable',
        configured_capabilities: [],
        unavailable_capabilities: [...STARBENCH_CAPABILITIES],
        ui_host_ready: false
      };
      return Object.freeze({
        hostStatus: application ? 'ready' : 'stopped',
        publicApiVersion: STARBENCH_DESKTOP_HANDOFF_VERSION,
        readiness: Object.freeze({
          state: readiness.status === 'ready' ? 'READY'
            : ['partial', 'stale'].includes(readiness.status) ? 'LIMITED'
              : readiness.status === 'error' ? 'ERROR' : 'UNAVAILABLE',
          code: readiness.status === 'ready' ? 'READY' : `STARBENCH_${String(readiness.status || 'unavailable').toUpperCase()}`
        }),
        application: clonePublicValue(readiness)
      });
    },
    async execute(command) {
      if (!application) fail('APPLICATION_NOT_STARTED', 'StarBench Desktop application is not started');
      if (!isPlainObject(command) || !['get-readiness', 'read'].includes(command.operation)) {
        fail('INVALID_STARBENCH_COMMAND', 'StarBench command must name a public read operation');
      }
      if (command.operation === 'get-readiness') return clonePublicValue(application.getReadiness());
      if (!STARBENCH_CAPABILITIES.includes(command.capability)) {
        fail('CAPABILITY_NOT_PUBLIC', 'StarBench capability is not public');
      }
      if (command.query !== undefined && !isPlainObject(command.query)) {
        fail('INVALID_STARBENCH_QUERY', 'StarBench read query must be a plain object');
      }
      return clonePublicValue(await application.read(command.capability, command.query || {}));
    }
  });
}

function safeHostError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'STARBENCH_HOST_REQUEST_FAILED';
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message: 'StarBench host request failed' })
  });
}

function createNexaStarBenchIpcHandlers(control) {
  if (!control || typeof control.startModule !== 'function' || typeof control.stopModule !== 'function' ||
      typeof control.executeModule !== 'function') {
    fail('INVALID_CONTROL', 'NEXA module control is required');
  }
  return Object.freeze({
    [STARBENCH_CHANNELS.start]: async () => {
      try {
        await control.startModule(STARBENCH_MODULE_ID);
        return Object.freeze({ ok: true, value: await control.executeModule(STARBENCH_MODULE_ID, { operation: 'get-readiness' }) });
      } catch (error) { return safeHostError(error); }
    },
    [STARBENCH_CHANNELS.stop]: async () => {
      try {
        await control.stopModule(STARBENCH_MODULE_ID);
        return Object.freeze({ ok: true });
      } catch (error) { return safeHostError(error); }
    },
    [STARBENCH_CHANNELS.getReadiness]: async () => {
      try {
        await control.startModule(STARBENCH_MODULE_ID);
        return Object.freeze({ ok: true, value: await control.executeModule(STARBENCH_MODULE_ID, { operation: 'get-readiness' }) });
      } catch (error) { return safeHostError(error); }
    },
    [STARBENCH_CHANNELS.read]: async (_event, capability, query) => {
      try {
        await control.startModule(STARBENCH_MODULE_ID);
        const value = await control.executeModule(STARBENCH_MODULE_ID, { operation: 'read', capability, query });
        return Object.freeze({ ok: true, value });
      } catch (error) { return safeHostError(error); }
    }
  });
}

module.exports = {
  NEXA_STARBENCH_DESCRIPTOR,
  STARBENCH_CAPABILITIES,
  STARBENCH_CHANNELS,
  STARBENCH_DESKTOP_HANDOFF_VERSION,
  STARBENCH_RUNTIME_BINDING_VERSION,
  NexaStarBenchBridgeError,
  createNexaStarBenchController,
  createNexaStarBenchIpcHandlers,
  validateStarBenchPublicApi
};
