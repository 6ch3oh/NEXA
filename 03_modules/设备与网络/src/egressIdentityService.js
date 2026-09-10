'use strict';

const net = require('node:net');
const os = require('node:os');
const { SCHEMA_VERSION } = require('./contracts');
const { EgressFailureCode, EgressRouteKind, validateEgressIdentity, validateLocalNetworkIdentity } = require('./applicationNetworkContracts');
const { IpapiGeoIpProvider, IpifyPublicIpProvider } = require('./providers/egressIdentityProviders');

const DEFAULT_EGRESS_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_EGRESS_STALE_TTL_MS = 60 * 60 * 1000;

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

function optionalFields(target, source, mapping) {
  for (const [from, to] of mapping) {
    if (source?.[from] !== undefined && source[from] !== null) target[to] = source[from];
  }
  return target;
}

function buildIdentity(publicObservation, geo, { cacheStatus, nowMs, staleAfterMs, availability = 'available' }) {
  const observedMs = Date.parse(publicObservation.observedAt);
  const ageMs = Math.max(0, Math.trunc(nowMs - observedMs));
  const identity = {
    schema_version: SCHEMA_VERSION,
    route_kind: EgressRouteKind.DEFAULT,
    public_ip: publicObservation.publicIp,
    approximate: true,
    observed_at: publicObservation.observedAt,
    availability,
    geo_availability: geo ? 'available' : 'unavailable',
    provider: publicObservation.providerId,
    source_type: publicObservation.sourceType,
    cache_status: cacheStatus,
    freshness: { state: ageMs <= staleAfterMs ? 'fresh' : 'stale', age_ms: ageMs, stale_after_ms: staleAfterMs }
  };
  if (geo) {
    optionalFields(identity, geo, [
      ['country', 'country'], ['countryCode', 'country_code'], ['region', 'region'], ['city', 'city'],
      ['isp', 'isp'], ['asn', 'asn'], ['latitude', 'latitude'], ['longitude', 'longitude'],
      ['accuracyRadiusKm', 'accuracy_radius_km'], ['geoProviderId', 'geo_provider_id']
    ]);
  }
  return validateEgressIdentity(identity);
}

function unavailableIdentity(now, publicProviderId, reasonCode, staleAfterMs = DEFAULT_EGRESS_CACHE_TTL_MS) {
  return validateEgressIdentity({
    schema_version: SCHEMA_VERSION,
    route_kind: EgressRouteKind.UNKNOWN,
    approximate: true,
    observed_at: now.toISOString(),
    availability: 'unavailable',
    geo_availability: 'unavailable',
    provider: publicProviderId,
    source_type: 'external_observation',
    cache_status: 'empty',
    freshness: { state: 'unknown', age_ms: 0, stale_after_ms: staleAfterMs },
    failure: reasonCode
  });
}

function sanitizeFailure(error) {
  return Object.values(EgressFailureCode).includes(error?.code) ? error.code : EgressFailureCode.PROVIDER_FAILURE;
}

class EgressIdentityService {
  constructor(options = {}) {
    this.publicIpProvider = options.publicIpProvider || new IpifyPublicIpProvider();
    this.geoIpProvider = options.geoIpProvider || new IpapiGeoIpProvider();
    this.ttlMs = options.ttlMs ?? DEFAULT_EGRESS_CACHE_TTL_MS;
    this.staleTtlMs = options.staleTtlMs ?? DEFAULT_EGRESS_STALE_TTL_MS;
    this.now = options.now || (() => new Date());
    this.cache = null;
    this.inFlight = null;
    if (!Number.isInteger(this.ttlMs) || this.ttlMs < 1 || !Number.isInteger(this.staleTtlMs) || this.staleTtlMs < this.ttlMs) {
      throw new RangeError('Egress cache TTL values are invalid.');
    }
  }

  peek() {
    if (!this.cache) return null;
    const nowMs = this.now().getTime();
    const observedMs = Date.parse(this.cache.identity.observed_at);
    const ageMs = nowMs - observedMs;
    const status = ageMs <= this.ttlMs ? 'hit' : (ageMs <= this.staleTtlMs ? 'stale_fallback' : 'empty');
    if (status === 'empty') return null;
    const value = clone(this.cache.identity);
    value.cache_status = status;
    value.freshness = { state: ageMs <= this.ttlMs ? 'fresh' : 'stale', age_ms: Math.max(0, ageMs), stale_after_ms: this.ttlMs };
    return validateEgressIdentity(value);
  }

  async refresh() {
    const cached = this.peek();
    if (cached?.cache_status === 'hit') return cached;
    if (this.inFlight) return clone(await this.inFlight);
    this.inFlight = this.#refresh(cached);
    try { return clone(await this.inFlight); } finally { this.inFlight = null; }
  }

  async #refresh(stale) {
    const now = this.now();
    try {
      const publicObservation = await this.publicIpProvider.lookup();
      const providerObservedMs = Date.parse(publicObservation?.observedAt);
      if (!Number.isFinite(providerObservedMs) || providerObservedMs > now.getTime() + 60_000
        || now.getTime() - providerObservedMs > this.staleTtlMs) {
        const error = new Error('INVALID_PROVIDER_OBSERVATION');
        error.code = 'INVALID_PROVIDER_OBSERVATION';
        throw error;
      }
      let geo = null;
      try {
        const candidate = await this.geoIpProvider.lookup(publicObservation.publicIp);
        geo = ['country', 'countryCode', 'region', 'city', 'isp', 'asn'].some((field) => candidate?.[field] !== undefined)
          ? candidate : null;
      } catch { geo = null; }
      let identity;
      try {
        identity = buildIdentity(publicObservation, geo, {
          cacheStatus: 'refreshed', nowMs: now.getTime(), staleAfterMs: this.ttlMs
        });
      } catch (error) {
        if (!geo) throw error;
        identity = buildIdentity(publicObservation, null, {
          cacheStatus: 'refreshed', nowMs: now.getTime(), staleAfterMs: this.ttlMs
        });
      }
      this.cache = { identity: clone(identity), cachedAtMs: now.getTime() };
      return identity;
    } catch (error) {
      if (stale) return stale;
      const providerId = typeof this.publicIpProvider.providerId === 'string' && this.publicIpProvider.providerId.trim()
        ? this.publicIpProvider.providerId.trim().slice(0, 120) : 'unknown';
      return unavailableIdentity(now, providerId, sanitizeFailure(error), this.ttlMs);
    }
  }
}

function collectLocalNetworkIdentity({ networkInterfaces = () => os.networkInterfaces(), now = () => new Date() } = {}) {
  const interfaces = networkInterfaces();
  const ipv4 = [];
  const ipv6 = [];
  if (interfaces && typeof interfaces === 'object') {
    for (const entries of Object.values(interfaces)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const family = typeof entry?.family === 'string' ? entry.family : (entry?.family === 4 ? 'IPv4' : entry?.family === 6 ? 'IPv6' : '');
        if (entry?.internal || typeof entry?.address !== 'string') continue;
        const address = entry.address.split('%')[0];
        if (!net.isIP(address)) continue;
        if (family === 'IPv4') ipv4.push(address);
        if (family === 'IPv6') ipv6.push(address);
      }
    }
  }
  return validateLocalNetworkIdentity({
    schema_version: SCHEMA_VERSION,
    observed_at: now().toISOString(),
    availability: ipv4.length || ipv6.length ? 'available' : 'unavailable',
    active_local_ipv4: [...new Set(ipv4)].sort(),
    active_local_ipv6: [...new Set(ipv6)].sort(),
    semantics: 'local_network_only'
  });
}

function buildEgressReadModel({ identity, localNetworkIdentity, apexRuntime }) {
  return {
    schema_version: SCHEMA_VERSION,
    egress_identity: clone(identity),
    local_network_identity: clone(localNetworkIdentity),
    apex_runtime: clone(apexRuntime),
    apex_egress_causality: 'unknown',
    domestic_egress: null,
    foreign_egress: null,
    dual_egress_status: 'deferred'
  };
}

module.exports = {
  DEFAULT_EGRESS_CACHE_TTL_MS,
  DEFAULT_EGRESS_STALE_TTL_MS,
  EgressIdentityService,
  buildEgressReadModel,
  buildIdentity,
  collectLocalNetworkIdentity,
  sanitizeFailure,
  unavailableIdentity
};
