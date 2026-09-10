import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPENSE_SOURCE_KINDS,
  createExpenseDataSource,
} from '../src/contracts/expenseDataSource.mjs';
import {
  createExpenseSourceCandidate,
  expenseCandidateToDomainInput,
} from '../src/contracts/expenseSourceCandidate.mjs';
import {
  FUTURE_SOURCE_ADAPTER_BOUNDARIES,
  FUTURE_SOURCE_ADAPTER_KINDS,
  createExpenseSourceAdapterBoundary,
} from '../src/contracts/expenseSourceAdapterContract.mjs';

const VALID_CANDIDATE = {
  source: { sourceKind: 'wechat', sourceId: 'wx-001', provenance: { channel: 'future-adapter' } },
  occurredAt: '2026-08-10',
  amountCents: 2580,
  merchant: 'Synthetic Coffee',
  direction: 'expense',
  note: 'structured only',
};

test('data source contract supports exactly the formal source kinds', () => {
  assert.deepEqual(EXPENSE_SOURCE_KINDS, ['legacy', 'manual', 'android_notification', 'wechat', 'alipay', 'bank', 'import', 'unknown']);
  for (const sourceKind of EXPENSE_SOURCE_KINDS) {
    const source = createExpenseDataSource({ sourceKind, sourceId: `${sourceKind}-id` });
    assert.equal(source.sourceKind, sourceKind);
    assert.equal(source.platform, sourceKind);
  }
});

test('data source preserves explicit identity, references, provenance, and platform', () => {
  const source = createExpenseDataSource({
    sourceKind: 'android_notification', platform: 'bank', sourceId: 'notification-1',
    externalReference: 'external-1', classificationReference: 'class-1', confidenceReference: 'confidence-1',
    provenance: { device: 'future-android-bridge' },
  });
  assert.deepEqual(source, {
    sourceKind: 'android_notification', platform: 'bank', sourceId: 'notification-1', externalReference: 'external-1',
    classificationReference: 'class-1', confidenceReference: 'confidence-1', provenance: { device: 'future-android-bridge' },
  });
});

test('structured candidate accepts optional classification and confidence metadata', () => {
  const candidate = createExpenseSourceCandidate({
    ...VALID_CANDIDATE,
    confidence: { value: 0.8, source: 'external', reasonCode: 'SOURCE_SUPPLIED', confirmed: false },
    classification: { category: 'food', source: 'external', method: 'external_system', confirmed: false, confidenceReference: 'confidence-1' },
  });
  assert.equal(candidate.classification.category, 'food');
  assert.equal(candidate.confidence.value, 0.8);
  assert.equal(candidate.source.sourceKind, 'wechat');
});

test('candidate is not a Domain record and converts through a minimal Domain input', () => {
  const { candidate, domainInput } = expenseCandidateToDomainInput({
    ...VALID_CANDIDATE,
    classification: { category: 'food', source: 'rule', method: 'deterministic_rule', confirmed: false },
  });
  assert.equal('dedupeKey' in candidate, false);
  assert.equal('extensions' in candidate, false);
  assert.deepEqual(domainInput, {
    platform: 'wechat', sourceId: 'wx-001', occurredAt: '2026-08-10', amountCents: 2580,
    merchant: 'Synthetic Coffee', direction: 'expense', category: 'food', note: 'structured only',
  });
});

test('candidate rejects missing required structural data and source identity', () => {
  assert.throws(() => createExpenseSourceCandidate({ ...VALID_CANDIDATE, occurredAt: '' }), (error) => error?.code === 'MISSING_OCCURRED_AT');
  assert.throws(() => createExpenseSourceCandidate({ ...VALID_CANDIDATE, amountCents: 0 }), (error) => error?.code === 'INVALID_AMOUNT');
  assert.throws(
    () => createExpenseSourceCandidate({ ...VALID_CANDIDATE, source: { sourceKind: 'wechat' } }),
    (error) => error?.code === 'MISSING_SOURCE_IDENTITY',
  );
});

test('candidate rejects an invalid source kind', () => {
  assert.throws(
    () => createExpenseSourceCandidate({ ...VALID_CANDIDATE, source: { sourceKind: 'email', sourceId: 'x' } }),
    (error) => error?.code === 'INVALID_SOURCE_KIND',
  );
});

test('future Android, WeChat, Alipay, and Bank boundaries produce candidates only', () => {
  assert.deepEqual(FUTURE_SOURCE_ADAPTER_KINDS, ['android_notification', 'wechat', 'alipay', 'bank']);
  assert.equal(FUTURE_SOURCE_ADAPTER_BOUNDARIES.length, 4);
  for (const boundary of FUTURE_SOURCE_ADAPTER_BOUNDARIES) {
    assert.equal(boundary.consumptionCenterInput, 'ExpenseSourceCandidate');
    assert.equal(boundary.ingestionApi, 'ingestExpenseCandidate');
    assert.equal(boundary.parserImplemented, false);
  }
  assert.throws(() => createExpenseSourceAdapterBoundary('legacy'), (error) => error?.code === 'INVALID_SOURCE_KIND');
});

test('adapter boundary public surface contains no parser implementation', async () => {
  const mod = await import('../src/contracts/expenseSourceAdapterContract.mjs');
  assert.ok(!Object.keys(mod).some((key) => /^(parse|extract|ocr|classify|nlp|nlu)/i.test(key)));
  assert.ok(!Object.values(mod).some((value) => typeof value === 'function' && /parse|extract|ocr|classify/i.test(value.name)));
});
