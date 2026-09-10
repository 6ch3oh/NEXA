'use strict';

(function initCalendarLocalAiConfig(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.CalendarLocalAiConfig = api;
})(typeof globalThis === 'object' ? globalThis : this, function calendarLocalAiConfigFactory() {
  const CONFIG_VERSION = 2;
  const PROTOCOLS = Object.freeze(['openai-chat', 'ollama-chat']);
  const AUTHORIZATION_MODES = Object.freeze(['none', 'bearer-env']);
  const STREAMING_CAPABILITIES = Object.freeze(['unknown', 'supported', 'unsupported']);
  const STRUCTURED_JSON_CAPABILITIES = Object.freeze(['unknown', 'native', 'json-schema', 'prompt-only', 'unsupported']);
  const DEFAULT_TIMEOUT_MS = 30_000;
  const DEFAULT_MAX_CONCURRENCY = 1;

  function bounded(value, limit = 512) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function enumValue(value, values, fallback = '') {
    const normalized = bounded(value, 64);
    return values.includes(normalized) ? normalized : fallback;
  }

  function integer(value, fallback, minimum, maximum) {
    const normalized = Math.trunc(Number(value));
    return Number.isFinite(normalized) ? Math.max(minimum, Math.min(maximum, normalized)) : fallback;
  }

  function defaultCalendarLocalAiConfiguration() {
    return {
      version: CONFIG_VERSION,
      enabled: true,
      providerId: '',
      baseUrl: '',
      protocol: '',
      modelId: '',
      authorizationMode: 'none',
      credentialReference: '',
      healthCheckEndpoint: '',
      generationEndpoint: '',
      streamingCapability: 'unknown',
      structuredJsonCapability: 'unknown',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxConcurrency: DEFAULT_MAX_CONCURRENCY
    };
  }

  // Wave 008 verified this exact OpenAI/LM-Studio-compatible local endpoint.
  // Production closeout identified the serving manager as Bionic.  This is
  // connection metadata only: no credential or user content is stored here.
  function verifiedLocalAiConfiguration() {
    return Object.freeze({
      ...defaultCalendarLocalAiConfiguration(),
      providerId: 'bionic-lmstudio-compatible',
      baseUrl: 'http://127.0.0.1:1234',
      protocol: 'openai-chat',
      modelId: 'qwen3-4b-instruct-2507',
      healthCheckEndpoint: '/v1/models',
      generationEndpoint: '/v1/chat/completions',
      streamingCapability: 'supported',
      structuredJsonCapability: 'json-schema',
      timeoutMs: 120_000
    });
  }

  function normalizeCalendarLocalAiConfiguration(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.freeze({
      version: CONFIG_VERSION,
      enabled: source.enabled !== false,
      providerId: bounded(source.providerId, 100),
      baseUrl: bounded(source.baseUrl, 2048).replace(/\/+$/u, ''),
      protocol: enumValue(source.protocol, PROTOCOLS),
      modelId: bounded(source.modelId, 200),
      authorizationMode: source.authorizationMode == null || bounded(source.authorizationMode, 64) === ''
        ? 'none'
        : enumValue(source.authorizationMode, AUTHORIZATION_MODES),
      credentialReference: bounded(source.credentialReference, 200),
      healthCheckEndpoint: bounded(source.healthCheckEndpoint, 512),
      generationEndpoint: bounded(source.generationEndpoint, 512),
      streamingCapability: enumValue(source.streamingCapability, STREAMING_CAPABILITIES, 'unknown'),
      structuredJsonCapability: enumValue(source.structuredJsonCapability, STRUCTURED_JSON_CAPABILITIES, 'unknown'),
      timeoutMs: integer(source.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
      maxConcurrency: integer(source.maxConcurrency, DEFAULT_MAX_CONCURRENCY, 1, 8)
    });
  }

  function isPrivateIpv4(hostname) {
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254);
  }

  function isLocalModelBaseUrl(value) {
    let parsed;
    try { parsed = new URL(value); } catch (_) { return false; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    const hostname = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    return hostname === 'localhost' || hostname === '::1' || isPrivateIpv4(hostname) ||
      hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8') || hostname.startsWith('fe9') ||
      hostname.startsWith('fea') || hostname.startsWith('feb');
  }

  function isLoopbackModelBaseUrl(value) {
    let parsed;
    try { parsed = new URL(value); } catch (_) { return false; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    const hostname = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    return hostname === 'localhost' || hostname === '::1' || hostname === '127.0.0.1';
  }

  function isSafeEndpointPath(value) {
    return typeof value === 'string' && /^\/(?!\/)[^?#\s]{0,510}$/u.test(value);
  }

  function isEnvironmentCredentialReference(value) {
    return /^env:[A-Z_][A-Z0-9_]{0,127}$/u.test(String(value || ''));
  }

  function calendarLocalAiReadiness(value) {
    const configuration = normalizeCalendarLocalAiConfiguration(value);
    const identifyingValues = [
      configuration.providerId,
      configuration.baseUrl,
      configuration.protocol,
      configuration.modelId,
      configuration.healthCheckEndpoint,
      configuration.generationEndpoint
    ];
    if (identifyingValues.every((item) => item === '')) {
      return Object.freeze({ status: 'unconfigured', configured: false, canHealthCheck: false, canGenerate: false, issues: Object.freeze([]), configuration });
    }
    if (!configuration.enabled) {
      return Object.freeze({ status: 'disabled', configured: true, canHealthCheck: false, canGenerate: false, issues: Object.freeze([]), configuration });
    }
    const issues = [];
    if (!configuration.providerId) issues.push('PROVIDER_ID_REQUIRED');
    if (!configuration.baseUrl) issues.push('BASE_URL_REQUIRED');
    else if (!isLocalModelBaseUrl(configuration.baseUrl)) issues.push('BASE_URL_NOT_LOCAL');
    else if (['lm-studio', 'bionic-lmstudio-compatible'].includes(configuration.providerId) && !isLoopbackModelBaseUrl(configuration.baseUrl)) {
      issues.push('BASE_URL_NOT_LOOPBACK');
    }
    if (!configuration.protocol) issues.push('PROTOCOL_REQUIRED');
    if (!configuration.modelId) issues.push('MODEL_ID_REQUIRED');
    if (!configuration.healthCheckEndpoint) issues.push('HEALTH_ENDPOINT_REQUIRED');
    else if (!isSafeEndpointPath(configuration.healthCheckEndpoint)) issues.push('HEALTH_ENDPOINT_INVALID');
    if (!configuration.generationEndpoint) issues.push('GENERATION_ENDPOINT_REQUIRED');
    else if (!isSafeEndpointPath(configuration.generationEndpoint)) issues.push('GENERATION_ENDPOINT_INVALID');
    if (!AUTHORIZATION_MODES.includes(configuration.authorizationMode)) issues.push('AUTHORIZATION_MODE_REQUIRED');
    else if (configuration.authorizationMode === 'bearer-env' && !isEnvironmentCredentialReference(configuration.credentialReference)) {
      issues.push('CREDENTIAL_REFERENCE_REQUIRED');
    }
    if (configuration.structuredJsonCapability === 'unknown') issues.push('STRUCTURED_JSON_CAPABILITY_REQUIRED');
    if (configuration.structuredJsonCapability === 'unsupported') issues.push('STRUCTURED_JSON_UNSUPPORTED');
    const status = issues.length === 0 ? 'ready_for_health_check' : 'configuration_incomplete';
    return Object.freeze({
      status,
      configured: true,
      canHealthCheck: issues.length === 0,
      canGenerate: issues.length === 0,
      issues: Object.freeze(issues),
      configuration
    });
  }

  function joinLocalEndpoint(baseUrl, endpointPath) {
    if (!isLocalModelBaseUrl(baseUrl) || !isSafeEndpointPath(endpointPath)) {
      throw Object.assign(new Error('Local AI endpoint configuration is invalid'), { code: 'AI_CONFIGURATION_INVALID' });
    }
    const base = new URL(baseUrl);
    return new URL(endpointPath, `${base.origin}/`).toString();
  }

  return Object.freeze({
    AUTHORIZATION_MODES,
    CONFIG_VERSION,
    DEFAULT_MAX_CONCURRENCY,
    DEFAULT_TIMEOUT_MS,
    PROTOCOLS,
    STREAMING_CAPABILITIES,
    STRUCTURED_JSON_CAPABILITIES,
    calendarLocalAiReadiness,
    defaultCalendarLocalAiConfiguration,
    isEnvironmentCredentialReference,
    isLocalModelBaseUrl,
    isLoopbackModelBaseUrl,
    isSafeEndpointPath,
    joinLocalEndpoint,
    normalizeCalendarLocalAiConfiguration,
    verifiedLmStudioConfiguration: verifiedLocalAiConfiguration,
    verifiedLocalAiConfiguration
  });
});
