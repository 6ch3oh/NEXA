'use strict';

const {
  FreshnessState,
  HealthStatus,
  MetricAvailability,
  NetworkAvailability,
  validateDeviceHealth,
  validateNetworkMetrics,
  validateSystemMetrics
} = require('./contracts');

const DEFAULT_HEALTH_POLICY = deepFreeze({
  schema_version: '0.1',
  cpu: { warning_percent: 85, critical_percent: 95 },
  memory: { warning_percent: 85, critical_percent: 95 },
  disk: { warning_percent: 85, critical_percent: 95 },
  temperature: { cpu: { warning_celsius: 90, critical_celsius: 100 }, gpu: { warning_celsius: 85, critical_celsius: 95 } }
});

const HealthReasonCode = Object.freeze({
  CPU_WARNING: 'CPU_UTILIZATION_WARNING',
  CPU_CRITICAL: 'CPU_UTILIZATION_CRITICAL',
  CPU_UNAVAILABLE: 'CPU_METRIC_UNAVAILABLE',
  CPU_STALE: 'CPU_METRIC_STALE',
  CPU_FRESHNESS_UNKNOWN: 'CPU_FRESHNESS_UNKNOWN',
  MEMORY_WARNING: 'RAM_UTILIZATION_WARNING',
  MEMORY_CRITICAL: 'RAM_UTILIZATION_CRITICAL',
  MEMORY_UNAVAILABLE: 'RAM_METRIC_UNAVAILABLE',
  MEMORY_STALE: 'RAM_METRIC_STALE',
  MEMORY_FRESHNESS_UNKNOWN: 'RAM_FRESHNESS_UNKNOWN',
  DISK_WARNING: 'DISK_UTILIZATION_WARNING',
  DISK_CRITICAL: 'DISK_UTILIZATION_CRITICAL',
  DISK_UNAVAILABLE: 'DISK_METRIC_UNAVAILABLE',
  DISK_STALE: 'DISK_METRIC_STALE',
  DISK_FRESHNESS_UNKNOWN: 'DISK_FRESHNESS_UNKNOWN',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  NETWORK_DEGRADED: 'NETWORK_DEGRADED',
  NETWORK_NO_ACTIVE_INTERFACE: 'NETWORK_NO_ACTIVE_INTERFACE',
  NETWORK_UNAVAILABLE: 'NETWORK_PROVIDER_UNAVAILABLE',
  NETWORK_STALE: 'NETWORK_METRIC_STALE',
  NETWORK_FRESHNESS_UNKNOWN: 'NETWORK_FRESHNESS_UNKNOWN',
  CPU_TEMPERATURE_WARNING: 'CPU_TEMPERATURE_WARNING',
  CPU_TEMPERATURE_CRITICAL: 'CPU_TEMPERATURE_CRITICAL',
  GPU_TEMPERATURE_WARNING: 'GPU_TEMPERATURE_WARNING',
  GPU_TEMPERATURE_CRITICAL: 'GPU_TEMPERATURE_CRITICAL',
  EVALUATION_FAILED: 'HEALTH_EVALUATION_FAILED'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function validateThresholds(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} policy must be an object.`);
  const warning = value.warning_percent;
  const critical = value.critical_percent;
  if (!Number.isFinite(warning) || !Number.isFinite(critical)
    || warning < 0 || critical > 100 || warning >= critical) {
    throw new RangeError(`${path} thresholds must satisfy 0 <= warning < critical <= 100.`);
  }
}
function validateTemperatureThresholds(value,path){if(!value||!Number.isFinite(value.warning_celsius)||!Number.isFinite(value.critical_celsius)||value.warning_celsius>=value.critical_celsius||value.warning_celsius<0||value.critical_celsius>150)throw new RangeError(`${path} temperature thresholds invalid.`);}

function createHealthPolicy(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Health policy overrides must be an object.');
  }
  const policy = {
    schema_version: '0.1',
    cpu: { ...DEFAULT_HEALTH_POLICY.cpu, ...(overrides.cpu || {}) },
    memory: { ...DEFAULT_HEALTH_POLICY.memory, ...(overrides.memory || {}) },
    disk: { ...DEFAULT_HEALTH_POLICY.disk, ...(overrides.disk || {}) },
    temperature: { cpu: { ...DEFAULT_HEALTH_POLICY.temperature.cpu, ...(overrides.temperature?.cpu||{}) }, gpu: { ...DEFAULT_HEALTH_POLICY.temperature.gpu, ...(overrides.temperature?.gpu||{}) } }
  };
  validateThresholds(policy.cpu, 'CPU');
  validateThresholds(policy.memory, 'RAM');
  validateThresholds(policy.disk, 'Disk');
  validateTemperatureThresholds(policy.temperature.cpu,'CPU');validateTemperatureThresholds(policy.temperature.gpu,'GPU');
  return deepFreeze(policy);
}

function issue(status, code, message, evidence) {
  return { status, reason: { code, message }, evidence };
}

function freshnessIssue(component, freshness, staleCode, unknownCode, evidence) {
  if (freshness === FreshnessState.STALE) {
    return issue(HealthStatus.UNKNOWN, staleCode, `${component} health is unknown because its metrics are stale.`, evidence);
  }
  if (freshness === FreshnessState.UNKNOWN) {
    return issue(HealthStatus.UNKNOWN, unknownCode, `${component} health is unknown because metric freshness is unknown.`, evidence);
  }
  return null;
}

function utilizationResult({ component, block, policy, warningCode, criticalCode, unavailableCode, evidence }) {
  if (block.availability !== MetricAvailability.AVAILABLE) {
    return {
      component,
      status: HealthStatus.UNKNOWN,
      issues: [issue(HealthStatus.UNKNOWN, unavailableCode, `${component} health is unknown because the metric is unavailable.`, evidence)],
      healthyEvidence: []
    };
  }
  const observed = block.utilization.value;
  if (observed >= policy.critical_percent) {
    return {
      component,
      status: HealthStatus.CRITICAL,
      issues: [issue(HealthStatus.CRITICAL, criticalCode,
        `${component} utilization ${observed}% meets the critical threshold ${policy.critical_percent}%.`, evidence)],
      healthyEvidence: []
    };
  }
  if (observed >= policy.warning_percent) {
    return {
      component,
      status: HealthStatus.WARNING,
      issues: [issue(HealthStatus.WARNING, warningCode,
        `${component} utilization ${observed}% meets the warning threshold ${policy.warning_percent}%.`, evidence)],
      healthyEvidence: []
    };
  }
  return { component, status: HealthStatus.HEALTHY, issues: [], healthyEvidence: [evidence] };
}

function systemComponentResult({ component, freshness, staleCode, unknownCode, evaluate }) {
  const freshnessProblem = freshnessIssue(component, freshness, staleCode, unknownCode, 'system.metadata.freshness');
  if (freshnessProblem) {
    return { component, status: HealthStatus.UNKNOWN, issues: [freshnessProblem], healthyEvidence: [] };
  }
  return evaluate();
}

function safeVolumeId(value) {
  const normalized = String(value || '').trim();
  if (/^[A-Za-z]:$/.test(normalized)) return normalized.toUpperCase();
  if (/^[A-Za-z0-9._-]{1,64}$/.test(normalized)) return normalized;
  return 'volume';
}

function evaluateDisks(system, policy) {
  const component = 'disk';
  const freshnessProblem = freshnessIssue(
    'Disk', system.metadata.freshness.state,
    HealthReasonCode.DISK_STALE, HealthReasonCode.DISK_FRESHNESS_UNKNOWN,
    'system.metadata.freshness'
  );
  if (freshnessProblem) return { component, status: HealthStatus.UNKNOWN, issues: [freshnessProblem], healthyEvidence: [] };

  const issues = [];
  const healthyEvidence = [];
  let status = HealthStatus.HEALTHY;
  system.disks.forEach((disk, index) => {
    const evidence = `system.disks[${index}].utilization`;
    const volumeId = safeVolumeId(disk.volume_id);
    if (disk.availability !== MetricAvailability.AVAILABLE) {
      issues.push(issue(HealthStatus.UNKNOWN, HealthReasonCode.DISK_UNAVAILABLE,
        `Disk ${volumeId} health is unknown because capacity metrics are unavailable.`, evidence));
      if (status === HealthStatus.HEALTHY) status = HealthStatus.UNKNOWN;
      return;
    }
    const observed = disk.utilization.value;
    if (observed >= policy.critical_percent) {
      issues.push(issue(HealthStatus.CRITICAL, HealthReasonCode.DISK_CRITICAL,
        `Disk ${volumeId} utilization ${observed}% meets the critical threshold ${policy.critical_percent}%.`, evidence));
      status = HealthStatus.CRITICAL;
    } else if (observed >= policy.warning_percent) {
      issues.push(issue(HealthStatus.WARNING, HealthReasonCode.DISK_WARNING,
        `Disk ${volumeId} utilization ${observed}% meets the warning threshold ${policy.warning_percent}%.`, evidence));
      if (status !== HealthStatus.CRITICAL) status = HealthStatus.WARNING;
    } else {
      healthyEvidence.push(evidence);
    }
  });
  return { component, status, issues, healthyEvidence };
}

function evaluateNetwork(network) {
  const component = 'network';
  const freshnessProblem = freshnessIssue(
    'Network', network.metadata.freshness.state,
    HealthReasonCode.NETWORK_STALE, HealthReasonCode.NETWORK_FRESHNESS_UNKNOWN,
    'network.metadata.freshness'
  );
  if (freshnessProblem) return { component, status: HealthStatus.UNKNOWN, issues: [freshnessProblem], healthyEvidence: [] };

  if (network.availability === NetworkAvailability.UNKNOWN) {
    return {
      component,
      status: HealthStatus.UNKNOWN,
      issues: [issue(HealthStatus.UNKNOWN, HealthReasonCode.NETWORK_UNAVAILABLE,
        'Network health is unknown because the provider could not determine availability.', 'network.availability')],
      healthyEvidence: []
    };
  }
  if (network.availability === NetworkAvailability.OFFLINE) {
    return {
      component,
      status: HealthStatus.WARNING,
      issues: [issue(HealthStatus.WARNING, HealthReasonCode.NETWORK_OFFLINE,
        'Network is confirmed offline with no active interface.', 'network.availability')],
      healthyEvidence: []
    };
  }
  if (network.availability === NetworkAvailability.DEGRADED) {
    return {
      component,
      status: HealthStatus.WARNING,
      issues: [issue(HealthStatus.WARNING, HealthReasonCode.NETWORK_DEGRADED,
        'Network availability is explicitly degraded.', 'network.availability')],
      healthyEvidence: []
    };
  }
  if (network.interface_summary.active_count < 1) {
    return {
      component,
      status: HealthStatus.WARNING,
      issues: [issue(HealthStatus.WARNING, HealthReasonCode.NETWORK_NO_ACTIVE_INTERFACE,
        'Network reported online but no active interface was observed.', 'network.interface_summary.active_count')],
      healthyEvidence: []
    };
  }
  return { component, status: HealthStatus.HEALTHY, issues: [], healthyEvidence: ['network.availability'] };
}
function evaluateTemperatures(sensors,policy){const rows=(sensors||[]).filter(x=>x.availability==='available'&&x.confidence==='high'&&['cpu','gpu'].includes(x.component)&&x.freshness?.state!=='stale');const issues=[],healthyEvidence=[];let status=HealthStatus.HEALTHY;for(const row of rows){const value=row.temperature_celsius??row.current?.value,component=row.component,threshold=policy[component],prefix=component.toUpperCase(),evidence=`system.temperatures.${component}`;if(value>=threshold.critical_celsius){issues.push(issue(HealthStatus.CRITICAL,HealthReasonCode[`${prefix}_TEMPERATURE_CRITICAL`],`${prefix} temperature meets the configured critical threshold.`,evidence));status=HealthStatus.CRITICAL;}else if(value>=threshold.warning_celsius){issues.push(issue(HealthStatus.WARNING,HealthReasonCode[`${prefix}_TEMPERATURE_WARNING`],`${prefix} temperature meets the configured warning threshold.`,evidence));if(status!==HealthStatus.CRITICAL)status=HealthStatus.WARNING;}else healthyEvidence.push(evidence);}return{component:'temperature',status,issues,healthyEvidence};}

function aggregateStatus(results) {
  if (results.some((result) => result.status === HealthStatus.CRITICAL)) return HealthStatus.CRITICAL;
  if (results.some((result) => result.status === HealthStatus.WARNING)) return HealthStatus.WARNING;
  if (results.every((result) => result.status === HealthStatus.HEALTHY)) return HealthStatus.HEALTHY;
  return HealthStatus.UNKNOWN;
}

function unique(values) {
  return [...new Set(values)];
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Health evaluation time must be a valid date.');
  return date.toISOString();
}

class DeviceHealthEvaluator {
  constructor(options = {}) {
    this.policy = createHealthPolicy(options.policy);
    this.now = options.now || (() => new Date());
  }

  evaluate(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('DeviceHealthEvaluator requires a snapshot object.');
    validateSystemMetrics(snapshot.system);
    validateNetworkMetrics(snapshot.network);
    const systemFreshness = snapshot.system.metadata.freshness.state;
    const results = [
      systemComponentResult({
        component: 'cpu',
        freshness: systemFreshness,
        staleCode: HealthReasonCode.CPU_STALE,
        unknownCode: HealthReasonCode.CPU_FRESHNESS_UNKNOWN,
        evaluate: () => utilizationResult({
          component: 'CPU',
          block: snapshot.system.cpu,
          policy: this.policy.cpu,
          warningCode: HealthReasonCode.CPU_WARNING,
          criticalCode: HealthReasonCode.CPU_CRITICAL,
          unavailableCode: HealthReasonCode.CPU_UNAVAILABLE,
          evidence: 'system.cpu.utilization'
        })
      }),
      systemComponentResult({
        component: 'memory',
        freshness: systemFreshness,
        staleCode: HealthReasonCode.MEMORY_STALE,
        unknownCode: HealthReasonCode.MEMORY_FRESHNESS_UNKNOWN,
        evaluate: () => utilizationResult({
          component: 'RAM',
          block: snapshot.system.memory,
          policy: this.policy.memory,
          warningCode: HealthReasonCode.MEMORY_WARNING,
          criticalCode: HealthReasonCode.MEMORY_CRITICAL,
          unavailableCode: HealthReasonCode.MEMORY_UNAVAILABLE,
          evidence: 'system.memory.utilization'
        })
      }),
      evaluateDisks(snapshot.system, this.policy.disk),
      evaluateNetwork(snapshot.network),
      evaluateTemperatures(options.temperatureObservation?.sensors||snapshot.system.temperatures,this.policy.temperature)
    ];

    const issues = results.flatMap((result) => result.issues);
    const health = {
      schema_version: '0.1',
      status: aggregateStatus(results),
      reasons: issues.map((item) => item.reason),
      affected_components: unique(results.filter((result) => result.status !== HealthStatus.HEALTHY)
        .map((result) => result.component.toLowerCase() === 'ram' ? 'memory' : result.component.toLowerCase())),
      evaluated_at: isoDate(options.evaluatedAt ?? this.now()),
      evidence: unique([
        ...issues.map((item) => item.evidence),
        ...results.flatMap((result) => result.healthyEvidence)
      ])
    };
    return validateDeviceHealth(health);
  }
}

function failedHealthEvaluation(evaluatedAt) {
  return validateDeviceHealth({
    schema_version: '0.1',
    status: HealthStatus.UNKNOWN,
    reasons: [{ code: HealthReasonCode.EVALUATION_FAILED, message: 'Device health evaluation failed safely.' }],
    affected_components: [],
    evaluated_at: isoDate(evaluatedAt),
    evidence: []
  });
}

module.exports = {
  DEFAULT_HEALTH_POLICY,
  DeviceHealthEvaluator,
  HealthReasonCode,
  createHealthPolicy,
  failedHealthEvaluation
};
