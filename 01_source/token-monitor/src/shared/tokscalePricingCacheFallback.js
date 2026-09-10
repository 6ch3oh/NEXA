'use strict';

const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { tokscaleConfigDir } = require('./tokscaleConfig');

const PRICING_CACHE_TTL_SECONDS = 24 * 60 * 60;
const PRICING_PROBE_TIMEOUT_MS = 1200;
const PRICING_CACHE_SOURCES = [
  {
    id: 'models-dev',
    filename: 'pricing-models-dev.json',
    url: 'https://models.dev/api.json'
  },
  {
    id: 'litellm',
    filename: 'pricing-litellm.json',
    url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
  }
];
let loggedFallback = false;
let preparationPromise = null;

function pricingCacheDir(opts = {}) {
  return path.join(tokscaleConfigDir(opts), 'cache');
}

function pricingCachePath(source, opts = {}) {
  return path.join(pricingCacheDir(opts), source.filename);
}

function unixSeconds(now = Date.now()) {
  return Math.floor(Number(now) / 1000);
}

function validDataObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function hasRealPricingData(data) {
  return validDataObject(data) && Object.keys(data).length > 0;
}

function cacheState(cache, nowSec, ttlSeconds) {
  if (!cache || typeof cache !== 'object') return { state: 'damaged', cache: null, hasData: false };
  const timestamp = Number(cache.timestamp);
  if (!Number.isFinite(timestamp)) return { state: 'damaged', cache: null, hasData: false };
  if (!validDataObject(cache.data)) return { state: 'damaged', cache: null, hasData: false };
  const state = nowSec - timestamp > ttlSeconds ? 'expired' : 'valid';
  return { state, cache: { timestamp, data: cache.data }, hasData: hasRealPricingData(cache.data) };
}

function writeJsonAtomic(filePath, value, deps) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  deps.fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    deps.fs.writeFileSync(tempPath, `${JSON.stringify(value)}\n`, 'utf8');
    deps.fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { deps.fs.rmSync(tempPath, { force: true }); } catch (_) {}
    throw error;
  }
}

function probeUrlReachable({ timeoutMs = PRICING_PROBE_TIMEOUT_MS, url } = {}) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      finish(Number(res.statusCode) >= 200 && Number(res.statusCode) < 500);
      req.destroy();
    });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
  });
}

async function preparePricingCacheSource(source, options, deps, nowSec, ttlSeconds) {
  const cachePath = options.cachePaths?.[source.id] || pricingCachePath(source, {
    env: options.env || process.env,
    platform: 'win32',
    homeDir: options.homeDir || os.homedir()
  });

  let parsed;
  try {
    const raw = deps.fs.readFileSync(cachePath, 'utf8');
    parsed = cacheState(JSON.parse(raw), nowSec, ttlSeconds);
  } catch (error) {
    parsed = { state: error?.code === 'ENOENT' ? 'missing' : 'damaged', cache: null, hasData: false };
  }

  if (parsed.state === 'valid') {
    return { ok: true, source: source.id, action: 'preserved', cachePath, hasData: parsed.hasData };
  }

  let payload = { timestamp: nowSec, data: {} };
  if (parsed.state === 'expired') {
    const probe = options.probeUrlReachable || probeUrlReachable;
    const reachable = await probe({ source, timeoutMs: options.probeTimeoutMs, url: source.url });
    if (reachable) {
      return { ok: true, source: source.id, action: 'preserved-expired-online', cachePath, hasData: parsed.hasData };
    }
    // Offline-only degradation: keep Tokscale off the slow pricing-source retry
    // path while preserving any real prices it already cached. This is not the
    // normal online update mechanism; when the probe succeeds, the expired file
    // is left untouched so Tokscale can refresh it itself.
    payload = { timestamp: nowSec, data: parsed.cache?.data || {} };
  }

  try {
    writeJsonAtomic(cachePath, payload, deps);
    return { ok: true, source: source.id, action: 'wrote', reason: parsed.state, cachePath, hasData: parsed.hasData };
  } catch (error) {
    return { ok: false, source: source.id, action: 'failed', reason: parsed.state, cachePath, error };
  }
}

async function prepareTokscalePricingCacheFallback(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return [{ ok: true, action: 'skipped', platform }];

  const deps = { fs: options.fs || fs };
  const sources = options.sources || PRICING_CACHE_SOURCES;
  const nowSec = unixSeconds(options.now ?? Date.now());
  const ttlSeconds = Number.isFinite(Number(options.ttlSeconds))
    ? Number(options.ttlSeconds)
    : PRICING_CACHE_TTL_SECONDS;
  const results = [];
  for (const source of sources) {
    results.push(await preparePricingCacheSource(source, options, deps, nowSec, ttlSeconds));
  }

  const usedFallback = results.some((result) => result.action === 'wrote');
  const failed = results.find((result) => result.action === 'failed');
  if (typeof options.logger === 'function' && !loggedFallback && (usedFallback || failed)) {
    loggedFallback = true;
    options.logger(failed
      ? `[tokscale] pricing cache fallback partially skipped: ${failed.error.message}`
      : '[tokscale] using offline pricing cache fallback');
  }
  return results;
}

function ensureTokscalePricingCacheFallback(options = {}) {
  if (options.disableMemoization) return prepareTokscalePricingCacheFallback(options);
  if (!preparationPromise) preparationPromise = prepareTokscalePricingCacheFallback(options);
  return preparationPromise;
}

function resetTokscalePricingCacheFallbackForTests() {
  loggedFallback = false;
  preparationPromise = null;
}

module.exports = {
  PRICING_CACHE_SOURCES,
  PRICING_CACHE_TTL_SECONDS,
  PRICING_PROBE_TIMEOUT_MS,
  ensureTokscalePricingCacheFallback,
  prepareTokscalePricingCacheFallback,
  pricingCacheDir,
  pricingCachePath,
  probeUrlReachable,
  resetTokscalePricingCacheFallbackForTests
};