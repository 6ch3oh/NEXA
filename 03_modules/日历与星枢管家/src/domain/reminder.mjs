import { createHash } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { assertTemporalContext, instantForLocalDateTime } from '../rules/schedule-rules.mjs';

export const REMINDER_SOURCE_TYPES = Object.freeze({
  TASK: 'task',
  CALENDAR_EVENT: 'calendar_event',
});

export const REMINDER_KINDS = Object.freeze({
  UPCOMING: 'upcoming',
  DUE: 'due',
  OVERDUE: 'overdue',
  EVENT_START: 'event_start',
});

export const REMINDER_STATES = Object.freeze({
  SCHEDULED: 'scheduled',
  READY: 'ready',
  ACKNOWLEDGED: 'acknowledged',
  DISMISSED: 'dismissed',
  CANCELLED: 'cancelled',
});

export const REMINDER_SOURCE_TYPE_LIST = Object.freeze(Object.values(REMINDER_SOURCE_TYPES));
export const REMINDER_KIND_LIST = Object.freeze(Object.values(REMINDER_KINDS));
export const REMINDER_STATE_LIST = Object.freeze(Object.values(REMINDER_STATES));

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function timestamp(value, field, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (!isValidIsoTimestamp(value)) throw new TypeError(`${field} must be a valid ISO timestamp`);
  return value;
}

export function createReminderIdentity({ source_type, source_id, kind, scheduled_at }) {
  if (!REMINDER_SOURCE_TYPE_LIST.includes(source_type)) throw new TypeError(`Invalid reminder source_type "${source_type}"`);
  nonEmpty(source_id, 'source_id');
  if (!REMINDER_KIND_LIST.includes(kind)) throw new TypeError(`Invalid reminder kind "${kind}"`);
  timestamp(scheduled_at, 'scheduled_at');
  const digest = createHash('sha256')
    .update(JSON.stringify([source_type, source_id, kind, scheduled_at]))
    .digest('hex');
  return `reminder_${digest.slice(0, 32)}`;
}

export function validateReminder(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Reminder must be an object');
  nonEmpty(input.id, 'id');
  nonEmpty(input.title, 'title');
  if (!REMINDER_SOURCE_TYPE_LIST.includes(input.source_type)) throw new TypeError(`Invalid reminder source_type "${input.source_type}"`);
  nonEmpty(input.source_id, 'source_id');
  if (!REMINDER_KIND_LIST.includes(input.kind)) throw new TypeError(`Invalid reminder kind "${input.kind}"`);
  timestamp(input.scheduled_at, 'scheduled_at');
  nonEmpty(input.timezone, 'timezone');
  if (!REMINDER_STATE_LIST.includes(input.state)) throw new TypeError(`Invalid reminder state "${input.state}"`);
  timestamp(input.created_at, 'created_at');
  const acknowledgedAt = timestamp(input.acknowledged_at ?? null, 'acknowledged_at', { nullable: true });
  const dismissedAt = timestamp(input.dismissed_at ?? null, 'dismissed_at', { nullable: true });
  if (input.state === REMINDER_STATES.ACKNOWLEDGED && acknowledgedAt == null) {
    throw new TypeError('acknowledged reminder requires acknowledged_at');
  }
  if (input.state !== REMINDER_STATES.ACKNOWLEDGED && acknowledgedAt != null) {
    throw new TypeError('acknowledged_at requires state "acknowledged"');
  }
  if (input.state === REMINDER_STATES.DISMISSED && dismissedAt == null) {
    throw new TypeError('dismissed reminder requires dismissed_at');
  }
  if (input.state !== REMINDER_STATES.DISMISSED && dismissedAt != null) {
    throw new TypeError('dismissed_at requires state "dismissed"');
  }
  return Object.freeze({
    id: input.id,
    title: input.title,
    source_type: input.source_type,
    source_id: input.source_id,
    kind: input.kind,
    scheduled_at: input.scheduled_at,
    timezone: input.timezone,
    state: input.state,
    created_at: input.created_at,
    acknowledged_at: acknowledgedAt,
    dismissed_at: dismissedAt,
  });
}

export function createReminder(input, { now } = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('createReminder expects an object');
  const createdAt = input.created_at ?? now;
  const id = input.id ?? createReminderIdentity(input);
  return validateReminder({
    ...input,
    id,
    state: input.state ?? REMINDER_STATES.SCHEDULED,
    created_at: createdAt,
    acknowledged_at: input.acknowledged_at ?? null,
    dismissed_at: input.dismissed_at ?? null,
  });
}

function replaceState(reminder, state, fields = {}) {
  return validateReminder({
    ...reminder,
    state,
    acknowledged_at: null,
    dismissed_at: null,
    ...fields,
  });
}

export function calculateReminderState(reminder, { now, timezone } = {}) {
  const current = validateReminder(reminder);
  const context = assertTemporalContext(now, timezone);
  if (current.state !== REMINDER_STATES.SCHEDULED) return current;
  const scheduledEpoch = instantForLocalDateTime(current.scheduled_at, current.timezone);
  return scheduledEpoch <= context.epoch ? replaceState(current, REMINDER_STATES.READY) : current;
}

export function acknowledgeReminder(reminder, { now, timezone } = {}) {
  const current = calculateReminderState(reminder, { now, timezone });
  if (current.state === REMINDER_STATES.ACKNOWLEDGED) return current;
  if (current.state !== REMINDER_STATES.READY) throw new Error(`Cannot acknowledge reminder in state "${current.state}"`);
  return replaceState(current, REMINDER_STATES.ACKNOWLEDGED, { acknowledged_at: now });
}

export function dismissReminder(reminder, { now, timezone } = {}) {
  const current = calculateReminderState(reminder, { now, timezone });
  if (current.state === REMINDER_STATES.DISMISSED) return current;
  if (![REMINDER_STATES.SCHEDULED, REMINDER_STATES.READY].includes(current.state)) {
    throw new Error(`Cannot dismiss reminder in state "${current.state}"`);
  }
  return replaceState(current, REMINDER_STATES.DISMISSED, { dismissed_at: now });
}

export function cancelReminder(reminder) {
  const current = validateReminder(reminder);
  if ([REMINDER_STATES.ACKNOWLEDGED, REMINDER_STATES.DISMISSED, REMINDER_STATES.CANCELLED].includes(current.state)) return current;
  return replaceState(current, REMINDER_STATES.CANCELLED);
}
