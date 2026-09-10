'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_HEALTH_POLICY,
  DeviceHealthEvaluator,
  DeviceNetworkSnapshotAggregator,
  HealthReasonCode,
  buildHomeFooterViewModel,
  createHealthPolicy,
  validateDeviceHealth
} = require('../src');
const { loadScenario } = require('../fixtures/scenarios');

const EVALUATED_AT = '2026-08-10T08:00:00.000Z';

function snapshot() {
  return loadScenario('healthy_device');
}

function evaluator(policy) {
  return new DeviceHealthEvaluator({ policy, now: () => new Date(EVALUATED_AT) });
}

function evaluate(value = snapshot(), policy) {
  return evaluator(policy).evaluate(value);
}

function setCpu(value, utilization) {
  value.system.cpu.utilization.value = utilization;
  return value;
}

function setMemory(value, utilization) {
  value.system.memory.utilization.value = utilization;
  return value;
}

function setDisk(value, utilization, index = 0) {
  value.system.disks[index].utilization.value = utilization;
  return value;
}

function unavailableCapacity(block, reason) {
  block.availability = 'unavailable';
  block.total = null;
  block.used = null;
  block.available = null;
  block.utilization = null;
  block.reason = reason;
}

function unavailableCpu(value, reason = 'private provider detail') {
  value.system.cpu = {
    availability: 'unavailable',
    utilization: null,
    logical_processors: null,
    physical_cores: null,
    physical_cores_availability: 'unavailable',
    reason
  };
  return value;
}

function networkUnknown(value) {
  value.network.availability = 'unknown';
  value.network.interface_summary = { active_count: 0, primary: null };
  return value;
}

function stale(metadata) {
  metadata.freshness = { state: 'stale', age_ms: 120_000, stale_after_ms: 60_000 };
}

function unknownFreshness(metadata) {
  metadata.freshness = { state: 'unknown', age_ms: 0, stale_after_ms: 60_000 };
}

function adapters(value = snapshot()) {
  return {
    systemAdapter: { collectSystemMetrics: async () => value.system },
    networkAdapter: { collectNetworkMetrics: async () => value.network }
  };
}

test('CPU below warning threshold is healthy', () => {
  assert.equal(evaluate(setCpu(snapshot(), 84.99)).status, 'healthy');
});

test('CPU exactly at warning threshold is warning', () => {
  const health = evaluate(setCpu(snapshot(), 85));
  assert.equal(health.status, 'warning');
  assert.equal(health.reasons[0].code, HealthReasonCode.CPU_WARNING);
});

test('CPU above warning threshold remains warning below critical', () => {
  assert.equal(evaluate(setCpu(snapshot(), 90)).status, 'warning');
});

test('CPU exactly at critical threshold is critical', () => {
  const health = evaluate(setCpu(snapshot(), 95));
  assert.equal(health.status, 'critical');
  assert.equal(health.reasons[0].code, HealthReasonCode.CPU_CRITICAL);
});

test('CPU above critical threshold remains critical', () => {
  assert.equal(evaluate(setCpu(snapshot(), 99)).status, 'critical');
});

test('RAM below warning threshold is healthy', () => {
  assert.equal(evaluate(setMemory(snapshot(), 84)).status, 'healthy');
});

test('RAM warning threshold produces an explainable warning', () => {
  const health = evaluate(setMemory(snapshot(), 85));
  assert.equal(health.status, 'warning');
  assert.equal(health.reasons[0].code, HealthReasonCode.MEMORY_WARNING);
});

test('RAM critical threshold produces critical', () => {
  const health = evaluate(setMemory(snapshot(), 95));
  assert.equal(health.status, 'critical');
  assert.equal(health.reasons[0].code, HealthReasonCode.MEMORY_CRITICAL);
});

test('Disk below warning threshold is healthy', () => {
  assert.equal(evaluate(setDisk(snapshot(), 84)).status, 'healthy');
});

test('Disk warning identifies the affected volume without a serial number', () => {
  const health = evaluate(setDisk(snapshot(), 85));
  assert.equal(health.status, 'warning');
  assert.equal(health.reasons[0].code, HealthReasonCode.DISK_WARNING);
  assert.match(health.reasons[0].message, /fixture-volume-system/);
});

test('Disk critical threshold produces critical', () => {
  const health = evaluate(setDisk(snapshot(), 95));
  assert.equal(health.status, 'critical');
  assert.equal(health.reasons[0].code, HealthReasonCode.DISK_CRITICAL);
});

test('multiple disks aggregate to their highest severity', () => {
  const value = setDisk(snapshot(), 85);
  value.system.disks.push(structuredClone(value.system.disks[0]));
  value.system.disks[1].volume_id = 'fixture-volume-data';
  setDisk(value, 96, 1);
  const health = evaluate(value);
  assert.equal(health.status, 'critical');
  assert.deepEqual(health.reasons.map((reason) => reason.code), [HealthReasonCode.DISK_WARNING, HealthReasonCode.DISK_CRITICAL]);
});

test('online network with an active interface is healthy', () => {
  assert.equal(evaluate(snapshot()).status, 'healthy');
});

test('confirmed offline network is warning', () => {
  const value = loadScenario('network_unavailable');
  const health = evaluate(value);
  assert.equal(health.status, 'warning');
  assert.equal(health.reasons[0].code, HealthReasonCode.NETWORK_OFFLINE);
});

test('network provider failure is unknown', () => {
  const health = evaluate(networkUnknown(snapshot()));
  assert.equal(health.status, 'unknown');
  assert.equal(health.reasons[0].code, HealthReasonCode.NETWORK_UNAVAILABLE);
});

test('zero network traffic is a healthy idle fact', () => {
  const value = snapshot();
  value.network.traffic.upload_rate.current.value = 0;
  value.network.traffic.download_rate.current.value = 0;
  assert.equal(evaluate(value).status, 'healthy');
});

test('unsupported deferred GPU does not lower overall health', () => {
  assert.equal(evaluate(loadScenario('gpu_unsupported')).status, 'healthy');
});

test('unavailable deferred temperature does not lower overall health', () => {
  assert.equal(evaluate(loadScenario('temperature_unavailable')).status, 'healthy');
});

test('stale important system metrics make components unknown without using old values', () => {
  const value = setCpu(snapshot(), 99);
  stale(value.system.metadata);
  const health = evaluate(value);
  assert.equal(health.status, 'unknown');
  assert.ok(health.reasons.some((reason) => reason.code === HealthReasonCode.CPU_STALE));
  assert.ok(!health.reasons.some((reason) => reason.code === HealthReasonCode.CPU_CRITICAL));
});

test('warning plus healthy components aggregates to warning', () => {
  assert.equal(evaluate(setCpu(snapshot(), 85)).status, 'warning');
});

test('critical plus warning aggregates to critical', () => {
  const value = setCpu(snapshot(), 95);
  setMemory(value, 85);
  assert.equal(evaluate(value).status, 'critical');
});

test('critical evidence is not overridden by unknown network evidence', () => {
  const value = networkUnknown(setCpu(snapshot(), 95));
  const health = evaluate(value);
  assert.equal(health.status, 'critical');
  assert.ok(health.reasons.some((reason) => reason.code === HealthReasonCode.NETWORK_UNAVAILABLE));
});

test('all evaluable metrics unavailable aggregate to unknown', () => {
  const value = unavailableCpu(snapshot());
  unavailableCapacity(value.system.memory, 'private memory failure');
  unavailableCapacity(value.system.disks[0], 'private disk failure');
  networkUnknown(value);
  assert.equal(evaluate(value).status, 'unknown');
});

test('Snapshot collection evaluates DeviceHealth V0.1', async () => {
  const result = await new DeviceNetworkSnapshotAggregator({
    ...adapters(),
    createId: () => 'health-snapshot'
  }).collectSnapshot();
  assert.equal(validateDeviceHealth(result.health), result.health);
  assert.equal(result.health.status, 'healthy');
});

test('Snapshot health flows into the compact Home Footer summary', async () => {
  const result = await new DeviceNetworkSnapshotAggregator({
    ...adapters(setCpu(snapshot(), 90)),
    createId: () => 'health-footer'
  }).collectHomeFooterSnapshot();
  assert.equal(result.view_model.device_health.state, 'warning');
  assert.equal(result.view_model.device_health.affected_component_count, 1);
  assert.match(result.view_model.device_health.summary, /90%/);
});

test('evaluator failure is fail-soft and never destroys collected metrics', async () => {
  const value = snapshot();
  const result = await new DeviceNetworkSnapshotAggregator({
    ...adapters(value),
    healthEvaluator: { evaluate() { throw new Error('private evaluator stack'); } },
    createId: () => 'health-failure'
  }).collectSnapshot();
  assert.equal(result.health.status, 'unknown');
  assert.equal(result.health.reasons[0].code, HealthReasonCode.EVALUATION_FAILED);
  assert.equal(result.system.cpu.utilization.value, value.system.cpu.utilization.value);
  assert.doesNotMatch(JSON.stringify(result.health), /private evaluator stack/);
});

test('reason codes are stable and contain no dynamic observed value', () => {
  const health = evaluate(setCpu(snapshot(), 91));
  assert.equal(health.reasons[0].code, 'CPU_UTILIZATION_WARNING');
  assert.doesNotMatch(health.reasons[0].code, /91/);
});

test('threshold values can be overridden through HealthPolicy', () => {
  const health = evaluate(setCpu(snapshot(), 55), {
    cpu: { warning_percent: 50, critical_percent: 60 }
  });
  assert.equal(health.status, 'warning');
  assert.match(health.reasons[0].message, /50%/);
});

test('same snapshot policy and clock produce exactly deterministic output', () => {
  const value = setCpu(snapshot(), 90);
  const instance = evaluator();
  assert.deepEqual(instance.evaluate(value), instance.evaluate(value));
});

test('DeviceHealth contains no raw provider payload or private failure text', () => {
  const value = unavailableCpu(snapshot(), 'C:\\Users\\private\\raw-provider-secret');
  unavailableCapacity(value.system.memory, 'raw stderr secret');
  const health = evaluate(value);
  const serialized = JSON.stringify(health);
  assert.doesNotMatch(serialized, /Users|raw-provider-secret|stderr secret/);
  assert.doesNotMatch(serialized, /provider|PowerShell/i);
});

test('fresh CPU critical remains critical when network metrics are stale', () => {
  const value = setCpu(snapshot(), 97);
  stale(value.network.metadata);
  assert.equal(evaluate(value).status, 'critical');
});

test('explicitly degraded network is warning without consulting latency', () => {
  const value = snapshot();
  value.network.availability = 'degraded';
  const health = evaluate(value);
  assert.equal(health.status, 'warning');
  assert.equal(health.reasons[0].code, HealthReasonCode.NETWORK_DEGRADED);
});

test('unknown system freshness produces unknown rather than healthy', () => {
  const value = snapshot();
  unknownFreshness(value.system.metadata);
  assert.equal(evaluate(value).status, 'unknown');
});

test('unavailable disk makes disk health unknown when no stronger disk evidence exists', () => {
  const value = snapshot();
  unavailableCapacity(value.system.disks[0], 'disk unavailable');
  const health = evaluate(value);
  assert.equal(health.status, 'unknown');
  assert.equal(health.reasons[0].code, HealthReasonCode.DISK_UNAVAILABLE);
});

test('deferred latency availability is ignored by health policy', () => {
  const value = snapshot();
  value.network.latency = { availability: 'unavailable', current: null, reason: 'Latency deferred.' };
  assert.equal(evaluate(value).status, 'healthy');
});

test('deferred Mihomo availability is ignored by health policy', () => {
  assert.equal(evaluate(loadScenario('mihomo_controller_unavailable')).status, 'healthy');
});

test('health evaluation never creates or mutates Anomaly records', async () => {
  const value = setCpu(snapshot(), 99);
  const originalAnomalies = structuredClone(value.anomalies);
  evaluate(value);
  assert.deepEqual(value.anomalies, originalAnomalies);
  const aggregate = await new DeviceNetworkSnapshotAggregator({ ...adapters(value), createId: () => 'no-anomaly' }).collectSnapshot();
  assert.deepEqual(aggregate.anomalies, []);
});

test('healthy evaluation provides compact metric evidence without reasons', () => {
  const health = evaluate(snapshot());
  assert.deepEqual(health.reasons, []);
  assert.deepEqual(health.affected_components, []);
  assert.deepEqual(health.evidence, [
    'system.cpu.utilization',
    'system.memory.utilization',
    'system.disks[0].utilization',
    'network.availability'
  ]);
});

test('invalid threshold ordering is rejected', () => {
  assert.throws(() => createHealthPolicy({ cpu: { warning_percent: 95, critical_percent: 85 } }), /thresholds/);
});

test('default HealthPolicy and injected policies are immutable', () => {
  const custom = createHealthPolicy({ memory: { warning_percent: 80, critical_percent: 90 } });
  assert.equal(Object.isFrozen(DEFAULT_HEALTH_POLICY), true);
  assert.equal(Object.isFrozen(DEFAULT_HEALTH_POLICY.cpu), true);
  assert.equal(Object.isFrozen(custom.memory), true);
});

test('disk identity is sanitized before entering a reason message', () => {
  const value = setDisk(snapshot(), 95);
  value.system.disks[0].volume_id = 'C:\\Users\\private';
  const message = evaluate(value).reasons[0].message;
  assert.doesNotMatch(message, /\\|Users/);
  assert.match(message, /Disk volume utilization/);
});

test('Snapshot records a finite non-negative health evaluation duration', async () => {
  const result = await new DeviceNetworkSnapshotAggregator({ ...adapters(), createId: () => 'health-timing' }).collectSnapshot();
  assert.equal(Number.isFinite(result.timings_ms.health), true);
  assert.ok(result.timings_ms.health >= 0);
});

test('known warning is not overridden by an unavailable CPU component', () => {
  const value = unavailableCpu(loadScenario('network_unavailable'));
  assert.equal(evaluate(value).status, 'warning');
});

test('genuine zero CPU RAM Disk and traffic values remain healthy facts', () => {
  const value = setCpu(snapshot(), 0);
  setMemory(value, 0);
  setDisk(value, 0);
  value.network.traffic.upload_rate.current.value = 0;
  value.network.traffic.download_rate.current.value = 0;
  assert.equal(evaluate(value).status, 'healthy');
});
