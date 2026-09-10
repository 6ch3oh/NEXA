'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  NexaEsmPublicApiLoaderError,
  createNexaEsmPublicApiLoader
} = require('../../src/electron/nexaEsmPublicApiLoader');

const CORE_ROOT = path.resolve(__dirname, '..', '..');
const NEXA_ROOT = path.resolve(CORE_ROOT, '..', '..');
const CONSUMPTION_PUBLIC_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '03_modules',
  '消费中心',
  'src',
  'index.mjs'
);
const CONSUMPTION_DEEP_ENTRYPOINT = path.join(
  path.dirname(CONSUMPTION_PUBLIC_ENTRYPOINT),
  'core-integration',
  'consumptionCoreAdapter.mjs'
);
const CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT = path.join(
  path.dirname(CONSUMPTION_PUBLIC_ENTRYPOINT),
  'core-integration',
  'consumptionIntegrationManifest.mjs'
);
const REQUIRED_PUBLIC_FUNCTIONS = Object.freeze([
  'normalizeExpenseRecord',
  'validateExpenseRecord',
  'createInMemoryExpenseRepository',
  'createJsonFileExpenseRepository',
  'createExpenseQueryService',
  'calculateExpenseStatistics',
  'createRecentTransactionsViewModel',
  'createExpenseDetailStatisticsService',
  'createExpenseCandidateIngestionService',
  'createExpenseImportService',
  'createExpenseExportService'
]);

test('Core Loader admits only the Consumer Public API and Integration Package entries', async () => {
  assert.equal(
    fs.existsSync(CONSUMPTION_PUBLIC_ENTRYPOINT),
    true,
    `missing Consumer Public API: ${CONSUMPTION_PUBLIC_ENTRYPOINT}`
  );

  const loader = createNexaEsmPublicApiLoader({
    allowedEntrypoints: [
      CONSUMPTION_PUBLIC_ENTRYPOINT,
      CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT
    ]
  });

  assert.deepEqual(loader.listAllowedEntrypoints(), [
    CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT,
    CONSUMPTION_PUBLIC_ENTRYPOINT
  ]);
  const publicApi = await loader.load(CONSUMPTION_PUBLIC_ENTRYPOINT);
  const integrationPackage = await loader.load(CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT);

  assert.equal(publicApi.CONSUMPTION_PUBLIC_API_VERSION, '0.3');
  for (const exportName of REQUIRED_PUBLIC_FUNCTIONS) {
    assert.equal(typeof publicApi[exportName], 'function', `missing public export: ${exportName}`);
  }
  assert.equal(integrationPackage.CONSUMPTION_MODULE_DESCRIPTOR.moduleId, 'consumption');
  assert.equal(typeof integrationPackage.createConsumptionController, 'function');
  assert.equal(typeof integrationPackage.createConsumptionIpcHandlers, 'function');

  await assert.rejects(
    () => loader.load(CONSUMPTION_DEEP_ENTRYPOINT),
    (error) => (
      error instanceof NexaEsmPublicApiLoaderError
      && error.code === 'ENTRYPOINT_NOT_ALLOWED'
    )
  );
});

test('Consumer readiness uses one static index.mjs boundary without discovery or startup wiring', () => {
  const loaderSource = fs.readFileSync(
    path.join(CORE_ROOT, 'src', 'electron', 'nexaEsmPublicApiLoader.js'),
    'utf8'
  );
  const mainSource = fs.readFileSync(
    path.join(CORE_ROOT, 'src', 'electron', 'main.js'),
    'utf8'
  );

  assert.equal(path.basename(CONSUMPTION_PUBLIC_ENTRYPOINT), 'index.mjs');
  assert.doesNotMatch(loaderSource, /readdir|glob|scan|discover|findModule|loadDirectory/i);
  assert.doesNotMatch(mainSource, /nexaEsmPublicApiLoader|03_modules|消费中心/);
});
