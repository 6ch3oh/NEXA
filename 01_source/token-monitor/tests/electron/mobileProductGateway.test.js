'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createMobileProductGateway } = require('../../src/electron/mobileProductGateway');

function composition() {
  const calls = [];
  return { calls, control: { async startModule(id) { calls.push(['start', id]); }, async executeModule(id, command) { calls.push(['execute', id, command]); return [{ id: 'bill-1' }]; } }, todayTomorrow: {
    getMonthSummary(input) { calls.push(['month', input]); return { dates: [] }; }, getDateSummary(input) { return { date: input.date, events: [] }; },
    async proposeLocalAi() { return { proposal_id: 'p1', status: 'draft' }; }, async confirmLocalAi() { return { proposal_id: 'p1', status: 'confirmed' }; },
    cancelLocalAi() { return { proposal_id: 'p1', status: 'cancelled' }; }, getLocalAiState() { return { status: 'ready' }; }
  }, globalCommand: {
    async submit(input) { calls.push(['global-submit', input]); return { ok: true, proposal_id: 'g1', status: 'pending_confirmation' }; },
    async confirm(id) { calls.push(['global-confirm', id]); return { ok: true, status: 'confirmed' }; },
    async cancel(id) { calls.push(['global-cancel', id]); return { ok: true, status: 'cancelled' }; }
  } };
}

test('gateway serves calendar and bill data with revision and idempotent replay', async () => {
  const app = composition(); const gateway = createMobileProductGateway({ getComposition: () => app, clock: () => '2026-09-05T00:00:00Z' });
  const request = { operation: 'bills.query', client_request_id: 'c1', idempotency_key: 'i1', payload: { options: {} } };
  const first = await gateway.execute(request); const replay = await gateway.execute(request);
  assert.equal(first, replay); assert.equal(first.revision, 1); assert.equal(app.calls.filter((item) => item[0] === 'execute').length, 1);
});

test('mobile Command uses the existing Global Command runtime and notification status uses the shared archive', async () => {
  const app = composition();
  const store = { getState: () => ({ acked_notification_count: 17, pending_notification_classification_count: 2 }) };
  const gateway = createMobileProductGateway({ getComposition: () => app, getMobileSyncStore: () => store });
  const command = await gateway.execute({ operation: 'global-command.submit', client_request_id: 'c3', idempotency_key: 'i3', payload: { request: '打开设备与网络' } });
  const status = await gateway.execute({ operation: 'notifications.status', client_request_id: 'c4', idempotency_key: 'i4', payload: {} });
  assert.equal(command.value.proposal_id, 'g1');
  assert.deepEqual(app.calls.find((entry) => entry[0] === 'global-submit')[1], { request: '打开设备与网络', context: {}, origin_device: 'mobile' });
  assert.equal(status.value.acked_notification_count, 17);
});

test('mobile navigation is dispatched to Desktop once and idempotent replay does not dispatch again', async () => {
  const app = composition();
  app.globalCommand.submit = async (input) => {
    app.calls.push(['global-submit', input]);
    return {
      ok: true,
      proposal_id: 'g-navigation',
      status: 'completed',
      outcome: { type: 'navigation', route_id: 'cost' }
    };
  };
  const routes = [];
  const gateway = createMobileProductGateway({
    getComposition: () => app,
    onNavigation: async (routeId) => routes.push(routeId)
  });
  const request = {
    operation: 'global-command.submit',
    client_request_id: 'c-navigation',
    idempotency_key: 'i-navigation',
    payload: { request: '打开消费中心' }
  };

  const first = await gateway.execute(request);
  const replay = await gateway.execute(request);

  assert.equal(first, replay);
  assert.deepEqual(routes, ['cost']);
  assert.equal(app.calls.filter((entry) => entry[0] === 'global-submit').length, 1);
});

test('mobile non-navigation outcomes never dispatch a Desktop route', async () => {
  const app = composition();
  const routes = [];
  const gateway = createMobileProductGateway({
    getComposition: () => app,
    onNavigation: async (routeId) => routes.push(routeId)
  });

  await gateway.execute({
    operation: 'global-command.submit',
    client_request_id: 'c-proposal',
    idempotency_key: 'i-proposal',
    payload: { request: '记录一笔消费' }
  });

  assert.deepEqual(routes, []);
});

test('calendar AI command returns a proposal and never executes before confirmation', async () => {
  const app = composition(); const gateway = createMobileProductGateway({ getComposition: () => app });
  const result = await gateway.execute({ operation: 'calendar.propose', client_request_id: 'c2', idempotency_key: 'i2', payload: { request: '安排会议' } });
  assert.equal(result.value.status, 'draft'); assert.equal(app.calls.some((item) => item[0] === 'execute'), false);
});

test('mobile status projects authoritative Command Gateway provider readiness', async () => {
  const app = composition();
  app.todayTomorrow.getLocalAiState = () => ({ status: 'error', stale: true });
  app.globalCommand.getState = () => ({
    provider: { status: 'ready', runtime_state: 'AI_READY', product_status: '就绪', revision: 7 },
  });
  const gateway = createMobileProductGateway({ getComposition: () => app });
  const result = await gateway.execute({
    operation: 'status', client_request_id: 'status-ai', idempotency_key: 'status-ai-1', payload: {},
  });
  assert.equal(result.value.command_gateway, 'READY');
  assert.equal(result.value.ai.runtime_state, 'AI_READY');
  assert.equal(result.value.ai.revision, 7);
  assert.equal(result.value.ai.stale, undefined);
});
