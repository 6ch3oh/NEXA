import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPENSE_REPOSITORY_CONTRACT_VERSION,
  REPOSITORY_METHODS,
  assertRepositoryContract,
  cloneRecord,
  normalizeWriteInput,
  replaceAllRecords,
  snapshotRecords,
  upsertManyRecords,
  upsertRecordInto,
  validateWriteRecord,
} from '../src/repositories/expenseRepository.mjs';

import { normalizeExpenseRecord } from '../src/domain/expenseRecord.mjs';
import {
  completeLegacyRecord,
  incomeLegacyRecord,
  unknownFieldLegacyRecord,
} from '../fixtures/legacyExpenseRecords.fixture.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

test('contract surface exposes explicit version and method list', () => {
  assert.equal(EXPENSE_REPOSITORY_CONTRACT_VERSION, '0.1');
  assert.deepEqual(REPOSITORY_METHODS, [
    'list',
    'all',
    'getById',
    'getByDedupeKey',
    'upsert',
    'upsertMany',
    'replaceAll',
    'clear',
  ]);
});

test('assertRepositoryContract accepts a conforming repo and rejects others', () => {
  const conforming = Object.fromEntries(REPOSITORY_METHODS.map((m) => [m, () => {}]));
  assert.equal(assertRepositoryContract(conforming), conforming);

  const missingOne = { ...conforming };
  delete missingOne.clear;
  assert.throws(() => assertRepositoryContract(missingOne), /missing required method: clear/);
  assert.throws(() => assertRepositoryContract(null), /must be a plain object/);
  assert.throws(() => assertRepositoryContract([]), /must be a plain object/);
});

test('normalizeWriteInput delegates to the single sealed domain normalizer', () => {
  const result = normalizeWriteInput(completeLegacyRecord, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.record.dedupeKey, 'src:wechat:wx-txn-20260810-0001');
  // 与领域模型直接规范化结果完全一致（单一规范化源）。
  const direct = normalizeExpenseRecord(completeLegacyRecord, { now: fixedNow });
  assert.deepEqual(result.record, direct.record);

  const invalid = normalizeWriteInput(
    { platform: 'wechat', occurredAt: '2026-08-10', amountCents: 0 },
    { now: fixedNow },
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'ZERO_AMOUNT');
});

test('normalizeWriteInput never generates repository UUIDs', () => {
  const result = normalizeWriteInput(
    { platform: 'manual', occurredAt: '2026-08-04', amount: 10, direction: 'expense' },
    { now: fixedNow },
  );
  assert.equal(result.ok, true);
  assert.equal(result.record.id, result.record.dedupeKey);
  assert.match(result.record.dedupeKey, /^fp:[0-9a-f]{64}$/);
});

test('validateWriteRecord delegates domain diagnostics', () => {
  const { record } = normalizeWriteInput(completeLegacyRecord, { now: fixedNow });
  assert.deepEqual(validateWriteRecord(record), []);
  const tampered = { ...record, amountCents: 0, occurredAt: '2026-02-30' };
  const codes = validateWriteRecord(tampered).map((issue) => issue.code);
  assert.ok(codes.includes('ZERO_AMOUNT'));
  assert.ok(codes.includes('INVALID_DATE'));
});

test('upsertRecordInto inserts new records and prefers dedupeKey matching', () => {
  const records = [];
  const first = upsertRecordInto(records, completeLegacyRecord, { now: fixedNow });
  assert.equal(first.ok, true);
  assert.equal(first.operation, 'insert');
  assert.equal(records.length, 1);

  // 同 dedupeKey、不同 id/商户 -> dedupeKey 优先更新，整体替换。
  const sameKey = {
    ...completeLegacyRecord,
    id: 'different-legacy-id',
    merchant: 'Replaced Merchant',
  };
  const second = upsertRecordInto(records, sameKey, { now: fixedNow });
  assert.equal(second.ok, true);
  assert.equal(second.operation, 'update');
  assert.equal(second.matched, 'dedupeKey');
  assert.equal(records.length, 1);
  assert.equal(records[0].merchant, 'Replaced Merchant');
  assert.equal(records[0].id, 'different-legacy-id');
});

test('upsertRecordInto falls back to canonical id matching when dedupeKey differs', () => {
  const records = [];
  upsertRecordInto(records, completeLegacyRecord, { now: fixedNow });
  // 同 id 但 sourceId 变化 -> dedupeKey 不同，此时应命中 canonical id 并更新。
  const changedKey = {
    ...completeLegacyRecord,
    sourceId: 'wx-txn-20260810-9999',
  };
  const result = upsertRecordInto(records, changedKey, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.operation, 'update');
  assert.equal(result.matched, 'id');
  assert.equal(records.length, 1);
  assert.equal(records[0].dedupeKey, 'src:wechat:wx-txn-20260810-9999');
});

test('upsertRecordInto rejects invalid records without mutating the store', () => {
  const records = [];
  const invalid = upsertRecordInto(
    records,
    { platform: 'wechat', occurredAt: '2026-08-10', amountCents: 0 },
    { now: fixedNow },
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'ZERO_AMOUNT');
  assert.equal(records.length, 0);
});

test('canonical record re-upsert preserves isolated extensions without nesting', () => {
  const canonical = normalizeWriteInput(unknownFieldLegacyRecord, { now: fixedNow }).record;
  const records = [];
  const result = upsertRecordInto(records, canonical, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.deepEqual(records[0].extensions, canonical.extensions);
  assert.equal('extensions' in records[0].extensions.legacy.raw, false);
  assert.equal('extensions' in records[0].extensions.legacy.unknown, false);
});

test('upsertManyRecords applies inputs deterministically in order', () => {
  const records = [];
  const outcome = upsertManyRecords(
    records,
    [completeLegacyRecord, incomeLegacyRecord, { ...completeLegacyRecord }],
    { now: fixedNow },
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.added, 2);
  assert.equal(outcome.updated, 1);
  assert.equal(outcome.rejected, 0);
  assert.equal(records.length, 2);
  assert.equal(outcome.results.length, 3);
});

test('upsertManyRecords rejects non-array inputs with stable error', () => {
  const outcome = upsertManyRecords([], { not: 'array' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'INVALID_INPUT');
});

test('replaceAllRecords clears prior content and reports cleared count', () => {
  const records = [];
  upsertRecordInto(records, completeLegacyRecord, { now: fixedNow });
  upsertRecordInto(records, incomeLegacyRecord, { now: fixedNow });
  assert.equal(records.length, 2);

  const outcome = replaceAllRecords(records, [incomeLegacyRecord], { now: fixedNow });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.cleared, 2);
  assert.equal(outcome.added, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].dedupeKey, 'src:bank:bank-txn-20260803-0001');
});

test('replaceAllRecords rejects non-array input without clearing prior content', () => {
  const records = [];
  upsertRecordInto(records, completeLegacyRecord, { now: fixedNow });
  const before = snapshotRecords(records);
  const outcome = replaceAllRecords(records, { not: 'array' }, { now: fixedNow });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'INVALID_INPUT');
  assert.equal(outcome.cleared, 0);
  assert.deepEqual(records, before);
});

test('cloneRecord and snapshotRecords return deep, independent copies', () => {
  const { record } = normalizeWriteInput(completeLegacyRecord, { now: fixedNow });
  const clone = cloneRecord(record);
  assert.notEqual(clone, record);
  assert.deepEqual(clone, record);
  clone.amountCents = 1;
  clone.extensions.legacy.raw.merchant = 'mutated';
  assert.equal(record.amountCents, 2580);
  assert.equal(record.extensions.legacy.raw.merchant, 'Synthetic Coffee House');

  const records = [record];
  const snap = snapshotRecords(records);
  snap[0].amountCents = 2;
  assert.equal(records[0].amountCents, 2580);
});
