'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONSUMPTION_HOME_WIDGET_CHANNEL,
  NexaConsumptionHomeWidgetBridgeError,
  createNexaConsumptionHomeWidgetIpcHandlers,
  projectSummary,
  projectWave004Summary
} = require('../../src/electron/nexaConsumptionHomeWidgetBridge');

function summary(overrides = {}) {
  return {
    period: { startDate: '2026-08-01', endDate: '2026-08-23' },
    totalExpenseCents: 123456,
    todayExpenseCents: 3680,
    recentTransactions: [{
      id: 'expense-1', occurredAt: '2026-08-23', amountCents: 1800, direction: 'expense',
      merchant: '咖啡店', category: 'food', platform: 'wechat', privatePath: 'E:\\private\\expense.json'
    }],
    topCategory: { key: 'food', count: 4, expenseCents: 42000, incomeCents: 0, netCents: -42000 },
    freshness: { asOfDate: '2026-08-23', latestOccurredAt: '2026-08-23', status: 'current' },
    ...overrides
  };
}

function wave004(overrides = {}) {
  const category = { category_id:'food',category_name:'餐饮',amount_cents:42000,currency:'CNY',percentage:100 };
  return {
    contract:'ConsumptionHomeSummary',contractVersion:'0.2',availability:{status:'available',reason:null},
    period:{startDate:'2026-08-01',endDate:'2026-08-23'},currency:'CNY',
    month_expense_cents:42000,today_expense_cents:1800,
    totals_by_currency:[{currency:'CNY',month_expense_cents:42000,today_expense_cents:1800}],
    category_distribution:[category],
    recent_transactions:[{occurred_at:'2026-08-23',title:'咖啡店',category_id:'food',category_name:'餐饮',
      amount_cents:1800,currency:'CNY',direction:'expense',platform:'wechat',privatePath:'E:\\private'}],
    top_category:category,
    freshness:{as_of_date:'2026-08-23',latest_occurred_at:'2026-08-23',status:'current',semantics:'latest_record_date'},
    source:{kind:'canonical_expense_repository',mode:'core_injected_read_only'},empty_state:null,
    generated_at:'2026-08-23T08:00:00.000Z',...overrides
  };
}

test('projects only the frozen Consumption Home Widget V0.1 fields', () => {
  const projected = projectSummary(summary());
  assert.equal(projected.totalExpenseCents, 123456);
  assert.equal(projected.todayExpenseCents, 3680);
  assert.equal(projected.topCategory.key, 'food');
  assert.equal(projected.recentTransactions[0].merchant, '咖啡店');
  assert.equal(Object.hasOwn(projected.recentTransactions[0], 'privatePath'), false);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.recentTransactions), true);
});

test('starts Consumption and returns a safe read-only summary envelope', async () => {
  const calls = [];
  const handlers = createNexaConsumptionHomeWidgetIpcHandlers({
    control: { async startModule(moduleId) { calls.push(['start', moduleId]); } },
    adapter: Object.freeze({ getSummary(options) { calls.push(['summary', options]); return { ok: true, value: summary() }; } })
  });
  assert.deepEqual(Object.keys(handlers), [CONSUMPTION_HOME_WIDGET_CHANNEL]);
  const result = await handlers[CONSUMPTION_HOME_WIDGET_CHANNEL]({});
  assert.equal(result.ok, true);
  assert.equal(result.value.freshness.status, 'current');
  assert.deepEqual(calls, [['start', 'consumption'], ['summary', { contractVersion: '0.1' }]]);
});

test('Consumption V0.2 keeps currency partitions and removes private transaction fields', async () => {
  const calls=[];
  const handlers=createNexaConsumptionHomeWidgetIpcHandlers({
    control:{async startModule(moduleId){calls.push(['start',moduleId]);}},
    adapter:Object.freeze({getSummary(options){calls.push(['summary',options]);return {ok:true,value:wave004()};}})
  });
  const result=await handlers[CONSUMPTION_HOME_WIDGET_CHANNEL]({}, {contractVersion:'0.2',recentLimit:5});
  assert.equal(result.ok,true);
  assert.equal(result.value.contractVersion,'0.2');
  assert.equal(result.value.category_distribution[0].percentage,100);
  assert.equal(Object.hasOwn(result.value.recent_transactions[0],'privatePath'),false);
  assert.deepEqual(calls,[['start','consumption'],['summary',{contractVersion:'0.2',recentLimit:5}]]);
  assert.equal(Object.isFrozen(projectWave004Summary(wave004())),true);
});

test('adapter and host failures remain a localized safe Widget error', async () => {
  const secret = 'E:\\private\\expense.sqlite';
  for (const adapter of [
    Object.freeze({ getSummary: () => ({ ok: false, error: { code: 'QUERY_FAILED', message: secret, stack: secret } }) }),
    Object.freeze({ getSummary: () => { throw Object.assign(new Error(secret), { stack: secret }); } })
  ]) {
    const handlers = createNexaConsumptionHomeWidgetIpcHandlers({
      control: { async startModule() {} },
      adapter
    });
    const result = await handlers[CONSUMPTION_HOME_WIDGET_CHANNEL]({});
    assert.equal(result.ok, false);
    assert.equal(result.error.message, '消费摘要暂不可用');
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(Object.hasOwn(result.error, 'stack'), false);
  }
});

test('fails closed when a second or expanded Widget adapter surface is supplied', () => {
  assert.throws(
    () => createNexaConsumptionHomeWidgetIpcHandlers({
      control: { startModule() {} },
      adapter: { getSummary() {}, createTransaction() {} }
    }),
    (error) => error instanceof NexaConsumptionHomeWidgetBridgeError && error.code === 'INVALID_WIDGET_ADAPTER'
  );
});
