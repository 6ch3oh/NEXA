'use strict';

const CONTROL_CONTRACT_VERSION = 'nexa.device.control.v0.1';
const CONTROL_EXCHANGE_ENDPOINT = '/nexa/mobile/control/exchange';
const CONTROL_CONTENT_TYPE = 'application/json; charset=utf-8';
const MAX_CONTROL_REQUEST_LIFETIME_MS = 60_000;
const MAX_CONTROL_CLOCK_SKEW_MS = 30_000;
const MAX_CONTROL_RESULT_BYTES = 192 * 1024;
const MAX_CONTROL_EXCHANGE_BYTES = 256 * 1024;
const MAX_CONTROL_IDENTIFIER_LENGTH = 128;
const MAX_CONTROL_DEVICE_ID_LENGTH = 256;
const MAX_CONTROL_DEPTH = 8;
const MAX_CONTROL_COLLECTION_ITEMS = 128;

const CONTROL_CAPABILITIES = Object.freeze({
  GET_DEVICE_STATUS: 'SAFE_READ',
  GET_NETWORK_STATUS: 'SAFE_READ',
  GET_SYNC_STATUS: 'SAFE_READ',
  GET_CAPTURE_STATUS: 'SAFE_READ',
  REQUEST_RECONNECT: 'SAFE_APP_ACTION',
  REQUEST_TRANSPORT_REEVALUATION: 'SAFE_APP_ACTION',
  REQUEST_SYNC_NOW: 'SAFE_APP_ACTION',
  REQUEST_CAPTURE_SERVICE_REFRESH: 'SAFE_APP_ACTION',
  GET_DIAGNOSTIC_SUMMARY: 'SAFE_READ',
  CREATE_DIAGNOSTIC_BUNDLE: 'SAFE_APP_ACTION',
  FETCH_DIAGNOSTIC_BUNDLE: 'SAFE_READ'
});

const CONTROL_RESPONSE_STATUSES = Object.freeze([
  'SUCCEEDED',
  'REJECTED',
  'USER_ACTION_REQUIRED',
  'FAILED'
]);

const TRUSTED_DEVICE_CONNECTION_STATES = Object.freeze([
  'PAIRED', 'OFFLINE', 'DISCOVERING', 'CONNECTING', 'AUTHENTICATING',
  'CONNECTED', 'RECONNECTING', 'REVOKED', 'BACKGROUND_RESTRICTED'
]);

const RESULT_SCHEMAS = Object.freeze({
  GET_DEVICE_STATUS: Object.freeze({
    device_id: 'identifier', application_id: 'identifier', version_name: 'string', version_code: 'integer',
    paired_state: ['PAIRED', 'NEEDS_PAIRING'], trusted_peer_state: ['TRUSTED', 'NOT_TRUSTED'],
    connection_state: ['NEEDS_PAIRING', ...TRUSTED_DEVICE_CONNECTION_STATES, 'SEARCHING'],
    active_transport: ['DIRECT_WIFI', 'REVERSE_LAN', 'CAMPUS_ROUTED', 'SECURE_RELAY', 'SYSTEM_DEFAULT', 'NONE'],
    last_seen_epoch_ms: 'nullable_integer', runtime_state: ['READY', 'DEGRADED', 'USER_ACTION_REQUIRED'],
    supported_capabilities: 'capability_array'
  }),
  GET_NETWORK_STATUS: Object.freeze({
    wifi_available: 'boolean', hotspot_available: 'boolean', physical_lan_available: 'boolean',
    vpn_active: 'boolean', default_route_uses_vpn: 'boolean',
    nexa_network: ['PHYSICAL_WIFI', 'SYSTEM_DEFAULT', 'REVERSE_LAN', 'CAMPUS_ROUTED', 'SECURE_RELAY', 'NONE'],
    route_policy: ['AUTO', 'LOCAL_DIRECT', 'FOLLOW_SYSTEM'],
    active_transport: ['DIRECT_WIFI', 'REVERSE_LAN', 'CAMPUS_ROUTED', 'SECURE_RELAY', 'SYSTEM_DEFAULT', 'NONE'],
    direct_state: ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'],
    reverse_state: ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'],
    campus_routed_state: ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'],
    relay_state: ['CONNECTED', 'AVAILABLE', 'NOT_CONFIGURED', 'UNAVAILABLE', 'UNKNOWN'],
    endpoint_candidate_count: 'integer', endpoint_candidate_families: 'endpoint_family_array'
  }),
  GET_SYNC_STATUS: Object.freeze({
    state: ['READY', 'WAITING', 'RUNNING', 'RETRY', 'TERMINAL'], pending_count: 'integer',
    running_count: 'integer', retry_pending_count: 'integer', terminal_failure_count: 'integer',
    last_success_epoch_ms: 'nullable_integer', last_failure_reason: 'nullable_reason'
  }),
  GET_CAPTURE_STATUS: Object.freeze({
    listener_health: ['CHECKING', 'CONNECTED', 'DISCONNECTED'], capture_enabled: 'boolean',
    permission_granted: 'boolean', source_count: 'integer', pending_count: 'integer',
    user_action_required: 'boolean'
  }),
  REQUEST_RECONNECT: Object.freeze({
    requested: 'boolean', connection_state: ['DISCOVERING', 'CONNECTING', 'AUTHENTICATING', 'RECONNECTING', 'CONNECTED', 'OFFLINE']
  }),
  REQUEST_TRANSPORT_REEVALUATION: Object.freeze({
    requested: 'boolean', evaluation_state: ['SCHEDULED', 'RUNNING']
  }),
  REQUEST_SYNC_NOW: Object.freeze({
    requested: 'boolean', sync_state: ['SCHEDULED', 'RUNNING', 'WAITING', 'TERMINAL']
  }),
  REQUEST_CAPTURE_SERVICE_REFRESH: Object.freeze({
    requested: 'boolean', listener_health: ['CHECKING', 'CONNECTED', 'DISCONNECTED']
  }),
  GET_DIAGNOSTIC_SUMMARY: Object.freeze({
    generated_at_epoch_ms: 'integer', app_build: 'string', pairing_state: ['PAIRED', 'NEEDS_PAIRING'],
    transport_state: ['DIRECT_WIFI', 'REVERSE_LAN', 'CAMPUS_ROUTED', 'SECURE_RELAY', 'SYSTEM_DEFAULT', 'NONE'],
    sync_state: ['READY', 'WAITING', 'RUNNING', 'RETRY', 'TERMINAL'],
    capture_state: ['ACTIVE', 'CHECKING', 'DEGRADED', 'DISABLED', 'PERMISSION_REQUIRED'],
    recent_error_codes: 'reason_array', audit_event_count: 'integer'
  }),
  CREATE_DIAGNOSTIC_BUNDLE: Object.freeze({
    bundle_id: 'identifier', media_type: 'diagnostic_media_type', size_bytes: 'integer', sha256: 'sha256',
    created_at_epoch_ms: 'integer', expires_at_epoch_ms: 'integer'
  }),
  FETCH_DIAGNOSTIC_BUNDLE: Object.freeze({
    bundle_id: 'identifier', media_type: 'diagnostic_media_type', size_bytes: 'integer', sha256: 'sha256',
    created_at_epoch_ms: 'integer', expires_at_epoch_ms: 'integer', content_base64: 'diagnostic_base64'
  })
});

const REQUEST_FIELDS = Object.freeze([
  'contract_version',
  'request_id',
  'device_id',
  'capability',
  'issued_at_epoch_ms',
  'expires_at_epoch_ms',
  'parameters'
]);
const RESPONSE_FIELDS = Object.freeze([
  'contract_version',
  'request_id',
  'device_id',
  'status',
  'result',
  'reason',
  'completed_at_epoch_ms'
]);
const EXCHANGE_REQUEST_FIELDS = Object.freeze([
  'contract_version',
  'device_id',
  'polled_at_epoch_ms',
  'response'
]);
const EXCHANGE_RESPONSE_FIELDS = Object.freeze([
  'contract_version',
  'device_id',
  'acknowledged_response_request_id',
  'command',
  'next_poll_after_ms'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function failure(code, message, field = null) {
  return { ok: false, error: { code, message, ...(field ? { field } : {}) } };
}

function exactFields(value, expected, scope) {
  if (!isPlainObject(value)) return failure('INVALID_SCHEMA', `${scope} must be a JSON object`, scope);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    return failure('INVALID_SCHEMA', `${scope} must contain exactly the frozen fields`, scope);
  }
  return { ok: true };
}

function safeIdentifier(value, field) {
  if (typeof value !== 'string') return failure('INVALID_FIELD', `${field} must be a string`, field);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CONTROL_IDENTIFIER_LENGTH ||
    normalized === '__proto__' || normalized === 'prototype' || normalized === 'constructor' ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    return failure('INVALID_FIELD', `${field} is invalid`, field);
  }
  return { ok: true, value: normalized };
}

function safeDeviceId(value, field = 'device_id') {
  if (typeof value !== 'string') return failure('INVALID_FIELD', `${field} must be a string`, field);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CONTROL_DEVICE_ID_LENGTH ||
    normalized === '__proto__' || normalized === 'prototype' || normalized === 'constructor' ||
    /[\u0000-\u001f\u007f]/.test(normalized)) {
    return failure('INVALID_FIELD', `${field} is invalid`, field);
  }
  return { ok: true, value: normalized };
}

function safeRequestId(value, field = 'request_id') {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? { ok: true, value: value.toLowerCase() }
    : failure('INVALID_FIELD', `${field} must be a UUID`, field);
}

function safeBundleId(value, field = 'bundle_id') {
  return typeof value === 'string' &&
    /^diag-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? { ok: true, value: value.toLowerCase() }
    : failure('INVALID_FIELD', `${field} must be a diagnostic bundle id`, field);
}

function safeInteger(value, field) {
  return Number.isSafeInteger(value) && value >= 0
    ? { ok: true, value }
    : failure('INVALID_FIELD', `${field} must be a non-negative safe integer`, field);
}

function validateParameters(capability, parameters) {
  if (!isPlainObject(parameters)) {
    return failure('INVALID_PARAMETERS', 'parameters must be a JSON object', 'parameters');
  }
  const keys = Object.keys(parameters);
  if (capability === 'FETCH_DIAGNOSTIC_BUNDLE') {
    if (keys.length !== 1 || keys[0] !== 'bundle_id') {
      return failure('INVALID_PARAMETERS', 'FETCH_DIAGNOSTIC_BUNDLE requires only bundle_id', 'parameters');
    }
    const bundleId = safeBundleId(parameters.bundle_id, 'parameters.bundle_id');
    return bundleId.ok ? { ok: true, value: { bundle_id: bundleId.value } } : bundleId;
  }
  if (keys.length !== 0) {
    return failure('INVALID_PARAMETERS', `${capability} does not accept parameters`, 'parameters');
  }
  return { ok: true, value: {} };
}

function validateControlRequest(input, { now = Date.now(), requireFresh = true } = {}) {
  const shape = exactFields(input, REQUEST_FIELDS, 'request');
  if (!shape.ok) return shape;
  if (input.contract_version !== CONTROL_CONTRACT_VERSION) {
    return failure('UNSUPPORTED_CONTRACT', `contract_version must be ${CONTROL_CONTRACT_VERSION}`, 'contract_version');
  }
  const requestId = safeRequestId(input.request_id, 'request_id');
  if (!requestId.ok) return requestId;
  const deviceId = safeDeviceId(input.device_id, 'device_id');
  if (!deviceId.ok) return deviceId;
  if (!Object.hasOwn(CONTROL_CAPABILITIES, input.capability)) {
    return failure('UNKNOWN_CAPABILITY', 'capability is not in the V0.1 allowlist', 'capability');
  }
  const issuedAt = safeInteger(input.issued_at_epoch_ms, 'issued_at_epoch_ms');
  if (!issuedAt.ok) return issuedAt;
  const expiresAt = safeInteger(input.expires_at_epoch_ms, 'expires_at_epoch_ms');
  if (!expiresAt.ok) return expiresAt;
  if (expiresAt.value <= issuedAt.value ||
    expiresAt.value - issuedAt.value > MAX_CONTROL_REQUEST_LIFETIME_MS) {
    return failure('INVALID_EXPIRY', 'request lifetime is invalid or unbounded', 'expires_at_epoch_ms');
  }
  if (requireFresh && issuedAt.value > now + MAX_CONTROL_CLOCK_SKEW_MS) {
    return failure('REQUEST_FROM_FUTURE', 'issued_at_epoch_ms exceeds allowed clock skew', 'issued_at_epoch_ms');
  }
  if (requireFresh && expiresAt.value <= now) {
    return failure('REQUEST_EXPIRED', 'control request has expired', 'expires_at_epoch_ms');
  }
  const parameters = validateParameters(input.capability, input.parameters);
  if (!parameters.ok) return parameters;
  return {
    ok: true,
    value: {
      contract_version: CONTROL_CONTRACT_VERSION,
      request_id: requestId.value,
      device_id: deviceId.value,
      capability: input.capability,
      issued_at_epoch_ms: issuedAt.value,
      expires_at_epoch_ms: expiresAt.value,
      parameters: parameters.value
    }
  };
}

function validateBoundedJsonValue(value, depth = 0) {
  if (depth > MAX_CONTROL_DEPTH) return failure('RESULT_TOO_DEEP', 'result nesting is too deep', 'result');
  if (value === null || typeof value === 'boolean') return { ok: true };
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isSafeInteger(value)
      ? { ok: true }
      : failure('INVALID_RESULT', 'result numbers must be finite safe integers', 'result');
  }
  if (typeof value === 'string') {
    const maxLength = MAX_CONTROL_RESULT_BYTES;
    return value.length <= maxLength && !/[\u0000]/.test(value)
      ? { ok: true }
      : failure('INVALID_RESULT', 'result string exceeds its bound or contains NUL', 'result');
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTROL_COLLECTION_ITEMS) {
      return failure('INVALID_RESULT', 'result array is too large', 'result');
    }
    for (const entry of value) {
      const checked = validateBoundedJsonValue(entry, depth + 1);
      if (!checked.ok) return checked;
    }
    return { ok: true };
  }
  if (!isPlainObject(value)) return failure('INVALID_RESULT', 'result contains an unsupported value', 'result');
  const keys = Object.keys(value);
  if (keys.length > MAX_CONTROL_COLLECTION_ITEMS) {
    return failure('INVALID_RESULT', 'result object has too many fields', 'result');
  }
  for (const key of keys) {
    if (!safeIdentifier(key, 'result key').ok) return failure('INVALID_RESULT', 'result key is invalid', 'result');
    const checked = validateBoundedJsonValue(value[key], depth + 1);
    if (!checked.ok) return checked;
  }
  return { ok: true };
}

function validateSchemaValue(value, specification, field) {
  if (Array.isArray(specification)) {
    return typeof value === 'string' && specification.includes(value)
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} is outside the frozen enum`, `result.${field}`);
  }
  if (specification === 'boolean') {
    return typeof value === 'boolean'
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} must be a boolean`, `result.${field}`);
  }
  if (specification === 'integer') return safeInteger(value, `result.${field}`);
  if (specification === 'nullable_integer') {
    return value === null ? { ok: true } : safeInteger(value, `result.${field}`);
  }
  if (specification === 'identifier') {
    return field === 'device_id'
      ? safeDeviceId(value, `result.${field}`)
      : field === 'bundle_id'
        ? safeBundleId(value, `result.${field}`)
        : safeIdentifier(value, `result.${field}`);
  }
  if (specification === 'string') {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} must be a bounded safe string`, `result.${field}`);
  }
  if (specification === 'nullable_reason') {
    return value === null || typeof value === 'string' && /^[A-Z0-9][A-Z0-9_:.-]{0,127}$/.test(value)
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} must be null or a safe reason code`, `result.${field}`);
  }
  if (specification === 'reason_array') {
    return Array.isArray(value) && value.length <= 16 &&
      value.every((entry) => typeof entry === 'string' && /^[A-Z0-9][A-Z0-9_:.-]{0,127}$/.test(entry))
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} must contain bounded safe reason codes`, `result.${field}`);
  }
  if (specification === 'capability_array') {
    return Array.isArray(value) && value.length === Object.keys(CONTROL_CAPABILITIES).length &&
      new Set(value).size === value.length && value.every((entry) => Object.hasOwn(CONTROL_CAPABILITIES, entry))
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} must contain the exact supported capability set`, `result.${field}`);
  }
  if (specification === 'endpoint_family_array') {
    return Array.isArray(value) && value.length <= 3 && new Set(value).size === value.length &&
      value.every((entry) => ['IPV4', 'IPV6', 'RELAY'].includes(entry))
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} contains an invalid endpoint family`, `result.${field}`);
  }
  if (specification === 'diagnostic_media_type') {
    return value === 'application/vnd.nexa.diagnostic+json'
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} has an invalid media type`, `result.${field}`);
  }
  if (specification === 'sha256') {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} must be a SHA-256 digest`, `result.${field}`);
  }
  if (specification === 'diagnostic_base64') {
    return typeof value === 'string' && value.length <= Math.ceil(128 * 1024 / 3) * 4 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
      ? { ok: true }
      : failure('INVALID_RESULT', `${field} must be bounded Base64`, `result.${field}`);
  }
  return failure('INVALID_RESULT', `${field} has an unknown result schema`, `result.${field}`);
}

function validateCapabilityResult(result, capability) {
  const schema = RESULT_SCHEMAS[capability];
  if (!schema) return failure('UNKNOWN_CAPABILITY', 'No result schema exists for capability', 'result');
  const shape = exactFields(result, Object.keys(schema), 'result');
  if (!shape.ok) return shape;
  for (const [field, specification] of Object.entries(schema)) {
    const checked = validateSchemaValue(result[field], specification, field);
    if (!checked.ok) return checked;
  }
  if ((capability === 'CREATE_DIAGNOSTIC_BUNDLE' || capability === 'FETCH_DIAGNOSTIC_BUNDLE') &&
    (result.size_bytes > 128 * 1024 || result.expires_at_epoch_ms <= result.created_at_epoch_ms ||
      result.expires_at_epoch_ms - result.created_at_epoch_ms > 10 * 60 * 1000)) {
    return failure('INVALID_RESULT', 'diagnostic bundle size or lifetime is invalid', 'result');
  }
  if (capability === 'FETCH_DIAGNOSTIC_BUNDLE') {
    const decodedBytes = Buffer.from(result.content_base64, 'base64').length;
    if (decodedBytes !== result.size_bytes) {
      return failure('INVALID_RESULT', 'diagnostic bundle size does not match content', 'result.size_bytes');
    }
  }
  return { ok: true };
}

function validateControlResponse(input, { expectedRequest = null, now = Date.now() } = {}) {
  const shape = exactFields(input, RESPONSE_FIELDS, 'response');
  if (!shape.ok) return shape;
  if (input.contract_version !== CONTROL_CONTRACT_VERSION) {
    return failure('UNSUPPORTED_CONTRACT', `contract_version must be ${CONTROL_CONTRACT_VERSION}`, 'contract_version');
  }
  const requestId = safeRequestId(input.request_id, 'request_id');
  if (!requestId.ok) return requestId;
  const deviceId = safeDeviceId(input.device_id, 'device_id');
  if (!deviceId.ok) return deviceId;
  if (!CONTROL_RESPONSE_STATUSES.includes(input.status)) {
    return failure('INVALID_STATUS', 'response status is invalid', 'status');
  }
  if (!isPlainObject(input.result)) {
    return failure('INVALID_RESULT', 'result must be a JSON object', 'result');
  }
  const reason = input.reason === null
    ? { ok: true, value: null }
    : typeof input.reason === 'string' && /^[A-Z0-9][A-Z0-9_:.-]{0,127}$/.test(input.reason)
      ? { ok: true, value: input.reason }
      : failure('INVALID_FIELD', 'reason must be a bounded safe reason code', 'reason');
  if (!reason.ok) return reason;
  const completedAt = safeInteger(input.completed_at_epoch_ms, 'completed_at_epoch_ms');
  if (!completedAt.ok) return completedAt;
  if (expectedRequest) {
    if (requestId.value !== expectedRequest.request_id) {
      return failure('REQUEST_ID_MISMATCH', 'response request_id does not match the pending request', 'request_id');
    }
    if (deviceId.value !== expectedRequest.device_id) {
      return failure('DEVICE_ID_MISMATCH', 'response device_id does not match the pending device', 'device_id');
    }
    if (completedAt.value < expectedRequest.issued_at_epoch_ms - MAX_CONTROL_CLOCK_SKEW_MS) {
      return failure('INVALID_COMPLETION_TIME', 'response completion time predates the request', 'completed_at_epoch_ms');
    }
    if (completedAt.value > now + MAX_CONTROL_CLOCK_SKEW_MS) {
      return failure('INVALID_COMPLETION_TIME', 'response completion time exceeds allowed clock skew', 'completed_at_epoch_ms');
    }
  }
  const capability = expectedRequest?.capability || null;
  if (input.status === 'SUCCEEDED' && input.reason !== null) {
    return failure('INVALID_RESULT', 'successful response reason must be null', 'reason');
  }
  if (input.status !== 'SUCCEEDED' && input.reason === null) {
    return failure('INVALID_RESULT', 'non-success response requires a safe reason code', 'reason');
  }
  if (input.status !== 'SUCCEEDED' && Object.keys(input.result).length !== 0) {
    return failure('INVALID_RESULT', 'non-success response result must be empty', 'result');
  }
  if (input.status === 'USER_ACTION_REQUIRED' && expectedRequest &&
    expectedRequest.capability !== 'REQUEST_CAPTURE_SERVICE_REFRESH') {
    return failure('INVALID_STATUS', 'USER_ACTION_REQUIRED is not allowed for this V0.1 capability', 'status');
  }
  const safeResult = capability && input.status === 'SUCCEEDED'
    ? validateCapabilityResult(input.result, capability)
    : validateBoundedJsonValue(input.result);
  if (!safeResult.ok) return safeResult;
  let encoded;
  try { encoded = JSON.stringify(input.result); } catch (_) {
    return failure('INVALID_RESULT', 'result must be JSON serializable', 'result');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_CONTROL_RESULT_BYTES) {
    return failure('RESULT_TOO_LARGE', 'result exceeds the V0.1 size bound', 'result');
  }
  return {
    ok: true,
    value: {
      contract_version: CONTROL_CONTRACT_VERSION,
      request_id: requestId.value,
      device_id: deviceId.value,
      status: input.status,
      result: JSON.parse(encoded),
      reason: reason.value,
      completed_at_epoch_ms: completedAt.value
    }
  };
}

function validateControlExchangeRequest(input, options = {}) {
  const shape = exactFields(input, EXCHANGE_REQUEST_FIELDS, 'exchange');
  if (!shape.ok) return shape;
  if (input.contract_version !== CONTROL_CONTRACT_VERSION) {
    return failure('UNSUPPORTED_CONTRACT', `contract_version must be ${CONTROL_CONTRACT_VERSION}`, 'contract_version');
  }
  const deviceId = safeDeviceId(input.device_id, 'device_id');
  if (!deviceId.ok) return deviceId;
  const polledAt = safeInteger(input.polled_at_epoch_ms, 'polled_at_epoch_ms');
  if (!polledAt.ok) return polledAt;
  const current = options.now ?? Date.now();
  if (Math.abs(polledAt.value - current) > MAX_CONTROL_CLOCK_SKEW_MS) {
    return failure('INVALID_POLL_TIME', 'polled_at_epoch_ms exceeds allowed clock skew', 'polled_at_epoch_ms');
  }
  let response = null;
  if (input.response !== null) {
    const validated = validateControlResponse(input.response, options);
    if (!validated.ok) return validated;
    if (validated.value.device_id !== deviceId.value) {
      return failure('DEVICE_ID_MISMATCH', 'exchange and response device_id values differ', 'response.device_id');
    }
    response = validated.value;
  }
  return {
    ok: true,
    value: {
      contract_version: CONTROL_CONTRACT_VERSION,
      device_id: deviceId.value,
      polled_at_epoch_ms: polledAt.value,
      response
    }
  };
}

function validateControlExchangeResponse(input, options = {}) {
  const shape = exactFields(input, EXCHANGE_RESPONSE_FIELDS, 'exchange_response');
  if (!shape.ok) return shape;
  if (input.contract_version !== CONTROL_CONTRACT_VERSION) {
    return failure('UNSUPPORTED_CONTRACT', `contract_version must be ${CONTROL_CONTRACT_VERSION}`, 'contract_version');
  }
  const deviceId = safeDeviceId(input.device_id, 'device_id');
  if (!deviceId.ok) return deviceId;
  const acknowledged = input.acknowledged_response_request_id === null
    ? { ok: true, value: null }
    : safeRequestId(input.acknowledged_response_request_id, 'acknowledged_response_request_id');
  if (!acknowledged.ok) return acknowledged;
  const nextPoll = safeInteger(input.next_poll_after_ms, 'next_poll_after_ms');
  if (!nextPoll.ok || nextPoll.value < 250 || nextPoll.value > 30_000) {
    return failure('INVALID_FIELD', 'next_poll_after_ms must be between 250 and 30000', 'next_poll_after_ms');
  }
  let command = null;
  if (input.command !== null) {
    const validated = validateControlRequest(input.command, options);
    if (!validated.ok) return validated;
    if (validated.value.device_id !== deviceId.value) {
      return failure('DEVICE_ID_MISMATCH', 'exchange and command device_id values differ', 'command.device_id');
    }
    command = validated.value;
  }
  return {
    ok: true,
    value: {
      contract_version: CONTROL_CONTRACT_VERSION,
      device_id: deviceId.value,
      acknowledged_response_request_id: acknowledged.value,
      command,
      next_poll_after_ms: nextPoll.value
    }
  };
}

module.exports = {
  CONTROL_CAPABILITIES,
  CONTROL_CONTENT_TYPE,
  CONTROL_CONTRACT_VERSION,
  CONTROL_EXCHANGE_ENDPOINT,
  CONTROL_RESPONSE_STATUSES,
  MAX_CONTROL_EXCHANGE_BYTES,
  MAX_CONTROL_REQUEST_LIFETIME_MS,
  MAX_CONTROL_RESULT_BYTES,
  validateControlExchangeRequest,
  validateControlExchangeResponse,
  validateControlRequest,
  validateControlResponse,
  validateCapabilityResult,
  validateParameters
};
