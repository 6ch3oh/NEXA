import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { NotionReadSyncService } from '../src/adapters/notion/notion-read-sync-service.mjs';
import { createNotionSyncPolicy } from '../src/adapters/notion/notion-sync-policy.mjs';
import { createInMemoryTaskStore, createInMemoryEventStore } from '../src/storage/in-memory-store.mjs';
import { createTask } from '../src/domain/task.mjs';
import { ScheduleQueryService } from '../src/services/schedule-query-service.mjs';
import { ReminderService } from '../src/reminders/reminder-service.mjs';
import { InMemoryReminderStore } from '../src/reminders/reminder-store.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-sync-cases.json', import.meta.url),
  'utf8',
));

class FakeLegacyPort {
  constructor({ getResult, refreshResult } = {}) {
    this.getResult = getResult;
    this.refreshResult = refreshResult;
    this.getCalls = 0;
    this.refreshCalls = 0;
  }

  async getSnapshot() {
    this.getCalls += 1;
    return this.getResult;
  }

  async refresh() {
    this.refreshCalls += 1;
    return this.refreshResult;
  }
}

function success(snapshot) {
  return { ok: true, value: structuredClone(snapshot), failure: null };
}

function serviceFor(port, repository = createInMemoryTaskStore()) {
  return {
    repository,
    service: new NotionReadSyncService({
      port,
      repository,
      policy: createNotionSyncPolicy({ timezone: fixture.timezone }),
    }),
  };
}

test('getAndSync imports one stable NEXA Task without calling refresh', async () => {
  const port = new FakeLegacyPort({ getResult: success(fixture.snapshots.first_import) });
  const { service, repository } = serviceFor(port);
  const result = await service.getAndSync({ now: fixture.now });
  assert.equal(result.status, 'synced');
  assert.equal(result.snapshot_state, 'fresh_non_authoritative');
  assert.equal(result.created_count, 1);
  assert.equal(port.getCalls, 1);
  assert.equal(port.refreshCalls, 0);
  const task = repository.list()[0];
  assert.equal(task.id, 'local_task_sync_page_001');
  assert.equal(task.external_id, 'sync_page_001');
  assert.equal(task.source, 'notion');
});

test('refreshAndSync uses only refresh and repeated identical snapshot is a business no-op', async () => {
  const port = new FakeLegacyPort({ refreshResult: success(fixture.snapshots.first_import) });
  const { service, repository } = serviceFor(port);
  const first = await service.refreshAndSync({ now: fixture.now });
  const originalUpdatedAt = repository.list()[0].updated_at;
  const second = await service.refreshAndSync({ now: fixture.later_now });
  assert.equal(first.created_count, 1);
  assert.equal(second.status, 'no_change');
  assert.equal(second.created_count, 0);
  assert.equal(second.updated_count, 0);
  assert.equal(second.unchanged_count, 1);
  assert.equal(repository.list().length, 1);
  assert.equal(repository.list()[0].updated_at, originalUpdatedAt);
  assert.equal(port.getCalls, 0);
  assert.equal(port.refreshCalls, 2);
});

test('same external identity updates title status and due while keeping the same local id', () => {
  const { service, repository } = serviceFor(new FakeLegacyPort());
  service.syncSnapshot(fixture.snapshots.first_import, { now: fixture.now });
  const localId = repository.list()[0].id;

  assert.equal(service.syncSnapshot(fixture.snapshots.title_update, { now: fixture.later_now }).updated_count, 1);
  assert.equal(repository.getById(localId).title, 'Synthetic renamed task');

  assert.equal(service.syncSnapshot(fixture.snapshots.completed_update, { now: fixture.later_now }).updated_count, 1);
  assert.equal(repository.getById(localId).status, 'completed');
  assert.equal(repository.getById(localId).completed_at, fixture.later_now);
  const repeatedCompletion = service.syncSnapshot(fixture.snapshots.completed_update, {
    now: '2026-08-10T10:00:00+08:00',
  });
  assert.equal(repeatedCompletion.status, 'no_change');
  assert.equal(repository.getById(localId).completed_at, fixture.later_now);

  assert.equal(service.syncSnapshot(fixture.snapshots.due_update, { now: fixture.later_now }).updated_count, 1);
  const updated = repository.getById(localId);
  assert.equal(updated.status, 'pending');
  assert.equal(updated.completed_at, null);
  assert.equal(updated.due_at, '2026-08-13T14:30:00+08:00');
  assert.equal(updated.time_state, 'exact');
  assert.equal(repository.list().length, 1);
});

test('Legacy due removal becomes unscheduled without fabricating a date', () => {
  const { service, repository } = serviceFor(new FakeLegacyPort());
  service.syncSnapshot(fixture.snapshots.first_import, { now: fixture.now });
  const result = service.syncSnapshot(fixture.snapshots.due_removed, { now: fixture.later_now });
  const task = repository.list()[0];
  assert.equal(result.updated_count, 1);
  assert.equal(task.due_at, null);
  assert.equal(task.time_state, 'unscheduled');
  assert.equal(task.timezone, null);
});

test('missing Legacy priority preserves local priority dependencies description and local start', () => {
  const { service, repository } = serviceFor(new FakeLegacyPort());
  repository.create(createTask({
    id: 'local_dependency', title: 'Local dependency', source: 'local',
    created_at: fixture.now, updated_at: fixture.now,
  }));
  service.syncSnapshot(fixture.snapshots.first_import, { now: fixture.now });
  const task = repository.list({ source: 'notion' })[0];
  repository.update(task.id, {
    priority: 'urgent',
    description: 'Local-only note',
    start_at: '2026-08-11T10:00:00+08:00',
    dependencies: ['local_dependency'],
    time_state: 'exact',
  });

  const result = service.syncSnapshot(fixture.snapshots.missing_priority, { now: fixture.later_now });
  const preserved = repository.getById(task.id);
  assert.equal(result.updated_count, 1);
  assert.equal(preserved.priority, 'urgent');
  assert.equal(preserved.description, 'Local-only note');
  assert.equal(preserved.start_at, '2026-08-11T10:00:00+08:00');
  assert.deepEqual(preserved.dependencies, ['local_dependency']);

  service.syncSnapshot(fixture.snapshots.priority_update, { now: fixture.later_now });
  assert.equal(repository.getById(task.id).priority, 'low');
  assert.deepEqual(repository.getById(task.id).dependencies, ['local_dependency']);
});

test('only an explicitly complete fresh snapshot reports missing items and never deletes', () => {
  const { service, repository } = serviceFor(new FakeLegacyPort());
  service.syncSnapshot(fixture.snapshots.first_import, { now: fixture.now });
  const localId = repository.list()[0].id;

  const partial = service.syncSnapshot(fixture.snapshots.fresh_empty, {
    now: fixture.later_now, authoritative: false,
  });
  assert.equal(partial.missing_from_source_count, 0);

  const complete = service.syncSnapshot(fixture.snapshots.fresh_empty, {
    now: fixture.later_now, authoritative: true,
  });
  assert.equal(complete.snapshot_state, 'fresh_complete');
  assert.equal(complete.missing_from_source_count, 1);
  assert.equal(complete.evidence[0].action, 'missing_from_source');
  assert.equal(repository.getById(localId).id, localId);
});

test('stale snapshot cannot overwrite fields or conclude removal even if authoritative is requested', () => {
  const { service, repository } = serviceFor(new FakeLegacyPort());
  service.syncSnapshot(fixture.snapshots.first_import, { now: fixture.now });
  repository.create(createTask({
    id: 'local_task_missing_from_stale', title: 'Must survive stale omission', source: 'notion',
    external_id: 'sync_page_missing_from_stale', created_at: fixture.now, updated_at: fixture.now,
  }));
  const before = repository.getById('local_task_sync_page_001');
  const stale = service.syncSnapshot(fixture.snapshots.stale_changed, {
    now: fixture.later_now, authoritative: true,
  });
  assert.equal(stale.status, 'stale_skipped');
  assert.equal(stale.snapshot_state, 'stale');
  assert.equal(stale.updated_count, 0);
  assert.equal(stale.missing_from_source_count, 0);
  assert.deepEqual(repository.getById(before.id), before);
  assert.equal(repository.getById('local_task_missing_from_stale').title, 'Must survive stale omission');
  assert.equal(repository.list({ source: 'notion' }).length, 2);
});

test('cache miss and port connection error leave existing Notion Tasks untouched', async () => {
  const port = new FakeLegacyPort({
    getResult: { ok: false, value: null, failure: { code: 'CACHE_MISS' } },
    refreshResult: { ok: false, value: null, failure: { code: 'NETWORK_FAILED' } },
  });
  const { service, repository } = serviceFor(port);
  service.syncSnapshot(fixture.snapshots.first_import, { now: fixture.now });
  const before = repository.list()[0];
  const miss = await service.getAndSync({ now: fixture.later_now, authoritative: true });
  const network = await service.refreshAndSync({ now: fixture.later_now, authoritative: true });
  assert.equal(miss.status, 'cache_miss');
  assert.equal(network.status, 'port_error');
  assert.equal(miss.missing_from_source_count, 0);
  assert.deepEqual(repository.getById(before.id), before);
});

test('malformed schema and unknown status reject the entire batch without partial writes', () => {
  const { service, repository } = serviceFor(new FakeLegacyPort());
  const schema = service.syncSnapshot(fixture.snapshots.malformed_schema, { now: fixture.now });
  const mixed = service.syncSnapshot(fixture.snapshots.mixed_malformed, { now: fixture.now });
  const unknown = service.syncSnapshot(fixture.snapshots.unknown_status, { now: fixture.now });
  assert.equal(schema.status, 'malformed_data');
  assert.equal(mixed.status, 'malformed_data');
  assert.equal(mixed.error_count, 1);
  assert.equal(mixed.evidence.some((item) => item.action === 'failed'), true);
  assert.equal(mixed.evidence.some((item) => item.action === 'skipped'), true);
  assert.equal(unknown.status, 'malformed_data');
  assert.equal(repository.list().length, 0);
});

test('synced Task flows through ScheduleQueryService and ReminderService unchanged', () => {
  const taskRepository = createInMemoryTaskStore();
  const eventRepository = createInMemoryEventStore();
  const { service } = serviceFor(new FakeLegacyPort(), taskRepository);
  service.syncSnapshot(fixture.snapshots.first_import, { now: fixture.now });

  const schedule = new ScheduleQueryService({ taskRepository, eventRepository });
  const day = schedule.getDayView('2026-08-12', { now: fixture.now, timezone: fixture.timezone });
  const week = schedule.getWeekView('2026-08-10', { now: fixture.now, timezone: fixture.timezone });
  const month = schedule.getMonthView(2026, 8, { now: fixture.now, timezone: fixture.timezone });
  assert.equal(day.tasks[0].source, 'notion');
  assert.equal(week.days.find((item) => item.date === '2026-08-12').tasks.length, 1);
  assert.equal(month.weeks.flatMap((item) => item.days).find((item) => item.date === '2026-08-12').tasks.length, 1);

  const reminderService = new ReminderService(new InMemoryReminderStore());
  const reminders = reminderService.planAndPersist({
    tasks: taskRepository.list(), events: [], now: fixture.now, timezone: fixture.timezone,
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
