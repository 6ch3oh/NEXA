import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createConsumptionHomeWidgetAdapter,
  createExpenseQueryService,
  createInMemoryExpenseRepository,
} from '../src/index.mjs';
import {
  completeLegacyRecord,
  incomeLegacyRecord,
  missingOptionalLegacyRecord,
  unknownFieldLegacyRecord,
} from '../fixtures/legacyExpenseRecords.fixture.mjs';

const SEALED_FIXTURE_RECORDS = [
  completeLegacyRecord,
  incomeLegacyRecord,
  missingOptionalLegacyRecord,
  unknownFieldLegacyRecord,
];

function makeWidget(records = SEALED_FIXTURE_RECORDS) {
  const repository = createInMemoryExpenseRepository(records);
  return {
    repository,
    widget: createConsumptionHomeWidgetAdapter(createExpenseQueryService(repository), {
      now: () => new Date('2026-08-10T08:00:00+08:00'),
    }),
  };
}

test('projects existing detail statistics and recent transaction DTOs into the Home contract', () => {
  const { widget } = makeWidget();
  const result = widget.getSummary({ recentLimit: 3 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.period, { startDate: '2026-08-01', endDate: '2026-08-10' });
  assert.equal(result.value.totalExpenseCents, 4804);
  assert.equal(result.value.todayExpenseCents, 2580);
  assert.deepEqual(result.value.recentTransactions.map((row) => row.occurredAt), ['2026-08-10', '2026-08-05', '2026-08-04']);
  assert.deepEqual(result.value.topCategory, {
    key: 'food', count: 1, expenseCents: 2580, incomeCents: 0, netCents: -2580,
  });
  assert.deepEqual(result.value.freshness, {
    asOfDate: '2026-08-10', latestOccurredAt: '2026-08-10', status: 'current',
  });
});

test('uses explicit period and reports historical freshness without inventing records', () => {
  const { widget } = makeWidget();
  const result = widget.getSummary({
    startDate: '2026-08-01',
    endDate: '2026-08-09',
    today: '2026-08-10',
    recentLimit: 5,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.totalExpenseCents, 2224);
  assert.equal(result.value.todayExpenseCents, 0);
  assert.equal(result.value.freshness.latestOccurredAt, '2026-08-05');
  assert.equal(result.value.freshness.status, 'historical');
});

test('is read-only and exposes no business write method', () => {
  const { repository, widget } = makeWidget();
  const before = repository.list();
  const result = widget.getSummary();
  assert.equal(result.ok, true);
  assert.deepEqual(repository.list(), before);
  assert.deepEqual(Object.keys(widget), ['getSummary']);
  for (const forbidden of ['create', 'insert', 'upsert', 'clear', 'execute', 'ingest', 'classify']) {
    assert.equal(forbidden in widget, false);
  }
});

test('localizes query and option errors to a Chinese widget-safe envelope', () => {
  const { widget } = makeWidget();
  assert.deepEqual(widget.getSummary({ startDate: 'invalid' }), {
    ok: false,
    error: { code: 'INVALID_DATE', message: '消费摘要暂不可用' },
  });
  assert.deepEqual(widget.getSummary(null), {
    ok: false,
    error: { code: 'INVALID_WIDGET_OPTIONS', message: '消费摘要暂不可用' },
  });
});

test('empty repositories return a truthful empty summary', () => {
  const { widget } = makeWidget([]);
  const result = widget.getSummary();
  assert.equal(result.ok, true);
  assert.equal(result.value.totalExpenseCents, 0);
  assert.equal(result.value.todayExpenseCents, 0);
  assert.deepEqual(result.value.recentTransactions, []);
  assert.equal(result.value.topCategory, null);
  assert.equal(result.value.freshness.status, 'empty');
});
