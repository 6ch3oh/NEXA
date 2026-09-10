import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createExpenseQueryService } from '../src/queries/expenseQueryService.mjs';
import { createInMemoryExpenseRepository } from '../src/repositories/inMemoryExpenseRepository.mjs';
import { createJsonFileExpenseRepository } from '../src/repositories/jsonFileExpenseRepository.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

const DATASET = Object.freeze([
  { id: 'id-04', platform: 'wechat', occurredAt: '2026-08-03', amountCents: 3000, direction: 'expense', category: 'travel', merchant: 'Alpha', createdAt: FIXED_NOW },
  { id: 'id-02', platform: 'alipay', occurredAt: '2026-08-02', amountCents: 2000, direction: 'expense', category: 'food', merchant: 'Beta', createdAt: FIXED_NOW },
  { id: 'id-03', platform: 'bank', occurredAt: '2026-08-02', amountCents: -5000, direction: 'income', category: 'salary', merchant: 'Employer', createdAt: FIXED_NOW },
  { id: 'id-01', platform: 'wechat', occurredAt: '2026-08-01', amountCents: 1000, direction: 'expense', category: 'food', merchant: 'Alpha', createdAt: FIXED_NOW },
  { id: 'id-05', platform: 'wechat', occurredAt: '2026-09-01', amountCents: 4000, direction: 'expense', category: 'other', merchant: 'Gamma', createdAt: FIXED_NOW },
]);

function makeMemoryService(inputs = DATASET) {
  const repository = createInMemoryExpenseRepository(inputs);
  return { repository, service: createExpenseQueryService(repository) };
}

function ids(records) {
  return records.map((record) => record.id);
}

function makeTempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-query-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('T01 empty repository returns an empty array', () => {
  const { service } = makeMemoryService([]);
  assert.deepEqual(service.query(), []);
});

test('T02 date range is closed and excludes records outside both boundaries', () => {
  const { service } = makeMemoryService();
  assert.deepEqual(ids(service.query({ startDate: '2026-08-01', endDate: '2026-08-02', sortOrder: 'asc' })), ['id-01', 'id-02', 'id-03']);
  assert.deepEqual(ids(service.query({ startDate: '2026-08-03' })), ['id-05', 'id-04']);
  assert.deepEqual(ids(service.query({ endDate: '2026-08-01' })), ['id-01']);
});

test('T03 category uses exact canonical matching', () => {
  const { service } = makeMemoryService();
  assert.deepEqual(ids(service.query({ category: 'food', sortOrder: 'asc' })), ['id-01', 'id-02']);
  assert.deepEqual(service.query({ category: 'Food' }), []);
});

test('T04 merchant uses exact matching without fuzzy search', () => {
  const { service } = makeMemoryService();
  assert.deepEqual(ids(service.query({ merchant: 'Alpha', sortOrder: 'asc' })), ['id-01', 'id-04']);
  assert.deepEqual(service.query({ merchant: 'Al' }), []);
});

test('T05 platform uses exact canonical matching', () => {
  const { service } = makeMemoryService();
  assert.deepEqual(ids(service.query({ platform: 'wechat', sortOrder: 'asc' })), ['id-01', 'id-04', 'id-05']);
});

test('T06 direction matches canonical direction instead of deriving it from amount', () => {
  const { service } = makeMemoryService();
  assert.deepEqual(ids(service.query({ direction: 'income' })), ['id-03']);
  assert.deepEqual(ids(service.query({ direction: 'expense', sortOrder: 'asc' })), ['id-01', 'id-02', 'id-04', 'id-05']);
});

test('T07 multiple filters combine with AND in two scenarios', () => {
  const { service } = makeMemoryService();
  assert.deepEqual(ids(service.query({ category: 'food', platform: 'wechat' })), ['id-01']);
  assert.deepEqual(ids(service.query({ merchant: 'Alpha', direction: 'expense', startDate: '2026-08-02' })), ['id-04']);
});

test('T08 asc and desc sort by occurredAt', () => {
  const { service } = makeMemoryService();
  assert.deepEqual(ids(service.query({ sortOrder: 'asc' })), ['id-01', 'id-02', 'id-03', 'id-04', 'id-05']);
  assert.deepEqual(ids(service.query({ sortOrder: 'desc' })), ['id-05', 'id-04', 'id-02', 'id-03', 'id-01']);
});

test('T09 same-date records use canonical id as deterministic secondary order', () => {
  const { service } = makeMemoryService();
  const first = ids(service.query({ startDate: '2026-08-02', endDate: '2026-08-02', sortOrder: 'desc' }));
  const second = ids(service.query({ startDate: '2026-08-02', endDate: '2026-08-02', sortOrder: 'desc' }));
  assert.deepEqual(first, ['id-02', 'id-03']);
  assert.deepEqual(second, first);
});

test('T10 pagination applies after filtering and sorting', () => {
  const { service } = makeMemoryService();
  assert.deepEqual(ids(service.query({ sortOrder: 'asc', offset: 1, limit: 2 })), ['id-02', 'id-03']);
  assert.deepEqual(ids(service.query({ category: 'food', sortOrder: 'asc', offset: 1, limit: 1 })), ['id-02']);
  assert.deepEqual(service.query({ offset: 99, limit: 2 }), []);
});

test('T11 invalid dates and inverted ranges fail with stable codes', () => {
  const { service } = makeMemoryService();
  for (const value of ['2026-2-01', '2026-02-30', 'not-a-date', new Date()]) {
    assert.throws(() => service.query({ startDate: value }), (error) => error?.code === 'INVALID_DATE');
  }
  assert.throws(
    () => service.query({ startDate: '2026-08-03', endDate: '2026-08-02' }),
    (error) => error?.code === 'INVALID_DATE_RANGE',
  );
});

test('T11 invalid pagination, sorting, direction, and query shape fail stably', () => {
  const { service } = makeMemoryService();
  for (const offset of [-1, 1.5, '1']) {
    assert.throws(() => service.query({ offset }), (error) => error?.code === 'INVALID_OFFSET');
  }
  for (const limit of [0, -1, 1.5, '1']) {
    assert.throws(() => service.query({ limit }), (error) => error?.code === 'INVALID_LIMIT');
  }
  assert.throws(() => service.query({ sortOrder: 'newest' }), (error) => error?.code === 'INVALID_SORT_ORDER');
  assert.throws(() => service.query({ direction: 'refund' }), (error) => error?.code === 'INVALID_DIRECTION');
  assert.throws(() => service.query(null), (error) => error?.code === 'INVALID_QUERY');
});

test('T12 InMemory and JSON File repositories return identical canonical results', (t) => {
  const directory = makeTempDir(t);
  const memory = createInMemoryExpenseRepository(DATASET);
  const file = createJsonFileExpenseRepository(path.join(directory, 'expense-records.json'), { now: fixedNow });
  assert.equal(file.upsertMany(DATASET, { now: fixedNow }).ok, true);
  const memoryService = createExpenseQueryService(memory);
  const fileService = createExpenseQueryService(file);
  const query = { startDate: '2026-08-01', endDate: '2026-08-03', direction: 'expense', sortOrder: 'desc', offset: 1, limit: 2 };
  assert.deepEqual(fileService.query(query), memoryService.query(query));
});

test('T13 query never mutates repository records, internal order, or returned snapshots', () => {
  const { repository, service } = makeMemoryService();
  const before = repository.list();
  const result = service.query({ sortOrder: 'asc' });
  assert.deepEqual(repository.list(), before);
  result[0].merchant = 'mutated by caller';
  result.reverse();
  assert.deepEqual(repository.list(), before);
});

test('factory requires the complete Expense Repository contract', () => {
  assert.throws(() => createExpenseQueryService({ list() { return []; } }), /missing required method/);
});
