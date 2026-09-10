import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTask } from '../src/domain/task.mjs';
import { createCalendarEvent } from '../src/domain/calendar-event.mjs';
import { ReminderService } from '../src/reminders/reminder-service.mjs';
import { InMemoryReminderStore } from '../src/reminders/reminder-store.mjs';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.mjs';

function fixture() {
  const raw = JSON.parse(readFileSync(new URL('../fixtures/reminder-cases.json', import.meta.url), 'utf8'));
  return {
    now: raw.now,
    timezone: raw.timezone,
    policy: raw.policy,
    tasks: raw.tasks.map((item) => createTask(item)),
    events: raw.events.map((item) => createCalendarEvent(item)),
  };
}

test('ReminderService planAndPersist is deterministic and repeated planning does not duplicate', () => {
  const store = new InMemoryReminderStore();
  const service = new ReminderService(store);
  const first = service.planAndPersist(fixture());
  const second = service.planAndPersist(fixture());
  assert.equal(first.reminders.length, 6);
  assert.equal(store.list().length, 6);
  assert.deepEqual(second.reminders.map((item) => item.id), first.reminders.map((item) => item.id));
  assert.deepEqual(second.notification_intents.map((item) => item.intent_id), first.notification_intents.map((item) => item.intent_id));
});

test('ReminderService ready query, acknowledge, and dismiss use explicit context', () => {
  const store = new InMemoryReminderStore();
  const service = new ReminderService(store);
  const planned = service.planAndPersist(fixture());
  const due = planned.reminders.find((item) => item.source_id === 'due_soon_task');
  const overdue = planned.reminders.find((item) => item.source_id === 'overdue_task');
  const context = { now: '2026-08-10T09:31:00+08:00', timezone: fixture().timezone };
  const ready = service.listReady(context);
  assert.ok(ready.some((item) => item.id === due.id));
  assert.ok(ready.some((item) => item.id === overdue.id));
  assert.equal(service.acknowledge(overdue.id, context).state, 'acknowledged');
  assert.equal(service.dismiss(due.id, context).state, 'dismissed');
  assert.equal(service.listReady(context).some((item) => [due.id, overdue.id].includes(item.id)), false);
});

test('ReminderService reconciles completed Task and cancelled Event to persisted cancelled evidence', () => {
  const input = fixture();
  const activeTask = createTask({
    id: 'reconcile_task', title: 'Reconcile task', due_at: '2026-08-10T12:00:00+08:00',
    timezone: input.timezone, time_state: 'exact',
    created_at: input.now, updated_at: input.now,
  });
  const activeEvent = createCalendarEvent({
    id: 'reconcile_event', title: 'Reconcile event', start_at: '2026-08-10T12:00:00+08:00',
    end_at: '2026-08-10T13:00:00+08:00', timezone: input.timezone,
    created_at: input.now, updated_at: input.now,
  });
  const store = new InMemoryReminderStore();
  const service = new ReminderService(store);
  service.planAndPersist({ ...input, tasks: [activeTask], events: [activeEvent] });
  assert.equal(store.list().length, 2);

  const completedTask = createTask({
    ...activeTask, status: 'completed', completed_at: input.now, updated_at: input.now,
  });
  const cancelledEvent = createCalendarEvent({ ...activeEvent, status: 'cancelled', updated_at: input.now });
  service.planAndPersist({ ...input, tasks: [completedTask], events: [cancelledEvent] });
  assert.equal(store.list({ source_type: 'task', source_id: activeTask.id })[0].state, 'cancelled');
  assert.equal(store.list({ source_type: 'calendar_event', source_id: activeEvent.id })[0].state, 'cancelled');
  assert.equal(store.list().length, 2);
});

test('ReminderService creates local Notification Intents without any delivery capability', () => {
  const service = new ReminderService(new InMemoryReminderStore());
  service.planAndPersist(fixture());
  const intents = service.notificationIntentsForReady({ now: fixture().now, timezone: fixture().timezone });
  assert.ok(intents.length >= 1);
  assert.equal(intents.every((intent) => Object.keys(intent).every((key) => !/sent|delivery|windows|android|notion/i.test(key))), true);
});

test('ReminderService operates unchanged with SQLite Reminder Store', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const store = new SQLiteReminderStore(database);
    const service = new ReminderService(store);
    const first = service.planAndPersist(fixture());
    const second = service.planAndPersist(fixture());
    assert.equal(first.reminders.length, 6);
    assert.equal(second.reminders.length, 6);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM reminders').get().count, 6);
    assert.ok(service.listReady({ now: fixture().now, timezone: fixture().timezone }).length >= 1);
  } finally {
    database.close();
  }
});
