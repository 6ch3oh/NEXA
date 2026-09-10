import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeKeyFor,
  normalizeAmountCents,
  normalizeExpenseRecord,
  normalizeOccurredAt,
  normalizePlatform,
} from '../src/legacy/parsers/legacyExpenseCompatibility.mjs';
import {
  detectCsvPlatform,
  parseCsv,
  parseLegacyExpenseCsv,
  previewCsvImport,
} from '../src/legacy/parsers/legacyExpenseCsvParser.mjs';

const sampleRaw = (overrides = {}) => ({
  platform: 'wechat',
  sourceId: 'wx-1',
  occurredAt: '2026-08-01',
  amount: 25.5,
  merchant: '美团外卖',
  direction: 'expense',
  ...overrides,
});

test('legacy compatibility keeps integer cents, income sign, aliases, and decorated amounts', () => {
  assert.equal(normalizeExpenseRecord(sampleRaw()).amountCents, 2550);
  assert.equal(normalizeExpenseRecord(sampleRaw({ amount: '12.34' })).amountCents, 1234);
  assert.equal(normalizeAmountCents(100, { asCents: true }), 100);
  assert.equal(normalizeAmountCents('¥2.50'), 250);
  const income = normalizeExpenseRecord(sampleRaw({ direction: '转账收入', amount: 100 }));
  assert.equal(income.amountCents, -10000);
  assert.equal(income.direction, 'income');
  assert.equal(normalizePlatform('微信'), 'wechat');
});

test('legacy date normalization canonicalizes supported values', () => {
  assert.equal(normalizeOccurredAt('2024-1-5'), '2024-01-05');
  assert.equal(normalizeOccurredAt('2024-01-05T12:30:00'), '2024-01-05');
  assert.equal(normalizeOccurredAt('garbage'), '');
});

test('legacy dedupe prefers source identity and fallback hash is stable', () => {
  const sourceA = dedupeKeyFor({ platform: 'wechat', sourceId: 'abc', occurredAt: '2026-01-01', amountCents: 100, merchant: 'M', direction: 'expense' });
  const sourceB = dedupeKeyFor({ platform: 'wechat', sourceId: 'abc', occurredAt: '2026-01-02', amountCents: 999, merchant: 'N', direction: 'expense' });
  assert.equal(sourceA, sourceB);
  const a = dedupeKeyFor({ platform: 'alipay', sourceId: '', occurredAt: '2026-01-01', amountCents: 500, merchant: '京东', direction: 'expense' });
  const b = dedupeKeyFor({ platform: 'alipay', sourceId: '', occurredAt: '2026-01-01', amountCents: 500, merchant: '淘宝', direction: 'expense' });
  const c = dedupeKeyFor({ platform: 'alipay', sourceId: '', occurredAt: '2026-01-01', amountCents: 500, merchant: '京东', direction: 'expense' });
  assert.notEqual(a, b);
  assert.equal(a, c);
});

test('legacy CSV tokenizer preserves quoted commas and escaped quotes', () => {
  const rows = parseCsv('a,b\n"1,000","hello ""x"""\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], '1,000');
  assert.equal(rows[1][1], 'hello "x"');
});

test('legacy CSV detection and preview preserve mapping and diagnostics', () => {
  assert.equal(detectCsvPlatform(['交易时间', '交易类型', '交易对方', '商品', '收/支']), 'wechat');
  assert.ok(['alipay', 'wechat'].includes(detectCsvPlatform(['交易时间', '收/支', '交易对方', '商品说明'])));
  const preview = previewCsvImport('trade_time,amount,counterparty,direction\n2026-08-01,12.5,Test Shop,expense\n,5,Missing Date,expense');
  assert.equal(preview.platform, 'unknown');
  assert.equal(preview.total, 1);
  assert.equal(preview.skipped, 1);
  assert.deepEqual(preview.errors.map((item) => item.reason), ['missingAmountOrDate']);
});

test('legacy CSV wrapper rejects only non-text input at its boundary', () => {
  const result = parseLegacyExpenseCsv(Buffer.from('a,b'));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'LEGACY_CSV_INVALID_INPUT');
});
