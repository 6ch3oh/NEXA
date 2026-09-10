import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseInboxFile,
  parseLegacyInboxJson,
} from '../src/legacy/parsers/legacyInboxJsonParser.mjs';

const syntheticRecord = (overrides = {}) => ({
  occurredAt: '2026-08-03T20:24:52+08:00',
  platform: 'wechat',
  merchant: '测试咖啡店',
  amount: '12.80',
  direction: 'expense',
  sourceId: 'TEST-WECHAT-TEST',
  rawText: '测试消费通知，不是真实账单',
  ...overrides,
});

test('legacy inbox JSON preserves single, array, and wrapped record envelopes', () => {
  assert.equal(parseInboxFile(JSON.stringify(syntheticRecord())).records.length, 1);
  assert.equal(parseInboxFile(JSON.stringify([syntheticRecord(), syntheticRecord({ sourceId: 'two' })])).records.length, 2);
  assert.equal(parseInboxFile(JSON.stringify({ records: [syntheticRecord()] })).records.length, 1);
});

test('legacy inbox JSON preserves BOM and stable invalid structure reasons', () => {
  assert.equal(parseInboxFile(`\uFEFF${JSON.stringify(syntheticRecord())}`).ok, true);
  assert.deepEqual(parseInboxFile('{bad'), { ok: false, reason: 'invalidJSON' });
  assert.deepEqual(parseInboxFile(JSON.stringify({ records: {} })), { ok: false, reason: 'invalidStructure' });
  assert.deepEqual(parseInboxFile(JSON.stringify([])), { ok: false, reason: 'empty' });
  assert.deepEqual(parseInboxFile('null'), { ok: false, reason: 'notObject' });
});

test('legacy inbox wrapper maps reasons without throwing', () => {
  const result = parseLegacyInboxJson('{not json');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'LEGACY_INBOX_INVALID_JSON');
  assert.equal(result.error.legacyReason, 'invalidJSON');
  assert.equal(result.error.stage, 'parse');
});
