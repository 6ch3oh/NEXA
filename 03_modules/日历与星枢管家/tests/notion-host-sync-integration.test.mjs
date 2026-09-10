import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createNotionReadComposition } from '../src/adapters/notion/notion-composition.mjs';
import { createInMemoryTaskStore } from '../src/storage/in-memory-store.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-host-cases.json', import.meta.url),
  'utf8',
));
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

function hostWithState() {
  const state = {
    get: structuredClone(fixture.snapshots.get_success),
    refresh: structuredClone(fixture.snapshots.refresh_success),
  };
  return {
    state,
    api: {
      get: async () => structuredClone(state.get),
      refresh: async () => structuredClone(state.refresh),
      test: async () => ({ ok: true, status: 'ready' }),
      open: async () => ({ ok: true }),
    },
  };
}

function composition(hostApi, taskRepository, explicitNow = fixture.now) {
  return createNotionReadComposition({
    hostApi,
    taskRepository,
    explicitNow,
    timezone: fixture.timezone,
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

test('full Host Binding composition has InMemory and SQLite sync parity', async () => {
  const memoryHost = hostWithState();
  const sqliteHost = hostWithState();
  const memoryRepository = createInMemoryTaskStore();
  const sqliteStore = openSQLiteStore(':memory:');
  try {
    const memory = composition(memoryHost.api, memoryRepository);
    const sqlite = composition(sqliteHost.api, sqliteStore.taskRepository);
    const firstMemory = await memory.getAndSync();
    const firstSqlite = await sqlite.getAndSync();
    assert.deepEqual(firstSqlite, firstMemory);

    const refreshMemory = await memory.refreshAndSync({ now: fixture.later_now });
    const refreshSqlite = await sqlite.refreshAndSync({ now: fixture.later_now });
    assert.deepEqual(refreshSqlite, refreshMemory);
    assert.deepEqual(
      businessTask(sqliteStore.taskRepository.list()[0]),
      businessTask(memoryRepository.list()[0]),
    );
  } finally {
    sqliteStore.close();
  }
});

test('Fake Host to SQLite close/reopen keeps Task and repeated sync creates no duplicate', async () => {
  const databasePath = join(tmpdir(), `.nexa-notion-host-${randomUUID()}.db`);
  let store = null;
  try {
    const firstHost = hostWithState();
    store = openSQLiteStore(databasePath);
    const first = await composition(firstHost.api, store.taskRepository).getAndSync();
    const firstTask = store.taskRepository.list()[0];
    assert.equal(first.created_count, 1);
    store.close();
    store = null;

    const secondHost = hostWithState();
    store = openSQLiteStore(databasePath);
    assert.equal(store.taskRepository.getById(firstTask.id).external_id, 'host_page_001');
    const second = await composition(
      secondHost.api,
      store.taskRepository,
      fixture.later_now,
    ).getAndSync();
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
