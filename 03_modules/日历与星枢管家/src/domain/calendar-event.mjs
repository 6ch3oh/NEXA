import { isValidIsoDateOrTimestamp } from '../date/deterministic-parser.mjs';

export const EVENT_STATUSES = Object.freeze({
  TENTATIVE: 'tentative',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
});

export const EVENT_STATUS_LIST = Object.freeze(Object.values(EVENT_STATUSES));

export const LOCAL_SOURCE = 'local';

const DEFAULT_STATUS = EVENT_STATUSES.CONFIRMED;

function nowIso() {
  return new Date().toISOString();
}

function freezeDeep(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep));
  if (value && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freezeDeep(v)])),
    );
  }
  return value;
}

export function validateCalendarEvent(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Calendar event input must be an object');
  }
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new TypeError('Calendar event id must be a non-empty string');
  }
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw new TypeError('Calendar event title must be a non-empty string');
  }
  if (typeof input.description !== 'string') {
    throw new TypeError('Calendar event description must be a string');
  }
  if (typeof input.all_day !== 'boolean') {
    throw new TypeError('Calendar event all_day must be a boolean');
  }
  if (typeof input.location !== 'string') {
    throw new TypeError('Calendar event location must be a string');
  }
  if (typeof input.source !== 'string' || input.source.trim() === '') {
    throw new TypeError('Calendar event source must be a non-empty string');
  }
  if (!EVENT_STATUS_LIST.includes(input.status)) {
    throw new TypeError(`Invalid calendar event status "${input.status}"`);
  }
  if (input.timezone != null && (typeof input.timezone !== 'string' || input.timezone.trim() === '')) {
    throw new TypeError('Calendar event timezone must be a non-empty string when provided');
  }
  if (input.external_id != null) {
    if (typeof input.external_id !== 'string' || input.external_id.trim() === '') {
      throw new TypeError('Calendar event external_id must be a non-empty string when provided');
    }
    if (input.external_id === input.id) {
      throw new TypeError('Calendar event external_id must differ from the local id');
    }
  }
  if (input.start_at == null || !isValidIsoDateOrTimestamp(input.start_at)) {
    throw new TypeError(`Calendar event start_at must be a valid ISO date or timestamp, got "${input.start_at}"`);
  }
  if (input.end_at != null && !isValidIsoDateOrTimestamp(input.end_at)) {
    throw new TypeError(`Calendar event end_at must be a valid ISO date or timestamp, got "${input.end_at}"`);
  }
  if (!input.all_day) {
    if (input.end_at == null) {
      throw new TypeError('Timed calendar event requires end_at');
    }
    if (!String(input.start_at).includes('T') || !String(input.end_at).includes('T')) {
      throw new TypeError('Timed calendar event requires start_at and end_at to include a time');
    }
  }
  if (input.end_at != null && input.end_at < input.start_at) {
    throw new TypeError('Calendar event end_at must not be earlier than start_at');
  }
  if (!isValidIsoDateOrTimestamp(input.created_at)) {
    throw new TypeError(`Invalid ISO timestamp for calendar event.created_at: "${input.created_at}"`);
  }
  if (!isValidIsoDateOrTimestamp(input.updated_at)) {
    throw new TypeError(`Invalid ISO timestamp for calendar event.updated_at: "${input.updated_at}"`);
  }
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    start_at: input.start_at,
    end_at: input.end_at ?? null,
    all_day: input.all_day,
    timezone: input.timezone ?? null,
    location: input.location,
    status: input.status,
    source: input.source,
    external_id: input.external_id ?? null,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

export function createCalendarEvent(input, { now } = {}) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('createCalendarEvent expects an object');
  }
  const ts = now ?? nowIso();
  const base = {
    ...input,
    description: input.description ?? '',
    all_day: input.all_day === true,
    location: input.location ?? '',
    status: input.status ?? DEFAULT_STATUS,
    source: input.source ?? LOCAL_SOURCE,
    external_id: input.external_id ?? null,
    created_at: input.created_at ?? ts,
    updated_at: input.updated_at ?? ts,
  };
  return freezeDeep(validateCalendarEvent(base));
}

export function updateCalendarEvent(event, patch, { now } = {}) {
  if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
    throw new TypeError('updateCalendarEvent expects an existing event');
  }
  if (!patch || typeof patch !== 'object') {
    throw new TypeError('updateCalendarEvent expects a patch object');
  }
  const ts = now ?? nowIso();
  const merged = { ...event, ...patch, id: event.id, created_at: event.created_at, updated_at: ts };
  return freezeDeep(validateCalendarEvent(merged));
}

export function cancelEvent(event, { now } = {}) {
  return updateCalendarEvent(event, { status: EVENT_STATUSES.CANCELLED }, { now });
}

export function isAllDay(event) {
  return event.all_day === true;
}

export function isTimed(event) {
  return event.all_day !== true;
}
