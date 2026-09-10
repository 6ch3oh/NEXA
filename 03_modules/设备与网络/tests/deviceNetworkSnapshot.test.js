'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DeviceNetworkSnapshotAggregator,
  buildHomeFooterViewModel,
  validateAggregateSnapshot,
  validateNetworkMetrics,
  validateSystemMetrics
} = require('../src');
const { loadScenario } = require('../fixtures/scenarios');

function domainParts() {
  const fixture = loadScenario('healthy_device');
  return { system: fixture.system, network: fixture.network };
}

function adapters(overrides = {}) {
  const { system, network } = domainParts();
  return {
    systemAdapter: { collectSystemMetrics: async () => system },
    networkAdapter: { collectNetworkMetrics: async () => network },
    ...overrides
  };
}

function aggregator(overrides = {}) {
  return new DeviceNetworkSnapshotAggregator({
    ...adapters(),
    timeoutMs: 1000,
    createId: () => 'snapshot-test-id',
    ...overrides
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function manualTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    schedule(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    fireAll() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      pending.forEach(([, callback]) => callback());
    },
    get size() {
      return callbacks.size;
    }
  };
}

async function flushMicrotasks(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

test('system and network success produce one aggregate snapshot', async () => {
  const snapshot = await aggregator().collectSnapshot();
  assert.equal(snapshot.partial, false);
  assert.deepEqual(snapshot.errors, []);
  assert.equal(validateAggregateSnapshot(snapshot), snapshot);
});

test('snapshot identity exists and is unique per call', async () => {
  let id = 0;
  const instance = aggregator({ createId: () => `snapshot-${++id}` });
  const first = await instance.collectSnapshot();
  const second = await instance.collectSnapshot();
  assert.equal(first.snapshot_id, 'snapshot-1');
  assert.equal(second.snapshot_id, 'snapshot-2');
  assert.notEqual(first.snapshot_id, second.snapshot_id);
});

test('snapshot started and completed times are valid and ordered', async () => {
  const values = [new Date('2026-08-10T05:00:00.000Z'), new Date('2026-08-10T05:00:01.000Z')];
  const snapshot = await aggregator({ now: () => values.shift() }).collectSnapshot();
  assert.equal(snapshot.started_at, '2026-08-10T05:00:00.000Z');
  assert.equal(snapshot.completed_at, '2026-08-10T05:00:01.000Z');
});

test('child contracts and collected_at values are preserved', async () => {
  const parts = domainParts();
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => parts.system },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot();
  assert.equal(validateSystemMetrics(snapshot.system), snapshot.system);
  assert.equal(validateNetworkMetrics(snapshot.network), snapshot.network);
  assert.equal(snapshot.system.metadata.collected_at, parts.system.metadata.collected_at);
  assert.equal(snapshot.network.metadata.collected_at, parts.network.metadata.collected_at);
});

test('fake collectors prove both components start concurrently', async () => {
  const events = [];
  const systemDeferred = deferred();
  const networkDeferred = deferred();
  const instance = aggregator({
    systemAdapter: { collectSystemMetrics: () => { events.push('system-start'); return systemDeferred.promise; } },
    networkAdapter: { collectNetworkMetrics: () => { events.push('network-start'); return networkDeferred.promise; } }
  });
  const collecting = instance.collectSnapshot();
  await flushMicrotasks();
  assert.deepEqual(events, ['system-start', 'network-start']);
  const parts = domainParts();
  systemDeferred.resolve(parts.system);
  networkDeferred.resolve(parts.network);
  await collecting;
});

test('concurrency test uses controlled promises and no real sleep', async () => {
  const events = [];
  const parts = domainParts();
  const instance = aggregator({
    systemAdapter: { collectSystemMetrics: async () => { events.push('system'); return parts.system; } },
    networkAdapter: { collectNetworkMetrics: async () => { events.push('network'); return parts.network; } }
  });
  await instance.collectSnapshot();
  assert.deepEqual(events, ['system', 'network']);
});

test('completion order cannot serialize network start behind system completion', async () => {
  const events = [];
  const systemDeferred = deferred();
  const parts = domainParts();
  const collecting = aggregator({
    systemAdapter: { collectSystemMetrics: () => systemDeferred.promise.then((value) => { events.push('system-complete'); return value; }) },
    networkAdapter: { collectNetworkMetrics: async () => { events.push('network-start'); return parts.network; } }
  }).collectSnapshot();
  await flushMicrotasks();
  assert.deepEqual(events, ['network-start']);
  systemDeferred.resolve(parts.system);
  await collecting;
  assert.deepEqual(events, ['network-start', 'system-complete']);
});

test('system failure keeps successful network data', async () => {
  const parts = domainParts();
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => { throw new Error('system failed'); } },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot();
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.errors[0].component, 'system');
  assert.deepEqual(snapshot.network, parts.network);
  assert.equal(snapshot.system.cpu.availability, 'unavailable');
});

test('network failure keeps successful system data', async () => {
  const parts = domainParts();
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => parts.system },
    networkAdapter: { collectNetworkMetrics: async () => { throw new Error('network failed'); } }
  }).collectSnapshot();
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.errors[0].component, 'network');
  assert.deepEqual(snapshot.system, parts.system);
  assert.equal(snapshot.network.availability, 'unknown');
});

test('both failures return a fully unavailable valid snapshot', async () => {
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => { throw new Error('system failed'); } },
    networkAdapter: { collectNetworkMetrics: async () => { throw new Error('network failed'); } }
  }).collectSnapshot();
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.errors.length, 2);
  assert.equal(snapshot.system.cpu.availability, 'unavailable');
  assert.equal(snapshot.network.availability, 'unknown');
  assert.equal(validateAggregateSnapshot(snapshot), snapshot);
});

test('one rejected collector never rejects the aggregate call', async () => {
  const parts = domainParts();
  await assert.doesNotReject(() => aggregator({
    systemAdapter: { collectSystemMetrics: async () => { throw new Error('fixture'); } },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot());
});

test('system timeout produces a component timeout error', async () => {
  const timers = manualTimers();
  const parts = domainParts();
  const hanging = deferred();
  const collecting = aggregator({
    systemAdapter: { collectSystemMetrics: () => hanging.promise },
    networkAdapter: { collectNetworkMetrics: async () => parts.network },
    scheduleTimeout: timers.schedule,
    cancelTimeout: timers.cancel
  }).collectSnapshot();
  await flushMicrotasks();
  assert.equal(timers.size, 1);
  timers.fireAll();
  const snapshot = await collecting;
  assert.equal(snapshot.errors[0].component, 'system');
  assert.equal(snapshot.errors[0].code, 'COLLECTOR_TIMEOUT');
});

test('network timeout produces a component timeout error', async () => {
  const timers = manualTimers();
  const parts = domainParts();
  const hanging = deferred();
  const collecting = aggregator({
    systemAdapter: { collectSystemMetrics: async () => parts.system },
    networkAdapter: { collectNetworkMetrics: () => hanging.promise },
    scheduleTimeout: timers.schedule,
    cancelTimeout: timers.cancel
  }).collectSnapshot();
  await flushMicrotasks();
  timers.fireAll();
  const snapshot = await collecting;
  assert.equal(snapshot.errors[0].component, 'network');
  assert.equal(snapshot.errors[0].code, 'COLLECTOR_TIMEOUT');
});

test('timeout preserves the other successful component', async () => {
  const timers = manualTimers();
  const parts = domainParts();
  const collecting = aggregator({
    systemAdapter: { collectSystemMetrics: () => new Promise(() => {}) },
    networkAdapter: { collectNetworkMetrics: async () => parts.network },
    scheduleTimeout: timers.schedule,
    cancelTimeout: timers.cancel
  }).collectSnapshot();
  await flushMicrotasks();
  timers.fireAll();
  const snapshot = await collecting;
  assert.deepEqual(snapshot.network, parts.network);
  assert.equal(snapshot.system.cpu.availability, 'unavailable');
});

test('late rejection after timeout is handled without unhandled rejection', async () => {
  const timers = manualTimers();
  const parts = domainParts();
  const late = deferred();
  const collecting = aggregator({
    systemAdapter: { collectSystemMetrics: () => late.promise },
    networkAdapter: { collectNetworkMetrics: async () => parts.network },
    scheduleTimeout: timers.schedule,
    cancelTimeout: timers.cancel
  }).collectSnapshot();
  await flushMicrotasks();
  timers.fireAll();
  await collecting;
  late.reject(new Error('late sensitive failure'));
  await flushMicrotasks();
});

test('snapshot builds the existing Home Footer ViewModel', async () => {
  const snapshot = await aggregator().collectSnapshot();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(viewModel.cpu.state, 'available');
  assert.equal(viewModel.network.state, 'online');
});

test('system unavailable degrades footer CPU and RAM', async () => {
  const parts = domainParts();
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => { throw new Error('system'); } },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(viewModel.cpu.state, 'unavailable');
  assert.equal(viewModel.ram.state, 'unavailable');
});

test('network unavailable degrades footer traffic without changing system', async () => {
  const parts = domainParts();
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => parts.system },
    networkAdapter: { collectNetworkMetrics: async () => { throw new Error('network'); } }
  }).collectSnapshot();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(viewModel.cpu.state, 'available');
  assert.equal(viewModel.network.state, 'unknown');
  assert.equal(viewModel.network.upload.value, null);
});

test('genuine zero values remain available through snapshot and footer', async () => {
  const parts = domainParts();
  parts.system.cpu.utilization.value = 0;
  parts.network.traffic.upload_rate.current.value = 0;
  parts.network.traffic.download_rate.current.value = 0;
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => parts.system },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(viewModel.cpu.text, '0%');
  assert.equal(viewModel.network.upload.text, '0 Mbps');
  assert.equal(viewModel.network.download.text, '0 Mbps');
});

test('deferred latency never becomes zero milliseconds', async () => {
  const parts = domainParts();
  parts.network.latency = { availability: 'unavailable', current: null, reason: 'Deferred.' };
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => parts.system },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(viewModel.network.latency.value, null);
  assert.equal(viewModel.network.latency.text, '暂不可用');
});

test('error summary never exposes raw stderr or paths', async () => {
  const parts = domainParts();
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => { throw new Error('C:\\Users\\private\\secret stderr token'); } },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot();
  const serialized = JSON.stringify(snapshot.errors);
  assert.doesNotMatch(serialized, /Users|private|secret|stderr|token/i);
  assert.deepEqual(Object.keys(snapshot.errors[0]), ['component', 'code', 'category', 'availability', 'occurred_at']);
});

test('snapshot envelope adds no hostname MAC IP or account identity', async () => {
  const snapshot = await aggregator().collectSnapshot();
  const serialized = JSON.stringify({
    snapshot_id: snapshot.snapshot_id,
    started_at: snapshot.started_at,
    completed_at: snapshot.completed_at,
    partial: snapshot.partial,
    errors: snapshot.errors,
    freshness: snapshot.freshness,
    timings_ms: snapshot.timings_ms
  });
  assert.doesNotMatch(serialized, /hostname|mac|ip_address|ssid|account|email/i);
});

test('snapshot freshness preserves a stale child', async () => {
  const parts = domainParts();
  parts.system.metadata.freshness = { state: 'stale', age_ms: 120_000, stale_after_ms: 60_000 };
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => parts.system },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot();
  assert.equal(snapshot.freshness, 'stale');
  assert.equal(snapshot.system.metadata.freshness.state, 'stale');
});

test('health evaluator is integrated while anomaly detection remains deferred', async () => {
  const snapshot = await aggregator().collectSnapshot();
  assert.equal(snapshot.health.status, 'healthy');
  assert.deepEqual(snapshot.health.reasons, []);
  assert.deepEqual(snapshot.anomalies, []);
});

test('collectHomeFooterSnapshot is the unified single-refresh entry point', async () => {
  const result = await aggregator().collectHomeFooterSnapshot();
  assert.equal(result.snapshot.snapshot_id, 'snapshot-test-id');
  assert.equal(result.view_model.schema_version, '0.1');
  assert.equal(result.view_model.cpu.state, 'available');
});

test('invalid child contract is isolated as collector failure', async () => {
  const parts = domainParts();
  const invalidSystem = structuredClone(parts.system);
  invalidSystem.cpu.utilization.value = Infinity;
  const snapshot = await aggregator({
    systemAdapter: { collectSystemMetrics: async () => invalidSystem },
    networkAdapter: { collectNetworkMetrics: async () => parts.network }
  }).collectSnapshot();
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.errors[0].component, 'system');
  assert.equal(snapshot.system.cpu.availability, 'unavailable');
});
