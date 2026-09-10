import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_CONTAINER_VERSION,
  domainToLegacyDocument,
  emptyLegacyDocument,
  legacyToDomainDocument,
} from '../src/adapters/legacyExpenseRecordsAdapter.mjs';
import { CANONICAL_FIELDS } from '../src/domain/expenseRecord.mjs';

import {
  completeLegacyRecord,
  duplicateLegacyRecords,
  EXPECTED_COMPLETE_DEDUPE_KEY,
  incomeLegacyRecord,
  invalidLegacyInputs,
  legacyDocumentFixture,
  missingOptionalLegacyRecord,
  unknownFieldLegacyRecord,
} from '../fixtures/legacyExpenseRecords.fixture.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

test('empty/missing-equivalent legacy state matches recordShape()', () => {
  const empty = emptyLegacyDocument();
  assert.deepEqual(empty, { version: 1, records: [], byDedupeKey: {} });
});

test('public surface has no JSON-text parser responsibility', async () => {
  const mod = await import('../src/adapters/legacyExpenseRecordsAdapter.mjs');
  // 不再存在 parseLegacyDocument 或任何 JSON 文本解析入口。
  assert.equal(typeof mod.parseLegacyDocument, 'undefined');
  assert.equal(typeof mod.parse, 'undefined');
  assert.equal(typeof mod.parseJSON, 'undefined');
  assert.ok(
    !Object.keys(mod).some((key) => /^(parse|stringify)/i.test(key)),
    'no JSON parse/stringify on the public surface',
  );
  assert.ok(!Object.keys(mod).some((key) => /json/i.test(key)), 'no json-text API on the public surface');
  // 适配器只接受已经反序列化的结构化对象：JSON 文本输入是调用方的解析职责。
  assert.ok(!('parseLegacyDocument' in mod));
});

test('legacyToDomainDocument rejects non-object structured documents with stable NOT_AN_OBJECT', () => {
  for (const bad of ['nope', [1, 2, 3], null, 42, undefined]) {
    const result = legacyToDomainDocument(bad, { now: fixedNow });
    assert.equal(result.ok, false, `expected NOT_AN_OBJECT for ${String(bad)}`);
    assert.equal(result.error.code, 'NOT_AN_OBJECT');
    assert.deepEqual(result.domainRecords, []);
    assert.deepEqual(result.rejected, []);
  }
});

test('legacyToDomainDocument rejects non-array records with stable RECORDS_NOT_ARRAY', () => {
  const result = legacyToDomainDocument({ version: 1, records: { nope: true } }, { now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'RECORDS_NOT_ARRAY');
  assert.deepEqual(result.domainRecords, []);
  assert.deepEqual(result.rejected, []);
});

test('non-object records inside a structured document are rejected with stable INVALID_RECORD', () => {
  const doc = {
    version: 1,
    records: [completeLegacyRecord, 'not-an-object', null, 42, []],
  };
  const result = legacyToDomainDocument(doc, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.domainRecords.length, 1);
  assert.equal(result.rejected.length, 4);
  for (const entry of result.rejected) {
    assert.equal(entry.error.code, 'INVALID_RECORD');
  }
});

test('legacyToDomainDocument maps records, rejects invalid ones, and rebuilds byDedupeKey', () => {
  const result = legacyToDomainDocument(legacyDocumentFixture, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.domainRecords.length, 2);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.duplicates, []);

  const [first, second] = result.domainRecords;
  assert.equal(first.dedupeKey, EXPECTED_COMPLETE_DEDUPE_KEY);
  assert.equal(first.amountCents, 2580);
  assert.equal(second.amountCents, -10000);
  assert.equal(second.direction, 'income');

  assert.deepEqual(result.byDedupeKey, {
    'src:wechat:wx-txn-20260810-0001': true,
    'src:bank:bank-txn-20260803-0001': true,
  });
});

test('legacyToDomainDocument reports rejected records with stable codes', () => {
  const doc = {
    version: 1,
    records: [
      completeLegacyRecord,
      ...invalidLegacyInputs.map((item) => item.input),
    ],
  };
  const result = legacyToDomainDocument(doc, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.domainRecords.length, 1);
  assert.equal(result.rejected.length, invalidLegacyInputs.length);
  const codes = result.rejected.map((entry) => entry.error.code);
  for (const item of invalidLegacyInputs) {
    assert.ok(codes.includes(item.expect), `expected rejected code ${item.expect} for ${item.name}`);
  }
  assert.deepEqual(result.byDedupeKey, { [EXPECTED_COMPLETE_DEDUPE_KEY]: true });
});

test('legacyToDomainDocument deduplicates identical records', () => {
  const doc = { version: 1, records: duplicateLegacyRecords };
  const result = legacyToDomainDocument(doc, { now: fixedNow });
  assert.equal(result.domainRecords.length, 1);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.rejected.length, 0);
});

test('domainToLegacyDocument rebuilds a legacy V1 container from domain records', () => {
  const { domainRecords } = legacyToDomainDocument(legacyDocumentFixture, { now: fixedNow });
  const result = domainToLegacyDocument(domainRecords, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.document.version, LEGACY_CONTAINER_VERSION);
  assert.equal(result.document.records.length, 2);
  assert.equal(result.document.updatedAt, FIXED_NOW);
  assert.deepEqual(result.document.byDedupeKey, {
    'src:wechat:wx-txn-20260810-0001': true,
    'src:bank:bank-txn-20260803-0001': true,
  });
  // 规范 12 字段齐备。
  const legacyFirst = result.document.records[0];
  for (const field of CANONICAL_FIELDS) {
    assert.ok(field in legacyFirst, `legacy record missing canonical field ${field}`);
  }
  assert.equal(legacyFirst.id, 'legacy-001');
  assert.equal(legacyFirst.platform, 'wechat');
  assert.equal(legacyFirst.dedupeKey, EXPECTED_COMPLETE_DEDUPE_KEY);
});

test('domainToLegacyDocument preserves unknown legacy fields via raw base', () => {
  const { domainRecords } = legacyToDomainDocument(
    { version: 1, records: [unknownFieldLegacyRecord] },
    { now: fixedNow },
  );
  const result = domainToLegacyDocument(domainRecords, { now: fixedNow });
  const legacyRecord = result.document.records[0];
  assert.equal(legacyRecord.rawText, unknownFieldLegacyRecord.rawText);
  assert.equal(legacyRecord.internalFlag, true);
  assert.equal(legacyRecord.occurredAt, '2026-08-05');
  assert.equal(legacyRecord.dedupeKey, 'src:wechat:wx-txn-20260805-0004');
  // 别名键不会与规范字段重复出现。
  assert.ok(!('source' in legacyRecord));
});

test('domainToLegacyDocument recomputes dedupeKey and never trusts stale input keys', () => {
  const { domainRecords } = legacyToDomainDocument(
    { version: 1, records: [missingOptionalLegacyRecord] },
    { now: fixedNow },
  );
  const stale = { ...domainRecords[0], dedupeKey: 'src:stale:key' };
  const result = domainToLegacyDocument([stale], { now: fixedNow });
  const legacyRecord = result.document.records[0];
  assert.notEqual(legacyRecord.dedupeKey, 'src:stale:key');
  assert.match(legacyRecord.dedupeKey, /^fp:[0-9a-f]{64}$/);
  assert.equal(legacyRecord.amountCents, 1234);
  assert.equal(legacyRecord.category, 'other');
});

test('legacy -> domain -> legacy round trip preserves canonical values', () => {
  const { domainRecords } = legacyToDomainDocument(
    { version: 1, records: [completeLegacyRecord, incomeLegacyRecord, unknownFieldLegacyRecord] },
    { now: fixedNow },
  );
  const back = domainToLegacyDocument(domainRecords, { now: fixedNow });
  assert.equal(back.document.records.length, 3);
  const byKey = new Map(back.document.records.map((r) => [r.id, r]));
  assert.equal(byKey.get('legacy-001').amountCents, 2580);
  assert.equal(byKey.get('legacy-002').amountCents, -10000);
  assert.equal(byKey.get('legacy-004').rawText, unknownFieldLegacyRecord.rawText);
});
