'use strict';

const net = require('node:net');
const { FreshnessState, MetricAvailability, SCHEMA_VERSION } = require('./contracts');
const { isPublicIp } = require('./ipAddress');

const AttributionQuality = Object.freeze({
  CONNECTION_ONLY: 'connection_only',
  BYTE_ATTRIBUTED: 'byte_attributed',
  PARTIAL: 'partial',
  UNKNOWN: 'unknown'
});

const NetworkRegionClassification = Object.freeze({
  LOCAL: 'local',
  DOMESTIC: 'domestic',
  FOREIGN: 'foreign',
  UNKNOWN: 'unknown'
});

const EgressRouteKind = Object.freeze({
  DEFAULT: 'default',
  DOMESTIC: 'domestic',
  FOREIGN: 'foreign',
  UNKNOWN: 'unknown'
});

const EgressFailureCode = Object.freeze({
  DNS_FAILURE: 'DNS_FAILURE',
  HTTP_FAILURE: 'HTTP_FAILURE',
  HTTP_UNAVAILABLE: 'HTTP_UNAVAILABLE',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_PROVIDER_OBSERVATION: 'INVALID_PROVIDER_OBSERVATION',
  INVALID_PUBLIC_IP: 'INVALID_PUBLIC_IP',
  INVALID_TIMEOUT: 'INVALID_TIMEOUT',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  PROVIDER_FAILURE: 'PROVIDER_FAILURE',
  PROVIDER_IP_MISMATCH: 'PROVIDER_IP_MISMATCH',
  RATE_LIMITED: 'RATE_LIMITED',
  RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
  TIMEOUT: 'TIMEOUT'
});

const ApplicationByteAccounting = Object.freeze({
  READY: 'ready',
  DEFERRED_WITH_EVIDENCE: 'deferred_with_evidence'
});

const ApplicationByteSourceType = Object.freeze({
  WINDOWS_APPLICATION_NETWORK_COUNTERS: 'windows_application_network_counters'
});

function validateApplicationByteBatch(value, expectedApplicationIds = []) {
  object(value, 'applicationByteBatch');
  oneOf(value.source_type, ApplicationByteSourceType, 'applicationByteBatch.source_type');
  string(value.provider_id, 'applicationByteBatch.provider_id');
  iso(value.observed_from, 'applicationByteBatch.observed_from');
  iso(value.observed_to, 'applicationByteBatch.observed_to');
  if (Date.parse(value.observed_to) < Date.parse(value.observed_from)) invalid('applicationByteBatch.observed_to', 'must not precede observed_from');
  if (value.complete !== true) invalid('applicationByteBatch.complete', 'must be true');
  if (value.semantics !== 'tx_rx_bytes_by_windows_application') invalid('applicationByteBatch.semantics', 'invalid semantics');
  if (!Array.isArray(value.records)) invalid('applicationByteBatch.records', 'array required');
  const expected = new Set(expectedApplicationIds);
  const seen = new Set();
  value.records.forEach((item, index) => {
    object(item, `applicationByteBatch.records[${index}]`);
    string(item.applicationId, `applicationByteBatch.records[${index}].applicationId`);
    if (seen.has(item.applicationId)) invalid('applicationByteBatch.records', 'duplicate applicationId');
    seen.add(item.applicationId);
    for (const field of ['uploadBytes', 'downloadBytes', 'uploadRate', 'downloadRate']) number(item[field], `applicationByteBatch.records[${index}].${field}`);
  });
  if (seen.size !== expected.size || [...seen].some((id) => !expected.has(id))) invalid('applicationByteBatch.records', 'must completely cover current applications');
  return value;
}

const ApexRuntimeState = Object.freeze({
  RUNNING: 'running',
  NOT_RUNNING: 'not_running',
  UNKNOWN: 'unknown'
});

function invalid(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'object required');
}

function string(value, path, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.trim() === '') invalid(path, 'non-empty string required');
}

function number(value, path, { integer = false, min = 0, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    invalid(path, `${integer ? 'integer' : 'finite number'} between ${min} and ${max} required`);
  }
}

function iso(value, path) {
  string(value, path);
  if (!Number.isFinite(Date.parse(value))) invalid(path, 'ISO date-time required');
}

function oneOf(value, definition, path) {
  if (!Object.values(definition).includes(value)) invalid(path, `invalid value ${String(value)}`);
}

function validateFreshness(value, path) {
  object(value, path);
  oneOf(value.state, FreshnessState, `${path}.state`);
  number(value.age_ms, `${path}.age_ms`, { integer: true });
  number(value.stale_after_ms, `${path}.stale_after_ms`, { integer: true, min: 1 });
  if (value.state === FreshnessState.FRESH && value.age_ms > value.stale_after_ms) invalid(path, 'fresh value exceeds stale threshold');
  if (value.state === FreshnessState.STALE && value.age_ms <= value.stale_after_ms) invalid(path, 'stale value has not exceeded stale threshold');
}

function validateApplicationNetworkObservation(value) {
  object(value, 'applicationNetworkObservation');
  if (value.schema_version !== SCHEMA_VERSION) invalid('applicationNetworkObservation.schema_version', `must be ${SCHEMA_VERSION}`);
  object(value.application, 'applicationNetworkObservation.application');
  string(value.application.application_id, 'applicationNetworkObservation.application.application_id');
  string(value.application.process_name, 'applicationNetworkObservation.application.process_name', true);
  string(value.application.display_name, 'applicationNetworkObservation.application.display_name', true);
  if (!Array.isArray(value.process_ids)) invalid('applicationNetworkObservation.process_ids', 'array required');
  value.process_ids.forEach((pid, index) => number(pid, `applicationNetworkObservation.process_ids[${index}]`, { integer: true }));
  number(value.active_connection_count, 'applicationNetworkObservation.active_connection_count', { integer: true });
  object(value.protocol_counts, 'applicationNetworkObservation.protocol_counts');
  number(value.protocol_counts.tcp, 'applicationNetworkObservation.protocol_counts.tcp', { integer: true });
  number(value.protocol_counts.udp, 'applicationNetworkObservation.protocol_counts.udp', { integer: true });
  object(value.remote_endpoints, 'applicationNetworkObservation.remote_endpoints');
  for (const field of ['total', 'unique', 'ipv4', 'ipv6', 'local', 'domestic', 'foreign', 'unknown']) {
    number(value.remote_endpoints[field], `applicationNetworkObservation.remote_endpoints.${field}`, { integer: true });
  }
  iso(value.observed_at, 'applicationNetworkObservation.observed_at');
  validateFreshness(value.freshness, 'applicationNetworkObservation.freshness');
  oneOf(value.availability, MetricAvailability, 'applicationNetworkObservation.availability');
  oneOf(value.attribution_quality, AttributionQuality, 'applicationNetworkObservation.attribution_quality');
  if (Object.hasOwn(value, 'traffic')) {
    object(value.traffic, 'applicationNetworkObservation.traffic');
    for (const field of ['upload_bytes', 'download_bytes', 'upload_rate', 'download_rate']) {
      number(value.traffic[field], `applicationNetworkObservation.traffic.${field}`);
    }
    if (value.attribution_quality !== AttributionQuality.BYTE_ATTRIBUTED && value.attribution_quality !== AttributionQuality.PARTIAL) {
      invalid('applicationNetworkObservation.traffic', 'traffic requires byte attribution');
    }
  }
  if (Object.hasOwn(value, 'regional_traffic')) {
    object(value.regional_traffic, 'applicationNetworkObservation.regional_traffic');
    for (const region of ['domestic', 'foreign']) {
      object(value.regional_traffic[region], `applicationNetworkObservation.regional_traffic.${region}`);
      for (const field of ['upload_bytes', 'download_bytes', 'upload_rate', 'download_rate']) {
        number(value.regional_traffic[region][field], `applicationNetworkObservation.regional_traffic.${region}.${field}`);
      }
    }
    if (value.attribution_quality !== AttributionQuality.BYTE_ATTRIBUTED && value.attribution_quality !== AttributionQuality.PARTIAL) {
      invalid('applicationNetworkObservation.regional_traffic', 'regional traffic requires byte attribution');
    }
  }
  if (Object.hasOwn(value, 'country_distribution')) {
    if (!Array.isArray(value.country_distribution)) invalid('applicationNetworkObservation.country_distribution', 'array required');
    value.country_distribution.forEach((entry, index) => {
      const path = `applicationNetworkObservation.country_distribution[${index}]`;
      object(entry, path);
      string(entry.country_code, `${path}.country_code`);
      for (const field of ['upload_bytes', 'download_bytes', 'upload_rate', 'download_rate']) number(entry[field], `${path}.${field}`);
    });
    if (!Object.hasOwn(value, 'regional_traffic')) invalid('applicationNetworkObservation.country_distribution', 'requires regional traffic evidence');
  }
  return value;
}

function validateEgressIdentity(value) {
  object(value, 'egressIdentity');
  if (value.schema_version !== SCHEMA_VERSION) invalid('egressIdentity.schema_version', `must be ${SCHEMA_VERSION}`);
  oneOf(value.route_kind, EgressRouteKind, 'egressIdentity.route_kind');
  oneOf(value.availability, MetricAvailability, 'egressIdentity.availability');
  if (typeof value.approximate !== 'boolean' || value.approximate !== true) invalid('egressIdentity.approximate', 'must be true');
  for (const field of ['public_ip', 'country', 'country_code', 'region', 'city', 'isp', 'asn', 'geo_provider_id']) {
    if (Object.hasOwn(value, field) && value[field] !== null) string(value[field], `egressIdentity.${field}`);
  }
  if (value.availability === MetricAvailability.AVAILABLE && !isPublicIp(value.public_ip)) {
    invalid('egressIdentity.public_ip', 'available identity requires a public IPv4 or IPv6 address');
  }
  if (Object.hasOwn(value, 'country_code') && value.country_code !== null && !/^[A-Z]{2}$/.test(value.country_code)) {
    invalid('egressIdentity.country_code', 'uppercase ISO alpha-2 code required');
  }
  if (Object.hasOwn(value, 'asn') && value.asn !== null && !/^AS\d+$/.test(value.asn)) invalid('egressIdentity.asn', 'AS number required');
  if (Object.hasOwn(value, 'confidence')) {
    if (typeof value.confidence === 'string') string(value.confidence, 'egressIdentity.confidence');
    else number(value.confidence, 'egressIdentity.confidence', { min: 0, max: 1 });
  }
  if (Object.hasOwn(value, 'latitude')) number(value.latitude, 'egressIdentity.latitude', { min: -90, max: 90 });
  if (Object.hasOwn(value, 'longitude')) number(value.longitude, 'egressIdentity.longitude', { min: -180, max: 180 });
  if (Object.hasOwn(value, 'accuracy_radius_km')) number(value.accuracy_radius_km, 'egressIdentity.accuracy_radius_km');
  if (Object.hasOwn(value, 'freshness')) validateFreshness(value.freshness, 'egressIdentity.freshness');
  if (Object.hasOwn(value, 'cache_status') && !['miss', 'hit', 'refreshed', 'stale_fallback', 'empty'].includes(value.cache_status)) {
    invalid('egressIdentity.cache_status', 'invalid cache status');
  }
  if (Object.hasOwn(value, 'source_type')) string(value.source_type, 'egressIdentity.source_type');
  if (Object.hasOwn(value, 'geo_availability')) oneOf(value.geo_availability, MetricAvailability, 'egressIdentity.geo_availability');
  if (Object.hasOwn(value, 'failure')) oneOf(value.failure, EgressFailureCode, 'egressIdentity.failure');
  if (value.geo_availability === MetricAvailability.AVAILABLE) {
    string(value.geo_provider_id, 'egressIdentity.geo_provider_id');
    if (!['country', 'country_code', 'region', 'city', 'isp', 'asn', 'latitude', 'longitude'].some((field) => Object.hasOwn(value, field))) {
      invalid('egressIdentity.geo_availability', 'available Geo requires at least one normalized Geo field');
    }
  }
  iso(value.observed_at, 'egressIdentity.observed_at');
  string(value.provider, 'egressIdentity.provider');
  return value;
}

function validateLocalNetworkIdentity(value) {
  object(value, 'localNetworkIdentity');
  if (value.schema_version !== SCHEMA_VERSION) invalid('localNetworkIdentity.schema_version', `must be ${SCHEMA_VERSION}`);
  iso(value.observed_at, 'localNetworkIdentity.observed_at');
  oneOf(value.availability, MetricAvailability, 'localNetworkIdentity.availability');
  if (value.semantics !== 'local_network_only') invalid('localNetworkIdentity.semantics', 'must be local_network_only');
  for (const [field, version] of [['active_local_ipv4', 4], ['active_local_ipv6', 6]]) {
    if (!Array.isArray(value[field])) invalid(`localNetworkIdentity.${field}`, 'array required');
    value[field].forEach((address, index) => {
      if (net.isIP(address) !== version) invalid(`localNetworkIdentity.${field}[${index}]`, `IPv${version} address required`);
    });
  }
  const count = value.active_local_ipv4.length + value.active_local_ipv6.length;
  if (value.availability === MetricAvailability.AVAILABLE && count === 0) invalid('localNetworkIdentity.availability', 'available requires an address');
  if (value.availability !== MetricAvailability.AVAILABLE && count > 0) invalid('localNetworkIdentity.availability', 'unavailable cannot contain addresses');
  return value;
}

class GeoIpProvider {
  async lookup() {
    throw new Error('GeoIpProvider.lookup must be implemented by an approved provider.');
  }

  async classifyMany() {
    throw new Error('GeoIpProvider.classifyMany must be implemented by an approved provider.');
  }
}

class EgressIdentityProvider {
  async lookup() {
    throw new Error('EgressIdentityProvider.lookup must be implemented by an approved provider.');
  }
}

module.exports = {
  ApexRuntimeState,
  ApplicationByteAccounting,
  ApplicationByteSourceType,
  AttributionQuality,
  EgressIdentityProvider,
  EgressFailureCode,
  EgressRouteKind,
  GeoIpProvider,
  NetworkRegionClassification,
  validateApplicationNetworkObservation,
  validateApplicationByteBatch,
  validateEgressIdentity,
  validateLocalNetworkIdentity
};
