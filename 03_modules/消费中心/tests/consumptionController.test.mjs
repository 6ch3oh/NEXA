import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONSUMPTION_CONTROLLER_COMMANDS,
  createConsumptionController,
} from '../src/core-integration/consumptionController.mjs';
import { createInMemoryExpenseRepository } from '../src/index.mjs';

function candidate(overrides = {}) {
  return {
    source: { sourceKind: 'wechat', sourceId: 'core-controller-1' },
    occurredAt: '2026-08-11',
    amountCents: 1280,
    merchant: '合成咖啡店',
    direction: 'expense',
    category: 'food',
    ...overrides,
  };
}

function mobileDraft(platform, marker) {
  const sourceReference = marker.repeat(64);
  return {
    draftId: `mobile:${sourceReference}`,
    sourceReference,
    receivedAt: '2026-09-04T08:00:00.000Z',
    occurredAt: '2026-09-04',
    amountCents: 1280,
    currency: 'CNY',
    merchant: `${platform} synthetic merchant`,
    direction: 'expense',
    category: 'other',
    platform,
    sourceApplication: `synthetic.${platform}`,
    confidence: 0.92,
    parserVersion: 'test-1.0',
  };
}

test('Controller exposes exactly four hooks and a static command list', () => {
  const controller = createConsumptionController({ repository: createInMemoryExpenseRepository() });
  assert.deepEqual(Object.keys(controller).sort(), ['execute', 'getSnapshot', 'start', 'stop']);
  assert.deepEqual(CONSUMPTION_CONTROLLER_COMMANDS, [
    'query', 'recent', 'statistics', 'ingest-candidate', 'import-legacy', 'export-legacy',
    'list-mobile-drafts', 'create-mobile-draft', 'auto-import-mobile-draft',
    'auto-import-pending-mobile-drafts', 'update-mobile-draft',
    'confirm-mobile-draft', 'ignore-mobile-draft', 'merge-mobile-drafts', 'undo-mobile-draft',
    'remove-record', 'reclassify-record', 'ai-suggest', 'ai-query-filter',
  ]);
  assert.equal(Object.isFrozen(controller), true);
});

test('Controller lifecycle is safe and snapshot contains no expense records or paths', async () => {
  const controller = createConsumptionController({ repository: createInMemoryExpenseRepository() });
  await assert.rejects(() => controller.execute({ type: 'query' }), (error) => error.code === 'CONTROLLER_NOT_RUNNING');
  await controller.start();
  await controller.start();
  const running = controller.getSnapshot();
  assert.equal(running.moduleId, 'consumption');
  assert.equal(running.lifecycle, 'running');
  assert.equal(running.publicApiVersion, '0.3');
  assert.equal(running.availability.ready, true);
  assert.equal(Object.hasOwn(running, 'records'), false);
  assert.equal(JSON.stringify(running).includes('E:\\'), false);
  running.capabilityIdentifiers.push('tamper');
  assert.equal(controller.getSnapshot().capabilityIdentifiers.includes('tamper'), false);
  await controller.stop();
  await controller.stop();
  assert.equal(controller.getSnapshot().availability.ready, false);
});

test('Controller static commands cover ingestion, query, recent, and statistics', async () => {
  const controller = createConsumptionController({ repository: createInMemoryExpenseRepository() });
  await controller.start();
  const ingested = await controller.execute({
    type: 'ingest-candidate',
    payload: { candidate: candidate() },
  });
  assert.equal(ingested.accepted, true);
  const queried = await controller.execute({ type: 'query', payload: { options: {} } });
  const recent = await controller.execute({ type: 'recent', payload: { options: { limit: 1 } } });
  const statistics = await controller.execute({ type: 'statistics', payload: { filters: {} } });
  assert.equal(queried.length, 1);
  assert.equal(recent.length, 1);
  assert.equal(statistics.totals.totalExpenseCents, 1280);
});

test('natural-language expense request returns a deterministic fixture list and total', async () => {
  const provider = {
    getState() { return { model_id: 'qwen3-4b-instruct-2507' }; },
    async generateProposal(input) {
      assert.equal(input.request, '把我这个月吃饭的花销列出来。');
      return { startDate: '2026-09-01', endDate: '2026-09-30', category: '餐饮', direction: 'expense' };
    },
  };
  const controller = createConsumptionController({
    repository: createInMemoryExpenseRepository(),
    localAiProvider: provider,
    now: () => '2026-09-05T08:00:00.000Z',
  });
  await controller.start();
  await controller.execute({ type: 'ingest-candidate', payload: { candidate: candidate({ source: { sourceKind: 'wechat', sourceId: 'food-1' }, occurredAt: '2026-09-02', amountCents: 2350, category: '餐饮', merchant: '美团外卖' }) } });
  await controller.execute({ type: 'ingest-candidate', payload: { candidate: candidate({ source: { sourceKind: 'alipay', sourceId: 'food-2' }, occurredAt: '2026-09-04', amountCents: 1680, category: '餐饮', merchant: '便利店' }) } });
  await controller.execute({ type: 'ingest-candidate', payload: { candidate: candidate({ source: { sourceKind: 'bank', sourceId: 'travel-1' }, occurredAt: '2026-09-03', amountCents: 5000, category: '交通', merchant: '铁路' }) } });

  const result = await controller.execute({ type: 'ai-query-filter', payload: { request: '把我这个月吃饭的花销列出来。' } });
  assert.deepEqual(result.filters, { startDate: '2026-09-01', endDate: '2026-09-30', category: '餐饮', direction: 'expense' });
  assert.deepEqual(result.records.map((record) => record.sourceId), ['food-2', 'food-1']);
  assert.deepEqual(result.totals, { count: 2, totalExpenseCents: 4030, totalIncomeCents: 0, netCents: -4030 });
  assert.equal(result.result_source, 'deterministic');
});

test('Controller static commands cover explicit legacy export and import', async () => {
  const controller = createConsumptionController({ repository: createInMemoryExpenseRepository() });
  await controller.start();
  await controller.execute({ type: 'ingest-candidate', payload: { candidate: candidate() } });
  const exported = await controller.execute({ type: 'export-legacy', payload: { mode: 'all' } });
  assert.equal(exported.ok, true);
  assert.equal(exported.exportedCount, 1);
  const imported = await controller.execute({
    type: 'import-legacy',
    payload: { jsonText: exported.jsonText },
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.updatedCount, 1);
  await assert.rejects(
    () => controller.execute({ type: 'not-registered', payload: {} }),
    (error) => error.code === 'UNKNOWN_COMMAND',
  );
});

test('Controller commands auto-import, migrate pending drafts, and terminally remove one record', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-consumption-controller-'));
  const repository = createInMemoryExpenseRepository();
  const controller = createConsumptionController({
    repository,
    mobileDraftFilePath: path.join(directory, 'mobile-drafts.json'),
    now: () => '2026-09-04T08:30:00.000Z',
  });
  try {
    await controller.start();
    const automatic = await controller.execute({
      type: 'auto-import-mobile-draft',
      payload: { draft: mobileDraft('alipay', 'b') },
    });
    assert.equal(automatic.imported, true);
    assert.equal(automatic.draft.importMode, 'automatic');

    await controller.execute({
      type: 'create-mobile-draft',
      payload: { draft: mobileDraft('bank', 'c') },
    });
    const migration = await controller.execute({
      type: 'auto-import-pending-mobile-drafts',
      payload: {},
    });
    assert.deepEqual(
      { attempted: migration.attempted, imported: migration.imported, failed: migration.failed },
      { attempted: 1, imported: 1, failed: 0 },
    );
    assert.equal(repository.list().length, 2);

    const removed = await controller.execute({
      type: 'remove-record',
      payload: { recordId: automatic.record.id },
    });
    assert.equal(removed.removed, true);
    assert.equal(repository.list().length, 1);
    const drafts = await controller.execute({ type: 'list-mobile-drafts', payload: {} });
    const removedDraft = drafts.find((draft) => draft.draftId === automatic.draft.draftId);
    assert.equal(removedDraft.status, 'REMOVED');
    await assert.rejects(
      () => controller.execute({
        type: 'undo-mobile-draft',
        payload: { draftId: removedDraft.draftId },
      }),
      (error) => error.code === 'MOBILE_DRAFT_REMOVED',
    );
  } finally {
    await controller.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
