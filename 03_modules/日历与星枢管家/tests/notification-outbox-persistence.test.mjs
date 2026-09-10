import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTodayTomorrowApplication } from '../src/index.mjs';
import { createMobileNotificationHandoff } from '../src/planning/mobile-notification-handoff.mjs';
import { NotificationOutboxService } from '../src/planning/notification-outbox-service.mjs';
import { SQLiteNotificationOutboxStore } from '../src/planning/sqlite-notification-outbox-store.mjs';
import { createNotificationIntent } from '../src/reminders/notification-intent.mjs';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.mjs';
import {
  NOTIFICATION_OUTBOX_SCHEMA_COMPONENT,
  NOTIFICATION_OUTBOX_SCHEMA_VERSION,
  getNotificationOutboxSchemaVersion,
} from '../src/storage/sqlite-schema.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const NOW_1 = '2026-08-23T08:00:00+08:00';
const NOW_2 = '2026-08-23T09:00:00+08:00';
const NOW_3 = '2026-08-23T10:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';
const DATABASE_FILENAME = 'today-tomorrow-v0.1.sqlite';

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

function createApp(dataRoot, now = NOW_1) {
  return createTodayTomorrowApplication({ dataRoot, timezone: TIMEZONE, clock: () => now });
}

function seedPendingOutbox(dataRoot, suffix) {
  const taskId = `outbox_task_${suffix}`;
  const app = createApp(dataRoot, NOW_1);
  app.start();
  assert.equal(app.execute(command(`create_${suffix}`, 'task.create', {
    task: { id: taskId, title: taskId, priority: 'normal' },
  })).status, 'executed');
  const plan = app.assignTaskToDay(taskId, '2026-08-23', {
    actor: 'user', command_id: `assign_${suffix}`,
  });
  const confirmed = app.confirmTaskTime(plan.id, {
    planned_start_at: '2026-08-23T14:00:00+08:00',
    planned_end_at: '2026-08-23T15:00:00+08:00',
    actor: 'user',
    command_id: `confirm_${suffix}`,
  });
  assert.equal(confirmed.status, 'CONFIRMED');
  return { app, plan, taskId };
}

function openOutbox(dataRoot) {
  const sqlite = openSQLiteStore(join(dataRoot, DATABASE_FILENAME));
  const store = new SQLiteNotificationOutboxStore(sqlite.database);
  return { sqlite, store, service: new NotificationOutboxService(store) };
}

function restartApplication(dataRoot, now = NOW_2) {
  const app = createApp(dataRoot, now);
  app.start();
  app.stop();
}

test('PENDING Outbox and existing handoff identity survive Application restart', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-outbox-pending-'));
  const { app, taskId } = seedPendingOutbox(dataRoot, 'pending');
  try {
    app.stop();
    restartApplication(dataRoot);
    const { sqlite, service } = openOutbox(dataRoot);
    try {
      const pending = service.listPending();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].state, 'pending');

      const reminder = new SQLiteReminderStore(sqlite.database).list({ source_id: taskId })[0];
      const intent = createNotificationIntent({
        reminder,
        title: taskId,
        body: 'Planned task time',
        priority: 'normal',
      });
      const expected = createMobileNotificationHandoff({
        notification_intent: intent,
        body: intent.body,
        created_at: NOW_1,
      });
      assert.equal(pending[0].handoff_id, expected.handoff_id);
      assert.equal(pending[0].dedupe_key, expected.dedupe_key);
      assert.deepEqual(pending[0].payload, expected);
    } finally {
      sqlite.close();
    }
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('HANDED_OFF state survives Application restart and is not returned as pending', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-outbox-handed-off-'));
  const { app } = seedPendingOutbox(dataRoot, 'handed');
  try {
    const first = openOutbox(dataRoot);
    const handoffId = first.service.listPending()[0].handoff_id;
    assert.equal(first.service.markHandedOff(handoffId, { now: NOW_2 }).state, 'handed_off');
    first.sqlite.close();
    app.stop();

    restartApplication(dataRoot, NOW_3);
    const reopened = openOutbox(dataRoot);
    try {
      assert.equal(reopened.service.getByHandoffId(handoffId).state, 'handed_off');
      assert.equal(reopened.service.listPending().length, 0);
      assert.equal(reopened.service.getByHandoffId(handoffId).handed_off_at, NOW_2);
    } finally {
      reopened.sqlite.close();
    }
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('ACKNOWLEDGED state survives Application restart without claiming device delivery', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-outbox-ack-'));
  const { app } = seedPendingOutbox(dataRoot, 'ack');
  try {
    const first = openOutbox(dataRoot);
    const handoffId = first.service.listPending()[0].handoff_id;
    first.service.markHandedOff(handoffId, { now: NOW_2 });
    assert.equal(first.service.acknowledge(handoffId, { now: NOW_3 }).state, 'acknowledged');
    first.sqlite.close();
    app.stop();

    restartApplication(dataRoot, NOW_3);
    const reopened = openOutbox(dataRoot);
    try {
      const acknowledged = reopened.service.getByHandoffId(handoffId);
      assert.equal(acknowledged.state, 'acknowledged');
      assert.equal(acknowledged.acknowledged_at, NOW_3);
      assert.equal(Object.hasOwn(acknowledged.payload, 'delivery_performed'), false);
    } finally {
      reopened.sqlite.close();
    }
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('reconciling the same Reminder after restart does not create a second logical Outbox record', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-outbox-dedupe-'));
  let seeded = seedPendingOutbox(dataRoot, 'dedupe');
  try {
    const planId = seeded.plan.id;
    seeded.app.stop();
    seeded = { ...seeded, app: createApp(dataRoot, NOW_2) };
    seeded.app.start();
    seeded.app.confirmTaskTime(planId, {
      planned_start_at: '2026-08-23T14:00:00+08:00',
      planned_end_at: '2026-08-23T15:00:00+08:00',
      actor: 'user',
      command_id: 'confirm_dedupe_again',
      now: NOW_2,
    });
    seeded.app.stop();

    const reopened = openOutbox(dataRoot);
    try {
      assert.equal(reopened.service.list().length, 1);
      assert.equal(reopened.service.listPending().length, 1);
    } finally {
      reopened.sqlite.close();
    }
  } finally {
    seeded.app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('Reminder cancellation terminates only the pending Outbox without Android delivery', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-outbox-cancel-'));
  const { app, taskId } = seedPendingOutbox(dataRoot, 'cancel');
  try {
    const completed = app.execute(command('complete_outbox_task', 'task.complete', { task_id: taskId }));
    assert.equal(completed.status, 'executed');
    app.stop();
    const reopened = openOutbox(dataRoot);
    try {
      assert.equal(reopened.service.listPending().length, 0);
      assert.equal(reopened.service.list()[0].state, 'cancelled');
      assert.equal(Object.hasOwn(reopened.service.list()[0].payload, 'delivery_performed'), false);
    } finally {
      reopened.sqlite.close();
    }
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('Outbox migration is additive and a future component version fails closed', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-outbox-schema-'));
  const filename = join(dataRoot, 'outbox.sqlite');
  try {
    let sqlite = openSQLiteStore(filename);
    assert.equal(sqlite.schemaVersion, 1);
    assert.equal(getNotificationOutboxSchemaVersion(sqlite.database), NOTIFICATION_OUTBOX_SCHEMA_VERSION);
    sqlite.database.prepare(
      'UPDATE schema_components SET version = ? WHERE component = ?',
    ).run(NOTIFICATION_OUTBOX_SCHEMA_VERSION + 1, NOTIFICATION_OUTBOX_SCHEMA_COMPONENT);
    sqlite.close();
    assert.throws(() => openSQLiteStore(filename), /Unsupported Notification Outbox schema version/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
