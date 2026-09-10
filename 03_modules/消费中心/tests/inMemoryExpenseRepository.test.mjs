import test from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryExpenseRepository } from '../src/repositories/inMemoryExpenseRepository.mjs';
import { REPOSITORY_METHODS } from '../src/repositories/expenseRepository.mjs';
import {
  completeLegacyRecord,
  incomeLegacyRecord,
  unknownFieldLegacyRecord,
} from '../fixtures/legacyExpenseRecords.fixture.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

test('implements the full V0.1 repository contract surface', () => {
  const repo = createInMemoryExpenseRepository();
  for (const method of REPOSITORY_METHODS) {
    assert.equal(typeof repo[method], 'function', method);
  }
  assert.equal(repo.list().length, 0);
});

test('empty repository: list/all empty, lookups return NOT_FOUND', () => {
  const repo = createInMemoryExpenseRepository();
  assert.deepEqual(repo.list(), []);
  assert.deepEqual(repo.all(), []);
  assert.deepEqual(repo.getById('nope'), { ok: false, error: { code: 'NOT_FOUND', message: 'no expense record with id nope' } });
  assert.deepEqual(repo.getByDedupeKey('nope'), { ok: false, error: { code: 'NOT_FOUND', message: 'no expense record with dedupeKey nope' } });
});

test('insert then read back by id and dedupeKey', () => {
  const repo = createInMemoryExpenseRepository();
  const inserted = repo.upsert(completeLegacyRecord, { now: fixedNow });
  assert.equal(inserted.ok, true);
  assert.equal(inserted.operation, 'insert');
  assert.equal(repo.list().length, 1);

  const byId = repo.getById('legacy-001');
  assert.equal(byId.ok, true);
  assert.equal(byId.record.dedupeKey, 'src:wechat:wx-txn-20260810-0001');

  const byKey = repo.getByDedupeKey('src:wechat:wx-txn-20260810-0001');
  assert.equal(byKey.ok, true);
  assert.equal(byKey.record.amountCents, 2580);
});

test('upsert dedupes by dedupeKey and updates deterministically', () => {
  const repo = createInMemoryExpenseRepository();
  repo.upsert(completeLegacyRecord, { now: fixedNow });

  const updated = repo.upsert({ ...completeLegacyRecord, merchant: 'Renamed Merchant' }, { now: fixedNow });
  assert.equal(updated.ok, true);
  assert.equal(updated.operation, 'update');
  assert.equal(repo.list().length, 1);
  assert.equal(repo.list()[0].merchant, 'Renamed Merchant');
});

test('upsert matches canonical id as fallback when dedupeKey changes', () => {
  const repo = createInMemoryExpenseRepository();
  repo.upsert(completeLegacyRecord, { now: fixedNow });

  const result = repo.upsert(
    { ...completeLegacyRecord, sourceId: 'wx-txn-20260810-7777' },
    { now: fixedNow },
  );
  assert.equal(result.ok, true);
  assert.equal(result.operation, 'update');
  assert.equal(repo.list().length, 1);
  assert.equal(repo.list()[0].dedupeKey, 'src:wechat:wx-txn-20260810-7777');
});

test('upsertMany adds and dedupes within the same batch', () => {
  const repo = createInMemoryExpenseRepository();
  const outcome = repo.upsertMany(
    [completeLegacyRecord, incomeLegacyRecord, { ...completeLegacyRecord }],
    { now: fixedNow },
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.added, 2);
  assert.equal(outcome.updated, 1);
  assert.equal(outcome.rejected, 0);
  assert.equal(repo.list().length, 2);
});

test('replaceAll replaces the entire repository content', () => {
  const repo = createInMemoryExpenseRepository();
  repo.upsert(completeLegacyRecord, { now: fixedNow });
  repo.upsert(incomeLegacyRecord, { now: fixedNow });
  assert.equal(repo.list().length, 2);

  const outcome = repo.replaceAll([incomeLegacyRecord], { now: fixedNow });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.cleared, 2);
  assert.equal(repo.list().length, 1);
  assert.equal(repo.list()[0].direction, 'income');
});

test('clear empties the repository and reports cleared count', () => {
  const repo = createInMemoryExpenseRepository();
  repo.upsert(completeLegacyRecord, { now: fixedNow });
  repo.upsert(incomeLegacyRecord, { now: fixedNow });
  const cleared = repo.clear();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, 2);
  assert.deepEqual(repo.list(), []);
  assert.equal(repo.clear().cleared, 0);
});

test('invalid records are rejected with stable error codes and not stored', () => {
  const repo = createInMemoryExpenseRepository();
  const zero = repo.upsert({ platform: 'wechat', occurredAt: '2026-08-10', amountCents: 0 }, { now: fixedNow });
  assert.equal(zero.ok, false);
  assert.equal(zero.error.code, 'ZERO_AMOUNT');

  const noPlatform = repo.upsert({ occurredAt: '2026-08-10', amountCents: 100 }, { now: fixedNow });
  assert.equal(noPlatform.ok, false);
  assert.equal(noPlatform.error.code, 'EMPTY_PLATFORM');

  const badDate = repo.upsert({ platform: 'wechat', occurredAt: '2026-02-30', amountCents: 100 }, { now: fixedNow });
  assert.equal(badDate.ok, false);
  assert.equal(badDate.error.code, 'INVALID_DATE');

  const nonObject = repo.upsert('not-an-object', { now: fixedNow });
  assert.equal(nonObject.ok, false);
  assert.equal(nonObject.error.code, 'INVALID_RECORD');

  assert.equal(repo.list().length, 0);
});

test('seed inputs are normalized through the sealed domain model', () => {
  const repo = createInMemoryExpenseRepository([completeLegacyRecord]);
  assert.equal(repo.list().length, 1);
  assert.equal(repo.list()[0].platform, 'wechat');
  assert.equal(repo.list()[0].dedupeKey, 'src:wechat:wx-txn-20260810-0001');
});

test('unknown fields stay isolated in extensions.legacy, never spread to top level', () => {
  const repo = createInMemoryExpenseRepository();
  repo.upsert(unknownFieldLegacyRecord, { now: fixedNow });
  const record = repo.getByDedupeKey('src:wechat:wx-txn-20260805-0004').record;
  assert.equal(record.occurredAt, '2026-08-05');
  assert.ok(!('rawText' in record));
  assert.ok(!('internalFlag' in record));
  assert.equal(record.extensions.legacy.unknown.rawText, unknownFieldLegacyRecord.rawText);
  assert.equal(record.extensions.legacy.unknown.internalFlag, true);
});

test('list and getters return safe snapshots, not internal references', () => {
  const repo = createInMemoryExpenseRepository();
  repo.upsert(unknownFieldLegacyRecord, { now: fixedNow });

  const snap = repo.list();
  snap[0].amountCents = 1;
  snap[0].extensions.legacy.raw.rawText = 'mutated';
  assert.equal(repo.list()[0].amountCents, 990);
  assert.equal(repo.list()[0].extensions.legacy.raw.rawText, unknownFieldLegacyRecord.rawText);

  const byId = repo.getById('legacy-004');
  byId.record.merchant = 'mutated';
  assert.equal(repo.getById('legacy-004').record.merchant, 'Synthetic Corner Store');
});

test('income produces negative integer cents and stays deterministic', () => {
  const repo = createInMemoryExpenseRepository();
  repo.upsert(incomeLegacyRecord, { now: fixedNow });
  const record = repo.getById('legacy-002').record;
  assert.equal(record.amountCents, -10000);
  assert.equal(record.direction, 'income');
});
