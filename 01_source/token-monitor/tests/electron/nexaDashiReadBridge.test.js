'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NEXA_DASHI_DESCRIPTOR,
  NexaDashiReadBridgeError,
  createNexaDashiReadController,
  createNexaDashiReadIpcHandlers,
  createUnavailableNexaDashiPublicApi
} = require('../../src/electron/nexaDashiReadBridge');

const METHODS = Object.freeze([
  'getSourceHealth',
  'getBoardOverview',
  'listProjects',
  'getProjectDetail',
  'listTasks',
  'getTaskDetail',
  'getTaskExecutionContext'
]);

const DESKTOP_ENTRY_CONTRACT = Object.freeze({
  moduleId: 'dashi',
  handoffVersion: '0.1',
  applicationApiVersion: '0.1',
  dataContractVersion: '0.1',
  authority: 'DASHI_AUTHORITATIVE_BUSINESS_MAINLINE',
  facade: 'STABLE_NEXA_READ_FACADE',
  access: 'READ_ONLY',
  lifecycle: 'LOAD_ON_MODULE_START_READ_ON_DEMAND_RELEASE_ON_MODULE_STOP',
  homepageWidgetRequired: false,
  pushChannels: Object.freeze([]),
  methods: METHODS
});

function createPublicApi(overrides = {}) {
  const calls = [];
  let applicationCreations = 0;
  const application = { version: '0.1' };
  for (const method of METHODS) {
    application[method] = async (...args) => {
      calls.push([method, ...args]);
      return {
        ok: true,
        status: method === 'getSourceHealth' ? 'CONNECTED_STALE' : 'SUCCESS',
        data: { method, args, missing: 'NO_EXPLICIT_RUN_ASSOCIATION' },
        error: null,
        meta: { freshness: 'stale' }
      };
    };
  }
  Object.assign(application, overrides);
  return {
    calls,
    getApplicationCreations: () => applicationCreations,
    publicApi: {
      DASHI_APPLICATION_API_VERSION: '0.1',
      DASHI_DESKTOP_ENTRY_CONTRACT: DESKTOP_ENTRY_CONTRACT,
      createDashiReadApplication: () => {
        applicationCreations += 1;
        return application;
      }
    }
  };
}

test('declares only the seven static read channels', () => {
  assert.deepEqual(NEXA_DASHI_DESCRIPTOR, {
    moduleId: 'dashi',
    contractVersion: 1,
    invokeChannels: [
      'nexa:dashi:get-source-health',
      'nexa:dashi:get-board-overview',
      'nexa:dashi:list-projects',
      'nexa:dashi:get-project-detail',
      'nexa:dashi:list-tasks',
      'nexa:dashi:get-task-detail',
      'nexa:dashi:get-task-execution-context'
    ],
    pushChannels: []
  });
  assert.equal(NEXA_DASHI_DESCRIPTOR.invokeChannels.some((channel) => /write|refresh|run|execute/.test(channel)), false);
});

test('loads the public read application once per lifecycle and delegates without semantic projection', async () => {
  const { publicApi, calls, getApplicationCreations } = createPublicApi();
  const controller = createNexaDashiReadController({ publicApi });

  assert.deepEqual(controller.getSnapshot(), { hostStatus: 'stopped', publicApiVersion: '0.1' });
  assert.deepEqual(await controller.start(), { hostStatus: 'ready', publicApiVersion: '0.1' });
  assert.deepEqual(await controller.start(), { hostStatus: 'ready', publicApiVersion: '0.1' });
  assert.equal(getApplicationCreations(), 1);
  const health = await controller.execute({ operation: 'get-source-health' });
  const tasks = await controller.execute({
    operation: 'list-tasks',
    value: { filter: 'WAITING_ACCEPTANCE', projectId: 'project-1' }
  });
  const context = await controller.execute({ operation: 'get-task-execution-context', value: 'task-1' });

  assert.equal(health.status, 'CONNECTED_STALE');
  assert.equal(health.data.missing, 'NO_EXPLICIT_RUN_ASSOCIATION');
  assert.deepEqual(tasks.data.args, [{ filter: 'WAITING_ACCEPTANCE', projectId: 'project-1' }]);
  assert.deepEqual(calls, [
    ['getSourceHealth'],
    ['listTasks', { filter: 'WAITING_ACCEPTANCE', projectId: 'project-1' }],
    ['getTaskExecutionContext', 'task-1']
  ]);
  assert.equal(context.data.missing, 'NO_EXPLICIT_RUN_ASSOCIATION');
  await controller.stop();
  assert.deepEqual(controller.getSnapshot(), { hostStatus: 'stopped', publicApiVersion: '0.1' });
  assert.deepEqual(await controller.start(), { hostStatus: 'ready', publicApiVersion: '0.1' });
  assert.equal(getApplicationCreations(), 2);
  await controller.stop();
});

test('rejects the legacy application module when the Desktop handoff contract is absent', () => {
  assert.throws(
    () => createNexaDashiReadController({
      publicApi: {
        DASHI_APPLICATION_API_VERSION: '0.1',
        createDashiReadApplication() {}
      }
    }),
    (error) => error instanceof NexaDashiReadBridgeError && error.code === 'INVALID_PUBLIC_API'
  );
});

test('returns reference-isolated public envelopes without changing missing-state values', async () => {
  const resident = {
    ok: true,
    status: 'SUCCESS',
    data: { execution: { state: 'NO_RUN', evidence: 'EVIDENCE_MISSING' } },
    error: null,
    meta: { sourceHealth: 'CONNECTED_STALE' }
  };
  const { publicApi } = createPublicApi({ getTaskExecutionContext: async () => resident });
  const controller = createNexaDashiReadController({ publicApi });
  await controller.start();

  const first = await controller.execute({ operation: 'get-task-execution-context', value: 'task-1' });
  first.data.execution.state = 'ACCEPTED';
  first.meta.sourceHealth = 'CONNECTED_FRESH';
  const second = await controller.execute({ operation: 'get-task-execution-context', value: 'task-1' });

  assert.equal(resident.data.execution.state, 'NO_RUN');
  assert.equal(second.data.execution.state, 'NO_RUN');
  assert.equal(second.data.execution.evidence, 'EVIDENCE_MISSING');
  assert.equal(second.meta.sourceHealth, 'CONNECTED_STALE');
});

test('removes secret-bearing fields and local absolute paths at the Core transport boundary', async () => {
  const secret = 'must-not-cross-dashi-ipc';
  const { publicApi } = createPublicApi({
    getTaskDetail: async () => ({
      ok: true,
      status: 'SUCCESS',
      data: {
        source: {
          instanceId: 'dashi-local:E:\\private\\taskboard.sqlite',
          authority: 'source_import/dashi-taskboard'
        },
        credential: secret,
        nested: { api_key: secret, password: secret }
      },
      error: null,
      meta: { sourceStatus: 'STALE' }
    })
  });
  const controller = createNexaDashiReadController({ publicApi });
  await controller.start();
  const value = await controller.execute({ operation: 'get-task-detail', value: 'task-1' });

  assert.equal(value.data.source.instanceId, 'dashi-local:[LOCAL_PATH]');
  assert.equal(value.data.source.authority, 'source_import/dashi-taskboard');
  assert.equal(Object.hasOwn(value.data, 'credential'), false);
  assert.deepEqual(value.data.nested, {});
  assert.equal(JSON.stringify(value).includes(secret), false);
});

test('separates Core host transport status from Dashi source status', async () => {
  const { publicApi } = createPublicApi();
  const controller = createNexaDashiReadController({ publicApi });
  const control = {
    startModule: () => controller.start(),
    executeModule: (_moduleId, command) => controller.execute(command)
  };
  const handlers = createNexaDashiReadIpcHandlers(control);
  const stale = await handlers['nexa:dashi:get-source-health']({});

  assert.equal(stale.ok, true);
  assert.equal(stale.hostStatus, 'ready');
  assert.equal(stale.value.status, 'CONNECTED_STALE');

  const secret = 'never-cross-host-errors';
  const failedHandlers = createNexaDashiReadIpcHandlers({
    startModule: async () => { throw Object.assign(new Error(secret), { stack: secret, cause: { token: secret } }); },
    executeModule() {}
  });
  const failed = await failedHandlers['nexa:dashi:get-board-overview']({});
  assert.deepEqual(failed, {
    ok: false,
    hostStatus: 'request-failed',
    error: { code: 'DASHI_HOST_REQUEST_FAILED', message: 'Dashi host request failed' }
  });
  assert.equal(JSON.stringify(failed).includes(secret), false);
  assert.equal(Object.hasOwn(failed.error, 'stack'), false);
  assert.equal(Object.hasOwn(failed.error, 'cause'), false);
});

test('fails closed for unsupported public surfaces, commands, and non-serializable results', async () => {
  assert.throws(
    () => createNexaDashiReadController({ publicApi: {} }),
    (error) => error instanceof NexaDashiReadBridgeError && error.code === 'INVALID_PUBLIC_API'
  );
  const { publicApi } = createPublicApi({ getBoardOverview: async () => ({ value: () => {} }) });
  const controller = createNexaDashiReadController({ publicApi });
  await controller.start();
  await assert.rejects(
    controller.execute({ operation: 'write-task', value: {} }),
    (error) => error instanceof NexaDashiReadBridgeError && error.code === 'INVALID_COMMAND'
  );
  await assert.rejects(
    controller.execute({ operation: 'get-board-overview' }),
    (error) => error instanceof NexaDashiReadBridgeError && error.code === 'UNSAFE_PUBLIC_RESULT'
  );
});

test('public runtime fallback preserves the Dashi contract and fails closed without the private source', async () => {
  const publicApi = createUnavailableNexaDashiPublicApi();
  const controller = createNexaDashiReadController({ publicApi });

  assert.equal(publicApi.DASHI_APPLICATION_API_VERSION, '0.1');
  assert.equal(publicApi.DASHI_DESKTOP_ENTRY_CONTRACT.access, 'READ_ONLY');
  assert.deepEqual(publicApi.DASHI_DESKTOP_ENTRY_CONTRACT.methods, METHODS);
  await assert.rejects(
    controller.start(),
    (error) => error instanceof NexaDashiReadBridgeError && error.code === 'DASHI_PUBLIC_API_UNAVAILABLE'
  );

  const handlers = createNexaDashiReadIpcHandlers({
    startModule: () => controller.start(),
    executeModule: (_moduleId, command) => controller.execute(command)
  });
  const value = await handlers['nexa:dashi:get-board-overview']({});
  assert.deepEqual(value, {
    ok: false,
    hostStatus: 'request-failed',
    error: { code: 'DASHI_PUBLIC_API_UNAVAILABLE', message: 'Dashi host request failed' }
  });
});
