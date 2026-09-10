'use strict';

const {
  MetricAvailability,
  NetworkAvailability,
  validateDeviceNetworkSnapshot,
  validateNetworkMetrics,
  validateSystemMetrics
} = require('./contracts');

const ADAPTER_CAPABILITIES = Object.freeze({
  existingRuntime: Object.freeze({
    phase: 'bridge_contract',
    capabilities: Object.freeze(['runtime_status', 'device_summary', 'service_status', 'hub_status']),
    not_exposed: Object.freeze(['application_usage', 'long_term_history']),
    source: 'token-monitor deviceRuntime/hub',
    real_access: false,
    bridge_ready: true,
    host_binding: 'contract_ready'
  }),
  windowsSystem: Object.freeze({
    phase: 'read_only_collector',
    capabilities: Object.freeze(['cpu', 'gpu', 'memory', 'disk', 'temperature']),
    implemented: Object.freeze(['cpu', 'memory', 'disk', 'gpu_utilization', 'gpu_temperature']),
    deferred: Object.freeze(['cpu_temperature']),
    source: 'WindowsSystemCollector',
    real_access: true
  }),
  windowsNetwork: Object.freeze({
    phase: 'read_only_collector',
    capabilities: Object.freeze(['latency', 'interfaces', 'upload_rate', 'download_rate', 'cumulative_traffic']),
    implemented: Object.freeze(['interfaces', 'upload_rate', 'download_rate', 'cumulative_traffic']),
    deferred: Object.freeze(['latency']),
    source: 'WindowsNetworkCollector',
    real_access: true
  }),
  mihomo: Object.freeze({
    phase: 'fixture_only',
    capabilities: Object.freeze(['controller_reachability', 'mode', 'proxy_summary', 'traffic_summary']),
    source: 'future Mihomo External Controller adapter',
    real_access: false
  })
});

class ExistingRuntimeAdapter {
  async observeRuntime() {
    throw new Error('ExistingRuntimeAdapter.observeRuntime is not implemented');
  }
}

class WindowsSystemMetricsAdapter {
  async collectSystemMetrics() {
    throw new Error('WindowsSystemMetricsAdapter.collectSystemMetrics is not implemented');
  }
}

class WindowsNetworkMetricsAdapter {
  async collectNetworkMetrics() {
    throw new Error('WindowsNetworkMetricsAdapter.collectNetworkMetrics is not implemented');
  }
}

class MihomoAdapter {
  async observeMihomoStatus() {
    throw new Error('MihomoAdapter.observeMihomoStatus is not implemented');
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FixtureDeviceNetworkAdapter {
  constructor(snapshot) {
    validateDeviceNetworkSnapshot(snapshot);
    this.snapshot = clone(snapshot);
  }

  async getSnapshot() {
    return clone(this.snapshot);
  }

  async collectSystemMetrics() {
    return clone(this.snapshot.system);
  }

  async collectNetworkMetrics() {
    return clone(this.snapshot.network);
  }

  async observeMihomoStatus() {
    return clone(this.snapshot.mihomo);
  }

  async observeRuntime() {
    return {
      schema_version: '0.1',
      state: this.snapshot.health.status,
      observed_at: this.snapshot.health.evaluated_at,
      source: 'fixture'
    };
  }
}

function measurement(value, unit) {
  return { value, unit };
}

function unavailableCapacity(reason) {
  return {
    availability: MetricAvailability.UNAVAILABLE,
    total: null,
    used: null,
    available: null,
    utilization: null,
    reason
  };
}

function capacityFromRaw(totalBytes, availableBytes, reason) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(availableBytes)
    || availableBytes < 0 || availableBytes > totalBytes) {
    return unavailableCapacity(reason);
  }
  const usedBytes = totalBytes - availableBytes;
  return {
    availability: MetricAvailability.AVAILABLE,
    total: measurement(totalBytes, 'bytes'),
    used: measurement(usedBytes, 'bytes'),
    available: measurement(availableBytes, 'bytes'),
    utilization: measurement(Math.min(100, Math.max(0, usedBytes / totalBytes * 100)), 'percent'),
    reason: null
  };
}

function normalizeCpu(rawCpu) {
  if (rawCpu?.availability !== MetricAvailability.AVAILABLE
    || !Number.isFinite(rawCpu.utilizationPercent)
    || rawCpu.utilizationPercent < 0
    || rawCpu.utilizationPercent > 100
    || !Number.isInteger(rawCpu.logicalProcessors)
    || rawCpu.logicalProcessors < 1) {
    return {
      availability: MetricAvailability.UNAVAILABLE,
      utilization: null,
      logical_processors: null,
      physical_cores: null,
      physical_cores_availability: MetricAvailability.UNAVAILABLE,
      reason: rawCpu?.reason || 'CPU sample is unavailable.'
    };
  }
  return {
    availability: MetricAvailability.AVAILABLE,
    utilization: measurement(rawCpu.utilizationPercent, 'percent'),
    model: typeof rawCpu.model === 'string' ? rawCpu.model : null,
    logical_processors: rawCpu.logicalProcessors,
    physical_cores: Number.isInteger(rawCpu.physicalCores) && rawCpu.physicalCores > 0 ? rawCpu.physicalCores : null,
    physical_cores_availability: Number.isInteger(rawCpu.physicalCores) && rawCpu.physicalCores > 0 ? MetricAvailability.AVAILABLE : MetricAvailability.UNAVAILABLE,
    reason: null
  };
}

function normalizeDisks(rawDisks) {
  if (rawDisks?.availability !== MetricAvailability.AVAILABLE || !Array.isArray(rawDisks.volumes)) {
    return [{
      volume_id: 'windows-fixed-disks',
      label: null,
      ...unavailableCapacity(rawDisks?.reason || 'Fixed disk data is unavailable.')
    }];
  }
  const disks = rawDisks.volumes.flatMap((volume) => {
    if (typeof volume?.deviceId !== 'string' || volume.deviceId.trim() === '') return [];
    const capacity = capacityFromRaw(
      volume.totalBytes,
      volume.availableBytes,
      `Invalid capacity data for ${volume.deviceId}.`
    );
    if (capacity.availability !== MetricAvailability.AVAILABLE) return [];
    return [{ volume_id: volume.deviceId, label: null, ...capacity }];
  });
  if (disks.length > 0) return disks;
  return [{
    volume_id: 'windows-fixed-disks',
    label: null,
    ...unavailableCapacity('No valid fixed disk volume was returned.')
  }];
}

function normalizeWindowsSystemMetrics(raw, { staleAfterMs = 60_000 } = {}) {
  const collectedAt = Number.isFinite(Date.parse(raw?.collectedAt))
    ? raw.collectedAt
    : new Date().toISOString();
  const systemMetrics = {
    metadata: {
      schema_version: '0.1',
      collected_at: collectedAt,
      provider: { id: 'windows-system', kind: 'windows' },
      freshness: { state: 'fresh', age_ms: 0, stale_after_ms: staleAfterMs }
    },
    host: raw?.host?.availability === MetricAvailability.AVAILABLE
      ? {
          availability: MetricAvailability.AVAILABLE,
          name: raw.host.name,
          platform: raw.host.platform,
          version: raw.host.version,
          release: raw.host.release,
          build: raw.host.build || null,
          reason: null
        }
      : {
          availability: MetricAvailability.UNAVAILABLE,
          name: null,
          platform: null,
          version: null,
          release: null,
          build: null,
          reason: raw?.host?.reason || 'Host identity is unavailable.'
        },
    cpu: normalizeCpu(raw?.cpu ? { ...raw.cpu, model: raw?.host?.cpuModel || null } : raw?.cpu),
    gpu: {
      availability: MetricAvailability.UNSUPPORTED,
      name: null,
      utilization: null,
      memory: null,
      reason: 'GPU collection is deferred in NEXA-DEVICE-NET-002.'
    },
    memory: raw?.memory?.availability === MetricAvailability.AVAILABLE
      ? capacityFromRaw(raw.memory.totalBytes, raw.memory.availableBytes, 'RAM sample is invalid.')
      : unavailableCapacity(raw?.memory?.reason || 'RAM sample is unavailable.'),
    disks: normalizeDisks(raw?.disks),
    temperatures: [{
      sensor_id: 'windows-temperature',
      source: 'windows-system',
      availability: MetricAvailability.UNAVAILABLE,
      current: null,
      reason: 'Temperature collection is deferred in NEXA-DEVICE-NET-002.'
    }]
  };
  validateSystemMetrics(systemMetrics);
  return systemMetrics;
}

class WindowsSystemCollectorAdapter extends WindowsSystemMetricsAdapter {
  constructor(collector, options = {}) {
    super();
    if (!collector || typeof collector.collectRaw !== 'function') {
      throw new TypeError('WindowsSystemCollectorAdapter requires a collector with collectRaw()');
    }
    this.collector = collector;
    this.options = options;
  }

  async collectSystemMetrics() {
    const raw = await this.collector.collectRaw();
    return normalizeWindowsSystemMetrics(raw, this.options);
  }
}

function unavailableOptionalMetric(reason) {
  return { availability: MetricAvailability.UNAVAILABLE, current: null, reason };
}

function optionalMetricFromRaw(rawMetric, unit, fallbackReason) {
  if (rawMetric?.availability !== MetricAvailability.AVAILABLE
    || !Number.isFinite(rawMetric.value)
    || rawMetric.value < 0) {
    return unavailableOptionalMetric(rawMetric?.reason || fallbackReason);
  }
  return {
    availability: MetricAvailability.AVAILABLE,
    current: measurement(rawMetric.value, unit),
    reason: null
  };
}

function normalizeWindowsNetworkMetrics(raw, { staleAfterMs = 60_000 } = {}) {
  const collectedAt = Number.isFinite(Date.parse(raw?.collectedAt))
    ? raw.collectedAt
    : new Date().toISOString();
  const interfaceSampleAvailable = raw?.interfaces?.availability === MetricAvailability.AVAILABLE;
  const activeInterfaces = interfaceSampleAvailable && Array.isArray(raw.interfaces.active)
    ? raw.interfaces.active
    : [];
  const observedInterfaces = interfaceSampleAvailable && Array.isArray(raw.interfaces.observed)
    ? raw.interfaces.observed
    : activeInterfaces;
  const availability = !interfaceSampleAvailable
    ? NetworkAvailability.UNKNOWN
    : (activeInterfaces.length > 0 ? NetworkAvailability.ONLINE : NetworkAvailability.OFFLINE);
  const primary = activeInterfaces.length === 1
    ? {
        id: String(activeInterfaces[0].name),
        name: String(activeInterfaces[0].name),
        connection_type: String(activeInterfaces[0].category || 'unknown')
      }
    : null;
  const summarizePresence = (field) => {
    const values = activeInterfaces.map((entry) => entry[field]).filter((value) => typeof value === 'boolean');
    if (values.some(Boolean)) return true;
    return values.length === activeInterfaces.length && values.length > 0 ? false : null;
  };
  const networkMetrics = {
    metadata: {
      schema_version: '0.1',
      collected_at: collectedAt,
      provider: { id: 'windows-network', kind: 'windows' },
      freshness: { state: 'fresh', age_ms: 0, stale_after_ms: staleAfterMs }
    },
    availability,
    latency: unavailableOptionalMetric('Latency probing is deferred in NEXA-DEVICE-NET-003.'),
    traffic: {
      upload_rate: optionalMetricFromRaw(raw?.traffic?.uploadRate, 'bytes_per_second', 'Upload rate is unavailable.'),
      download_rate: optionalMetricFromRaw(raw?.traffic?.downloadRate, 'bytes_per_second', 'Download rate is unavailable.'),
      cumulative_sent: optionalMetricFromRaw(raw?.traffic?.cumulativeSent, 'bytes', 'Cumulative sent bytes are unavailable.'),
      cumulative_received: optionalMetricFromRaw(raw?.traffic?.cumulativeReceived, 'bytes', 'Cumulative received bytes are unavailable.')
    },
    interface_summary: {
      active_count: activeInterfaces.length,
      primary,
      gateway_present: summarizePresence('gatewayPresent'),
      dns_present: summarizePresence('dnsPresent'),
      address_present: summarizePresence('addressPresent')
    },
    interfaces: observedInterfaces.map((entry) => ({
      id: String(entry.id || '').slice(0, 128),
      interface_index: Number.isInteger(entry.interfaceIndex) ? entry.interfaceIndex : null,
      name: String(entry.name || '').slice(0, 128),
      description: String(entry.description || '').slice(0, 256),
      status: String(entry.status || ''),
      connection_type: String(entry.category || 'unknown'),
      adapter_class: entry.virtual === true ? 'virtual' : 'physical',
      recent_upload_rate: Number.isFinite(entry.uploadRate) ? entry.uploadRate : null,
      recent_download_rate: Number.isFinite(entry.downloadRate) ? entry.downloadRate : null,
      gateway_present: typeof entry.gatewayPresent === 'boolean' ? entry.gatewayPresent : null,
      dns_present: typeof entry.dnsPresent === 'boolean' ? entry.dnsPresent : null,
      address_present: typeof entry.addressPresent === 'boolean' ? entry.addressPresent : null
    }))
  };
  validateNetworkMetrics(networkMetrics);
  return networkMetrics;
}

class WindowsNetworkCollectorAdapter extends WindowsNetworkMetricsAdapter {
  constructor(collector, options = {}) {
    super();
    if (!collector || typeof collector.collectRaw !== 'function') {
      throw new TypeError('WindowsNetworkCollectorAdapter requires a collector with collectRaw()');
    }
    this.collector = collector;
    this.options = options;
  }

  async collectNetworkMetrics() {
    const raw = await this.collector.collectRaw();
    return normalizeWindowsNetworkMetrics(raw, this.options);
  }
}

module.exports = {
  ADAPTER_CAPABILITIES,
  ExistingRuntimeAdapter,
  FixtureDeviceNetworkAdapter,
  MihomoAdapter,
  WindowsNetworkCollectorAdapter,
  WindowsSystemCollectorAdapter,
  WindowsNetworkMetricsAdapter,
  WindowsSystemMetricsAdapter,
  normalizeWindowsNetworkMetrics,
  normalizeWindowsSystemMetrics
};
