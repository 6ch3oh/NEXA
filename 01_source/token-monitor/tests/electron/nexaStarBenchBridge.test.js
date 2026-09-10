'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const {
  NEXA_STARBENCH_DESCRIPTOR,
  STARBENCH_CAPABILITIES,
  STARBENCH_CHANNELS,
  createNexaStarBenchController,
  createNexaStarBenchIpcHandlers,
  validateStarBenchPublicApi
} = require('../../src/electron/nexaStarBenchBridge');

const entrypoint = path.resolve(
  __dirname, '..', '..', '..', '..', '03_modules', 'StarBench', 'src', 'public',
  'starbench-desktop-entry.mjs'
);

test('validates the real StarBench public entry and frozen read-only descriptor', async () => {
  const publicApi = await import(pathToFileURL(entrypoint).href);
  assert.equal(validateStarBenchPublicApi(publicApi), publicApi);
  assert.equal(publicApi.STARBENCH_DESKTOP_RUNTIME_READER_BINDING_VERSION, '0.1.0');
  assert.equal(typeof publicApi.createStarBenchDesktopRuntimeReaderBindings, 'function');
  assert.deepEqual(publicApi.STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.capabilities, STARBENCH_CAPABILITIES);
  assert.equal(publicApi.STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.ownership, 'STARBENCH_INTERNAL_COMPOSITION');
  assert.equal(publicApi.STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.private_store_exposure, false);
  assert.equal(NEXA_STARBENCH_DESCRIPTOR.moduleId, 'starbench');
  assert.deepEqual(NEXA_STARBENCH_DESCRIPTOR.invokeChannels, Object.values(STARBENCH_CHANNELS));
  assert.deepEqual(publicApi.STARBENCH_DESKTOP_CAPABILITIES, STARBENCH_CAPABILITIES);
  assert.deepEqual(publicApi.STARBENCH_DESKTOP_HANDOFF_CONTRACT.execution_capabilities, []);
  assert.equal(publicApi.STARBENCH_DESKTOP_HANDOFF_CONTRACT.navigation.homepage_widget, false);
});

test('controller creates, starts, stops, and recreates one public application per lifecycle', async () => {
  const realPublicApi = await import(pathToFileURL(entrypoint).href);
  let applicationCount = 0;
  const publicApi = {
    ...realPublicApi,
    createStarBenchDesktopApplication(options) {
      applicationCount += 1;
      return realPublicApi.createStarBenchDesktopApplication(options);
    }
  };
  const calls = Object.fromEntries(STARBENCH_CAPABILITIES.map((capability) => [
    capability,
    async () => capability === 'token_cost_observations'
      ? [{ total_tokens: 12, cost: null }]
      : [{ capability }]
  ]));
  const controller = createNexaStarBenchController({ publicApi, readers: calls });

  assert.equal(controller.getSnapshot().hostStatus, 'stopped');
  await controller.start();
  assert.equal(applicationCount, 1);
  assert.equal(controller.getSnapshot().application.status, 'ready');
  for (const capability of STARBENCH_CAPABILITIES) {
    const result = await controller.execute({ operation: 'read', capability, query: { limit: 10 } });
    assert.equal(result.status, 'ready');
    if (capability === 'token_cost_observations') assert.equal(result.items[0].cost, null);
  }
  await controller.stop();
  assert.equal(controller.getSnapshot().hostStatus, 'stopped');
  await controller.start();
  assert.equal(applicationCount, 2);
  assert.equal((await controller.execute({ operation: 'get-readiness' })).lifecycle, 'started');
  await controller.stop();
});

test('controller asks the public 0.1.0 factory to compose six runtime readers from one opaque dataRoot per lifecycle', async (t) => {
  const realPublicApi = await import(pathToFileURL(entrypoint).href);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-starbench-runtime-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const bindingCalls = [];
  const applicationReaders = [];
  const publicApi = {
    ...realPublicApi,
    createStarBenchDesktopRuntimeReaderBindings(options) {
      bindingCalls.push(structuredClone(options));
      return realPublicApi.createStarBenchDesktopRuntimeReaderBindings(options);
    },
    createStarBenchDesktopApplication(options) {
      applicationReaders.push(options.readers);
      return realPublicApi.createStarBenchDesktopApplication(options);
    }
  };
  const controller = createNexaStarBenchController({ publicApi, dataRoot });

  await controller.start();
  assert.deepEqual(bindingCalls, [{ dataRoot }]);
  assert.deepEqual(Object.keys(applicationReaders[0]), STARBENCH_CAPABILITIES);
  for (const capability of ['evaluation_results', 'evaluation_history', 'evidence', 'token_cost_observations']) {
    assert.equal((await controller.execute({ operation: 'read', capability })).status, 'empty');
  }
  assert.equal((await controller.execute({ operation: 'read', capability: 'request_records' })).status, 'unavailable');
  assert.equal((await controller.execute({ operation: 'read', capability: 'external_identity_evidence' })).status, 'unavailable');
  await controller.stop();
  await controller.start();
  assert.deepEqual(bindingCalls, [{ dataRoot }, { dataRoot }]);
  assert.notEqual(applicationReaders[0], applicationReaders[1]);
  await controller.stop();
});

test('public runtime readers remain explicitly unavailable without dataRoot, execution, or fabricated data', async () => {
  const publicApi = await import(pathToFileURL(entrypoint).href);
  const controller = createNexaStarBenchController({ publicApi });
  await controller.start();
  for (const capability of STARBENCH_CAPABILITIES) {
    const result = await controller.execute({ operation: 'read', capability });
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.items, []);
    assert.equal(result.summary.reason_code, 'STARBENCH_RUNTIME_DATA_ROOT_NOT_CONFIGURED');
    assert.equal(result.error, null);
  }
  await controller.stop();
});

test('IPC lifecycle and read handlers isolate host errors behind stable envelopes', async () => {
  const operations = [];
  const control = {
    async startModule(moduleId) { operations.push(['start', moduleId]); },
    async stopModule(moduleId) { operations.push(['stop', moduleId]); },
    async executeModule(moduleId, command) {
      operations.push(['execute', moduleId, command]);
      if (command.capability === 'evidence') throw Object.assign(new Error('private path'), { code: 'PRIVATE_STORE_ERROR' });
      return { status: 'unavailable', items: [] };
    }
  };
  const handlers = createNexaStarBenchIpcHandlers(control);
  assert.equal((await handlers[STARBENCH_CHANNELS.start]()).ok, true);
  assert.equal((await handlers[STARBENCH_CHANNELS.stop]()).ok, true);
  const failure = await handlers[STARBENCH_CHANNELS.read](null, 'evidence', {});
  assert.deepEqual(failure, {
    ok: false,
    error: { code: 'PRIVATE_STORE_ERROR', message: 'StarBench host request failed' }
  });
  assert.equal(JSON.stringify(failure).includes('private path'), false);
  assert.deepEqual(operations[0], ['start', 'starbench']);
  assert.deepEqual(operations.at(-2), ['start', 'starbench']);
});

test('Core bridge uses only the public runtime factory and never imports StarBench private Stores', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'electron', 'nexaStarBenchBridge.js'), 'utf8');
  assert.match(source, /createStarBenchDesktopRuntimeReaderBindings/);
  assert.doesNotMatch(source, /ScoreStore|EvaluationStore|HistoricalUsageStore|RequestLedger|EvidenceStore/);
});

test('controller rejects partial reader injection instead of creating fewer than six public ports', async () => {
  const publicApi = await import(pathToFileURL(entrypoint).href);
  assert.throws(
    () => createNexaStarBenchController({ publicApi, readers: { evaluation_results: async () => [] } }),
    (error) => error.code === 'INVALID_STARBENCH_READER_BINDINGS'
  );
});
