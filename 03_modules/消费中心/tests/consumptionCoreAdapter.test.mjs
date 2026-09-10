import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createConsumptionCoreAdapter,
  getConsumptionPublicApiInfo,
} from '../src/core-integration/consumptionCoreAdapter.mjs';
import { createInMemoryExpenseRepository } from '../src/index.mjs';

test('Core Adapter production source depends only on Public API V0.3', () => {
  const source = fs.readFileSync(
    new URL('../src/core-integration/consumptionCoreAdapter.mjs', import.meta.url),
    'utf8',
  );
  const staticImports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.deepEqual(staticImports, ['../index.mjs']);
  assert.doesNotMatch(source, /src\/legacy|legacyParserCandidateAdapter|\.\.\/domain|\.\.\/repositories|\.\.\/queries|\.\.\/statistics/);
  assert.deepEqual(getConsumptionPublicApiInfo(), { version: '0.3', exportCount: 36, entry: 'src/index.mjs' });
});

test('Core Adapter requires explicit Repository injection and never locates files', () => {
  assert.throws(
    () => createConsumptionCoreAdapter(),
    (error) => error.code === 'MISSING_REPOSITORY',
  );
  const source = fs.readFileSync(
    new URL('../src/core-integration/consumptionCoreAdapter.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /node:fs|AppData|userData|readdir|glob|expense-records\.json/);
});

test('Core Adapter preserves stable Public API error and result behavior', () => {
  const adapter = createConsumptionCoreAdapter({ repository: createInMemoryExpenseRepository() });
  const rejected = adapter.ingestCandidate({});
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.errors[0].code, 'INVALID_DATA_SOURCE');
  assert.throws(
    () => adapter.exportLegacy({ mode: 'dynamic' }),
    (error) => error.code === 'INVALID_EXPORT_MODE',
  );
});

test('Core Adapter reclassifies only the category through the repository writer', () => {
  const repository = createInMemoryExpenseRepository([{ id: 'expense-1', platform: 'alipay', occurredAt: '2026-09-06', amountCents: 1200, merchant: '食堂', category: '其他' }]);
  const adapter = createConsumptionCoreAdapter({ repository });
  const result = adapter.reclassifyRecord('expense-1', '餐饮');
  assert.equal(result.changed, true);
  assert.equal(result.category, '餐饮');
  assert.equal(repository.getById('expense-1').record.amountCents, 1200);
});
