import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryEventStore } from '../src/storage/in-memory-store.mjs';
import { CalendarService, CalendarEventNotFoundError } from '../src/services/calendar-service.mjs';

const T0 = '2026-08-10T08:00:00+08:00';
const T1 = '2026-08-10T09:00:00+08:00';

function service(options) {
  return new CalendarService(createInMemoryEventStore(), options);
}

function timed(id, overrides = {}) {
  return {
    id,
    title: `Event ${id}`,
    start_at: '2026-08-10T10:00:00+08:00',
    end_at: '2026-08-10T11:00:00+08:00',
    timezone: 'Asia/Shanghai',
    ...overrides,
  };
}

test('CalendarService creates and gets a timed event with explicit now/timezone', () => {
  const calendar = service();
  const event = calendar.createEvent(timed('event_1', {
    created_at: '2000-01-01T00:00:00Z', updated_at: '2000-01-01T00:00:00Z',
  }), { now: T0 });
  assert.equal(event.created_at, T0);
  assert.equal(event.updated_at, T0);
  assert.equal(event.timezone, 'Asia/Shanghai');
  assert.equal(calendar.getEvent('event_1'), event);
});

test('CalendarService can generate a local id while preserving external id separation', () => {
  const calendar = service({ idFactory: () => 'event_generated' });
  const event = calendar.createEvent(timed(undefined, {
    id: undefined, source: 'notion', external_id: 'external_event_1',
  }), { now: T0 });
  assert.equal(event.id, 'event_generated');
  assert.equal(event.external_id, 'external_event_1');
  assert.notEqual(event.id, event.external_id);
});

test('CalendarService update preserves identity and uses explicit now', () => {
  const calendar = service();
  calendar.createEvent(timed('event_update'), { now: T0 });
  const updated = calendar.updateEvent('event_update', { location: 'Room B' }, { now: T1 });
  assert.equal(updated.id, 'event_update');
  assert.equal(updated.created_at, T0);
  assert.equal(updated.updated_at, T1);
  assert.equal(updated.location, 'Room B');
  assert.equal(calendar.getEvent('event_update').updated_at, T1);
});

test('CalendarService supports all-day events', () => {
  const calendar = service();
  const event = calendar.createEvent({
    id: 'all_day', title: 'All day', start_at: '2026-08-12', end_at: '2026-08-12',
    all_day: true, timezone: 'Asia/Shanghai',
  }, { now: T0 });
  assert.equal(event.all_day, true);
  assert.equal(event.start_at, '2026-08-12');
});

test('CalendarService rejects invalid ranges and requires explicit now', () => {
  const calendar = service();
  assert.throws(() => calendar.createEvent(timed('bad', {
    start_at: '2026-08-10T12:00:00+08:00', end_at: '2026-08-10T11:00:00+08:00',
  }), { now: T0 }), /earlier than start/);
  assert.throws(() => calendar.createEvent(timed('no_clock')), /now/);
  calendar.createEvent(timed('update_no_clock'), { now: T0 });
  assert.throws(() => calendar.updateEvent('update_no_clock', { title: 'No clock' }), /now/);
});

test('CalendarService list uses source and event-window overlap', () => {
  const calendar = service();
  calendar.createEvent(timed('overnight', {
    start_at: '2026-08-10T23:00:00+08:00', end_at: '2026-08-11T01:00:00+08:00',
  }), { now: T0 });
  calendar.createEvent(timed('notion_event', {
    start_at: '2026-08-20T10:00:00+08:00', end_at: '2026-08-20T11:00:00+08:00',
    source: 'notion', external_id: 'notion_1',
  }), { now: T0 });
  assert.deepEqual(calendar.listEvents({ start_at: '2026-08-11', end_at: '2026-08-11' }).map((event) => event.id), ['overnight']);
  assert.deepEqual(calendar.listEvents({ source: 'notion' }).map((event) => event.id), ['notion_event']);
});

test('CalendarService delete and missing update behavior are explicit', () => {
  const calendar = service();
  calendar.createEvent(timed('delete_event'), { now: T0 });
  assert.equal(calendar.deleteEvent('delete_event'), true);
  assert.equal(calendar.deleteEvent('delete_event'), false);
  assert.equal(calendar.getEvent('delete_event'), null);
  assert.throws(() => calendar.updateEvent('missing', {}, { now: T1 }), CalendarEventNotFoundError);
});
