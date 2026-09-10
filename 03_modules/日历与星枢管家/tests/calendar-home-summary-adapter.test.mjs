import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CALENDAR_HOME_SUBLABEL_PRIORITY,
  CALENDAR_HOME_SUMMARY_CONTRACT_VERSION,
  CALENDAR_HOME_WIDGET_CONTRACT_VERSION,
  createCalendarHomeSummaryAdapter,
  createCalendarHomeWidgetAdapter,
} from '../src/index.mjs';

const NOW = '2026-09-02T08:30:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function todayFixture(date, overrides = {}) {
  return {
    date,
    fixed_calendar_events: [],
    confirmed_task_plans: [],
    unplaced_tasks: [],
    reminders: [],
    timeline: [],
    ...overrides,
  };
}

function setup(fixtures = new Map()) {
  const calls = [];
  const calendarApplication = {
    getToday(date, options) {
      calls.push({ method: 'getToday', date, options });
      return fixtures.get(date) ?? todayFixture(date);
    },
    execute() {
      calls.push({ method: 'execute' });
      throw new Error('Home Summary must remain read-only');
    },
  };
  const adapter = createCalendarHomeSummaryAdapter({
    calendarApplication,
    timezone: TIMEZONE,
    clock: () => NOW,
  });
  return { adapter, calendarApplication, calls };
}

test('V0.2 is an additive frozen public contract and leaves V0.1 untouched', () => {
  assert.equal(CALENDAR_HOME_SUMMARY_CONTRACT_VERSION, '0.2.0');
  assert.equal(CALENDAR_HOME_WIDGET_CONTRACT_VERSION, '0.1.0');
  const { adapter, calendarApplication } = setup();
  assert.equal(Object.isFrozen(adapter), true);
  assert.deepEqual(Object.keys(adapter).sort(), ['getDateSummary', 'getMonthSummary']);
  const legacy = createCalendarHomeWidgetAdapter({ calendarApplication, timezone: TIMEZONE, clock: () => NOW });
  assert.deepEqual(Object.keys(legacy).sort(), ['getTodaySummary', 'parseButlerInput']);
});

test('bounded ISO range returns one stable real summary per day plus today and handoffs', () => {
  const fixtures = new Map([
    ['2026-09-01', todayFixture('2026-09-01', {
      unplaced_tasks: [{ id: 'todo-1' }, { id: 'todo-2' }],
    })],
    ['2026-09-02', todayFixture('2026-09-02', {
      fixed_calendar_events: [{ id: 'event-1', title: '产品评审', status: 'confirmed' }],
      timeline: [{
        type: 'calendar_event', start_at: '2026-09-02T09:00:00+08:00',
        item: { id: 'event-1', title: '产品评审', is_happening_now: false },
      }],
    })],
    ['2026-09-03', todayFixture('2026-09-03')],
  ]);
  const { adapter, calls } = setup(fixtures);
  const summary = adapter.getMonthSummary({
    start_date: '2026-09-01',
    end_date: '2026-09-03',
  });

  assert.deepEqual(summary.range, { start_date: '2026-09-01', end_date: '2026-09-03' });
  assert.deepEqual(summary.dates.map((item) => item.date), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.equal(summary.dates[0].sublabel, '待办 2 项');
  assert.equal(summary.today_summary.date, '2026-09-02');
  assert.equal(summary.next_event.id, 'event-1');
  assert.deepEqual(summary.dates[2].detail_handoff, {
    route_id: 'today-tomorrow', action: 'view-date', date: '2026-09-03',
  });
  assert.deepEqual(summary.dates[2].edit_handoff, {
    route_id: 'today-tomorrow', action: 'edit-date', date: '2026-09-03',
  });
  assert.equal(summary.availability, 'available');
  assert.equal(summary.generated_at, NOW);
  assert.deepEqual(summary.freshness, {
    status: 'unknown', reason: 'source_timestamp_unavailable', generated_at: NOW,
  });
  assert.equal(calls.some((call) => call.method === 'execute'), false);
  assert.equal(calls.length, 3);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.dates), true);
});

test('sublabel priority is reminder, fixed schedule, todo, explicit holiday, event, empty', () => {
  const fixtures = new Map([
    ['2026-09-01', todayFixture('2026-09-01', {
      reminders: [{ title: '交付提醒', requires_attention: true }],
      fixed_calendar_events: [{ title: '日程', status: 'confirmed' }],
      unplaced_tasks: [{}],
    })],
    ['2026-09-02', todayFixture('2026-09-02', {
      confirmed_task_plans: [{ title: '固定会议' }],
      unplaced_tasks: [{}],
    })],
    ['2026-09-03', todayFixture('2026-09-03', { unplaced_tasks: [{}, {}] })],
    ['2026-09-04', todayFixture('2026-09-04', {
      fixed_calendar_events: [{ title: '中秋节', kind: 'holiday', status: 'confirmed' }],
    })],
    ['2026-09-05', todayFixture('2026-09-05', {
      fixed_calendar_events: [{ title: '暂定交流', status: 'tentative' }],
    })],
    ['2026-09-06', todayFixture('2026-09-06')],
  ]);
  const { adapter } = setup(fixtures);
  const dates = adapter.getMonthSummary({ start_date: '2026-09-01', end_date: '2026-09-06' }).dates;
  assert.deepEqual(dates.map((item) => item.sublabel_kind), [
    'important_reminder', 'fixed_schedule', 'todo_count', 'holiday', 'event', 'empty',
  ]);
  assert.deepEqual(dates.map((item) => item.sublabel_priority), [
    CALENDAR_HOME_SUBLABEL_PRIORITY.IMPORTANT_REMINDER,
    CALENDAR_HOME_SUBLABEL_PRIORITY.FIXED_SCHEDULE,
    CALENDAR_HOME_SUBLABEL_PRIORITY.TODO_COUNT,
    CALENDAR_HOME_SUBLABEL_PRIORITY.HOLIDAY,
    CALENDAR_HOME_SUBLABEL_PRIORITY.EVENT,
    CALENDAR_HOME_SUBLABEL_PRIORITY.EMPTY,
  ]);
  assert.equal(dates[3].holiday_label, '中秋节');
  assert.equal(dates[5].sublabel, '暂无安排');
});

test('arbitrary-date summary exposes truthful counts and does not invent holiday labels', () => {
  const fixtures = new Map([
    ['2026-10-12', todayFixture('2026-10-12', {
      fixed_calendar_events: [{ id: 'event-1', title: '普通会议', status: 'confirmed' }],
      unplaced_tasks: [{ id: 'todo-1' }],
    })],
  ]);
  const { adapter } = setup(fixtures);
  const summary = adapter.getDateSummary({ date: '2026-10-12' });
  assert.equal(summary.date, '2026-10-12');
  assert.equal(summary.event_count, 1);
  assert.equal(summary.todo_count, 1);
  assert.equal(summary.holiday_label, null);
  assert.equal(summary.anniversary_label, null);
  assert.equal(summary.detail_handoff.date, '2026-10-12');
  assert.equal(summary.edit_handoff.date, '2026-10-12');
});

test('invalid or oversized ranges fail closed before any calendar write surface', () => {
  const { adapter, calls } = setup();
  assert.throws(() => adapter.getMonthSummary({ start_date: '2026-09-30', end_date: '2026-09-01' }), /earlier/);
  assert.throws(() => adapter.getMonthSummary({ start_date: '2026-01-01', end_date: '2026-04-01' }), /62 days/);
  assert.throws(() => adapter.getMonthSummary({ start_date: '2026-02-30', end_date: '2026-03-01' }), /ISO date/);
  assert.equal(calls.length, 0);
});

