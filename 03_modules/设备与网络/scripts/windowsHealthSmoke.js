'use strict';

const {
  DeviceNetworkSnapshotAggregator,
  HealthStatus,
  validateAggregateSnapshot,
  validateDeviceHealth
} = require('../src');

function hasInvalidNumber(value) {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasInvalidNumber);
  if (value && typeof value === 'object') return Object.values(value).some(hasInvalidNumber);
  return false;
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

async function main() {
  const aggregator = new DeviceNetworkSnapshotAggregator();
  const { snapshot, view_model: viewModel } = await aggregator.collectHomeFooterSnapshot();
  validateAggregateSnapshot(snapshot);
  validateDeviceHealth(snapshot.health);

  const validStatus = Object.values(HealthStatus).includes(snapshot.health.status);
  const validReasons = snapshot.health.reasons.every((reason) => typeof reason.code === 'string'
    && reason.code.length > 0 && typeof reason.message === 'string' && reason.message.length > 0);
  const deferredCapabilityMisreported = snapshot.health.reasons.some((reason) => /GPU|TEMPERATURE|LATENCY|MIHOMO/.test(reason.code));
  const viewModelValid = viewModel.device_health.state === snapshot.health.status
    && typeof viewModel.device_health.summary === 'string'
    && viewModel.device_health.summary.length > 0
    && viewModel.device_health.affected_component_count === snapshot.health.affected_components.length;
  const invalidNumberFound = hasInvalidNumber(snapshot.health) || hasInvalidNumber(viewModel.device_health);
  const passed = validStatus && validReasons && !deferredCapabilityMisreported && viewModelValid && !invalidNumberFound;

  const evidence = {
    status: passed ? 'PASS' : 'FAIL',
    health_result: snapshot.health.status.toUpperCase(),
    reason_count: snapshot.health.reasons.length,
    reason_codes: snapshot.health.reasons.map((reason) => reason.code),
    affected_component_count: snapshot.health.affected_components.length,
    evaluator_duration_ms: round(snapshot.timings_ms.health),
    snapshot_total_ms: round(snapshot.timings_ms.total, 2),
    system_collector_ms: round(snapshot.timings_ms.system, 2),
    network_collector_ms: round(snapshot.timings_ms.network, 2),
    view_model_health: viewModel.device_health.state.toUpperCase(),
    view_model_summary_present: viewModel.device_health.summary.length > 0,
    invalid_number_found: invalidNumberFound,
    deferred_capability_misreported: deferredCapabilityMisreported,
    anomaly_engine: 'deferred',
    latency: 'deferred',
    mihomo: 'deferred',
    gpu: 'deferred',
    temperature: 'deferred'
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Windows health smoke test failed: ${error.message}\n`);
  process.exitCode = 1;
});
