import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createReminder } from '../src/domain/reminder.mjs';
import { InMemoryReminderStore } from '../src/reminders/reminder-store.mjs';

const NOW = '2026-08-10T09:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function reminder(overrides = {}) {
  return createReminder({
    title: 'Reminder', source_type: 'task', source_id: 'task_1', kind: 'due',
    scheduled_at: '2026-08-10T00:30:00.000Z', timezone: TIMEZONE,
    ...overrides,
  }, { now: NOW });
}

test('Reminder Store upsert deduplicates stable identity and supports local filters', () => {
  const value = reminder();
  const store = new InMemoryReminderStore();
  assert.deepEqual(store.upsert(value), value);
  assert.deepEqual(store.upsert(value), value);
  assert.equal(store.list().length, 1);
  assert.deepEqual(store.getById(value.id), value);
  assert.equal(store.list({ source_type: 'task', kind: 'due' }).length, 1);
});

test('Reminder Store rejects an id reused for another reminder identity', () => {
  const value = reminder();
  const store = new InMemoryReminderStore([value]);
  const conflict = reminder({ id: value.id, source_id: 'task_2' });
  assert.throws(() => store.upsert(conflict), /id conflict/);
});

test('ready reminder acknowledgement is deterministic and idempotent', () => {
  const store = new InMemoryReminderStore([reminder({ state: 'ready' })]);
  const id = store.list()[0].id;
  const first = store.acknowledge(id, { now: NOW, timezone: TIMEZONE });
  const second = store.acknowledge(id, { now: '2026-08-10T10:00:00+08:00', timezone: TIMEZONE });
  assert.equal(first.state, 'acknowledged');
  assert.equal(first.acknowledged_at, NOW);
  assert.deepEqual(second, first);
});

test('ready reminder dismissal is deterministic and cannot become ready again', () => {
  const value = reminder({ state: 'ready' });
  const store = new InMemoryReminderStore([value]);
  const first = store.dismiss(value.id, { now: NOW, timezone: TIMEZONE });
  const second = store.dismiss(value.id, { now: '2026-08-10T10:00:00+08:00', timezone: TIMEZONE });
  assert.equal(first.state, 'dismissed');
  assert.equal(first.dismissed_at, NOW);
  assert.deepEqual(second, first);
  assert.equal(store.upsert(value).state, 'dismissed');
});

test('source cancellation updates scheduled evidence but never deletes it', () => {
  const scheduled = reminder({ scheduled_at: '2026-08-11T01:00:00.000Z' });
  const cancelled = reminder({ scheduled_at: scheduled.scheduled_at, state: 'cancelled' });
  const store = new InMemoryReminderStore([scheduled]);
  assert.equal(store.upsert(cancelled).state, 'cancelled');
  assert.equal(store.list().length, 1);
});
