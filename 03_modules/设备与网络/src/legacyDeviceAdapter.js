'use strict';

const { MetricAvailability } = require('./contracts');
const { ExistingRuntimeAdapter } = require('./adapters');

const LEGACY_PROVIDER_ID = 'token-monitor';
const LEGACY_SCHEMA_VERSION = '0.1';
const CORE_BRIDGE_VERSION = 1;
const CORE_AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
});
const CORE_FRESHNESS = Object.freeze({
  FRESH: 'FRESH',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const LEGACY_DEVICE_BRIDGE_CONTRACT = deepFreeze({
  contract_version: CORE_BRIDGE_VERSION,
  mode: 'read_only',
  module_id: 'legacy-device',
  public_api: "window.tokenMonitor.nexa['legacy-device'].getSnapshot()",
  ipc: 'nexa:legacy-device:getSnapshot',
  method: 'getSnapshot',
  provider_method: 'getLegacyDeviceSnapshot',
  input: null,
  output: {
    device: 'optional token-monitor public device record',
    serviceStatus: 'optional token-monitor service status summary',
    hubStats: 'optional token-monitor aggregate hub stats'
  },
  prohibited_output: ['credentials', 'raw_errors', 'account_identity'],
  availability: Object.values(CORE_AVAILABILITY),
  freshness: Object.values(CORE_FRESHNESS),
  live_binding: 'ready'
});

const PROVIDER_PRIORITY = deepFreeze({
  cpu: { primary: 'windows-system', supplements: [], fallback: null },
  memory: { primary: 'windows-system', supplements: [], fallback: null },
  disk: { primary: 'windows-system', supplements: [], fallback: null },
  host_network_traffic: { primary: 'windows-network', supplements: [], fallback: null },
  device_runtime: { primary: LEGACY_PROVIDER_ID, supplements: [], fallback: null },
  service_status: { primary: LEGACY_PROVIDER_ID, supplements: [], fallback: null },
  hub_device: { primary: LEGACY_PROVIDER_ID, supplements: [], fallback: null },
  application_usage: { primary: LEGACY_PROVIDER_ID, supplements: [], fallback: null },
  long_term_history: { primary: LEGACY_PROVIDER_ID, supplements: [], fallback: null },
  device_health: { primary: 'nexa-device-health', supplements: ['legacy-device-evidence'], fallback: null }
});

const LEGACY_CAPABILITY_MATRIX = deepFreeze({
  cpu: 'missing',
  memory: 'missing',
  disk: 'missing',
  host_network_traffic: 'missing',
  device_runtime: 'available',
  service_status: 'optional',
  hub_device: 'available',
  application_usage: 'not_exposed',
  long_term_history: 'not_exposed',
  gpu: 'missing',
  temperature: 'missing',
  mihomo: 'missing'
});

const REASONS = Object.freeze({
  DEVICE_MISSING: 'Legacy device record is unavailable.',
  PERIOD_MISSING: 'Legacy application usage period is unavailable.',
  SERVICE_MISSING: 'Legacy service status is unavailable.',
  HUB_MISSING: 'Legacy Hub stats are unavailable.',
  PROVIDER_FAILED: 'Legacy provider observation failed safely.',
  SNAPSHOT_MALFORMED: 'Legacy bridge snapshot is malformed.',
  DEVICE_NOT_INITIALIZED: 'Legacy device runtime is not initialized.',
  SERVICE_NOT_INITIALIZED: 'Legacy service status is not initialized.',
  HUB_NOT_INITIALIZED: 'Legacy Hub stats are not initialized.',
  APPLICATION_USAGE_NOT_EXPOSED: 'Application usage is not exposed by the Core bridge.'
});

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function finiteNonNegative(value) {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function integerNonNegative(value) {
  const number = finiteNonNegative(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function isoOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

function requirePlainObject(value, path) {
  if (!objectOrNull(value)) throw new TypeError(`${path} must be a plain object.`);
  return value;
}

function requireCoreEnum(value, definition, path) {
  if (!Object.values(definition).includes(value)) throw new TypeError(`${path} is invalid.`);
  return value;
}

function requireCoreTimestamp(value, path) {
  const normalized = isoOrNull(value);
  if (!normalized) throw new TypeError(`${path} must be an ISO date-time.`);
  return normalized;
}

function optionalCoreTimestamp(value, path) {
  if (value === undefined) return undefined;
  return requireCoreTimestamp(value, path);
}

function sanitizeCoreDevice(value) {
  requirePlainObject(value, 'legacyBridge.device');
  requireCoreEnum(value.freshness, CORE_FRESHNESS, 'legacyBridge.device.freshness');
  if (!['electron-widget', 'headless-agent', 'unknown'].includes(value.runtime)) {
    throw new TypeError('legacyBridge.device.runtime is invalid.');
  }
  const result = { freshness: value.freshness, runtime: value.runtime };
  const observedAt = optionalCoreTimestamp(value.observedAt, 'legacyBridge.device.observedAt');
  if (observedAt) result.observedAt = observedAt;
  if (value.agentVersion !== undefined) {
    if (typeof value.agentVersion !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(value.agentVersion)) {
      throw new TypeError('legacyBridge.device.agentVersion is invalid.');
    }
    result.agentVersion = value.agentVersion;
  }
  return result;
}

function sanitizeCoreServiceStatus(value) {
  requirePlainObject(value, 'legacyBridge.serviceStatus');
  requireCoreEnum(value.freshness, CORE_FRESHNESS, 'legacyBridge.serviceStatus.freshness');
  if (!Array.isArray(value.services)) throw new TypeError('legacyBridge.serviceStatus.services must be an array.');
  const services = value.services.map((service, index) => {
    requirePlainObject(service, `legacyBridge.serviceStatus.services[${index}]`);
    if (typeof service.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(service.id)) {
      throw new TypeError(`legacyBridge.serviceStatus.services[${index}].id is invalid.`);
    }
    if (!['ok', 'degraded', 'outage', 'unknown'].includes(service.status)) {
      throw new TypeError(`legacyBridge.serviceStatus.services[${index}].status is invalid.`);
    }
    return { id: service.id, status: service.status };
  });
  const result = { freshness: value.freshness, services };
  const observedAt = optionalCoreTimestamp(value.observedAt, 'legacyBridge.serviceStatus.observedAt');
  if (observedAt) result.observedAt = observedAt;
  return result;
}

function sanitizeCoreHubStats(value) {
  requirePlainObject(value, 'legacyBridge.hubStats');
  requireCoreEnum(value.freshness, CORE_FRESHNESS, 'legacyBridge.hubStats.freshness');
  const fields = ['deviceCount', 'freshDeviceCount', 'staleDeviceCount', 'unknownDeviceCount'];
  const counts = Object.fromEntries(fields.map((field) => {
    const count = integerNonNegative(value[field]);
    if (count === null) throw new TypeError(`legacyBridge.hubStats.${field} is invalid.`);
    return [field, count];
  }));
  if (counts.freshDeviceCount + counts.staleDeviceCount + counts.unknownDeviceCount !== counts.deviceCount) {
    throw new TypeError('legacyBridge.hubStats device counts are inconsistent.');
  }
  const result = { freshness: value.freshness, ...counts };
  const observedAt = optionalCoreTimestamp(value.observedAt, 'legacyBridge.hubStats.observedAt');
  if (observedAt) result.observedAt = observedAt;
  if (value.staleAfterMs !== undefined) {
    const staleAfterMs = integerNonNegative(value.staleAfterMs);
    if (staleAfterMs === null) throw new TypeError('legacyBridge.hubStats.staleAfterMs is invalid.');
    result.staleAfterMs = staleAfterMs;
  }
  return result;
}

function validateCoreLegacyDeviceSnapshot(value) {
  const source = requirePlainObject(value, 'legacyBridge');
  if (source.version !== CORE_BRIDGE_VERSION) throw new TypeError('legacyBridge.version must be 1.');
  if (typeof source.source !== 'string' || source.source.trim() === '' || source.source.length > 128) {
    throw new TypeError('legacyBridge.source is invalid.');
  }
  const capturedAt = requireCoreTimestamp(source.capturedAt, 'legacyBridge.capturedAt');
  const availabilitySource = requirePlainObject(source.availability, 'legacyBridge.availability');
  const availability = {};
  const result = { version: source.version, source: source.source, capturedAt, availability };
  const sections = [
    ['device', sanitizeCoreDevice],
    ['serviceStatus', sanitizeCoreServiceStatus],
    ['hubStats', sanitizeCoreHubStats]
  ];
  for (const [key, sanitize] of sections) {
    const state = requireCoreEnum(availabilitySource[key], CORE_AVAILABILITY, `legacyBridge.availability.${key}`);
    availability[key] = state;
    if (state === CORE_AVAILABILITY.AVAILABLE) {
      if (!Object.hasOwn(source, key)) throw new TypeError(`legacyBridge.${key} is required when available.`);
      result[key] = sanitize(source[key]);
    } else if (Object.hasOwn(source, key)) {
      throw new TypeError(`legacyBridge.${key} must be absent when unavailable.`);
    }
  }
  return result;
}

function isCoreBridgeCandidate(value) {
  const source = objectOrNull(value);
  return Boolean(source) && ['version', 'source', 'capturedAt', 'availability'].some((key) => Object.hasOwn(source, key));
}

function mapCoreFreshness(value) {
  if (value === CORE_FRESHNESS.FRESH) return 'fresh';
  if (value === CORE_FRESHNESS.STALE) return 'stale';
  return 'unknown';
}

function reasonForCoreAvailability(section, state) {
  if (state === CORE_AVAILABILITY.NOT_INITIALIZED) {
    return {
      device: REASONS.DEVICE_NOT_INITIALIZED,
      serviceStatus: REASONS.SERVICE_NOT_INITIALIZED,
      hubStats: REASONS.HUB_NOT_INITIALIZED
    }[section];
  }
  if (state === CORE_AVAILABILITY.UNKNOWN) return `Legacy ${section} availability is unknown.`;
  return `Legacy ${section} is unavailable.`;
}

function normalizeObservedAt(value) {
  const normalized = value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString()
    : isoOrNull(value);
  if (!normalized) throw new TypeError('Legacy observation time must be a valid date-time.');
  return normalized;
}

function unavailableRuntime(reason) {
  return {
    availability: MetricAvailability.UNAVAILABLE,
    agent_runtime: null,
    updated_at: null,
    received_at: null,
    stale: null,
    reason
  };
}

function normalizeRuntime(device) {
  if (!device) return unavailableRuntime(REASONS.DEVICE_MISSING);
  const updatedAt = isoOrNull(device.updatedAt);
  const receivedAt = isoOrNull(device.receivedAt);
  const knownRuntime = ['electron-widget', 'headless-agent'].includes(device.agentRuntime)
    ? device.agentRuntime
    : 'unknown';
  if (!updatedAt && !receivedAt && !device.agentRuntime && typeof device.stale !== 'boolean') {
    return unavailableRuntime(REASONS.DEVICE_MISSING);
  }
  return {
    availability: MetricAvailability.AVAILABLE,
    agent_runtime: knownRuntime,
    updated_at: updatedAt,
    received_at: receivedAt,
    stale: typeof device.stale === 'boolean' ? device.stale : null,
    reason: null
  };
}

function selectPeriod(device, periodName) {
  const periods = objectOrNull(device?.periods);
  return objectOrNull(periods?.[periodName]) || objectOrNull(device?.[periodName]);
}

function countModels(clientModels) {
  const clients = objectOrNull(clientModels);
  if (!clients) return 0;
  return Object.values(clients).reduce((total, models) => {
    const normalized = objectOrNull(models);
    return total + (normalized ? Object.keys(normalized).length : 0);
  }, 0);
}

function historyEntryCount(history) {
  const normalized = objectOrNull(history);
  if (!normalized) return 0;
  return Object.values(normalized).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0);
}

function unavailableUsage(periodName, reason) {
  return {
    availability: MetricAvailability.UNAVAILABLE,
    period: periodName,
    total_tokens: null,
    tracked_client_count: null,
    model_count: null,
    history_entry_count: null,
    reason
  };
}

function normalizeApplicationUsage(device, periodName) {
  const period = selectPeriod(device, periodName);
  if (!period) return unavailableUsage(periodName, REASONS.PERIOD_MISSING);
  const totalTokens = finiteNonNegative(period.totalTokens);
  if (totalTokens === null) return unavailableUsage(periodName, REASONS.PERIOD_MISSING);
  const clients = objectOrNull(period.clients);
  return {
    availability: MetricAvailability.AVAILABLE,
    period: periodName,
    total_tokens: totalTokens,
    tracked_client_count: clients ? Object.keys(clients).length : 0,
    model_count: countModels(period.clientModels),
    history_entry_count: historyEntryCount(device?.history),
    reason: null
  };
}

function serviceHealth(statuses) {
  if (statuses.includes('outage')) return 'critical';
  if (statuses.includes('degraded')) return 'warning';
  if (statuses.length > 0 && statuses.every((status) => status === 'ok')) return 'healthy';
  return 'unknown';
}

function normalizeServiceStatus(serviceStatus) {
  const source = objectOrNull(serviceStatus);
  const providers = Array.isArray(source?.providers)
    ? source.providers.map(objectOrNull).filter(Boolean)
    : null;
  if (!providers) {
    return {
      availability: MetricAvailability.UNAVAILABLE,
      health_hint: 'unknown',
      provider_count: null,
      affected_component_count: null,
      incident_count: null,
      maintenance_count: null,
      checked_at: null,
      reason: REASONS.SERVICE_MISSING
    };
  }
  const statuses = providers.map((provider) => ['ok', 'degraded', 'outage'].includes(provider.status)
    ? provider.status
    : 'unknown');
  const sum = (field) => providers.reduce((total, provider) => total + (integerNonNegative(provider[field]) || 0), 0);
  const affectedCount = providers.reduce((total, provider) => total
    + (Array.isArray(provider.componentIssues) ? provider.componentIssues.length : 0), 0);
  return {
    availability: MetricAvailability.AVAILABLE,
    health_hint: serviceHealth(statuses),
    provider_count: providers.length,
    affected_component_count: affectedCount,
    incident_count: sum('incidentCount'),
    maintenance_count: sum('maintenanceCount'),
    checked_at: isoOrNull(source.checkedAt) || isoOrNull(providers[0]?.checkedAt),
    reason: null
  };
}

function unavailableCoreRuntime(reason) {
  return {
    ...unavailableRuntime(reason),
    agent_version: null,
    freshness: 'unknown'
  };
}

function normalizeCoreRuntime(snapshot) {
  const state = snapshot.availability.device;
  if (state !== CORE_AVAILABILITY.AVAILABLE) {
    return unavailableCoreRuntime(reasonForCoreAvailability('device', state));
  }
  const freshness = mapCoreFreshness(snapshot.device.freshness);
  return {
    availability: MetricAvailability.AVAILABLE,
    agent_runtime: snapshot.device.runtime,
    agent_version: snapshot.device.agentVersion || null,
    updated_at: snapshot.device.observedAt || null,
    received_at: null,
    stale: freshness === 'stale' ? true : freshness === 'fresh' ? false : null,
    freshness,
    reason: null
  };
}

function unavailableCoreService(reason) {
  return {
    availability: MetricAvailability.UNAVAILABLE,
    health_hint: 'unknown',
    provider_count: null,
    affected_component_count: null,
    incident_count: null,
    maintenance_count: null,
    checked_at: null,
    freshness: 'unknown',
    reason
  };
}

function normalizeCoreService(snapshot) {
  const state = snapshot.availability.serviceStatus;
  if (state !== CORE_AVAILABILITY.AVAILABLE) {
    return unavailableCoreService(reasonForCoreAvailability('serviceStatus', state));
  }
  const statuses = snapshot.serviceStatus.services.map((service) => service.status);
  return {
    availability: MetricAvailability.AVAILABLE,
    health_hint: serviceHealth(statuses),
    provider_count: snapshot.serviceStatus.services.length,
    affected_component_count: null,
    incident_count: null,
    maintenance_count: null,
    checked_at: snapshot.serviceStatus.observedAt || null,
    freshness: mapCoreFreshness(snapshot.serviceStatus.freshness),
    reason: null
  };
}

function unavailableCoreHub(reason) {
  return {
    availability: MetricAvailability.UNAVAILABLE,
    device_count: null,
    fresh_device_count: null,
    stale_device_count: null,
    unknown_device_count: null,
    observed_at: null,
    stale_after_ms: null,
    freshness: 'unknown',
    reason
  };
}

function normalizeCoreHub(snapshot) {
  const state = snapshot.availability.hubStats;
  if (state !== CORE_AVAILABILITY.AVAILABLE) {
    return unavailableCoreHub(reasonForCoreAvailability('hubStats', state));
  }
  return {
    availability: MetricAvailability.AVAILABLE,
    device_count: snapshot.hubStats.deviceCount,
    fresh_device_count: snapshot.hubStats.freshDeviceCount,
    stale_device_count: snapshot.hubStats.staleDeviceCount,
    unknown_device_count: snapshot.hubStats.unknownDeviceCount,
    observed_at: snapshot.hubStats.observedAt || null,
    stale_after_ms: snapshot.hubStats.staleAfterMs ?? null,
    freshness: mapCoreFreshness(snapshot.hubStats.freshness),
    reason: null
  };
}

function normalizeCoreLegacyDeviceEvidence(raw, options = {}) {
  const snapshot = validateCoreLegacyDeviceSnapshot(raw);
  const period = ['today', 'month', 'allTime'].includes(options.period) ? options.period : 'today';
  const runtime = normalizeCoreRuntime(snapshot);
  const applicationUsage = unavailableUsage(period, REASONS.APPLICATION_USAGE_NOT_EXPOSED);
  const serviceStatus = normalizeCoreService(snapshot);
  const hub = normalizeCoreHub(snapshot);
  return {
    schema_version: LEGACY_SCHEMA_VERSION,
    evidence_type: 'legacy_device',
    provider: { id: LEGACY_PROVIDER_ID, kind: 'legacy_bridge' },
    observed_at: snapshot.capturedAt,
    availability: [runtime, serviceStatus, hub].some((block) => block.availability === MetricAvailability.AVAILABLE)
      ? MetricAvailability.AVAILABLE
      : MetricAvailability.UNAVAILABLE,
    bridge: {
      version: snapshot.version,
      source: snapshot.source,
      captured_at: snapshot.capturedAt
    },
    runtime,
    application_usage: applicationUsage,
    service_status: serviceStatus,
    hub,
    capabilities: { ...LEGACY_CAPABILITY_MATRIX }
  };
}

function normalizeHubStats(hubStats) {
  const source = objectOrNull(hubStats);
  if (!Array.isArray(source?.devices)) {
    return {
      availability: MetricAvailability.UNAVAILABLE,
      device_count: null,
      stale_device_count: null,
      observed_at: null,
      reason: REASONS.HUB_MISSING
    };
  }
  return {
    availability: MetricAvailability.AVAILABLE,
    device_count: source.devices.length,
    stale_device_count: source.devices.filter((device) => objectOrNull(device)?.stale === true).length,
    observed_at: isoOrNull(source.updatedAt),
    reason: null
  };
}

function normalizeLegacyDeviceEvidence(raw, options = {}) {
  const source = objectOrNull(raw) || {};
  const observedAt = normalizeObservedAt(options.observedAt || new Date().toISOString());
  const period = ['today', 'month', 'allTime'].includes(options.period) ? options.period : 'today';
  if (isCoreBridgeCandidate(source)) {
    try {
      return normalizeCoreLegacyDeviceEvidence(source, { period });
    } catch {
      return failedLegacyDeviceEvidence(observedAt, period, REASONS.SNAPSHOT_MALFORMED);
    }
  }
  const device = objectOrNull(source.device);
  const runtime = normalizeRuntime(device);
  const applicationUsage = normalizeApplicationUsage(device, period);
  const serviceStatus = normalizeServiceStatus(source.serviceStatus);
  const hub = normalizeHubStats(source.hubStats);
  const blocks = [runtime, applicationUsage, serviceStatus, hub];
  return {
    schema_version: LEGACY_SCHEMA_VERSION,
    evidence_type: 'legacy_device',
    provider: { id: LEGACY_PROVIDER_ID, kind: 'legacy_bridge' },
    observed_at: observedAt,
    availability: blocks.some((block) => block.availability === MetricAvailability.AVAILABLE)
      ? MetricAvailability.AVAILABLE
      : MetricAvailability.UNAVAILABLE,
    bridge: null,
    runtime,
    application_usage: applicationUsage,
    service_status: serviceStatus,
    hub,
    capabilities: { ...LEGACY_CAPABILITY_MATRIX }
  };
}

function failedLegacyDeviceEvidence(observedAt, period = 'today', reason = REASONS.PROVIDER_FAILED) {
  const evidence = normalizeLegacyDeviceEvidence({}, { observedAt, period });
  return {
    ...evidence,
    runtime: unavailableRuntime(reason),
    application_usage: unavailableUsage(period, reason),
    service_status: { ...evidence.service_status, reason },
    hub: { ...evidence.hub, reason }
  };
}

function validateLegacyDeviceEvidence(value) {
  const evidence = requirePlainObject(value, 'legacyEvidence');
  const rejectUnknown = (object, allowed, path) => {
    const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) throw new TypeError(`${path} contains unknown fields.`);
  };
  rejectUnknown(evidence, [
    'schema_version', 'evidence_type', 'provider', 'observed_at', 'availability', 'bridge',
    'runtime', 'application_usage', 'service_status', 'hub', 'capabilities'
  ], 'legacyEvidence');
  if (evidence.schema_version !== LEGACY_SCHEMA_VERSION) throw new TypeError('legacyEvidence.schema_version must be 0.1.');
  if (evidence.evidence_type !== 'legacy_device') throw new TypeError('legacyEvidence.evidence_type is invalid.');
  requireCoreTimestamp(evidence.observed_at, 'legacyEvidence.observed_at');
  if (!Object.values(MetricAvailability).includes(evidence.availability)) {
    throw new TypeError('legacyEvidence.availability is invalid.');
  }
  for (const key of ['runtime', 'application_usage', 'service_status', 'hub']) {
    requirePlainObject(evidence[key], `legacyEvidence.${key}`);
    if (!Object.values(MetricAvailability).includes(evidence[key].availability)) {
      throw new TypeError(`legacyEvidence.${key}.availability is invalid.`);
    }
  }
  rejectUnknown(evidence.runtime, [
    'availability', 'agent_runtime', 'agent_version', 'updated_at', 'received_at', 'stale', 'freshness', 'reason'
  ], 'legacyEvidence.runtime');
  rejectUnknown(evidence.application_usage, [
    'availability', 'period', 'total_tokens', 'tracked_client_count', 'model_count', 'history_entry_count', 'reason'
  ], 'legacyEvidence.application_usage');
  rejectUnknown(evidence.service_status, [
    'availability', 'health_hint', 'provider_count', 'affected_component_count', 'incident_count',
    'maintenance_count', 'checked_at', 'freshness', 'reason'
  ], 'legacyEvidence.service_status');
  rejectUnknown(evidence.hub, [
    'availability', 'device_count', 'fresh_device_count', 'stale_device_count', 'unknown_device_count',
    'observed_at', 'stale_after_ms', 'freshness', 'reason'
  ], 'legacyEvidence.hub');
  requirePlainObject(evidence.provider, 'legacyEvidence.provider');
  rejectUnknown(evidence.provider, ['id', 'kind'], 'legacyEvidence.provider');
  if (evidence.provider.id !== LEGACY_PROVIDER_ID || evidence.provider.kind !== 'legacy_bridge') {
    throw new TypeError('legacyEvidence.provider is invalid.');
  }
  if (evidence.bridge !== null) {
    requirePlainObject(evidence.bridge, 'legacyEvidence.bridge');
    rejectUnknown(evidence.bridge, ['version', 'source', 'captured_at'], 'legacyEvidence.bridge');
    if (evidence.bridge.version !== CORE_BRIDGE_VERSION) throw new TypeError('legacyEvidence.bridge.version is invalid.');
    if (typeof evidence.bridge.source !== 'string' || evidence.bridge.source.trim() === '') {
      throw new TypeError('legacyEvidence.bridge.source is invalid.');
    }
    requireCoreTimestamp(evidence.bridge.captured_at, 'legacyEvidence.bridge.captured_at');
  }
  return evidence;
}

function providerPriorityFor(capability) {
  const value = PROVIDER_PRIORITY[capability];
  if (!value) return null;
  return {
    primary: value.primary,
    supplements: [...value.supplements],
    fallback: value.fallback
  };
}

class LegacyDeviceAdapter extends ExistingRuntimeAdapter {
  constructor(provider, options = {}) {
    super();
    if (!provider || typeof provider.getLegacyDeviceSnapshot !== 'function') {
      throw new TypeError('LegacyDeviceAdapter requires getLegacyDeviceSnapshot().');
    }
    this.provider = provider;
    this.now = options.now || (() => new Date());
    this.period = options.period || 'today';
  }

  async observeRuntime() {
    const observedAt = normalizeObservedAt(this.now());
    try {
      const raw = await this.provider.getLegacyDeviceSnapshot();
      return normalizeLegacyDeviceEvidence(raw, { observedAt, period: this.period });
    } catch {
      return failedLegacyDeviceEvidence(observedAt, this.period);
    }
  }
}

module.exports = {
  CORE_AVAILABILITY,
  CORE_BRIDGE_VERSION,
  CORE_FRESHNESS,
  LEGACY_CAPABILITY_MATRIX,
  LEGACY_DEVICE_BRIDGE_CONTRACT,
  LEGACY_PROVIDER_ID,
  LegacyDeviceAdapter,
  PROVIDER_PRIORITY,
  failedLegacyDeviceEvidence,
  normalizeCoreLegacyDeviceEvidence,
  normalizeLegacyDeviceEvidence,
  providerPriorityFor,
  validateCoreLegacyDeviceSnapshot,
  validateLegacyDeviceEvidence
};
