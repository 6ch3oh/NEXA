import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const CREATED = '2026-08-10T08:00:00+08:00';

function cleanupKnownFiles(databasePath) {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    rmSync(path, { force: true });
  }
}

test('file-backed SQLite survives close/reopen with schema, task, event, and dependencies', () => {
  const databasePath = join(tmpdir(), `.nexa-butler-${randomUUID()}.db`);
  let store = null;
  try {
    store = openSQLiteStore(databasePath);
    store.taskRepository.create({
      id: 'dependency', title: 'Dependency', description: '', status: 'pending', priority: 'normal',
      start_at: null, due_at: null, completed_at: null, timezone: 'Asia/Shanghai', source: 'local',
      external_id: null, dependencies: [], time_state: 'unscheduled', created_at: CREATED, updated_at: CREATED,
    });
    store.taskRepository.create({
      id: 'persisted_task', title: 'Persisted task', description: '', status: 'pending', priority: 'high',
      start_at: null, due_at: '2026-08-12', completed_at: null, timezone: 'Asia/Shanghai', source: 'notion',
      external_id: 'notion_persisted', dependencies: ['dependency'], time_state: 'date_only',
      created_at: CREATED, updated_at: CREATED,
    });
    store.eventRepository.create({
      id: 'persisted_event', title: 'Persisted event', description: '',
      start_at: '2026-08-10T10:00:00+08:00', end_at: '2026-08-10T11:00:00+08:00',
      all_day: false, timezone: 'Asia/Shanghai', location: 'Room A', status: 'confirmed', source: 'local',
      external_id: null, created_at: CREATED, updated_at: CREATED,
    });
    assert.equal(store.schemaVersion, 1);
    store.close();
    store = null;

    store = openSQLiteStore(databasePath);
    assert.equal(store.schemaVersion, 1);
    const task = store.taskRepository.getById('persisted_task');
    const event = store.eventRepository.getById('persisted_event');
    assert.equal(task.title, 'Persisted task');
    assert.equal(task.external_id, 'notion_persisted');
    assert.deepEqual(task.dependencies, ['dependency']);
    assert.equal(event.title, 'Persisted event');
    assert.equal(event.location, 'Room A');
  } finally {
    if (store != null) store.close();
    cleanupKnownFiles(databasePath);
    assert.equal(existsSync(databasePath), false);
    assert.equal(existsSync(`${databasePath}-wal`), false);
    assert.equal(existsSync(`${databasePath}-shm`), false);
  }
});
