import test from 'node:test';
import assert from 'node:assert/strict';

import { CANONICAL_FIELDS } from '../src/domain/expenseRecord.mjs';
import { createInMemoryExpenseRepository } from '../src/repositories/inMemoryExpenseRepository.mjs';
import { createExpenseCandidateIngestionService } from '../src/services/expenseCandidateIngestionService.mjs';

function candidate(sourceKind, sourceId, overrides = {}) {
  return {
    source: { sourceKind, sourceId },
    occurredAt: '2026-08-10', amountCents: 1000, merchant: 'Synthetic Merchant', direction: 'expense',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

test('general ingestion validates candidate, normalizes through Domain, and writes through Repository', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseCandidateIngestionService(repository);
  const result = service.ingestExpenseCandidate(candidate('wechat', 'wx-001'));
  assert.equal(result.accepted, true);
  assert.equal(result.operation, 'insert');
  assert.equal(result.duplicate, false);
  assert.equal(result.record.dedupeKey, 'src:wechat:wx-001');
  assert.deepEqual(Object.keys(result.record).slice(0, 12), CANONICAL_FIELDS);
  assert.equal(repository.list().length, 1);
});

test('repeated candidate reports deterministic duplicate/update status', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseCandidateIngestionService(repository);
  service.ingestExpenseCandidate(candidate('wechat', 'wx-001'));
  const second = service.ingestExpenseCandidate(candidate('wechat', 'wx-001', { merchant: 'Updated Merchant' }));
  assert.equal(second.accepted, true);
  assert.equal(second.operation, 'update');
  assert.equal(second.duplicate, true);
  assert.equal(repository.list().length, 1);
  assert.equal(repository.list()[0].merchant, 'Updated Merchant');
});

test('classification and confidence remain side metadata and do not alter canonical fields', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseCandidateIngestionService(repository);
  const result = service.ingestExpenseCandidate(candidate('alipay', 'ali-001', {
    classification: { category: 'food', source: 'manual', method: 'manual_selection', confirmed: true, confidenceReference: 'conf-1' },
    confidence: { value: 1, source: 'manual', reasonCode: 'USER_CONFIRMED', confirmed: true },
  }));
  assert.equal(result.record.category, 'food');
  assert.equal(result.metadata.classification.category, 'food');
  assert.equal(result.metadata.confidence.value, 1);
  assert.ok(!('classification' in result.record));
  assert.ok(!('confidence' in result.record));
  assert.deepEqual(Object.keys(result.record).slice(0, 12), CANONICAL_FIELDS);
});

test('invalid candidates return stable rejected results without Repository writes', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseCandidateIngestionService(repository);
  const result = service.ingestExpenseCandidate(candidate('wechat', 'wx-001', { amountCents: 0 }));
  assert.equal(result.accepted, false);
  assert.equal(result.errors[0].code, 'INVALID_AMOUNT');
  assert.deepEqual(repository.list(), []);
});

test('Android future structured input enters the same unified ingestion pipeline', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseCandidateIngestionService(repository);
  const result = service.ingestAndroidExpenseCandidate(candidate(undefined, 'notification-001', {
    source: { sourceId: 'notification-001', platform: 'bank' },
  }));
  assert.equal(result.accepted, true);
  assert.equal(result.metadata.source.sourceKind, 'android_notification');
  assert.equal(result.record.platform, 'bank');
  assert.equal(result.record.sourceId, 'notification-001');
});

test('Android interface rejects a conflicting source kind', () => {
  const service = createExpenseCandidateIngestionService(createInMemoryExpenseRepository());
  const result = service.ingestAndroidExpenseCandidate(candidate('wechat', 'wx-001'));
  assert.equal(result.accepted, false);
  assert.equal(result.errors[0].code, 'INVALID_SOURCE_KIND');
});

test('WeChat, Alipay, and Bank structured candidates share one ingestion API', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseCandidateIngestionService(repository);
  for (const kind of ['wechat', 'alipay', 'bank']) {
    const result = service.ingestExpenseCandidate(candidate(kind, `${kind}-001`));
    assert.equal(result.accepted, true, kind);
    assert.equal(result.metadata.source.sourceKind, kind);
  }
  assert.equal(repository.list().length, 3);
});

test('ingestion service requires the sealed Repository Contract', () => {
  assert.throws(() => createExpenseCandidateIngestionService({ list() { return []; } }), /missing required method/);
});
