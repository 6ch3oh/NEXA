'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const { createNexaControllerBinding } = require('../../src/shared/nexaControllerBinding');
const { createNexaModuleRegistry } = require('../../src/shared/nexaModuleRegistry');
const { createNexaShellHost } = require('../../src/shared/nexaShellHost');

const {
  CREATOR_OPS_CHANNELS,
  CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
  CREATOR_OPS_HOME_WIDGET_WINDOWS,
  NEXA_CREATOR_OPS_DESCRIPTOR,
  NexaCreatorOpsBridgeError,
  createNexaCreatorOpsController,
  createNexaCreatorOpsIpcHandlers,
  projectCreatorOpsHomeSummary,
  projectCreatorOpsReadiness,
  validateHomeSummaryRequest,
  validateCreatorOpsPublicApi
} = require('../../src/electron/nexaCreatorOpsBridge');

const NEXA_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const MODULE_ROOT = path.join(NEXA_ROOT, '03_modules', '自媒体运营');
const PUBLIC_ENTRY = path.join(MODULE_ROOT, 'src', 'index.mjs');
const MANIFEST = path.join(MODULE_ROOT, 'creator-ops.integration.json');

function readiness(state, generation = 0) {
  const ready = state === 'READY';
  return Object.freeze({
    contractVersion: '1.0', state, ready,
    errorCode: state === 'ERROR' ? 'HOST_PROCESS_EXITED' : null,
    message: `private message E:\\private\\${state}`,
    endpoint: ready ? Object.freeze({
      host: '127.0.0.1', port: 8765, url: 'http://127.0.0.1:8765/'
    }) : null,
    runtimeInstanceCount: ready ? 1 : 0,
    generation,
    secret: 'must-not-cross'
  });
}

function fakeApplication() {
  let state = 'CREATED';
  let generation = 0;
  const calls = [];
  return Object.freeze({
    calls,
    async start() {
      calls.push('start');
      state = 'READY';
      generation += 1;
      return readiness(state, generation);
    },
    async stop() {
      calls.push('stop');
      state = 'STOPPED';
      return readiness(state, generation);
    },
    getReadiness() { calls.push('getReadiness'); return readiness(state, generation); },
    getSnapshot() { calls.push('getSnapshot'); return readiness(state, generation); },
    execute(command) {
      calls.push(`execute:${command?.type}`);
      return readiness(state, generation);
    }
  });
}

function performance(overrides = {}) {
  const totals = {
    views: 150, impressions: 180, likes: 5, comments: 1,
    favorites: 2, shares: 1, followers_delta: 0
  };
  const observed = Object.fromEntries(Object.keys(totals).map((field) => [field, 2]));
  return {
    empty: false,
    empty_reason: null,
    snapshot_count: 2,
    represented_publish_count: 2,
    latest_observed_at: '2026-08-23T11:00:00Z',
    aggregation_semantics: 'LATEST_SNAPSHOT_PER_PUBLISH_RECORD',
    totals,
    observed_counts: observed,
    engagement_average: 0.15,
    engagement_observed_count: 2,
    latest: [{
      metrics_id: 'metric-a', publish_record_id: 'publish-a', content_id: 'content-a',
      account_id: 'account-a1', collected_at: '2026-08-23T11:00:00Z',
      views: 100, impressions: 120, likes: 5, comments: 1,
      favorites: 2, shares: 1, followers_delta: 1, engagement: 0.1,
      privatePath: 'E:\\private\\creator.sqlite3'
    }],
    ...overrides
  };
}

const WINDOW_SECONDS = Object.freeze({
  '1h': 3_600, '5h': 18_000, '1d': 86_400, '3d': 259_200, '1w': 604_800
});

function selectedWindow(id = '1d') {
  const end = '2026-08-23T12:00:00Z';
  return {
    id,
    duration_seconds: WINDOW_SECONDS[id],
    start_at: new Date(Date.parse(end) - WINDOW_SECONDS[id] * 1000).toISOString(),
    end_at: end,
    semantics: 'EVIDENCE_GATED_SNAPSHOT_WINDOW'
  };
}

function accountSummary(overrides = {}) {
  const base = {
    account_id: 'account-a1', account_name: 'A1 Widget', source_account_name: 'a1-source',
    platform: 'local-test', icon_key: 'generic', status: 'ACTIVE',
    availability: 'AVAILABLE', availability_label: '数据可用',
    latest_snapshot: {
      views: 150, likes: 5, plays: null, followers_or_new: 0,
      followers_or_new_semantics: 'RECORDED_DELTA', observed_at: '2026-08-23T11:00:00Z',
      availability: 'AVAILABLE', plays_reason: 'UNSUPPORTED_SOURCE_FIELD',
      privatePath: 'E:\\private\\latest.json'
    },
    delta: {
      views: 30, likes: -2, plays: null, followers_or_new: null,
      from_at: '2026-08-22T12:00:00.000Z', to_at: '2026-08-23T12:00:00Z',
      covered_publish_count: 1, observed_publish_count: 1, total_publish_count: 2,
      availability: 'AVAILABLE', availability_label: '数据可用',
      rawMetricPath: 'E:\\private\\delta.json'
    },
    freshness: { latest_metric_at: '2026-08-23T11:00:00Z', age_seconds: 3600 },
    handoff: { route_id: 'creator-ops', target: 'account', account_id: 'account-a1', secret: 'private' },
    privatePath: 'E:\\private\\account.json'
  };
  return {
    ...base,
    ...overrides,
    latest_snapshot: { ...base.latest_snapshot, ...overrides.latest_snapshot },
    delta: { ...base.delta, ...overrides.delta },
    freshness: { ...base.freshness, ...overrides.freshness },
    handoff: { ...base.handoff, ...overrides.handoff }
  };
}

function homeSummary(overrides = {}) {
  const window = overrides.selected_window ?? selectedWindow();
  return {
    contract_version: '0.2.0',
    module_id: 'creator-ops',
    generated_at: '2026-08-23T12:00:00Z',
    data_classification: 'PRODUCTION',
    availability: { status: 'AVAILABLE', label: '数据可用' },
    selected_window: window,
    time_window: {
      days: window.duration_seconds / 86_400, start_at: window.start_at, end_at: window.end_at
    },
    empty_state: { is_empty: false, reason: null },
    account_summaries: [accountSummary()],
    account_matrix: [{
      account_id: 'account-a1', legacy_account_code: 'A1', platform: 'local-test',
      display_name: 'A1 Widget', content_direction: '测试方向', status: 'ACTIVE',
      workload: {
        active_content_count: 2, ready_to_publish_count: 1, blocked_count: 0,
        published_recently: 2, metrics_pending: 0, review_pending: 1
      },
      published_in_window: 2,
      performance: performance()
    }],
    performance: performance(),
    recent_activity: [{
      event_type: 'METRICS_RECORDED', entity_id: 'metric-a', content_id: 'content-a',
      occurred_at: '2026-08-23T11:00:00Z', summary: '记录最新表现', privatePath: 'E:\\private'
    }],
    freshness: { latest_observed_at: '2026-08-23T11:00:00Z', age_seconds: 3600 },
    safety: { write_capability: 'NONE' },
    ...overrides
  };
}

async function publicApi() {
  return import(pathToFileURL(PUBLIC_ENTRY).href);
}

function listenLoopback(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(server); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function availableLoopbackPort(excludedPorts = new Set()) {
  while (true) {
    const server = await listenLoopback();
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await closeServer(server);
    if (port > 0 && !excludedPorts.has(port)) return port;
  }
}

test('validates the frozen Creator Ops public entry, API, UI host contract, and manifest', async () => {
  const entry = await publicApi();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  assert.strictEqual(validateCreatorOpsPublicApi(entry), entry);
  assert.equal(entry.CREATOR_OPS_AUTHORITATIVE_PUBLIC_ENTRYPOINT, 'src/index.mjs');
  assert.equal(entry.CREATOR_OPS_PUBLIC_API_VERSION, '0.2');
  assert.equal(entry.CREATOR_OPS_UI_HOST_CONTRACT_VERSION, '1.0');
  assert.equal(entry.CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION, '0.2.0');
  assert.equal(CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION, '0.2.0');
  assert.deepEqual(entry.CREATOR_OPS_HOME_WIDGET_WINDOWS, ['1h', '5h', '1d', '3d', '1w']);
  assert.deepEqual(CREATOR_OPS_HOME_WIDGET_WINDOWS, ['1h', '5h', '1d', '3d', '1w']);
  assert.deepEqual(entry.CREATOR_OPS_INTEGRATION_MANIFEST.homeWidget, {
    contractVersion: '0.2.0', factory: 'createCreatorOpsHomeWidgetAdapter',
    operation: 'getHomeSummary', mode: 'READ_ONLY', preferredSlot: 'activity',
    defaultWindowDays: 30, supportedWindows: ['1h', '5h', '1d', '3d', '1w'],
    writeCapability: 'NONE'
  });
  assert.equal(entry.CREATOR_OPS_INTEGRATION_MANIFEST.moduleId, 'creator-ops');
  assert.equal(entry.CREATOR_OPS_INTEGRATION_MANIFEST.applicationFactory,
    'creator_ops.create_creator_ops_application');
  assert.deepEqual(JSON.parse(JSON.stringify(entry.CREATOR_OPS_INTEGRATION_MANIFEST)), manifest);
  assert.equal(NEXA_CREATOR_OPS_DESCRIPTOR.moduleId, 'creator-ops');
  assert.deepEqual(NEXA_CREATOR_OPS_DESCRIPTOR.invokeChannels, Object.values(CREATOR_OPS_CHANNELS));
});

test('requires a valid loopback endpoint only while READY and suppresses retained STOPPED metadata', () => {
  const projected = projectCreatorOpsReadiness(readiness('READY', 4));
  assert.deepEqual(projected, {
    contractVersion: '1.0', state: 'READY', ready: true, errorCode: null,
    message: 'Creator Ops UI host is ready',
    endpoint: { host: '127.0.0.1', port: 8765, url: 'http://127.0.0.1:8765/' },
    runtimeInstanceCount: 1, generation: 4
  });
  assert.equal(JSON.stringify(projected).includes('private'), false);
  assert.equal(JSON.stringify(projected).includes('must-not-cross'), false);
  assert.throws(
    () => projectCreatorOpsReadiness({ ...readiness('READY', 1), endpoint: null }),
    (error) => error instanceof NexaCreatorOpsBridgeError &&
      error.code === 'INVALID_CREATOR_OPS_READINESS'
  );
  assert.throws(
    () => projectCreatorOpsReadiness({
      ...readiness('READY', 1),
      endpoint: { host: '0.0.0.0', port: 8765, url: 'http://0.0.0.0:8765/' }
    }),
    (error) => error instanceof NexaCreatorOpsBridgeError && error.code === 'INVALID_CREATOR_OPS_ENDPOINT'
  );

  const stopped = projectCreatorOpsReadiness({
    ...readiness('STOPPED', 4),
    endpoint: readiness('READY', 4).endpoint
  });
  assert.deepEqual(stopped, {
    contractVersion: '1.0', state: 'STOPPED', ready: false, errorCode: null,
    message: 'Creator Ops UI host is not ready', endpoint: null,
    runtimeInstanceCount: 0, generation: 4
  });
});

test('real Creator Ops lifecycle completes controller and Shell Host cleanup with retained metadata', async (t) => {
  const entry = await publicApi();
  const occupiedServer = await listenLoopback();
  const occupiedAddress = occupiedServer.address();
  const occupiedPort = typeof occupiedAddress === 'object' && occupiedAddress ? occupiedAddress.port : 0;
  t.after(async () => { await closeServer(occupiedServer); });

  const port = await availableLoopbackPort(new Set([occupiedPort, 8765]));
  const application = entry.createCreatorOpsUIHost({ port });
  t.after(async () => { await application.stop(); });

  const registry = createNexaModuleRegistry(
    [NEXA_CREATOR_OPS_DESCRIPTOR],
    Object.freeze({ reservedChannels: Object.freeze([]) })
  );
  const binding = createNexaControllerBinding(registry, {
    'creator-ops': () => createNexaCreatorOpsController({ application })
  });
  const host = createNexaShellHost(binding);

  const started = await host.startModule('creator-ops');
  assert.equal(started.state, 'READY');
  assert.equal(started.ready, true);
  assert.equal(started.runtimeInstanceCount, 1);
  assert.notEqual(port, occupiedPort);
  assert.notEqual(port, 8765);
  assert.deepEqual(started.endpoint, {
    host: '127.0.0.1', port, url: `http://127.0.0.1:${port}/`
  });

  const firstGeneration = started.generation;

  await host.stopAll();
  const rawStopped = application.getSnapshot();
  assert.equal(rawStopped.state, 'STOPPED');
  assert.equal(rawStopped.ready, false);
  assert.equal(rawStopped.runtimeInstanceCount, 0);
  assert.notEqual(rawStopped.endpoint, null);

  const projectedStopped = host.getModuleSnapshot('creator-ops');
  assert.equal(projectedStopped.state, 'STOPPED');
  assert.equal(projectedStopped.ready, false);
  assert.equal(projectedStopped.runtimeInstanceCount, 0);
  assert.equal(projectedStopped.endpoint, null);

  const restarted = await host.startModule('creator-ops');
  assert.equal(restarted.state, 'READY');
  assert.equal(restarted.ready, true);
  assert.equal(restarted.runtimeInstanceCount, 1);
  assert.equal(restarted.endpoint.port, port);
  assert.ok(restarted.generation > firstGeneration);

  await host.stopAll();
  await host.stopAll();
});

test('real Core-to-Creator Works handoff persists identity and keeps boot move permission off', async (t) => {
  const entry = await publicApi();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-creator-works-'));
  const selected = path.join(scratch, 'selected-image.jpg');
  fs.writeFileSync(selected, Buffer.from('selected-media-fixture'));
  const folder = path.join(scratch, 'multi-work');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, '001.jpg'), Buffer.from('first'));
  fs.writeFileSync(path.join(folder, '002.jpg'), Buffer.from('second'));
  const port = await availableLoopbackPort(new Set([8765]));
  const previousEnvironment = {
    database: process.env.CREATOR_OPS_DATABASE,
    managed: process.env.CREATOR_OPS_WORKS_MANAGED_ROOT,
    cache: process.env.CREATOR_OPS_WORKS_CACHE_ROOT
  };
  process.env.CREATOR_OPS_DATABASE = path.join(scratch, 'creator-works.sqlite3');
  process.env.CREATOR_OPS_WORKS_MANAGED_ROOT = path.join(scratch, 'managed');
  process.env.CREATOR_OPS_WORKS_CACHE_ROOT = path.join(scratch, 'cache');
  const application = entry.createCreatorOpsUIHost({ port });
  t.after(async () => {
    await application.stop();
    for (const [name, value] of [
      ['CREATOR_OPS_DATABASE', previousEnvironment.database],
      ['CREATOR_OPS_WORKS_MANAGED_ROOT', previousEnvironment.managed],
      ['CREATOR_OPS_WORKS_CACHE_ROOT', previousEnvironment.cache]
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  await application.start();
  const intake = await application.execute({
    type: 'WORKS_COMMAND', command: { operation: 'intake', resources: [
      { kind: 'file', absolute_path: selected },
      { kind: 'directory', absolute_path: folder }
    ] }
  });
  assert.equal(intake.items.length, 2);
  assert.equal(intake.items[1].source_kind, 'FOLDER');
  assert.equal(intake.items[1].media.length, 2);
  assert.equal(fs.readFileSync(selected, 'utf8'), 'selected-media-fixture', 'intake copied or rewrote source media');
  const workId = intake.items[0].work_id;
  const mediaId = intake.items[0].media[0].media_id;
  await application.execute({
    type: 'WORKS_COMMAND', command: { operation: 'portfolio', work_id: workId, included: true }
  });
  await application.execute({
    type: 'WORKS_COMMAND', command: { operation: 'move_permission', enabled: true }
  });
  const moved = await application.execute({
    type: 'WORKS_COMMAND', command: {
      operation: 'move_managed', work_id: workId, explicit_user_intent: true
    }
  });
  assert.equal(moved.media[0].media_id, mediaId);
  assert.equal(moved.media[0].location_state, 'MANAGED');
  assert.equal(fs.existsSync(selected), false);
  assert.equal(fs.readFileSync(moved.media[0].absolute_path, 'utf8'), 'selected-media-fixture');
  await application.stop();
  await application.start();
  const detail = await application.execute({
    type: 'WORKS_QUERY', request: { operation: 'detail', work_id: workId }
  });
  assert.equal(detail.work.work_id, workId);
  assert.equal(detail.work.media[0].media_id, mediaId);
  assert.equal(detail.work.portfolio, true);
  assert.equal(detail.capabilities.move_permission, false);
  assert.equal(detail.capabilities.boot_default_off, true);
});

test('reuses createCreatorOpsUIHost lifecycle through the existing NEXA controller', async () => {
  const application = fakeApplication();
  const controller = createNexaCreatorOpsController({ application });

  assert.equal(controller.getSnapshot().state, 'CREATED');
  const first = await controller.start();
  const repeated = await controller.start();
  assert.equal(first.ready, true);
  assert.strictEqual(repeated, first);
  assert.equal(application.calls.filter((value) => value === 'start').length, 1);
  assert.equal((await controller.execute({ type: 'GET_READINESS' })).state, 'READY');
  await controller.stop();
  assert.equal(controller.getSnapshot().state, 'STOPPED');
  const restarted = await controller.start();
  assert.equal(restarted.generation, 2);
  await controller.stop();
});

test('IPC facade starts, reads, opens and stops the module with failure isolation', async () => {
  const application = fakeApplication();
  const controller = createNexaCreatorOpsController({ application });
  const opened = [];
  const control = {
    startModule(moduleId) { assert.equal(moduleId, 'creator-ops'); return controller.start(); },
    stopModule(moduleId) { assert.equal(moduleId, 'creator-ops'); return controller.stop(); },
    getModuleSnapshot(moduleId) { assert.equal(moduleId, 'creator-ops'); return controller.getSnapshot(); }
  };
  const homeRequests = [];
  const handlers = createNexaCreatorOpsIpcHandlers(control, {
    openEndpoint: async (url) => opened.push(url),
    homeWidgetAdapter: Object.freeze({
      async getHomeSummary(input) {
        homeRequests.push(input);
        return homeSummary({ selected_window: selectedWindow(input.window) });
      }
    })
  });

  assert.equal((await handlers[CREATOR_OPS_CHANNELS.readiness]({})).value.state, 'CREATED');
  assert.equal((await handlers[CREATOR_OPS_CHANNELS.start]({})).value.ready, true);
  const home = await handlers[CREATOR_OPS_CHANNELS.homeSummary]({});
  assert.equal(home.ok, true);
  assert.equal(home.value.performance.totals.views, 150);
  assert.equal(home.value.account_matrix[0].legacy_account_code, 'A1');
  assert.equal(home.value.account_summaries[0].latest_snapshot.plays, null);
  assert.equal(home.value.selected_window.id, '1d');
  assert.deepEqual(homeRequests, [{ window: '1d' }]);
  assert.equal(Object.hasOwn(home.value.recent_activity[0], 'privatePath'), false);
  assert.equal((await handlers[CREATOR_OPS_CHANNELS.open]({})).ok, true);
  assert.deepEqual(opened, ['http://127.0.0.1:8765/']);
  assert.equal((await handlers[CREATOR_OPS_CHANNELS.stop]({})).value.state, 'STOPPED');

  const failed = createNexaCreatorOpsIpcHandlers(control, {
    openEndpoint: async () => { throw Object.assign(new Error('private failure'), { code: 'OPEN_FAILED' }); }
  });
  const response = await failed[CREATOR_OPS_CHANNELS.open]({});
  assert.deepEqual(response, {
    ok: false,
    error: { code: 'OPEN_FAILED', message: 'Creator Ops request failed' }
  });
  assert.equal(Object.hasOwn(response.error, 'stack'), false);
  await controller.stop();
});

test('Home IPC accepts only the five named windows and forwards one frozen field', async () => {
  const adapterInputs = [];
  const handlers = createNexaCreatorOpsIpcHandlers({
    async startModule(moduleId) { assert.equal(moduleId, 'creator-ops'); },
    async stopModule() {},
    getModuleSnapshot() { return readiness('READY', 1); }
  }, {
    homeWidgetAdapter: Object.freeze({
      async getHomeSummary(input) {
        adapterInputs.push(input);
        return homeSummary({ selected_window: selectedWindow(input.window) });
      }
    })
  });

  assert.deepEqual(validateHomeSummaryRequest(undefined), { window: '1d' });
  assert.equal(Object.isFrozen(validateHomeSummaryRequest({ window: '1h' })), true);
  for (const window of CREATOR_OPS_HOME_WIDGET_WINDOWS) {
    const response = await handlers[CREATOR_OPS_CHANNELS.homeSummary]({}, { window });
    assert.equal(response.ok, true);
    assert.equal(response.value.selected_window.id, window);
    assert.equal(response.value.selected_window.duration_seconds, WINDOW_SECONDS[window]);
    assert.equal(response.value.time_window.days, WINDOW_SECONDS[window] / 86_400);
  }
  assert.deepEqual(adapterInputs, CREATOR_OPS_HOME_WIDGET_WINDOWS.map((window) => ({ window })));
  assert.ok(adapterInputs.every(Object.isFrozen));

  for (const invalid of [null, {}, { window: '2h' }, { window: '1d', now: 'private' }, '1d']) {
    const response = await handlers[CREATOR_OPS_CHANNELS.homeSummary]({}, invalid);
    assert.deepEqual(response, {
      ok: false,
      error: { code: 'INVALID_CREATOR_OPS_HOME_WINDOW', message: 'Creator Ops request failed' }
    });
  }
  assert.equal(adapterInputs.length, CREATOR_OPS_HOME_WIDGET_WINDOWS.length);
});

test('Works IPC allowlists path handoffs and rejects malformed or implicit mutations', async () => {
  const application = fakeApplication();
  const controller = createNexaCreatorOpsController({ application });
  const executed = [];
  const control = {
    startModule: () => controller.start(),
    stopModule: () => controller.stop(),
    getModuleSnapshot: () => controller.getSnapshot(),
    executeModule(_moduleId, command) { executed.push(command); return { accepted: true }; }
  };
  const handlers = createNexaCreatorOpsIpcHandlers(control);
  const absolutePath = path.resolve('safe-fixture.jpg');
  const intake = await handlers[CREATOR_OPS_CHANNELS.worksCommand]({}, {
    operation: 'intake', resources: [{ kind: 'file', absolute_path: absolutePath, ignored: 'private' }],
    ignored: 'private'
  });
  assert.equal(intake.ok, true);
  assert.deepEqual(executed.at(-1), {
    type: 'WORKS_COMMAND', command: {
      operation: 'intake', resources: [{ kind: 'file', absolute_path: absolutePath }]
    }
  });
  for (const invalid of [
    { operation: 'intake', resources: [{ kind: 'file', absolute_path: 'relative.jpg' }] },
    { operation: 'portfolio', work_id: 'work-1', included: 'yes' },
    { operation: 'move_permission', enabled: 1 },
    { operation: 'move_managed', work_id: 'work-1', explicit_user_intent: false },
    { operation: 'open_original', media_id: '' },
    { operation: 'configure_potplayer', absolute_path: 'PotPlayerMini64.exe' }
  ]) {
    const response = await handlers[CREATOR_OPS_CHANNELS.worksCommand]({}, invalid);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'INVALID_CREATOR_OPS_WORKS_COMMAND');
  }
  const query = await handlers[CREATOR_OPS_CHANNELS.worksQuery]({}, {
    operation: 'list', view: 'recent', ignored: 'private'
  });
  assert.equal(query.ok, true);
  assert.deepEqual(executed.at(-1), {
    type: 'WORKS_QUERY', request: { operation: 'list', view: 'recent' }
  });
  await controller.stop();
});

test('Home summary projection is frozen, allowlisted, nullable-metric safe, and fail closed', () => {
  const projected = projectCreatorOpsHomeSummary(homeSummary());
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.account_matrix), true);
  assert.equal(Object.isFrozen(projected.account_summaries), true);
  assert.equal(Object.isFrozen(projected.account_summaries[0].latest_snapshot), true);
  assert.equal(Object.isFrozen(projected.account_summaries[0].delta), true);
  assert.equal(Object.isFrozen(projected.account_summaries[0].handoff), true);
  assert.equal(Object.isFrozen(projected.performance.totals), true);
  assert.equal(projected.contract_version, '0.2.0');
  assert.deepEqual(projected.availability, { status: 'AVAILABLE', label: '数据可用' });
  assert.deepEqual(projected.selected_window, selectedWindow('1d'));
  assert.equal(projected.account_summaries[0].latest_snapshot.plays, null);
  assert.equal(projected.account_summaries[0].latest_snapshot.followers_or_new, 0);
  assert.equal(projected.account_summaries[0].delta.likes, -2);
  assert.equal(projected.account_summaries[0].delta.followers_or_new, null);
  assert.deepEqual(projected.account_summaries[0].handoff, {
    route_id: 'creator-ops', target: 'account', account_id: 'account-a1'
  });
  assert.equal(projected.performance.totals.followers_delta, 0);
  assert.equal(Object.hasOwn(projected, 'safety'), false);
  assert.equal(JSON.stringify(projected).includes('private'), false);

  const hourly = projectCreatorOpsHomeSummary(homeSummary({ selected_window: selectedWindow('1h') }));
  assert.equal(hourly.time_window.days, 1 / 24);
  const noMetricsAccount = accountSummary({
    availability: 'NO_METRICS',
    availability_label: '暂无表现数据',
    latest_snapshot: {
      views: null, likes: null, followers_or_new: null, observed_at: null,
      availability: 'NO_METRICS'
    },
    delta: {
      views: null, likes: null, availability: 'NO_METRICS', availability_label: '暂无表现数据'
    },
    freshness: { latest_metric_at: null, age_seconds: null }
  });
  const noMetrics = projectCreatorOpsHomeSummary(homeSummary({
    availability: { status: 'NO_METRICS', label: '暂无表现数据' },
    account_summaries: [noMetricsAccount]
  }));
  assert.equal(noMetrics.account_summaries[0].latest_snapshot.views, null);
  assert.equal(noMetrics.account_summaries[0].delta.views, null);
  assert.equal(noMetrics.account_summaries[0].freshness.age_seconds, null);

  for (const invalid of [
    homeSummary({ contract_version: 'invalid' }),
    homeSummary({ availability: { status: 'AVAILABLE', label: 'private label' } }),
    homeSummary({ selected_window: { ...selectedWindow('1h'), duration_seconds: 1 } }),
    homeSummary({ account_summaries: [accountSummary({ latest_snapshot: { plays: 0 } })] }),
    homeSummary({ account_summaries: [accountSummary({ delta: { followers_or_new: 0 } })] }),
    homeSummary({ account_summaries: [accountSummary({ handoff: { account_id: 'account-other' } })] }),
    homeSummary({ account_summaries: [accountSummary({ icon_key: 'private-icon' })] })
  ]) {
    assert.throws(
      () => projectCreatorOpsHomeSummary(invalid),
      (error) => error instanceof NexaCreatorOpsBridgeError &&
        error.code === 'INVALID_CREATOR_OPS_HOME_SUMMARY'
    );
  }
});

test('preload and Core additions expose no private Creator Ops data path or domain implementation', () => {
  const root = path.join(__dirname, '..', '..', 'src', 'electron');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'nexaCreatorOpsBridge.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'nexaCreatorOpsUiIntegrationHost.js'), 'utf8');
  const creatorNamespace = preload.slice(preload.indexOf("'creator-ops': Object.freeze"),
    preload.indexOf("'today-tomorrow': Object.freeze"));

  for (const channel of Object.values(CREATOR_OPS_CHANNELS)) assert.match(creatorNamespace, new RegExp(channel));
  assert.doesNotMatch(`${bridge}\n${renderer}\n${creatorNamespace}`,
    /sqlite|source_import|repository|core-integration|creator_ops[\\/.](?:domain|state|persistence|services)/i);
  assert.doesNotMatch(renderer, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|iframe|webview/i);
});
