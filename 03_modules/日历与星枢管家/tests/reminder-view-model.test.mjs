import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createReminder } from '../src/domain/reminder.mjs';
import { createReminderViewModel } from '../src/view-models/reminder-view-model.mjs';
import { createButlerDashboardViewModel } from '../src/view-models/butler-dashboard-view-model.mjs';

const NOW = '2026-08-10T09:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function reminder(source_id, scheduled_at, state = 'scheduled') {
  return createReminder({
    title: `Reminder ${source_id}`, source_type: 'task', source_id, kind: 'due',
    scheduled_at, timezone: TIMEZONE, state,
  }, { now: NOW });
}

test('Reminder ViewModel exposes ready attention and exact display time', () => {
  const vm = createReminderViewModel(reminder('ready', '2026-08-10T00:30:00.000Z'), { now: NOW, timezone: TIMEZONE });
  assert.deepEqual(Object.keys(vm), [
    'id', 'title', 'display_time', 'kind', 'state', 'source_type', 'source_id', 'requires_attention',
  ]);
  assert.equal(vm.state, 'ready');
  assert.equal(vm.requires_attention, true);
  assert.equal(vm.display_time, '2026-08-10T00:30:00.000Z');
});

test('Reminder ViewModel distinguishes upcoming and cancelled without inventing time', () => {
  const upcoming = createReminderViewModel(reminder('future', '2026-08-11T01:00:00.000Z'), { now: NOW, timezone: TIMEZONE });
  const cancelled = createReminderViewModel(reminder('cancelled', '2026-08-11T01:00:00.000Z', 'cancelled'), { now: NOW, timezone: TIMEZONE });
  assert.equal(upcoming.state, 'scheduled');
  assert.equal(upcoming.requires_attention, false);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.requires_attention, false);
});

test('Dashboard reminder integration is input-only and summarizes ready/upcoming', () => {
  const dashboard = createButlerDashboardViewModel({
    tasks: [], events: [], commands: [],
    reminders: [
      reminder('ready', '2026-08-10T00:30:00.000Z'),
      reminder('future', '2026-08-11T01:00:00.000Z'),
      reminder('cancelled', '2026-08-11T02:00:00.000Z', 'cancelled'),
    ],
    now: NOW,
    timezone: TIMEZONE,
  });
  assert.equal(dashboard.reminders_ready.length, 1);
  assert.equal(dashboard.reminders_upcoming.length, 1);
  assert.equal(dashboard.reminders_ready[0].source_id, 'ready');
});

test('Reminder ViewModel and Dashboard require explicit temporal context', () => {
  const value = reminder('context', '2026-08-11T01:00:00.000Z');
  assert.throws(() => createReminderViewModel(value, { timezone: TIMEZONE }), /now/);
  assert.throws(() => createButlerDashboardViewModel({ reminders: [value], now: NOW }), /timezone/);
});
