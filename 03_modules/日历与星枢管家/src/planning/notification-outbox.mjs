import { createHash } from 'node:crypto';

import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';

export const NOTIFICATION_OUTBOX_STATES = Object.freeze({
  PENDING: 'pending',
  HANDED_OFF: 'handed_off',
  ACKNOWLEDGED: 'acknowledged',
  CANCELLED: 'cancelled',
});

const STATE_LIST = Object.freeze(Object.values(NOTIFICATION_OUTBOX_STATES));

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function timestamp(value, field, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (!isValidIsoTimestamp(value) || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new TypeError(`${field} must be an explicit ISO timestamp${nullable ? ' or null' : ''}`);
  }
  return value;
}

function freezeJson(value, field) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${field} must be JSON-compatible`);
  }
  if (serialized == null) throw new TypeError(`${field} must be JSON-compatible`);
  const freeze = (item) => {
    if (Array.isArray(item)) return Object.freeze(item.map(freeze));
    if (item && typeof item === 'object') {
      return Object.freeze(Object.fromEntries(Object.entries(item).map(([key, child]) => [key, freeze(child)])));
    }
    return item;
  };
  return freeze(JSON.parse(serialized));
}

export function createNotificationOutboxIdentity(handoffId) {
  nonEmpty(handoffId, 'handoff_id');
  return `outbox_${createHash('sha256').update(handoffId).digest('hex').slice(0, 32)}`;
}

export function validateNotificationOutboxEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Notification Outbox entry must be an object');
  }
  const state = input.state;
  if (!STATE_LIST.includes(state)) throw new TypeError(`Invalid Notification Outbox state "${state}"`);
  const payload = freezeJson(input.payload, 'payload');
  const handoffId = nonEmpty(input.handoff_id, 'handoff_id');
  const dedupeKey = nonEmpty(input.dedupe_key, 'dedupe_key');
  if (payload.handoff_id !== handoffId) throw new TypeError('payload.handoff_id must match handoff_id');
  if (payload.dedupe_key !== dedupeKey) throw new TypeError('payload.dedupe_key must match dedupe_key');

  const handedOffAt = timestamp(input.handed_off_at, 'handed_off_at', { nullable: true });
  const acknowledgedAt = timestamp(input.acknowledged_at, 'acknowledged_at', { nullable: true });
  const cancelledAt = timestamp(input.cancelled_at, 'cancelled_at', { nullable: true });
  if (state === NOTIFICATION_OUTBOX_STATES.PENDING && (handedOffAt || acknowledgedAt || cancelledAt)) {
    throw new TypeError('pending Outbox entry cannot have lifecycle completion timestamps');
  }
  if (state === NOTIFICATION_OUTBOX_STATES.HANDED_OFF && (!handedOffAt || acknowledgedAt || cancelledAt)) {
    throw new TypeError('handed_off Outbox entry requires only handed_off_at');
  }
  if (state === NOTIFICATION_OUTBOX_STATES.ACKNOWLEDGED && (!handedOffAt || !acknowledgedAt || cancelledAt)) {
    throw new TypeError('acknowledged Outbox entry requires handed_off_at and acknowledged_at');
  }
  if (state === NOTIFICATION_OUTBOX_STATES.CANCELLED && (!cancelledAt || acknowledgedAt)) {
    throw new TypeError('cancelled Outbox entry requires cancelled_at and cannot be acknowledged');
  }

  return Object.freeze({
    outbox_id: nonEmpty(input.outbox_id, 'outbox_id'),
    handoff_id: handoffId,
    dedupe_key: dedupeKey,
    reminder_id: nonEmpty(input.reminder_id, 'reminder_id'),
    notification_intent_id: nonEmpty(input.notification_intent_id, 'notification_intent_id'),
    payload,
    state,
    created_at: timestamp(input.created_at, 'created_at'),
    updated_at: timestamp(input.updated_at, 'updated_at'),
    handed_off_at: handedOffAt,
    acknowledged_at: acknowledgedAt,
    cancelled_at: cancelledAt,
  });
}

export function createPendingNotificationOutboxEntry(handoff) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    throw new TypeError('Mobile Notification Handoff must be an object');
  }
  return validateNotificationOutboxEntry({
    outbox_id: createNotificationOutboxIdentity(handoff.handoff_id),
    handoff_id: handoff.handoff_id,
    dedupe_key: handoff.dedupe_key,
    reminder_id: handoff.reminder_id,
    notification_intent_id: handoff.notification_intent_id,
    payload: handoff,
    state: NOTIFICATION_OUTBOX_STATES.PENDING,
    created_at: handoff.created_at,
    updated_at: handoff.created_at,
    handed_off_at: null,
    acknowledged_at: null,
    cancelled_at: null,
  });
}
