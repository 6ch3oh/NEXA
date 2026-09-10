'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ADAPTER_CAPABILITIES,
  FixtureDeviceNetworkAdapter,
  MetricAvailability,
  validateDeviceNetworkSnapshot
} = require('../src');
const { buildHomeFooterViewModel } = require('../src/homeFooterViewModel');
const { SCENARIOS, loadAllScenarios, loadScenario } = require('../fixtures/scenarios');

test('all twelve offline fixtures satisfy the V0.1 contracts', () => {
  const fixtures = loadAllScenarios();
  assert.equal(fixtures.length, 12);
  assert.deepEqual(Object.keys(SCENARIOS), [
    'healthy_device',
    'high_cpu',
    'memory_pressure',
    'low_disk',
    'temperature_unavailable',
    'gpu_unsupported',
    'high_network_latency',
    'network_unavailable',
    'mihomo_healthy',
    'mihomo_controller_unavailable',
    'multiple_anomalies',
    'stale_metrics'
  ]);
  fixtures.forEach((fixture) => assert.equal(validateDeviceNetworkSnapshot(fixture), fixture));
});

test('contract validation rejects invalid enums and units', () => {
  const invalidEnum = loadScenario('healthy_device');
  invalidEnum.health.status = 'mostly-fine';
  assert.throws(() => validateDeviceNetworkSnapshot(invalidEnum), /expected one of/);

  const invalidUnit = loadScenario('healthy_device');
  invalidUnit.network.traffic.upload_rate.current.unit = 'megabits-ish';
  assert.throws(() => validateDeviceNetworkSnapshot(invalidUnit), /bytes_per_second/);

  const missingRequired = loadScenario('healthy_device');
  delete missingRequired.system.metadata.collected_at;
  assert.throws(() => validateDeviceNetworkSnapshot(missingRequired), /collected_at/);
});

test('a real zero value remains available and is not treated as missing', () => {
  const fixture = loadScenario('healthy_device');
  fixture.system.cpu.utilization.value = 0;
  validateDeviceNetworkSnapshot(fixture);
  const viewModel = buildHomeFooterViewModel(fixture);
  assert.deepEqual(viewModel.cpu, {
    state: 'available', value: 0, unit: '%', text: '0%', reason: null
  });
});

test('unavailable measurements require null data and an explicit reason', () => {
  const fixture = loadScenario('temperature_unavailable');
  assert.equal(fixture.system.temperatures[0].current, null);
  assert.equal(fixture.system.temperatures[0].availability, MetricAvailability.UNAVAILABLE);

  fixture.system.temperatures[0].current = { value: 0, unit: 'celsius' };
  assert.throws(() => validateDeviceNetworkSnapshot(fixture), /must be null/);
});

test('healthy fixture maps to a compact unit-ready footer summary', () => {
  const viewModel = buildHomeFooterViewModel(loadScenario('healthy_device'));
  assert.equal(viewModel.cpu.text, '18.5%');
  assert.equal(viewModel.ram.text, '37.5%');
  assert.equal(viewModel.gpu.text, '22%');
  assert.equal(viewModel.temperature.text, '52.4°C');
  assert.equal(viewModel.network.latency.text, '24 ms');
  assert.equal(viewModel.network.upload.text, '5 Mbps');
  assert.equal(viewModel.network.download.text, '25 Mbps');
  assert.equal(viewModel.device_health.state, 'healthy');
  assert.equal(viewModel.mihomo.state, 'healthy');
  assert.equal(viewModel.active_anomaly_count, 0);
});

test('unsupported GPU and unavailable temperature never render as zero', () => {
  const gpu = buildHomeFooterViewModel(loadScenario('gpu_unsupported'));
  assert.equal(gpu.gpu.state, 'unsupported');
  assert.equal(gpu.gpu.value, null);
  assert.equal(gpu.gpu.text, '不支持');

  const temperature = buildHomeFooterViewModel(loadScenario('temperature_unavailable'));
  assert.equal(temperature.temperature.state, 'unavailable');
  assert.equal(temperature.temperature.value, null);
  assert.equal(temperature.temperature.text, '暂不可用');
});

test('network and Mihomo unavailability degrade independently', () => {
  const network = buildHomeFooterViewModel(loadScenario('network_unavailable'));
  assert.equal(network.network.state, 'offline');
  assert.equal(network.network.latency.value, null);
  assert.equal(network.network.upload.text, '暂不可用');

  const mihomo = buildHomeFooterViewModel(loadScenario('mihomo_controller_unavailable'));
  assert.equal(mihomo.mihomo.state, 'unavailable');
  assert.equal(mihomo.mihomo.mode, null);
  assert.equal(mihomo.mihomo.text, 'Mihomo 不可用');
});

test('active anomaly count excludes resolved anomalies', () => {
  const fixture = loadScenario('multiple_anomalies');
  fixture.anomalies[0].status = 'resolved';
  const viewModel = buildHomeFooterViewModel(fixture);
  assert.equal(viewModel.active_anomaly_count, 2);
});

test('stale source state is preserved in the footer view model', () => {
  const viewModel = buildHomeFooterViewModel(loadScenario('stale_metrics'));
  assert.equal(viewModel.freshness.state, 'stale');
  assert.deepEqual(viewModel.freshness.stale_sources, ['system', 'network', 'mihomo']);
  assert.deepEqual(viewModel.freshness.unknown_sources, []);
});

test('unknown freshness is not misreported as fresh', () => {
  const fixture = loadScenario('healthy_device');
  fixture.network.metadata.freshness.state = 'unknown';
  const viewModel = buildHomeFooterViewModel(fixture);
  assert.equal(viewModel.freshness.state, 'unknown');
  assert.deepEqual(viewModel.freshness.unknown_sources, ['network']);
});

test('fixture adapter provides the offline adapter-to-domain-to-viewmodel path', async () => {
  const adapter = new FixtureDeviceNetworkAdapter(loadScenario('high_cpu'));
  const snapshot = await adapter.getSnapshot();
  const viewModel = buildHomeFooterViewModel(snapshot);
  assert.equal(viewModel.cpu.text, '96%');
  assert.equal(viewModel.device_health.state, 'warning');
  assert.equal(viewModel.active_anomaly_count, 1);

  snapshot.system.cpu.utilization.value = 1;
  const freshSnapshot = await adapter.getSnapshot();
  assert.equal(freshSnapshot.system.cpu.utilization.value, 96);
});

test('adapter capability matrix enables only implemented read-only Windows boundaries', () => {
  assert.equal(ADAPTER_CAPABILITIES.windowsSystem.real_access, true);
  assert.deepEqual(ADAPTER_CAPABILITIES.windowsSystem.implemented, ['cpu', 'memory', 'disk', 'gpu_utilization', 'gpu_temperature']);
  assert.deepEqual(ADAPTER_CAPABILITIES.windowsSystem.deferred, ['cpu_temperature']);
  assert.equal(ADAPTER_CAPABILITIES.windowsNetwork.real_access, true);
  assert.deepEqual(ADAPTER_CAPABILITIES.windowsNetwork.implemented, ['interfaces', 'upload_rate', 'download_rate', 'cumulative_traffic']);
  assert.deepEqual(ADAPTER_CAPABILITIES.windowsNetwork.deferred, ['latency']);
  assert.equal(ADAPTER_CAPABILITIES.existingRuntime.real_access, false);
  assert.equal(ADAPTER_CAPABILITIES.mihomo.real_access, false);
  assert.equal(ADAPTER_CAPABILITIES.mihomo.source, 'future Mihomo External Controller adapter');
});
