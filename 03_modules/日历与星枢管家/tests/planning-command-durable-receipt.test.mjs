import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createTodayTomorrowApplication } from '../src/index.mjs';

const NOW_1 = '2026-08-23T08:00:00+08:00';
const NOW_2 = '2026-08-23T09:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function command(command_id, command_type, payload, {
  now = NOW_1,
  confirmation_state = 'not_required',
  risk_level = 'medium',
  requires_confirmation = false,
} = {}) {
  return {
    command_id,
    command_type,
    payload,
    created_at: now,
    risk_level,
    requires_confirmation,
    confirmation_state,
    source: 'local',
  };
}

function confirmed(commandId, commandType, payload, now = NOW_1) {
  return command(commandId, commandType, payload, {
    now,
    confirmation_state: 'confirmed',
    risk_level: 'high',
    requires_confirmation: true,
  });
}

function createApp(dataRoot, now = NOW_1) {
  return createTodayTomorrowApplication({ dataRoot, timezone: TIMEZONE, clock: () => now });
}

function createTask(app, id) {
  const result = app.execute(command(`create_${id}`, 'task.create', {
    task: { id, title: id, due_at: '2026-08-30', time_state: 'date_only' },
  }, { risk_level: 'low' }));
  assert.equal(result.status, 'executed');
}

test('all current planning actions execute through the existing command and confirmation path', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-planning-command-path-'));
  const databaseFile = join(dataRoot, 'today-tomorrow-v0.1.sqlite');
  const app = createApp(dataRoot);
  try {
    app.start();
    createTask(app, 'task_a');
    createTask(app, 'task_b');

    const assignedA = app.assignTaskToDay('task_a', '2026-08-23', {
      actor: 'user', command_id: 'planning_assign_a',
    });
    const assignedB = app.execute(command('planning_assign_b', 'planning.assign_task_to_day', {
      task_id: 'task_b', plan_date: '2026-08-23',
    }));
    assert.equal(assignedB.status, 'executed');

    const downgraded = app.execute(command('planning_downgrade_denied', 'planning.confirm_task_time', {
      plan_id: assignedA.id,
      planned_start_at: '2026-08-23T09:00:00+08:00',
      planned_end_at: '2026-08-23T10:00:00+08:00',
      actor: 'user',
    }, { risk_level: 'low' }));
    assert.equal(downgraded.status, 'confirmation_required');

    const pending = app.execute(command(
      'planning_confirm_a',
      'planning.confirm_task_time',
      {
        plan_id: assignedA.id,
        planned_start_at: '2026-08-23T10:00:00+08:00',
        planned_end_at: '2026-08-23T11:00:00+08:00',
        actor: 'user',
      },
      { confirmation_state: 'pending', risk_level: 'high', requires_confirmation: true },
    ));
    assert.equal(pending.status, 'confirmation_required');
    assert.equal(app.execute(confirmed('planning_confirm_a', 'planning.confirm_task_time', {
      plan_id: assignedA.id,
      planned_start_at: '2026-08-23T10:00:00+08:00',
      planned_end_at: '2026-08-23T11:00:00+08:00',
      actor: 'user',
    })).status, 'executed');
    assert.equal(app.execute(confirmed('planning_change_a', 'planning.change_task_time', {
      plan_id: assignedA.id,
      planned_start_at: '2026-08-23T12:00:00+08:00',
      planned_end_at: '2026-08-23T13:00:00+08:00',
      actor: 'user',
    })).status, 'executed');
    assert.equal(app.execute(confirmed('planning_remove_a', 'planning.remove_task_time', {
      plan_id: assignedA.id, actor: 'user',
    })).status, 'executed');
    assert.equal(app.execute(command('planning_reorder', 'planning.reorder_tasks', {
      plan_date: '2026-08-23',
      ordered_plan_ids: [assignedB.data.id, assignedA.id],
      actor: 'user',
    })).status, 'executed');
    assert.equal(app.execute(command('planning_pin', 'planning.pin_plan', {
      plan_id: assignedB.data.id, pinned: true, actor: 'user',
    })).status, 'executed');
    assert.equal(app.execute(confirmed('planning_carryover_confirm', 'planning.confirm_carryover', {
      plan_id: assignedA.id, to_date: '2026-08-24', actor: 'user',
    })).status, 'executed');
    assert.equal(app.execute(confirmed('planning_carryover_reject', 'planning.reject_carryover', {
      plan_id: assignedB.data.id, actor: 'user',
    })).status, 'executed');
    app.stop();

    const database = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      const executedTypes = database.prepare(
        'SELECT DISTINCT command_type FROM command_receipts WHERE executed = 1 AND command_type LIKE ? ORDER BY command_type',
      ).all('planning.%').map((row) => row.command_type);
      assert.deepEqual(executedTypes, [
        'planning.assign_task_to_day',
        'planning.change_task_time',
        'planning.confirm_carryover',
        'planning.confirm_task_time',
        'planning.pin_plan',
        'planning.reject_carryover',
        'planning.remove_task_time',
        'planning.reorder_tasks',
      ]);
      const confirmedReceipt = database.prepare(
        'SELECT result_json, before_evidence_json, after_evidence_json FROM command_receipts WHERE command_id = ? AND executed = 1',
      ).get('planning_confirm_a');
      assert.ok(confirmedReceipt.result_json);
      assert.ok(confirmedReceipt.before_evidence_json);
      assert.ok(confirmedReceipt.after_evidence_json);
    } finally {
      database.close();
    }
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('successful planning command is duplicate-safe after Application and SQLite restart', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-planning-restart-'));
  const databaseFile = join(dataRoot, 'today-tomorrow-v0.1.sqlite');
  let app = createApp(dataRoot, NOW_1);
  try {
    app.start();
    createTask(app, 'task_restart');
    const assigned = app.execute(command('restart_assign', 'planning.assign_task_to_day', {
      task_id: 'task_restart', plan_date: '2026-08-23',
    }));
    const payload = {
      plan_id: assigned.data.id,
      planned_start_at: '2026-08-23T15:00:00+08:00',
      planned_end_at: '2026-08-23T16:00:00+08:00',
      actor: 'user',
    };
    const first = app.execute(confirmed('restart_confirm', 'planning.confirm_task_time', payload));
    assert.equal(first.status, 'executed');
    const firstUpdatedAt = first.data.entry.updated_at;
    app.stop();

    app = createApp(dataRoot, NOW_2);
    app.start();
    const duplicate = app.execute(
      confirmed('restart_confirm', 'planning.confirm_task_time', payload, NOW_2),
      { now: NOW_2 },
    );
    assert.equal(duplicate.status, 'duplicate');
    assert.deepEqual(duplicate.data.result, first.data);
    assert.equal(app.getToday('2026-08-23', { now: NOW_2 }).confirmed_task_plans.length, 1);
    const afterDuplicate = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      assert.equal(
        afterDuplicate.prepare('SELECT updated_at FROM daily_plan_entries WHERE id = ?').get(payload.plan_id).updated_at,
        firstUpdatedAt,
      );
    } finally {
      afterDuplicate.close();
    }

    const conflict = app.execute(confirmed('restart_confirm', 'planning.confirm_task_time', {
      ...payload,
      planned_end_at: '2026-08-23T16:30:00+08:00',
    }, NOW_2), { now: NOW_2 });
    assert.equal(conflict.status, 'invalid');
    assert.equal(conflict.code, 'COMMAND_ID_CONFLICT');
    const afterConflict = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      assert.equal(
        afterConflict.prepare('SELECT planned_end_at FROM daily_plan_entries WHERE id = ?').get(payload.plan_id).planned_end_at,
        payload.planned_end_at,
      );
    } finally {
      afterConflict.close();
    }
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
