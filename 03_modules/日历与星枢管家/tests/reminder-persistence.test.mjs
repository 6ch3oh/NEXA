import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createReminder } from '../src/domain/reminder.mjs';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';
import { getReminderSchemaVersion } from '../src/storage/sqlite-schema.mjs';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-08-10T09:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function cleanupKnownFiles(databasePath) {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) rmSync(path, { force: true });
}

function reminder(sourceId, state = 'ready') {
  return createReminder({
    title: `Reminder ${sourceId}`, source_type: 'task', source_id: sourceId, kind: 'due',
    scheduled_at: '2026-08-10T00:30:00.000Z', timezone: TIMEZONE, state,
  }, { now: NOW });
}

test('Reminder state, timestamps, and identity survive exact file close/reopen with zero residue', () => {
  const databasePath = join(tmpdir(), `.nexa-reminder-${randomUUID()}.db`);
  let sqlite = null;
  try {
    sqlite = openSQLiteStore(databasePath);
    let reminders = new SQLiteReminderStore(sqlite.database);
    const acknowledged = reminders.upsert(reminder('acknowledged'));
    const dismissed = reminders.upsert(reminder('dismissed'));
    const cancelled = reminders.upsert(reminder('cancelled', 'cancelled'));
    reminders.acknowledge(acknowledged.id, { now: NOW, timezone: TIMEZONE });
    reminders.dismiss(dismissed.id, { now: NOW, timezone: TIMEZONE });
    assert.equal(getReminderSchemaVersion(sqlite.database), 1);
    sqlite.close();
    sqlite = null;

    sqlite = openSQLiteStore(databasePath);
    reminders = new SQLiteReminderStore(sqlite.database);
    const reopenedAck = reminders.getById(acknowledged.id);
    const reopenedDismiss = reminders.getById(dismissed.id);
    const reopenedCancelled = reminders.getById(cancelled.id);
    assert.equal(reopenedAck.id, acknowledged.id);
    assert.equal(reopenedAck.state, 'acknowledged');
    assert.equal(reopenedAck.acknowledged_at, NOW);
    assert.equal(reopenedDismiss.state, 'dismissed');
    assert.equal(reopenedDismiss.dismissed_at, NOW);
    assert.equal(reopenedCancelled.state, 'cancelled');
    assert.equal(reminders.list().length, 3);
  } finally {
    if (sqlite != null) sqlite.close();
    cleanupKnownFiles(databasePath);
    assert.equal(existsSync(databasePath), false);
    assert.equal(existsSync(`${databasePath}-wal`), false);
    assert.equal(existsSync(`${databasePath}-shm`), false);
  }
});
