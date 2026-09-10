import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mapLegacyTodoToTask } from '../src/adapters/notion/legacy-todo-mapper.mjs';
import {
  createDayViewModel,
  createMonthViewModel,
  createWeekViewModel,
} from '../src/view-models/schedule-view-model.mjs';
import { createTaskViewModel } from '../src/view-models/task-view-model.mjs';
import { planReminders } from '../src/reminders/reminder-planner.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-todo-legacy-cases.json', import.meta.url),
  'utf8',
));
const mappingOptions = { defaultTimezone: fixture.timezone, observedAt: fixture.observed_at };
const context = {
  now: fixture.observed_at,
  timezone: fixture.timezone,
  events: [],
};

function mapped(key) {
  return mapLegacyTodoToTask(fixture.items[key], mappingOptions).task;
}

test('mapped Legacy Task enters existing Day Week and Month ViewModels without a second pipeline', () => {
  const task = mapped('pending_explicit_due');
  const tasks = [task];
  const day = createDayViewModel('2026-08-12', { ...context, tasks });
  const week = createWeekViewModel('2026-08-10', { ...context, tasks });
  const month = createMonthViewModel(2026, 8, { ...context, tasks });
  assert.equal(day.tasks[0].id, task.id);
  assert.equal(week.days.find((item) => item.date === '2026-08-12').tasks[0].id, task.id);
  const monthDay = month.weeks.flatMap((item) => item.days).find((item) => item.date === '2026-08-12');
  assert.equal(monthDay.tasks[0].source, 'notion');
});

test('unscheduled Legacy Task is not forced into today and its ViewModel remains explicit', () => {
  const task = mapped('no_due');
  const day = createDayViewModel('2026-08-10', { ...context, tasks: [task] });
  const taskView = createTaskViewModel(task, { ...context, tasks: [task] });
  assert.equal(day.tasks.length, 0);
  assert.equal(taskView.display_time, 'unscheduled');
  assert.equal(taskView.requires_attention, true);
});

test('ambiguous and relative mapped Tasks stay out of schedules and reminders', () => {
  const tasks = [mapped('ambiguous'), mapped('relative')];
  const day = createDayViewModel('2026-08-10', { ...context, tasks });
  const planned = planReminders({
    ...context,
    tasks,
    policy: {
      task_due_minutes_before: 30,
      task_upcoming_minutes_before: 30,
      event_start_minutes_before: 15,
      date_only_reminder_time: '09:00',
      all_day_reminder_time: null,
    },
  });
  assert.equal(day.tasks.length, 0);
  assert.equal(planned.reminders.length, 0);
  assert.deepEqual(planned.skipped.map((item) => item.planning_skipped_reason).sort(), [
    'time_state_ambiguous', 'time_state_relative_unresolved',
  ]);
});

test('explicit Legacy due is accepted by the existing Reminder Planner without sending notification', () => {
  const task = mapped('pending_explicit_due');
  const planned = planReminders({
    ...context,
    tasks: [task],
    policy: {
      task_due_minutes_before: 30,
      task_upcoming_minutes_before: null,
      event_start_minutes_before: null,
      date_only_reminder_time: '09:00',
      all_day_reminder_time: null,
    },
  });
  assert.equal(planned.reminders.length, 1);
  assert.equal(planned.reminders[0].source_id, task.id);
  assert.equal(planned.reminders[0].kind, 'due');
  assert.equal(planned.notification_intents.length, 1);
  assert.equal('platform' in planned.notification_intents[0], false);
});
