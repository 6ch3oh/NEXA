'use strict';

const { SCHEMA_VERSION } = require('./contracts');

const ProbeTier = Object.freeze({
  LIGHT: 'light',
  QUALITY: 'quality',
  FULL: 'full'
});
const ProbeRoute = Object.freeze({ DOMESTIC: 'domestic', FOREIGN: 'foreign' });
const ProbeProductStatus = Object.freeze({
  TARGET_PENDING: 'target_pending',
  READY: 'ready',
  RUNNING: 'running',
  COMPLETED: 'completed',
  ROUTE_NOT_READY: 'route_not_ready',
  UNAVAILABLE: 'unavailable'
});
const MAX_LIGHT_RESPONSE_BYTES = 64 * 1024;
const MAX_QUALITY_SAMPLES = 20;
const MAX_SPEEDTEST_BYTES = 128 * 1024 * 1024;
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

class ApexNetworkProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApexNetworkProbeError';
    this.code = code;
  }
}

function fail(code, message) { throw new ApexNetworkProbeError(code, message); }
function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function boundedText(value, field, limit = 240) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) fail('INVALID_PROBE_TARGET', `${field} must be bounded text.`);
  return value.trim();
}
function finite(value, field) {
  if (!Number.isFinite(value) || value < 0) fail('INVALID_PROBE_RESULT', `${field} must be a non-negative finite number.`);
  return value;
}
function integer(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail('INVALID_PROBE_TARGET', `${field} is out of range.`);
  return value;
}
function hostname(value, field) {
  const text = boundedText(value, field, 253).toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text)) {
    fail('INVALID_PROBE_TARGET', `${field} must be a hostname.`);
  }
  return text;
}
function endpointUrl(value, field, allowedHosts) {
  let parsed;
  try { parsed = new URL(value); } catch { fail('INVALID_PROBE_TARGET', `${field} must be an HTTPS URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    fail('INVALID_PROBE_TARGET', `${field} must use an allowlisted HTTPS host without credentials or fragment.`);
  }
  return parsed.toString();
}

function validateApexProbeTarget(value) {
  if (!plain(value) || value.schema_version !== SCHEMA_VERSION) fail('INVALID_PROBE_TARGET', 'Probe target contract is invalid.');
  const targetId = boundedText(value.target_id, 'target_id', 64);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(targetId)) fail('INVALID_PROBE_TARGET', 'target_id is invalid.');
  if (!Object.values(ProbeRoute).includes(value.route)) fail('INVALID_PROBE_TARGET', 'route is invalid.');
  if (value.approval !== 'project_allowlist') fail('UNAPPROVED_PROBE_TARGET', 'Target must come from the project allowlist.');
  if (!Array.isArray(value.allowed_hosts) || !value.allowed_hosts.length || value.allowed_hosts.length > 8) fail('INVALID_PROBE_TARGET', 'allowed_hosts is invalid.');
  const allowedHosts = [...new Set(value.allowed_hosts.map((item, index) => hostname(item, `allowed_hosts[${index}]`)))];
  if (!plain(value.endpoints)) fail('INVALID_PROBE_TARGET', 'endpoints are required.');
  const dns = plain(value.endpoints.dns) ? { hostname: hostname(value.endpoints.dns.hostname, 'endpoints.dns.hostname') } : null;
  const connect = plain(value.endpoints.connect) ? {
    hostname: hostname(value.endpoints.connect.hostname, 'endpoints.connect.hostname'),
    port: integer(value.endpoints.connect.port, 'endpoints.connect.port', 1, 65535),
    tls: value.endpoints.connect.tls === true
  } : null;
  if (connect && !connect.tls) fail('INVALID_PROBE_TARGET', 'connect endpoint must require TLS.');
  for (const item of [dns?.hostname, connect?.hostname].filter(Boolean)) {
    if (!allowedHosts.includes(item)) fail('INVALID_PROBE_TARGET', 'DNS and connect hosts must be allowlisted.');
  }
  const http = plain(value.endpoints.http) ? {
    url: endpointUrl(value.endpoints.http.url, 'endpoints.http.url', allowedHosts),
    max_response_bytes: integer(value.endpoints.http.max_response_bytes, 'endpoints.http.max_response_bytes', 1, MAX_LIGHT_RESPONSE_BYTES)
  } : null;
  const download = plain(value.endpoints.download) ? {
    url: endpointUrl(value.endpoints.download.url, 'endpoints.download.url', allowedHosts),
    max_bytes: integer(value.endpoints.download.max_bytes, 'endpoints.download.max_bytes', 1, MAX_SPEEDTEST_BYTES)
  } : null;
  const upload = plain(value.endpoints.upload) ? {
    url: endpointUrl(value.endpoints.upload.url, 'endpoints.upload.url', allowedHosts),
    max_bytes: integer(value.endpoints.upload.max_bytes, 'endpoints.upload.max_bytes', 1, MAX_SPEEDTEST_BYTES)
  } : null;
  if (!dns || !connect || !http) fail('INVALID_PROBE_TARGET', 'Light and quality probe endpoints are required.');
  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    target_id: targetId,
    display_name: boundedText(value.display_name, 'display_name', 80),
    route: value.route,
    approval: 'project_allowlist',
    allowed_hosts: Object.freeze(allowedHosts),
    endpoints: Object.freeze({ dns: Object.freeze(dns), connect: Object.freeze(connect), http: Object.freeze(http), download: download ? Object.freeze(download) : null, upload: upload ? Object.freeze(upload) : null }),
    privacy_notice: boundedText(value.privacy_notice, 'privacy_notice', 320)
  });
}

function safeTargetProjection(target) {
  return Object.freeze({
    target_id: target.target_id,
    display_name: target.display_name,
    route: target.route,
    approved: true,
    supported_tiers: Object.freeze([
      ProbeTier.LIGHT,
      ProbeTier.QUALITY,
      ...(target.endpoints.download && target.endpoints.upload ? [ProbeTier.FULL] : [])
    ]),
    privacy_notice: target.privacy_notice
  });
}

function tierProduct(tier, targets) {
  const configured = targets.some((target) => safeTargetProjection(target).supported_tiers.includes(tier));
  return Object.freeze({
    tier,
    availability: configured ? 'available' : 'target_pending',
    status_label: configured ? '可运行' : '探针待配置',
    execution_policy: tier === ProbeTier.FULL ? 'user_initiated_only' : 'manual_or_low_frequency',
    background_bandwidth_saturation_allowed: false
  });
}

function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function projectProbeResult(tier, raw, target, observedAt) {
  if (!plain(raw)) fail('INVALID_PROBE_RESULT', 'Probe result must be an object.');
  const base = { schema_version: SCHEMA_VERSION, tier, status: ProbeProductStatus.COMPLETED, target: safeTargetProjection(target), observed_at: observedAt, route_trust: ['high', 'medium', 'low', 'unknown'].includes(raw.route_confidence) ? raw.route_confidence : 'unknown' };
  if (tier === ProbeTier.LIGHT) {
    const totalChecks = Number.isInteger(raw.total_checks) && raw.total_checks >= 1 && raw.total_checks <= 8 ? raw.total_checks : 3;
    const failureCount = Number.isInteger(raw.failure_count) && raw.failure_count >= 0 && raw.failure_count <= totalChecks ? raw.failure_count : 0;
    const bytesReceived = Number.isInteger(raw.bytes_received) && raw.bytes_received >= 0 && raw.bytes_received <= MAX_LIGHT_RESPONSE_BYTES ? raw.bytes_received : 0;
    return Object.freeze({ ...base, dns_ms: finite(raw.dns_ms, 'dns_ms'), connect_ms: finite(raw.connect_ms, 'connect_ms'), tls_ms: raw.tls_ms == null ? null : finite(raw.tls_ms, 'tls_ms'), http_ms: finite(raw.http_ms, 'http_ms'), latency_ms: finite(raw.latency_ms, 'latency_ms'), timeout_count: Number.isInteger(raw.timeout_count) && raw.timeout_count >= 0 ? raw.timeout_count : 0, failure_count: failureCount, failure_rate: failureCount / totalChecks, bytes_received: bytesReceived, low_traffic: true });
  }
  if (tier === ProbeTier.QUALITY) {
    if (!Array.isArray(raw.samples_ms) || !raw.samples_ms.length || raw.samples_ms.length > MAX_QUALITY_SAMPLES) fail('INVALID_PROBE_RESULT', 'samples_ms must contain 1-20 samples.');
    const samples = raw.samples_ms.map((item, index) => finite(item, `samples_ms[${index}]`));
    const failureCount = Number.isInteger(raw.failure_count) && raw.failure_count >= 0 && raw.failure_count <= MAX_QUALITY_SAMPLES ? raw.failure_count : 0;
    const attempted = samples.length + failureCount;
    const deltas = samples.slice(1).map((value, index) => Math.abs(value - samples[index]));
    return Object.freeze({ ...base, sample_count: samples.length, attempted_count: attempted, latency_ms: median(samples), min_ms: Math.min(...samples), max_ms: Math.max(...samples), jitter_ms: average(deltas), failure_count: failureCount, failure_rate: attempted ? failureCount / attempted : 0 });
  }
  return Object.freeze({ ...base, download_mbps: finite(raw.download_mbps, 'download_mbps'), upload_mbps: finite(raw.upload_mbps, 'upload_mbps'), idle_latency_ms: finite(raw.idle_latency_ms, 'idle_latency_ms'), latency_under_load_ms: finite(raw.latency_under_load_ms, 'latency_under_load_ms'), download_bytes: integer(raw.download_bytes, 'download_bytes', 0, MAX_SPEEDTEST_BYTES), upload_bytes: integer(raw.upload_bytes, 'upload_bytes', 0, MAX_SPEEDTEST_BYTES), user_initiated: true });
}

class ApexNetworkProbeCoordinator {
  constructor({ targets = [], routeHarness = null, now = () => new Date() } = {}) {
    if (!Array.isArray(targets)) fail('INVALID_PROBE_TARGET', 'targets must be an array.');
    this.targets = targets.map(validateApexProbeTarget);
    if (new Set(this.targets.map((target) => target.target_id)).size !== this.targets.length) fail('INVALID_PROBE_TARGET', 'target_id values must be unique.');
    if (routeHarness !== null && typeof routeHarness?.execute !== 'function') fail('INVALID_PROBE_HARNESS', 'routeHarness.execute is required.');
    if (typeof now !== 'function') fail('INVALID_CLOCK', 'now must be a function.');
    this.routeHarness = routeHarness;
    this.now = now;
    this.lastResult = null;
    this.running = null;
  }

  getProduct() {
    const status = this.running ? ProbeProductStatus.RUNNING : (this.targets.length ? ProbeProductStatus.READY : ProbeProductStatus.TARGET_PENDING);
    return Object.freeze({
      schema_version: SCHEMA_VERSION,
      contract: 'ApexNetworkProbeProduct V0.1',
      status,
      status_label: status === ProbeProductStatus.TARGET_PENDING ? '探针待配置' : (status === ProbeProductStatus.RUNNING ? '探测中' : '可运行'),
      target_status: this.targets.length ? 'configured' : 'not_configured',
      target_count: this.targets.length,
      targets: Object.freeze(this.targets.map(safeTargetProjection)),
      tiers: Object.freeze({ light: tierProduct(ProbeTier.LIGHT, this.targets), quality: tierProduct(ProbeTier.QUALITY, this.targets), full: tierProduct(ProbeTier.FULL, this.targets) }),
      last_result: clone(this.lastResult),
      existing_apex_harness_reused: true,
      network_settings_modified: false
    });
  }

  async run(request = {}) {
    if (!plain(request) || !Object.values(ProbeTier).includes(request.tier)) fail('INVALID_PROBE_REQUEST', 'Probe tier is invalid.');
    if (request.tier === ProbeTier.FULL && request.user_initiated !== true) fail('FULL_SPEEDTEST_REQUIRES_USER_INITIATION', 'Full speed test requires an explicit user action.');
    const target = this.targets.find((item) => item.target_id === request.target_id);
    if (!target) fail('NETWORK_PROBE_TARGET_NOT_APPROVED', 'Probe target is not in the project allowlist.');
    if (request.tier === ProbeTier.FULL && (!target.endpoints.download || !target.endpoints.upload)) fail('FULL_SPEEDTEST_TARGET_NOT_CONFIGURED', 'Target does not support full speed testing.');
    if (!this.routeHarness) return Object.freeze({ ...this.getProduct(), status: ProbeProductStatus.UNAVAILABLE, status_label: '探针执行器暂不可用', reason: 'APEX_PROBE_EXECUTOR_NOT_AVAILABLE' });
    if (this.running) fail('NETWORK_PROBE_BUSY', 'A network probe is already running.');
    const route = target.route;
    const kind = request.tier === ProbeTier.LIGHT ? 'light_health' : (request.tier === ProbeTier.QUALITY ? 'line_quality' : 'full_speedtest');
    this.running = Object.freeze({ tier: request.tier, target_id: target.target_id });
    try {
      const response = await this.routeHarness.execute(route, {
        kind,
        target: clone(target),
        sample_limit: request.tier === ProbeTier.QUALITY ? MAX_QUALITY_SAMPLES : null,
        user_initiated: request.tier === ProbeTier.FULL ? true : request.user_initiated === true
      });
      if (response?.availability !== 'available') {
        this.lastResult = Object.freeze({ schema_version: SCHEMA_VERSION, tier: request.tier, status: ProbeProductStatus.ROUTE_NOT_READY, target: safeTargetProjection(target), observed_at: this.now().toISOString(), reason: 'ROUTE_BINDING_NOT_READY' });
      } else {
        this.lastResult = projectProbeResult(request.tier, response.result, target, this.now().toISOString());
      }
      return clone(this.lastResult);
    } finally { this.running = null; }
  }
}

module.exports = {
  ApexNetworkProbeCoordinator,
  ApexNetworkProbeError,
  MAX_LIGHT_RESPONSE_BYTES,
  MAX_QUALITY_SAMPLES,
  MAX_SPEEDTEST_BYTES,
  ProbeProductStatus,
  ProbeRoute,
  ProbeTier,
  projectProbeResult,
  safeTargetProjection,
  validateApexProbeTarget
};
