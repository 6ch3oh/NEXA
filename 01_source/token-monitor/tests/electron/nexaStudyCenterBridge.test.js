'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  NEXA_STUDY_CENTER_DESCRIPTOR,
  STUDY_CENTER_CHANNELS,
  createNexaStudyCenterController,
  createNexaStudyCenterIpcHandlers,
  createUnavailableNexaStudyCenterPublicApi,
  validateStudyCenterPublicApi
} = require('../../src/electron/nexaStudyCenterBridge');

function createPublicApi(application) {
  return {
    STUDY_CENTER_DESKTOP_APPLICATION_VERSION: '0.1.0',
    STUDY_CENTER_MODULE_ID: 'study-center',
    STUDY_CENTER_ROUTE_ID: 'study-center',
    STUDY_CENTER_PRODUCT_NAME: '学习中心',
    HOME_LEARNING_SUMMARY_CONTRACT_VERSION: '0.1.0',
    createHomeLearningSummaryAdapter: () => ({ getHomeSummary() {} }),
    validateHomeLearningSummary: (value) => value,
    STUDY_CENTER_DESKTOP_CONTRACT: {
      contractVersion: '0.1.0',
      moduleId: 'study-center',
      routeId: 'study-center',
      productName: '学习中心',
      runtime: 'DESKTOP_MANAGED_LOOPBACK',
      host: '127.0.0.1',
      runtimeNetworkDependency: 0,
      singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER',
      methods: ['start', 'stop', 'getReadiness', 'getHomeSummary', 'getPronunciationAudio', 'updateStudyPlan']
    },
    createStudyCenterDesktopApplication: () => application
  };
}

function createApplication() {
  let ready = false;
  return {
    async start() { ready = true; return this.getReadiness(); },
    async stop() { ready = false; },
    getReadiness() {
      return {
        applicationVersion: '0.1.0', state: ready ? 'READY' : 'STOPPED',
        code: ready ? 'READY' : 'STOPPED', ready,
        endpoint: ready ? { host: '127.0.0.1', port: 4316, url: 'http://127.0.0.1:4316/', owned: true } : null,
        runtimeNetworkDependency: 0, singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER'
      };
    },
    async getHomeSummary() {
      return {
        contract_version: '0.1.0',
        cards: [{
          card_id: 'card-1', type: 'vocabulary', title: 'serendipity', core_content: '意外发现美好事物的能力',
          short_explanation: 'a pleasant discovery', example: null,
          source: { collection_id: 'cet6', label: '本地六级词库', classification: 'PERSISTED_LOCAL_LIBRARY' },
          availability: 'available',
          handoff: { route_id: 'study-center', action: 'open-card', entry_id: 'entry-1', card_id: 'card-1' }
        }],
        availability: 'available', empty_state: { is_empty: false, reason: null },
        today_learned: 2, due_review: 3, total_progress: 25,
        progress_current: 25, progress_total: 100,
        updated_at: '2026-08-13T07:00:00.000Z', generated_at: '2026-08-13T08:00:00.000Z',
        freshness: { status: 'observed', updated_at: '2026-08-13T07:00:00.000Z' },
        learning_center_handoff: { route_id: 'study-center', action: 'open-learning-center' }
      };
    },
    async getPronunciationAudio({ word, accent }) {
      return { word, accent, mimeType: 'audio/wav', dataBase64: 'UklGRg==', runtimeNetworkDependency: 0 };
    },
    async updateStudyPlan(plan) { return { plan, source: 'study-center-public-adapter' }; }
  };
}

test('Study Center bridge freezes one module descriptor and validates the public handoff', () => {
  const application = createApplication();
  assert.equal(validateStudyCenterPublicApi(createPublicApi(application)).STUDY_CENTER_PRODUCT_NAME, '学习中心');
  assert.deepEqual(NEXA_STUDY_CENTER_DESCRIPTOR, {
    moduleId: 'study-center', contractVersion: 1,
    invokeChannels: Object.values(STUDY_CENTER_CHANNELS), pushChannels: []
  });
});

test('Study Center controller delegates lifecycle and exposes only cloneable readiness', async () => {
  const application = createApplication();
  let homeOptions = null;
  const getHomeSummary = application.getHomeSummary.bind(application);
  application.getHomeSummary = async (options) => {
    homeOptions = options;
    return getHomeSummary();
  };
  const controller = createNexaStudyCenterController({
    publicApi: createPublicApi(application),
    application,
    dataRoot: path.join(process.cwd(), 'tmp', 'study-center-controller')
  });
  const started = await controller.start();
  assert.equal(started.ready, true);
  const readiness = await controller.execute({ operation: 'get-readiness' });
  assert.equal(readiness.endpoint.url, 'http://127.0.0.1:4316/');
  readiness.endpoint.url = 'mutated';
  assert.equal((await controller.execute({ operation: 'get-readiness' })).endpoint.url, 'http://127.0.0.1:4316/');
  const summary = await controller.execute({ operation: 'get-home-summary' });
  assert.equal(summary.cards[0].title, 'serendipity');
  assert.throws(() => {
    summary.cards[0].title = 'mutated';
  }, TypeError);
  assert.equal((await controller.execute({ operation: 'get-home-summary' })).cards[0].title, 'serendipity');
  await controller.execute({ operation: 'get-home-summary', cursor: 4, limit: 2 });
  assert.deepEqual(homeOptions, { cursor: 4, limit: 2 });
  await assert.rejects(() => controller.execute({ operation: 'get-home-summary', cursor: -1 }), {
    code: 'INVALID_STUDY_CENTER_COMMAND'
  });
  await controller.stop();
  assert.equal(application.getReadiness().ready, false);
});

test('Study Center IPC starts on demand, returns readiness, and stops the sole owner', async () => {
  const application = createApplication();
  const controller = createNexaStudyCenterController({ publicApi: createPublicApi(application), application });
  const control = {
    startModule: () => controller.start(),
    stopModule: () => controller.stop(),
    executeModule: (_moduleId, command) => controller.execute(command)
  };
  const handlers = createNexaStudyCenterIpcHandlers(control);
  assert.equal((await handlers[STUDY_CENTER_CHANNELS.start]()).value.ready, true);
  assert.equal((await handlers[STUDY_CENTER_CHANNELS.getReadiness]()).value.singleWriterScope, 'PROCESS_LOCAL_SINGLE_WRITER');
  assert.equal((await handlers[STUDY_CENTER_CHANNELS.getHomeSummary]()).value.contract_version, '0.1.0');
  assert.equal((await handlers[STUDY_CENTER_CHANNELS.pronounce](null, 'serendipity', 'us')).value.mimeType, 'audio/wav');
  assert.deepEqual(await handlers[STUDY_CENTER_CHANNELS.stop](), { ok: true });
});

test('Study Center IPC retries one route-exit stop race before reading the Home summary', async () => {
  const application = createApplication();
  const controller = createNexaStudyCenterController({ publicApi: createPublicApi(application), application });
  let starts = 0;
  let executes = 0;
  const control = {
    async startModule() {
      starts += 1;
      // Model the module-control coalescing window: the first start request
      // observes the just-finished route stop and therefore has not started the app.
      if (starts > 1) await controller.start();
    },
    stopModule: () => controller.stop(),
    executeModule(_moduleId, command) {
      executes += 1;
      return controller.execute(command);
    }
  };
  const handlers = createNexaStudyCenterIpcHandlers(control);

  const result = await handlers[STUDY_CENTER_CHANNELS.getHomeSummary]();

  assert.equal(result.ok, true);
  assert.equal(result.value.cards[0].title, 'serendipity');
  assert.equal(starts, 2);
  assert.equal(executes, 2);
});

test('Study Center IPC retries one transient stop-incomplete startup race', async () => {
  const application = createApplication();
  const controller = createNexaStudyCenterController({ publicApi: createPublicApi(application), application });
  let starts = 0;
  let executes = 0;
  const control = {
    async startModule() {
      starts += 1;
      if (starts === 1) throw Object.assign(new Error('route teardown'), { code: 'STOP_INCOMPLETE' });
      await controller.start();
    },
    stopModule: () => controller.stop(),
    executeModule(_moduleId, command) {
      executes += 1;
      return controller.execute(command);
    }
  };
  const handlers = createNexaStudyCenterIpcHandlers(control);

  const result = await handlers[STUDY_CENTER_CHANNELS.getHomeSummary]();

  assert.equal(result.ok, true);
  assert.equal(result.value.cards[0].title, 'serendipity');
  assert.equal(starts, 2);
  assert.equal(executes, 1);
});

test('public runtime fallback preserves the Study Center contract and fails soft when module dependencies are absent', async () => {
  const publicApi = createUnavailableNexaStudyCenterPublicApi();
  assert.equal(validateStudyCenterPublicApi(publicApi).STUDY_CENTER_PRODUCT_NAME, '学习中心');

  const controller = createNexaStudyCenterController({ publicApi });
  await assert.rejects(
    controller.start(),
    (error) => error?.code === 'STUDY_CENTER_DEPENDENCY_UNAVAILABLE'
  );

  const control = {
    startModule: () => controller.start(),
    stopModule: () => controller.stop(),
    executeModule: (_moduleId, command) => controller.execute(command)
  };
  const handlers = createNexaStudyCenterIpcHandlers(control);
  const readiness = await handlers[STUDY_CENTER_CHANNELS.getReadiness]();
  assert.deepEqual(readiness, {
    ok: false,
    error: {
      code: 'STUDY_CENTER_DEPENDENCY_UNAVAILABLE',
      message: 'Study Center host request failed'
    }
  });
  assert.equal(JSON.stringify(readiness).includes('ts-fsrs'), false);
});
