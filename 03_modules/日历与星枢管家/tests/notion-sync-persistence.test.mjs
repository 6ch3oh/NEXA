import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NotionReadSyncService } from '../src/adapters/notion/notion-read-sync-service.mjs';
import { createNotionSyncPolicy } from '../src/adapters/notion/notion-sync-policy.mjs';
import { createInMemoryTaskStore } from '../src/storage/in-memory-store.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';
import { createTask } from '../src/domain/task.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-sync-cases.json', import.meta.url),
  'utf8',
));
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

class UnusedFakePort {
  async getSnapshot() { throw new Error('not used'); }
  async refresh() { throw new Error('not used'); }
}

function serviceFor(repository) {
  return new NotionReadSyncService({
    port: new UnusedFakePort(),
    repository,
    policy: createNotionSyncPolicy({ timezone: fixture.timezone }),
  });
}

function cleanupKnownFiles(databasePath) {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    rmSync(path, { force: true });
  }
}

function businessTask(task) {
  const { updated_at, ...rest } = task;
  return rest;
}

test('NotionReadSyncService has InMemory and SQLite business-result parity', () => {
  const memory = createInMemoryTaskStore();
  const sqlite = openSQLiteStore(':memory:');
  try {
    const memoryService = serviceFor(memory);
    const sqliteService = serviceFor(sqlite.taskRepository);
    for (const snapshot of [
      fixture.snapshots.first_import,
      fixture.snapshots.title_update,
      fixture.snapshots.title_update,
    ]) {
      const left = memoryService.syncSnapshot(snapshot, { now: fixture.later_now });
      const right = sqliteService.syncSnapshot(snapshot, { now: fixture.later_now });
      assert.deepEqual(right, left);
    }
    assert.deepEqual(
      businessTask(sqlite.taskRepository.list()[0]),
      businessTask(memory.list()[0]),
    );
  } finally {
    sqlite.close();
  }
});

test('SQLite close/reopen preserves external identity and prevents duplicate import', () => {
  const databasePath = join(tmpdir(), `.nexa-notion-sync-${randomUUID()}.db`);
  let store = null;
  try {
    store = openSQLiteStore(databasePath);
    const first = serviceFor(store.taskRepository).syncSnapshot(
      fixture.snapshots.first_import,
      { now: fixture.now },
    );
    const firstTask = store.taskRepository.list()[0];
    assert.equal(first.created_count, 1);
    store.close();
    store = null;

    store = openSQLiteStore(databasePath);
    const reopenedTask = store.taskRepository.list()[0];
    assert.equal(reopenedTask.id, firstTask.id);
    assert.equal(reopenedTask.external_id, firstTask.external_id);
    const second = serviceFor(store.taskRepository).syncSnapshot(
      fixture.snapshots.first_import,
      { now: fixture.later_now },
    );
    assert.equal(second.status, 'no_change');
    assert.equal(second.created_count, 0);
    assert.equal(second.updated_count, 0);
    assert.equal(store.taskRepository.list().length, 1);
    assert.equal(store.taskRepository.list()[0].id, firstTask.id);
  } finally {
    if (store != null) store.close();
    cleanupKnownFiles(databasePath);
    assert.equal(existsSync(databasePath), false);
    assert.equal(existsSync(`${databasePath}-wal`), false);
    assert.equal(existsSync(`${databasePath}-shm`), false);
  }
});

test('existing non-derived local identity wins for the same source and external_id', () => {
  const repository = createInMemoryTaskStore();
  repository.create(createTask({
    id: 'local_preserved_identity',
    title: 'Old local projection',
    source: 'notion',
    external_id: 'sync_page_001',
    priority: 'normal',
    created_at: fixture.now,
    updated_at: fixture.now,
  }));
  const result = serviceFor(repository).syncSnapshot(
    fixture.snapshots.first_import,
    { now: fixture.later_now },
  );
  assert.equal(result.created_count, 0);
  assert.equal(result.updated_count, 1);
  assert.equal(repository.list().length, 1);
  assert.equal(repository.list()[0].id, 'local_preserved_identity');
  assert.equal(repository.list()[0].external_id, 'sync_page_001');
  assert.equal(repository.list()[0].title, 'Synthetic sync task');
});
