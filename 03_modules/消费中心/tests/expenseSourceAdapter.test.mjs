import test from 'node:test';
import assert from 'node:assert/strict';

import { CANONICAL_FIELDS } from '../src/domain/expenseRecord.mjs';

import {
  SOURCE_KINDS,
  assertSupportedSourceKind,
  getSourceSeam,
  isSupportedSourceKind,
  normalizeSourceCandidate,
} from '../src/adapters/expenseSourceAdapter.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

test('SOURCE_KINDS is exactly the confirmed candidate set', () => {
  assert.deepEqual(SOURCE_KINDS, ['android_notification', 'wechat', 'alipay', 'bank']);
});

test('all confirmed source kinds are supported', () => {
  for (const kind of SOURCE_KINDS) {
    assert.equal(isSupportedSourceKind(kind), true, kind);
  }
  assert.equal(isSupportedSourceKind('unknown'), false);
  assert.equal(isSupportedSourceKind('csv'), false);
  assert.equal(isSupportedSourceKind(undefined), false);
});

test('unsupported kinds throw a stable UNSUPPORTED_SOURCE_KIND error', () => {
  assert.throws(
    () => assertSupportedSourceKind('unknown'),
    (error) => error && error.code === 'UNSUPPORTED_SOURCE_KIND',
  );
  assert.throws(
    () => getSourceSeam('unknown'),
    (error) => error && error.code === 'UNSUPPORTED_SOURCE_KIND',
  );
});

test('getSourceSeam returns a parser-free structured-candidate descriptor', () => {
  for (const kind of SOURCE_KINDS) {
    const seam = getSourceSeam(kind);
    assert.equal(seam.kind, kind);
    assert.equal(seam.sourceKind, kind);
    assert.equal(seam.phase, 'structured-candidate-seam');
    assert.deepEqual(seam.capabilities, []);
    // 接缝不得携带任何解析能力（Parser 边界），且已无 parser 注册表。
    assert.equal(typeof seam.parse, 'undefined');
    assert.equal(typeof seam.ocr, 'undefined');
    assert.equal(typeof seam.classify, 'undefined');
  }
});

test('normalizeSourceCandidate normalizes structured candidates for all four source kinds', () => {
  const candidate = {
    source: 'WeChat',
    transactionTime: '2026-08-10',
    amount: 25.8,
    opposite: 'Synthetic Coffee House',
    tradeId: 'wx-txn-20260810-0001',
    description: 'structured candidate via source seam',
  };
  for (const kind of SOURCE_KINDS) {
    const result = normalizeSourceCandidate(kind, candidate, { now: fixedNow });
    assert.equal(result.ok, true, kind);
    assert.equal(result.record.platform, 'wechat');
    assert.equal(result.record.amountCents, 2580);
    assert.equal(result.record.dedupeKey, 'src:wechat:wx-txn-20260810-0001');
    // 来源兼容性元数据只出现在结果上，绝不写入规范记录（不新增第 13 个规范 legacy 字段）。
    assert.equal(result.source.sourceKind, kind);
    assert.equal(result.source.compatible, kind === 'wechat');
    assert.deepEqual(Object.keys(result.record).slice(0, 12), CANONICAL_FIELDS);
    assert.ok(Object.prototype.hasOwnProperty.call(result.record, 'extensions'));
    // 统一领域规范化依旧保留 12 个规范字段 + extensions 兼容元数据。
    assert.equal(Object.keys(result.record).slice(0, 12).length, 12);
  }
});

test('normalizeSourceCandidate delegates unified domain normalization', () => {
  const result = normalizeSourceCandidate('alipay', {
    source: 'Alipay',
    transactionTime: '2026-8-2',
    type: 'income',
    amount: 100,
    tradeId: 'ali-txn-20260802-0001',
    category: 'salary',
  });
  assert.equal(result.ok, true);
  // 别名映射 + income 正金额 → 负整数分（统一 normalizeExpenseRecord 语义）。
  assert.equal(result.record.platform, 'alipay');
  assert.equal(result.record.direction, 'income');
  assert.equal(result.record.amountCents, -10000);
  assert.equal(result.record.category, 'salary');
  assert.equal(result.record.dedupeKey, 'src:alipay:ali-txn-20260802-0001');
  assert.equal(result.source.sourceKind, 'alipay');
  assert.equal(result.source.compatible, true);
});

test('normalizeSourceCandidate rejects unsupported source kinds with stable error', () => {
  for (const kind of ['unknown', 'csv', undefined, null, 42]) {
    const result = normalizeSourceCandidate(kind, { source: 'wechat', amount: 1 });
    assert.equal(result.ok, false, `expected failure for ${String(kind)}`);
    assert.equal(result.error.code, 'UNSUPPORTED_SOURCE_KIND');
    assert.equal(result.record, undefined);
  }
});

test('normalizeSourceCandidate rejects non-structured candidates with stable INVALID_CANDIDATE', () => {
  for (const candidate of ['not-an-object', null, 42, [], 'raw notification text']) {
    const result = normalizeSourceCandidate('wechat', candidate);
    assert.equal(result.ok, false, `expected INVALID_CANDIDATE for ${String(candidate)}`);
    assert.equal(result.error.code, 'INVALID_CANDIDATE');
  }
  // 结构化对象但领域无效 → 委托统一规范化的稳定失败。
  const domainFailure = normalizeSourceCandidate('wechat', { source: 'wechat', amountCents: 0, occurredAt: '2026-08-10' });
  assert.equal(domainFailure.ok, false);
  assert.equal(domainFailure.error.code, 'ZERO_AMOUNT');
});

test('parser boundary: no registerSourceParser and no concrete parsers on the public surface', async () => {
  const mod = await import('../src/adapters/expenseSourceAdapter.mjs');
  // 注册表已彻底移除。
  assert.equal(typeof mod.registerSourceParser, 'undefined');
  assert.ok(!('registerSourceParser' in mod));
  // 公共面恰为确认集合。
  assert.deepEqual(
    Object.keys(mod).sort(),
    ['SOURCE_KINDS', 'assertSupportedSourceKind', 'getSourceSeam', 'isSupportedSourceKind', 'normalizeSourceCandidate'].sort(),
  );
  // 导出的任何函数都不得是具体解析实现（parse/extract/ocr/classify/nlu/nlp/toDraft 均禁止）。
  for (const key of Object.keys(mod)) {
    if (typeof mod[key] === 'function') {
      assert.ok(
        !/^(parse|extract|ocr|classify|nlu|nlp|toDraft)/i.test(key),
        `unexpected parser export: ${key}`,
      );
    }
  }
});
