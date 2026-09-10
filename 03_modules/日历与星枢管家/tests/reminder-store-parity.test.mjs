import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createReminder } from '../src/domain/reminder.mjs';
import { InMemoryReminderStore } from '../src/reminders/reminder-store.mjs';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.mjs';

const NOW = '2026-08-10T09:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function reminder(sourceId, scheduledAt, state = 'scheduled') {
  return createReminder({
    title: `Reminder ${sourceId}`, source_type: 'task', source_id: sourceId, kind: 'due',
    scheduled_at: scheduledAt, timezone: TIMEZONE, state,
  }, { now: NOW });
}

function exercise(store) {
  const ready = store.upsert(reminder('ready', '2026-08-10T00:30:00.000Z'));
  const dismiss = store.upsert(reminder('dismiss', '2026-08-10T00:30:00.000Z', 'ready'));
  const cancelled = store.upsert(reminder('cancelled', '2026-08-11T00:30:00.000Z', 'cancelled'));
  store.upsert(ready);
  store.listReady({ now: NOW, timezone: TIMEZONE });
  store.acknowledge(ready.id, { now: NOW, timezone: TIMEZONE });
  store.dismiss(dismiss.id, { now: NOW, timezone: TIMEZONE });
  return {
    all: store.list(),
    acknowledged: store.getById(ready.id),
    dismissed: store.getById(dismiss.id),
    cancelled: store.getById(cancelled.id),
    ready: store.listReady({ now: NOW, timezone: TIMEZONE }),
    task: store.list({ source_type: 'task' }),
  };
}

test('InMemory and SQLite Reminder Stores have lifecycle and query parity', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const memoryResult = exercise(new InMemoryReminderStore());
    const sqliteResult = exercise(new SQLiteReminderStore(database));
    assert.deepEqual(sqliteResult, memoryResult);
    assert.equal(sqliteResult.all.length, 3);
    assert.equal(sqliteResult.acknowledged.state, 'acknowledged');
    assert.equal(sqliteResult.dismissed.state, 'dismissed');
    assert.equal(sqliteResult.cancelled.state, 'cancelled');
    assert.equal(sqliteResult.ready.length, 0);
  } finally {
    database.close();
  }
});
