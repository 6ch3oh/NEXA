import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createNotionReadComposition,
  resolveNotionSnapshotAuthority,
} from '../src/adapters/notion/notion-composition.mjs';
import { createInMemoryTaskStore, createInMemoryEventStore } from '../src/storage/in-memory-store.mjs';
import { ScheduleQueryService } from '../src/services/schedule-query-service.mjs';
import { ReminderService } from '../src/reminders/reminder-service.mjs';
import { InMemoryReminderStore } from '../src/reminders/reminder-store.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-host-cases.json', import.meta.url),
  'utf8',
));

function fakeHost() {
  const state = {
    get: structuredClone(fixture.snapshots.get_success),
    refresh: structuredClone(fixture.snapshots.refresh_success),
    test: structuredClone(fixture.host_responses.test_success),
    open: structuredClone(fixture.host_responses.open_success),
  };
  const calls = [];
  return {
    state,
    calls,
    api: {
      get: async () => { calls.push('get'); return structuredClone(state.get); },
      refresh: async () => { calls.push('refresh'); return structuredClone(state.refresh); },
      test: async () => { calls.push('test'); return structuredClone(state.test); },
      open: async (target) => { calls.push(`open:${target}`); return structuredClone(state.open); },
    },
  };
}

function compositionFor(host, repository = createInMemoryTaskStore(), options = {}) {
  return {
    repository,
    composition: createNotionReadComposition({
      hostApi: host.api,
      taskRepository: repository,
      explicitNow: fixture.now,
      timezone: fixture.timezone,
      ...options,
    }),
  };
}

test('composition root produces binding Port and Sync Service with an injected fixed clock', () => {
  const host = fakeHost();
  const { composition } = compositionFor(host);
  assert.ok(composition.binding);
  assert.equal(typeof composition.port.getSnapshot, 'function');
  assert.equal(typeof composition.syncService.syncSnapshot, 'function');
  assert.equal(composition.policy.timezone, fixture.timezone);
  assert.equal(Object.isFrozen(composition), true);
});

test('get binding flows Host to Port to Sync and defaults to non-authoritative', async () => {
  const host = fakeHost();
  const { composition, repository } = compositionFor(host);
  const first = await composition.getAndSync();
  assert.equal(first.status, 'synced');
  assert.equal(first.snapshot_state, 'fresh_non_authoritative');
  assert.equal(repository.list()[0].external_id, 'host_page_001');

  host.state.get = structuredClone(fixture.snapshots.fresh_complete_empty);
  const emptyDisplay = await composition.getAndSync();
  assert.equal(emptyDisplay.snapshot_state, 'fresh_non_authoritative');
  assert.equal(emptyDisplay.missing_from_source_count, 0);
  assert.equal(repository.list().length, 1);
  assert.deepEqual(host.calls, ['get', 'get']);
});

test('refresh updates through Sync but never becomes authoritative by default', async () => {
  const host = fakeHost();
  const { composition, repository } = compositionFor(host);
  await composition.getAndSync();
  const refresh = await composition.refreshAndSync({ now: fixture.later_now });
  assert.equal(refresh.snapshot_state, 'fresh_non_authoritative');
  assert.equal(refresh.updated_count, 1);
  const task = repository.list()[0];
  assert.equal(task.title, 'Synthetic host-refreshed task');
  assert.equal(task.status, 'in_progress');
  assert.deepEqual(host.calls, ['get', 'refresh']);
});

test('fresh complete explicit authority proof can emit missing evidence but never deletes', async () => {
  const host = fakeHost();
  const { composition, repository } = compositionFor(host);
  await composition.getAndSync();
  const localId = repository.list()[0].id;
  host.state.refresh = structuredClone(fixture.snapshots.fresh_complete_empty);
  const result = await composition.refreshAndSync({
    now: fixture.later_now,
    authoritative: true,
    authorityProof: fixture.authority_proof,
  });
  assert.equal(result.snapshot_state, 'fresh_complete');
  assert.equal(result.missing_from_source_count, 1);
  assert.equal(result.evidence[0].action, 'missing_from_source');
  assert.equal(repository.getById(localId).id, localId);
});

test('authority gate requires fresh complete authoritative proof from an allowed source', () => {
  assert.equal(resolveNotionSnapshotAuthority(), false);
  assert.equal(resolveNotionSnapshotAuthority({ authoritative: false }), false);
  assert.equal(resolveNotionSnapshotAuthority({
    authoritative: true,
    authorityProof: { ...fixture.authority_proof, source: 'host_metadata' },
  }), true);
  for (const invalid of [
    null,
    { ...fixture.authority_proof, fresh: false },
    { ...fixture.authority_proof, complete: false },
    { ...fixture.authority_proof, authoritative: false },
    { ...fixture.authority_proof, source: 'untrusted' },
  ]) {
    assert.throws(
      () => resolveNotionSnapshotAuthority({ authoritative: true, authorityProof: invalid }),
      /authorityProof/,
    );
  }
});

test('test binding never invokes Sync or mutates Repository', async () => {
  const host = fakeHost();
  const { composition, repository } = compositionFor(host);
  await composition.getAndSync();
  const before = repository.list()[0];
  host.state.test = structuredClone(fixture.host_responses.test_failure);
  const result = await composition.testConnection();
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'AUTH_FAILED');
  assert.deepEqual(repository.list()[0], before);
  assert.deepEqual(host.calls, ['get', 'test']);
});

test('open binding delegates target to fake host and does not invoke Sync', async () => {
  const host = fakeHost();
  const { composition, repository } = compositionFor(host);
  const result = await composition.openExternal(fixture.external_target);
  assert.equal(result.ok, true);
  assert.deepEqual(host.calls, [`open:${fixture.external_target}`]);
  assert.equal(repository.list().length, 0);
});

test('stale cache miss malformed and invalid host response all fail closed without removal', async () => {
  const host = fakeHost();
  const { composition, repository } = compositionFor(host);
  await composition.getAndSync();
  const before = repository.list()[0];
  const proofOptions = {
    now: fixture.later_now,
    authoritative: true,
    authorityProof: fixture.authority_proof,
  };

  host.state.get = structuredClone(fixture.snapshots.stale);
  const stale = await composition.getAndSync(proofOptions);
  assert.equal(stale.status, 'stale_skipped');
  assert.equal(stale.missing_from_source_count, 0);

  host.state.get = structuredClone(fixture.snapshots.cache_miss);
  const miss = await composition.getAndSync(proofOptions);
  assert.equal(miss.status, 'cache_miss');

  host.state.get = structuredClone(fixture.snapshots.malformed_schema);
  const malformed = await composition.getAndSync(proofOptions);
  assert.equal(malformed.status, 'malformed_data');

  host.state.get = fixture.host_responses.invalid;
  const invalid = await composition.getAndSync(proofOptions);
  assert.equal(invalid.status, 'malformed_data');
  assert.deepEqual(repository.getById(before.id), before);
  assert.equal(repository.list().length, 1);
});

test('composition requires explicit host clock repository and timezone dependencies', () => {
  const host = fakeHost();
  assert.throws(() => createNotionReadComposition({
    hostApi: host.api,
    taskRepository: createInMemoryTaskStore(),
    timezone: fixture.timezone,
  }), /clock|explicitNow/);
  assert.throws(() => createNotionReadComposition({
    hostApi: host.api,
    taskRepository: createInMemoryTaskStore(),
    explicitNow: fixture.now,
  }), /timezone/);
});

test('host-synced Task enters existing Schedule and Reminder services locally', async () => {
  const host = fakeHost();
  const taskRepository = createInMemoryTaskStore();
  const eventRepository = createInMemoryEventStore();
  const { composition } = compositionFor(host, taskRepository);
  await composition.getAndSync();

  const schedule = new ScheduleQueryService({ taskRepository, eventRepository });
  const day = schedule.getDayView('2026-08-12', { now: fixture.now, timezone: fixture.timezone });
  assert.equal(day.tasks[0].source, 'notion');

  const reminderService = new ReminderService(new InMemoryReminderStore());
  const planned = reminderService.planAndPersist({
    tasks: taskRepository.list(), events: [], now: fixture.now, timezone: fixture.timezone,
    policy: {
      task_due_minutes_before: 30,
      task_upcoming_minutes_before: null,
      event_start_minutes_before: null,
      date_only_reminder_time: '09:00',
      all_day_reminder_time: null,
    },
  });
  assert.equal(planned.reminders.length, 1);
  assert.equal(planned.notification_intents.length, 1);
  assert.equal('delivery' in planned.notification_intents[0], false);
});
