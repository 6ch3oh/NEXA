import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeExpenseRecord } from '../src/domain/expenseRecord.mjs';
import { calculateExpenseStatistics } from '../src/statistics/expenseStatistics.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';

function canonical(input) {
  const result = normalizeExpenseRecord({ createdAt: FIXED_NOW, ...input });
  assert.equal(result.ok, true);
  return result.record;
}

const expenseFood = canonical({ id: 's-1', platform: 'wechat', occurredAt: '2026-08-01', amountCents: 1200, direction: 'expense', category: 'food', merchant: 'Alpha' });
const expenseTravel = canonical({ id: 's-2', platform: 'alipay', occurredAt: '2026-08-02', amountCents: 3000, direction: 'expense', category: 'travel', merchant: 'Beta' });
const incomeSalary = canonical({ id: 's-3', platform: 'bank', occurredAt: '2026-08-02', amountCents: -5000, direction: 'income', category: 'salary', merchant: 'Employer' });
const septemberExpense = canonical({ id: 's-4', platform: 'wechat', occurredAt: '2026-09-01', amountCents: 800, direction: 'expense', category: 'food', merchant: 'Alpha' });

test('empty dataset produces stable zero totals and empty aggregations', () => {
  assert.deepEqual(calculateExpenseStatistics([]), {
    totals: { count: 0, totalExpenseCents: 0, totalIncomeCents: 0, netCents: 0 },
    byCategory: [], byMerchant: [], byPlatform: [], daily: [], monthly: [],
  });
});

test('only expense records produce non-negative expense totals', () => {
  const result = calculateExpenseStatistics([expenseFood, expenseTravel]);
  assert.deepEqual(result.totals, { count: 2, totalExpenseCents: 4200, totalIncomeCents: 0, netCents: -4200 });
});

test('only income records use the absolute value as totalIncomeCents', () => {
  const result = calculateExpenseStatistics([incomeSalary]);
  assert.deepEqual(result.totals, { count: 1, totalExpenseCents: 0, totalIncomeCents: 5000, netCents: 5000 });
});

test('mixed totals define netCents as income minus expense', () => {
  const result = calculateExpenseStatistics([expenseFood, expenseTravel, incomeSalary]);
  assert.deepEqual(result.totals, { count: 3, totalExpenseCents: 4200, totalIncomeCents: 5000, netCents: 800 });
});

test('category aggregation uses stable keys and uncategorized for blank category', () => {
  const blank = { ...expenseFood, id: 's-blank', category: '', amountCents: 500 };
  const rows = calculateExpenseStatistics([expenseTravel, blank, expenseFood]).byCategory;
  assert.deepEqual(rows, [
    { key: 'food', count: 1, expenseCents: 1200, incomeCents: 0, netCents: -1200 },
    { key: 'travel', count: 1, expenseCents: 3000, incomeCents: 0, netCents: -3000 },
    { key: 'uncategorized', count: 1, expenseCents: 500, incomeCents: 0, netCents: -500 },
  ]);
});

test('merchant aggregation uses unknown for blank merchant', () => {
  const blank = { ...incomeSalary, id: 's-blank', merchant: '' };
  const rows = calculateExpenseStatistics([blank, expenseFood]).byMerchant;
  assert.deepEqual(rows, [
    { key: 'Alpha', count: 1, expenseCents: 1200, incomeCents: 0, netCents: -1200 },
    { key: 'unknown', count: 1, expenseCents: 0, incomeCents: 5000, netCents: 5000 },
  ]);
});

test('platform aggregation accumulates expense and income independently', () => {
  const bankExpense = { ...expenseFood, id: 's-bank-expense', platform: 'bank', amountCents: 700 };
  const rows = calculateExpenseStatistics([incomeSalary, bankExpense]).byPlatform;
  assert.deepEqual(rows, [
    { key: 'bank', count: 2, expenseCents: 700, incomeCents: 5000, netCents: 4300 },
  ]);
});

test('daily series uses YYYY-MM-DD periods and stable ascending order', () => {
  const rows = calculateExpenseStatistics([incomeSalary, expenseFood, expenseTravel]).daily;
  assert.deepEqual(rows, [
    { period: '2026-08-01', count: 1, expenseCents: 1200, incomeCents: 0, netCents: -1200 },
    { period: '2026-08-02', count: 2, expenseCents: 3000, incomeCents: 5000, netCents: 2000 },
  ]);
});

test('monthly series uses YYYY-MM periods without timezone conversion', () => {
  const rows = calculateExpenseStatistics([septemberExpense, incomeSalary, expenseFood]).monthly;
  assert.deepEqual(rows, [
    { period: '2026-08', count: 2, expenseCents: 1200, incomeCents: 5000, netCents: 3800 },
    { period: '2026-09', count: 1, expenseCents: 800, incomeCents: 0, netCents: -800 },
  ]);
});

test('group ordering and output are deterministic for repeated calculations', () => {
  const input = [septemberExpense, expenseTravel, incomeSalary, expenseFood];
  assert.deepEqual(calculateExpenseStatistics(input), calculateExpenseStatistics(input));
  assert.deepEqual(calculateExpenseStatistics(input).byCategory.map((row) => row.key), ['food', 'salary', 'travel']);
});

test('statistics reject non-arrays and non-canonical records with stable errors', () => {
  assert.throws(() => calculateExpenseStatistics({}), (error) => error?.code === 'INVALID_RECORDS');
  assert.throws(() => calculateExpenseStatistics([{ amountCents: 1 }]), (error) => error?.code === 'INVALID_RECORD');
  assert.throws(() => calculateExpenseStatistics([{ ...expenseFood, amountCents: 1.5 }]), (error) => error?.code === 'INVALID_RECORD');
});
