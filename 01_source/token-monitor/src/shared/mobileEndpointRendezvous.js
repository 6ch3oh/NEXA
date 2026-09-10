'use strict';

const { safeRoutedHost } = require('./mobileDeviceCredentialAuthority');

const ENDPOINT_RENDEZVOUS_CONTRACT_VERSION = 'nexa.mobile.endpoint-rendezvous.v0.1';
const ENDPOINT_RENDEZVOUS_ENDPOINT = '/nexa/mobile/endpoint-rendezvous/v0.1';
const ENDPOINT_RENDEZVOUS_CONTENT_TYPE =
  'application/vnd.nexa.mobile.endpoint-rendezvous.v0.1+json';
const ENDPOINT_ADVERTISEMENT_TTL_MS = 2 * 60 * 1000;
const MAX_ENDPOINT_ADVERTISEMENT_TTL_MS = 5 * 60 * 1000;
const ENDPOINT_RENDEZVOUS_CLOCK_SKEW_MS = 30 * 1000;
const MAX_ENDPOINT_RENDEZVOUS_BYTES = 2 * 1024;
const ENDPOINT_CAPABILITIES = Object.freeze(['DIRECT', 'CAMPUS_ROUTED']);
const REQUEST_FIELDS = Object.freeze([
  'contract_version',
  'device_id',
  'requested_at_epoch_ms'
]);
const RESPONSE_FIELDS = Object.freeze([
  'contract_version',
  'device_id',
  'advertised_at_epoch_ms',
  'expires_at_epoch_ms',
  'candidate',
  'capabilities'
]);
const CANDIDATE_FIELDS = Object.freeze(['transport', 'host', 'port']);

function failure(code, message = code) {
  return { ok: false, error: { code, message } };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function safeDeviceId(value) {
  const deviceId = typeof value === 'string' ? value.trim() : '';
  if (!deviceId || deviceId.length > 256 || /[\u0000-\u001f\u007f]/.test(deviceId)) return '';
  if (['__proto__', 'prototype', 'constructor'].includes(deviceId)) return '';
  return deviceId;
}

function safeTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validateEndpointRendezvousRequest(input, { now = Date.now() } = {}) {
  if (!isPlainObject(input) || !hasExactFields(input, REQUEST_FIELDS)) {
    return failure('INVALID_RENDEZVOUS_REQUEST_SCHEMA', 'Request must contain exactly the frozen fields');
  }
  if (input.contract_version !== ENDPOINT_RENDEZVOUS_CONTRACT_VERSION) {
    return failure('UNSUPPORTED_RENDEZVOUS_CONTRACT');
  }
  const deviceId = safeDeviceId(input.device_id);
  if (!deviceId) return failure('INVALID_RENDEZVOUS_DEVICE_ID');
  const requestedAt = safeTimestamp(input.requested_at_epoch_ms);
  if (requestedAt === null || Math.abs(requestedAt - now) > ENDPOINT_RENDEZVOUS_CLOCK_SKEW_MS) {
    return failure('STALE_RENDEZVOUS_REQUEST');
  }
  return {
    ok: true,
    value: {
      contract_version: ENDPOINT_RENDEZVOUS_CONTRACT_VERSION,
      device_id: deviceId,
      requested_at_epoch_ms: requestedAt
    }
  };
}

function normalizeCandidate(input) {
  if (!isPlainObject(input) || !hasExactFields(input, CANDIDATE_FIELDS) || input.transport !== 'HTTPS') {
    return null;
  }
  const routed = safeRoutedHost(input.host);
  const port = Number(input.port);
  if (!routed || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { transport: 'HTTPS', host: routed.host, port };
}

function validateEndpointAdvertisement(input, { now = Date.now() } = {}) {
  if (!isPlainObject(input) || !hasExactFields(input, RESPONSE_FIELDS)) {
    return failure('INVALID_ENDPOINT_ADVERTISEMENT_SCHEMA');
  }
  if (input.contract_version !== ENDPOINT_RENDEZVOUS_CONTRACT_VERSION) {
    return failure('UNSUPPORTED_RENDEZVOUS_CONTRACT');
  }
  const deviceId = safeDeviceId(input.device_id);
  const advertisedAt = safeTimestamp(input.advertised_at_epoch_ms);
  const expiresAt = safeTimestamp(input.expires_at_epoch_ms);
  const candidate = normalizeCandidate(input.candidate);
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  if (!deviceId || advertisedAt === null || expiresAt === null || !candidate ||
    capabilities.length !== ENDPOINT_CAPABILITIES.length ||
    capabilities.some((value, index) => value !== ENDPOINT_CAPABILITIES[index])) {
    return failure('INVALID_ENDPOINT_ADVERTISEMENT_SCHEMA');
  }
  if (advertisedAt > now + ENDPOINT_RENDEZVOUS_CLOCK_SKEW_MS || expiresAt <= now ||
    expiresAt <= advertisedAt || expiresAt - advertisedAt > MAX_ENDPOINT_ADVERTISEMENT_TTL_MS) {
    return failure('STALE_ENDPOINT_ADVERTISEMENT');
  }
  return {
    ok: true,
    value: {
      contract_version: ENDPOINT_RENDEZVOUS_CONTRACT_VERSION,
      device_id: deviceId,
      advertised_at_epoch_ms: advertisedAt,
      expires_at_epoch_ms: expiresAt,
      candidate,
      capabilities: [...ENDPOINT_CAPABILITIES]
    }
  };
}

function createEndpointAdvertisement({
  deviceId,
  endpoint,
  now = Date.now(),
  ttlMs = ENDPOINT_ADVERTISEMENT_TTL_MS
} = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_ENDPOINT_ADVERTISEMENT_TTL_MS) {
    throw new Error('Endpoint advertisement TTL is invalid');
  }
  const candidate = {
    contract_version: ENDPOINT_RENDEZVOUS_CONTRACT_VERSION,
    device_id: deviceId,
    advertised_at_epoch_ms: now,
    expires_at_epoch_ms: now + ttlMs,
    candidate: endpoint,
    capabilities: [...ENDPOINT_CAPABILITIES]
  };
  const validation = validateEndpointAdvertisement(candidate, { now });
  if (!validation.ok) {
    const error = new Error(validation.error.message || validation.error.code);
    error.code = validation.error.code;
    throw error;
  }
  return validation.value;
}

module.exports = {
  ENDPOINT_ADVERTISEMENT_TTL_MS,
  ENDPOINT_CAPABILITIES,
  ENDPOINT_RENDEZVOUS_CLOCK_SKEW_MS,
  ENDPOINT_RENDEZVOUS_CONTENT_TYPE,
  ENDPOINT_RENDEZVOUS_CONTRACT_VERSION,
  ENDPOINT_RENDEZVOUS_ENDPOINT,
  MAX_ENDPOINT_ADVERTISEMENT_TTL_MS,
  MAX_ENDPOINT_RENDEZVOUS_BYTES,
  createEndpointAdvertisement,
  validateEndpointAdvertisement,
  validateEndpointRendezvousRequest
};
