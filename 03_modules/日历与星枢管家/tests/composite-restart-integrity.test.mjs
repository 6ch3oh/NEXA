import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTodayTomorrowApplication } from '../src/index.mjs';
import { SQLiteCommandReceiptStore } from '../src/commands/sqlite-receipt-store.mjs';
import { NotificationOutboxService } from '../src/planning/notification-outbox-service.mjs';
import { SQLiteDailyPlanStore } from '../src/planning/sqlite-daily-plan-store.mjs';
import { SQLiteNotificationOutboxStore } from '../src/planning/sqlite-notification-outbox-store.mjs';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const notionFixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-host-cases.json', import.meta.url),
  'utf8',
));
const NOW_1 = notionFixture.now;
const NOW_2 = notionFixture.later_now;
const READY_NOW = '2026-08-10T10:30:00+08:00';
const HANDOFF_NOW = '2026-08-10T08:30:00+08:00';
const ACKNOWLEDGED_NOW = '2026-08-10T08:40:00+08:00';
const TIMEZONE = notionFixture.timezone;
const PLAN_DATE = '2026-08-10';
const CARRYOVER_DATE = '2026-08-11';
const DATABASE_FILENAME = 'today-tomorrow-v0.1.sqlite';

function fakeNotionHost() {
  const state = {
    get: structuredClone(notionFixture.snapshots.get_success),
    refresh: structuredClone(notionFixture.snapshots.refresh_success),
    test: structuredClone(notionFixture.host_responses.test_success),
    open: structuredClone(notionFixture.host_responses.open_success),
  };
  delete state.refresh.items[0].priority;
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

function createApplication(dataRoot, host, now) {
  return createTodayTomorrowApplication({
    dataRoot,
    timezone: TIMEZONE,
    clock: () => now,
    notion: { windowLike: host.windowLike },
  });
}

function command(commandId, commandType, payload, {
  now = NOW_1,
  risk = 'low',
  confirmationState = 'not_required',
  requiresConfirmation = false,
} = {}) {
  return {
    command_id: commandId,
    command_type: commandType,
    payload,
    created_at: now,
    risk_level: risk,
    requires_confirmation: requiresConfirmation,
    confirmation_state: confirmationState,
    source: 'local',
  };
}

function confirmedPlanningCommand(commandId, commandType, payload, now = NOW_1) {
  return command(commandId, commandType, payload, {
    now,
    risk: 'high',
    confirmationState: 'confirmed',
    requiresConfirmation: true,
  });
}

function createTask(app, id) {
  const result = app.execute(command(`create_${id}`, 'task.create', {
    task: { id, title: id, priority: 'normal' },
  }));
  assert.equal(result.status, 'executed');
  return result.data;
}

function assignAndConfirm(app, taskId, suffix, start, end) {
  const plan = app.assignTaskToDay(taskId, PLAN_DATE, {
    actor: 'user', command_id: `assign_${suffix}`,
  });
  const result = app.confirmTaskTime(plan.id, {
    planned_start_at: start,
    planned_end_at: end,
    actor: 'user',
    command_id: `confirm_${suffix}`,
  });
  assert.equal(result.status, 'CONFIRMED');
  return plan;
}

function openInternalState(dataRoot) {
  const sqlite = openSQLiteStore(join(dataRoot, DATABASE_FILENAME));
  const planStore = new SQLiteDailyPlanStore(sqlite.database);
  const reminderStore = new SQLiteReminderStore(sqlite.database);
  const outboxStore = new SQLiteNotificationOutboxStore(sqlite.database);
  return {
    sqlite,
    planStore,
    reminderStore,
    outboxStore,
    outboxService: new NotificationOutboxService(outboxStore),
    receiptStore: new SQLiteCommandReceiptStore(sqlite.database),
  };
}

test('single composite scenario restores every persisted subsystem across a new Application instance', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-composite-restart-'));
  const host = fakeNotionHost();
  let firstApp = createApplication(dataRoot, host, NOW_1);
  let secondApp = null;
  let internal = null;

  const mainConfirmPayload = {
    plan_id: null,
    planned_start_at: '2026-08-10T10:00:00+08:00',
    planned_end_at: '2026-08-10T11:00:00+08:00',
    actor: 'user',
  };

  try {
    // Phase A/B: construct all state through the first real Application lifecycle.
    firstApp.start();
    const mainTask = createTask(firstApp, 'composite_main');
    const handedTask = createTask(firstApp, 'composite_handed');
    const acknowledgedTask = createTask(firstApp, 'composite_acknowledged');
    const eventResult = firstApp.execute(command('create_composite_event', 'calendar.create', {
      event: {
        id: 'composite_event',
        title: 'Composite fixed event',
        start_at: '2026-08-10T08:30:00+08:00',
        end_at: '2026-08-10T09:00:00+08:00',
      },
    }));
    assert.equal(eventResult.status, 'executed');

    const mainPlan = firstApp.assignTaskToDay(mainTask.id, PLAN_DATE, {
      actor: 'user', command_id: 'assign_composite_main',
    });
    mainConfirmPayload.plan_id = mainPlan.id;
    const firstMainConfirmation = firstApp.execute(confirmedPlanningCommand(
      'composite_durable_confirmation',
      'planning.confirm_task_time',
      mainConfirmPayload,
    ));
    assert.equal(firstMainConfirmation.status, 'executed');
    const mainUpdatedAt = firstMainConfirmation.data.entry.updated_at;

    const pinResult = firstApp.execute(command('pin_composite_main', 'planning.pin_plan', {
      plan_id: mainPlan.id,
      pinned: true,
      actor: 'user',
    }, { risk: 'medium' }));
    assert.equal(pinResult.status, 'executed');
    const carryover = firstApp.confirmCarryover(mainPlan.id, CARRYOVER_DATE, {
      actor: 'user', command_id: 'carryover_composite_main',
    });
    assert.equal(carryover.historical.carryover_decision, 'confirmed');

    const handedPlan = assignAndConfirm(
      firstApp,
      handedTask.id,
      'composite_handed',
      '2026-08-10T12:00:00+08:00',
      '2026-08-10T13:00:00+08:00',
    );
    const acknowledgedPlan = assignAndConfirm(
      firstApp,
      acknowledgedTask.id,
      'composite_acknowledged',
      '2026-08-10T14:00:00+08:00',
      '2026-08-10T15:00:00+08:00',
    );

    const notionSync = await firstApp.notion.getAndSync();
    assert.equal(notionSync.created_count, 1);
    const notionTask = firstApp.listTasks({ source: 'notion' })[0];
    assert.equal(firstApp.execute(command('extend_composite_notion', 'task.update', {
      task_id: notionTask.id,
      patch: { priority: 'urgent', dependencies: [mainTask.id] },
    })).status, 'executed');
    const notionPlan = assignAndConfirm(
      firstApp,
      notionTask.id,
      'composite_notion',
      '2026-08-10T16:00:00+08:00',
      '2026-08-10T17:00:00+08:00',
    );

    // Use existing internal lifecycle services; do not insert raw database rows.
    internal = openInternalState(dataRoot);
    const mainReminder = internal.reminderStore.list({ source_id: mainTask.id })[0];
    const handedReminder = internal.reminderStore.list({ source_id: handedTask.id })[0];
    const acknowledgedReminder = internal.reminderStore.list({ source_id: acknowledgedTask.id })[0];
    assert.ok(internal.reminderStore.listReady({ now: READY_NOW, timezone: TIMEZONE })
      .some((reminder) => reminder.id === mainReminder.id));

    const handedOutbox = internal.outboxService.list()
      .find((entry) => entry.reminder_id === handedReminder.id);
    const acknowledgedOutbox = internal.outboxService.list()
      .find((entry) => entry.reminder_id === acknowledgedReminder.id);
    internal.outboxService.markHandedOff(handedOutbox.handoff_id, { now: HANDOFF_NOW });
    internal.outboxService.markHandedOff(acknowledgedOutbox.handoff_id, { now: HANDOFF_NOW });
    internal.outboxService.acknowledge(acknowledgedOutbox.handoff_id, { now: ACKNOWLEDGED_NOW });

    const outboxCountBeforeRestart = internal.outboxService.list().length;
    const reminderCountBeforeRestart = internal.reminderStore.list().length;
    assert.ok(internal.outboxService.listPending().length >= 1);
    assert.equal(internal.receiptStore.findExecutedByCommandId('composite_durable_confirmation').executed, true);
    internal.sqlite.close();
    internal = null;

    // Phase C/D: real stop boundary and a completely new Application instance.
    assert.equal(firstApp.stop(), true);
    firstApp = null;
    secondApp = createApplication(dataRoot, host, NOW_2);
    secondApp.start();

    // Task and Calendar recover through formal Application command/read paths.
    const recoveredMain = secondApp.getTask(mainTask.id);
    assert.equal(recoveredMain.title, mainTask.title);
    const recoveredEvent = secondApp.execute(command(
      'get_composite_event_after_restart',
      'calendar.get',
      { event_id: eventResult.data.id },
      { now: NOW_2 },
    ));
    assert.equal(recoveredEvent.status, 'executed');
    assert.equal(recoveredEvent.data.title, eventResult.data.title);

    // Durable Receipt replay must not execute confirmation, Reminder, or Outbox side effects again.
    internal = openInternalState(dataRoot);
    const outboxCountBeforeReplay = internal.outboxService.list().length;
    const reminderCountBeforeReplay = internal.reminderStore.list().length;
    const planBeforeReplay = internal.planStore.getById(mainPlan.id);
    internal.sqlite.close();
    internal = null;

    const duplicate = secondApp.execute(confirmedPlanningCommand(
      'composite_durable_confirmation',
      'planning.confirm_task_time',
      mainConfirmPayload,
      NOW_2,
    ), { now: NOW_2 });
    assert.equal(duplicate.status, 'duplicate');
    assert.deepEqual(duplicate.data.result, firstMainConfirmation.data);
    const conflict = secondApp.execute(confirmedPlanningCommand(
      'composite_durable_confirmation',
      'planning.confirm_task_time',
      { ...mainConfirmPayload, planned_end_at: '2026-08-10T11:30:00+08:00' },
      NOW_2,
    ), { now: NOW_2 });
    assert.equal(conflict.status, 'invalid');
    assert.equal(conflict.code, 'COMMAND_ID_CONFLICT');

    // A real repeat reconcile uses stable Reminder/Handoff identity and remains one Outbox row.
    secondApp.confirmTaskTime(handedPlan.id, {
      planned_start_at: '2026-08-10T12:00:00+08:00',
      planned_end_at: '2026-08-10T13:00:00+08:00',
      actor: 'user',
      command_id: 'reconcile_composite_handed_again',
      now: NOW_2,
    });

    // Fake refresh after restart must preserve NEXA-owned state.
    const refreshed = await secondApp.notion.refreshAndSync({ now: NOW_2 });
    assert.equal(refreshed.updated_count, 1);
    const recoveredNotion = secondApp.getTask(notionTask.id);
    assert.equal(recoveredNotion.id, notionTask.id);
    assert.equal(recoveredNotion.source, 'notion');
    assert.equal(recoveredNotion.external_id, notionTask.external_id);
    assert.equal(recoveredNotion.priority, 'urgent');
    assert.deepEqual(recoveredNotion.dependencies, [mainTask.id]);
    assert.equal(secondApp.listTasks({ source: 'notion' }).length, 1);

    // Cross-state evidence after all restart operations.
    internal = openInternalState(dataRoot);
    const recoveredMainPlan = internal.planStore.getById(mainPlan.id);
    const recoveredCarryover = internal.planStore.list({ plan_date: CARRYOVER_DATE })
      .find((plan) => plan.task_id === mainTask.id);
    const recoveredNotionPlan = internal.planStore.getById(notionPlan.id);
    assert.equal(recoveredMainPlan.plan_date, PLAN_DATE);
    assert.equal(recoveredMainPlan.time_confirmation_state, 'time_confirmed');
    assert.equal(recoveredMainPlan.planned_start_at, mainConfirmPayload.planned_start_at);
    assert.equal(recoveredMainPlan.pinned, true);
    assert.equal(recoveredMainPlan.carryover_decision, 'confirmed');
    assert.equal(recoveredCarryover.carryover_from_date, PLAN_DATE);
    assert.equal(recoveredNotionPlan.time_confirmation_state, 'time_confirmed');
    assert.equal(recoveredNotionPlan.planned_start_at, '2026-08-10T16:00:00+08:00');

    const recoveredMainReminder = internal.reminderStore.getById(mainReminder.id);
    assert.equal(recoveredMainReminder.state, 'ready');
    assert.equal(internal.reminderStore.list().length, reminderCountBeforeRestart);
    assert.equal(internal.reminderStore.list().length, reminderCountBeforeReplay);

    const recoveredHanded = internal.outboxService.getByHandoffId(handedOutbox.handoff_id);
    const recoveredAcknowledged = internal.outboxService.getByHandoffId(acknowledgedOutbox.handoff_id);
    assert.equal(recoveredHanded.state, 'handed_off');
    assert.equal(recoveredAcknowledged.state, 'acknowledged');
    assert.ok(internal.outboxService.listPending().length >= 1);
    assert.equal(internal.outboxService.list().length, outboxCountBeforeRestart);
    assert.equal(internal.outboxService.list().length, outboxCountBeforeReplay);

    assert.equal(internal.planStore.getById(mainPlan.id).updated_at, planBeforeReplay.updated_at);
    assert.equal(internal.planStore.getById(mainPlan.id).updated_at, mainUpdatedAt);
    assert.equal(internal.receiptStore.findExecutedByCommandId('composite_durable_confirmation').executed, true);
    assert.equal(internal.planStore.getById(acknowledgedPlan.id).time_confirmation_state, 'time_confirmed');
    assert.equal(outboxCountBeforeReplay, outboxCountBeforeRestart);
  } finally {
    internal?.sqlite.close();
    firstApp?.dispose();
    secondApp?.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
