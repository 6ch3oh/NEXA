import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createConsumptionController } from '../src/core-integration/consumptionController.mjs';
import {
  CONSUMPTION_INTEGRATION_MANIFEST,
  CONSUMPTION_INTEGRATION_PACKAGE_ENTRY,
  CONSUMPTION_PUBLIC_API_ENTRY,
} from '../src/core-integration/consumptionIntegrationManifest.mjs';
import { createConsumptionIpcHandlers } from '../src/core-integration/consumptionIpcContract.mjs';
import { CONSUMPTION_MODULE_DESCRIPTOR } from '../src/core-integration/consumptionModuleDescriptor.mjs';
import { createInMemoryExpenseRepository } from '../src/index.mjs';

const require = createRequire(import.meta.url);
const CORE_ROOT = fileURLToPath(new URL('../../../01_source/token-monitor/', import.meta.url));
const { createNexaControllerBinding } = require(path.join(CORE_ROOT, 'src/shared/nexaControllerBinding.js'));
const { createNexaModuleRegistry } = require(path.join(CORE_ROOT, 'src/shared/nexaModuleRegistry.js'));
const { createNexaShellHost } = require(path.join(CORE_ROOT, 'src/shared/nexaShellHost.js'));
const { createNexaEsmPublicApiLoader } = require(path.join(CORE_ROOT, 'src/electron/nexaEsmPublicApiLoader.js'));

test('real Core Loader loads the canonical exact Public API entry as native ESM', async () => {
  assert.equal(path.isAbsolute(CONSUMPTION_PUBLIC_API_ENTRY), true);
  assert.equal(path.extname(CONSUMPTION_PUBLIC_API_ENTRY), '.mjs');
  const loader = createNexaEsmPublicApiLoader({
    allowedEntrypoints: [CONSUMPTION_PUBLIC_API_ENTRY],
  });
  assert.deepEqual(loader.listAllowedEntrypoints(), [path.normalize(path.resolve(CONSUMPTION_PUBLIC_API_ENTRY))]);
  const namespace = await loader.load(CONSUMPTION_PUBLIC_API_ENTRY);
  assert.equal(Object.prototype.toString.call(namespace), '[object Module]');
  assert.equal(namespace.CONSUMPTION_PUBLIC_API_VERSION, '0.3');
  assert.equal(Object.keys(namespace).length, 36);
  for (const requiredExport of [
    'createExpenseQueryService',
    'createRecentTransactionsViewModel',
    'createExpenseDetailStatisticsService',
    'createConsumptionHomeWidgetAdapter',
    'createExpenseCandidateIngestionService',
    'createExpenseImportService',
    'createExpenseExportService',
  ]) {
    assert.equal(typeof namespace[requiredExport], 'function');
  }
});

test('Integration Manifest is frozen and contains no private parser dependency', () => {
  assert.equal(Object.isFrozen(CONSUMPTION_INTEGRATION_MANIFEST), true);
  assert.equal(CONSUMPTION_INTEGRATION_MANIFEST.moduleId, 'consumption');
  assert.equal(CONSUMPTION_INTEGRATION_MANIFEST.publicApi.version, '0.3');
  assert.equal(CONSUMPTION_INTEGRATION_MANIFEST.publicApi.exportCount, 36);
  assert.equal(CONSUMPTION_INTEGRATION_MANIFEST.packageEntry, CONSUMPTION_INTEGRATION_PACKAGE_ENTRY);
  assert.equal(path.isAbsolute(CONSUMPTION_INTEGRATION_PACKAGE_ENTRY), true);
  assert.deepEqual(CONSUMPTION_INTEGRATION_MANIFEST.rendererSurface.methods, ['getSnapshot', 'execute']);
  assert.doesNotMatch(JSON.stringify(CONSUMPTION_INTEGRATION_MANIFEST), /src\\legacy|src\/legacy|legacyParserCandidateAdapter/);
});

test('real Core Loader obtains the complete Integration Package from one exact entry', async () => {
  const loader = createNexaEsmPublicApiLoader({
    allowedEntrypoints: [CONSUMPTION_INTEGRATION_PACKAGE_ENTRY],
  });
  const namespace = await loader.load(CONSUMPTION_INTEGRATION_PACKAGE_ENTRY);
  assert.equal(typeof namespace.createConsumptionController, 'function');
  assert.equal(typeof namespace.createConsumptionIpcHandlers, 'function');
  assert.equal(namespace.CONSUMPTION_MODULE_DESCRIPTOR.moduleId, 'consumption');
  assert.strictEqual(namespace.CONSUMPTION_INTEGRATION_MANIFEST, CONSUMPTION_INTEGRATION_MANIFEST);
});

test('real Core Registry, Binding, Shell Host and IPC surface execute Consumption end to end', async () => {
  const repository = createInMemoryExpenseRepository();
  const registry = createNexaModuleRegistry([CONSUMPTION_MODULE_DESCRIPTOR], { reservedChannels: [] });
  const binding = createNexaControllerBinding(registry, {
    consumption: () => createConsumptionController({ repository }),
  });
  const host = createNexaShellHost(binding);
  await host.startModule('consumption');

  const handlers = createConsumptionIpcHandlers(host);
  const ingested = await handlers['nexa:consumption:execute']({}, {
    type: 'ingest-candidate',
    payload: {
      candidate: {
        source: { sourceKind: 'wechat', sourceId: 'core-integration-1' },
        occurredAt: '2026-08-11',
        amountCents: 660,
        merchant: '合成商户',
        direction: 'expense',
        category: 'other',
      },
    },
  });
  const queried = await handlers['nexa:consumption:execute']({}, {
    type: 'query',
    payload: { options: {} },
  });
  const snapshot = await handlers['nexa:consumption:get-snapshot']({});
  assert.equal(ingested.ok, true);
  assert.equal(ingested.value.accepted, true);
  assert.equal(queried.ok, true);
  assert.equal(queried.value.length, 1);
  assert.equal(snapshot.value.moduleId, 'consumption');
  assert.equal(JSON.stringify(snapshot).includes('合成商户'), false);
  await host.stopAll();
});
