'use strict';

const crypto = require('node:crypto');

const PROTOCOL_VERSION = 'nexa.mobile.sync.v1';
const BUSINESS_ENDPOINT = '/nexa/mobile/sync';
const STATUS_ENDPOINT = '/nexa/mobile/sync/status';
const STATUS_CONTRACT_VERSION_V0_1 = 'nexa.mobile.capture.desktop-handoff.v0.1';
const STATUS_CONTRACT_VERSION_V0_2 = 'nexa.mobile.capture.desktop-handoff.v0.2';
const STATUS_CONTRACT_VERSION = STATUS_CONTRACT_VERSION_V0_2;
const STATUS_CONTRACT_VERSIONS = new Set([
  STATUS_CONTRACT_VERSION_V0_1,
  STATUS_CONTRACT_VERSION_V0_2
]);
const STATUS_CONTENT_TYPE = 'application/json; charset=utf-8';
const STATUS_ACK_STATUSES = Object.freeze(['APPLIED', 'DUPLICATE', 'STALE_IGNORED', 'TIMESTAMP_CONFLICT']);
const STATUS_ACK_REASONS = Object.freeze({
  DUPLICATE: 'IDENTICAL_SNAPSHOT',
  STALE_IGNORED: 'OLDER_THAN_CURRENT_SNAPSHOT',
  TIMESTAMP_CONFLICT: 'EQUAL_TIMESTAMP_DIFFERENT_SNAPSHOT'
});
const MAX_EVENTS_PER_BATCH = 50;
const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;
const MAX_IDENTITY_LENGTH = 256;
const MAX_AUTOMATIC_ATTEMPTS = 20;
const EVENT_TYPES = Object.freeze(['RAW_NOTIFICATION', 'PARSED_TRANSACTION']);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const STATUS_ACK_STATUS_SET = new Set(STATUS_ACK_STATUSES);
const FORBIDDEN_IDENTITIES = new Set(['__proto__', 'prototype', 'constructor']);

const STATUS_FIELDS = Object.freeze({
  rootV0_1: ['contract_version', 'captured_at_epoch_ms', 'identity', 'capture', 'sync', 'diagnostic'],
  rootV0_2: ['contract_version', 'captured_at_epoch_ms', 'identity', 'capture', 'sync', 'diagnostic', 'ledger'],
  identity: ['device_id', 'application_id', 'version_name', 'version_code'],
  capture: ['status', 'capture_enabled', 'notification_listener_permission_granted'],
  sync: [
    'status',
    'readiness',
    'pending_count',
    'running_count',
    'retry_pending_count',
    'terminal_failure_count',
    'last_sync_at_epoch_ms',
    'next_retry_at_epoch_ms'
  ],
  diagnostic: ['summary', 'reason_code', 'last_activity_at_epoch_ms'],
  ledger: [
    'total_event_count',
    'today_event_count',
    'latest_posted_at_epoch_ms',
    'latest_captured_at_epoch_ms',
    'latest_sequence_number',
    'latest_event_type',
    'latest_source_package',
    'latest_event_fingerprint_prefix',
    'pending_upload_count',
    'acked_count',
    'failed_count',
    'latest_ack_sequence_number'
  ],
  ack: ['contract_version', 'device_id', 'captured_at_epoch_ms', 'status', 'reason']
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, ...details } };
}

function normalizeIdentity(value, field) {
  if (typeof value !== 'string') return failure('missing_or_invalid_field', `${field} must be a string`, { field });
  const normalized = value.trim();
  if (!normalized) return failure('missing_or_invalid_field', `${field} must not be empty`, { field });
  if (normalized.length > MAX_IDENTITY_LENGTH) {
    return failure('invalid_identity', `${field} must be at most ${MAX_IDENTITY_LENGTH} characters`, { field });
  }
  if (FORBIDDEN_IDENTITIES.has(normalized) || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return failure('invalid_identity', `${field} contains a forbidden value`, { field });
  }
  return { ok: true, value: normalized };
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactFields(value, fields, scope) {
  if (!isPlainObject(value)) return failure('unsafe_status_shape', `${scope} must be a JSON object`, { field: scope });
  const actual = Object.keys(value);
  if (actual.length !== fields.length || actual.some((field) => !fields.includes(field))) {
    return failure('unsafe_status_shape', `${scope} must contain exactly the frozen Status fields`, { field: scope });
  }
  return { ok: true };
}

function statusString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    return failure('missing_or_invalid_field', `${field} must be a non-blank string`, { field });
  }
  return { ok: true, value };
}

function optionalStatusString(value, field) {
  if (value === null) return { ok: true, value: null };
  return statusString(value, field);
}

function optionalStatusIdentity(value, field) {
  if (value === null) return { ok: true, value: null };
  return normalizeIdentity(value, field);
}

function statusInteger(value, field, nullable = false) {
  if (nullable && value === null) return { ok: true, value: null };
  if (!nonNegativeInteger(value)) {
    return failure('missing_or_invalid_field', `${field} must be a non-negative safe integer${nullable ? ' or null' : ''}`, { field });
  }
  return { ok: true, value };
}

function firstFailure(values) {
  return values.find((value) => value && value.ok === false) || null;
}

function validateMobileStatusRequest(input) {
  if (!isPlainObject(input)) return failure('unsafe_status_shape', 'status must be a JSON object', { field: 'status' });
  if (!STATUS_CONTRACT_VERSIONS.has(input.contract_version)) {
    return failure(
      Object.hasOwn(input, 'contract_version') ? 'unsupported_status_contract' : 'missing_or_invalid_field',
      `contract_version must be one of the supported Status contracts`,
      { field: 'contract_version' }
    );
  }
  const isV0_2 = input.contract_version === STATUS_CONTRACT_VERSION_V0_2;
  const rootShape = exactFields(input, isV0_2 ? STATUS_FIELDS.rootV0_2 : STATUS_FIELDS.rootV0_1, 'status');
  if (!rootShape.ok) return rootShape;

  const identityShape = exactFields(input.identity, STATUS_FIELDS.identity, 'identity');
  if (!identityShape.ok) return identityShape;
  const captureShape = exactFields(input.capture, STATUS_FIELDS.capture, 'capture');
  if (!captureShape.ok) return captureShape;
  const syncShape = exactFields(input.sync, STATUS_FIELDS.sync, 'sync');
  if (!syncShape.ok) return syncShape;
  const diagnosticShape = exactFields(input.diagnostic, STATUS_FIELDS.diagnostic, 'diagnostic');
  if (!diagnosticShape.ok) return diagnosticShape;
  if (isV0_2) {
    const ledgerShape = exactFields(input.ledger, STATUS_FIELDS.ledger, 'ledger');
    if (!ledgerShape.ok) return ledgerShape;
  }

  const capturedAt = statusInteger(input.captured_at_epoch_ms, 'captured_at_epoch_ms');
  const deviceId = normalizeIdentity(input.identity.device_id, 'identity.device_id');
  const applicationId = statusString(input.identity.application_id, 'identity.application_id');
  const versionName = statusString(input.identity.version_name, 'identity.version_name');
  const versionCode = statusInteger(input.identity.version_code, 'identity.version_code');
  const captureStatus = statusString(input.capture.status, 'capture.status');
  const syncStatus = statusString(input.sync.status, 'sync.status');
  const readiness = statusString(input.sync.readiness, 'sync.readiness');
  const pendingCount = statusInteger(input.sync.pending_count, 'sync.pending_count');
  const runningCount = statusInteger(input.sync.running_count, 'sync.running_count');
  const retryPendingCount = statusInteger(input.sync.retry_pending_count, 'sync.retry_pending_count');
  const terminalFailureCount = statusInteger(input.sync.terminal_failure_count, 'sync.terminal_failure_count');
  const lastSyncAt = statusInteger(input.sync.last_sync_at_epoch_ms, 'sync.last_sync_at_epoch_ms', true);
  const nextRetryAt = statusInteger(input.sync.next_retry_at_epoch_ms, 'sync.next_retry_at_epoch_ms', true);
  const summary = statusString(input.diagnostic.summary, 'diagnostic.summary');
  const reasonCode = optionalStatusString(input.diagnostic.reason_code, 'diagnostic.reason_code');
  const lastActivityAt = statusInteger(input.diagnostic.last_activity_at_epoch_ms, 'diagnostic.last_activity_at_epoch_ms', true);
  const ledger = isV0_2 ? validateStatusLedger(input.ledger) : null;
  const failureResult = firstFailure([
    capturedAt, deviceId, applicationId, versionName, versionCode, captureStatus, syncStatus,
    readiness, pendingCount, runningCount, retryPendingCount, terminalFailureCount,
    lastSyncAt, nextRetryAt, summary, reasonCode, lastActivityAt, ledger
  ]);
  if (failureResult) return failureResult;
  if (input.identity.device_id !== deviceId.value) {
    return failure('invalid_identity', 'identity.device_id must use its canonical value', { field: 'identity.device_id' });
  }
  if (typeof input.capture.capture_enabled !== 'boolean') {
    return failure('missing_or_invalid_field', 'capture.capture_enabled must be a boolean', { field: 'capture.capture_enabled' });
  }
  if (typeof input.capture.notification_listener_permission_granted !== 'boolean') {
    return failure(
      'missing_or_invalid_field',
      'capture.notification_listener_permission_granted must be a boolean',
      { field: 'capture.notification_listener_permission_granted' }
    );
  }

  return {
    ok: true,
    value: {
      contract_version: input.contract_version,
      captured_at_epoch_ms: capturedAt.value,
      identity: {
        device_id: deviceId.value,
        application_id: applicationId.value,
        version_name: versionName.value,
        version_code: versionCode.value
      },
      capture: {
        status: captureStatus.value,
        capture_enabled: input.capture.capture_enabled,
        notification_listener_permission_granted: input.capture.notification_listener_permission_granted
      },
      sync: {
        status: syncStatus.value,
        readiness: readiness.value,
        pending_count: pendingCount.value,
        running_count: runningCount.value,
        retry_pending_count: retryPendingCount.value,
        terminal_failure_count: terminalFailureCount.value,
        last_sync_at_epoch_ms: lastSyncAt.value,
        next_retry_at_epoch_ms: nextRetryAt.value
      },
      diagnostic: {
        summary: summary.value,
        reason_code: reasonCode.value,
        last_activity_at_epoch_ms: lastActivityAt.value
      },
      ...(isV0_2 ? { ledger: ledger.value } : {})
    }
  };
}

function validateStatusLedger(input) {
  const total = statusInteger(input.total_event_count, 'ledger.total_event_count');
  const today = statusInteger(input.today_event_count, 'ledger.today_event_count');
  const latestPostedAt = statusInteger(input.latest_posted_at_epoch_ms, 'ledger.latest_posted_at_epoch_ms', true);
  const latestCapturedAt = statusInteger(input.latest_captured_at_epoch_ms, 'ledger.latest_captured_at_epoch_ms', true);
  const latestSequence = statusInteger(input.latest_sequence_number, 'ledger.latest_sequence_number', true);
  const pending = statusInteger(input.pending_upload_count, 'ledger.pending_upload_count');
  const acknowledged = statusInteger(input.acked_count, 'ledger.acked_count', true);
  const failed = statusInteger(input.failed_count, 'ledger.failed_count');
  const latestAcknowledgedSequence = statusInteger(
    input.latest_ack_sequence_number,
    'ledger.latest_ack_sequence_number',
    true
  );
  const latestEventType = optionalStatusIdentity(input.latest_event_type, 'ledger.latest_event_type');
  const latestSourcePackage = optionalStatusIdentity(input.latest_source_package, 'ledger.latest_source_package');
  const latestFingerprint = optionalStatusString(
    input.latest_event_fingerprint_prefix,
    'ledger.latest_event_fingerprint_prefix'
  );
  const invalid = firstFailure([
    total, today, latestPostedAt, latestCapturedAt, latestSequence, pending, acknowledged,
    failed, latestAcknowledgedSequence, latestEventType, latestSourcePackage, latestFingerprint
  ]);
  if (invalid) return invalid;
  if (input.latest_event_type !== latestEventType.value ||
      input.latest_source_package !== latestSourcePackage.value) {
    return failure('invalid_identity', 'ledger identity fields must use canonical values', { field: 'ledger' });
  }
  if (latestEventType.value && latestEventType.value.length > 64) {
    return failure('missing_or_invalid_field', 'ledger.latest_event_type is too long', { field: 'ledger.latest_event_type' });
  }
  if (latestSourcePackage.value && latestSourcePackage.value.length > MAX_IDENTITY_LENGTH) {
    return failure('missing_or_invalid_field', 'ledger.latest_source_package is too long', { field: 'ledger.latest_source_package' });
  }
  if (latestFingerprint.value && !/^[0-9a-fA-F]{1,12}$/.test(latestFingerprint.value)) {
    return failure(
      'missing_or_invalid_field',
      'ledger.latest_event_fingerprint_prefix must be a hexadecimal prefix',
      { field: 'ledger.latest_event_fingerprint_prefix' }
    );
  }
  if (today.value > total.value || pending.value + (acknowledged.value || 0) + failed.value > total.value) {
    return failure('inconsistent_status_ledger', 'ledger counts are internally inconsistent', { field: 'ledger' });
  }
  return {
    ok: true,
    value: {
      total_event_count: total.value,
      today_event_count: today.value,
      latest_posted_at_epoch_ms: latestPostedAt.value,
      latest_captured_at_epoch_ms: latestCapturedAt.value,
      latest_sequence_number: latestSequence.value,
      latest_event_type: latestEventType.value,
      latest_source_package: latestSourcePackage.value,
      latest_event_fingerprint_prefix: latestFingerprint.value,
      pending_upload_count: pending.value,
      acked_count: acknowledged.value,
      failed_count: failed.value,
      latest_ack_sequence_number: latestAcknowledgedSequence.value
    }
  };
}

function canonicalMobileStatusJson(input) {
  const validation = validateMobileStatusRequest(input);
  if (!validation.ok) {
    const error = new Error(validation.error.code);
    error.code = validation.error.code;
    throw error;
  }
  return JSON.stringify(validation.value);
}

function mobileStatusFingerprint(input) {
  return crypto.createHash('sha256').update(canonicalMobileStatusJson(input), 'utf8').digest('hex');
}

function statusAckHttpCode(status) {
  return status === 'TIMESTAMP_CONFLICT' ? 409 : 200;
}

function validateMobileStatusAck(input, { request = null, httpStatusCode = null } = {}) {
  const shape = exactFields(input, STATUS_FIELDS.ack, 'status_ack');
  if (!shape.ok) return failure('invalid_status_ack', 'Status ACK must contain exactly the frozen fields');
  if (!STATUS_CONTRACT_VERSIONS.has(input.contract_version)) {
    return failure('invalid_status_ack', 'Status ACK contract_version is invalid', { field: 'contract_version' });
  }
  const deviceId = normalizeIdentity(input.device_id, 'device_id');
  const capturedAt = statusInteger(input.captured_at_epoch_ms, 'captured_at_epoch_ms');
  const reason = optionalStatusString(input.reason, 'reason');
  const ackFailure = firstFailure([deviceId, capturedAt, reason]);
  if (ackFailure) return failure('invalid_status_ack', ackFailure.error.message, { field: ackFailure.error.field });
  if (!STATUS_ACK_STATUS_SET.has(input.status)) {
    return failure('invalid_status_ack', 'Status ACK status is invalid', { field: 'status' });
  }
  if (request) {
    const requestValidation = validateMobileStatusRequest(request);
    if (!requestValidation.ok || input.contract_version !== requestValidation.value.contract_version ||
        deviceId.value !== requestValidation.value.identity.device_id ||
        capturedAt.value !== requestValidation.value.captured_at_epoch_ms) {
      return failure('invalid_status_ack', 'Status ACK does not match the request identity');
    }
  }
  if (httpStatusCode !== null && httpStatusCode !== statusAckHttpCode(input.status)) {
    return failure('invalid_status_ack', 'Status ACK and HTTP status do not match');
  }
  return { ok: true, value: cloneJson(input) };
}

function payloadRejection(event) {
  if (!isPlainObject(event.payload) || Object.keys(event.payload).length === 0) return 'INVALID_PAYLOAD';
  if (Object.keys(event.payload).some((key) => !key.trim())) return 'INVALID_PAYLOAD';
  if (!nonNegativeInteger(event.event_time)) return 'INVALID_EVENT_TIME';
  if (!Number.isSafeInteger(event.attempt) || event.attempt < 1 || event.attempt > MAX_AUTOMATIC_ATTEMPTS) {
    return 'INVALID_ATTEMPT';
  }
  if (Buffer.byteLength(JSON.stringify(event.payload), 'utf8') > MAX_EVENT_PAYLOAD_BYTES) {
    return 'PAYLOAD_TOO_LARGE';
  }
  return null;
}

function validateMobileSyncRequest(input) {
  if (!isPlainObject(input)) return failure('malformed_request', 'Request body must be a JSON object');
  if (Object.hasOwn(input, 'protocolVersion') || Object.hasOwn(input, 'deviceId') || Object.hasOwn(input, 'batchId') || Object.hasOwn(input, 'sentAt')) {
    return failure('non_snake_case_field', 'Business sync wire fields must use snake_case');
  }
  if (input.protocol_version !== PROTOCOL_VERSION) {
    return failure(
      Object.hasOwn(input, 'protocol_version') ? 'unsupported_protocol_version' : 'missing_or_invalid_field',
      `protocol_version must be ${PROTOCOL_VERSION}`,
      { field: 'protocol_version' }
    );
  }

  const deviceId = normalizeIdentity(input.device_id, 'device_id');
  if (!deviceId.ok) return deviceId;
  const batchId = normalizeIdentity(input.batch_id, 'batch_id');
  if (!batchId.ok) return batchId;
  if (!nonNegativeInteger(input.sent_at)) {
    return failure('missing_or_invalid_field', 'sent_at must be a non-negative integer', { field: 'sent_at' });
  }
  if (!Array.isArray(input.events) || input.events.length === 0) {
    return failure('invalid_events_shape', 'events must be a non-empty array', { field: 'events' });
  }
  if (input.events.length > MAX_EVENTS_PER_BATCH) {
    return failure('too_many_events', `events must not contain more than ${MAX_EVENTS_PER_BATCH} items`);
  }

  const identities = new Set();
  const events = [];
  for (let index = 0; index < input.events.length; index += 1) {
    const event = input.events[index];
    if (!isPlainObject(event)) return failure('invalid_events_shape', `events[${index}] must be an object`, { index });
    if (Object.hasOwn(event, 'eventType') || Object.hasOwn(event, 'eventId') || Object.hasOwn(event, 'eventTime')) {
      return failure('non_snake_case_field', `events[${index}] must use snake_case`, { index });
    }
    const eventType = normalizeIdentity(event.event_type, `events[${index}].event_type`);
    if (!eventType.ok) return eventType;
    if (!EVENT_TYPE_SET.has(eventType.value)) {
      return failure('unsupported_event_type', `events[${index}].event_type is not supported`, { index, field: 'event_type' });
    }
    const eventId = normalizeIdentity(event.event_id, `events[${index}].event_id`);
    if (!eventId.ok) return eventId;
    const identity = JSON.stringify([eventType.value, eventId.value]);
    if (identities.has(identity)) {
      return failure('duplicate_event_in_batch', `events[${index}] repeats an event identity`, { index });
    }
    identities.add(identity);
    const rejectionReason = payloadRejection(event);
    events.push({
      event_type: eventType.value,
      event_id: eventId.value,
      payload: rejectionReason ? null : cloneJson(event.payload),
      event_time: event.event_time,
      attempt: event.attempt,
      rejection_reason: rejectionReason
    });
  }

  return {
    ok: true,
    value: {
      protocol_version: PROTOCOL_VERSION,
      device_id: deviceId.value,
      batch_id: batchId.value,
      sent_at: input.sent_at,
      events
    }
  };
}

function mobileSyncProtocolInfo() {
  return {
    protocol_version: PROTOCOL_VERSION,
    endpoint: BUSINESS_ENDPOINT,
    event_types: [...EVENT_TYPES],
    max_events_per_batch: MAX_EVENTS_PER_BATCH,
    max_event_payload_bytes: MAX_EVENT_PAYLOAD_BYTES,
    max_identity_length: MAX_IDENTITY_LENGTH
  };
}

module.exports = {
  BUSINESS_ENDPOINT,
  EVENT_TYPES,
  MAX_AUTOMATIC_ATTEMPTS,
  MAX_EVENT_PAYLOAD_BYTES,
  MAX_EVENTS_PER_BATCH,
  MAX_IDENTITY_LENGTH,
  PROTOCOL_VERSION,
  STATUS_ACK_REASONS,
  STATUS_ACK_STATUSES,
  STATUS_CONTENT_TYPE,
  STATUS_CONTRACT_VERSION,
  STATUS_CONTRACT_VERSION_V0_1,
  STATUS_CONTRACT_VERSION_V0_2,
  STATUS_ENDPOINT,
  canonicalMobileStatusJson,
  mobileSyncProtocolInfo,
  mobileStatusFingerprint,
  statusAckHttpCode,
  validateMobileStatusAck,
  validateMobileStatusRequest,
  validateMobileSyncRequest
};
