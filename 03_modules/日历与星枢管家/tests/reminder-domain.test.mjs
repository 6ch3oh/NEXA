import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateReminderState,
  createReminder,
  createReminderIdentity,
  validateReminder,
} from '../src/domain/reminder.mjs';
import {
  createNotificationIntent,
  validateNotificationIntent,
} from '../src/reminders/notification-intent.mjs';

const NOW = '2026-08-10T09:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function reminder(overrides = {}) {
  return createReminder({
    title: 'Due: Domain task', source_type: 'task', source_id: 'task_1', kind: 'due',
    scheduled_at: '2026-08-10T08:30:00.000Z', timezone: TIMEZONE,
    ...overrides,
  }, { now: NOW });
}

test('Reminder Domain validates the complete stable contract', () => {
  const value = reminder();
  assert.deepEqual(Object.keys(value), [
    'id', 'title', 'source_type', 'source_id', 'kind', 'scheduled_at', 'timezone',
    'state', 'created_at', 'acknowledged_at', 'dismissed_at',
  ]);
  assert.equal(value.state, 'scheduled');
  assert.deepEqual(validateReminder(value), value);
});

test('Reminder Domain rejects invalid states and inconsistent lifecycle timestamps', () => {
  assert.throws(() => reminder({ state: 'sent' }), /Invalid reminder state/);
  assert.throws(() => reminder({ state: 'acknowledged' }), /acknowledged_at/);
  assert.throws(() => reminder({ state: 'scheduled', dismissed_at: NOW }), /dismissed_at/);
});

test('reminder identity is stable for source, kind, and scheduled time', () => {
  const identity = { source_type: 'task', source_id: 'task_1', kind: 'due', scheduled_at: '2026-08-10T08:30:00.000Z' };
  assert.equal(createReminderIdentity(identity), createReminderIdentity({ ...identity }));
  assert.notEqual(createReminderIdentity(identity), createReminderIdentity({ ...identity, kind: 'overdue' }));
  assert.equal(reminder().id, createReminderIdentity(identity));
});

test('scheduled_at at or before explicit now becomes ready without delivery semantics', () => {
  const current = calculateReminderState(reminder({ scheduled_at: '2026-08-10T00:30:00.000Z' }), { now: NOW, timezone: TIMEZONE });
  assert.equal(current.state, 'ready');
  assert.equal('sent_at' in current, false);
});

test('Notification Intent is stable adapter input and contains no platform API fields', () => {
  const current = reminder();
  const first = createNotificationIntent({ reminder: current, body: 'Body', priority: 'high' });
  const second = createNotificationIntent({ reminder: current, body: 'Body', priority: 'high' });
  assert.equal(first.intent_id, second.intent_id);
  assert.equal(first.reminder_id, current.id);
  assert.deepEqual(validateNotificationIntent(first), first);
  assert.equal(Object.keys(first).some((key) => /windows|android|notion|delivery/i.test(key)), false);
});
