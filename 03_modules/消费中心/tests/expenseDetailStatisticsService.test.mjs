import test from 'node:test';
import assert from 'node:assert/strict';

import { createExpenseQueryService } from '../src/queries/expenseQueryService.mjs';
import { createInMemoryExpenseRepository } from '../src/repositories/inMemoryExpenseRepository.mjs';
import { calculateExpenseStatistics } from '../src/statistics/expenseStatistics.mjs';
import { createExpenseDetailStatisticsService } from '../src/services/expenseDetailStatisticsService.mjs';

const RECORDS = [
  { id: 'detail-1', platform: 'wechat', occurredAt: '2026-08-01', amountCents: 1000, direction: 'expense', category: 'food', merchant: 'Alpha', createdAt: '2026-08-10T00:00:00.000Z' },
  { id: 'detail-2', platform: 'alipay', occurredAt: '2026-08-02', amountCents: 2000, direction: 'expense', category: 'travel', merchant: 'Beta', createdAt: '2026-08-10T00:00:00.000Z' },
  { id: 'detail-3', platform: 'bank', occurredAt: '2026-08-02', amountCents: -5000, direction: 'income', category: 'salary', merchant: 'Employer', createdAt: '2026-08-10T00:00:00.000Z' },
  { id: 'detail-4', platform: 'wechat', occurredAt: '2026-09-01', amountCents: 4000, direction: 'expense', category: 'food', merchant: 'Alpha', createdAt: '2026-08-10T00:00:00.000Z' },
];

function makeService() {
  const query = createExpenseQueryService(createInMemoryExpenseRepository(RECORDS));
  return createExpenseDetailStatisticsService(query);
}

test('detail service requires Query Service and Statistics contracts', () => {
  assert.throws(() => createExpenseDetailStatisticsService({}), (error) => error?.code === 'INVALID_QUERY_SERVICE');
  assert.throws(() => createExpenseDetailStatisticsService({ query() { return []; } }, null), (error) => error?.code === 'INVALID_STATISTICS_SERVICE');
});

test('detail service composes injected Query and Statistics instead of duplicating algorithms', () => {
  const calls = [];
  const records = [{ marker: 'canonical snapshot' }];
  const expected = { totals: { count: 1 }, byCategory: ['c'], byMerchant: ['m'], byPlatform: ['p'], daily: ['d'], monthly: ['mo'] };
  const queryService = { query(options) { calls.push(['query', options]); return records; } };
  const calculator = (input) => { calls.push(['statistics', input]); return expected; };
  const service = createExpenseDetailStatisticsService(queryService, calculator);
  const result = service.getDetailStatistics({ startDate: '2026-08-01', category: 'food' });
  assert.deepEqual(calls, [
    ['query', { startDate: '2026-08-01', category: 'food', sortOrder: 'asc', offset: 0 }],
    ['statistics', records],
  ]);
  assert.deepEqual(result.totals, expected.totals);
  assert.deepEqual(result.categoryBreakdown, expected.byCategory);
});

test('period filtering produces totals only for the closed requested range', () => {
  const result = makeService().getDetailStatistics({ startDate: '2026-08-01', endDate: '2026-08-02' });
  assert.deepEqual(result.totals, { count: 3, totalExpenseCents: 3000, totalIncomeCents: 5000, netCents: 2000 });
  assert.deepEqual(result.filters, { startDate: '2026-08-01', endDate: '2026-08-02' });
});

test('detail DTO exposes breakdowns and time series from Expense Statistics', () => {
  const result = makeService().getDetailStatistics({ platform: 'wechat' });
  const directRecords = createExpenseQueryService(createInMemoryExpenseRepository(RECORDS)).query({ platform: 'wechat', sortOrder: 'asc' });
  const direct = calculateExpenseStatistics(directRecords);
  assert.deepEqual(result, {
    filters: { platform: 'wechat' },
    totals: direct.totals,
    categoryBreakdown: direct.byCategory,
    merchantBreakdown: direct.byMerchant,
    platformBreakdown: direct.byPlatform,
    dailySeries: direct.daily,
    monthlySeries: direct.monthly,
  });
});

test('empty filtered result returns zero totals and empty breakdowns/series', () => {
  const result = makeService().getDetailStatistics({ category: 'does-not-exist' });
  assert.deepEqual(result.totals, { count: 0, totalExpenseCents: 0, totalIncomeCents: 0, netCents: 0 });
  assert.deepEqual(result.categoryBreakdown, []);
  assert.deepEqual(result.dailySeries, []);
  assert.deepEqual(result.monthlySeries, []);
});

test('detail service rejects pagination and unknown options to preserve full statistics', () => {
  const service = makeService();
  assert.throws(() => service.getDetailStatistics({ limit: 1 }), (error) => error?.code === 'INVALID_FILTERS');
  assert.throws(() => service.getDetailStatistics(null), (error) => error?.code === 'INVALID_FILTERS');
});
