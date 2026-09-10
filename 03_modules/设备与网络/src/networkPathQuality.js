'use strict';

const { SCHEMA_VERSION } = require('./contracts');

const NetworkPathKind = Object.freeze({ DEFAULT_ROUTE: 'default_route', DOMESTIC_PATH: 'domestic_path', FOREIGN_APEX_PATH: 'foreign_apex_path', UNKNOWN: 'unknown' });
const PathEvidenceState = Object.freeze({ PROVEN: 'proven', CONTRACT_ONLY: 'contract_only', UNKNOWN: 'unknown' });

function finite(value, path) { if (!Number.isFinite(value) || value < 0) throw new TypeError(`${path} must be a non-negative finite number.`); }
function iso(value, path) { if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${path} must be an ISO date-time.`); }

function validateNetworkPathObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('networkPathObservation must be an object.');
  if (value.schema_version !== SCHEMA_VERSION || !Object.values(NetworkPathKind).includes(value.route_kind) || !Object.values(PathEvidenceState).includes(value.evidence_state)) throw new TypeError('networkPathObservation contract is invalid.');
  if (!['available', 'unavailable'].includes(value.availability)) throw new TypeError('networkPathObservation availability is invalid.');
  iso(value.observed_at, 'networkPathObservation.observed_at');
  if (typeof value.provider !== 'string' || value.provider === '') throw new TypeError('networkPathObservation.provider is required.');
  if (!Array.isArray(value.evidence)) throw new TypeError('networkPathObservation.evidence must be an array.');
  if (value.evidence_state === PathEvidenceState.PROVEN && value.evidence.length === 0) throw new TypeError('proven path requires evidence.');
  if (value.route_kind === NetworkPathKind.FOREIGN_APEX_PATH && value.evidence.includes('apex_running_only')) throw new TypeError('APEX presence alone cannot prove a foreign path.');
  return value;
}

function validateNetworkQualityObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('networkQualityObservation must be an object.');
  if (value.schema_version !== SCHEMA_VERSION || !Object.values(NetworkPathKind).includes(value.route_kind)) throw new TypeError('networkQualityObservation route is invalid.');
  if (!['available', 'unavailable'].includes(value.availability)) throw new TypeError('networkQualityObservation availability is invalid.');
  iso(value.observed_at, 'networkQualityObservation.observed_at');
  if (typeof value.provider !== 'string' || value.provider === '') throw new TypeError('networkQualityObservation.provider is required.');
  if (value.availability === 'available') {
    for (const field of ['latency_ms', 'min_ms', 'median_ms', 'max_ms']) finite(value[field], `networkQualityObservation.${field}`);
    if (!Number.isInteger(value.sample_count) || value.sample_count < 1) throw new TypeError('networkQualityObservation.sample_count is invalid.');
    if (value.min_ms > value.median_ms || value.median_ms > value.max_ms) throw new TypeError('networkQualityObservation statistics are unordered.');
  } else if (value.latency_ms !== null || value.sample_count !== 0) throw new TypeError('unavailable quality cannot contain samples.');
  if (!value.freshness || !['fresh', 'stale', 'unknown'].includes(value.freshness.state)) throw new TypeError('networkQualityObservation freshness is invalid.');
  return value;
}

class NetworkQualityProvider { async sample() { throw new Error('NetworkQualityProvider.sample must be implemented.'); } }
class EgressPathProvider { async observe() { throw new Error('EgressPathProvider.observe must be implemented.'); } }

function qualityFromSamples({ routeKind, samples, provider, observedAt = new Date().toISOString(), staleAfterMs = 60_000 }) {
  const clean = (samples || []).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!clean.length) return validateNetworkQualityObservation({ schema_version: SCHEMA_VERSION, route_kind: routeKind, latency_ms: null, availability: 'unavailable', observed_at: observedAt, freshness: { state: 'unknown', age_ms: 0, stale_after_ms: staleAfterMs }, provider, sample_count: 0, min_ms: null, median_ms: null, max_ms: null });
  const middle = Math.floor(clean.length / 2); const median = clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
  return validateNetworkQualityObservation({ schema_version: SCHEMA_VERSION, route_kind: routeKind, latency_ms: median, availability: 'available', observed_at: observedAt, freshness: { state: 'fresh', age_ms: 0, stale_after_ms: staleAfterMs }, provider, sample_count: clean.length, min_ms: clean[0], median_ms: median, max_ms: clean.at(-1) });
}

class NetworkPathQualityService {
  constructor(options = {}) { this.pathProviders = options.pathProviders || {}; this.qualityProviders = options.qualityProviders || {}; this.history = []; this.maxHistory = options.maxHistory ?? 10_000; }
  async observePath(routeKind) {
    const provider = this.pathProviders[routeKind];
    if (!provider) return validateNetworkPathObservation({ schema_version: SCHEMA_VERSION, route_kind: routeKind, availability: 'unavailable', evidence_state: 'contract_only', observed_at: new Date().toISOString(), provider: 'none', evidence: [] });
    return validateNetworkPathObservation(await provider.observe(routeKind));
  }
  async sampleQuality(routeKind) {
    const provider = this.qualityProviders[routeKind];
    const value = provider ? validateNetworkQualityObservation(await provider.sample(routeKind)) : qualityFromSamples({ routeKind, samples: [], provider: 'none' });
    this.history = [...this.history, JSON.parse(JSON.stringify(value))].slice(-this.maxHistory); return value;
  }
  listQuality({ routeKind, since, until, limit = 1000 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('limit must be between 1 and 1000.');
    const start = since ? Date.parse(since) : -Infinity; const end = until ? Date.parse(until) : Infinity;
    return JSON.parse(JSON.stringify(this.history.filter((item) => (!routeKind || item.route_kind === routeKind) && Date.parse(item.observed_at) >= start && Date.parse(item.observed_at) <= end).slice(-limit)));
  }
}

function buildNetworkPathQualityViewModel({ domesticPath, foreignPath, domesticQuality, foreignQuality }) {
  const row = (label, path, quality) => ({ label, route_kind: path.route_kind, path_availability: path.availability, evidence_state: path.evidence_state, latency: quality.availability === 'available' ? { availability: 'available', value: quality.latency_ms, unit: 'milliseconds' } : { availability: 'unavailable', value: null, unit: 'milliseconds' }, sample_count: quality.sample_count });
  return { schema_version: SCHEMA_VERSION, domestic: row('Domestic network', domesticPath, domesticQuality), foreign: row('Foreign/APEX network', foreignPath, foreignQuality), disclosure: 'APEX runtime presence does not prove foreign route causality.' };
}

module.exports = { EgressPathProvider, NetworkPathKind, NetworkPathQualityService, NetworkQualityProvider, PathEvidenceState, buildNetworkPathQualityViewModel, qualityFromSamples, validateNetworkPathObservation, validateNetworkQualityObservation };
