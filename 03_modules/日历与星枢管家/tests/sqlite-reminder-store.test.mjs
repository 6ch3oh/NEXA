import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createReminder } from '../src/domain/reminder.mjs';
import {
  REMINDER_SCHEMA_VERSION,
  UnsupportedReminderSchemaVersionError,
  getReminderSchemaVersion,
  getSchemaVersion,
  initializeSchema,
} from '../src/storage/sqlite-schema.mjs';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.mjs';

const NOW = '2026-08-10T09:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function reminder(sourceId, scheduledAt, overrides = {}) {
  return createReminder({
    title: `Reminder ${sourceId}`, source_type: 'task', source_id: sourceId, kind: 'due',
    scheduled_at: scheduledAt, timezone: TIMEZONE, ...overrides,
  }, { now: NOW });
}

test('old core V1 database migrates Reminder component non-destructively and repeatably', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
        status TEXT NOT NULL, priority TEXT NOT NULL, start_at TEXT, due_at TEXT,
        completed_at TEXT, timezone TEXT, source TEXT NOT NULL, external_id TEXT,
        time_state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    database.prepare('INSERT INTO tasks (id,title,description,status,priority,source,time_state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('legacy-task', 'Legacy', '', 'pending', 'normal', 'local', 'unscheduled', NOW, NOW);
    assert.equal(getReminderSchemaVersion(database), 0);
    assert.equal(initializeSchema(database), 1);
    assert.equal(getSchemaVersion(database), 1);
    assert.equal(getReminderSchemaVersion(database), REMINDER_SCHEMA_VERSION);
    assert.equal(database.prepare('SELECT title FROM tasks WHERE id = ?').get('legacy-task').title, 'Legacy');
    const columns = database.prepare('PRAGMA table_info(reminders)').all().map((row) => row.name);
    for (const column of ['id', 'title', 'source_type', 'source_id', 'kind', 'scheduled_at', 'timezone', 'state', 'created_at', 'acknowledged_at', 'dismissed_at']) {
      assert.ok(columns.includes(column), column);
    }
    assert.equal(initializeSchema(database), 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1);
  } finally {
    database.close();
  }
});

test('unknown higher Reminder component version fails closed before creating Reminder table', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE schema_components (component TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL);
      INSERT INTO schema_components (component, version) VALUES ('reminders', 99);
    `);
    assert.throws(() => initializeSchema(database), UnsupportedReminderSchemaVersionError);
    assert.equal(getReminderSchemaVersion(database), 99);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='reminders'").get().count, 0);
  } finally {
    database.close();
  }
});

test('SQLite Reminder Store upsert/get/list deduplicates stable identity', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const store = new SQLiteReminderStore(database);
    const value = reminder('dedup', '2026-08-10T02:00:00.000Z');
    assert.deepEqual(store.upsert(value), value);
    assert.deepEqual(store.upsert(value), value);
    assert.equal(store.list().length, 1);
    assert.deepEqual(store.getById(value.id), value);
    assert.equal(store.list({ source_type: 'task', source_id: 'dedup', kind: 'due' }).length, 1);
  } finally {
    database.close();
  }
});

test('SQLite ready query uses explicit now and persists ready state', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const store = new SQLiteReminderStore(database);
    const due = store.upsert(reminder('due', '2026-08-10T00:30:00.000Z'));
    store.upsert(reminder('future', '2026-08-11T00:30:00.000Z'));
    const ready = store.listReady({ now: NOW, timezone: TIMEZONE });
    assert.deepEqual(ready.map((item) => item.id), [due.id]);
    assert.equal(store.getById(due.id).state, 'ready');
    assert.throws(() => store.listReady({ timezone: TIMEZONE }), /now/);
  } finally {
    database.close();
  }
});

test('SQLite Reminder Store persists acknowledge, dismiss, and cancelled lifecycle', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const store = new SQLiteReminderStore(database);
    const acknowledged = store.upsert(reminder('ack', '2026-08-10T00:30:00.000Z', { state: 'ready' }));
    const dismissed = store.upsert(reminder('dismiss', '2026-08-10T00:30:00.000Z', { state: 'ready' }));
    const cancelled = store.upsert(reminder('cancel', '2026-08-11T00:30:00.000Z', { state: 'cancelled' }));
    assert.equal(store.acknowledge(acknowledged.id, { now: NOW, timezone: TIMEZONE }).acknowledged_at, NOW);
    assert.equal(store.acknowledge(acknowledged.id, { now: '2026-08-10T10:00:00+08:00', timezone: TIMEZONE }).acknowledged_at, NOW);
    assert.equal(store.dismiss(dismissed.id, { now: NOW, timezone: TIMEZONE }).dismissed_at, NOW);
    assert.equal(store.dismiss(dismissed.id, { now: '2026-08-10T10:00:00+08:00', timezone: TIMEZONE }).dismissed_at, NOW);
    assert.equal(store.getById(cancelled.id).state, 'cancelled');
  } finally {
    database.close();
  }
});
