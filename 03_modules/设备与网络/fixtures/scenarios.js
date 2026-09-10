'use strict';

const GB = 1024 ** 3;
const OBSERVED_AT = '2026-08-10T02:00:00.000Z';
const STALE_AFTER_MS = 60_000;

function measurement(value, unit) {
  return { value, unit };
}

function metadata(id, freshness = 'fresh') {
  return {
    schema_version: '0.1',
    collected_at: OBSERVED_AT,
    provider: { id, kind: 'fixture' },
    freshness: {
      state: freshness,
      age_ms: freshness === 'stale' ? 180_000 : 1_000,
      stale_after_ms: STALE_AFTER_MS
    }
  };
}

function capacity(totalBytes, usedBytes) {
  const availableBytes = totalBytes - usedBytes;
  return {
    availability: 'available',
    total: measurement(totalBytes, 'bytes'),
    used: measurement(usedBytes, 'bytes'),
    available: measurement(availableBytes, 'bytes'),
    utilization: measurement(Math.round((usedBytes / totalBytes) * 10_000) / 100, 'percent'),
    reason: null
  };
}

function optionalMetric(value, unit) {
  return {
    availability: 'available',
    current: measurement(value, unit),
    reason: null
  };
}

function unavailableMetric(reason, availability = 'unavailable') {
  return { availability, current: null, reason };
}

function anomaly(id, type, severity, component, summary, evidence, remediationHint = null) {
  return {
    schema_version: '0.1',
    anomaly_id: id,
    type,
    severity,
    status: 'open',
    title: summary,
    summary,
    component,
    detected_at: '2026-08-10T01:58:00.000Z',
    last_seen_at: OBSERVED_AT,
    evidence,
    source: 'fixture-rule-engine',
    remediation_hint: remediationHint
  };
}

function baseSnapshot(scenarioId) {
  return {
    scenario_id: scenarioId,
    system: {
      metadata: metadata('fixture.windows-system'),
      cpu: {
        availability: 'available',
        utilization: measurement(18.5, 'percent'),
        logical_processors: 16,
        physical_cores: 8,
        reason: null
      },
      gpu: {
        availability: 'available',
        name: 'Fixture GPU',
        utilization: measurement(22, 'percent'),
        memory: capacity(8 * GB, 2 * GB),
        reason: null
      },
      memory: capacity(16 * GB, 6 * GB),
      disks: [{
        volume_id: 'fixture-volume-system',
        label: 'System',
        ...capacity(512 * GB, 210 * GB)
      }],
      temperatures: [{
        sensor_id: 'fixture-cpu-package',
        source: 'fixture-sensor-provider',
        availability: 'available',
        current: measurement(52.4, 'celsius'),
        reason: null
      }]
    },
    network: {
      metadata: metadata('fixture.windows-network'),
      availability: 'online',
      latency: optionalMetric(24, 'milliseconds'),
      traffic: {
        upload_rate: optionalMetric(625_000, 'bytes_per_second'),
        download_rate: optionalMetric(3_125_000, 'bytes_per_second'),
        cumulative_sent: optionalMetric(4 * GB, 'bytes'),
        cumulative_received: optionalMetric(32 * GB, 'bytes')
      },
      interface_summary: {
        active_count: 1,
        primary: {
          id: 'fixture-interface-primary',
          name: 'Fixture Ethernet',
          connection_type: 'ethernet'
        }
      }
    },
    mihomo: {
      metadata: metadata('fixture.mihomo'),
      state: 'healthy',
      controller_availability: 'available',
      reachable: true,
      connected: true,
      mode: 'rule',
      current_proxy_summary: 'Fixture Auto Select',
      traffic: {
        upload_rate: measurement(120_000, 'bytes_per_second'),
        download_rate: measurement(1_000_000, 'bytes_per_second')
      },
      last_successful_observation: OBSERVED_AT,
      reason: null
    },
    health: {
      schema_version: '0.1',
      status: 'healthy',
      reasons: [],
      affected_components: [],
      evaluated_at: OBSERVED_AT,
      evidence: [
        'system.cpu.utilization',
        'system.memory.utilization',
        'system.disks[0].utilization',
        'network.availability'
      ]
    },
    anomalies: []
  };
}

function healthyDevice() {
  return baseSnapshot('healthy_device');
}

function highCpu() {
  const snapshot = baseSnapshot('high_cpu');
  snapshot.system.cpu.utilization.value = 96;
  snapshot.health = {
    schema_version: '0.1',
    status: 'warning',
    reasons: [{ code: 'CPU_HIGH', message: 'CPU utilization is above the fixture warning threshold.' }],
    affected_components: ['cpu'],
    evaluated_at: OBSERVED_AT,
    evidence: ['system.cpu.utilization']
  };
  snapshot.anomalies.push(anomaly('fixture-high-cpu', 'sustained_high_cpu', 'warning', 'cpu', 'CPU utilization is persistently high.', ['system.cpu.utilization'], 'Inspect active workloads.'));
  return snapshot;
}

function memoryPressure() {
  const snapshot = baseSnapshot('memory_pressure');
  snapshot.system.memory = capacity(16 * GB, 15 * GB);
  snapshot.health = {
    schema_version: '0.1',
    status: 'warning',
    reasons: [{ code: 'MEMORY_PRESSURE', message: 'Available memory is low.' }],
    affected_components: ['memory'],
    evaluated_at: OBSERVED_AT,
    evidence: ['system.memory.utilization']
  };
  snapshot.anomalies.push(anomaly('fixture-memory-pressure', 'memory_pressure', 'warning', 'memory', 'Memory pressure is high.', ['system.memory.utilization'], 'Close unused applications.'));
  return snapshot;
}

function lowDisk() {
  const snapshot = baseSnapshot('low_disk');
  snapshot.system.disks[0] = {
    volume_id: 'fixture-volume-system',
    label: 'System',
    ...capacity(512 * GB, 500 * GB)
  };
  snapshot.health = {
    schema_version: '0.1',
    status: 'critical',
    reasons: [{ code: 'DISK_LOW', message: 'System volume free space is critically low.' }],
    affected_components: ['disk'],
    evaluated_at: OBSERVED_AT,
    evidence: ['system.disks[0].available']
  };
  snapshot.anomalies.push(anomaly('fixture-low-disk', 'low_disk_space', 'critical', 'disk', 'System volume has insufficient free space.', ['system.disks[0].available'], 'Remove or archive nonessential files.'));
  return snapshot;
}

function temperatureUnavailable() {
  const snapshot = baseSnapshot('temperature_unavailable');
  snapshot.system.temperatures[0] = {
    sensor_id: 'fixture-cpu-package',
    source: 'fixture-sensor-provider',
    availability: 'unavailable',
    current: null,
    reason: 'No compatible temperature sensor is currently exposed.'
  };
  return snapshot;
}

function gpuUnsupported() {
  const snapshot = baseSnapshot('gpu_unsupported');
  snapshot.system.gpu = {
    availability: 'unsupported',
    name: null,
    utilization: null,
    memory: null,
    reason: 'The active provider does not support GPU metrics.'
  };
  return snapshot;
}

function highNetworkLatency() {
  const snapshot = baseSnapshot('high_network_latency');
  snapshot.network.availability = 'degraded';
  snapshot.network.latency.current.value = 450;
  snapshot.health = {
    schema_version: '0.1',
    status: 'warning',
    reasons: [{ code: 'NETWORK_LATENCY_HIGH', message: 'Network latency is elevated.' }],
    affected_components: ['network'],
    evaluated_at: OBSERVED_AT,
    evidence: ['network.latency']
  };
  snapshot.anomalies.push(anomaly('fixture-high-latency', 'high_network_latency', 'warning', 'network', 'Network latency is above the fixture warning threshold.', ['network.latency']));
  return snapshot;
}

function networkUnavailable() {
  const snapshot = baseSnapshot('network_unavailable');
  snapshot.network.availability = 'offline';
  snapshot.network.latency = unavailableMetric('No active route is available.');
  snapshot.network.traffic = {
    upload_rate: unavailableMetric('No active network interface.'),
    download_rate: unavailableMetric('No active network interface.'),
    cumulative_sent: unavailableMetric('No active network interface.'),
    cumulative_received: unavailableMetric('No active network interface.')
  };
  snapshot.network.interface_summary = { active_count: 0, primary: null };
  snapshot.health = {
    schema_version: '0.1',
    status: 'warning',
    reasons: [{ code: 'NETWORK_OFFLINE', message: 'Network is unavailable.' }],
    affected_components: ['network'],
    evaluated_at: OBSERVED_AT,
    evidence: ['network.availability']
  };
  snapshot.anomalies.push(anomaly('fixture-network-offline', 'network_unreachable', 'warning', 'network', 'Network is unavailable.', ['network.availability']));
  return snapshot;
}

function mihomoHealthy() {
  return baseSnapshot('mihomo_healthy');
}

function mihomoControllerUnavailable() {
  const snapshot = baseSnapshot('mihomo_controller_unavailable');
  snapshot.mihomo = {
    metadata: metadata('fixture.mihomo'),
    state: 'unavailable',
    controller_availability: 'unavailable',
    reachable: false,
    connected: false,
    mode: null,
    current_proxy_summary: null,
    traffic: { upload_rate: null, download_rate: null },
    last_successful_observation: '2026-08-10T01:55:00.000Z',
    reason: 'Mihomo External Controller is not reachable.'
  };
  snapshot.anomalies.push(anomaly('fixture-mihomo-unavailable', 'mihomo_controller_unreachable', 'warning', 'mihomo', 'Mihomo controller is unavailable.', ['mihomo.controller_availability']));
  return snapshot;
}

function multipleAnomalies() {
  const snapshot = baseSnapshot('multiple_anomalies');
  snapshot.system.cpu.utilization.value = 98;
  snapshot.system.memory = capacity(16 * GB, 15.5 * GB);
  snapshot.system.disks[0] = {
    volume_id: 'fixture-volume-system',
    label: 'System',
    ...capacity(512 * GB, 501 * GB)
  };
  snapshot.health = {
    schema_version: '0.1',
    status: 'critical',
    reasons: [
      { code: 'CPU_HIGH', message: 'CPU utilization is high.' },
      { code: 'MEMORY_PRESSURE', message: 'Available memory is low.' },
      { code: 'DISK_LOW', message: 'System volume free space is critically low.' }
    ],
    affected_components: ['cpu', 'memory', 'disk'],
    evaluated_at: OBSERVED_AT,
    evidence: ['system.cpu.utilization', 'system.memory.utilization', 'system.disks[0].available']
  };
  snapshot.anomalies = [
    anomaly('fixture-multi-cpu', 'sustained_high_cpu', 'warning', 'cpu', 'CPU utilization is persistently high.', ['system.cpu.utilization']),
    anomaly('fixture-multi-memory', 'memory_pressure', 'warning', 'memory', 'Memory pressure is high.', ['system.memory.utilization']),
    anomaly('fixture-multi-disk', 'low_disk_space', 'critical', 'disk', 'System volume has insufficient free space.', ['system.disks[0].available'])
  ];
  return snapshot;
}

function staleMetrics() {
  const snapshot = baseSnapshot('stale_metrics');
  snapshot.system.metadata = metadata('fixture.windows-system', 'stale');
  snapshot.network.metadata = metadata('fixture.windows-network', 'stale');
  snapshot.mihomo.metadata = metadata('fixture.mihomo', 'stale');
  snapshot.health = {
    schema_version: '0.1',
    status: 'unknown',
    reasons: [{ code: 'METRICS_STALE', message: 'The latest observations are stale.' }],
    affected_components: ['system', 'network', 'mihomo'],
    evaluated_at: OBSERVED_AT,
    evidence: ['system.metadata.freshness', 'network.metadata.freshness', 'mihomo.metadata.freshness']
  };
  return snapshot;
}

const SCENARIOS = Object.freeze({
  healthy_device: healthyDevice,
  high_cpu: highCpu,
  memory_pressure: memoryPressure,
  low_disk: lowDisk,
  temperature_unavailable: temperatureUnavailable,
  gpu_unsupported: gpuUnsupported,
  high_network_latency: highNetworkLatency,
  network_unavailable: networkUnavailable,
  mihomo_healthy: mihomoHealthy,
  mihomo_controller_unavailable: mihomoControllerUnavailable,
  multiple_anomalies: multipleAnomalies,
  stale_metrics: staleMetrics
});

function loadScenario(id) {
  const factory = SCENARIOS[id];
  if (!factory) throw new Error(`Unknown fixture scenario: ${id}`);
  return factory();
}

function loadAllScenarios() {
  return Object.keys(SCENARIOS).map(loadScenario);
}

module.exports = { SCENARIOS, loadAllScenarios, loadScenario };
