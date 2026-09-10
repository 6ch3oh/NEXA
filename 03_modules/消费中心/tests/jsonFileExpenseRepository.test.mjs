import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createJsonFileExpenseRepository } from '../src/repositories/jsonFileExpenseRepository.mjs';
import { REPOSITORY_METHODS } from '../src/repositories/expenseRepository.mjs';
import {
  completeLegacyRecord,
  incomeLegacyRecord,
  unknownFieldLegacyRecord,
} from '../fixtures/legacyExpenseRecords.fixture.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

// 每个测试独立的临时目录（Node mkdtemp，全合成数据）。
function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-expense-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('factory requires an explicit non-empty filePath', () => {
  assert.throws(() => createJsonFileExpenseRepository(), /explicit non-empty filePath/);
  assert.throws(() => createJsonFileExpenseRepository(''), /explicit non-empty filePath/);
  assert.throws(() => createJsonFileExpenseRepository('   '), /explicit non-empty filePath/);
  assert.throws(() => createJsonFileExpenseRepository(42), /explicit non-empty filePath/);
});

test('missing explicit file means an empty repository', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  assert.deepEqual(repo.list(), []);
  assert.equal(fs.existsSync(filePath), false);
});

test('first write creates only the parent directory and file', (t) => {
  const dir = makeTempDir(t);
  const nested = path.join(dir, 'nested', 'sub');
  const filePath = path.join(nested, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  const result = repo.upsert(completeLegacyRecord, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.statSync(filePath).isFile(), true);
  // 只允许创建父目录链与目标文件。
  assert.equal(fs.readdirSync(dir).length, 1); // 'nested'
  assert.equal(fs.readdirSync(nested).length, 1); // 'expense-records.json'
});

test('upsert persists and a fresh instance recovers canonical records', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  repo.upsert(completeLegacyRecord, { now: fixedNow });
  repo.upsert(incomeLegacyRecord, { now: fixedNow });

  const reopened = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  assert.equal(reopened.list().length, 2);
  const first = reopened.getById('legacy-001');
  assert.equal(first.ok, true);
  assert.equal(first.record.dedupeKey, 'src:wechat:wx-txn-20260810-0001');
  assert.equal(first.record.amountCents, 2580);
  const second = reopened.getById('legacy-002');
  assert.equal(second.record.direction, 'income');
  assert.equal(second.record.amountCents, -10000);
});

test('malformed JSON fails with a stable error and stays byte-for-byte unchanged', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const corrupt = '{"version":1,"records":[{"id":"x",]';
  fs.writeFileSync(filePath, corrupt, 'utf8');
  let error;
  try {
    createJsonFileExpenseRepository(filePath, { now: fixedNow });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'expected a stable error');
  assert.equal(error.code, 'INVALID_JSON');
  // 不得当作空仓库或覆盖：文件内容逐字节不变。
  assert.equal(fs.readFileSync(filePath, 'utf8'), corrupt);
  assert.deepEqual(fs.readdirSync(dir), ['expense-records.json']);
});

test('structured document errors on disk also fail with stable codes, not empty', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, records: { nope: true } }), 'utf8');
  assert.throws(
    () => createJsonFileExpenseRepository(filePath, { now: fixedNow }),
    (error) => error && error.code === 'RECORDS_NOT_ARRAY',
  );
});

test('upsertMany persists the full batch and re-instantiates identically', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  const outcome = repo.upsertMany([completeLegacyRecord, incomeLegacyRecord], { now: fixedNow });
  assert.equal(outcome.added, 2);

  const reopened = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  assert.equal(reopened.list().length, 2);
});

test('dedupe persistence: duplicate upsert across instances keeps one record', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  repo.upsert(completeLegacyRecord, { now: fixedNow });
  const updated = repo.upsert({ ...completeLegacyRecord, merchant: 'Renamed' }, { now: fixedNow });
  assert.equal(updated.operation, 'update');
  assert.equal(repo.list().length, 1);

  const reopened = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.list()[0].merchant, 'Renamed');
});

test('integer cents, income negative, and date survive persistence', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  repo.upsert(completeLegacyRecord, { now: fixedNow });
  repo.upsert(incomeLegacyRecord, { now: fixedNow });

  const reopened = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  const complete = reopened.getByDedupeKey('src:wechat:wx-txn-20260810-0001').record;
  assert.ok(Number.isInteger(complete.amountCents));
  assert.equal(complete.amountCents, 2580);
  assert.equal(complete.occurredAt, '2026-08-10');
  const income = reopened.getByDedupeKey('src:bank:bank-txn-20260803-0001').record;
  assert.ok(Number.isInteger(income.amountCents));
  assert.equal(income.amountCents, -10000);
  assert.equal(income.occurredAt, '2026-08-03');
});

test('unknown-field extensions survive persistence via the legacy adapter', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  repo.upsert(unknownFieldLegacyRecord, { now: fixedNow });

  const reopened = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  const record = reopened.getByDedupeKey('src:wechat:wx-txn-20260805-0004').record;
  assert.equal(record.occurredAt, '2026-08-05');
  assert.ok(!('rawText' in record));
  assert.equal(record.extensions.legacy.unknown.rawText, unknownFieldLegacyRecord.rawText);
  assert.equal(record.extensions.legacy.unknown.internalFlag, true);
  // 磁盘上的 legacy 文档通过 domainToLegacyDocument 保留未知键。
  const rawText = JSON.parse(fs.readFileSync(filePath, 'utf8')).records[0].rawText;
  assert.equal(rawText, unknownFieldLegacyRecord.rawText);

  // Repository 的正式输入是 Domain record；再次 upsert canonical record 不得嵌套或泄漏 extensions。
  const canonicalUpsert = reopened.upsert(record, { now: fixedNow });
  assert.equal(canonicalUpsert.ok, true);
  const reopenedAgain = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  const roundTripped = reopenedAgain.getByDedupeKey('src:wechat:wx-txn-20260805-0004').record;
  assert.equal(roundTripped.extensions.legacy.unknown.rawText, unknownFieldLegacyRecord.rawText);
  assert.equal('extensions' in roundTripped.extensions.legacy.raw, false);
  const persistedRecord = JSON.parse(fs.readFileSync(filePath, 'utf8')).records[0];
  assert.equal('extensions' in persistedRecord, false);
});

test('path isolation: two repositories at different paths never interfere', (t) => {
  const dir = makeTempDir(t);
  const fileA = path.join(dir, 'a', 'records.json');
  const fileB = path.join(dir, 'b', 'records.json');
  const repoA = createJsonFileExpenseRepository(fileA, { now: fixedNow });
  const repoB = createJsonFileExpenseRepository(fileB, { now: fixedNow });

  repoA.upsert(completeLegacyRecord, { now: fixedNow });
  assert.equal(repoA.list().length, 1);
  assert.equal(repoB.list().length, 0);

  repoB.upsert(incomeLegacyRecord, { now: fixedNow });
  assert.equal(repoA.list().length, 1);
  assert.equal(repoB.list().length, 1);
  assert.equal(repoA.list()[0].dedupeKey, 'src:wechat:wx-txn-20260810-0001');
  assert.equal(repoB.list()[0].dedupeKey, 'src:bank:bank-txn-20260803-0001');

  const reopenedA = createJsonFileExpenseRepository(fileA, { now: fixedNow });
  const reopenedB = createJsonFileExpenseRepository(fileB, { now: fixedNow });
  assert.equal(reopenedA.list().length, 1);
  assert.equal(reopenedB.list().length, 1);
});

test('clear persists an empty container; re-open sees an empty repository', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  repo.upsertMany([completeLegacyRecord, incomeLegacyRecord], { now: fixedNow });
  const cleared = repo.clear();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, 2);

  const reopened = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  assert.deepEqual(reopened.list(), []);
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.deepEqual(onDisk.records, []);
});

test('replaceAll replaces persisted content and reports cleared', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  repo.upsertMany([completeLegacyRecord, incomeLegacyRecord], { now: fixedNow });
  const outcome = repo.replaceAll([completeLegacyRecord], { now: fixedNow });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.cleared, 2);

  const reopened = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.list()[0].dedupeKey, 'src:wechat:wx-txn-20260810-0001');
});

test('invalid upsert is rejected and does not create or alter the file', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  const result = repo.upsert({ platform: 'wechat', occurredAt: '2026-08-10', amountCents: 0 }, { now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ZERO_AMOUNT');
  assert.equal(fs.existsSync(filePath), false);
  assert.deepEqual(repo.list(), []);
});

test('best-effort temp rename leaves no stray temporary files behind', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  repo.upsert(completeLegacyRecord, { now: fixedNow });
  repo.upsert(incomeLegacyRecord, { now: fixedNow });
  repo.clear();
  const entries = fs.readdirSync(dir);
  assert.deepEqual(entries, ['expense-records.json']);
});

test('in-memory snapshots are unaffected by caller mutation after load', (t) => {
  const dir = makeTempDir(t);
  const filePath = path.join(dir, 'expense-records.json');
  const repo = createJsonFileExpenseRepository(filePath, { now: fixedNow });
  repo.upsert(completeLegacyRecord, { now: fixedNow });
  const snap = repo.list();
  snap[0].amountCents = 1;
  assert.equal(repo.list()[0].amountCents, 2580);
});
