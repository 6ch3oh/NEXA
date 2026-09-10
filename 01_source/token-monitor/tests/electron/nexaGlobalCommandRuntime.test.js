'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GLOBAL_COMMAND_SCHEMA } = require('../../src/shared/nexaGlobalCommandContract');
const { createNexaGlobalCommandRuntime, historyText } = require('../../src/electron/nexaGlobalCommandRuntime');

function parameters(overrides = {}) {
  const value = Object.fromEntries(Object.keys(GLOBAL_COMMAND_SCHEMA.properties.parameters.properties).map((key) => [key, null]));
  return { ...value, ...overrides };
}

function command(domain, action, parameterPatch = {}, extra = {}) {
  return {
    domain, action, intent: `${domain}.${action}`, parameters: parameters(parameterPatch), confidence: 0.95,
    requires_confirmation: false, clarification_question: null, ...extra,
  };
}

function fixtureRuntime(routes, adapterPatch = {}) {
  const calls = { generated: [], reads: [], proposed: [], confirmed: [], cancelled: [] };
  const provider = {
    getState: () => ({ status: 'ready', can_propose: true, model_id: 'qwen3-4b-instruct-2507' }),
    async generateProposal(input) {
      calls.generated.push(input);
      const response = routes[input.request];
      if (!response) throw Object.assign(new Error('missing fixture'), { code: 'FIXTURE_MISSING' });
      return response;
    },
  };
  const adapter = {
    async read(proposal) {
      calls.reads.push(proposal);
      return proposal.domain === 'consumption'
        ? { totals: { totalExpenseCents: 12800, count: 4 }, rows: [] }
        : { today_review_count: 25 };
    },
    async propose(proposal) { calls.proposed.push(proposal); return { summary: '待确认草稿', operations: [] }; },
    async confirm(proposal) { calls.confirmed.push(proposal); return { status: 'executed' }; },
    async cancel(proposal) { calls.cancelled.push(proposal); return { status: 'cancelled' }; },
    ...adapterPatch,
  };
  const runtime = createNexaGlobalCommandRuntime({
    provider,
    adapters: { calendar: adapter, consumption: adapter, learning: adapter, automation: adapter },
    clock: () => '2026-09-05T09:30:00+08:00',
  });
  return { runtime, calls };
}

test('A: calendar natural language becomes a write proposal with zero unconfirmed writes', async () => {
  const request = '9月10日下午3点开组会一个小时';
  const { runtime, calls } = fixtureRuntime({
    [request]: command('calendar', 'create', { date: '2026-09-10', start_at: '2026-09-10T15:00:00+08:00', duration_minutes: 60, title: '组会' }),
  });
  const result = await runtime.submit({ request, context: { CURRENT_MODULE: 'home' } });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'pending_confirmation');
  assert.equal(result.real_write_count, 0);
  assert.equal(result.proposal.parameters.duration_minutes, 60);
  assert.equal(calls.proposed.length, 1);
  assert.equal(calls.confirmed.length, 0);
});

test('B: consumption totals come from the deterministic adapter rather than the model', async () => {
  const request = '我这个月吃饭花了多少钱';
  const { runtime, calls } = fixtureRuntime({
    [request]: command('consumption', 'query', { category: '餐饮', start_date: '2026-09-01', end_date: '2026-09-30' }),
  });
  const result = await runtime.submit({ request, context: {} });
  assert.deepEqual(result.outcome.value.totals, { totalExpenseCents: 12800, count: 4 });
  assert.equal(calls.reads.length, 1);
  assert.equal(result.real_write_count, 0);
});

test('C/D: navigation and learning read commands execute directly', async () => {
  const routes = {
    '打开设备与网络': command('navigation', 'open', { route_id: 'device-center' }),
    '今天我要复习多少词': command('learning', 'today_review'),
  };
  const { runtime, calls } = fixtureRuntime(routes);
  const navigation = await runtime.submit({ request: '打开设备与网络', context: {} });
  assert.deepEqual(navigation.outcome, { type: 'navigation', route_id: 'device-center' });
  const learning = await runtime.submit({ request: '今天我要复习多少词', context: {} });
  assert.equal(learning.outcome.value.today_review_count, 25);
  assert.equal(calls.reads.length, 1);
});

test('E: automation manual run remains staged until explicit confirmation', async () => {
  const request = '运行我的本地诊断自动化';
  const { runtime, calls } = fixtureRuntime({
    [request]: command('automation', 'manual_run', { automation_name: '本地诊断' }),
  });
  const staged = await runtime.submit({ request, context: {} });
  assert.equal(staged.status, 'pending_confirmation');
  assert.equal(calls.confirmed.length, 0);
  assert.equal((await runtime.confirm(staged.proposal_id, {})).code, 'CONFIRMATION_REQUIRED');
  assert.equal(calls.confirmed.length, 0);
  const confirmed = await runtime.confirm(staged.proposal_id, { confirmed: true });
  assert.equal(confirmed.ok, true);
  assert.equal(calls.confirmed.length, 1);
});

test('F/G: explicit intent and explicit date override current-module and selected-date context', async () => {
  const request = '9月10日创建日历组会';
  const { runtime, calls } = fixtureRuntime({
    [request]: command('calendar', 'create', { date: '2026-09-10', title: '组会' }),
  });
  const result = await runtime.submit({
    request,
    context: { CURRENT_MODULE: 'consumption', SELECTED_DATE: '2026-09-05' },
  });
  assert.equal(result.proposal.domain, 'calendar');
  assert.equal(result.proposal.parameters.date, '2026-09-10');
  assert.equal(calls.generated[0].context.CURRENT_MODULE, 'consumption');
  assert.equal(calls.generated[0].context.SELECTED_DATE, '2026-09-05');
});

test('H: ambiguous time is clarification-only and never reaches a write adapter', async () => {
  const request = '晚上提醒我跑步';
  const { runtime, calls } = fixtureRuntime({
    [request]: command('clarify', 'ask', {}, { confidence: 0.4, clarification_question: '晚上几点提醒你跑步？' }),
  });
  const result = await runtime.submit({ request, context: {} });
  assert.equal(result.outcome.type, 'clarification');
  assert.match(result.outcome.question, /几点/);
  assert.equal(calls.proposed.length, 0);
  assert.equal(calls.confirmed.length, 0);
});

test('I: high-risk commands require two confirmations', async () => {
  const request = '删除日历事项';
  const { runtime, calls } = fixtureRuntime({
    [request]: command('calendar', 'delete', { selected_object_id: 'event-1' }),
  });
  const staged = await runtime.submit({ request, context: { SELECTED_OBJECT: 'event-1' } });
  assert.equal((await runtime.confirm(staged.proposal_id, { confirmed: true })).code, 'SECOND_CONFIRMATION_REQUIRED');
  assert.equal(calls.confirmed.length, 0);
  assert.equal((await runtime.confirm(staged.proposal_id, { confirmed: true, highRiskConfirmed: true })).ok, true);
  assert.equal(calls.confirmed.length, 1);
});

test('history is bounded, clearable, and redacts credential-like command text', async () => {
  assert.equal(historyText('token=private-value'), '[已隐藏敏感命令]');
  const routes = {};
  for (let index = 0; index < 4; index += 1) routes[`query-${index}`] = command('consumption', 'query');
  routes['token=private-value'] = command('consumption', 'query');
  const fixture = fixtureRuntime(routes);
  const runtime = createNexaGlobalCommandRuntime({
    provider: {
      getState: () => ({ status: 'ready' }),
      generateProposal: (input) => fixture.calls.generated.push(input) && routes[input.request],
    },
    adapters: { consumption: { read: async () => ({ totals: { totalExpenseCents: 0, count: 0 } }) } },
    historyLimit: 3,
    clock: () => '2026-09-05T09:30:00+08:00',
  });
  for (const request of Object.keys(routes)) await runtime.submit({ request, context: {} });
  const history = runtime.listHistory();
  assert.equal(history.length, 3);
  assert.equal(history[0].command_text, '[已隐藏敏感命令]');
  assert.deepEqual(runtime.clearHistory(), { ok: true, remaining: 0 });
  assert.equal(runtime.listHistory().length, 0);
});

test('deterministic navigation fast path bypasses unavailable local AI for every registered surface', async () => {
  let generated = 0;
  const runtime = createNexaGlobalCommandRuntime({
    provider: {
      getState: () => ({ status: 'error', runtime_state: 'AI_SERVER_UNAVAILABLE', can_propose: false }),
      async generateProposal() { generated += 1; throw Object.assign(new Error('offline'), { code: 'SERVER_NOT_RUNNING' }); },
    },
  });
  const commands = new Map([
    ['打开首页', 'home'], ['进入消费中心', 'cost'], ['打开日历管家', 'calendar'],
    ['去自动化中心', 'automation-center'], ['打开学习中心', 'study-center'],
    ['看看设备与网络', 'device-center'], ['打开股票市场', 'market'],
    ['打开自媒体运营', 'creator-ops'], ['打开Dashi任务板', 'dashi'],
    ['打开StarBench', 'starbench'], ['打开设置', 'settings'],
  ]);
  for (const [request, routeId] of commands) {
    const result = await runtime.submit({ request, context: {} });
    assert.equal(result.ok, true, request);
    assert.equal(result.resolution_source, 'DETERMINISTIC_FAST_PATH', request);
    assert.deepEqual(result.outcome, { type: 'navigation', route_id: routeId }, request);
    assert.equal(result.real_write_count, 0, request);
  }
  assert.equal(generated, 0);
});

test('AI unavailable complex command returns product error, retains text, and performs zero writes', async () => {
  let generated = 0;
  const runtime = createNexaGlobalCommandRuntime({
    provider: {
      getState: () => ({ status: 'error', runtime_state: 'AI_SERVER_UNAVAILABLE', can_propose: false }),
      async generateProposal() { generated += 1; throw Object.assign(new Error('offline'), { code: 'SERVER_NOT_RUNNING' }); },
    },
  });
  const request = '分析我这个月为什么花费增加';
  const result = await runtime.submit({ request, context: {} });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LOCAL_AI_UNAVAILABLE');
  assert.equal(result.reason_code, 'SERVER_NOT_RUNNING');
  assert.equal(result.message, '本地 AI 暂不可用，请稍后重试。');
  assert.equal(result.retained_request, request);
  assert.equal(result.real_write_count, 0);
  assert.equal(generated, 1);
});

test('write requests never enter deterministic fast path', async () => {
  let generated = 0;
  const runtime = createNexaGlobalCommandRuntime({
    provider: {
      getState: () => ({ status: 'error', can_propose: false }),
      async generateProposal() { generated += 1; throw Object.assign(new Error('offline'), { code: 'SERVER_NOT_RUNNING' }); },
    },
  });
  const result = await runtime.submit({ request: '删除日历事项', context: {} });
  assert.equal(result.code, 'LOCAL_AI_UNAVAILABLE');
  assert.equal(result.real_write_count, 0);
  assert.equal(generated, 1);
});

test('AI failure returns a correlated stage timeline and a Chinese safe diagnostic', async () => {
  const audits = [];
  let tick = 0;
  const runtime = createNexaGlobalCommandRuntime({
    provider: {
      getState: () => ({ status: 'error', can_propose: false, model_id: 'qwen3-4b-instruct-2507' }),
      async generateProposal() { throw Object.assign(new Error('private provider response'), { code: 'SERVER_NOT_RUNNING' }); },
    },
    auditLog: {
      async record(value) { audits.push(value); },
      getState: () => ({ status: 'ready' }),
    },
    clock: () => '2026-09-07T10:00:00+08:00',
    monotonicClock: () => { tick += 5; return tick; },
  });
  const result = await runtime.submit({ request: '分析本月消费变化', context: {} });
  assert.equal(result.code, 'LOCAL_AI_UNAVAILABLE');
  assert.equal(result.failed_stage, '本地服务请求');
  assert.equal(result.business_write_state, 'NONE');
  assert.equal(result.diagnostic.error_category, 'SERVICE_UNREACHABLE');
  assert.equal(result.diagnostic.model_id, 'qwen3-4b-instruct-2507');
  assert.equal(result.diagnostic.prompt_text_persisted, false);
  assert.ok(result.diagnostic.stages.some((stage) => stage.name === 'LOCAL_AI_REQUEST' && stage.status === 'FAIL'));
  assert.equal(audits[0].command_id, result.diagnostic_id);
  assert.deepEqual(audits[0].diagnostic, result.diagnostic);
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /分析本月消费变化|private provider response/u);
});

test('a confirmation transport failure reports unknown write state instead of claiming zero writes', async () => {
  const request = '创建一个日历事项';
  const runtime = createNexaGlobalCommandRuntime({
    provider: {
      getState: () => ({ status: 'ready', can_propose: true, model_id: 'qwen3-4b-instruct-2507' }),
      async generateProposal() { return command('calendar', 'create', { date: '2026-09-08', title: '复盘' }); },
    },
    adapters: {
      calendar: {
        async propose() { return { proposal_id: 'calendar-proposal-1' }; },
        async confirm() { throw Object.assign(new Error('response lost after commit boundary'), { code: 'PERSISTENCE_FAILED' }); },
      },
    },
  });
  const staged = await runtime.submit({ request, context: {} });
  const result = await runtime.confirm(staged.proposal_id, { confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(result.real_write_count, null);
  assert.equal(result.business_write_state, 'UNKNOWN');
  assert.match(result.message, /执行结果待确认/u);
  assert.deepEqual(result.diagnostic.evidence_gaps, ['adapter_commit_boundary_not_observable_after_error']);
});

test('renderer feedback appends to the same correlation id', async () => {
  const audits = [];
  const runtime = createNexaGlobalCommandRuntime({
    provider: { getState: () => ({ status: 'ready' }), async generateProposal() { throw new Error('must not generate'); } },
    auditLog: { async record(value) { audits.push(value); }, getState: () => ({ status: 'ready' }) },
  });
  const result = await runtime.submit({ request: '打开消费中心', context: {} });
  const feedback = await runtime.reportFeedback(result.diagnostic_id, 'rendered');
  assert.equal(feedback.ok, true);
  assert.equal(audits.at(-1).command_id, result.diagnostic_id);
  assert.equal(audits.at(-1).diagnostic.stages.at(-1).name, 'UI_FEEDBACK');
  assert.equal(audits.at(-1).diagnostic.stages.at(-1).status, 'PASS');
});
