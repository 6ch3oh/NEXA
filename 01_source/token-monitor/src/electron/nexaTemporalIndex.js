'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const FIELDS = Object.freeze([
  'event_id', 'occurred_at', 'recorded_at', 'source_module', 'event_type', 'category', 'subject_id',
  'title', 'summary', 'source_record_ref', 'provenance', 'sensitivity', 'confidence', 'dedup_group_id', 'schema_version'
]);

function error(code, message) { return Object.assign(new TypeError(message), { code }); }
function bounded(value, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function clone(value) { return structuredClone(value); }
function validInstant(value) { const at = Date.parse(value); return Number.isFinite(at) ? new Date(at).toISOString() : ''; }

function normalizeEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('TEMPORAL_EVENT_INVALID', 'event must be an object');
  const sensitivity = ['normal', 'private', 'restricted'].includes(value.sensitivity) ? value.sensitivity : 'normal';
  const occurredAt = validInstant(value.occurred_at);
  const recordedAt = validInstant(value.recorded_at);
  if (!bounded(value.event_id, 200) || !occurredAt || !recordedAt || !bounded(value.source_module, 100) || !bounded(value.event_type, 100)) {
    throw error('TEMPORAL_EVENT_INVALID', 'event identity, timestamps, source and type are required');
  }
  return Object.freeze({
    event_id: bounded(value.event_id, 200), occurred_at: occurredAt, recorded_at: recordedAt,
    source_module: bounded(value.source_module, 100), event_type: bounded(value.event_type, 100), category: bounded(value.category, 100),
    subject_id: bounded(value.subject_id, 200),
    title: sensitivity === 'normal' ? bounded(value.title, 300) : '受限内容',
    summary: sensitivity === 'normal' ? bounded(value.summary, 1000) : '',
    source_record_ref: bounded(value.source_record_ref, 500),
    provenance: value.provenance && typeof value.provenance === 'object' ? clone(value.provenance) : {},
    sensitivity, confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    dedup_group_id: bounded(value.dedup_group_id, 200), schema_version: SCHEMA_VERSION,
  });
}

function empty() { return { schema_version: SCHEMA_VERSION, rebuilt_at: null, events: [] }; }
function read(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (value?.schema_version !== SCHEMA_VERSION || !Array.isArray(value.events)) throw new Error('shape');
    return { ...value, events: value.events.map(normalizeEvent) };
  } catch (cause) {
    if (cause?.code === 'ENOENT') return empty();
    throw error('TEMPORAL_INDEX_CORRUPT', 'temporal index cannot be read');
  }
}
function persist(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}
function localDate(instant, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant)).filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function createNexaTemporalIndex({ filePath, clock = () => new Date().toISOString() } = {}) {
  if (!path.isAbsolute(filePath || '')) throw error('TEMPORAL_INDEX_PATH_INVALID', 'absolute filePath required');
  let document = read(filePath);
  function snapshot(rows) { return Object.freeze(rows.map((item) => Object.freeze(clone(item)))); }
  return Object.freeze({
    get path() { return filePath; },
    rebuild(events) {
      const byId = new Map();
      for (const value of Array.isArray(events) ? events : []) byId.set(value?.event_id, normalizeEvent(value));
      document = { schema_version: SCHEMA_VERSION, rebuilt_at: clock(), events: [...byId.values()].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_id.localeCompare(b.event_id)) };
      persist(filePath, document); return Object.freeze({ indexed: document.events.length, rebuilt_at: document.rebuilt_at });
    },
    upsert(events) {
      const byId = new Map(document.events.map((item) => [item.event_id, item]));
      for (const value of Array.isArray(events) ? events : [events]) { const item = normalizeEvent(value); byId.set(item.event_id, item); }
      return this.rebuild([...byId.values()]);
    },
    queryByType(eventType, { startAt = '', endAt = '' } = {}) {
      return snapshot(document.events.filter((item) => item.event_type === eventType && (!startAt || item.occurred_at >= startAt) && (!endAt || item.occurred_at <= endAt)));
    },
    queryByDate(date, { timezone = 'Asia/Shanghai' } = {}) {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw error('TEMPORAL_DATE_INVALID', 'date must be YYYY-MM-DD');
      return snapshot(document.events.filter((item) => localDate(item.occurred_at, timezone) === date));
    },
    dayLens(date, options = {}) {
      const events = this.queryByDate(date, options);
      const counts = {};
      for (const item of events) counts[item.event_type] = (counts[item.event_type] || 0) + 1;
      return Object.freeze({ schema_version: SCHEMA_VERSION, date, event_count: events.length, counts: Object.freeze(counts), events });
    },
    inventory() {
      const times = document.events.map((item) => item.occurred_at).sort();
      return Object.freeze({ schema_version: SCHEMA_VERSION, format: 'json-query-index', count: document.events.length, earliest_at: times[0] || null, latest_at: times.at(-1) || null, rebuildable: true, authoritative: false, fields: FIELDS });
    }
  });
}

module.exports = { FIELDS, SCHEMA_VERSION, createNexaTemporalIndex, normalizeEvent };
