'use strict';

const crypto = require('node:crypto');
const { ALLOWED_RESOURCE_TYPES, RUNTIME_BUNDLE_CONTRACT_VERSION } = require('../shared/mobileRuntimeBundleProtocol');

const EXECUTABLE_EXTENSION = /\.(?:dex|jar|class|so|apk|exe|dll|bat|cmd|ps1|sh|js|mjs|kts)$/iu;
const SAFE_PATH = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/u;

function fail(code, message) { return Object.assign(new TypeError(message), { code }); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function typeMatches(type, resourcePath) {
  if (type === 'STATIC_ICON') return /\.(?:png|webp|svg)$/iu.test(resourcePath);
  if (['COPY', 'DICTIONARY'].includes(type)) return /\.(?:json|txt)$/iu.test(resourcePath);
  return /\.json$/iu.test(resourcePath);
}

function createRuntimeBundle({ version, createdAt = new Date().toISOString(), releaseNotes = '', resources } = {}) {
  if (!Number.isSafeInteger(version) || version < 1 || !resources || typeof resources !== 'object') throw fail('RUNTIME_BUNDLE_INVALID', 'version and resources are required');
  const encoded = {};
  const manifestResources = [];
  for (const [resourcePath, descriptor] of Object.entries(resources)) {
    const type = String(descriptor?.type || '');
    const content = Buffer.isBuffer(descriptor?.content) ? descriptor.content : Buffer.from(String(descriptor?.content ?? ''), 'utf8');
    if (!SAFE_PATH.test(resourcePath) || resourcePath.split('/').includes('..') || EXECUTABLE_EXTENSION.test(resourcePath)) throw fail('RUNTIME_RESOURCE_REJECTED', 'runtime resource path is unsafe');
    if (!ALLOWED_RESOURCE_TYPES.includes(type) || !typeMatches(type, resourcePath) || content.byteLength > 4 * 1024 * 1024) throw fail('RUNTIME_RESOURCE_REJECTED', 'runtime resource type or size is unsafe');
    encoded[resourcePath] = content.toString('base64');
    manifestResources.push(Object.freeze({ path: resourcePath, type, sha256: sha256(content), size_bytes: content.byteLength }));
  }
  if (manifestResources.length === 0 || manifestResources.length > 256) throw fail('RUNTIME_BUNDLE_INVALID', 'runtime bundle must contain 1 to 256 resources');
  return Object.freeze({
    contract_version: RUNTIME_BUNDLE_CONTRACT_VERSION,
    manifest: Object.freeze({ manifest_version: 1, bundle_version: version, created_at: createdAt, release_notes: String(releaseNotes).slice(0, 1000), resources: Object.freeze(manifestResources) }),
    resources: Object.freeze(encoded),
  });
}

function defaultWave008RuntimeBundle() {
  return createRuntimeBundle({
    version: 1,
    createdAt: '2026-09-05T00:00:00.000Z',
    releaseNotes: 'Wave 008 初始运行时配置包',
    resources: {
      'layout/home.json': { type: 'LAYOUT_CONFIG', content: JSON.stringify({ version: 1, cards: ['connection', 'calendar', 'bills', 'command'] }) },
      'theme/tokens.json': { type: 'THEME_TOKENS', content: JSON.stringify({ version: 1, accent: 'nexa-blue', density: 'comfortable' }) },
      'flags/features.json': { type: 'FEATURE_FLAGS', content: JSON.stringify({ version: 1, calendar: true, bills: true, commandRelay: true }) },
      'schema/mobile-query.json': { type: 'QUERY_SCHEMA', content: JSON.stringify({ version: 1, ranges: ['today', 'week', 'month', 'year', 'custom'] }) },
      'policy/retention.json': { type: 'RETENTION_POLICY', content: JSON.stringify({ version: 1, deviceRawDays: 7, hourlyDays: 90, dailyDays: 0 }) },
    }
  });
}

function createMobileRuntimeBundleApplication({ bundle = defaultWave008RuntimeBundle() } = {}) {
  return Object.freeze({
    status() { return Object.freeze({ contract_version: bundle.contract_version, available: true, update_type: 'RUNTIME_BUNDLE', manifest: bundle.manifest, requires_user_confirmation: false }); },
    resource(resourcePath) {
      if (!Object.hasOwn(bundle.resources, resourcePath)) throw fail('RUNTIME_RESOURCE_NOT_FOUND', 'runtime resource was not found');
      return Object.freeze({ path: resourcePath, encoding: 'base64', content: bundle.resources[resourcePath] });
    }
  });
}

module.exports = { createMobileRuntimeBundleApplication, createRuntimeBundle, defaultWave008RuntimeBundle, sha256 };
