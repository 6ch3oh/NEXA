'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NEXA_TODAY_TOMORROW_DESCRIPTOR,
  createNexaTodayTomorrowController,
  createNexaTodayTomorrowIpcHandlers
} = require('../../src/electron/nexaTodayTomorrowBridge');

function dateSummary(date = '2026-08-13', { embedded = false, sublabel = '暂无安排' } = {}) {
  const value = {
    date, todo_count: 0, event_count: 0, holiday_label: null, anniversary_label: null,
    sublabel, sublabel_kind: 'empty', sublabel_priority: 60,
    events: [], next_event: null, timeline: [],
    detail_handoff: { route_id: 'today-tomorrow', action: 'view-date', date },
    edit_handoff: { route_id: 'today-tomorrow', action: 'edit-date', date },
    availability: 'available'
  };
  return embedded ? value : {
    contract_version: '0.2.0', ...value,
    generated_at: '2026-08-13T08:00:00+08:00',
    freshness: {
      status: 'unknown', reason: 'source_timestamp_unavailable',
      generated_at: '2026-08-13T08:00:00+08:00'
    }
  };
}

function publicApi() {
  const calls = [];
  return {
    calls,
    TODAY_TOMORROW_PUBLIC_API_VERSION: '0.1.0',
    CALENDAR_HOME_WIDGET_CONTRACT_VERSION: '0.1.0',
    CALENDAR_HOME_SUMMARY_CONTRACT_VERSION: '0.2.0',
    CALENDAR_LOCAL_AI_CONTRACT_VERSION: '0.1.0',
    createCalendarLocalAiAdapter({ provider }) {
      calls.push(['create-local-ai', provider]);
      return Object.freeze({
        getState() {
          return { contract_version: '0.1.0', status: provider ? 'ready' : 'unconfigured', configured: Boolean(provider) };
        },
        async propose(input) { calls.push(['ai-propose', input]); return { proposal_id: 'proposal-1', status: 'draft' }; },
        async confirm(id, options) { calls.push(['ai-confirm', id, options]); return { proposal_id: id, status: 'confirmed' }; },
        cancel(id) { calls.push(['ai-cancel', id]); return { proposal_id: id, status: 'cancelled' }; },
        async undo(id, options) { calls.push(['ai-undo', id, options]); return { proposal_id: id, status: 'undone' }; }
      });
    },
    createCalendarHomeWidgetAdapter({ calendarApplication, timezone, clock }) {
      calls.push(['create-home-widget', timezone, clock]);
      return Object.freeze({
        getTodaySummary(input = {}) {
          calls.push(['home-summary', input]);
          const today = calendarApplication.getToday(input.date || '2026-08-13');
          return Object.freeze({
            date: today.date,
            events: Object.freeze([...today.fixed_calendar_events]),
            next_event: null,
            todo_count: today.unplaced_tasks.length,
            timeline: Object.freeze([])
          });
        },
        parseButlerInput(input) {
          calls.push(['parse-home-input', input]);
          return Object.freeze({
            time_state: 'exact', start_at: '2026-08-13T14:30:00', timezone
          });
        }
      });
    },
    createCalendarHomeSummaryAdapter({ calendarApplication, timezone, clock }) {
      calls.push(['create-home-summary', calendarApplication, timezone, clock]);
      return Object.freeze({
        getDateSummary(input = {}) {
          calls.push(['date-summary', input]);
          return dateSummary(input.date || '2026-08-13');
        },
        getMonthSummary(input) {
          calls.push(['month-summary', input]);
          const dates = [input.start_date, input.end_date].map((date) => dateSummary(date, { embedded: true }));
          return {
            contract_version: '0.2.0', range: { start_date: input.start_date, end_date: input.end_date },
            dates, today_summary: dateSummary('2026-08-13', { embedded: true }), next_event: null,
            availability: 'available', generated_at: '2026-08-13T08:00:00+08:00',
            freshness: { status: 'unknown', reason: 'source_timestamp_unavailable', generated_at: '2026-08-13T08:00:00+08:00' }
          };
        }
      });
    },
    createTodayTomorrowApplication(config) {
      calls.push(['create', config]);
      let started = false;
      return {
        start() { started = true; return { state: 'started', started: true }; },
        stop() { started = false; return true; },
        getStatus() { return { api_version: '0.1.0', state: started ? 'started' : 'stopped', started }; },
        getToday(date) { calls.push(['today', date]); return { date, fixed_calendar_events: [], unplaced_tasks: [] }; },
        getTomorrow(today) { calls.push(['tomorrow', today]); return { date: '2026-08-14', fixed_calendar_events: [], carryover_suggestions: [] }; },
        getTask(taskId) { return { id: taskId, title: 'Safe', due_at: '2026-08-20', credential: 'secret' }; },
        getReminders() { return []; },
        assignTaskToDay(taskId, date, options) { calls.push(['assign', taskId, date, options]); return { id: 'plan-1', task_id: taskId }; },
        confirmTaskTime(planId, options) { calls.push(['confirm', planId, options]); return { status: 'CONFLICT_WARNING', conflicts: [] }; },
        changeTaskTime(planId, options) { calls.push(['change', planId, options]); return { status: 'CONFIRMED', entry: { id: planId } }; },
        removeTaskTime(planId, options) { calls.push(['remove', planId, options]); return { id: planId }; },
        confirmCarryover(planId, date, options) { calls.push(['carry', planId, date, options]); return { entry: { id: 'next' } }; },
        rejectCarryover(planId, options) { calls.push(['reject', planId, options]); return { id: planId }; },
        execute(command) { calls.push(['execute', command]); return { status: 'executed' }; }
      };
    }
  };
}

test('descriptor owns additive Calendar V0.2 and Local AI channels', () => {
  assert.deepEqual(NEXA_TODAY_TOMORROW_DESCRIPTOR, {
    moduleId: 'today-tomorrow', contractVersion: 1,
    invokeChannels: [
      'nexa:today-tomorrow:get-home-summary',
      'nexa:today-tomorrow:get-date-summary',
      'nexa:today-tomorrow:get-month-summary',
      'nexa:today-tomorrow:get-view',
      'nexa:today-tomorrow:parse-home-input',
      'nexa:today-tomorrow:get-local-ai-state',
      'nexa:today-tomorrow:check-local-ai-health',
      'nexa:today-tomorrow:propose-local-ai',
      'nexa:today-tomorrow:confirm-local-ai',
      'nexa:today-tomorrow:cancel-local-ai',
      'nexa:today-tomorrow:undo-local-ai',
      'nexa:today-tomorrow:execute'
    ],
    pushChannels: []
  });
});

test('controller delegates lifecycle, reads, manual planning and migration to the 08 application', async () => {
  const api = publicApi();
  const controller = createNexaTodayTomorrowController({
    publicApi: api, dataRoot: 'E:\\safe', timezone: 'Asia/Shanghai',
    clock: () => '2026-08-13T08:00:00+08:00'
  });
  await controller.start();
  assert.equal(controller.getSnapshot().state, 'started');
  assert.deepEqual(controller.getHomeSummary({ date: '2026-08-13' }), {
    date: '2026-08-13', events: [], next_event: null, todo_count: 0, timeline: []
  });
  assert.equal(controller.getDateSummary({ date: '2026-08-13' }).contract_version, '0.2.0');
  assert.deepEqual(controller.getMonthSummary({
    start_date: '2026-08-10', end_date: '2026-08-16'
  }).range, { start_date: '2026-08-10', end_date: '2026-08-16' });
  assert.deepEqual(controller.parseHomeInput('2026年8月13日下午2:30'), {
    time_state: 'exact', start_at: '2026-08-13T14:30:00', timezone: 'Asia/Shanghai'
  });
  assert.equal(controller.getLocalAiState().status, 'unconfigured');
  assert.equal(api.calls.some((call) => call[0] === 'execute'), false,
    'Home summary and Butler preview never call Calendar execute');
  assert.equal((await controller.execute({ type: 'get-today', date: '2026-08-13' })).date, '2026-08-13');
  const task = await controller.execute({ type: 'get-task', taskId: 'task-1' });
  assert.equal(task.due_at, '2026-08-20');
  assert.equal(Object.hasOwn(task, 'credential'), false);
  await controller.execute({
    type: 'confirm-time', planId: 'plan-1',
    plannedStartAt: '2026-08-13T14:00:00+08:00',
    plannedEndAt: '2026-08-13T15:00:00+08:00'
  });
  assert.equal(api.calls.find((call) => call[0] === 'confirm')[2].actor, 'user');
  await controller.execute({ type: 'confirm-carryover', planId: 'plan-1', toDate: '2026-08-14' });
  assert.equal(api.calls.find((call) => call[0] === 'carry')[3].actor, 'user');
  await controller.execute({ type: 'complete-task', taskId: 'task-1', commandId: 'complete-task-1' });
  assert.equal(api.calls.find((call) => call[0] === 'execute')[1].source, 'local');
  const created = await controller.execute({
    type: 'create-day-task',
    commandId: 'home-create-1',
    planDate: '2026-08-13',
    title: '  整理   周报  '
  });
  assert.equal(created.status, 'created');
  assert.equal(created.task.title, 'Safe');
  const createCommand = api.calls.filter((call) => call[0] === 'execute').at(-1)[1];
  assert.equal(createCommand.command_type, 'task.create');
  assert.equal(createCommand.payload.task.title, '整理 周报');
  assert.equal(createCommand.payload.task.due_at, '2026-08-13');
  assert.match(createCommand.payload.task.id, /^home-task-[a-f0-9]{24}$/u);
  const createAssignment = api.calls.filter((call) => call[0] === 'assign').at(-1);
  assert.equal(createAssignment[2], '2026-08-13');
  assert.equal(createAssignment[3].actor, 'user');
  assert.match(createAssignment[3].command_id, /^home-assign-[a-f0-9]{24}$/u);
  await assert.rejects(
    controller.execute({
      type: 'confirm-time', planId: 'plan-1',
      plannedStartAt: '2026-08-13T14:00:00', plannedEndAt: '2026-08-13T15:00:00'
    }),
    (error) => error.code === 'INVALID_COMMAND'
  );
  await controller.stop();
  assert.equal(controller.getSnapshot().state, 'stopped');
});

test('IPC starts on demand, returns safe envelopes and rejects unknown views', async () => {
  const calls = [];
  const control = {
    async startModule(moduleId) { calls.push(['start', moduleId]); },
    async executeModule(moduleId, command) {
      calls.push(['execute', moduleId, command]);
      if (command.type === 'get-today') return { date: command.date };
      const error = new Error('raw private error'); error.code = 'CONFLICT_WARNING'; throw error;
    }
  };
  const homeWidgetReader = {
    getHomeSummary(input) {
      calls.push(['home-summary', input]);
      return { date: input.date, events: [], next_event: null, todo_count: 0, timeline: [] };
    },
    getDateSummary(input) {
      calls.push(['date-summary', input]);
      return dateSummary(input.date || '2026-08-13');
    },
    getMonthSummary(input) {
      calls.push(['month-summary', input]);
      return { range: input };
    },
    parseHomeInput(input) {
      calls.push(['parse-home-input', input]);
      if (input === 'bad') throw new Error('private parser detail');
      return { time_state: 'exact', start_at: '2026-08-13T14:30:00', timezone: 'Asia/Shanghai' };
    },
    getLocalAiState() { return { status: 'unconfigured', configured: false }; },
    checkLocalAiHealth() { return { ok: false, code: 'AI_CONFIGURATION_INCOMPLETE', networkRequestPerformed: false }; },
    proposeLocalAi(input) { calls.push(['ai-propose', input]); return { proposal_id: 'proposal-1', status: 'draft' }; },
    confirmLocalAi(id, options) { calls.push(['ai-confirm', id, options]); return { proposal_id: id, status: 'confirmed' }; },
    cancelLocalAi(id) { calls.push(['ai-cancel', id]); return { proposal_id: id, status: 'cancelled' }; },
    undoLocalAi(id, options) { calls.push(['ai-undo', id, options]); return { proposal_id: id, status: 'undone' }; }
  };
  const handlers = createNexaTodayTomorrowIpcHandlers(control, homeWidgetReader);
  assert.deepEqual(await handlers['nexa:today-tomorrow:get-home-summary']({}, '2026-08-13'), {
    ok: true,
    value: { date: '2026-08-13', events: [], next_event: null, todo_count: 0, timeline: [] }
  });
  assert.equal((await handlers['nexa:today-tomorrow:get-date-summary']({}, '2026-08-13')).value.contract_version, '0.2.0');
  assert.deepEqual(await handlers['nexa:today-tomorrow:get-month-summary']({}, '2026-08-10', '2026-08-16'), {
    ok: true, value: { range: { start_date: '2026-08-10', end_date: '2026-08-16' } }
  });
  assert.deepEqual(await handlers['nexa:today-tomorrow:parse-home-input']({}, '2026年8月13日下午2:30'), {
    ok: true,
    value: { time_state: 'exact', start_at: '2026-08-13T14:30:00', timezone: 'Asia/Shanghai' }
  });
  assert.deepEqual(await handlers['nexa:today-tomorrow:parse-home-input']({}, 'bad'), {
    ok: false, error: { code: 'TODAY_TOMORROW_REQUEST_FAILED', message: 'Today/Tomorrow request failed' }
  });
  assert.deepEqual(await handlers['nexa:today-tomorrow:get-local-ai-state']({}), {
    ok: true, value: { status: 'unconfigured', configured: false }
  });
  assert.deepEqual(await handlers['nexa:today-tomorrow:check-local-ai-health']({}), {
    ok: true, value: { ok: false, code: 'AI_CONFIGURATION_INCOMPLETE', networkRequestPerformed: false }
  });
  assert.deepEqual(await handlers['nexa:today-tomorrow:propose-local-ai']({}, { request: '安排会议' }), {
    ok: true, value: { proposal_id: 'proposal-1', status: 'draft' }
  });
  assert.deepEqual(await handlers['nexa:today-tomorrow:get-view']({}, 'today', '2026-08-13'), {
    ok: true, value: { date: '2026-08-13' }
  });
  assert.deepEqual(await handlers['nexa:today-tomorrow:get-view']({}, 'other', '2026-08-13'), {
    ok: false, error: { code: 'INVALID_VIEW', message: 'Today/Tomorrow request failed' }
  });
  assert.deepEqual(await handlers['nexa:today-tomorrow:execute']({}, { type: 'confirm-time' }), {
    ok: false, error: { code: 'CONFLICT_WARNING', message: 'Today/Tomorrow request failed' }
  });
  assert.equal(JSON.stringify(calls).includes('raw private error'), false);
  assert.equal(JSON.stringify(calls).includes('private parser detail'), false);
});
