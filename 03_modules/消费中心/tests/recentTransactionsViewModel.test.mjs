import test from 'node:test';
import assert from 'node:assert/strict';

import { createExpenseQueryService } from '../src/queries/expenseQueryService.mjs';
import { createInMemoryExpenseRepository } from '../src/repositories/inMemoryExpenseRepository.mjs';
import {
  DEFAULT_RECENT_TRANSACTIONS_LIMIT,
  createRecentTransactionsViewModel,
} from '../src/viewmodels/recentTransactionsViewModel.mjs';

const RECORDS = [
  { id: 'vm-1', platform: 'wechat', occurredAt: '2026-08-01', amountCents: 100, direction: 'expense', category: 'food', merchant: 'Alpha', createdAt: '2026-08-10T00:00:00.000Z' },
  { id: 'vm-2', platform: 'bank', occurredAt: '2026-08-03', amountCents: -500, direction: 'income', category: 'salary', merchant: 'Employer', createdAt: '2026-08-10T00:00:00.000Z' },
  { id: 'vm-3', platform: 'alipay', occurredAt: '2026-08-02', amountCents: 200, direction: 'expense', category: 'travel', merchant: 'Beta', createdAt: '2026-08-10T00:00:00.000Z' },
];

test('view model requires only a Query Service contract', () => {
  assert.throws(() => createRecentTransactionsViewModel({}), (error) => error?.code === 'INVALID_QUERY_SERVICE');
  const calls = [];
  const fakeQueryService = { query(options) { calls.push(options); return []; } };
  const viewModel = createRecentTransactionsViewModel(fakeQueryService);
  assert.deepEqual(viewModel.getRecentTransactions(), []);
  assert.equal(calls[0].limit, DEFAULT_RECENT_TRANSACTIONS_LIMIT);
  assert.equal(calls[0].sortOrder, 'desc');
});

test('recent transactions are newest first and honor limit', () => {
  const queryService = createExpenseQueryService(createInMemoryExpenseRepository(RECORDS));
  const viewModel = createRecentTransactionsViewModel(queryService);
  assert.deepEqual(viewModel.getRecentTransactions({ limit: 2 }).map((row) => row.id), ['vm-2', 'vm-3']);
});

test('view model forwards canonical filters through Query Service', () => {
  const queryService = createExpenseQueryService(createInMemoryExpenseRepository(RECORDS));
  const viewModel = createRecentTransactionsViewModel(queryService);
  assert.deepEqual(viewModel.getRecentTransactions({ limit: 3, direction: 'expense' }).map((row) => row.id), ['vm-3', 'vm-1']);
});

test('DTO contains exactly the display-neutral canonical fields', () => {
  const queryService = createExpenseQueryService(createInMemoryExpenseRepository(RECORDS));
  const viewModel = createRecentTransactionsViewModel(queryService);
  const [row] = viewModel.getRecentTransactions({ limit: 1 });
  assert.deepEqual(Object.keys(row), ['id', 'occurredAt', 'amountCents', 'direction', 'merchant', 'category', 'platform']);
  assert.deepEqual(row, {
    id: 'vm-2', occurredAt: '2026-08-03', amountCents: -500, direction: 'income', merchant: 'Employer', category: 'salary', platform: 'bank',
  });
});

test('invalid limit is rejected by the Query Service with no duplicate validator', () => {
  const queryService = createExpenseQueryService(createInMemoryExpenseRepository(RECORDS));
  const viewModel = createRecentTransactionsViewModel(queryService);
  assert.throws(() => viewModel.getRecentTransactions({ limit: 0 }), (error) => error?.code === 'INVALID_LIMIT');
});
