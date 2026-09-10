'use strict';

const {
  MetricAvailability,
  WindowsNetworkCollector,
  WindowsNetworkCollectorAdapter,
  buildHomeFooterViewModel,
  validateNetworkMetrics
} = require('../src');
const { loadScenario } = require('../fixtures/scenarios');

async function main() {
  const collector = new WindowsNetworkCollector({ sampleIntervalMs: 500 });
  const adapter = new WindowsNetworkCollectorAdapter(collector);
  const startedAt = Date.now();
  const network = await adapter.collectNetworkMetrics();
  const collectorDurationMs = Date.now() - startedAt;
  validateNetworkMetrics(network);

  const snapshot = loadScenario('healthy_device');
  snapshot.scenario_id = 'live_windows_network_smoke';
  snapshot.network = network;
  snapshot.health.evaluated_at = network.metadata.collected_at;
  const viewModel = buildHomeFooterViewModel(snapshot);
  const metricValid = (metric) => metric.availability !== MetricAvailability.AVAILABLE
    || (Number.isFinite(metric.current.value) && metric.current.value >= 0);

  const evidence = {
    status: 'PASS',
    platform: process.platform,
    provider: network.metadata.provider.id,
    collector_duration_ms: collectorDurationMs,
    collected_at_valid: Number.isFinite(Date.parse(network.metadata.collected_at)),
    freshness: network.metadata.freshness.state,
    network_state: network.availability,
    active_interface_count: network.interface_summary.active_count,
    cumulative_sent_valid_or_unavailable: metricValid(network.traffic.cumulative_sent),
    cumulative_received_valid_or_unavailable: metricValid(network.traffic.cumulative_received),
    upload_rate_valid_or_unavailable: metricValid(network.traffic.upload_rate),
    download_rate_valid_or_unavailable: metricValid(network.traffic.download_rate),
    latency_state: network.latency.availability,
    home_footer: {
      network_state: viewModel.network.state,
      active_interface_count: viewModel.network.active_interface_count,
      upload_state: viewModel.network.upload.state,
      download_state: viewModel.network.download.state,
      latency_state: viewModel.network.latency.state
    },
    mihomo_real_integration: 'deferred'
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Windows network smoke test failed: ${error.message}\n`);
  process.exitCode = 1;
});
