'use strict';

const SCHEMA_VERSION = '0.1';

const MetricAvailability = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error'
});

const FreshnessState = Object.freeze({
  FRESH: 'fresh',
  STALE: 'stale',
  UNKNOWN: 'unknown'
});

const NetworkAvailability = Object.freeze({
  ONLINE: 'online',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown'
});

const HealthStatus = Object.freeze({
  HEALTHY: 'healthy',
  WARNING: 'warning',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown'
});

const AnomalySeverity = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
});

const AnomalyStatus = Object.freeze({
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved'
});

const MihomoStatusState = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown'
});

const enumValues = (definition) => new Set(Object.values(definition));

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'object required');
}

function requireArray(value, path) {
  if (!Array.isArray(value)) fail(path, 'array required');
}

function requireString(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'non-empty string required');
}

function requireNumber(value, path, { min = -Infinity, integer = false, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    fail(path, `${integer ? 'integer' : 'finite number'} >= ${min} required`);
  }
}

function requireBoolean(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'boolean') fail(path, 'boolean required');
}

function requireIsoDate(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  requireString(value, path);
  if (!Number.isFinite(Date.parse(value))) fail(path, 'ISO date-time required');
}

function requireEnum(value, definition, path) {
  if (!enumValues(definition).has(value)) fail(path, `expected one of ${[...enumValues(definition)].join(', ')}`);
}

function validateFreshness(value, path) {
  requireObject(value, path);
  requireEnum(value.state, FreshnessState, `${path}.state`);
  requireNumber(value.age_ms, `${path}.age_ms`, { min: 0, integer: true });
  requireNumber(value.stale_after_ms, `${path}.stale_after_ms`, { min: 1, integer: true });
  if (value.state === FreshnessState.STALE && value.age_ms <= value.stale_after_ms) {
    fail(path, 'stale requires age_ms > stale_after_ms');
  }
  if (value.state === FreshnessState.FRESH && value.age_ms > value.stale_after_ms) {
    fail(path, 'fresh requires age_ms <= stale_after_ms');
  }
}

function validateMetadata(value, path) {
  requireObject(value, path);
  if (value.schema_version !== SCHEMA_VERSION) fail(`${path}.schema_version`, `must be ${SCHEMA_VERSION}`);
  requireIsoDate(value.collected_at, `${path}.collected_at`);
  requireObject(value.provider, `${path}.provider`);
  requireString(value.provider.id, `${path}.provider.id`);
  requireString(value.provider.kind, `${path}.provider.kind`);
  validateFreshness(value.freshness, `${path}.freshness`);
}

function validateMeasurement(value, allowedUnits, path) {
  requireObject(value, path);
  requireNumber(value.value, `${path}.value`);
  requireString(value.unit, `${path}.unit`);
  if (!allowedUnits.includes(value.unit)) fail(`${path}.unit`, `expected ${allowedUnits.join(' or ')}`);
  if (value.unit === 'percent' && (value.value < 0 || value.value > 100)) {
    fail(`${path}.value`, 'percent must be between 0 and 100');
  }
  if (['bytes', 'bytes_per_second', 'milliseconds'].includes(value.unit) && value.value < 0) {
    fail(`${path}.value`, `${value.unit} must not be negative`);
  }
  if (value.unit === 'celsius' && value.value < -273.15) {
    fail(`${path}.value`, 'temperature cannot be below absolute zero');
  }
}

function validateAvailableBlock(value, path, validateContent) {
  requireObject(value, path);
  requireEnum(value.availability, MetricAvailability, `${path}.availability`);
  if (value.availability === MetricAvailability.AVAILABLE) {
    if (value.reason !== null) fail(`${path}.reason`, 'available metric reason must be null');
    validateContent();
  } else {
    requireString(value.reason, `${path}.reason`);
  }
}

function validateCapacity(value, path) {
  validateAvailableBlock(value, path, () => {
    validateMeasurement(value.total, ['bytes'], `${path}.total`);
    validateMeasurement(value.used, ['bytes'], `${path}.used`);
    validateMeasurement(value.available, ['bytes'], `${path}.available`);
    validateMeasurement(value.utilization, ['percent'], `${path}.utilization`);
    if (value.used.value + value.available.value > value.total.value + 1) fail(path, 'used + available exceeds total');
  });
  if (value.availability !== MetricAvailability.AVAILABLE) {
    for (const field of ['total', 'used', 'available', 'utilization']) {
      if (value[field] !== null) fail(`${path}.${field}`, 'must be null when metric is not available');
    }
  }
}

function validateSystemMetrics(value) {
  requireObject(value, 'systemMetrics');
  validateMetadata(value.metadata, 'systemMetrics.metadata');

  validateAvailableBlock(value.cpu, 'systemMetrics.cpu', () => {
    validateMeasurement(value.cpu.utilization, ['percent'], 'systemMetrics.cpu.utilization');
    requireNumber(value.cpu.logical_processors, 'systemMetrics.cpu.logical_processors', { min: 1, integer: true });
    requireNumber(value.cpu.physical_cores, 'systemMetrics.cpu.physical_cores', { min: 1, integer: true, nullable: true });
    if (value.cpu.physical_cores === null) {
      requireEnum(value.cpu.physical_cores_availability, MetricAvailability, 'systemMetrics.cpu.physical_cores_availability');
      if (value.cpu.physical_cores_availability === MetricAvailability.AVAILABLE) {
        fail('systemMetrics.cpu.physical_cores_availability', 'cannot be available when physical_cores is null');
      }
    } else if (Object.hasOwn(value.cpu, 'physical_cores_availability')) {
      if (value.cpu.physical_cores_availability !== MetricAvailability.AVAILABLE) {
        fail('systemMetrics.cpu.physical_cores_availability', 'must be available when physical_cores has a value');
      }
    }
  });
  if (value.cpu.availability !== MetricAvailability.AVAILABLE) {
    if (value.cpu.utilization !== null || value.cpu.logical_processors !== null || value.cpu.physical_cores !== null) {
      fail('systemMetrics.cpu', 'measurements must be null when CPU is not available');
    }
  }

  validateAvailableBlock(value.gpu, 'systemMetrics.gpu', () => {
    requireString(value.gpu.name, 'systemMetrics.gpu.name', { nullable: true });
    validateMeasurement(value.gpu.utilization, ['percent'], 'systemMetrics.gpu.utilization');
    if (value.gpu.memory !== null) validateCapacity(value.gpu.memory, 'systemMetrics.gpu.memory');
  });
  if (value.gpu.availability !== MetricAvailability.AVAILABLE) {
    if (value.gpu.name !== null || value.gpu.utilization !== null || value.gpu.memory !== null) {
      fail('systemMetrics.gpu', 'measurements must be null when GPU is not available');
    }
  }

  validateCapacity(value.memory, 'systemMetrics.memory');
  requireArray(value.disks, 'systemMetrics.disks');
  if (value.disks.length === 0) fail('systemMetrics.disks', 'at least one volume required');
  value.disks.forEach((disk, index) => {
    requireString(disk.volume_id, `systemMetrics.disks[${index}].volume_id`);
    requireString(disk.label, `systemMetrics.disks[${index}].label`, { nullable: true });
    validateCapacity(disk, `systemMetrics.disks[${index}]`);
  });

  requireArray(value.temperatures, 'systemMetrics.temperatures');
  if (value.temperatures.length === 0) fail('systemMetrics.temperatures', 'at least one sensor state required');
  value.temperatures.forEach((sensor, index) => {
    const path = `systemMetrics.temperatures[${index}]`;
    requireString(sensor.sensor_id, `${path}.sensor_id`);
    requireString(sensor.source, `${path}.source`);
    if (Object.hasOwn(sensor, 'component')) requireString(sensor.component, `${path}.component`);
    if (Object.hasOwn(sensor, 'sensor_name')) requireString(sensor.sensor_name, `${path}.sensor_name`);
    if (Object.hasOwn(sensor, 'confidence') && !['high', 'medium', 'low'].includes(sensor.confidence)) fail(`${path}.confidence`, 'expected high, medium or low');
    if (Object.hasOwn(sensor, 'sensor_class')) requireString(sensor.sensor_class, `${path}.sensor_class`);
    if (Object.hasOwn(sensor, 'observed_at')) requireIsoDate(sensor.observed_at, `${path}.observed_at`);
    if (Object.hasOwn(sensor, 'freshness')) validateFreshness(sensor.freshness, `${path}.freshness`);
    validateAvailableBlock(sensor, path, () => validateMeasurement(sensor.current, ['celsius'], `${path}.current`));
    if (sensor.availability !== MetricAvailability.AVAILABLE && sensor.current !== null) {
      fail(`${path}.current`, 'must be null when temperature is not available');
    }
  });
  return value;
}

function validateOptionalMetric(value, units, path) {
  validateAvailableBlock(value, path, () => validateMeasurement(value.current, units, `${path}.current`));
  if (value.availability !== MetricAvailability.AVAILABLE && value.current !== null) {
    fail(`${path}.current`, 'must be null when metric is not available');
  }
}

function validateNetworkMetrics(value) {
  requireObject(value, 'networkMetrics');
  validateMetadata(value.metadata, 'networkMetrics.metadata');
  requireEnum(value.availability, NetworkAvailability, 'networkMetrics.availability');
  validateOptionalMetric(value.latency, ['milliseconds'], 'networkMetrics.latency');
  requireObject(value.traffic, 'networkMetrics.traffic');
  validateOptionalMetric(value.traffic.upload_rate, ['bytes_per_second'], 'networkMetrics.traffic.upload_rate');
  validateOptionalMetric(value.traffic.download_rate, ['bytes_per_second'], 'networkMetrics.traffic.download_rate');
  validateOptionalMetric(value.traffic.cumulative_sent, ['bytes'], 'networkMetrics.traffic.cumulative_sent');
  validateOptionalMetric(value.traffic.cumulative_received, ['bytes'], 'networkMetrics.traffic.cumulative_received');
  requireObject(value.interface_summary, 'networkMetrics.interface_summary');
  requireNumber(value.interface_summary.active_count, 'networkMetrics.interface_summary.active_count', { min: 0, integer: true });
  for (const field of ['gateway_present', 'dns_present', 'address_present']) {
    if (Object.hasOwn(value.interface_summary, field)) {
      requireBoolean(value.interface_summary[field], `networkMetrics.interface_summary.${field}`, { nullable: true });
    }
  }
  if (value.interface_summary.primary !== null) {
    requireObject(value.interface_summary.primary, 'networkMetrics.interface_summary.primary');
    requireString(value.interface_summary.primary.id, 'networkMetrics.interface_summary.primary.id');
    requireString(value.interface_summary.primary.name, 'networkMetrics.interface_summary.primary.name');
    requireString(value.interface_summary.primary.connection_type, 'networkMetrics.interface_summary.primary.connection_type');
  }
  if (value.availability === NetworkAvailability.OFFLINE && value.interface_summary.active_count !== 0) {
    fail('networkMetrics.interface_summary.active_count', 'offline network must have zero active interfaces');
  }
  if (Object.hasOwn(value, 'interfaces')) {
    requireArray(value.interfaces, 'networkMetrics.interfaces');
    value.interfaces.forEach((entry, index) => {
      requireObject(entry, `networkMetrics.interfaces[${index}]`);
      for (const field of ['gateway_present', 'dns_present', 'address_present']) {
        if (Object.hasOwn(entry, field)) {
          requireBoolean(entry[field], `networkMetrics.interfaces[${index}].${field}`, { nullable: true });
        }
      }
    });
  }
  return value;
}

function validateMihomoStatus(value) {
  requireObject(value, 'mihomoStatus');
  validateMetadata(value.metadata, 'mihomoStatus.metadata');
  requireEnum(value.state, MihomoStatusState, 'mihomoStatus.state');
  requireEnum(value.controller_availability, MetricAvailability, 'mihomoStatus.controller_availability');
  if (typeof value.reachable !== 'boolean') fail('mihomoStatus.reachable', 'boolean required');
  if (typeof value.connected !== 'boolean') fail('mihomoStatus.connected', 'boolean required');
  requireString(value.mode, 'mihomoStatus.mode', { nullable: true });
  requireString(value.current_proxy_summary, 'mihomoStatus.current_proxy_summary', { nullable: true });
  requireIsoDate(value.last_successful_observation, 'mihomoStatus.last_successful_observation', { nullable: true });
  requireString(value.reason, 'mihomoStatus.reason', { nullable: true });
  requireObject(value.traffic, 'mihomoStatus.traffic');
  for (const field of ['upload_rate', 'download_rate']) {
    if (value.traffic[field] !== null) validateMeasurement(value.traffic[field], ['bytes_per_second'], `mihomoStatus.traffic.${field}`);
  }
  if (value.controller_availability !== MetricAvailability.AVAILABLE && value.reachable) {
    fail('mihomoStatus.reachable', 'controller cannot be reachable when unavailable');
  }
  if (value.controller_availability !== MetricAvailability.AVAILABLE) {
    if (value.mode !== null || value.current_proxy_summary !== null || value.traffic.upload_rate !== null || value.traffic.download_rate !== null) {
      fail('mihomoStatus', 'controller-derived values must be null when controller is not available');
    }
  }
  if (value.state === MihomoStatusState.HEALTHY) {
    if (value.controller_availability !== MetricAvailability.AVAILABLE || !value.reachable || !value.connected || value.reason !== null) {
      fail('mihomoStatus', 'healthy state requires an available, reachable, connected controller and null reason');
    }
  }
  return value;
}

function validateDeviceHealth(value) {
  requireObject(value, 'deviceHealth');
  if (value.schema_version !== SCHEMA_VERSION) fail('deviceHealth.schema_version', `must be ${SCHEMA_VERSION}`);
  requireEnum(value.status, HealthStatus, 'deviceHealth.status');
  requireArray(value.reasons, 'deviceHealth.reasons');
  value.reasons.forEach((reason, index) => {
    requireObject(reason, `deviceHealth.reasons[${index}]`);
    requireString(reason.code, `deviceHealth.reasons[${index}].code`);
    requireString(reason.message, `deviceHealth.reasons[${index}].message`);
  });
  requireArray(value.affected_components, 'deviceHealth.affected_components');
  value.affected_components.forEach((component, index) => requireString(component, `deviceHealth.affected_components[${index}]`));
  requireIsoDate(value.evaluated_at, 'deviceHealth.evaluated_at');
  requireArray(value.evidence, 'deviceHealth.evidence');
  value.evidence.forEach((reference, index) => requireString(reference, `deviceHealth.evidence[${index}]`));
  return value;
}

function validateAnomaly(value, index = 0) {
  const path = `anomalies[${index}]`;
  requireObject(value, path);
  if (value.schema_version !== SCHEMA_VERSION) fail(`${path}.schema_version`, `must be ${SCHEMA_VERSION}`);
  for (const field of ['anomaly_id', 'type', 'title', 'summary', 'component', 'source']) {
    requireString(value[field], `${path}.${field}`);
  }
  requireEnum(value.severity, AnomalySeverity, `${path}.severity`);
  requireEnum(value.status, AnomalyStatus, `${path}.status`);
  requireIsoDate(value.detected_at, `${path}.detected_at`);
  requireIsoDate(value.last_seen_at, `${path}.last_seen_at`);
  requireArray(value.evidence, `${path}.evidence`);
  value.evidence.forEach((reference, evidenceIndex) => requireString(reference, `${path}.evidence[${evidenceIndex}]`));
  requireString(value.remediation_hint, `${path}.remediation_hint`, { nullable: true });
  return value;
}

function validateDeviceNetworkSnapshot(value) {
  requireObject(value, 'snapshot');
  if (Object.hasOwn(value, 'scenario_id')) requireString(value.scenario_id, 'snapshot.scenario_id');
  else requireString(value.snapshot_id, 'snapshot.snapshot_id');
  validateSystemMetrics(value.system);
  validateNetworkMetrics(value.network);
  validateMihomoStatus(value.mihomo);
  validateDeviceHealth(value.health);
  requireArray(value.anomalies, 'snapshot.anomalies');
  value.anomalies.forEach(validateAnomaly);
  return value;
}

module.exports = {
  AnomalySeverity,
  AnomalyStatus,
  FreshnessState,
  HealthStatus,
  MetricAvailability,
  MihomoStatusState,
  NetworkAvailability,
  SCHEMA_VERSION,
  validateAnomaly,
  validateDeviceHealth,
  validateDeviceNetworkSnapshot,
  validateMihomoStatus,
  validateNetworkMetrics,
  validateSystemMetrics
};
