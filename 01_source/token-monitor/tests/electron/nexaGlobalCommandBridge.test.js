'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GLOBAL_COMMAND_CHANNELS,
  createNexaGlobalCommandIpcHandlers,
  createProductionGlobalCommandAdapters,
} = require('../../src/electron/nexaGlobalCommandBridge');

function record(proposalPatch = {}) {
  return {
    request: 'fixture command',
    context: {
      CURRENT_DATETIME: '2026-09-05T09:30:00+08:00', TIMEZONE: 'Asia/Shanghai',
      SELECTED_DATE: '2026-09-10', SELECTED_OBJECT: '',
    },
    proposal: {
      domain: 'calendar', action: 'create',
      parameters: { date: '2026-09-10', automation_id: null, automation_name: null },
      ...proposalPatch,
    },
    adapterProposal: { proposal_id: 'calendar-proposal-1' },
  };
}

test('production adapters reuse Calendar and Consumption public module contracts', async () => {
  const calls = [];
  const composition = {
    control: {
      async startModule(moduleId) { calls.push(['start', moduleId]); },
      async executeModule(moduleId, command) {
        calls.push(['execute', moduleId, command]);
        return moduleId === 'automation-center' ? [] : { totals: { totalExpenseCents: 3600, count: 3 } };
      },
    },
    todayTomorrow: {
      async getDateSummary(input) { calls.push(['calendar-read', input]); return { date: input.date }; },
      async proposeLocalAi(input) { calls.push(['calendar-propose', input]); return { proposal_id: 'calendar-proposal-1' }; },
      async confirmLocalAi(id, options) { calls.push(['calendar-confirm', id, options]); return { status: 'confirmed' }; },
      async cancelLocalAi(id) { calls.push(['calendar-cancel', id]); return { status: 'cancelled' }; },
    },
  };
  const adapters = createProductionGlobalCommandAdapters({ composition });
  const calendarRecord = record();
  await adapters.calendar.propose(calendarRecord.proposal, calendarRecord);
  assert.deepEqual(calls.slice(0, 3).map((item) => item[0]), ['start', 'calendar-read', 'calendar-propose']);
  assert.equal(calls.some((item) => item[0] === 'calendar-confirm'), false);
  await adapters.calendar.confirm(calendarRecord.proposal, calendarRecord, { highRiskConfirmed: false });
  assert.equal(calls.find((item) => item[0] === 'calendar-confirm')[1], 'calendar-proposal-1');

  const consumptionRecord = record({ domain: 'consumption', action: 'query' });
  await adapters.consumption.read(consumptionRecord.proposal, consumptionRecord);
  assert.deepEqual(calls.find((item) => item[0] === 'execute' && item[1] === 'consumption')[2], {
    type: 'ai-query-filter', payload: { request: 'fixture command' },
  });
});

test('automation manual run resolves an existing named automation and uses its stable command', async () => {
  const calls = [];
  const adapters = createProductionGlobalCommandAdapters({
    composition: {
      control: {
        async startModule(moduleId) { calls.push(['start', moduleId]); },
        async executeModule(moduleId, command) {
          calls.push(['execute', moduleId, command]);
          if (command.operation === 'list-automations') return [{ automation_id: 'auto-1', name: '晨间简报' }];
          return { status: 'SUCCEEDED' };
        },
      },
      todayTomorrow: {},
    },
  });
  const proposal = { domain: 'automation', action: 'manual_run', parameters: { automation_id: null, automation_name: '晨间简报' } };
  await adapters.automation.confirm(proposal, record(proposal), {});
  assert.deepEqual(calls.at(-1), ['execute', 'automation-center', { operation: 'manual-run', arguments: ['auto-1'] }]);
});

test('confirmed local diagnostic creation uses only the credential-free ExecutionHub template and local zero-call route', async () => {
  const calls = [];
  const target = {
    target_id: 'local-diagnostic', execution_target: { target_id: 'local-diagnostic' },
    safety_policy_ref: { credential_mode: 'CREDENTIAL_FREE', authorization_mode: 'NOT_REQUIRED' },
  };
  const route = { profile_id: 'LOCAL_DIAGNOSTIC', provider: 'local', model: 'nexa-diagnostic-v1', max_ai_calls: 0 };
  const adapters = createProductionGlobalCommandAdapters({ composition: {
    control: {
      async startModule() {},
      async executeModule(moduleId, command) {
        calls.push([moduleId, command]);
        if (command.operation === 'capabilities') return { ok: true, data: { creation_targets: [target] } };
        if (command.operation === 'available-ai-routes') return { ok: true, data: { routes: [route, { profile_id: 'PRO', provider: 'deepseek', max_ai_calls: 1 }] } };
        return { ok: true, data: { automation_id: command.arguments[0].automation_id } };
      },
    }, todayTomorrow: {},
  } });
  const proposal = { domain: 'automation', action: 'create', parameters: { automation_name: '本地诊断', query: null } };
  await adapters.automation.confirm(proposal);
  const draft = calls.at(-1)[1].arguments[0];
  assert.equal(calls.at(-1)[1].operation, 'create-automation');
  assert.equal(draft.ai_route.provider, 'local');
  assert.equal(draft.ai_route.max_ai_calls, 0);
  assert.equal(draft.safety_policy_ref.credential_mode, 'CREDENTIAL_FREE');
  assert.equal(draft.enabled, false);
  assert.equal(draft.schedule_policy.kind, 'MANUAL');
});

test('consumption reclassification stays staged and confirms through the public Consumption command', async () => {
  const calls = [];
  const adapters = createProductionGlobalCommandAdapters({ composition: {
    control: { async startModule() {}, async executeModule(moduleId, command) { calls.push([moduleId, command]); return { changed: true }; } },
    todayTomorrow: {},
  } });
  const proposal = { domain: 'consumption', action: 'reclassify', parameters: { selected_object_id: 'expense-1', category: '餐饮' } };
  const preview = adapters.consumption.propose(proposal);
  assert.equal(preview.confirmation_required, true);
  assert.equal(calls.length, 0);
  await adapters.consumption.confirm(proposal);
  assert.deepEqual(calls.at(-1), ['consumption', { type: 'reclassify-record', payload: { recordId: 'expense-1', category: '餐饮' } }]);
});

test('learning plan confirmation uses the Study Center public plan command', async () => {
  const calls = [];
  const adapters = createProductionGlobalCommandAdapters({
    composition: {
      control: {
        async startModule(moduleId) { calls.push(['start', moduleId]); },
        async executeModule(moduleId, command) { calls.push(['execute', moduleId, command]); return { status: 'updated' }; },
      },
      todayTomorrow: {},
    },
  });
  const proposal = { domain: 'learning', action: 'create_plan', parameters: { count: 24, duration_minutes: 60 } };
  const preview = adapters.learning.propose(proposal);
  assert.equal(preview.confirmation_required, true);
  assert.equal(calls.length, 0);
  await adapters.learning.confirm(proposal);
  assert.deepEqual(calls.at(-1), ['execute', 'study-center', {
    operation: 'update-plan', plan: { dailyNewLimit: 10, dailyReviewLimit: 14, dailyTotalLimit: 24 },
  }]);
});

test('IPC surface is fixed, narrow, and delegates without dynamic channel names', async () => {
  const calls = [];
  const runtime = {
    getState: () => ({ status: 'ready' }), getCapabilities: () => [],
    submit: async (input) => { calls.push(['submit', input]); return { ok: true }; },
    confirm: async (id, options) => { calls.push(['confirm', id, options]); return { ok: true }; },
    cancel: async (id) => { calls.push(['cancel', id]); return { ok: true }; },
    reportFeedback: async (id, status) => { calls.push(['feedback', id, status]); return { ok: true }; },
    listModels: async () => { calls.push(['models']); return [{ id: 'fixture-model' }]; },
    selectModel: async (id) => { calls.push(['select-model', id]); return { model_id: id }; },
    listHistory: () => [], clearHistory: () => ({ ok: true }),
  };
  const handlers = createNexaGlobalCommandIpcHandlers(runtime);
  assert.deepEqual(Object.keys(handlers).sort(), Object.values(GLOBAL_COMMAND_CHANNELS).sort());
  await handlers[GLOBAL_COMMAND_CHANNELS.submit](null, { request: 'x' });
  await handlers[GLOBAL_COMMAND_CHANNELS.confirm](null, 'proposal-1', { confirmed: true });
  await handlers[GLOBAL_COMMAND_CHANNELS.cancel](null, 'proposal-1');
  await handlers[GLOBAL_COMMAND_CHANNELS.feedback](null, 'proposal-1', 'rendered');
  await handlers[GLOBAL_COMMAND_CHANNELS.models]();
  await handlers[GLOBAL_COMMAND_CHANNELS.selectModel](null, 'fixture-model');
  assert.deepEqual(calls.map((item) => item[0]), ['submit', 'confirm', 'cancel', 'feedback', 'models', 'select-model']);
});
