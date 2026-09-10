'use strict';

const {
  MetricAvailability,
  WindowsSystemCollector,
  WindowsSystemCollectorAdapter,
  buildHomeFooterViewModel,
  validateSystemMetrics
} = require('../src');
const { loadScenario } = require('../fixtures/scenarios');

async function main() {
  const collector = new WindowsSystemCollector({ sampleIntervalMs: 200 });
  const adapter = new WindowsSystemCollectorAdapter(collector);
  const system = await adapter.collectSystemMetrics();
  validateSystemMetrics(system);

  const snapshot = loadScenario('healthy_device');
  snapshot.scenario_id = 'live_windows_smoke';
  snapshot.system = system;
  snapshot.health.evaluated_at = system.metadata.collected_at;
  const viewModel = buildHomeFooterViewModel(snapshot);
  const availableDisks = system.disks.filter((disk) => disk.availability === MetricAvailability.AVAILABLE);

  const evidence = {
    status: 'PASS',
    platform: process.platform,
    provider: system.metadata.provider.id,
    collected_at_valid: Number.isFinite(Date.parse(system.metadata.collected_at)),
    freshness: system.metadata.freshness.state,
    cpu: {
      availability: system.cpu.availability,
      utilization_in_range: system.cpu.availability !== MetricAvailability.AVAILABLE
        || (system.cpu.utilization.value >= 0 && system.cpu.utilization.value <= 100)
    },
    ram: {
      availability: system.memory.availability,
      capacity_relation_valid: system.memory.availability !== MetricAvailability.AVAILABLE
        || system.memory.used.value + system.memory.available.value === system.memory.total.value
    },
    disk: {
      available_volume_count: availableDisks.length,
      fallback_availability: availableDisks.length === 0 ? system.disks[0].availability : null,
      capacities_non_negative: availableDisks.every((disk) => disk.total.value > 0
        && disk.used.value >= 0 && disk.available.value >= 0)
    },
    home_footer: {
      cpu_state: viewModel.cpu.state,
      ram_state: viewModel.ram.state,
      gpu_state: viewModel.gpu.state,
      temperature_state: viewModel.temperature.state
    }
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Windows smoke test failed: ${error.message}\n`);
  process.exitCode = 1;
});
