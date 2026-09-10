'use strict';

const { createNexaControllerBinding } = require('../shared/nexaControllerBinding');
const { createNexaModuleController } = require('../shared/nexaModuleController');
const { createNexaModuleRegistry } = require('../shared/nexaModuleRegistry');
const { createNexaShellHost } = require('../shared/nexaShellHost');
const { createNexaIpcRegistrationPlan } = require('./nexaIpcRegistration');

const MODULE_ID = 'legacy-device';
const SNAPSHOT_CHANNEL = 'nexa:legacy-device:getSnapshot';
const SOURCE_ID = 'token-monitor-legacy-cache';
const EMPTY_CONTEXT = Object.freeze({ reservedChannels: Object.freeze([]) });
const AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
});
const FRESHNESS = Object.freeze({
  FRESH: 'FRESH',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN'
});
const SAFE_SERVICE_STATUSES = new Set(['ok', 'degraded', 'outage', 'unknown']);
const SAFE_DEVICE_RUNTIMES = new Set(['electron-widget', 'headless-agent']);

const LEGACY_DEVICE_MODULE_DESCRIPTOR = Object.freeze({
  moduleId: MODULE_ID,
  contractVersion: 1,
  invokeChannels: Object.freeze([SNAPSHOT_CHANNEL]),
  pushChannels: Object.freeze([])
});

class LegacyDeviceSnapshotBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LegacyDeviceSnapshotBridgeError';
    this.code = code;
  }
}

function bridgeError(code, message) {
  return new LegacyDeviceSnapshotBridgeError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function safeVersion(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return undefined;
  return /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value) ? value : undefined;
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function freshnessFromStale(value) {
  if (value === true) return FRESHNESS.STALE;
  if (value === false) return FRESHNESS.FRESH;
  return FRESHNESS.UNKNOWN;
}

function projectDevice(source) {
  const result = { freshness: freshnessFromStale(source.stale) };
  const observedAt = safeTimestamp(source.updatedAt || source.receivedAt);
  const agentVersion = safeVersion(source.agentVersion);
  if (observedAt) result.observedAt = observedAt;
  if (agentVersion) result.agentVersion = agentVersion;
  result.runtime = SAFE_DEVICE_RUNTIMES.has(source.agentRuntime) ? source.agentRuntime : 'unknown';
  return result;
}

function projectServiceStatus(source) {
  const result = { freshness: freshnessFromStale(source.stale), services: [] };
  const observedAt = safeTimestamp(source.checkedAt || source.updatedAt);
  if (observedAt) result.observedAt = observedAt;

  const providers = Array.isArray(source.providers) ? source.providers : [];
  for (const provider of providers) {
    if (!isPlainObject(provider)) continue;
    const id = typeof provider.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(provider.id)
      ? provider.id
      : undefined;
    if (!id) continue;
    const status = SAFE_SERVICE_STATUSES.has(provider.status) ? provider.status : 'unknown';
    result.services.push({ id, status });
  }
  return result;
}

function projectHubStats(source) {
  const devices = Array.isArray(source.devices) ? source.devices : [];
  const deviceFreshness = devices.map((device) => (
    isPlainObject(device) ? freshnessFromStale(device.stale) : FRESHNESS.UNKNOWN
  ));
  let freshness = freshnessFromStale(source.stale);
  if (freshness === FRESHNESS.UNKNOWN && deviceFreshness.length > 0) {
    if (deviceFreshness.includes(FRESHNESS.STALE)) freshness = FRESHNESS.STALE;
    else if (deviceFreshness.every((value) => value === FRESHNESS.FRESH)) freshness = FRESHNESS.FRESH;
  }

  const result = {
    freshness,
    deviceCount: devices.length,
    freshDeviceCount: deviceFreshness.filter((value) => value === FRESHNESS.FRESH).length,
    staleDeviceCount: deviceFreshness.filter((value) => value === FRESHNESS.STALE).length,
    unknownDeviceCount: deviceFreshness.filter((value) => value === FRESHNESS.UNKNOWN).length
  };
  const observedAt = safeTimestamp(source.updatedAt);
  const staleAfterMs = nonNegativeInteger(source.staleAfterMs);
  if (observedAt) result.observedAt = observedAt;
  if (staleAfterMs !== undefined) result.staleAfterMs = staleAfterMs;
  return result;
}

function validateAccessor(options, key) {
  if (!Object.prototype.hasOwnProperty.call(options, key)) return null;
  if (options[key] === undefined || options[key] === null) return null;
  if (typeof options[key] !== 'function') {
    throw bridgeError('INVALID_ACCESSOR', `${key} must be a function when provided`);
  }
  return options[key];
}

function readSection(accessor, projector) {
  if (!accessor) return { availability: AVAILABILITY.NOT_INITIALIZED };
  let source;
  try {
    source = accessor();
  } catch {
    return { availability: AVAILABILITY.UNAVAILABLE };
  }
  if (source === null || source === undefined) {
    return { availability: AVAILABILITY.NOT_INITIALIZED };
  }
  if (!isPlainObject(source)) {
    return { availability: AVAILABILITY.UNKNOWN };
  }
  try {
    return { availability: AVAILABILITY.AVAILABLE, value: projector(source) };
  } catch {
    return { availability: AVAILABILITY.UNAVAILABLE };
  }
}

function createLegacyDeviceSnapshotReader(options = {}) {
  if (!isPlainObject(options)) {
    throw bridgeError('INVALID_OPTIONS', 'snapshot reader options must be a plain object');
  }
  const getDeviceSnapshot = validateAccessor(options, 'getDeviceSnapshot');
  const getHubStats = validateAccessor(options, 'getHubStats');
  const getServiceStatusSnapshot = validateAccessor(options, 'getServiceStatusSnapshot');
  const now = options.now === undefined ? Date.now : options.now;
  if (typeof now !== 'function') throw bridgeError('INVALID_CLOCK', 'now must be a function');

  function getSnapshot() {
    const capturedAt = new Date(Number(now())).toISOString();
    const device = readSection(getDeviceSnapshot, projectDevice);
    const serviceStatus = readSection(getServiceStatusSnapshot, projectServiceStatus);
    const hubStats = readSection(getHubStats, projectHubStats);
    const snapshot = {
      version: 1,
      source: SOURCE_ID,
      capturedAt,
      availability: {
        device: device.availability,
        serviceStatus: serviceStatus.availability,
        hubStats: hubStats.availability
      }
    };
    if (device.value) snapshot.device = device.value;
    if (serviceStatus.value) snapshot.serviceStatus = serviceStatus.value;
    if (hubStats.value) snapshot.hubStats = hubStats.value;
    return snapshot;
  }

  return Object.freeze({ getSnapshot });
}

function createLegacyDeviceBridgeComposition(options = {}) {
  const reader = createLegacyDeviceSnapshotReader(options);
  const registry = createNexaModuleRegistry([LEGACY_DEVICE_MODULE_DESCRIPTOR], EMPTY_CONTEXT);
  const controllerFactories = {
    [MODULE_ID]: () => createNexaModuleController({
      start() {},
      stop() {},
      getSnapshot() {
        return reader.getSnapshot();
      },
      execute() {
        throw bridgeError('UNSUPPORTED_COMMAND', 'legacy device snapshot bridge exposes no commands');
      }
    })
  };
  const binding = createNexaControllerBinding(registry, controllerFactories);
  const host = createNexaShellHost(binding);
  const registrationPlan = createNexaIpcRegistrationPlan(registry, {
    [SNAPSHOT_CHANNEL]: async () => {
      await host.startModule(MODULE_ID);
      return host.getModuleSnapshot(MODULE_ID);
    }
  });
  return Object.freeze({ host, registrationPlan });
}

module.exports = {
  AVAILABILITY,
  FRESHNESS,
  LEGACY_DEVICE_MODULE_DESCRIPTOR,
  LegacyDeviceSnapshotBridgeError,
  createLegacyDeviceBridgeComposition,
  createLegacyDeviceSnapshotReader
};
