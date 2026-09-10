import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_JSON_CODEC_VERSION,
  decodeLegacyExpenseJson,
  encodeLegacyExpenseJson,
} from '../src/storage/legacyExpenseJsonCodec.mjs';
import { legacyToDomainDocument } from '../src/adapters/legacyExpenseRecordsAdapter.mjs';
import {
  completeLegacyRecord,
  incomeLegacyRecord,
  unknownFieldLegacyRecord,
  legacyDocumentFixture,
} from '../fixtures/legacyExpenseRecords.fixture.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

test('codec exposes a stable version and the decode/encode surface', () => {
  assert.equal(LEGACY_JSON_CODEC_VERSION, '0.1');
  assert.equal(typeof decodeLegacyExpenseJson, 'function');
  assert.equal(typeof encodeLegacyExpenseJson, 'function');
});

test('decode: JSON text -> parse -> legacyToDomainDocument, reusing Phase1 mapping', () => {
  const jsonText = JSON.stringify(legacyDocumentFixture);
  const decoded = decodeLegacyExpenseJson(jsonText, { now: fixedNow });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.domainRecords.length, 2);
  assert.equal(decoded.domainRecords[0].dedupeKey, 'src:wechat:wx-txn-20260810-0001');
  assert.equal(decoded.domainRecords[0].amountCents, 2580);
  assert.equal(decoded.domainRecords[1].direction, 'income');
  assert.equal(decoded.domainRecords[1].amountCents, -10000);
  assert.deepEqual(decoded.byDedupeKey, {
    'src:wechat:wx-txn-20260810-0001': true,
    'src:bank:bank-txn-20260803-0001': true,
  });
});

test('decode: invalid JSON text yields a stable INVALID_JSON error', () => {
  for (const bad of ['{', 'not-json', '{"version":1,"records":[}', 'tru', '{"records": 1,}']) {
    const decoded = decodeLegacyExpenseJson(bad, { now: fixedNow });
    assert.equal(decoded.ok, false, bad);
    assert.equal(decoded.error.code, 'INVALID_JSON');
  }
});

test('decode: non-string input yields a stable INVALID_INPUT error', () => {
  for (const bad of [null, undefined, 42, {}, [], Buffer.from('{}')]) {
    const decoded = decodeLegacyExpenseJson(bad, { now: fixedNow });
    assert.equal(decoded.ok, false);
    assert.equal(decoded.error.code, 'INVALID_INPUT');
  }
});

test('decode: structured document errors propagate from the Phase1 adapter', () => {
  const notObject = decodeLegacyExpenseJson(JSON.stringify('nope'), { now: fixedNow });
  assert.equal(notObject.ok, false);
  assert.equal(notObject.error.code, 'NOT_AN_OBJECT');

  const recordsNotArray = decodeLegacyExpenseJson(
    JSON.stringify({ version: 1, records: { a: 1 } }),
    { now: fixedNow },
  );
  assert.equal(recordsNotArray.ok, false);
  assert.equal(recordsNotArray.error.code, 'RECORDS_NOT_ARRAY');
});

test('decode: invalid records inside JSON are rejected with stable domain codes', () => {
  const jsonText = JSON.stringify({
    version: 1,
    records: [
      completeLegacyRecord,
      { platform: 'wechat', occurredAt: '2026-08-10', amountCents: 0 },
      { platform: 'wechat', occurredAt: '2026-02-30', amountCents: 100 },
      'not-an-object',
    ],
  });
  const decoded = decodeLegacyExpenseJson(jsonText, { now: fixedNow });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.domainRecords.length, 1);
  const codes = decoded.rejected.map((entry) => entry.error.code);
  assert.ok(codes.includes('ZERO_AMOUNT'));
  assert.ok(codes.includes('INVALID_DATE'));
  assert.ok(codes.includes('INVALID_RECORD'));
});

test('encode: domain records -> domainToLegacyDocument -> JSON.stringify', () => {
  const { domainRecords } = decodeLegacyExpenseJson(JSON.stringify(legacyDocumentFixture), { now: fixedNow });
  const encoded = encodeLegacyExpenseJson(domainRecords, { now: fixedNow });
  assert.equal(encoded.ok, true);
  assert.equal(typeof encoded.jsonText, 'string');
  const parsed = JSON.parse(encoded.jsonText);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.updatedAt, FIXED_NOW);
  assert.deepEqual(parsed.byDedupeKey, {
    'src:wechat:wx-txn-20260810-0001': true,
    'src:bank:bank-txn-20260803-0001': true,
  });
});

test('encode: non-array domainRecords yields a stable INVALID_RECORDS error', () => {
  const encoded = encodeLegacyExpenseJson({ records: [] }, { now: fixedNow });
  assert.equal(encoded.ok, false);
  assert.equal(encoded.error.code, 'INVALID_RECORDS');
});

test('round-trip: encode then decode preserves canonical records and extensions', () => {
  const { domainRecords } = decodeLegacyExpenseJson(
    JSON.stringify({ version: 1, records: [completeLegacyRecord, unknownFieldLegacyRecord] }),
    { now: fixedNow },
  );
  const encoded = encodeLegacyExpenseJson(domainRecords, { now: fixedNow });
  const roundTripped = decodeLegacyExpenseJson(encoded.jsonText, { now: fixedNow });
  assert.equal(roundTripped.ok, true);
  assert.equal(roundTripped.domainRecords.length, 2);

  const CANONICAL = [
    'id', 'platform', 'sourceId', 'occurredAt', 'amountCents', 'currency',
    'merchant', 'direction', 'category', 'note', 'createdAt', 'dedupeKey',
  ];
  for (const field of CANONICAL) {
    assert.deepEqual(roundTripped.domainRecords[0][field], domainRecords[0][field], `field ${field}`);
    assert.deepEqual(roundTripped.domainRecords[1][field], domainRecords[1][field], `field ${field}`);
  }
  // 未知字段经 legacy raw base 保留（Phase1 domain->legacy 兼容）。
  const legacyRecord = JSON.parse(encoded.jsonText).records.find((r) => r.id === 'legacy-004');
  assert.equal(legacyRecord.rawText, unknownFieldLegacyRecord.rawText);
  assert.equal(legacyRecord.internalFlag, true);
});

test('codec does not re-implement alias mapping; it reuses the Phase1 adapter', () => {
  // aliasLegacyRecord 等别名仅在领域规范化中处理；codec 只做 JSON 反序列化 + 委托。
  const jsonText = JSON.stringify({
    version: 1,
    records: [
      {
        source: 'Alipay',
        transactionTime: '2026-8-2',
        type: 'income',
        amount: 100,
        opposite: 'Synthetic Employer Corp',
        description: 'synthetic payroll via alias fields',
        tradeId: 'ali-txn-20260802-0001',
      },
    ],
  });
  const decoded = decodeLegacyExpenseJson(jsonText, { now: fixedNow });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.domainRecords[0].platform, 'alipay');
  assert.equal(decoded.domainRecords[0].amountCents, -10000);
  assert.equal(decoded.domainRecords[0].occurredAt, '2026-08-02');
  assert.equal(decoded.domainRecords[0].dedupeKey, 'src:alipay:ali-txn-20260802-0001');
});

test('codec equivalence: decode(jsonText) matches legacyToDomainDocument(parsed)', () => {
  const parsed = JSON.parse(JSON.stringify(legacyDocumentFixture));
  const viaAdapter = legacyToDomainDocument(parsed, { now: fixedNow });
  const viaCodec = decodeLegacyExpenseJson(JSON.stringify(legacyDocumentFixture), { now: fixedNow });
  assert.equal(viaCodec.ok, true);
  assert.equal(viaAdapter.ok, true);
  assert.deepEqual(viaCodec.domainRecords, viaAdapter.domainRecords);
  assert.deepEqual(viaCodec.byDedupeKey, viaAdapter.byDedupeKey);
});

test('encode emits syntactically stable pretty-printed JSON that JSON.parse accepts', () => {
  const { domainRecords } = decodeLegacyExpenseJson(JSON.stringify(legacyDocumentFixture), { now: fixedNow });
  const encoded = encodeLegacyExpenseJson(domainRecords, { now: fixedNow });
  assert.equal(encoded.jsonText.includes('\n  '), true, 'pretty-printed with indentation');
  const reparsed = JSON.parse(encoded.jsonText);
  assert.equal(reparsed.records.length, 2);
  assert.equal(reparsed.records[0].amountCents, 2580);
});
