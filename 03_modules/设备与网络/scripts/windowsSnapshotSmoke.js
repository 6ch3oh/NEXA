'use strict';

const {
  DeviceNetworkSnapshotAggregator,
  MetricAvailability,
  validateAggregateSnapshot
} = require('../src');

function hasInvalidNumber(value) {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasInvalidNumber);
  if (value && typeof value === 'object') return Object.values(value).some(hasInvalidNumber);
  return false;
}

async function main() {
  const aggregator = new DeviceNetworkSnapshotAggregator();
  const { snapshot, view_model: viewModel } = await aggregator.collectHomeFooterSnapshot();
  validateAggregateSnapshot(snapshot);

  const systemDuration = snapshot.timings_ms.system;
  const networkDuration = snapshot.timings_ms.network;
  const totalDuration = snapshot.timings_ms.total;
  const maxChildDuration = Math.max(systemDuration, networkDuration);
  const startSpread = Math.abs(snapshot.timings_ms.system_started_offset - snapshot.timings_ms.network_started_offset);
  const concurrentAggregation = startSpread <= 50 && totalDuration <= maxChildDuration + 250;
  const validMetric = (metric) => metric.availability !== MetricAvailability.AVAILABLE
    || (Number.isFinite(metric.current.value) && metric.current.value >= 0);

  const evidence = {
    status: concurrentAggregation && !hasInvalidNumber(snapshot) ? 'PASS' : 'FAIL',
    snapshot_id_present: typeof snapshot.snapshot_id === 'string' && snapshot.snapshot_id.length > 0,
    started_at_valid: Number.isFinite(Date.parse(snapshot.started_at)),
    completed_at_valid: Number.isFinite(Date.parse(snapshot.completed_at))
      && Date.parse(snapshot.completed_at) >= Date.parse(snapshot.started_at),
    partial: snapshot.partial,
    error_count: snapshot.errors.length,
    system: {
      cpu: snapshot.system.cpu.availability,
      ram: snapshot.system.memory.availability,
      disk_available_count: snapshot.system.disks.filter((disk) => disk.availability === MetricAvailability.AVAILABLE).length
    },
    network: {
      state: snapshot.network.availability,
      active_interface_count: snapshot.network.interface_summary.active_count,
      upload_valid_or_unavailable: validMetric(snapshot.network.traffic.upload_rate),
      download_valid_or_unavailable: validMetric(snapshot.network.traffic.download_rate),
      latency: snapshot.network.latency.availability
    },
    home_footer: {
      cpu: viewModel.cpu.state,
      ram: viewModel.ram.state,
      network: viewModel.network.state,
      upload: viewModel.network.upload.state,
      download: viewModel.network.download.state
    },
    timings_ms: {
      system: systemDuration,
      network: networkDuration,
      snapshot_total: totalDuration,
      collector_start_spread: startSpread
    },
    concurrent_aggregation: concurrentAggregation ? 'PASS' : 'FAIL',
    invalid_number_found: hasInvalidNumber(snapshot),
    latency_real_integration: 'deferred',
    mihomo_real_integration: 'deferred'
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.status !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Windows snapshot smoke test failed: ${error.message}\n`);
  process.exitCode = 1;
});
