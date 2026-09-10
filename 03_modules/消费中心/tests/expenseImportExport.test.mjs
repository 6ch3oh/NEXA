import test from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryExpenseRepository } from '../src/repositories/inMemoryExpenseRepository.mjs';
import { createExpenseImportService } from '../src/import-export/expenseImportService.mjs';
import { createExpenseExportService } from '../src/import-export/expenseExportService.mjs';
import { decodeLegacyExpenseJson } from '../src/storage/legacyExpenseJsonCodec.mjs';

const FIXED_NOW = '2026-08-10T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

const VALID = {
  id: 'legacy-import-1', source: 'WeChat', transactionTime: '2026-08-10', amount: 25.8,
  opposite: 'Synthetic Coffee', tradeId: 'wx-import-001', category: 'food', createdAt: FIXED_NOW,
};
const DUPLICATE = { ...VALID, id: 'legacy-import-duplicate', merchant: 'ignored duplicate' };
const INVALID = { source: 'wechat', occurredAt: '2026-08-10', amountCents: 0 };
const DOCUMENT_TEXT = JSON.stringify({ version: 1, records: [VALID, DUPLICATE, INVALID] });

test('legacy import reuses Codec/Adapter and reports imported, duplicate, and rejected counts', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseImportService(repository);
  const result = service.importLegacyJson(DOCUMENT_TEXT, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.deepEqual(
    { imported: result.importedCount, updated: result.updatedCount, duplicates: result.duplicateCount, rejected: result.rejectedCount },
    { imported: 1, updated: 0, duplicates: 1, rejected: 1 },
  );
  assert.equal(repository.list().length, 1);
  assert.equal(repository.list()[0].dedupeKey, 'src:wechat:wx-import-001');
});

test('import against an existing Repository reports deterministic update/duplicate counts', () => {
  const repository = createInMemoryExpenseRepository();
  const service = createExpenseImportService(repository);
  service.importLegacyJson(DOCUMENT_TEXT, { now: fixedNow });
  const second = service.importLegacyJson(DOCUMENT_TEXT, { now: fixedNow });
  assert.equal(second.importedCount, 0);
  assert.equal(second.updatedCount, 1);
  assert.equal(second.duplicateCount, 2);
  assert.equal(second.rejectedCount, 1);
  assert.equal(repository.list().length, 1);
});

test('invalid legacy JSON returns a stable decode error without Repository writes', () => {
  const repository = createInMemoryExpenseRepository();
  const result = createExpenseImportService(repository).importLegacyJson('{broken');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_JSON');
  assert.deepEqual(repository.list(), []);
});

test('export all produces legacy-compatible JSON that decodes to canonical records', () => {
  const repository = createInMemoryExpenseRepository([VALID]);
  const result = createExpenseExportService({ repository }).exportAll({ now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.exportedCount, 1);
  const decoded = decodeLegacyExpenseJson(result.jsonText, { now: fixedNow });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.domainRecords[0].id, 'legacy-import-1');
  assert.equal(decoded.domainRecords[0].amountCents, 2580);
  assert.equal(decoded.domainRecords[0].occurredAt, '2026-08-10');
  assert.equal(decoded.domainRecords[0].dedupeKey, 'src:wechat:wx-import-001');
});

test('filtered export reuses Query Service instead of storage implementation', () => {
  const repository = createInMemoryExpenseRepository([
    VALID,
    { id: 'legacy-import-2', platform: 'bank', occurredAt: '2026-08-02', amountCents: -5000, direction: 'income', category: 'salary', merchant: 'Employer', createdAt: FIXED_NOW },
  ]);
  const result = createExpenseExportService({ repository }).exportFiltered({ category: 'food' }, { now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.exportedCount, 1);
  const decoded = decodeLegacyExpenseJson(result.jsonText, { now: fixedNow });
  assert.equal(decoded.domainRecords[0].category, 'food');
});

test('legacy import then export round-trip preserves core canonical fields', () => {
  const repository = createInMemoryExpenseRepository();
  const importer = createExpenseImportService(repository);
  const exporter = createExpenseExportService({ repository });
  assert.equal(importer.importLegacyJson(JSON.stringify({ version: 1, records: [VALID] }), { now: fixedNow }).ok, true);
  const exported = exporter.exportAll({ now: fixedNow });
  const decoded = decodeLegacyExpenseJson(exported.jsonText, { now: fixedNow });
  const record = decoded.domainRecords[0];
  assert.deepEqual(
    { id: record.id, platform: record.platform, sourceId: record.sourceId, occurredAt: record.occurredAt, amountCents: record.amountCents, direction: record.direction, category: record.category },
    { id: 'legacy-import-1', platform: 'wechat', sourceId: 'wx-import-001', occurredAt: '2026-08-10', amountCents: 2580, direction: 'expense', category: 'food' },
  );
});

test('Import/Export modules expose no file discovery or direct filesystem API', async () => {
  const importModule = await import('../src/import-export/expenseImportService.mjs');
  const exportModule = await import('../src/import-export/expenseExportService.mjs');
  assert.deepEqual(Object.keys(importModule).sort(), ['EXPENSE_IMPORT_SERVICE_VERSION', 'createExpenseImportService'].sort());
  assert.deepEqual(Object.keys(exportModule).sort(), ['EXPENSE_EXPORT_SERVICE_VERSION', 'createExpenseExportService'].sort());
});
