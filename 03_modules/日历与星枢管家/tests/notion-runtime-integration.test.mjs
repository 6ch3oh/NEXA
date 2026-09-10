import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createButlerNotionRuntime } from '../src/adapters/notion/notion-runtime-factory.mjs';
import { ReminderService } from '../src/reminders/reminder-service.mjs';
import { InMemoryReminderStore } from '../src/reminders/reminder-store.mjs';
import { ScheduleQueryService } from '../src/services/schedule-query-service.mjs';
import { createInMemoryEventStore, createInMemoryTaskStore } from '../src/storage/in-memory-store.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const runtimeFixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-runtime-cases.json', import.meta.url),
  'utf8',
));
const hostFixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-host-cases.json', import.meta.url),
  'utf8',
));
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

function fakeWindow() {
  const state = {
    get: structuredClone(hostFixture.snapshots.get_success),
    refresh: structuredClone(hostFixture.snapshots.refresh_success),
    test: structuredClone(hostFixture.host_responses.test_success),
    open: structuredClone(hostFixture.host_responses.open_success),
  };
  const calls = [];
  return {
    state,
    calls,
    windowLike: { tokenMonitor: { notionTodo: {
      get: async () => { calls.push('get'); return structuredClone(state.get); },
      refresh: async () => { calls.push('refresh'); return structuredClone(state.refresh); },
      test: async () => { calls.push('test'); return structuredClone(state.test); },
      open: async (target) => { calls.push(`open:${target}`); return structuredClone(state.open); },
    } } },
  };
}

function createRuntime(host, taskRepository, now = runtimeFixture.now) {
  return createButlerNotionRuntime({
    windowLike: host.windowLike,
    taskRepository,
    timezone: runtimeFixture.timezone,
    clock: () => now,
  });
}

function cleanupKnownFiles(databasePath) {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    rmSync(path, { force: true });
  }
}

test('fake window runtime sync defaults to non-authoritative and explicit proof emits evidence only', async () => {
  const host = fakeWindow();
  const repository = createInMemoryTaskStore();
  const runtime = createRuntime(host, repository);
  const first = await runtime.getAndSync();
  assert.equal(first.status, 'synced');
  assert.equal(first.snapshot_state, 'fresh_non_authoritative');
  assert.equal(repository.list().length, 1);

  host.state.get = structuredClone(hostFixture.snapshots.fresh_complete_empty);
  const safeEmpty = await runtime.getAndSync();
  assert.equal(safeEmpty.snapshot_state, 'fresh_non_authoritative');
  assert.equal(safeEmpty.missing_from_source_count, 0);
  assert.equal(repository.list().length, 1);

  const evidenced = await runtime.getAndSync({
    now: runtimeFixture.later_now,
    authoritative: true,
    authorityProof: runtimeFixture.authority_proof,
  });
  assert.equal(evidenced.snapshot_state, 'fresh_complete');
  assert.equal(evidenced.missing_from_source_count, 1);
  assert.equal(evidenced.evidence[0].action, 'missing_from_source');
  assert.equal(repository.list().length, 1);
});

test('stale cache-miss malformed and invalid fake-host states fail closed without Task removal', async () => {
  const host = fakeWindow();
  const repository = createInMemoryTaskStore();
  const runtime = createRuntime(host, repository);
  await runtime.getAndSync();
  const before = repository.list()[0];

  host.state.get = structuredClone(hostFixture.snapshots.stale);
  assert.equal((await runtime.getAndSync()).status, 'stale_skipped');
  host.state.get = structuredClone(hostFixture.snapshots.cache_miss);
  assert.equal((await runtime.getAndSync()).status, 'cache_miss');
  host.state.get = structuredClone(hostFixture.snapshots.malformed_schema);
  assert.equal((await runtime.getAndSync()).status, 'malformed_data');
  host.state.get = hostFixture.host_responses.invalid;
  assert.equal((await runtime.getAndSync()).status, 'malformed_data');

  assert.deepEqual(repository.getById(before.id), before);
  assert.equal(repository.list().length, 1);
});

test('testConnection and openExternal stay outside Repository sync and local writes', async () => {
  const host = fakeWindow();
  const repository = createInMemoryTaskStore();
  const runtime = createRuntime(host, repository);
  assert.equal((await runtime.testConnection()).ok, true);
  assert.equal((await runtime.openExternal(runtimeFixture.external_target)).ok, true);
  assert.deepEqual(host.calls, ['test', `open:${runtimeFixture.external_target}`]);
  assert.equal(repository.list().length, 0);
});

test('runtime-synced Task enters existing Schedule and local Reminder pipeline unchanged', async () => {
  const host = fakeWindow();
  const taskRepository = createInMemoryTaskStore();
  const runtime = createRuntime(host, taskRepository);
  await runtime.getAndSync();

  const schedule = new ScheduleQueryService({
    taskRepository,
    eventRepository: createInMemoryEventStore(),
  });
  const day = schedule.getDayView('2026-08-12', {
    now: runtimeFixture.now,
    timezone: runtimeFixture.timezone,
  });
  assert.equal(day.tasks.length, 1);
  assert.equal(day.tasks[0].source, 'notion');

  const reminders = new ReminderService(new InMemoryReminderStore()).planAndPersist({
    tasks: taskRepository.list(),
    events: [],
    now: runtimeFixture.now,
    timezone: runtimeFixture.timezone,
    policy: {
      task_due_minutes_before: 30,
      task_upcoming_minutes_before: null,
      event_start_minutes_before: null,
      date_only_reminder_time: '09:00',
      all_day_reminder_time: null,
    },
  });
  assert.equal(reminders.reminders.length, 1);
  assert.equal(reminders.notification_intents.length, 1);
  assert.equal('delivery' in reminders.notification_intents[0], false);
});

test('caller-owned SQLite survives runtime dispose and file reopen without duplicate identity', async () => {
  const databasePath = join(tmpdir(), `.nexa-notion-runtime-${randomUUID()}.db`);
  let store = null;
  try {
    const firstHost = fakeWindow();
    store = openSQLiteStore(databasePath);
    const firstRuntime = createRuntime(firstHost, store.taskRepository);
    const first = await firstRuntime.getAndSync();
    const firstTask = store.taskRepository.list()[0];
    assert.equal(first.created_count, 1);
    assert.equal(firstRuntime.dispose(), true);
    assert.equal(store.taskRepository.getById(firstTask.id).external_id, 'host_page_001');
    store.close();
    store = null;

    const secondHost = fakeWindow();
    store = openSQLiteStore(databasePath);
    const secondRuntime = createRuntime(secondHost, store.taskRepository, runtimeFixture.later_now);
    const second = await secondRuntime.getAndSync();
    assert.equal(second.status, 'no_change');
    assert.equal(second.created_count, 0);
    assert.equal(store.taskRepository.list().length, 1);
    assert.equal(store.taskRepository.list()[0].id, firstTask.id);
    secondRuntime.dispose();
  } finally {
    if (store != null) store.close();
    cleanupKnownFiles(databasePath);
    assert.equal(existsSync(databasePath), false);
    assert.equal(existsSync(`${databasePath}-wal`), false);
    assert.equal(existsSync(`${databasePath}-shm`), false);
  }
});
