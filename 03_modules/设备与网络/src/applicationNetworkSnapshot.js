'use strict';

const net = require('node:net');
const { SCHEMA_VERSION } = require('./contracts');
const {
  ApexRuntimeState,
  ApplicationByteAccounting,
  AttributionQuality,
  NetworkRegionClassification,
  validateApplicationNetworkObservation,
  validateApplicationByteBatch
} = require('./applicationNetworkContracts');
const { WindowsProcessCollector } = require('./providers/windowsProcessCollector');
const { WindowsApplicationConnectionCollector } = require('./providers/windowsApplicationConnectionCollector');
const { buildEgressReadModel, collectLocalNetworkIdentity } = require('./egressIdentityService');

const DEFAULT_STALE_AFTER_MS = 30_000;
const APEX_COMPONENTS = Object.freeze(['Apex.exe', 'ApexCore.exe', 'ApexHelperService.exe']);
const BYTE_ACCOUNTING_EVIDENCE = 'Built-in connection cmdlets expose PID/endpoints but not per-PID bytes; interface counters are host-wide. Stable read-only per-PID bytes need a separately approved ETW/native capability study.';

function classifyIpAddress(address) {
  if (!address || !net.isIP(address)) return NetworkRegionClassification.UNKNOWN;
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224) return NetworkRegionClassification.LOCAL;
    return NetworkRegionClassification.UNKNOWN;
  }
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return NetworkRegionClassification.LOCAL;
  return NetworkRegionClassification.UNKNOWN;
}

function applicationId(processName) {
  return `process-name:${processName.toLowerCase()}`;
}

function groupProcesses(processes) {
  const groups = new Map();
  for (const process of Array.isArray(processes) ? processes : []) {
    if (process?.availability !== 'available' || !Number.isInteger(process.processId) || typeof process.processName !== 'string') continue;
    const key = applicationId(process.processName);
    const group = groups.get(key) || {
      application: { application_id: key, process_name: process.processName, display_name: process.displayName || null },
      process_ids: [], cpu_percent: 0, cpu_sample_count: 0, memory_bytes: 0
    };
    group.process_ids.push(process.processId);
    group.memory_bytes += Number.isFinite(process.memoryBytes) && process.memoryBytes >= 0 ? process.memoryBytes : 0;
    if (process.cpuUtilization?.availability === 'available' && Number.isFinite(process.cpuUtilization.value)) {
      group.cpu_percent += process.cpuUtilization.value;
      group.cpu_sample_count += 1;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    process_ids: [...new Set(group.process_ids)].sort((a, b) => a - b),
    cpu_percent: Math.min(100, group.cpu_percent),
    resource_quality: group.cpu_sample_count === group.process_ids.length ? 'complete' : 'partial'
  })).sort((a, b) => a.application.application_id.localeCompare(b.application.application_id));
}

function sortTop(groups, valueField) {
  return [...groups].sort((a, b) => b[valueField] - a[valueField]
    || a.application.application_id.localeCompare(b.application.application_id)).slice(0, 5).map((group) => ({
    application: group.application,
    process_ids: group.process_ids,
    value: group[valueField]
  }));
}

function buildApexRuntimeStatus(processResult) {
  const observedAt = processResult.observedAt;
  if (processResult.availability !== 'available') {
    return { availability: 'unavailable', overall: ApexRuntimeState.UNKNOWN, components: Object.fromEntries(APEX_COMPONENTS.map((name) => [name, ApexRuntimeState.UNKNOWN])), observed_at: observedAt };
  }
  const names = new Set(processResult.processes.map((item) => item.processName.toLowerCase()));
  const components = Object.fromEntries(APEX_COMPONENTS.map((name) => [name, names.has(name.toLowerCase()) ? ApexRuntimeState.RUNNING : ApexRuntimeState.NOT_RUNNING]));
  return {
    availability: 'available',
    overall: Object.values(components).includes(ApexRuntimeState.RUNNING) ? ApexRuntimeState.RUNNING : ApexRuntimeState.NOT_RUNNING,
    components,
    observed_at: observedAt
  };
}

function freshness(observedAt, nowMs, staleAfterMs) {
  const age = Math.max(0, Math.trunc(nowMs - Date.parse(observedAt)));
  return { state: age <= staleAfterMs ? 'fresh' : 'stale', age_ms: age, stale_after_ms: staleAfterMs };
}

function aggregateConnections(groups, connectionResult, nowMs, staleAfterMs, byteRecords = null) {
  const groupByPid = new Map();
  for (const group of groups) for (const pid of group.process_ids) groupByPid.set(pid, group);
  const counters = new Map(groups.map((group) => [group.application.application_id, { tcp: 0, udp: 0, endpoints: [] }]));
  for (const connection of connectionResult.connections || []) {
    const group = groupByPid.get(connection.owningProcessId);
    if (!group) continue;
    const target = counters.get(group.application.application_id);
    target[connection.protocol] += 1;
    if (connection.remoteAddress) target.endpoints.push({ address: connection.remoteAddress, family: connection.addressFamily, classification: classifyIpAddress(connection.remoteAddress) });
  }
  const byteMap = new Map((Array.isArray(byteRecords) ? byteRecords : []).map((item) => [item.applicationId, item]));
  return groups.map((group) => {
    const count = counters.get(group.application.application_id);
    const classifications = count.endpoints.map((item) => item.classification);
    const unique = new Set(count.endpoints.map((item) => item.address)).size;
    const bytes = byteMap.get(group.application.application_id);
    const observation = {
      schema_version: SCHEMA_VERSION,
      application: group.application,
      process_ids: group.process_ids,
      active_connection_count: count.tcp + count.udp,
      protocol_counts: { tcp: count.tcp, udp: count.udp },
      remote_endpoints: {
        total: count.endpoints.length,
        unique,
        ipv4: count.endpoints.filter((item) => item.family === 'ipv4').length,
        ipv6: count.endpoints.filter((item) => item.family === 'ipv6').length,
        local: classifications.filter((item) => item === 'local').length,
        domestic: classifications.filter((item) => item === 'domestic').length,
        foreign: classifications.filter((item) => item === 'foreign').length,
        unknown: classifications.filter((item) => item === 'unknown').length
      },
      observed_at: connectionResult.observedAt,
      freshness: freshness(connectionResult.observedAt, nowMs, staleAfterMs),
      availability: connectionResult.availability,
      attribution_quality: bytes ? AttributionQuality.BYTE_ATTRIBUTED
        : (connectionResult.availability === 'available' ? AttributionQuality.CONNECTION_ONLY : AttributionQuality.UNKNOWN)
    };
    if (bytes) observation.traffic = {
      upload_bytes: bytes.uploadBytes,
      download_bytes: bytes.downloadBytes,
      upload_rate: bytes.uploadRate,
      download_rate: bytes.downloadRate
    };
    return validateApplicationNetworkObservation(observation);
  });
}

function createUnavailableResult(observedAt, reason) {
  return { availability: 'unavailable', observedAt, processes: [], connections: [], reason };
}

async function safeCollect(collector, kind, observedAt) {
  try {
    const value = await collector.collectRaw();
    if (!value || typeof value !== 'object' || !['available', 'unavailable'].includes(value.availability)
      || (kind === 'process' && !Array.isArray(value.processes))
      || (kind === 'connection' && !Array.isArray(value.connections))) throw new Error(`Invalid ${kind} provider result.`);
    return value;
  } catch (error) {
    return createUnavailableResult(observedAt, String(error?.message || `${kind} provider failed.`).slice(0, 240));
  }
}

class ApplicationNetworkSnapshotCollector {
  constructor(options = {}) {
    this.processCollector = options.processCollector || new WindowsProcessCollector();
    this.connectionCollector = options.connectionCollector || new WindowsApplicationConnectionCollector();
    this.byteProvider = options.byteProvider || null;
    this.egressIdentityService = options.egressIdentityService || null;
    this.localNetworkIdentityProvider = options.localNetworkIdentityProvider || (() => collectLocalNetworkIdentity());
    this.now = options.now || (() => new Date());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  async collect() {
    const now = this.now();
    const observedAt = now.toISOString();
    const [processResult, connectionResult] = await Promise.all([
      safeCollect(this.processCollector, 'process', observedAt),
      safeCollect(this.connectionCollector, 'connection', observedAt)
    ]);
    const groups = groupProcesses(processResult.processes);
    let byteBatch = null;
    let byteRecords = null;
    if (this.byteProvider) {
      try {
        const value = await this.byteProvider.collectApplicationBytes({ groups, processResult, connectionResult });
        byteBatch = validateApplicationByteBatch(value, groups.map((group) => group.application.application_id));
        byteRecords = byteBatch.records;
      } catch { byteRecords = null; }
    }
    const observations = aggregateConnections(groups, connectionResult, now.getTime(), this.staleAfterMs, byteRecords);
    const networkTop5 = byteRecords ? [...observations].sort((a, b) => (b.traffic.upload_rate + b.traffic.download_rate)
      - (a.traffic.upload_rate + a.traffic.download_rate) || a.application.application_id.localeCompare(b.application.application_id)).slice(0, 5).map((item) => ({
      application: item.application,
      total_rate: item.traffic.upload_rate + item.traffic.download_rate
    })) : [];
    const topActiveConnections = [...observations].sort((a, b) => b.active_connection_count - a.active_connection_count
      || a.application.application_id.localeCompare(b.application.application_id)).slice(0, 5).map((item) => ({ application: item.application, active_connection_count: item.active_connection_count }));
    const apex = buildApexRuntimeStatus(processResult);
    const snapshot = {
      schema_version: SCHEMA_VERSION,
      snapshot_id: `application-network:${now.getTime()}`,
      observed_at: observedAt,
      availability: processResult.availability === 'available' || connectionResult.availability === 'available' ? 'available' : 'unavailable',
      process_observation: { availability: processResult.availability, count: processResult.processes.length, reason: processResult.reason },
      connection_observation: { availability: connectionResult.availability, count: connectionResult.connections.length, tcp_available: Boolean(connectionResult.tcpAvailable), udp_available: Boolean(connectionResult.udpAvailable), reason: connectionResult.reason },
      applications: observations,
      application_summary: {
        active_application_count: groups.length,
        network_observed_application_count: observations.filter((item) => item.active_connection_count > 0).length,
        cpu_top5: sortTop(groups, 'cpu_percent'),
        ram_top5: sortTop(groups, 'memory_bytes'),
        network_top5: { availability: byteRecords ? 'available' : 'unavailable', items: networkTop5, reason: byteRecords ? null : 'Per-application byte accounting is not available.' },
        top_active_connections: topActiveConnections,
        apex
      },
      byte_accounting: byteRecords
        ? { status: ApplicationByteAccounting.READY, evidence: 'Complete provider batch contains explicit Windows application TX/RX counters and rates.', provider_id: byteBatch.provider_id, source_type: byteBatch.source_type, observed_from: byteBatch.observed_from, observed_to: byteBatch.observed_to }
        : { status: ApplicationByteAccounting.DEFERRED_WITH_EVIDENCE, evidence: BYTE_ACCOUNTING_EVIDENCE }
    };
    if (this.egressIdentityService) {
      try {
        const identity = this.egressIdentityService.peek();
        if (identity) snapshot.egress_read_model = buildEgressReadModel({
          identity,
          localNetworkIdentity: this.localNetworkIdentityProvider(),
          apexRuntime: apex
        });
      } catch { /* Optional cached egress enrichment must never fail local observation. */ }
    }
    return snapshot;
  }
}

module.exports = {
  APEX_COMPONENTS,
  BYTE_ACCOUNTING_EVIDENCE,
  DEFAULT_STALE_AFTER_MS,
  ApplicationNetworkSnapshotCollector,
  aggregateConnections,
  applicationId,
  buildApexRuntimeStatus,
  classifyIpAddress,
  groupProcesses,
  sortTop
};
