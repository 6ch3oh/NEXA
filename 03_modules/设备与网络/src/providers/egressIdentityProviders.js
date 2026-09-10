'use strict';

const { EgressIdentityProvider, GeoIpProvider } = require('../applicationNetworkContracts');
const { ipAddressesEqual, isPublicIp } = require('../ipAddress');

const DEFAULT_EXTERNAL_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const IPIFY_ENDPOINT = 'https://api64.ipify.org?format=json';
const IPAPI_BASE = 'https://ipapi.co';

function sanitizedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const SAFE_ERROR_CODES = new Set([
  'DNS_FAILURE', 'HTTP_FAILURE', 'HTTP_UNAVAILABLE', 'INVALID_JSON', 'INVALID_PUBLIC_IP',
  'INVALID_PROVIDER_OBSERVATION', 'INVALID_TIMEOUT', 'NETWORK_FAILURE', 'PROVIDER_FAILURE', 'PROVIDER_IP_MISMATCH',
  'RATE_LIMITED', 'RESPONSE_TOO_LARGE', 'TIMEOUT'
]);

async function requestJson(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_EXTERNAL_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
} = {}) {
  if (typeof fetchImpl !== 'function') throw sanitizedError('HTTP_UNAVAILABLE');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw sanitizedError('INVALID_TIMEOUT');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'NEXA-Device-Network/0.1' },
      redirect: 'error',
      signal: controller.signal
    });
    if (!response || response.ok !== true) throw sanitizedError(response?.status === 429 ? 'RATE_LIMITED' : 'HTTP_FAILURE');
    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > maxResponseBytes) throw sanitizedError('RESPONSE_TOO_LARGE');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw sanitizedError('RESPONSE_TOO_LARGE');
    try { return JSON.parse(text); } catch { throw sanitizedError('INVALID_JSON'); }
  } catch (error) {
    if (error?.name === 'AbortError') throw sanitizedError('TIMEOUT');
    if (SAFE_ERROR_CODES.has(error?.code)) throw sanitizedError(error.code);
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(error?.code) || ['ENOTFOUND', 'EAI_AGAIN'].includes(error?.cause?.code)) {
      throw sanitizedError('DNS_FAILURE');
    }
    throw sanitizedError('NETWORK_FAILURE');
  } finally {
    clearTimeout(timer);
  }
}

function optionalString(value, max = 160) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function normalizeAsn(value) {
  const text = optionalString(value, 32);
  return text && /^AS\d+$/i.test(text) ? text.toUpperCase() : undefined;
}

class IpifyPublicIpProvider extends EgressIdentityProvider {
  constructor(options = {}) {
    super();
    this.providerId = 'ipify';
    this.request = options.request || ((url) => requestJson(url, options));
    this.now = options.now || (() => new Date());
  }

  async lookup() {
    const raw = await this.request(IPIFY_ENDPOINT);
    const publicIp = optionalString(raw?.ip, 64);
    if (!publicIp || !isPublicIp(publicIp)) throw sanitizedError('INVALID_PUBLIC_IP');
    return { publicIp, observedAt: this.now().toISOString(), providerId: this.providerId, sourceType: 'external_observation' };
  }
}

class IpapiGeoIpProvider extends GeoIpProvider {
  constructor(options = {}) {
    super();
    this.providerId = 'ipapi-co';
    this.request = options.request || ((url) => requestJson(url, options));
  }

  async lookup(ip) {
    if (!isPublicIp(ip)) throw sanitizedError('INVALID_PUBLIC_IP');
    const raw = await this.request(`${IPAPI_BASE}/${encodeURIComponent(ip)}/json/`);
    if (raw?.error === true) throw sanitizedError(/rate/i.test(String(raw?.reason || '')) ? 'RATE_LIMITED' : 'PROVIDER_FAILURE');
    if (raw?.ip !== undefined && !ipAddressesEqual(raw.ip, ip)) throw sanitizedError('PROVIDER_IP_MISMATCH');
    const result = { geoProviderId: this.providerId };
    const mappings = [['country_name', 'country'], ['region', 'region'], ['city', 'city'], ['org', 'isp']];
    for (const [source, target] of mappings) {
      const value = optionalString(raw?.[source]);
      if (value) result[target] = value;
    }
    const asn = normalizeAsn(raw?.asn);
    if (asn) result.asn = asn;
    const countryCode = optionalString(raw?.country_code, 2);
    if (countryCode && /^[A-Za-z]{2}$/.test(countryCode)) result.countryCode = countryCode.toUpperCase();
    if (Number.isFinite(raw?.latitude) && raw.latitude >= -90 && raw.latitude <= 90) result.latitude = raw.latitude;
    if (Number.isFinite(raw?.longitude) && raw.longitude >= -180 && raw.longitude <= 180) result.longitude = raw.longitude;
    return result;
  }
}

module.exports = {
  DEFAULT_EXTERNAL_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
  IPAPI_BASE,
  IPIFY_ENDPOINT,
  IpapiGeoIpProvider,
  IpifyPublicIpProvider,
  isPublicIp,
  requestJson
};
