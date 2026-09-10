import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  createTask,
  updateTask,
  completeTask,
  cancelTask,
  blockedBy,
  hasDependencies,
  hasUncompletedDependencies,
  allDependenciesCompleted,
  isTaskBlocked,
} from '../src/domain/task.mjs';
import {
  EVENT_STATUSES,
  createCalendarEvent,
  updateCalendarEvent,
  isAllDay,
  isTimed,
} from '../src/domain/calendar-event.mjs';
import { TEMPORAL_STATES, assertTemporalState } from '../src/domain/temporal-state.mjs';
import {
  createDay,
  createWeek,
  createMonth,
  addDays,
  buildMonthWeeks,
  dayOfWeekMonday0,
  weekStartMondayOf,
} from '../src/domain/schedule-view.mjs';

function loadJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

test('temporal state contract exposes all five states', () => {
  assert.equal(TEMPORAL_STATES.EXACT, 'exact');
  assert.equal(TEMPORAL_STATES.DATE_ONLY, 'date_only');
  assert.equal(TEMPORAL_STATES.AMBIGUOUS, 'ambiguous');
  assert.equal(TEMPORAL_STATES.RELATIVE_UNRESOLVED, 'relative_unresolved');
  assert.equal(TEMPORAL_STATES.UNSCHEDULED, 'unscheduled');
  assert.doesNotThrow(() => assertTemporalState(TEMPORAL_STATES.UNSCHEDULED));
  assert.throws(() => assertTemporalState('guessed'), TypeError);
});

test('task: creates with default status pending and priority normal', () => {
  const task = createTask({ id: 't1', title: 'Buy milk' });
  assert.equal(task.status, TASK_STATUSES.PENDING);
  assert.equal(task.priority, TASK_PRIORITIES.NORMAL);
  assert.equal(task.time_state, TEMPORAL_STATES.UNSCHEDULED);
  assert.equal(task.dependencies.length, 0);
  assert.equal(task.source, 'local');
  assert.equal(task.external_id, null);
});

test('task: accepts high priority and in_progress status', () => {
  const task = createTask({
    id: 't2',
    title: 'Fix blocker',
    status: TASK_STATUSES.IN_PROGRESS,
    priority: TASK_PRIORITIES.HIGH,
    start_at: '2026-08-10T09:00:00+08:00',
    due_at: '2026-08-10T18:00:00+08:00',
    timezone: 'Asia/Shanghai',
  });
  assert.equal(task.status, TASK_STATUSES.IN_PROGRESS);
  assert.equal(task.priority, TASK_PRIORITIES.HIGH);
  assert.equal(task.time_state, TEMPORAL_STATES.EXACT);
});

test('task: rejects invalid status, invalid priority and empty title', () => {
  assert.throws(() => createTask({ id: 'x', title: 'a', status: 'done' }), TypeError);
  assert.throws(() => createTask({ id: 'x', title: 'a', priority: 'top' }), TypeError);
  assert.throws(() => createTask({ id: 'x', title: '   ' }), TypeError);
  assert.throws(() => createTask({ id: '', title: 'a' }), TypeError);
});

test('task: local and external id are strictly separated', () => {
  const task = createTask({ id: 'local_t', title: 'Sync me', source: 'notion', external_id: 'page_1' });
  assert.notEqual(task.id, task.external_id);
  assert.throws(
    () => createTask({ id: 'page_1', title: 'bad', source: 'notion', external_id: 'page_1' }),
    /external_id/,
  );
});

test('task: rejects self dependency and reports blocked_by', () => {
  assert.throws(
    () => createTask({ id: 'self', title: 'a', dependencies: ['self'] }),
    /depend on itself/,
  );
  const a = createTask({ id: 'a', title: 'A' });
  const b = createTask({ id: 'b', title: 'B', dependencies: ['a'] });
  assert.deepEqual(blockedBy(b), ['a']);
  assert.equal(hasDependencies(b), true);
  assert.equal(hasDependencies(a), false);
  const byId = { a, b };
  assert.equal(hasUncompletedDependencies(b, byId), true);
  assert.equal(isTaskBlocked(b, byId), true);
  assert.equal(allDependenciesCompleted(b, byId), false);
});

test('task: dependency completed unblocks dependent', () => {
  const a = createTask({ id: 'a', title: 'A' });
  const b = createTask({ id: 'b', title: 'B', dependencies: ['a'] });
  const doneA = completeTask(a, { now: '2026-08-10T12:00:00+08:00' });
  const byId = { a: doneA, b };
  assert.equal(hasUncompletedDependencies(b, byId), false);
  assert.equal(isTaskBlocked(b, byId), false);
  assert.equal(allDependenciesCompleted(b, byId), true);
});

test('task: no dependency means not blocked and not all-completed', () => {
  const a = createTask({ id: 'a', title: 'A' });
  const byId = { a };
  assert.equal(hasUncompletedDependencies(a, byId), false);
  assert.equal(allDependenciesCompleted(a, byId), false);
});

test('task: complete sets status and completed_at; cancel works', () => {
  const task = createTask({ id: 'c', title: 'C' });
  const done = completeTask(task, { now: '2026-08-10T12:00:00+08:00' });
  assert.equal(done.status, TASK_STATUSES.COMPLETED);
  assert.equal(done.completed_at, '2026-08-10T12:00:00+08:00');
  const cancelled = cancelTask(done, { now: '2026-08-10T13:00:00+08:00' });
  assert.equal(cancelled.status, TASK_STATUSES.CANCELLED);
  assert.equal(cancelled.completed_at, null);
  assert.equal(cancelled.updated_at, '2026-08-10T13:00:00+08:00');
  assert.equal(cancelled.created_at, done.created_at);
});

test('task: completed_at consistency rules are enforced', () => {
  assert.throws(
    () => createTask({ id: 'x', title: 'a', status: TASK_STATUSES.COMPLETED }),
    /requires completed_at/,
  );
  assert.throws(
    () =>
      createTask({
        id: 'x',
        title: 'a',
        status: TASK_STATUSES.PENDING,
        completed_at: '2026-08-10T12:00:00+08:00',
      }),
    /requires status "completed"/,
  );
});

test('task: due_at before start_at is rejected', () => {
  assert.throws(
    () =>
      createTask({
        id: 'x',
        title: 'a',
        start_at: '2026-08-10T18:00:00+08:00',
        due_at: '2026-08-10T09:00:00+08:00',
      }),
    /due_at/,
  );
});

test('task: date_only and unscheduled temporal states', () => {
  const dateOnly = createTask({ id: 'x', title: 'a', due_at: '2026-08-20', timezone: 'Asia/Shanghai' });
  assert.equal(dateOnly.time_state, TEMPORAL_STATES.DATE_ONLY);
  const explicit = createTask({ id: 'y', title: 'a', time_state: TEMPORAL_STATES.AMBIGUOUS });
  assert.equal(explicit.time_state, TEMPORAL_STATES.AMBIGUOUS);
});

test('task: updateTask preserves id/created_at and bumps updated_at', () => {
  const task = createTask({ id: 'u', title: 'Before' });
  const next = updateTask(task, { title: 'After' }, { now: '2026-08-10T15:00:00+08:00' });
  assert.equal(next.id, 'u');
  assert.equal(next.title, 'After');
  assert.equal(next.created_at, task.created_at);
  assert.equal(next.updated_at, '2026-08-10T15:00:00+08:00');
});

test('calendar event: timed event requires start/end with time', () => {
  const event = createCalendarEvent({
    id: 'e1',
    title: 'Meeting',
    start_at: '2026-08-10T10:00:00+08:00',
    end_at: '2026-08-10T11:00:00+08:00',
  });
  assert.equal(isTimed(event), true);
  assert.equal(isAllDay(event), false);
  assert.equal(event.status, EVENT_STATUSES.CONFIRMED);
  assert.throws(
    () => createCalendarEvent({ id: 'e2', title: 'No end', start_at: '2026-08-10T10:00:00+08:00' }),
    /end_at/,
  );
  assert.throws(
    () =>
      createCalendarEvent({
        id: 'e3',
        title: 'Date only timed',
        start_at: '2026-08-10',
        end_at: '2026-08-11',
      }),
    /include a time/,
  );
});

test('calendar event: all-day event allows date-only bounds', () => {
  const event = createCalendarEvent({
    id: 'e4',
    title: 'All day',
    start_at: '2026-08-15',
    end_at: '2026-08-15',
    all_day: true,
  });
  assert.equal(isAllDay(event), true);
  assert.equal(event.start_at, '2026-08-15');
});

test('calendar event: rejects end before start', () => {
  assert.throws(
    () =>
      createCalendarEvent({
        id: 'e5',
        title: 'Reversed',
        start_at: '2026-08-10T11:00:00+08:00',
        end_at: '2026-08-10T10:00:00+08:00',
      }),
    /earlier than start/,
  );
});

test('calendar event: local/external id separation and update', () => {
  const event = createCalendarEvent({
    id: 'local_e',
    title: 'Sync',
    source: 'notion',
    external_id: 'notion_event_1',
    start_at: '2026-08-12T14:00:00+08:00',
    end_at: '2026-08-12T15:00:00+08:00',
  });
  assert.notEqual(event.id, event.external_id);
  assert.throws(
    () =>
      createCalendarEvent({
        id: 'page_1',
        title: 'bad',
        external_id: 'page_1',
        start_at: '2026-08-12T14:00:00+08:00',
        end_at: '2026-08-12T15:00:00+08:00',
      }),
    /external_id/,
  );
  const updated = updateCalendarEvent(event, { location: 'Room B' }, { now: '2026-08-11T09:00:00+08:00' });
  assert.equal(updated.location, 'Room B');
  assert.equal(updated.id, 'local_e');
});

test('schedule view: createDay carries date/events/tasks', () => {
  const day = createDay('2026-08-10', { events: [{ id: 'e' }], tasks: [{ id: 't' }] });
  assert.equal(day.date, '2026-08-10');
  assert.equal(day.events.length, 1);
  assert.equal(day.tasks.length, 1);
  assert.throws(() => createDay('2026-08-10T10:00:00'), TypeError);
});

test('schedule view: createWeek builds 7 days with week end', () => {
  const week = createWeek('2026-08-10');
  assert.equal(week.week_start, '2026-08-10');
  assert.equal(week.week_end, '2026-08-16');
  assert.equal(week.days.length, 7);
  assert.equal(week.days[6], '2026-08-16');
});

test('schedule view: addDays is leap-year correct and does not roll over', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dayOfWeekMonday0('2026-08-10'), 0);
  assert.equal(weekStartMondayOf('2026-08-13'), '2026-08-10');
});

test('schedule view: createMonth builds grid weeks containing all month days', () => {
  const month = createMonth(2026, 8);
  assert.equal(month.year, 2026);
  assert.equal(month.month, 8);
  assert.equal(month.days, null);
  assert.ok(Array.isArray(month.weeks) && month.weeks.length > 0);
  const inMonth = month.weeks.flatMap((w) => w.days.filter((d) => d.in_month));
  assert.equal(inMonth.length, 31);
  for (const week of month.weeks) {
    assert.equal(week.days.length, 7);
    assert.equal(addDays(week.week_start, 6), week.week_end);
  }
});

test('schedule view: createMonth accepts explicit days or weeks only', () => {
  const withDays = createMonth(2026, 8, { days: ['2026-08-01', '2026-08-02'] });
  assert.deepEqual(withDays.days, ['2026-08-01', '2026-08-02']);
  assert.equal(withDays.weeks, null);
  assert.throws(() => createMonth(2026, 8, { weeks: [], days: [] }), /either/);
  assert.throws(() => createMonth(2026, 13), TypeError);
});

test('fixtures: every task fixture is valid and covers required cases', () => {
  const { tasks } = loadJson('../fixtures/tasks.json');
  assert.ok(tasks.length >= 5, 'expected at least 5 task fixtures');
  const created = tasks.map((t) => createTask(t));
  assert.ok(created.some((t) => t.priority === TASK_PRIORITIES.HIGH));
  assert.ok(created.some((t) => t.dependencies.length > 0));
  assert.ok(created.some((t) => t.time_state === TEMPORAL_STATES.DATE_ONLY));
  assert.ok(created.some((t) => t.time_state === TEMPORAL_STATES.UNSCHEDULED));
  assert.ok(created.some((t) => t.source === 'notion' && t.external_id !== null));
});

test('fixtures: every event fixture is valid and covers timed/all-day/external', () => {
  const { events } = loadJson('../fixtures/events.json');
  assert.ok(events.length >= 3);
  const created = events.map((e) => createCalendarEvent(e));
  assert.ok(created.some((e) => isTimed(e)));
  assert.ok(created.some((e) => isAllDay(e)));
  assert.ok(created.some((e) => e.source === 'notion' && e.external_id !== null));
});
