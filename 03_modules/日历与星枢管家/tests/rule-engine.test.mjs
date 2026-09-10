import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createTask } from '../src/domain/task.mjs';
import { createCalendarEvent } from '../src/domain/calendar-event.mjs';
import { createCommand } from '../src/commands/contract.mjs';
import {
  classifyTask,
  classifyCalendarEvent,
  evaluateScheduleRules,
  localDateForInstant,
  eventOverlapsDate,
} from '../src/rules/schedule-rules.mjs';
import { evaluateRules, createRuleEngine } from '../src/rules/rule-engine.mjs';

function loadFixture() {
  const raw = JSON.parse(readFileSync(new URL('../fixtures/rule-cases.json', import.meta.url), 'utf8'));
  return {
    now: raw.now,
    timezone: raw.timezone,
    tasks: raw.tasks.map((item) => createTask(item)),
    events: raw.events.map((item) => createCalendarEvent(item)),
    commands: raw.commands.map((item) => createCommand(item)),
  };
}

function byId(results, key, id) {
  return results.find((item) => item[key] === id);
}

test('rule engine covers task status, time, due, and dependency flags', () => {
  const input = loadFixture();
  const result = evaluateScheduleRules(input);
  assert.equal(byId(result.tasks, 'task_id', 'task_dependency').flags.completed, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_cancelled').flags.cancelled, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_overdue').flags.overdue, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_due_today').flags.due_today, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_due_today').flags.scheduled_today, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_upcoming').flags.upcoming, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_blocked').flags.blocked, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_unblocked').flags.blocked, false);
  assert.equal(byId(result.tasks, 'task_id', 'task_unblocked').flags.unscheduled, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_ambiguous').flags.ambiguous_time, true);
  assert.equal(byId(result.tasks, 'task_id', 'task_relative').flags.relative_unresolved, true);
});

test('ambiguous, relative, unscheduled, completed, and cancelled tasks never become overdue', () => {
  const input = loadFixture();
  const result = evaluateScheduleRules(input);
  for (const id of ['task_ambiguous', 'task_relative', 'task_blocked', 'task_dependency', 'task_cancelled']) {
    assert.equal(byId(result.tasks, 'task_id', id).flags.overdue, false, id);
  }
});

test('date_only semantics use the explicit timezone day boundary', () => {
  const task = createTask({ id: 'date_only', title: 'Local date', due_at: '2026-08-10', timezone: 'Asia/Shanghai' }, {
    now: '2026-08-01T00:00:00Z',
  });
  const shanghai = classifyTask(task, { now: '2026-08-09T16:30:00Z', timezone: 'Asia/Shanghai' });
  const utc = classifyTask(task, { now: '2026-08-09T16:30:00Z', timezone: 'Z' });
  assert.equal(shanghai.flags.due_today, true);
  assert.equal(shanghai.flags.overdue, false);
  assert.equal(utc.flags.due_today, false);
  assert.equal(classifyTask(task, { now: '2026-08-11T00:00:00+08:00', timezone: 'Asia/Shanghai' }).flags.overdue, true);
});

test('explicit timestamp conversion is stable across IANA and fixed-offset zones', () => {
  assert.equal(localDateForInstant('2026-08-09T16:30:00Z', 'Asia/Shanghai'), '2026-08-10');
  assert.equal(localDateForInstant('2026-08-09T16:30:00Z', '+08:00'), '2026-08-10');
  assert.equal(localDateForInstant('2026-08-09T16:30:00Z', 'Z'), '2026-08-09');
});

test('event rules classify happening-now, upcoming, ended, and all-day', () => {
  const input = loadFixture();
  const result = evaluateScheduleRules(input);
  assert.equal(byId(result.events, 'event_id', 'event_now').flags.happening_now, true);
  assert.equal(byId(result.events, 'event_id', 'event_upcoming').flags.upcoming, true);
  assert.equal(byId(result.events, 'event_id', 'event_ended').flags.ended, true);
  assert.equal(byId(result.events, 'event_id', 'event_all_day').flags.all_day, true);
  assert.equal(byId(result.events, 'event_id', 'event_all_day').flags.happening_now, true);
});

test('cross-day timed events use overlap semantics', () => {
  const event = createCalendarEvent({
    id: 'overnight', title: 'Overnight', start_at: '2026-08-10T23:00:00+08:00', end_at: '2026-08-11T01:00:00+08:00',
    timezone: 'Asia/Shanghai',
  }, { now: '2026-08-01T00:00:00Z' });
  assert.equal(eventOverlapsDate(event, '2026-08-10', 'Asia/Shanghai'), true);
  assert.equal(eventOverlapsDate(event, '2026-08-11', 'Asia/Shanghai'), true);
  assert.equal(eventOverlapsDate(event, '2026-08-12', 'Asia/Shanghai'), false);
});

test('RuleEngine returns suggestions and policy decisions without mutating input', () => {
  const input = loadFixture();
  const before = JSON.stringify(input);
  const result = createRuleEngine().evaluate(input);
  assert.equal(JSON.stringify(input), before);
  assert.ok(result.suggestions.some((item) => item.type === 'review_overdue_task'));
  assert.equal(result.command_decisions[0].decision, 'allow');
  assert.equal(result.command_decisions[1].decision, 'require_confirmation');
  assert.equal(Object.isFrozen(result), true);
});

test('rules require explicit now and timezone and reject invalid values', () => {
  const input = loadFixture();
  assert.throws(() => evaluateRules({ ...input, now: undefined }), /now/);
  assert.throws(() => evaluateRules({ ...input, timezone: undefined }), /timezone/);
  assert.throws(() => evaluateRules({ ...input, timezone: 'Mars/Olympus' }), /Invalid timezone/);
});

test('event classifier does not treat cancelled events as happening or upcoming', () => {
  const event = createCalendarEvent({
    id: 'cancelled', title: 'Cancelled', start_at: '2026-08-10T11:00:00+08:00', end_at: '2026-08-10T13:00:00+08:00',
    status: 'cancelled', timezone: 'Asia/Shanghai',
  }, { now: '2026-08-01T00:00:00Z' });
  const result = classifyCalendarEvent(event, { now: '2026-08-10T12:00:00+08:00', timezone: 'Asia/Shanghai' });
  assert.equal(result.flags.happening_now, false);
  assert.equal(result.flags.upcoming, false);
});
