'use strict';

const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const {
  MetricAvailability,
  validateDeviceNetworkSnapshot,
  validateNetworkMetrics,
  validateSystemMetrics
} = require('./contracts');
const {
  WindowsNetworkCollectorAdapter,
  WindowsSystemCollectorAdapter,
  normalizeWindowsNetworkMetrics,
  normalizeWindowsSystemMetrics
} = require('./adapters');
const { buildHomeFooterViewModel } = require('./homeFooterViewModel');
const { DeviceHealthEvaluator, failedHealthEvaluation } = require('./deviceHealthEvaluator');
const { failedLegacyDeviceEvidence, validateLegacyDeviceEvidence } = require('./legacyDeviceAdapter');
const { WindowsNetworkCollector } = require('./providers/windowsNetworkCollector');
const { WindowsSystemCollector } = require('./providers/windowsSystemCollector');

const DEFAULT_SNAPSHOT_TIMEOUT_MS = 8_000;

function isoDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function unavailableRawValue(reason) {
  return { availability: MetricAvailability.UNAVAILABLE, value: null, reason };
}

function unavailableSystemMetrics(collectedAt) {
  const reason = 'System collector unavailable during snapshot.';
  return normalizeWindowsSystemMetrics({
    collectedAt,
    cpu: { availability: MetricAvailability.UNAVAILABLE, reason },
    memory: { availability: MetricAvailability.UNAVAILABLE, reason },
    disks: { availability: MetricAvailability.UNAVAILABLE, reason }
  });
}

function unavailableNetworkMetrics(collectedAt) {
  const reason = 'Network collector unavailable during snapshot.';
  return normalizeWindowsNetworkMetrics({
    collectedAt,
    interfaces: { availability: MetricAvailability.UNAVAILABLE, active: [], reason },
    traffic: {
      uploadRate: unavailableRawValue(reason),
      downloadRate: unavailableRawValue(reason),
      cumulativeSent: unavailableRawValue(reason),
      cumulativeReceived: unavailableRawValue(reason)
    }
  });
}

function deferredMihomoStatus(collectedAt) {
  return {
    metadata: {
      schema_version: '0.1',
      collected_at: collectedAt,
      provider: { id: 'snapshot-aggregator', kind: 'application' },
      freshness: { state: 'fresh', age_ms: 0, stale_after_ms: 60_000 }
    },
    state: 'unavailable',
    controller_availability: 'unsupported',
    reachable: false,
    connected: false,
    mode: null,
    current_proxy_summary: null,
    traffic: { upload_rate: null, download_rate: null },
    last_successful_observation: null,
    reason: 'Mihomo integration is deferred.'
  };
}

function aggregateFreshness(system, network) {
  const states = [system.metadata.freshness.state, network.metadata.freshness.state];
  if (states.includes('stale')) return 'stale';
  if (states.includes('unknown')) return 'unknown';
  return 'fresh';
}

function errorSummary(component, kind, occurredAt) {
  return {
    component,
    code: kind === 'timeout' ? 'COLLECTOR_TIMEOUT' : 'COLLECTOR_FAILED',
    category: kind,
    availability: MetricAvailability.UNAVAILABLE,
    occurred_at: occurredAt
  };
}

function validateAggregateSnapshot(snapshot) {
  validateDeviceNetworkSnapshot(snapshot);
  if (Object.hasOwn(snapshot, 'legacy')) validateLegacyDeviceEvidence(snapshot.legacy);
  if (snapshot.schema_version !== '0.1') throw new TypeError('snapshot.schema_version must be 0.1');
  if (!Number.isFinite(Date.parse(snapshot.started_at))) throw new TypeError('snapshot.started_at must be an ISO date-time');
  if (!Number.isFinite(Date.parse(snapshot.completed_at))) throw new TypeError('snapshot.completed_at must be an ISO date-time');
  if (Date.parse(snapshot.completed_at) < Date.parse(snapshot.started_at)) {
    throw new TypeError('snapshot.completed_at must not precede started_at');
  }
  if (typeof snapshot.partial !== 'boolean') throw new TypeError('snapshot.partial must be boolean');
  if (!Array.isArray(snapshot.errors)) throw new TypeError('snapshot.errors must be an array');
  for (const error of snapshot.errors) {
    if (!['system', 'network'].includes(error.component)) throw new TypeError('snapshot error component is invalid');
    if (!['COLLECTOR_TIMEOUT', 'COLLECTOR_FAILED'].includes(error.code)) throw new TypeError('snapshot error code is invalid');
    if (error.availability !== MetricAvailability.UNAVAILABLE) throw new TypeError('snapshot error availability is invalid');
    if (!Number.isFinite(Date.parse(error.occurred_at))) throw new TypeError('snapshot error occurred_at is invalid');
  }
  if (!['fresh', 'stale', 'unknown'].includes(snapshot.freshness)) throw new TypeError('snapshot freshness is invalid');
  for (const field of ['system', 'network', 'total']) {
    if (!Number.isFinite(snapshot.timings_ms[field]) || snapshot.timings_ms[field] < 0) {
      throw new TypeError(`snapshot.timings_ms.${field} must be a non-negative finite number`);
    }
  }
  if (Object.hasOwn(snapshot.timings_ms, 'legacy')
    && (!Number.isFinite(snapshot.timings_ms.legacy) || snapshot.timings_ms.legacy < 0)) {
    throw new TypeError('snapshot.timings_ms.legacy must be a non-negative finite number');
  }
  return snapshot;
}

function legacyEvidenceReferences(legacy) {
  if (!legacy || legacy.availability !== MetricAvailability.AVAILABLE) return [];
  const references = [];
  if (legacy.runtime.availability === MetricAvailability.AVAILABLE) references.push('legacy.runtime');
  if (legacy.hub.availability === MetricAvailability.AVAILABLE) references.push('legacy.hub');
  if (legacy.service_status.availability === MetricAvailability.AVAILABLE) references.push('legacy.service_status');
  return references;
}

function appendLegacySupplementalEvidence(health, legacy) {
  const references = legacyEvidenceReferences(legacy);
  if (references.length === 0) return health;
  return {
    ...health,
    evidence: [...new Set([...health.evidence, ...references])]
  };
}

function runWithTimeout({
  component,
  task,
  timeoutMs,
  scheduleTimeout,
  cancelTimeout,
  monotonic,
  snapshotStartedMs
}) {
  const startedMs = monotonic();
  let timeoutId;
  const taskPromise = Promise.resolve().then(task);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) cancelTimeout(timeoutId);
      const endedMs = monotonic();
      resolve({
        component,
        ...result,
        startedOffsetMs: Math.max(0, startedMs - snapshotStartedMs),
        durationMs: Math.max(0, endedMs - startedMs)
      });
    };
    timeoutId = scheduleTimeout(() => finish({ status: 'timeout' }), timeoutMs);
    taskPromise.then(
      (value) => finish({ status: 'fulfilled', value }),
      () => finish({ status: 'rejected' })
    );
  });
}

class DeviceNetworkSnapshotAggregator {
  constructor(options = {}) {
    this.systemAdapter = options.systemAdapter || new WindowsSystemCollectorAdapter(
      options.systemCollector || new WindowsSystemCollector()
    );
    this.networkAdapter = options.networkAdapter || new WindowsNetworkCollectorAdapter(
      options.networkCollector || new WindowsNetworkCollector()
    );
    this.legacyAdapter = options.legacyAdapter || null;
    if (this.legacyAdapter !== null && typeof this.legacyAdapter.observeRuntime !== 'function') {
      throw new TypeError('Snapshot legacyAdapter must provide observeRuntime().');
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new RangeError('Snapshot timeout must be an integer between 1 and 60000 ms.');
    }
    this.createId = options.createId || randomUUID;
    this.now = options.now || (() => new Date());
    this.monotonic = options.monotonic || (() => performance.now());
    this.scheduleTimeout = options.scheduleTimeout || setTimeout;
    this.cancelTimeout = options.cancelTimeout || clearTimeout;
    this.healthEvaluator = options.healthEvaluator || new DeviceHealthEvaluator();
    if (!this.healthEvaluator || typeof this.healthEvaluator.evaluate !== 'function') {
      throw new TypeError('Snapshot healthEvaluator must provide evaluate().');
    }
  }

  async collectSnapshot() {
    const snapshotId = this.createId();
    const startedAt = isoDate(this.now());
    const snapshotStartedMs = this.monotonic();

    const systemTask = runWithTimeout({
      component: 'system',
      task: async () => {
        const value = await this.systemAdapter.collectSystemMetrics();
        validateSystemMetrics(value);
        return value;
      },
      timeoutMs: this.timeoutMs,
      scheduleTimeout: this.scheduleTimeout,
      cancelTimeout: this.cancelTimeout,
      monotonic: this.monotonic,
      snapshotStartedMs
    });
    const networkTask = runWithTimeout({
      component: 'network',
      task: async () => {
        const value = await this.networkAdapter.collectNetworkMetrics();
        validateNetworkMetrics(value);
        return value;
      },
      timeoutMs: this.timeoutMs,
      scheduleTimeout: this.scheduleTimeout,
      cancelTimeout: this.cancelTimeout,
      monotonic: this.monotonic,
      snapshotStartedMs
    });
    const legacyTask = this.legacyAdapter === null ? null : runWithTimeout({
      component: 'legacy',
      task: async () => {
        const value = await this.legacyAdapter.observeRuntime();
        validateLegacyDeviceEvidence(value);
        return value;
      },
      timeoutMs: this.timeoutMs,
      scheduleTimeout: this.scheduleTimeout,
      cancelTimeout: this.cancelTimeout,
      monotonic: this.monotonic,
      snapshotStartedMs
    });

    const [systemResult, networkResult, legacyResult] = await Promise.all(
      legacyTask ? [systemTask, networkTask, legacyTask] : [systemTask, networkTask, Promise.resolve(null)]
    );
    const completedAt = isoDate(this.now());
    const errors = [];
    if (systemResult.status !== 'fulfilled') errors.push(errorSummary('system', systemResult.status === 'timeout' ? 'timeout' : 'failure', completedAt));
    if (networkResult.status !== 'fulfilled') errors.push(errorSummary('network', networkResult.status === 'timeout' ? 'timeout' : 'failure', completedAt));
    const system = systemResult.status === 'fulfilled'
      ? systemResult.value
      : unavailableSystemMetrics(completedAt);
    const network = networkResult.status === 'fulfilled'
      ? networkResult.value
      : unavailableNetworkMetrics(completedAt);
    const legacy = legacyTask === null
      ? null
      : (legacyResult.status === 'fulfilled' ? legacyResult.value : failedLegacyDeviceEvidence(completedAt));

    const snapshot = {
      schema_version: '0.1',
      snapshot_id: snapshotId,
      started_at: startedAt,
      completed_at: completedAt,
      partial: errors.length > 0,
      errors,
      freshness: aggregateFreshness(system, network),
      timings_ms: {
        system: systemResult.durationMs,
        network: networkResult.durationMs,
        total: 0,
        health: 0,
        system_started_offset: systemResult.startedOffsetMs,
        network_started_offset: networkResult.startedOffsetMs
      },
      system,
      network,
      mihomo: deferredMihomoStatus(completedAt),
      health: failedHealthEvaluation(completedAt),
      anomalies: []
    };
    if (legacy !== null) {
      snapshot.legacy = legacy;
      snapshot.timings_ms.legacy = legacyResult.durationMs;
      snapshot.timings_ms.legacy_started_offset = legacyResult.startedOffsetMs;
    }
    const healthStartedMs = this.monotonic();
    try {
      snapshot.health = await Promise.resolve(this.healthEvaluator.evaluate(snapshot, { evaluatedAt: completedAt }));
    } catch {
      snapshot.health = failedHealthEvaluation(completedAt);
    }
    if (legacy !== null) snapshot.health = appendLegacySupplementalEvidence(snapshot.health, legacy);
    const snapshotCompletedMs = this.monotonic();
    snapshot.timings_ms.health = Math.max(0, snapshotCompletedMs - healthStartedMs);
    snapshot.timings_ms.total = Math.max(0, snapshotCompletedMs - snapshotStartedMs);
    return validateAggregateSnapshot(snapshot);
  }

  async collectHomeFooterSnapshot() {
    const snapshot = await this.collectSnapshot();
    return { snapshot, view_model: buildHomeFooterViewModel(snapshot) };
  }
}

module.exports = {
  DEFAULT_SNAPSHOT_TIMEOUT_MS,
  DeviceNetworkSnapshotAggregator,
  aggregateFreshness,
  appendLegacySupplementalEvidence,
  legacyEvidenceReferences,
  validateAggregateSnapshot
};
