'use strict';

const net = require('node:net');

const AWARENESS_CONTRACT_VERSION = 'nexa.device.awareness.v0.1';
const DESKTOP_SELF_STATUS_VERSION = 'nexa.desktop.self-status.v0.1';
const DESKTOP_SELF_STATUS_ENDPOINT = '/nexa/mobile/awareness/desktop-self/v0.1';
const DESKTOP_SELF_STATUS_CONTENT_TYPE = 'application/vnd.nexa.desktop-self-status.v0.1+json';
const FRESHNESS_VALUES = Object.freeze([
  'REALTIME',
  'RECENT',
  'POSSIBLY_STALE',
  'OFFLINE',
  'UNAVAILABLE'
]);
const FRESHNESS_LABELS_ZH = Object.freeze({
  REALTIME: '实时',
  RECENT: '最近更新',
  POSSIBLY_STALE: '可能已过期',
  OFFLINE: '离线',
  UNAVAILABLE: '暂不可用'
});
const MAX_STATUS_BYTES = 64 * 1024;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value, maximum = 128) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function safeEpoch(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function freshnessEnvelope({
  observedAt,
  source,
  now = Date.now(),
  realtimeMs = 30_000,
  recentMs = 120_000,
  explicitOffline = false,
  available = true
} = {}) {
  const observed = safeEpoch(observedAt);
  const normalizedSource = safeString(source, 64) || 'UNKNOWN';
  let freshness = 'UNAVAILABLE';
  let freshUntil = null;
  if (explicitOffline) freshness = 'OFFLINE';
  else if (available && observed !== null) {
    const age = Math.max(0, now - observed);
    freshUntil = observed + recentMs;
    freshness = age <= realtimeMs ? 'REALTIME' : age <= recentMs ? 'RECENT' : 'POSSIBLY_STALE';
  }
  return Object.freeze({
    observed_at: observed,
    source: normalizedSource,
    fresh_until: freshUntil,
    freshness,
    stale: freshness === 'POSSIBLY_STALE'
  });
}

function exactFields(value, expected) {
  return isPlainObject(value) && Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key));
}

function validateDesktopSelfStatusRequest(input) {
  if (!exactFields(input, ['contract_version', 'device_id', 'requested_at_epoch_ms'])) {
    return { ok: false, error: 'INVALID_AWARENESS_REQUEST' };
  }
  const deviceId = safeString(input.device_id, 256);
  const requestedAt = safeEpoch(input.requested_at_epoch_ms);
  if (input.contract_version !== AWARENESS_CONTRACT_VERSION || !deviceId || requestedAt === null) {
    return { ok: false, error: 'INVALID_AWARENESS_REQUEST' };
  }
  return {
    ok: true,
    value: {
      contract_version: AWARENESS_CONTRACT_VERSION,
      device_id: deviceId,
      requested_at_epoch_ms: requestedAt
    }
  };
}

function metricAvailability(metric) {
  const availability = safeString(metric?.availability, 32)?.toLowerCase();
  return ['available', 'partial', 'unavailable', 'unsupported', 'unknown'].includes(availability)
    ? availability
    : metric === undefined || metric === null ? 'unavailable' : 'available';
}

function boundedPercent(...values) {
  for (const raw of values) {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return Math.round(value * 10) / 10;
  }
  return null;
}

function metricFreshness(metric) {
  const value = safeString(metric?.freshness || metric?.current?.freshness, 32)?.toUpperCase();
  return FRESHNESS_VALUES.includes(value) ? value : 'UNAVAILABLE';
}

function safeDeviceCenterProjection(overview) {
  const value = isPlainObject(overview) ? overview : {};
  const cpu = value.cpu || value.cpu_usage || {};
  const ram = value.memory || value.ram || value.memory_usage || {};
  const network = value.network || {};
  const overviewNetworkAvailability = safeString(value.network_availability, 32)?.toLowerCase();
  const health = value.device_health || {};
  const severity = safeString(health.severity || health.status, 32)?.toLowerCase();
  const connectivity = safeString(network.connectivity || network.status, 32)?.toLowerCase() ||
    (overviewNetworkAvailability === 'available' ? 'online' :
      overviewNetworkAvailability === 'unavailable' ? 'offline' : 'unknown');
  const interfaceState = safeString(
    network.coarse_interface_state || network.interface_state || network.availability || overviewNetworkAvailability,
    32
  )?.toLowerCase();
  return Object.freeze({
    device_health: Object.freeze({
      availability: metricAvailability(health),
      severity: ['normal', 'warning', 'critical', 'unknown'].includes(severity) ? severity : 'unknown'
    }),
    cpu: Object.freeze({
      availability: metricAvailability(cpu),
      load_percent: boundedPercent(cpu.load, cpu.load_percent, cpu.usage, cpu.usage_percent, cpu.value, cpu.current?.value),
      freshness: metricFreshness(cpu)
    }),
    ram: Object.freeze({
      availability: metricAvailability(ram),
      usage_percent: boundedPercent(ram.usage, ram.usage_percent, ram.value, ram.current?.value),
      freshness: metricFreshness(ram)
    }),
    network: Object.freeze({
      availability: overviewNetworkAvailability || metricAvailability(network),
      connectivity: ['online', 'offline', 'limited', 'unknown'].includes(connectivity) ? connectivity : 'unknown',
      coarse_interface_state: ['available', 'partial', 'unavailable', 'unknown'].includes(interfaceState)
        ? interfaceState
        : 'unknown',
      freshness: metricFreshness(network)
    })
  });
}

function desktopIdentity({ coreDeviceId, certificateFingerprint, displayName } = {}) {
  const configured = safeString(coreDeviceId, 256);
  const fingerprint = typeof certificateFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(certificateFingerprint)
    ? certificateFingerprint.toLowerCase()
    : '';
  const configuredIsIp = configured ? net.isIP(configured.replace(/^\[|\]$/g, '')) > 0 : false;
  const deviceId = configured && !configuredIsIp
    ? configured
    : fingerprint ? `desktop-${fingerprint.slice(0, 32)}` : null;
  if (!deviceId) throw new Error('Stable Desktop identity is unavailable');
  return Object.freeze({
    device_id: deviceId,
    display_name: safeString(displayName, 128) || 'NEXA Desktop',
    identity_source: configured && !configuredIsIp ? 'CORE_DEVICE_ID' : 'TLS_CERTIFICATE_IDENTITY'
  });
}

function ddnsProjection(state, now) {
  const value = isPlainObject(state) ? state : {};
  const observedAt = safeEpoch(value.observed_at_epoch_ms);
  const stateName = safeString(value.state, 32)?.toUpperCase() || 'DORMANT';
  const productState = ['UPDATED', 'UNCHANGED'].includes(stateName)
    ? 'NORMAL'
    : stateName === 'UPDATING' ? 'UPDATING'
      : stateName === 'FAILED_SOFT' ? 'POSSIBLY_STALE' : 'UNAVAILABLE';
  const envelope = freshnessEnvelope({
    observedAt,
    source: 'DESKTOP_DDNS',
    now,
    realtimeMs: 30_000,
    recentMs: 30 * 60 * 1000,
    available: observedAt !== null
  });
  return Object.freeze({
    hostname: safeString(value.hostname, 253) || 'pc.6ch3oh.cn',
    state: productState,
    last_address: safeString(value.address, 64),
    observed_at: envelope.observed_at,
    freshness: productState === 'POSSIBLY_STALE' ? 'POSSIBLY_STALE' : envelope.freshness
  });
}

async function createDesktopSelfStatus({
  identity,
  versionName,
  ddnsState,
  trustedDevices = [],
  deviceCenterOverview = null,
  serviceReady = true,
  now = Date.now()
} = {}) {
  const safeIdentity = identity;
  if (!safeIdentity?.device_id || !safeIdentity?.display_name) throw new Error('Desktop identity is required');
  const deviceCenter = safeDeviceCenterProjection(await Promise.resolve(deviceCenterOverview));
  const envelope = freshnessEnvelope({ observedAt: now, source: 'DESKTOP_SELF_STATUS', now });
  const devices = Array.isArray(trustedDevices) ? trustedDevices : [];
  return Object.freeze({
    contract_version: AWARENESS_CONTRACT_VERSION,
    status_version: DESKTOP_SELF_STATUS_VERSION,
    ...envelope,
    identity: Object.freeze({ ...safeIdentity }),
    version: Object.freeze({ name: safeString(versionName, 64) || 'unknown' }),
    service: Object.freeze({
      readiness: serviceReady ? 'READY' : 'UNAVAILABLE',
      https: Boolean(serviceReady),
      status_sync: Boolean(serviceReady),
      business_sync: Boolean(serviceReady),
      control_plane: Boolean(serviceReady)
    }),
    ddns: ddnsProjection(ddnsState, now),
    connection: Object.freeze({
      health: devices.some((device) => device?.connection_state === 'CONNECTED') ? 'CONNECTED' :
        devices.length ? 'SEARCHING' : 'NO_TRUSTED_MOBILE',
      trusted_mobile_count: devices.length,
      connected_mobile_count: devices.filter((device) => device?.connection_state === 'CONNECTED').length
    }),
    ...deviceCenter
  });
}

module.exports = {
  AWARENESS_CONTRACT_VERSION,
  DESKTOP_SELF_STATUS_CONTENT_TYPE,
  DESKTOP_SELF_STATUS_ENDPOINT,
  DESKTOP_SELF_STATUS_VERSION,
  FRESHNESS_LABELS_ZH,
  FRESHNESS_VALUES,
  MAX_STATUS_BYTES,
  createDesktopSelfStatus,
  desktopIdentity,
  freshnessEnvelope,
  safeDeviceCenterProjection,
  validateDesktopSelfStatusRequest
};
