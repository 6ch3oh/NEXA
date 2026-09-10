'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MARKET_CHANNELS,
  MARKET_DESKTOP_BRIDGE_VERSION,
  MARKET_RENDERER_METHODS,
  NEXA_MARKET_DESCRIPTOR,
  createNexaMarketController,
  createNexaMarketIpcHandlers,
  projectMarketReadiness
} = require('../../src/electron/nexaMarketBridge');

function readyStatus(overrides = {}) {
  return {
    bridge_version: MARKET_DESKTOP_BRIDGE_VERSION,
    lifecycle: 'READY',
    warnings: [],
    network_capability: { authorized: false, available: false },
    ...overrides
  };
}

function fakeClientFactory(instances, requestLog) {
  return (options) => {
    const instance = {
      options,
      opened: null,
      stopped: false,
      async open(initialization) { this.opened = initialization; },
      async request(method, params) {
        requestLog.push({ method, params });
        if (method === 'start' || method === 'get_module_status') return readyStatus();
        return { method, params };
      },
      async shutdown() { this.stopped = true; return { shutdown: true, disposed: true }; },
      getDiagnostics() { return { state: this.stopped ? 'stopped' : 'running', pid: 43100, pendingCount: 0 }; }
    };
    instances.push(instance);
    return instance;
  };
}

test('Market descriptor exposes only renderer-safe allowlisted IPC channels', () => {
  assert.equal(NEXA_MARKET_DESCRIPTOR.moduleId, 'market');
  assert.deepEqual(NEXA_MARKET_DESCRIPTOR.invokeChannels, Object.values(MARKET_CHANNELS));
  assert.deepEqual(Object.values(MARKET_RENDERER_METHODS), [
    'get_module_status', 'get_desktop_snapshot', 'get_route_manifest', 'set_navigation_state',
    'get_market_home', 'get_watchlist', 'get_portfolio', 'get_instrument_detail',
    'get_research_center', 'get_decision_journal', 'list_evidence', 'explain_term',
    'refresh_local_projection', 'execute_action'
  ]);
});

test('controller maps start, DTO requests, shutdown, and restart to fresh Python clients', async () => {
  const instances = [];
  const requests = [];
  const controller = createNexaMarketController({
    pythonExecutable: 'python',
    moduleRoot: 'E:/market',
    dataRoot: 'E:/data/market',
    timezone: 'Asia/Shanghai',
    runtimeMode: 'EMPTY',
    clientFactory: fakeClientFactory(instances, requests)
  });

  const started = await controller.start();
  assert.equal(started.readiness.state, 'READY');
  assert.deepEqual(instances[0].opened, {
    data_root: 'E:/data/market',
    timezone: 'Asia/Shanghai',
    runtime_mode: 'EMPTY',
    network_refresh_enabled: false
  });
  assert.equal(instances[0].options.pythonExecutable, 'python');
  assert.equal(instances[0].options.moduleRoot, 'E:/market');
  assert.deepEqual(await controller.execute({
    method: 'get_watchlist', params: { search: 'NEXA' }
  }), { method: 'get_watchlist', params: { search: 'NEXA' } });
  await controller.stop();
  assert.equal(instances[0].stopped, true);
  assert.equal(controller.getSnapshot().readiness.state, 'OFFLINE');
  await controller.start();
  assert.equal(instances.length, 2);
  assert.notEqual(instances[0], instances[1]);
  await controller.stop();
});

test('readiness is a pure projection through nexaModuleReadiness product states', () => {
  assert.deepEqual(projectMarketReadiness(readyStatus(), 'running'), { state: 'READY' });
  assert.deepEqual(projectMarketReadiness(readyStatus({ warnings: ['LOCAL_CACHE_STALE'] }), 'running'), {
    state: 'LIMITED', code: 'LOCAL_CACHE_STALE'
  });
  assert.deepEqual(projectMarketReadiness({ lifecycle: 'STOPPED' }, 'running'), {
    state: 'OFFLINE', code: 'MARKET_STOPPED'
  });
  assert.deepEqual(projectMarketReadiness(null, 'error'), {
    state: 'ERROR', code: 'MARKET_TRANSPORT_ERROR'
  });
});

test('IPC facade starts Market and forwards only method/params envelopes', async () => {
  const calls = [];
  const control = {
    async startModule(moduleId) { calls.push(['start', moduleId]); },
    async executeModule(moduleId, command) {
      calls.push(['execute', moduleId, command]);
      return { forwarded: command };
    }
  };
  const handlers = createNexaMarketIpcHandlers(control);
  const result = await handlers[MARKET_CHANNELS.executeAction]({}, {
    action: 'ADD_WATCHLIST', payload: { instrument_id: 'TEST' }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['start', 'market'],
    ['execute', 'market', {
      method: 'execute_action',
      params: { action: 'ADD_WATCHLIST', payload: { instrument_id: 'TEST' } }
    }]
  ]);
});
