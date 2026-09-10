import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createTask } from '../src/domain/task.mjs';
import { createCalendarEvent } from '../src/domain/calendar-event.mjs';
import { createCommand } from '../src/commands/contract.mjs';
import { createTaskViewModel } from '../src/view-models/task-view-model.mjs';
import { createCalendarEventViewModel } from '../src/view-models/calendar-event-view-model.mjs';
import {
  createDayViewModel,
  createWeekViewModel,
  createMonthViewModel,
} from '../src/view-models/schedule-view-model.mjs';
import { createButlerDashboardViewModel } from '../src/view-models/butler-dashboard-view-model.mjs';

function loadFixture() {
  const raw = JSON.parse(readFileSync(new URL('../fixtures/rule-cases.json', import.meta.url), 'utf8'));
  return {
    now: raw.now,
    timezone: raw.timezone,
    tasks: raw.tasks.map((item) => createTask(item)),
    events: raw.events.map((item) => createCalendarEvent(item)),
    commands: raw.commands.map((item) => createCommand(item)),
  };
}

test('Task ViewModel exposes stable display and attention fields', () => {
  const input = loadFixture();
  const task = input.tasks.find((item) => item.id === 'task_blocked');
  const vm = createTaskViewModel(task, input);
  assert.deepEqual(Object.keys(vm), [
    'id', 'title', 'status', 'priority', 'display_time', 'time_state',
    'is_overdue', 'is_blocked', 'requires_attention', 'source',
  ]);
  assert.equal(vm.display_time, 'unscheduled');
  assert.equal(vm.is_blocked, true);
  assert.equal(vm.requires_attention, true);
});

test('fuzzy Task ViewModels preserve state without inventing a date', () => {
  const input = loadFixture();
  const ambiguous = createTaskViewModel(input.tasks.find((item) => item.id === 'task_ambiguous'), input);
  const relative = createTaskViewModel(input.tasks.find((item) => item.id === 'task_relative'), input);
  assert.equal(ambiguous.display_time, 'ambiguous_time');
  assert.equal(relative.display_time, 'relative_unresolved');
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(ambiguous.display_time), false);
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(relative.display_time), false);
});

test('Calendar Event ViewModel exposes all required presentation fields', () => {
  const input = loadFixture();
  const event = input.events.find((item) => item.id === 'event_now');
  const vm = createCalendarEventViewModel(event, input);
  assert.deepEqual(Object.keys(vm), [
    'id', 'title', 'display_time', 'all_day', 'location', 'status', 'source', 'is_happening_now',
  ]);
  assert.equal(vm.is_happening_now, true);
  assert.match(vm.display_time, /2026-08-10T11:00:00/);
});

test('Day ViewModel combines tasks/events and summary counts', () => {
  const input = loadFixture();
  const day = createDayViewModel('2026-08-10', input);
  assert.equal(day.date, '2026-08-10');
  assert.ok(day.tasks.some((item) => item.id === 'task_due_today'));
  assert.ok(day.tasks.some((item) => item.id === 'task_date_only_today'));
  assert.ok(day.events.some((item) => item.id === 'event_all_day'));
  assert.equal(day.summary.task_count, day.tasks.length);
  assert.equal(day.summary.event_count, day.events.length);
  assert.equal(day.summary.overdue_count, day.tasks.filter((item) => item.is_overdue).length);
});

test('Week ViewModel has deterministic seven-day boundaries and aggregate summary', () => {
  const input = loadFixture();
  const week = createWeekViewModel('2026-08-10', input);
  assert.equal(week.week_start, '2026-08-10');
  assert.equal(week.week_end, '2026-08-16');
  assert.equal(week.days.length, 7);
  assert.equal(week.summary.task_count, week.days.reduce((sum, day) => sum + day.tasks.length, 0));
});

test('Month ViewModel exposes weeks, in-month days, daily counts, and attention summary', () => {
  const input = loadFixture();
  const month = createMonthViewModel(2026, 8, input);
  assert.equal(month.year, 2026);
  assert.equal(month.month, 8);
  assert.ok(month.weeks.length >= 5);
  assert.equal(month.weeks.every((week) => week.days.length === 7), true);
  assert.equal(month.summary.daily_counts.length, 31);
  assert.ok(month.summary.attention_count >= 1);
  assert.deepEqual(Object.keys(month.summary.daily_counts[0]), ['date', 'tasks', 'events', 'attention']);
});

test('Dashboard ViewModel derives all sections from loaded data only', () => {
  const input = loadFixture();
  const dashboard = createButlerDashboardViewModel(input);
  assert.deepEqual(Object.keys(dashboard), [
    'today', 'upcoming', 'overdue', 'blocked', 'unscheduled', 'needs_confirmation',
  ]);
  assert.ok(dashboard.overdue.some((item) => item.id === 'task_overdue'));
  assert.ok(dashboard.blocked.some((item) => item.id === 'task_blocked'));
  assert.ok(dashboard.unscheduled.some((item) => item.id === 'task_ambiguous') === false);
  assert.ok(dashboard.unscheduled.some((item) => item.id === 'task_blocked'));
  assert.equal(dashboard.needs_confirmation.length, 1);
  assert.equal(dashboard.needs_confirmation[0].executable, false);
});

test('all ViewModels require an explicit clock and timezone', () => {
  const input = loadFixture();
  assert.throws(() => createTaskViewModel(input.tasks[0], { tasks: input.tasks }), /now|timezone/);
  assert.throws(() => createCalendarEventViewModel(input.events[0], { now: input.now }), /timezone/);
  assert.throws(() => createDayViewModel('2026-08-10', { tasks: [], events: [] }), /timezone/);
});
