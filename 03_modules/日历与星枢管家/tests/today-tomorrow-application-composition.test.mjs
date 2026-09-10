import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTodayTomorrowApplication } from '../src/index.mjs';

const NOW = '2026-08-13T08:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function command(command_id, command_type, payload) {
  return { command_id, command_type, payload, created_at: NOW, risk_level: 'low', requires_confirmation: false, confirmation_state: 'not_required', source: 'local' };
}

function tempApplication() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-today-tomorrow-app-'));
  return { dataRoot, create: () => createTodayTomorrowApplication({ dataRoot, timezone: TIMEZONE, clock: () => NOW }) };
}

test('composition owns dependencies and returns Today/Tomorrow consumer DTOs', () => {
  const { dataRoot, create } = tempApplication();
  const app = create();
  try {
    assert.equal(app.start().state, 'started');
    assert.equal(app.start().already_started, true);
    assert.equal(app.execute(command('task-create', 'task.create', { task: { id: 'task_public', title: 'Public API task', due_at: '2026-08-15', time_state: 'date_only' } })).status, 'executed');
    app.assignTaskToDay('task_public', '2026-08-13', { actor: 'user' });
    const today = app.getToday('2026-08-13');
    const tomorrow = app.getTomorrow('2026-08-13');
    assert.equal(today.unplaced_tasks[0].id, 'task_public');
    assert.equal(tomorrow.date, '2026-08-14');
    assert.equal(tomorrow.carryover_suggestions[0].requires_confirmation, true);
    assert.equal(Object.isFrozen(today), true);
    assert.equal(/sqlite|repository|database|table_name/i.test(JSON.stringify({ today, tomorrow })), false);
  } finally {
    app.stop();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('manual time, conflict, reminder, deadline and carryover semantics remain owned by 08', () => {
  const { dataRoot, create } = tempApplication();
  const app = create();
  try {
    app.start();
    app.execute(command('task-create-safe', 'task.create', { task: { id: 'task_safe', title: 'Safe planning task', due_at: '2026-08-20', time_state: 'date_only' } }));
    app.execute(command('event-create-conflict', 'calendar.create', { event: { id: 'event_fixed', title: 'Fixed event', start_at: '2026-08-13T14:00:00+08:00', end_at: '2026-08-13T15:00:00+08:00', all_day: false } }));
    const plan = app.assignTaskToDay('task_safe', '2026-08-13', { actor: 'user' });
    assert.throws(() => app.confirmTaskTime(plan.id, { planned_start_at: '2026-08-13T16:00:00+08:00', planned_end_at: '2026-08-13T17:00:00+08:00', actor: 'ai' }), /user/);
    const warning = app.confirmTaskTime(plan.id, { planned_start_at: '2026-08-13T14:30:00+08:00', planned_end_at: '2026-08-13T15:30:00+08:00', actor: 'user' });
    assert.equal(warning.status, 'CONFLICT_WARNING');
    assert.equal(app.getReminders().length, 0);
    const confirmed = app.confirmTaskTime(plan.id, { planned_start_at: '2026-08-13T16:00:00+08:00', planned_end_at: '2026-08-13T17:00:00+08:00', actor: 'user' });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(app.getTask('task_safe').due_at, '2026-08-20');
    assert.equal(app.getReminders()[0].source_id, 'task_safe');
    assert.equal(app.getTomorrow('2026-08-13').unplaced_tasks.length, 0);
    assert.equal(app.getTomorrow('2026-08-13').carryover_suggestions.length, 1);
    app.confirmCarryover(plan.id, '2026-08-14', { actor: 'user' });
    assert.equal(app.getTomorrow('2026-08-13').confirmed_task_plans.length, 0);
    assert.equal(app.getTomorrow('2026-08-13').unplaced_tasks[0].id, 'task_safe');
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('lifecycle is repeatable and persisted 08-owned state survives stop/restart', () => {
  const { dataRoot, create } = tempApplication();
  let app = create();
  try {
    assert.throws(() => app.getToday('2026-08-13'), /not started/);
    app.init();
    app.execute(command('task-create-persist', 'task.create', { task: { id: 'task_persist', title: 'Persisted public task', due_at: '2026-08-18', time_state: 'date_only' } }));
    const plan = app.assignTaskToDay('task_persist', '2026-08-13', { actor: 'user' });
    app.confirmTaskTime(plan.id, { planned_start_at: '2026-08-13T18:00:00+08:00', planned_end_at: '2026-08-13T19:00:00+08:00', actor: 'user' });
    assert.equal(app.stop(), true);
    assert.equal(app.stop(), false);
    assert.equal(app.getStatus().state, 'stopped');
    assert.equal(app.start().state, 'started');
    assert.equal(app.getToday('2026-08-13').confirmed_task_plans[0].task_id, 'task_persist');
    assert.equal(app.getReminders()[0].source_id, 'task_persist');
    app.dispose();
    app = create();
    app.start();
    assert.equal(app.getTask('task_persist').title, 'Persisted public task');
    assert.equal(app.getToday('2026-08-13').confirmed_task_plans.length, 1);
  } finally {
    app.dispose();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('failed start cleans up and leaves lifecycle non-started', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'nexa-today-tomorrow-fail-'));
  mkdirSync(join(dataRoot, 'today-tomorrow-v0.1.sqlite'));
  const app = createTodayTomorrowApplication({ dataRoot, timezone: TIMEZONE, clock: () => NOW });
  try {
    assert.throws(() => app.start());
    assert.equal(app.getStatus().started, false);
    assert.equal(app.stop(), false);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
