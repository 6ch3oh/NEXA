'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const {
  TODAY_TOMORROW_PUBLIC_API_ENTRYPOINT,
  createNexaAppComposition
} = require('../../src/electron/nexaAppComposition');
const { applyNexaIpcRegistrationPlan } = require('../../src/electron/nexaIpcRegistration');

const NOW = '2026-08-13T08:00:00+08:00';
const TODAY = '2026-08-13';
const TOMORROW = '2026-08-14';

function command(commandId, commandType, payload) {
  return {
    command_id: commandId,
    command_type: commandType,
    payload,
    created_at: NOW,
    risk_level: 'low',
    requires_confirmation: false,
    confirmation_state: 'not_required',
    source: 'local'
  };
}

function ipcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); }
  };
}

async function composition(dataRoot) {
  return createNexaAppComposition({
    consumptionRepositoryPath: path.join(dataRoot, 'consumption.json'),
    todayTomorrowDataRoot: dataRoot,
    deviceCenterDataRoot: path.join(dataRoot, 'device-center'),
    timezone: 'Asia/Shanghai',
    clock: () => NOW,
    getDeviceSnapshot: () => null,
    getHubStats: () => null,
    now: () => Date.parse(NOW)
  });
}

test('Core Host consumes the real 08 API for conflict, reminder, carryover and persisted restart', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-core-today-tomorrow-'));
  const publicApi = await import(pathToFileURL(TODAY_TOMORROW_PUBLIC_API_ENTRYPOINT).href);
  const seed = publicApi.createTodayTomorrowApplication({
    dataRoot: tempRoot,
    timezone: 'Asia/Shanghai',
    clock: () => NOW
  });
  seed.start();
  seed.execute(command('core-host-task', 'task.create', {
    task: {
      id: 'core-host-task',
      title: 'Host integration task',
      due_at: '2026-08-20',
      time_state: 'date_only'
    }
  }));
  seed.execute(command('core-host-event', 'calendar.create', {
    event: {
      id: 'core-host-event',
      title: 'Fixed planning review',
      start_at: '2026-08-13T14:00:00+08:00',
      end_at: '2026-08-13T15:00:00+08:00',
      all_day: false
    }
  }));
  const seededPlan = seed.assignTaskToDay('core-host-task', TODAY, { actor: 'user' });
  seed.stop();

  let core = await composition(tempRoot);
  let electronIpc = ipcMain();
  let registration = await applyNexaIpcRegistrationPlan(core.registrationPlan, electronIpc);
  t.after(async () => {
    try { await registration?.dispose(); } catch (_) {}
    try { await core?.host.stopAll(); } catch (_) {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const getView = electronIpc.handlers.get('nexa:today-tomorrow:get-view');
  const getHomeSummary = electronIpc.handlers.get('nexa:today-tomorrow:get-home-summary');
  const getDateSummary = electronIpc.handlers.get('nexa:today-tomorrow:get-date-summary');
  const parseHomeInput = electronIpc.handlers.get('nexa:today-tomorrow:parse-home-input');
  const execute = electronIpc.handlers.get('nexa:today-tomorrow:execute');
  const initial = await getView({}, 'today', TODAY);
  assert.equal(initial.ok, true);
  assert.equal(initial.value.fixed_calendar_events[0].id, 'core-host-event');
  assert.equal(initial.value.unplaced_tasks[0].id, 'core-host-task');
  initial.value.unplaced_tasks[0].title = 'mutated by renderer';
  const isolatedInitial = await getView({}, 'today', TODAY);
  assert.equal(isolatedInitial.value.unplaced_tasks[0].title, 'Host integration task');
  const homeSummary = await getHomeSummary({}, TODAY);
  assert.equal(homeSummary.ok, true);
  assert.deepEqual(Object.keys(homeSummary.value), [
    'date', 'events', 'next_event', 'todo_count', 'timeline'
  ]);
  assert.equal(homeSummary.value.date, TODAY);
  assert.equal(homeSummary.value.events[0].id, 'core-host-event');
  assert.equal(homeSummary.value.next_event.id, 'core-host-event');
  assert.equal(homeSummary.value.todo_count, 1);
  assert.equal(homeSummary.value.timeline.some((entry) => entry.item.id === 'core-host-event'), true);
  const parsed = await parseHomeInput({}, '2026年8月13日下午2:30');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.time_state, 'exact');
  assert.equal(parsed.value.start_at, '2026-08-13T14:30:00');
  const unresolved = await parseHomeInput({}, '明天下午开会');
  assert.equal(unresolved.ok, true);
  assert.equal(unresolved.value.time_state, 'relative_unresolved');

  const createdFromHome = await execute({}, {
    type: 'create-day-task',
    commandId: 'home-direct-create-001',
    planDate: TODAY,
    title: '首页直接新增事项'
  });
  assert.equal(createdFromHome.ok, true);
  assert.equal(createdFromHome.value.status, 'created');
  assert.match(createdFromHome.value.task.id, /^home-task-[a-f0-9]{24}$/u);
  assert.equal(createdFromHome.value.task.title, '首页直接新增事项');
  assert.equal(createdFromHome.value.plan.plan_date, TODAY);
  const repeatedHomeCreate = await execute({}, {
    type: 'create-day-task',
    commandId: 'home-direct-create-001',
    planDate: TODAY,
    title: '首页直接新增事项'
  });
  assert.equal(repeatedHomeCreate.ok, true);
  assert.equal(repeatedHomeCreate.value.status, 'existing');
  assert.equal(repeatedHomeCreate.value.task.id, createdFromHome.value.task.id);
  assert.equal(repeatedHomeCreate.value.plan.id, createdFromHome.value.plan.id);
  const summaryAfterHomeCreate = await getDateSummary({}, TODAY);
  assert.equal(summaryAfterHomeCreate.ok, true, JSON.stringify(summaryAfterHomeCreate));
  assert.equal(summaryAfterHomeCreate.value.todo_count, 2);
  assert.equal(summaryAfterHomeCreate.value.tasks.some(
    (task) => task.id === createdFromHome.value.task.id
  ), true);
  const completedFromHome = await execute({}, {
    type: 'complete-task',
    taskId: createdFromHome.value.task.id,
    commandId: 'home-direct-complete-001'
  });
  assert.equal(completedFromHome.ok, true);
  assert.equal(completedFromHome.value.status, 'executed');
  const summaryAfterHomeComplete = await getDateSummary({}, TODAY);
  assert.equal(summaryAfterHomeComplete.value.todo_count, 1);
  assert.equal(summaryAfterHomeComplete.value.tasks.some(
    (task) => task.id === createdFromHome.value.task.id
  ), false);

  const warning = await execute({}, {
    type: 'confirm-time',
    planId: seededPlan.id,
    plannedStartAt: '2026-08-13T14:30:00+08:00',
    plannedEndAt: '2026-08-13T15:30:00+08:00'
  });
  assert.equal(warning.ok, true);
  assert.equal(warning.value.status, 'CONFLICT_WARNING');
  assert.equal(warning.value.conflicts.length, 1);
  assert.equal((await execute({}, { type: 'get-reminders' })).value.length, 0);

  const confirmed = await execute({}, {
    type: 'confirm-time',
    planId: seededPlan.id,
    plannedStartAt: '2026-08-13T16:00:00+08:00',
    plannedEndAt: '2026-08-13T17:00:00+08:00'
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.value.status, 'CONFIRMED');
  assert.equal((await execute({}, { type: 'get-reminders' })).value[0].source_id, 'core-host-task');
  const task = await execute({}, { type: 'get-task', taskId: 'core-host-task' });
  assert.equal(task.value.due_at, '2026-08-20');

  const beforeCarryover = await getView({}, 'tomorrow', TODAY);
  assert.equal(beforeCarryover.value.carryover_suggestions[0].requires_confirmation, true);
  assert.equal(beforeCarryover.value.unplaced_tasks.length, 0);
  const moved = await execute({}, {
    type: 'confirm-carryover',
    planId: seededPlan.id,
    toDate: TOMORROW
  });
  assert.equal(moved.ok, true);
  const afterCarryover = await getView({}, 'tomorrow', TODAY);
  assert.equal(afterCarryover.value.unplaced_tasks[0].id, 'core-host-task');

  await registration.dispose();
  registration = null;
  await core.host.stopAll();
  core = await composition(tempRoot);
  electronIpc = ipcMain();
  registration = await applyNexaIpcRegistrationPlan(core.registrationPlan, electronIpc);
  const reopened = await electronIpc.handlers.get('nexa:today-tomorrow:get-view')({}, 'tomorrow', TODAY);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.value.unplaced_tasks[0].id, 'core-host-task');
  const reopenedExecute = electronIpc.handlers.get('nexa:today-tomorrow:execute');
  const completed = await reopenedExecute({}, {
    type: 'complete-task',
    taskId: 'core-host-task',
    commandId: 'core-host-complete'
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.value.status, 'executed');
  const remindersAfterComplete = await reopenedExecute({}, { type: 'get-reminders' });
  assert.equal(remindersAfterComplete.value.every(
    (reminder) => !['scheduled', 'ready'].includes(reminder.state)
  ), true);
});
