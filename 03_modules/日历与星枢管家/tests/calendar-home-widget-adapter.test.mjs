import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CALENDAR_HOME_WIDGET_CONTRACT_VERSION,
  createCalendarHomeWidgetAdapter,
} from '../src/index.mjs';
import { UnsupportedDateFormatError } from '../src/date/deterministic-parser.mjs';

const NOW = '2026-08-13T08:30:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function todayFixture() {
  return {
    date: '2026-08-13',
    fixed_calendar_events: [
      { id: 'past', title: 'Past event', is_happening_now: false },
      { id: 'next', title: 'Next event', is_happening_now: false },
    ],
    confirmed_task_plans: [{ plan_id: 'p1' }],
    unplaced_tasks: [{ id: 't2' }, { id: 't3' }],
    timeline: [
      { type: 'calendar_event', start_at: '2026-08-13T08:00:00+08:00', item: { id: 'past', title: 'Past event', is_happening_now: false } },
      { type: 'reminder', start_at: '2026-08-13T08:45:00+08:00', item: { id: 'reminder' } },
      { type: 'calendar_event', start_at: '2026-08-13T09:00:00+08:00', item: { id: 'next', title: 'Next event', is_happening_now: false } },
      { type: 'task_plan', start_at: '2026-08-13T10:00:00+08:00', item: { plan_id: 'p1' } },
    ],
  };
}

function setup(now = NOW) {
  const calls = [];
  const calendarApplication = {
    getToday(date, options) {
      calls.push({ method: 'getToday', date, options });
      return todayFixture();
    },
    execute() {
      calls.push({ method: 'execute' });
      throw new Error('widget must remain read-only');
    },
  };
  const adapter = createCalendarHomeWidgetAdapter({
    calendarApplication,
    timezone: TIMEZONE,
    clock: () => now,
  });
  return { adapter, calls };
}

test('public widget contract is versioned and exposes only two frozen adapter operations', () => {
  assert.equal(CALENDAR_HOME_WIDGET_CONTRACT_VERSION, '0.1.0');
  const { adapter } = setup();
  assert.equal(Object.isFrozen(adapter), true);
  assert.deepEqual(Object.keys(adapter).sort(), ['getTodaySummary', 'parseButlerInput']);
});

test('Today Summary is a read-only projection of the existing Today ViewModel', () => {
  const { adapter, calls } = setup();
  const summary = adapter.getTodaySummary();

  assert.deepEqual(Object.keys(summary), ['date', 'events', 'next_event', 'todo_count', 'timeline']);
  assert.equal(summary.date, '2026-08-13');
  assert.deepEqual(summary.events.map((item) => item.id), ['past', 'next']);
  assert.equal(summary.next_event.id, 'next');
  assert.equal(summary.todo_count, 3);
  assert.deepEqual(summary.timeline.map((item) => item.type), ['calendar_event', 'reminder', 'calendar_event', 'task_plan']);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.events), true);
  assert.equal(Object.isFrozen(summary.timeline), true);
  assert.deepEqual(calls, [{ method: 'getToday', date: '2026-08-13', options: { now: NOW } }]);
});

test('default date is derived in the configured timezone and explicit date remains supported', () => {
  const { adapter, calls } = setup('2026-08-12T16:30:00Z');
  adapter.getTodaySummary();
  adapter.getTodaySummary({ date: '2026-08-14', now: '2026-08-14T09:00:00+08:00' });
  assert.equal(calls[0].date, '2026-08-13');
  assert.equal(calls[1].date, '2026-08-14');
});

test('next event can be an event already happening and is null when no event remains', () => {
  const happeningApplication = {
    getToday() {
      const today = todayFixture();
      today.timeline[0].item.is_happening_now = true;
      return today;
    },
  };
  const happening = createCalendarHomeWidgetAdapter({ calendarApplication: happeningApplication, timezone: TIMEZONE, clock: () => NOW });
  assert.equal(happening.getTodaySummary().next_event.id, 'past');

  const { adapter } = setup('2026-08-13T23:00:00+08:00');
  assert.equal(adapter.getTodaySummary().next_event, null);
});

test('Butler input delegates to the existing deterministic calendar parser without guessing', () => {
  const { adapter, calls } = setup();
  const exact = adapter.parseButlerInput('2026年8月13日下午2:30');
  assert.equal(exact.time_state, 'exact');
  assert.equal(exact.start_at, '2026-08-13T14:30:00');
  assert.equal(exact.timezone, TIMEZONE);

  const relative = adapter.parseButlerInput('明天下午开会');
  assert.equal(relative.time_state, 'relative_unresolved');
  assert.equal(relative.start_at, null);
  assert.equal(calls.length, 0);
  assert.throws(() => adapter.parseButlerInput('随便写点什么'), UnsupportedDateFormatError);
});

test('factory and summary fail closed on invalid host contracts', () => {
  assert.throws(() => createCalendarHomeWidgetAdapter({ timezone: TIMEZONE, clock: () => NOW }), /getToday/);
  assert.throws(() => createCalendarHomeWidgetAdapter({ calendarApplication: { getToday() {} }, timezone: '', clock: () => NOW }), /timezone/);
  assert.throws(() => createCalendarHomeWidgetAdapter({ calendarApplication: { getToday() {} }, timezone: TIMEZONE }), /clock/);

  const { adapter } = setup('not-a-time');
  assert.throws(() => adapter.getTodaySummary(), /explicit ISO timestamp/);
  assert.throws(() => adapter.getTodaySummary({ date: '2026-02-30', now: NOW }), /ISO date/);
});
