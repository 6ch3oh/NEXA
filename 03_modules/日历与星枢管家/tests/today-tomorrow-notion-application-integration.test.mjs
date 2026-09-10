import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTodayTomorrowApplication } from '../src/index.mjs';
import { NotificationOutboxService } from '../src/planning/notification-outbox-service.mjs';
import { SQLiteNotificationOutboxStore } from '../src/planning/sqlite-notification-outbox-store.mjs';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-host-cases.json', import.meta.url),
  'utf8',
));
const NOW_1 = fixture.now;
const NOW_2 = fixture.later_now;
const TIMEZONE = fixture.timezone;
const DATABASE_FILENAME = 'today-tomorrow-v0.1.sqlite';

function fakeNotionWindow() {
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
    windowLike: { tokenMonitor: { notionTodo: {
      get: async () => { calls.push('get'); return structuredClone(state.get); },
      refresh: async () => { calls.push('refresh'); return structuredClone(state.refresh); },
      test: async () => { calls.push('test'); return structuredClone(state.test); },
      open: async (target) => { calls.push(`open:${target}`); return structuredClone(state.open); },
    } } },
  };
}

function createApp(dataRoot, host = null, now = NOW_1) {
  return createTodayTomorrowApplication({
    dataRoot,
    timezone: TIMEZONE,
    clock: () => now,
    ...(host == null ? {} : { notion: { windowLike: host.windowLike } }),
  });
}

function command(commandId, commandType, payload, now = NOW_1) {
  return {
    command_id: commandId,
    command_type: commandType,
    payload,
    created_at: now,
    risk_level: 'low',
    requires_confirmation: false,
    confirmation_state: 'not_required',
    source: 'local',
  };
}

test('Application remains fully usable when Notion is not configured', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-application-no-notion-'));
  const app = createApp(dataRoot);
  try {
    assert.equal(Object.hasOwn(app, 'notion'), false);
    app.start();
    assert.equal(app.execute(command('no_notion_task', 'task.create', {
      task: { id: 'no_notion_task', title: 'No Notion required' },
    })).status, 'executed');
    assert.equal(app.getTask('no_notion_task').title, 'No Notion required');
    assert.equal(app.getToday('2026-08-10').date, '2026-08-10');
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('Application composes and delegates the existing Butler Notion Runtime facade', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-application-notion-facade-'));
  const host = fakeNotionWindow();
  const app = createApp(dataRoot, host);
  try {
    assert.deepEqual(Object.keys(app.notion).sort(), [
      'getAndSync', 'getStatus', 'openExternal', 'refreshAndSync', 'testConnection',
    ]);
    app.start();
    assert.equal(app.notion.getStatus().ready, true);
    assert.equal((await app.notion.testConnection()).ok, true);
    assert.equal((await app.notion.openExternal(fixture.external_target)).ok, true);
    assert.deepEqual(host.calls, ['test', `open:${fixture.external_target}`]);
    assert.equal(app.stop(), true);
    assert.equal(app.notion.getStatus().disposed, true);

    assert.equal(app.start().state, 'started');
    assert.equal(app.notion.getStatus().disposed, false);
    assert.equal(app.stop(), true);
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('Application getAndSync and restart preserve one local identity for one external item', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-application-notion-identity-'));
  const host = fakeNotionWindow();
  let app = createApp(dataRoot, host);
  try {
    app.start();
    const first = await app.notion.getAndSync();
    assert.equal(first.created_count, 1);
    const firstTask = app.listTasks({ source: 'notion' })[0];
    assert.equal(firstTask.external_id, 'host_page_001');
    assert.equal(firstTask.source, 'notion');
    app.stop();

    app = createApp(dataRoot, host, NOW_2);
    app.start();
    const second = await app.notion.getAndSync({ now: NOW_2 });
    const restartedTask = app.listTasks({ source: 'notion' })[0];
    assert.equal(second.created_count, 0);
    assert.equal(restartedTask.id, firstTask.id);
    assert.equal(restartedTask.external_id, firstTask.external_id);
    assert.equal(app.listTasks({ source: 'notion' }).length, 1);
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('refresh preserves local dependency priority planning time Reminder and Outbox state', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-application-notion-preservation-'));
  const host = fakeNotionWindow();
  delete host.state.refresh.items[0].priority;
  const app = createApp(dataRoot, host);
  let sideStore = null;
  try {
    app.start();
    await app.notion.getAndSync();
    const notionTask = app.listTasks({ source: 'notion' })[0];
    assert.equal(app.execute(command('create_local_dependency', 'task.create', {
      task: { id: 'local_dependency', title: 'Local dependency' },
    })).status, 'executed');
    assert.equal(app.execute(command('extend_notion_task', 'task.update', {
      task_id: notionTask.id,
      patch: { priority: 'urgent', dependencies: ['local_dependency'] },
    })).status, 'executed');

    const plan = app.assignTaskToDay(notionTask.id, '2026-08-10', {
      actor: 'user', command_id: 'assign_notion_task',
    });
    app.confirmTaskTime(plan.id, {
      planned_start_at: '2026-08-10T16:00:00+08:00',
      planned_end_at: '2026-08-10T17:00:00+08:00',
      actor: 'user',
      command_id: 'confirm_notion_task',
    });

    sideStore = openSQLiteStore(join(dataRoot, DATABASE_FILENAME));
    const reminderStore = new SQLiteReminderStore(sideStore.database);
    const outboxService = new NotificationOutboxService(
      new SQLiteNotificationOutboxStore(sideStore.database),
    );
    const reminder = reminderStore.list({ source_id: notionTask.id })[0];
    reminderStore.dismiss(reminder.id, { now: NOW_2, timezone: TIMEZONE });
    const handoff = outboxService.listPending()[0];
    outboxService.markHandedOff(handoff.handoff_id, { now: NOW_2 });
    sideStore.close();
    sideStore = null;

    const refreshed = await app.notion.refreshAndSync({ now: NOW_2 });
    assert.equal(refreshed.updated_count, 1);
    const after = app.getTask(notionTask.id);
    assert.equal(after.id, notionTask.id);
    assert.equal(after.source, 'notion');
    assert.equal(after.external_id, notionTask.external_id);
    assert.equal(after.priority, 'urgent');
    assert.deepEqual(after.dependencies, ['local_dependency']);

    const today = app.getToday('2026-08-10', { now: NOW_2 });
    assert.equal(today.confirmed_task_plans.length, 1);
    assert.equal(today.confirmed_task_plans[0].planned_start_at, '2026-08-10T16:00:00+08:00');

    sideStore = openSQLiteStore(join(dataRoot, DATABASE_FILENAME));
    const persistedReminder = new SQLiteReminderStore(sideStore.database).getById(reminder.id);
    const persistedOutbox = new SQLiteNotificationOutboxStore(sideStore.database).getByHandoffId(handoff.handoff_id);
    assert.equal(persistedReminder.state, 'dismissed');
    assert.equal(persistedOutbox.state, 'handed_off');
    assert.equal(new SQLiteNotificationOutboxStore(sideStore.database).list().length, 1);
  } finally {
    sideStore?.close();
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('Application path keeps stale cache-miss and malformed snapshots fail-safe', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-application-notion-safe-'));
  const host = fakeNotionWindow();
  const app = createApp(dataRoot, host);
  try {
    app.start();
    await app.notion.getAndSync();
    const before = app.listTasks({ source: 'notion' })[0];

    host.state.get = structuredClone(fixture.snapshots.stale);
    assert.equal((await app.notion.getAndSync({ now: NOW_2 })).status, 'stale_skipped');
    host.state.get = structuredClone(fixture.snapshots.cache_miss);
    assert.equal((await app.notion.getAndSync({ now: NOW_2 })).status, 'cache_miss');
    host.state.get = structuredClone(fixture.snapshots.malformed_schema);
    assert.equal((await app.notion.getAndSync({ now: NOW_2 })).status, 'malformed_data');

    assert.deepEqual(app.getTask(before.id), before);
    assert.equal(app.listTasks({ source: 'notion' }).length, 1);
    assert.equal(Object.keys(app.notion).some((key) => /create|update|complete|reopen/i.test(key)), false);
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
