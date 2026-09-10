import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateExpenseStatistics,
  createConsumptionHomeWidgetAdapter,
  createExpenseDetailStatisticsService,
  createExpenseQueryService,
  createInMemoryExpenseRepository,
  createRecentTransactionsViewModel,
} from '../src/index.mjs';

const NOW = new Date('2026-09-02T08:00:00+08:00');

function expense(id, occurredAt, amountCents, currency, category, merchant, platform = 'manual') {
  return {
    id,
    sourceId: `private-${id}`,
    platform,
    occurredAt,
    amountCents,
    currency,
    direction: 'expense',
    category,
    merchant,
    createdAt: '2026-09-02T00:00:00.000Z',
    privatePath: `C:\\private\\${id}.json`,
  };
}

function make(records) {
  const repository = createInMemoryExpenseRepository(records);
  const query = createExpenseQueryService(repository);
  return {
    repository,
    query,
    widget: createConsumptionHomeWidgetAdapter(query, { now: () => NOW }),
  };
}

test('Wave004 exposes truthful single-currency month/today totals and the complete category distribution', () => {
  const { widget } = make([
    expense('a', '2026-09-02', 1200, 'CNY', 'food', '早餐店'),
    expense('b', '2026-09-01', 800, 'CNY', 'shopping', '文具店'),
    expense('c', '2026-09-01', 300, 'CNY', 'food', '便利店'),
  ]);
  const result = widget.getSummary({ contractVersion: '0.2', recentLimit: 5 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.availability, { status: 'available', reason: null });
  assert.equal(result.value.currency, 'CNY');
  assert.equal(result.value.month_expense_cents, 2300);
  assert.equal(result.value.today_expense_cents, 1200);
  assert.deepEqual(result.value.category_distribution, [
    { category_id: 'food', category_name: '餐饮', amount_cents: 1500, currency: 'CNY', percentage: 65.22 },
    { category_id: 'shopping', category_name: '购物', amount_cents: 800, currency: 'CNY', percentage: 34.78 },
  ]);
  assert.equal(result.value.generated_at, '2026-09-02T00:00:00.000Z');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value.category_distribution[0]), true);
});

test('Wave004 returns 5-8 newest-first safe recent rows without canonical identity fields', () => {
  const rows = Array.from({ length: 9 }, (_, index) => expense(
    `id-${String(index).padStart(2, '0')}`,
    index < 2 ? '2026-09-02' : '2026-09-01',
    100 + index,
    'CNY',
    'food',
    `商户 ${index}`,
    'wechat',
  ));
  const { widget } = make(rows);
  const result = widget.getSummary({ contractVersion: '0.2', recentLimit: 8 });
  assert.equal(result.value.recent_transactions.length, 8);
  assert.deepEqual(result.value.recent_transactions.slice(0, 2).map((row) => row.title), ['商户 0', '商户 1']);
  assert.deepEqual(Object.keys(result.value.recent_transactions[0]), [
    'occurred_at', 'title', 'category_id', 'category_name', 'amount_cents', 'currency', 'direction', 'platform',
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-id|sourceId|dedupeKey|privatePath|C:\\\\private/);
});

test('Wave004 enforces the compact 5-8 recent row contract', () => {
  const { widget } = make([]);
  for (const recentLimit of [4, 9]) {
    const result = widget.getSummary({ contractVersion: '0.2', recentLimit });
    assert.equal(result.ok, false);
    assert.deepEqual(result.availability, { status: 'unavailable', reason: 'INVALID_REQUEST' });
    assert.equal(result.error.code, 'INVALID_HOME_RECENT_LIMIT');
  }
});

test('Wave004 empty repository is no_data rather than an unavailable source or observed zero', () => {
  const { widget } = make([]);
  const result = widget.getSummary({ contractVersion: '0.2' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.availability, { status: 'no_data', reason: 'NO_RECORDS' });
  assert.equal(result.value.currency, null);
  assert.equal(result.value.month_expense_cents, null);
  assert.equal(result.value.today_expense_cents, null);
  assert.deepEqual(result.value.category_distribution, []);
  assert.deepEqual(result.value.recent_transactions, []);
  assert.equal(result.value.empty_state.code, 'NO_CONSUMPTION_RECORDS');
});

test('Wave004 never adds different currencies into one scalar total', () => {
  const { widget } = make([
    expense('cny', '2026-09-02', 100, 'CNY', 'food', '人民币记录'),
    expense('usd', '2026-09-02', 200, 'USD', 'travel', '美元记录'),
  ]);
  const result = widget.getSummary({ contractVersion: '0.2' });
  assert.deepEqual(result.value.availability, { status: 'partial', reason: 'MULTI_CURRENCY' });
  assert.equal(result.value.currency, null);
  assert.equal(result.value.month_expense_cents, null);
  assert.equal(result.value.today_expense_cents, null);
  assert.deepEqual(result.value.totals_by_currency, [
    { currency: 'CNY', month_expense_cents: 100, today_expense_cents: 100 },
    { currency: 'USD', month_expense_cents: 200, today_expense_cents: 200 },
  ]);
  assert.deepEqual(result.value.category_distribution.map((row) => [row.currency, row.amount_cents, row.percentage]), [
    ['USD', 200, 100],
    ['CNY', 100, 100],
  ]);
});

test('currency-aware statistics/service and recent projection are additive to V0.1 shapes', () => {
  const { query } = make([
    expense('cny', '2026-09-02', 100, 'CNY', 'food', 'A'),
    expense('usd', '2026-09-02', 200, 'USD', 'travel', 'B'),
  ]);
  const records = query.query({ sortOrder: 'asc' });
  const base = calculateExpenseStatistics(records);
  assert.equal(Object.hasOwn(base, 'byCurrency'), false);
  const currencyAware = calculateExpenseStatistics(records, { currencyAware: true });
  assert.deepEqual(currencyAware.byCurrency.map((row) => [row.currency, row.expenseCents]), [['CNY', 100], ['USD', 200]]);
  const detail = createExpenseDetailStatisticsService(query).getDetailStatistics({}, { currencyAware: true });
  assert.equal(detail.currencyCategoryBreakdown.length, 2);
  const [recent] = createRecentTransactionsViewModel(query).getRecentTransactions({ limit: 1, includeCurrency: true, includeId: false });
  assert.equal(recent.currency, 'CNY');
  assert.equal(Object.hasOwn(recent, 'id'), false);
});

test('Wave004 query failure is product-safe and never leaks exception text or paths', () => {
  const widget = createConsumptionHomeWidgetAdapter({
    query() { throw new Error('C:\\private\\ledger.json secret-token'); },
  }, { now: () => NOW });
  const result = widget.getSummary({ contractVersion: '0.2' });
  assert.deepEqual(result, {
    ok: false,
    availability: { status: 'unavailable', reason: 'QUERY_FAILED' },
    error: { code: 'CONSUMPTION_WIDGET_UNAVAILABLE', message: '消费摘要暂不可用' },
  });
  assert.doesNotMatch(JSON.stringify(result), /private|ledger|secret-token/);
});

test('Wave004 remains read-only and V0.1 default shape stays unchanged', () => {
  const { repository, widget } = make([expense('one', '2026-09-02', 100, 'CNY', 'food', 'A')]);
  const before = repository.list();
  const v1 = widget.getSummary();
  const v2 = widget.getSummary({ contractVersion: '0.2' });
  assert.equal(v1.ok, true);
  assert.equal(Object.hasOwn(v1.value, 'contractVersion'), false);
  assert.equal(v2.value.contractVersion, '0.2');
  assert.deepEqual(repository.list(), before);
  assert.deepEqual(Object.keys(widget), ['getSummary']);
});
