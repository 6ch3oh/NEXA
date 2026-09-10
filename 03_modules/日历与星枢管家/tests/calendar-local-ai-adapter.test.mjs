import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CALENDAR_LOCAL_AI_CONTRACT_VERSION,
  createCalendarLocalAiAdapter,
} from '../src/index.mjs';

const NOW = '2026-09-02T01:00:00.000Z';

function createReady(overrides = {}) {
  const calls = [];
  const adapter = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai',
    clock: () => NOW,
    provider: {
      async generateProposal(input) {
        calls.push(input);
        return {
          summary: '明天 14:30 新建产品评审',
          operations: [{
            command_type: 'calendar.create',
            payload: {
              title: '产品评审',
              start_at: '2026-09-03T14:30:00+08:00',
              end_at: '2026-09-03T15:30:00+08:00',
              timezone: 'Asia/Shanghai',
            },
            change_summary: '新建 1 小时日程',
          }],
          conflicts: [],
          provider_metadata: { provider_id: 'local-provider', model_id: 'user-model', secret: 'must-not-pass' },
        };
      },
    },
    ...overrides,
  });
  return { adapter, calls };
}

test('unconfigured adapter makes zero provider calls and reports a human-blocked runtime', async () => {
  const adapter = createCalendarLocalAiAdapter({ timezone: 'Asia/Shanghai', clock: () => NOW });
  assert.deepEqual(adapter.getState(), {
    contract_version: CALENDAR_LOCAL_AI_CONTRACT_VERSION,
    status: 'unconfigured',
    configured: false,
    can_propose: false,
    can_write: false,
    runtime_connection: 'human_blocked',
    last_error_at: null,
  });
  await assert.rejects(adapter.propose({ request: '明天开会' }), { code: 'AI_UNCONFIGURED' });
});

test('proposal uses a minimal context, validates structured output, and redacts provider extras', async () => {
  const { adapter, calls } = createReady();
  const proposal = await adapter.propose({
    request: '明天下午 2:30 开产品评审',
    context: {
      date: '2026-09-03',
      events: [{ id: 'e1', title: '已有会议', start_at: '2026-09-03T16:00:00+08:00', private_note: 'secret' }],
      tasks: [],
      database_path: 'E:\\private\\calendar.db',
      token: 'secret-token',
    },
  });
  assert.equal(proposal.status, 'draft');
  assert.equal(proposal.operations[0].requires_confirmation, true);
  assert.equal(proposal.operations[0].requires_second_confirmation, false);
  assert.deepEqual(proposal.provider_metadata, {
    provider_id: 'local-provider', model_id: 'user-model',
  });
  assert.deepEqual(Object.keys(calls[0].context).sort(), ['current_date', 'current_time', 'date', 'events', 'tasks', 'timezone']);
  assert.equal(calls[0].context.current_date, '2026-09-02');
  assert.equal(calls[0].context.current_time, '09:00:00');
  assert.equal(calls[0].context.events[0].private_note, undefined);
  assert.doesNotMatch(JSON.stringify(calls[0]), /calendar\.db|secret-token/);
  assert.match(proposal.audit.input_sha256, /^[a-f0-9]{64}$/);
});

test('draft cannot write before explicit confirmation and confirmed changes can be explicitly undone', async () => {
  const executed = [];
  const undone = [];
  const { adapter } = createReady({
    commandExecutor: async (command) => {
      executed.push(command);
      return { command_id: command.command_id, undo_token: 'undo-1' };
    },
    undoExecutor: async (receipts) => undone.push(receipts),
  });
  const proposal = await adapter.propose({ request: '明天下午 2:30 开产品评审' });
  assert.equal(executed.length, 0);
  await assert.rejects(adapter.confirm(proposal.proposal_id), { code: 'CONFIRMATION_REQUIRED' });
  assert.equal(executed.length, 0);
  const confirmed = await adapter.confirm(proposal.proposal_id, { confirmed: true });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(executed.length, 1);
  assert.equal(executed[0].confirmation_state, 'confirmed');
  assert.equal(executed[0].source, 'calendar-local-ai-confirmed');
  await assert.rejects(adapter.undo(proposal.proposal_id), { code: 'CONFIRMATION_REQUIRED' });
  const result = await adapter.undo(proposal.proposal_id, { confirmed: true });
  assert.equal(result.status, 'undone');
  assert.equal(undone.length, 1);
});

test('delete and other high-risk operations require a second confirmation', async () => {
  let writes = 0;
  const adapter = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai',
    clock: () => NOW,
    provider: {
      async generateProposal() {
        return {
          summary: '删除日程',
          operations: [{ command_type: 'calendar.delete', payload: { id: 'event-1' } }],
        };
      },
    },
    commandExecutor: async () => { writes += 1; return { ok: true }; },
  });
  const proposal = await adapter.propose({ request: '删除日程', context: { events: [{ id: 'event-1', title: '待删除日程' }] } });
  assert.equal(proposal.operations[0].requires_second_confirmation, true);
  await assert.rejects(adapter.confirm(proposal.proposal_id, { confirmed: true }), { code: 'SECOND_CONFIRMATION_REQUIRED' });
  assert.equal(writes, 0);
  await adapter.confirm(proposal.proposal_id, { confirmed: true, highRiskConfirmed: true });
  assert.equal(writes, 1);
});

test('cancelled proposal never reaches the command executor', async () => {
  let writes = 0;
  const { adapter } = createReady({ commandExecutor: async () => { writes += 1; } });
  const proposal = await adapter.propose({ request: '建一个日程' });
  assert.equal(adapter.cancel(proposal.proposal_id).status, 'cancelled');
  await assert.rejects(adapter.confirm(proposal.proposal_id, { confirmed: true }), { code: 'PROPOSAL_NOT_DRAFT' });
  assert.equal(writes, 0);
});

test('provider deadline is reported as timeout while caller abort remains cancellation', async () => {
  const waitingProvider = {
    generateProposal(_input, { signal }) {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
      });
    },
  };
  const timed = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai',
    clock: () => NOW,
    timeoutMs: 100,
    provider: waitingProvider,
  });
  await assert.rejects(timed.propose({ request: '创建一个日程' }), { code: 'AI_TIMEOUT' });

  const controller = new AbortController();
  const cancelled = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai',
    clock: () => NOW,
    timeoutMs: 1_000,
    provider: waitingProvider,
  });
  const request = cancelled.propose({ request: '创建一个日程', signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { code: 'AI_CANCELLED' });
});

test('provider runtime readiness keeps an injected but unconfigured provider fail-closed', async () => {
  let calls = 0;
  const adapter = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai',
    provider: {
      getState() {
        return {
          status: 'unconfigured', configured: false, can_propose: false,
          configuration_readiness: 'unconfigured', health_status: 'not_available', last_health_at: null,
        };
      },
      async generateProposal() { calls += 1; return {}; },
    },
  });
  assert.deepEqual(adapter.getState(), {
    contract_version: CALENDAR_LOCAL_AI_CONTRACT_VERSION,
    status: 'unconfigured',
    configured: false,
    can_propose: false,
    can_write: false,
    runtime_connection: 'human_blocked',
    last_error_at: null,
    configuration_readiness: 'unconfigured',
    health_status: 'not_available',
    last_health_at: null,
  });
  await assert.rejects(adapter.propose({ request: '查询明天日历' }), { code: 'AI_UNCONFIGURED' });
  assert.equal(calls, 0);
});

test('proposal classifies create/update/delete/query, projects before-after diff, and executes only selected operations', async () => {
  const executed = [];
  const adapter = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai',
    clock: () => NOW,
    provider: {
      async generateProposal() {
        return {
          summary: '查询后新建评审',
          operations: [
            { operation_id: 'query', command_type: 'calendar.list', payload: {} },
            {
              operation_id: 'create', command_type: 'calendar.create',
              payload: { id: 'event-2', title: '评审', start_at: '2026-09-03T14:30:00+08:00', private_note: 'drop' },
              before: null,
            },
            { operation_id: 'delete', command_type: 'calendar.delete', payload: { id: 'event-old', title: '旧会议' } },
          ],
        };
      },
    },
    commandExecutor: async (command) => { executed.push(command); return { command_id: command.command_id }; },
  });
  const proposal = await adapter.propose({ request: '查询并整理日历', context: { events: [{ id: 'event-old', title: '旧会议' }] } });
  assert.deepEqual(proposal.operations.map((item) => item.category), ['query', 'create', 'delete']);
  assert.equal(proposal.operations[0].is_write, false);
  assert.equal(proposal.operations[0].requires_confirmation, false);
  assert.deepEqual(proposal.operations[1].after, {
    id: 'event-2', title: '评审', start_at: '2026-09-03T14:30:00+08:00',
  });
  assert.equal(proposal.operations[1].after.private_note, undefined);
  assert.deepEqual(proposal.operations[2].before, { id: 'event-old', title: '旧会议' });
  const result = await adapter.confirm(proposal.proposal_id, {
    confirmed: true,
    operationIds: ['query', 'create'],
  });
  assert.deepEqual(result.selected_operation_ids, ['query', 'create']);
  assert.equal(executed.length, 2);
  assert.equal(executed[0].command_type, 'calendar.list');
  assert.equal(executed[0].requires_confirmation, false);
  assert.equal(executed[1].command_type, 'calendar.create');
  assert.equal(executed.some((item) => item.command_type === 'calendar.delete'), false);
});

test('empty or unknown per-item selections are rejected before any calendar execution', async () => {
  let writes = 0;
  const { adapter } = createReady({ commandExecutor: async () => { writes += 1; } });
  const proposal = await adapter.propose({ request: '安排评审' });
  await assert.rejects(adapter.confirm(proposal.proposal_id, { confirmed: true, operationIds: [] }), { code: 'OPERATION_SELECTION_REQUIRED' });
  await assert.rejects(adapter.confirm(proposal.proposal_id, { confirmed: true, operationIds: ['unknown'] }), { code: 'INVALID_OPERATION_SELECTION' });
  assert.equal(writes, 0);
});

test('ambiguous request remains a clarification and cannot execute', async () => {
  const adapter = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai', clock: () => NOW,
    provider: { async generateProposal() { return { summary: '需要确认时间', operations: [], conflicts: [], clarification: '你指的是本周还是下周？' }; } },
    commandExecutor: async () => assert.fail('must not execute'),
  });
  const proposal = await adapter.propose({ request: '周五开会' });
  assert.equal(proposal.clarification, '你指的是本周还是下周？');
  await assert.rejects(adapter.confirm(proposal.proposal_id, { confirmed: true }), { code: 'CLARIFICATION_REQUIRED' });
});

test('update/delete may only target an event id present in supplied context', async () => {
  const adapter = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai', clock: () => NOW,
    provider: { async generateProposal() { return { summary: '修改', operations: [{ command_type: 'calendar.update', payload: { id: 'invented', title: 'x' } }] }; } },
  });
  await assert.rejects(adapter.propose({ request: '改一下', context: { events: [{ id: 'real', title: '真实事项' }] } }), { code: 'INVALID_AI_RESPONSE' });
});

test('provider recovery clears a stale adapter error without reopening the client', async () => {
  let providerState = {
    status: 'error', configured: true, can_propose: false,
    runtime_state: 'AI_SERVER_UNAVAILABLE', product_status: '暂不可用', diagnostic_code: 'SERVER_NOT_RUNNING',
  };
  const adapter = createCalendarLocalAiAdapter({
    timezone: 'Asia/Shanghai',
    clock: () => NOW,
    provider: {
      getState: () => providerState,
      async generateProposal() { throw Object.assign(new Error('offline'), { code: 'SERVER_NOT_RUNNING' }); },
    },
  });
  await assert.rejects(adapter.propose({ request: '查询明天日历' }), { code: 'AI_REQUEST_FAILED' });
  assert.equal(adapter.getState().status, 'error');
  assert.equal(adapter.getState().runtime_state, 'AI_SERVER_UNAVAILABLE');

  providerState = {
    status: 'ready', configured: true, can_propose: true,
    runtime_state: 'AI_READY', product_status: '就绪',
  };
  const recovered = adapter.getState();
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.last_error_at, null);
  assert.equal(recovered.runtime_state, 'AI_READY');
});
