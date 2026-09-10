import { createHash } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { validateReminder } from '../domain/reminder.mjs';

export const NOTIFICATION_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

export function createNotificationIntentIdentity(reminderId) {
  nonEmpty(reminderId, 'reminder_id');
  return `intent_${createHash('sha256').update(reminderId).digest('hex').slice(0, 32)}`;
}

export function validateNotificationIntent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Notification Intent must be an object');
  nonEmpty(input.intent_id, 'intent_id');
  nonEmpty(input.reminder_id, 'reminder_id');
  nonEmpty(input.title, 'title');
  if (typeof input.body !== 'string') throw new TypeError('body must be a string');
  if (!isValidIsoTimestamp(input.scheduled_at)) throw new TypeError('scheduled_at must be a valid ISO timestamp');
  nonEmpty(input.timezone, 'timezone');
  if (!NOTIFICATION_PRIORITIES.includes(input.priority)) throw new TypeError(`Invalid notification priority "${input.priority}"`);
  if (!['task', 'calendar_event'].includes(input.source_type)) throw new TypeError(`Invalid source_type "${input.source_type}"`);
  nonEmpty(input.source_id, 'source_id');
  return Object.freeze({
    intent_id: input.intent_id,
    reminder_id: input.reminder_id,
    title: input.title,
    body: input.body,
    scheduled_at: input.scheduled_at,
    timezone: input.timezone,
    priority: input.priority,
    source_type: input.source_type,
    source_id: input.source_id,
  });
}

export function createNotificationIntent({ reminder, title, body = '', priority = 'normal' } = {}) {
  const normalized = validateReminder(reminder);
  return validateNotificationIntent({
    intent_id: createNotificationIntentIdentity(normalized.id),
    reminder_id: normalized.id,
    title: title ?? normalized.title,
    body,
    scheduled_at: normalized.scheduled_at,
    timezone: normalized.timezone,
    priority,
    source_type: normalized.source_type,
    source_id: normalized.source_id,
  });
}
