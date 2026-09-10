import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTask } from '../src/domain/task.mjs';
import { createCalendarEvent } from '../src/domain/calendar-event.mjs';
import { planReminders, validateReminderPolicy } from '../src/reminders/reminder-planner.mjs';

function fixture(overrides = {}) {
  const raw = JSON.parse(readFileSync(new URL('../fixtures/reminder-cases.json', import.meta.url), 'utf8'));
  return {
    now: raw.now,
    timezone: raw.timezone,
    policy: raw.policy,
    tasks: raw.tasks.map((item) => createTask(item)),
    events: raw.events.map((item) => createCalendarEvent(item)),
    ...overrides,
  };
}

test('planner creates deterministic due, overdue, and event-start reminders from explicit policy', () => {
  const result = planReminders(fixture());
  const due = result.reminders.find((item) => item.source_id === 'due_soon_task');
  const overdue = result.reminders.find((item) => item.source_id === 'overdue_task');
  const event = result.reminders.find((item) => item.source_id === 'timed_event');
  assert.deepEqual([due.kind, due.scheduled_at, due.state], ['due', '2026-08-10T01:30:00.000Z', 'scheduled']);
  assert.deepEqual([overdue.kind, overdue.scheduled_at, overdue.state], ['overdue', '2026-08-10T00:00:00.000Z', 'ready']);
  assert.deepEqual([event.kind, event.scheduled_at], ['event_start', '2026-08-10T02:45:00.000Z']);
  assert.ok(result.notification_intents.every((intent) => intent.intent_id.startsWith('intent_')));
});

test('task upcoming reminder uses only the caller-provided start offset', () => {
  const input = fixture({
    tasks: [createTask({
      id: 'starting_task', title: 'Starting task', start_at: '2026-08-10T12:00:00+08:00',
      timezone: 'Asia/Shanghai', time_state: 'exact',
      created_at: '2026-08-01T09:00:00+08:00', updated_at: '2026-08-01T09:00:00+08:00',
    })],
    events: [],
  });
  const result = planReminders(input);
  assert.equal(result.reminders[0].kind, 'upcoming');
  assert.equal(result.reminders[0].scheduled_at, '2026-08-10T03:00:00.000Z');
});

test('unscheduled, ambiguous, and relative-unresolved tasks never fabricate reminders', () => {
  const input = fixture();
  const result = planReminders(input);
  for (const id of ['unscheduled_task', 'ambiguous_task', 'relative_task']) {
    assert.equal(result.reminders.some((item) => item.source_id === id), false);
    const skip = result.skipped.find((item) => item.source_id === id);
    assert.match(skip.planning_skipped_reason, /time_state_/);
    assert.equal('scheduled_at' in skip, false);
  }
});

test('all-day event without explicit reminder time is safely skipped', () => {
  const result = planReminders(fixture());
  assert.equal(result.reminders.some((item) => item.source_id === 'all_day_event'), false);
  assert.equal(result.skipped.find((item) => item.source_id === 'all_day_event').planning_skipped_reason, 'all_day_reminder_time_required');
});

test('all-day event can use an explicit policy clock without guessing', () => {
  const input = fixture();
  const result = planReminders({
    ...input,
    tasks: [],
    events: input.events.filter((item) => item.id === 'all_day_event'),
    policy: { ...input.policy, all_day_reminder_time: '09:00' },
  });
  assert.equal(result.reminders[0].scheduled_at, '2026-08-11T01:00:00.000Z');
  assert.equal(result.reminders[0].kind, 'event_start');
});

test('completed and cancelled sources produce cancelled evidence with no notification intent', () => {
  const result = planReminders(fixture());
  for (const id of ['completed_task', 'cancelled_task', 'cancelled_event']) {
    const reminder = result.reminders.find((item) => item.source_id === id);
    assert.equal(reminder.state, 'cancelled');
    assert.equal(result.notification_intents.some((intent) => intent.reminder_id === reminder.id), false);
  }
});

test('same planner input produces stable identities and no duplicate reminders', () => {
  const first = planReminders(fixture());
  const second = planReminders(fixture());
  assert.deepEqual(first.reminders.map((item) => item.id), second.reminders.map((item) => item.id));
  assert.deepEqual(first.notification_intents.map((item) => item.intent_id), second.notification_intents.map((item) => item.intent_id));
  assert.equal(new Set(first.reminders.map((item) => item.id)).size, first.reminders.length);
});

test('planner preserves acknowledged and dismissed lifecycle across replanning', async () => {
  const initial = planReminders(fixture());
  const overdue = initial.reminders.find((item) => item.source_id === 'overdue_task');
  const due = initial.reminders.find((item) => item.source_id === 'due_soon_task');
  const { InMemoryReminderStore } = await import('../src/reminders/reminder-store.mjs');
  const store = new InMemoryReminderStore([overdue, due]);
  const acknowledged = store.acknowledge(overdue.id, { now: fixture().now, timezone: fixture().timezone });
  const dismissed = store.dismiss(due.id, { now: fixture().now, timezone: fixture().timezone });
  const result = planReminders({ ...fixture(), existing_reminders: [acknowledged, dismissed] });
  assert.equal(result.reminders.find((item) => item.id === overdue.id).state, 'acknowledged');
  assert.equal(result.reminders.find((item) => item.id === due.id).state, 'dismissed');
  assert.equal(result.notification_intents.some((intent) => [overdue.id, due.id].includes(intent.reminder_id)), false);
});

test('planner requires explicit clock, timezone, and policy values remain non-hidden', () => {
  const input = fixture();
  assert.throws(() => planReminders({ ...input, now: undefined }), /now/);
  assert.throws(() => planReminders({ ...input, timezone: undefined }), /timezone/);
  assert.throws(() => planReminders({ ...input, policy: undefined }), /policy/);
  assert.throws(() => validateReminderPolicy({ event_start_minutes_before: -1 }), /non-negative/);
});
