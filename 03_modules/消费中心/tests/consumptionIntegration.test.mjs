import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_FIELDS,
  CONSUMPTION_PUBLIC_API_VERSION,
  EXPENSE_SOURCE_KINDS,
  FUTURE_SOURCE_ADAPTER_BOUNDARIES,
  calculateExpenseStatistics,
  createExpenseCandidateIngestionService,
  createConsumptionHomeWidgetAdapter,
  createExpenseDetailStatisticsService,
  createExpenseExportService,
  createExpenseImportService,
  createExpenseQueryService,
  createExpenseSourceCandidate,
  createInMemoryExpenseRepository,
  createRecentTransactionsViewModel,
} from '../src/index.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

function projectCanonical(records) {
  return records.map((record) => Object.fromEntries(CANONICAL_FIELDS.map((field) => [field, record[field]])));
}

function candidate(sourceKind, sourceId, occurredAt, amountCents, direction, category, merchant, extra = {}) {
  return {
    source: { sourceKind, sourceId },
    occurredAt,
    amountCents,
    direction,
    category,
    merchant,
    createdAt: FIXED_NOW,
    ...extra,
  };
}

test('Public API V0.3 is curated and hides legacy/codec/internal mapping helpers', async () => {
  const api = await import('../src/index.mjs');
  assert.equal(CONSUMPTION_PUBLIC_API_VERSION, '0.3');
  for (const forbidden of [
    'legacyToDomainDocument', 'domainToLegacyDocument', 'decodeLegacyExpenseJson',
    'encodeLegacyExpenseJson', 'expenseCandidateToDomainInput', 'normalizeWriteInput',
  ]) {
    assert.equal(forbidden in api, false, forbidden);
  }
  for (const required of [
    'normalizeExpenseRecord', 'createInMemoryExpenseRepository', 'createJsonFileExpenseRepository',
    'createExpenseQueryService', 'calculateExpenseStatistics', 'createRecentTransactionsViewModel',
    'createExpenseDetailStatisticsService', 'createExpenseSourceCandidate',
    'createConsumptionHomeWidgetAdapter',
    'createExpenseCandidateIngestionService', 'createExpenseImportService', 'createExpenseExportService',
  ]) {
    assert.equal(typeof api[required], 'function', required);
  }
});

test('Home Widget Adapter is available from Public API V0.3 without adding write capability', () => {
  const repository = createInMemoryExpenseRepository();
  const query = createExpenseQueryService(repository);
  const widget = createConsumptionHomeWidgetAdapter(query, {
    now: () => new Date('2026-08-10T08:00:00+08:00'),
  });
  assert.deepEqual(widget.getSummary(), {
    ok: true,
    value: {
      period: { startDate: '2026-08-01', endDate: '2026-08-10' },
      totalExpenseCents: 0,
      todayExpenseCents: 0,
      recentTransactions: [],
      topCategory: null,
      freshness: {
        asOfDate: '2026-08-10',
        latestOccurredAt: null,
        status: 'empty',
      },
    },
  });
  assert.deepEqual(Object.keys(widget), ['getSummary']);
});

test('synthetic module chain composes candidate through export/import without core contract regression', () => {
  const repositoryA = createInMemoryExpenseRepository();
  const ingestion = createExpenseCandidateIngestionService(repositoryA);

  const wechat = ingestion.ingestExpenseCandidate(candidate(
    'wechat', 'wx-seal-001', '2026-08-10', 1200, 'expense', 'food', 'Synthetic Alpha',
    {
      classification: {
        category: 'food', source: 'manual', method: 'manual_selection', confirmed: true,
        confidenceReference: 'confidence-seal-1', provenance: { test: 'synthetic' },
      },
      confidence: { value: 1, source: 'manual', reasonCode: 'USER_CONFIRMED', confirmed: true },
    },
  ));
  const alipay = ingestion.ingestExpenseCandidate(candidate(
    'alipay', 'ali-seal-001', '2026-08-02', 3000, 'expense', 'travel', 'Synthetic Beta',
  ));
  const bank = ingestion.ingestExpenseCandidate(candidate(
    'bank', 'bank-seal-001', '2026-08-03', -5000, 'income', 'salary', 'Synthetic Employer',
  ));
  const android = ingestion.ingestAndroidExpenseCandidate({
    source: { sourceId: 'android-seal-001', platform: 'wechat' },
    occurredAt: '2026-09-01', amountCents: 800, direction: 'expense', category: 'food',
    merchant: 'Synthetic Gamma', createdAt: FIXED_NOW,
  });

  for (const result of [wechat, alipay, bank, android]) assert.equal(result.accepted, true);
  assert.equal(wechat.metadata.classification.category, 'food');
  assert.equal(wechat.metadata.confidence.value, 1);
  assert.equal(android.metadata.source.sourceKind, 'android_notification');

  const queryA = createExpenseQueryService(repositoryA);
  const allA = queryA.query({ sortOrder: 'asc' });
  assert.equal(allA.length, 4);
  const statistics = calculateExpenseStatistics(allA);
  assert.deepEqual(statistics.totals, {
    count: 4, totalExpenseCents: 5000, totalIncomeCents: 5000, netCents: 0,
  });

  const recent = createRecentTransactionsViewModel(queryA).getRecentTransactions({ limit: 2 });
  assert.deepEqual(recent.map((row) => row.occurredAt), ['2026-09-01', '2026-08-10']);

  const detail = createExpenseDetailStatisticsService(queryA).getDetailStatistics({
    startDate: '2026-08-01', endDate: '2026-08-31',
  });
  assert.deepEqual(detail.totals, {
    count: 3, totalExpenseCents: 4200, totalIncomeCents: 5000, netCents: 800,
  });
  assert.equal(detail.categoryBreakdown.length, 3);
  assert.equal(detail.dailySeries.length, 3);

  const exported = createExpenseExportService({ repository: repositoryA, queryService: queryA })
    .exportAll({ now: fixedNow });
  assert.equal(exported.ok, true);
  assert.equal(exported.exportedCount, 4);
  for (const record of exported.document.records) {
    assert.equal('classification' in record, false);
    assert.equal('confidence' in record, false);
  }

  const repositoryB = createInMemoryExpenseRepository();
  const imported = createExpenseImportService(repositoryB).importLegacyJson(exported.jsonText, { now: fixedNow });
  assert.deepEqual(
    { ok: imported.ok, imported: imported.importedCount, rejected: imported.rejectedCount, duplicates: imported.duplicateCount },
    { ok: true, imported: 4, rejected: 0, duplicates: 0 },
  );
  const allB = createExpenseQueryService(repositoryB).query({ sortOrder: 'asc' });
  assert.deepEqual(projectCanonical(allB), projectCanonical(allA));
});

test('Android structured input is accepted through Public API without an Android parser', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseCandidateIngestionService(repository);
  const result = service.ingestAndroidExpenseCandidate({
    source: { sourceId: 'notification-public-001', platform: 'bank' },
    occurredAt: '2026-08-10', amountCents: 660, direction: 'expense',
    category: 'transport', merchant: 'Synthetic Transit', createdAt: FIXED_NOW,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.record.platform, 'bank');
  assert.equal(result.metadata.source.sourceKind, 'android_notification');
});

test('payment source boundaries are READY contracts with no concrete parser', () => {
  for (const kind of ['wechat', 'alipay', 'bank']) {
    assert.ok(EXPENSE_SOURCE_KINDS.includes(kind));
    const structured = createExpenseSourceCandidate(candidate(
      kind, `${kind}-boundary-001`, '2026-08-10', 100, 'expense', 'other', 'Synthetic Boundary',
    ));
    assert.equal(structured.source.sourceKind, kind);
    const boundary = FUTURE_SOURCE_ADAPTER_BOUNDARIES.find((entry) => entry.sourceKind === kind);
    assert.equal(boundary.consumptionCenterInput, 'ExpenseSourceCandidate');
    assert.equal(boundary.parserImplemented, false);
  }
});
