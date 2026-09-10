'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CORE_AVAILABILITY,
  DeviceNetworkSnapshotAggregator,
  LEGACY_DEVICE_BRIDGE_CONTRACT,
  LegacyDeviceAdapter,
  LegacyDeviceHostBindingError,
  buildHomeFooterViewModel,
  createLegacyDeviceHostBinding,
  createLegacyDeviceLiveAdapter,
  normalizeLegacyDeviceEvidence,
  providerPriorityFor,
  validateCoreLegacyDeviceSnapshot,
  validateLegacyDeviceEvidence
} = require('../src');
const { loadScenario } = require('../fixtures/scenarios');

const CAPTURED_AT = '2026-08-11T01:02:03.456Z';
const OBSERVED_AT = '2026-08-11T01:01:00.000Z';

function coreSnapshot() {
  return {
    version: 1,
    source: 'token-monitor-legacy-cache',
    capturedAt: CAPTURED_AT,
    availability: {
      device: 'AVAILABLE',
      serviceStatus: 'AVAILABLE',
      hubStats: 'AVAILABLE'
    },
    device: {
      freshness: 'FRESH',
      observedAt: OBSERVED_AT,
      agentVersion: '1.2.3',
      runtime: 'electron-widget',
      privateDeviceId: 'raw-device-secret'
    },
    serviceStatus: {
      freshness: 'FRESH',
      observedAt: OBSERVED_AT,
      services: [{ id: 'openai', status: 'ok' }, { id: 'anthropic', status: 'degraded' }],
      rawIncident: 'raw-incident-secret'
    },
    hubStats: {
      freshness: 'STALE',
      deviceCount: 3,
      freshDeviceCount: 1,
      staleDeviceCount: 1,
      unknownDeviceCount: 1,
      observedAt: OBSERVED_AT,
      staleAfterMs: 120000,
      rawDevices: ['raw-hub-secret']
    },
    extraRaw: 'raw-root-secret'
  };
}

function hostWith(getSnapshot) {
  return {
    tokenMonitor: {
      nexa: {
        'legacy-device': {
          getSnapshot: typeof getSnapshot === 'function' ? getSnapshot : async () => getSnapshot
        }
      }
    }
  };
}

function liveAdapter(snapshot = coreSnapshot(), options = {}) {
  return createLegacyDeviceLiveAdapter(hostWith(snapshot), {
    binding: { timeoutMs: 1000, ...(options.binding || {}) },
    adapter: { now: () => new Date(CAPTURED_AT), ...(options.adapter || {}) }
  });
}

function primaryAdapters() {
  const fixture = loadScenario('healthy_device');
  return {
    system: fixture.system,
    network: fixture.network,
    systemAdapter: { collectSystemMetrics: async () => fixture.system },
    networkAdapter: { collectNetworkMetrics: async () => fixture.network }
  };
}

function aggregator(legacyAdapter, overrides = {}) {
  const primary = primaryAdapters();
  return new DeviceNetworkSnapshotAggregator({
    systemAdapter: primary.systemAdapter,
    networkAdapter: primary.networkAdapter,
    legacyAdapter,
    timeoutMs: 1000,
    createId: () => 'legacy-live-snapshot',
    ...overrides
  });
}

function withoutSections(states = {}) {
  const snapshot = coreSnapshot();
  for (const key of ['device', 'serviceStatus', 'hubStats']) {
    const state = states[key] || 'NOT_INITIALIZED';
    snapshot.availability[key] = state;
    if (state !== 'AVAILABLE') delete snapshot[key];
  }
  return snapshot;
}

function manualTimers() {
  let id = 0;
  const callbacks = new Map();
  return {
    schedule(callback) {
      const next = ++id;
      callbacks.set(next, callback);
      return next;
    },
    cancel(value) { callbacks.delete(value); },
    fireAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    get size() { return callbacks.size; }
  };
}

async function flushMicrotasks(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function expectBindingCode(action, code) {
  return assert.rejects(action, (error) => (
    error instanceof LegacyDeviceHostBindingError && error.code === code
  ));
}

test('consumer contract accepts the complete Core Bridge V0.1 snapshot', () => {
  const result = validateCoreLegacyDeviceSnapshot(coreSnapshot());
  assert.equal(result.version, 1);
  assert.equal(result.source, 'token-monitor-legacy-cache');
  assert.equal(result.capturedAt, CAPTURED_AT);
  assert.deepEqual(result.availability, coreSnapshot().availability);
});

test('consumer contract declares the exact Core module, API, IPC, and enums', () => {
  assert.equal(LEGACY_DEVICE_BRIDGE_CONTRACT.module_id, 'legacy-device');
  assert.match(LEGACY_DEVICE_BRIDGE_CONTRACT.public_api, /legacy-device.*getSnapshot/);
  assert.equal(LEGACY_DEVICE_BRIDGE_CONTRACT.ipc, 'nexa:legacy-device:getSnapshot');
  assert.deepEqual(LEGACY_DEVICE_BRIDGE_CONTRACT.availability, ['AVAILABLE', 'NOT_INITIALIZED', 'UNAVAILABLE', 'UNKNOWN']);
});

test('consumer contract allows device to be optional', () => {
  const snapshot = coreSnapshot();
  snapshot.availability.device = 'NOT_INITIALIZED';
  delete snapshot.device;
  assert.equal('device' in validateCoreLegacyDeviceSnapshot(snapshot), false);
});

test('consumer contract allows serviceStatus to be optional', () => {
  const snapshot = coreSnapshot();
  snapshot.availability.serviceStatus = 'NOT_INITIALIZED';
  delete snapshot.serviceStatus;
  assert.equal('serviceStatus' in validateCoreLegacyDeviceSnapshot(snapshot), false);
});

test('consumer contract allows hubStats to be optional', () => {
  const snapshot = coreSnapshot();
  snapshot.availability.hubStats = 'NOT_INITIALIZED';
  delete snapshot.hubStats;
  assert.equal('hubStats' in validateCoreLegacyDeviceSnapshot(snapshot), false);
});

test('consumer contract allows every optional section to be absent', () => {
  const result = validateCoreLegacyDeviceSnapshot(withoutSections());
  assert.deepEqual(Object.keys(result).sort(), ['availability', 'capturedAt', 'source', 'version']);
});

test('consumer contract rejects an illegal availability enum', () => {
  const snapshot = withoutSections();
  snapshot.availability.device = 'FUTURE_VALUE';
  assert.throws(() => validateCoreLegacyDeviceSnapshot(snapshot), /availability\.device/);
});

test('consumer contract rejects available without its optional section', () => {
  const snapshot = withoutSections();
  snapshot.availability.device = 'AVAILABLE';
  assert.throws(() => validateCoreLegacyDeviceSnapshot(snapshot), /device is required/);
});

test('valid injected host API calls the exact legacy-device getSnapshot capability', async () => {
  let calls = 0;
  const binding = createLegacyDeviceHostBinding(hostWith(async () => { calls += 1; return coreSnapshot(); }));
  const result = await binding.getLegacyDeviceSnapshot();
  assert.equal(calls, 1);
  assert.equal(result.version, 1);
});

test('host unavailable fails soft with a stable capability error', async () => {
  await expectBindingCode(() => createLegacyDeviceHostBinding(null).getLegacyDeviceSnapshot(), 'HOST_API_UNAVAILABLE');
  await expectBindingCode(() => createLegacyDeviceHostBinding({}).getLegacyDeviceSnapshot(), 'HOST_API_UNAVAILABLE');
});

test('nexa unavailable fails soft', async () => {
  await expectBindingCode(
    () => createLegacyDeviceHostBinding({ tokenMonitor: {} }).getLegacyDeviceSnapshot(),
    'NEXA_API_UNAVAILABLE'
  );
});

test('legacy-device module unavailable fails soft', async () => {
  await expectBindingCode(
    () => createLegacyDeviceHostBinding({ tokenMonitor: { nexa: {} } }).getLegacyDeviceSnapshot(),
    'LEGACY_DEVICE_MODULE_UNAVAILABLE'
  );
});

test('getSnapshot missing fails soft', async () => {
  const host = { tokenMonitor: { nexa: { 'legacy-device': {} } } };
  await expectBindingCode(() => createLegacyDeviceHostBinding(host).getLegacyDeviceSnapshot(), 'GET_SNAPSHOT_UNAVAILABLE');
});

test('getSnapshot rejection is sanitized', async () => {
  const binding = createLegacyDeviceHostBinding(hostWith(async () => { throw new Error('raw-host-secret'); }));
  await assert.rejects(
    () => binding.getLegacyDeviceSnapshot(),
    (error) => error.code === 'HOST_CALL_FAILED' && !error.message.includes('raw-host-secret')
  );
});

test('host binding timeout is bounded and sanitized', async () => {
  const timers = manualTimers();
  const binding = createLegacyDeviceHostBinding(hostWith(() => new Promise(() => {})), {
    timeoutMs: 10,
    scheduleTimeout: timers.schedule,
    cancelTimeout: timers.cancel
  });
  const pending = binding.getLegacyDeviceSnapshot();
  await flushMicrotasks();
  assert.equal(timers.size, 1);
  timers.fireAll();
  await expectBindingCode(() => pending, 'HOST_CALL_TIMEOUT');
});

test('device-only Core snapshot maps runtime and leaves hardware untouched', async () => {
  const evidence = await liveAdapter(withoutSections({ device: 'AVAILABLE' })).observeRuntime();
  assert.equal(evidence.runtime.availability, 'available');
  assert.equal(evidence.runtime.agent_runtime, 'electron-widget');
  assert.equal(evidence.application_usage.availability, 'unavailable');
  assert.equal(Object.hasOwn(evidence, 'cpu'), false);
});

test('hubStats-only Core snapshot maps aggregate counts', async () => {
  const evidence = await liveAdapter(withoutSections({ hubStats: 'AVAILABLE' })).observeRuntime();
  assert.equal(evidence.hub.device_count, 3);
  assert.equal(evidence.hub.fresh_device_count, 1);
  assert.equal(evidence.hub.stale_device_count, 1);
  assert.equal(evidence.hub.unknown_device_count, 1);
});

test('serviceStatus-only Core snapshot maps a supplemental health hint', async () => {
  const evidence = await liveAdapter(withoutSections({ serviceStatus: 'AVAILABLE' })).observeRuntime();
  assert.equal(evidence.service_status.availability, 'available');
  assert.equal(evidence.service_status.health_hint, 'warning');
  assert.equal(evidence.service_status.provider_count, 2);
});

test('all optional sections missing remain unavailable rather than empty facts', async () => {
  const evidence = await liveAdapter(withoutSections()).observeRuntime();
  assert.equal(evidence.availability, 'unavailable');
  assert.equal(evidence.runtime.availability, 'unavailable');
  assert.equal(evidence.hub.device_count, null);
  assert.equal(evidence.service_status.provider_count, null);
});

test('serviceStatus missing remains unknown and not initialized', async () => {
  const snapshot = coreSnapshot();
  snapshot.availability.serviceStatus = 'NOT_INITIALIZED';
  delete snapshot.serviceStatus;
  const service = (await liveAdapter(snapshot).observeRuntime()).service_status;
  assert.equal(service.availability, 'unavailable');
  assert.equal(service.health_hint, 'unknown');
  assert.match(service.reason, /not initialized/i);
});

test('valid Core UNKNOWN availability maps to unavailable unknown evidence', async () => {
  const evidence = await liveAdapter(withoutSections({ device: 'UNKNOWN', serviceStatus: 'UNKNOWN', hubStats: 'UNKNOWN' })).observeRuntime();
  assert.equal(evidence.availability, 'unavailable');
  assert.match(evidence.runtime.reason, /unknown/i);
  assert.match(evidence.service_status.reason, /unknown/i);
});

test('stale Hub freshness remains supplemental and separate from NetworkMetrics freshness', async () => {
  const snapshot = await aggregator(liveAdapter()).collectSnapshot();
  assert.equal(snapshot.legacy.hub.freshness, 'stale');
  assert.equal(snapshot.network.metadata.freshness.state, 'fresh');
  assert.equal(snapshot.network.availability, 'online');
});

test('extra Core raw fields are ignored by whitelist mapping', async () => {
  const serialized = JSON.stringify(await liveAdapter().observeRuntime());
  assert.doesNotMatch(serialized, /raw-device-secret|raw-incident-secret|raw-hub-secret|raw-root-secret/);
});

test('malformed Core snapshot fails soft inside the Adapter', () => {
  const malformed = coreSnapshot();
  malformed.hubStats.deviceCount = 999;
  const evidence = normalizeLegacyDeviceEvidence(malformed, { observedAt: CAPTURED_AT });
  assert.equal(evidence.availability, 'unavailable');
  assert.match(evidence.runtime.reason, /malformed/i);
});

test('normalized evidence records only safe Core source/version/capturedAt metadata', async () => {
  const evidence = await liveAdapter().observeRuntime();
  assert.deepEqual(evidence.bridge, {
    version: 1,
    source: 'token-monitor-legacy-cache',
    captured_at: CAPTURED_AT
  });
  assert.equal(evidence.observed_at, CAPTURED_AT);
});

test('mutating the returned Core object cannot change prior normalized evidence', async () => {
  const raw = coreSnapshot();
  const evidence = await liveAdapter(raw).observeRuntime();
  raw.device.runtime = 'headless-agent';
  raw.serviceStatus.services[0].status = 'outage';
  raw.hubStats.deviceCount = 100;
  assert.equal(evidence.runtime.agent_runtime, 'electron-widget');
  assert.equal(evidence.service_status.health_hint, 'warning');
  assert.equal(evidence.hub.device_count, 3);
});

test('equal Core snapshot and clock map deterministically', async () => {
  const first = await liveAdapter().observeRuntime();
  const second = await liveAdapter().observeRuntime();
  assert.deepEqual(first, second);
});

test('Snapshot integrates normalized legacy evidence', async () => {
  const snapshot = await aggregator(liveAdapter()).collectSnapshot();
  assert.equal(validateLegacyDeviceEvidence(snapshot.legacy), snapshot.legacy);
  assert.equal(snapshot.legacy.runtime.agent_runtime, 'electron-widget');
  assert.equal(Number.isFinite(snapshot.timings_ms.legacy), true);
});

test('DeviceHealth gains supplemental references without changing primary status or reasons', async () => {
  const baseline = await aggregator(null).collectSnapshot();
  const snapshot = await aggregator(liveAdapter()).collectSnapshot();
  assert.equal(snapshot.health.status, baseline.health.status);
  assert.deepEqual(snapshot.health.reasons, baseline.health.reasons);
  assert.ok(snapshot.health.evidence.includes('legacy.runtime'));
  assert.ok(snapshot.health.evidence.includes('legacy.hub'));
  assert.ok(snapshot.health.evidence.includes('legacy.service_status'));
});

test('missing serviceStatus creates no DeviceHealth warning or service evidence', async () => {
  const snapshot = coreSnapshot();
  snapshot.availability.serviceStatus = 'NOT_INITIALIZED';
  delete snapshot.serviceStatus;
  const result = await aggregator(liveAdapter(snapshot)).collectSnapshot();
  assert.equal(result.health.status, 'healthy');
  assert.deepEqual(result.health.reasons, []);
  assert.equal(result.health.evidence.includes('legacy.service_status'), false);
});

test('Legacy host failure does not destroy successful System or Network data', async () => {
  const adapter = createLegacyDeviceLiveAdapter(hostWith(async () => { throw new Error('failure'); }), {
    adapter: { now: () => new Date(CAPTURED_AT) }
  });
  const primary = primaryAdapters();
  const snapshot = await aggregator(adapter).collectSnapshot();
  assert.deepEqual(snapshot.system, primary.system);
  assert.deepEqual(snapshot.network, primary.network);
  assert.equal(snapshot.legacy.availability, 'unavailable');
  assert.equal(snapshot.partial, false);
});

test('CPU RAM and Disk remain NEXA primary after live binding', async () => {
  const snapshot = await aggregator(liveAdapter()).collectSnapshot();
  assert.equal(providerPriorityFor('cpu').primary, 'windows-system');
  assert.equal(providerPriorityFor('memory').primary, 'windows-system');
  assert.equal(providerPriorityFor('disk').primary, 'windows-system');
  assert.equal(snapshot.system.metadata.provider.id, 'fixture.windows-system');
});

test('host Network traffic remains NEXA primary after live binding', async () => {
  const snapshot = await aggregator(liveAdapter()).collectSnapshot();
  assert.equal(providerPriorityFor('host_network_traffic').primary, 'windows-network');
  assert.equal(snapshot.network.metadata.provider.id, 'fixture.windows-network');
  assert.equal(Object.hasOwn(snapshot.legacy, 'network'), false);
});

test('System Network and Legacy collection start concurrently', async () => {
  const events = [];
  let resolveSystem;
  let resolveNetwork;
  let resolveLegacy;
  const primary = primaryAdapters();
  const collecting = new DeviceNetworkSnapshotAggregator({
    systemAdapter: { collectSystemMetrics: () => { events.push('system'); return new Promise((resolve) => { resolveSystem = resolve; }); } },
    networkAdapter: { collectNetworkMetrics: () => { events.push('network'); return new Promise((resolve) => { resolveNetwork = resolve; }); } },
    legacyAdapter: { observeRuntime: () => { events.push('legacy'); return new Promise((resolve) => { resolveLegacy = resolve; }); } },
    timeoutMs: 1000
  }).collectSnapshot();
  await flushMicrotasks();
  assert.deepEqual(events, ['system', 'network', 'legacy']);
  resolveSystem(primary.system);
  resolveNetwork(primary.network);
  resolveLegacy(await liveAdapter().observeRuntime());
  await collecting;
});

test('Snapshot-level timeout isolates a permanently hanging Legacy Adapter', async () => {
  const timers = manualTimers();
  const collecting = aggregator({ observeRuntime: () => new Promise(() => {}) }, {
    scheduleTimeout: timers.schedule,
    cancelTimeout: timers.cancel
  }).collectSnapshot();
  await flushMicrotasks();
  assert.equal(timers.size, 1);
  timers.fireAll();
  const snapshot = await collecting;
  assert.equal(snapshot.legacy.availability, 'unavailable');
  assert.equal(snapshot.partial, false);
  assert.equal(snapshot.system.cpu.availability, 'available');
  assert.equal(snapshot.network.availability, 'online');
});

test('invalid custom Legacy evidence is rejected and raw payload cannot enter Snapshot', async () => {
  const invalid = await liveAdapter().observeRuntime();
  invalid.raw = 'raw-custom-secret';
  const snapshot = await aggregator({ observeRuntime: async () => invalid }).collectSnapshot();
  assert.equal(snapshot.legacy.availability, 'unavailable');
  assert.doesNotMatch(JSON.stringify(snapshot), /raw-custom-secret/);
});

test('Home Footer remains compatible and consumes no raw Legacy fields', async () => {
  const { snapshot, view_model: viewModel } = await aggregator(liveAdapter()).collectHomeFooterSnapshot();
  assert.deepEqual(viewModel, buildHomeFooterViewModel(snapshot));
  assert.equal(Object.hasOwn(viewModel, 'legacy'), false);
  assert.doesNotMatch(JSON.stringify(viewModel), /raw-.*-secret/);
});

test('Host Binding source has no network, persistence, refresh, Electron, or global window dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'legacyDeviceHostBinding.js'), 'utf8');
  assert.doesNotMatch(source, /require\s*\(\s*['"](?:node:)?(?:fs|http|https|net|tls|dns|child_process|electron)['"]\s*\)/);
  assert.doesNotMatch(source, /\b(?:fetch|refresh|writeFile|appendFile|WebSocket|EventSource)\s*\(/);
  assert.doesNotMatch(source, /globalThis\.window|\bwindow\.tokenMonitor/);
});

test('domain, evaluator, Snapshot, and Home Footer never access window.tokenMonitor directly', () => {
  const root = path.join(__dirname, '..', 'src');
  for (const file of ['legacyDeviceAdapter.js', 'deviceNetworkSnapshot.js', 'deviceHealthEvaluator.js', 'homeFooterViewModel.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const executableSource = source.split('\n').filter((line) => !line.includes('public_api:')).join('\n');
    assert.doesNotMatch(executableSource, /globalThis\.window|\bwindow\.tokenMonitor|require\s*\(\s*['"]electron['"]\s*\)/, file);
  }
});

test('Legacy Adapter still requires explicit provider injection', () => {
  assert.throws(() => new LegacyDeviceAdapter(null), /getLegacyDeviceSnapshot/);
  assert.equal(CORE_AVAILABILITY.NOT_INITIALIZED, 'NOT_INITIALIZED');
});
