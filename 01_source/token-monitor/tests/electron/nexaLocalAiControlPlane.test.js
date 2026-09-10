'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PARAMETER_PROPERTIES, normalizeLocalAiPlan } = require('../../src/shared/nexaGlobalCommandContract');
const { createNexaGlobalCommandRuntime } = require('../../src/electron/nexaGlobalCommandRuntime');

function args(patch = {}) { return { ...Object.fromEntries(Object.keys(PARAMETER_PROPERTIES).map((key) => [key, null])), ...patch }; }

test('bounded planner executes READ dependencies but stages WRITE until confirmation', async () => {
  const calls = []; const audit = [];
  const provider = {
    getState: () => ({ runtime_state: 'AI_READY' }),
    generateProposal: async () => { throw new Error('single route should not run'); },
    generatePlan: async () => ({
      intent: '查询消费后运行诊断',
      steps: [
        { capability: 'consumption.query', arguments: args({ start_date: '2026-09-01', end_date: '2026-09-30' }), depends_on: [] },
        { capability: 'automation.run', arguments: args({ automation_id: 'auto-1' }), depends_on: [0] },
      ],
      requires_confirmation: false, confirmation_summary: '运行本地诊断', clarification_question: null,
    }),
  };
  const runtime = createNexaGlobalCommandRuntime({
    provider,
    adapters: {
      consumption: { read: async () => { calls.push('read'); return { totals: { count: 3 } }; } },
      automation: { propose: async () => { calls.push('propose'); return { summary: '待确认' }; }, confirm: async () => { calls.push('confirm'); return { status: 'submitted' }; } },
    },
    auditLog: { record: async (value) => { audit.push(value); }, getState: () => ({ status: 'ready' }) },
    clock: () => '2026-09-06T19:00:00+08:00',
  });
  const staged = await runtime.submit({ request: '查询后运行诊断', origin_device: 'mobile', context: {} });
  assert.equal(staged.status, 'pending_confirmation');
  assert.equal(staged.outcome.type, 'plan_preview');
  assert.deepEqual(calls, ['read', 'propose']);
  assert.equal(staged.real_write_count, 0);
  assert.equal(audit[0].origin_device, 'mobile');
  assert.equal((await runtime.confirm(staged.proposal_id, { confirmed: true })).ok, true);
  assert.deepEqual(calls, ['read', 'propose', 'confirm']);
});

test('planner rejects forward dependencies', () => {
  assert.throws(() => normalizeLocalAiPlan({
    intent: 'bad', steps: [{ capability: 'device.summary', arguments: args(), depends_on: [1] }],
    requires_confirmation: false, confirmation_summary: '', clarification_question: null,
  }), { code: 'INVALID_LOCAL_AI_PLAN_DEPENDENCY' });
});

test('unavailable write capability stays a preview and cannot be executed', async () => {
  const runtime = createNexaGlobalCommandRuntime({
    provider: {
      getState: () => ({ runtime_state: 'AI_READY' }), generateProposal: async () => ({}),
      generatePlan: async () => ({ intent: '修改设置', steps: [{ capability: 'settings.update', arguments: args(), depends_on: [] }], requires_confirmation: true, confirmation_summary: '修改设置', clarification_question: null }),
    },
  });
  const staged = await runtime.submit({ request: '修改设置', context: {} });
  assert.equal(staged.outcome.steps[0].outcome.type, 'unavailable');
  const confirmed = await runtime.confirm(staged.proposal_id, { confirmed: true, highRiskConfirmed: true });
  assert.equal(confirmed.code, 'CAPABILITY_UNAVAILABLE');
});
