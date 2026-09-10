'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PRICING_CACHE_SOURCES,
  PRICING_CACHE_TTL_SECONDS,
  prepareTokscalePricingCacheFallback,
  resetTokscalePricingCacheFallbackForTests
} = require('../../src/shared/tokscalePricingCacheFallback');
const { spawnTokscaleJson } = require('../../src/shared/collector');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-cache-'));
}

function cachePath(dir, source) {
  return path.join(dir, 'cache', source.filename);
}

function cachePaths(dir) {
  return Object.fromEntries(PRICING_CACHE_SOURCES.map((source) => [source.id, cachePath(dir, source)]));
}

function writeCache(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

function readCache(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('valid pricing caches are preserved without probing', async () => {
  resetTokscalePricingCacheFallbackForTests();
  const dir = tmpDir();
  try {
    const originals = new Map();
    for (const source of PRICING_CACHE_SOURCES) {
      const original = JSON.stringify({
        timestamp: 1_800_000_000,
        data: source.id === 'models-dev'
          ? { 'gpt-5': { input_cost_per_million_tokens: 1.25 } }
          : { 'gpt-5': { input_cost_per_token: 0.00000125 } }
      });
      originals.set(source.id, original);
      fs.mkdirSync(path.dirname(cachePath(dir, source)), { recursive: true });
      fs.writeFileSync(cachePath(dir, source), original, 'utf8');
    }
    let probes = 0;

    const results = await prepareTokscalePricingCacheFallback({
      platform: 'win32',
      cachePaths: cachePaths(dir),
      now: 1_800_000_100_000,
      probeUrlReachable: async () => { probes += 1; return false; }
    });

    assert.deepEqual(results.map((result) => result.action), ['preserved', 'preserved']);
    assert.equal(probes, 0);
    for (const source of PRICING_CACHE_SOURCES) {
      assert.equal(fs.readFileSync(cachePath(dir, source), 'utf8'), originals.get(source.id));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('expired real pricing caches keep data during offline fallback', async () => {
  resetTokscalePricingCacheFallbackForTests();
  const dir = tmpDir();
  try {
    const dataBySource = new Map();
    for (const source of PRICING_CACHE_SOURCES) {
      const data = { [`${source.id}-model`]: { input_cost_per_million_tokens: 1.25 } };
      dataBySource.set(source.id, data);
      writeCache(cachePath(dir, source), { timestamp: 1, data });
    }
    const nowSec = 1 + PRICING_CACHE_TTL_SECONDS + 1;
    const probed = [];

    const results = await prepareTokscalePricingCacheFallback({
      platform: 'win32',
      cachePaths: cachePaths(dir),
      now: nowSec * 1000,
      probeUrlReachable: async ({ source }) => { probed.push(source.id); return false; }
    });

    assert.deepEqual(probed.sort(), PRICING_CACHE_SOURCES.map((source) => source.id).sort());
    assert.deepEqual(results.map((result) => result.action), ['wrote', 'wrote']);
    for (const source of PRICING_CACHE_SOURCES) {
      assert.deepEqual(readCache(cachePath(dir, source)), {
        timestamp: nowSec,
        data: dataBySource.get(source.id)
      });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('network reachable leaves expired pricing caches untouched so tokscale can update them', async () => {
  resetTokscalePricingCacheFallbackForTests();
  const dir = tmpDir();
  try {
    const originals = new Map();
    for (const source of PRICING_CACHE_SOURCES) {
      const original = JSON.stringify({
        timestamp: 1,
        data: { [`${source.id}-model`]: { input_cost_per_million_tokens: 1.25 } }
      });
      originals.set(source.id, original);
      fs.mkdirSync(path.dirname(cachePath(dir, source)), { recursive: true });
      fs.writeFileSync(cachePath(dir, source), original, 'utf8');
    }
    const nowSec = 1 + PRICING_CACHE_TTL_SECONDS + 1;
    const probed = [];

    const results = await prepareTokscalePricingCacheFallback({
      platform: 'win32',
      cachePaths: cachePaths(dir),
      now: nowSec * 1000,
      probeUrlReachable: async ({ source }) => { probed.push(source.id); return true; }
    });

    assert.deepEqual(probed.sort(), PRICING_CACHE_SOURCES.map((source) => source.id).sort());
    assert.deepEqual(results.map((result) => result.action), ['preserved-expired-online', 'preserved-expired-online']);
    for (const source of PRICING_CACHE_SOURCES) {
      assert.equal(fs.readFileSync(cachePath(dir, source), 'utf8'), originals.get(source.id));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing pricing caches are created as legal empty caches', async () => {
  resetTokscalePricingCacheFallbackForTests();
  const dir = tmpDir();
  try {
    const nowSec = 1_800_000_000;
    const results = await prepareTokscalePricingCacheFallback({
      platform: 'win32',
      cachePaths: cachePaths(dir),
      now: nowSec * 1000
    });

    assert.deepEqual(results.map((result) => result.reason), ['missing', 'missing']);
    for (const source of PRICING_CACHE_SOURCES) {
      assert.deepEqual(readCache(cachePath(dir, source)), { timestamp: nowSec, data: {} });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('damaged pricing caches are replaced with legal empty caches', async () => {
  resetTokscalePricingCacheFallbackForTests();
  const dir = tmpDir();
  try {
    for (const source of PRICING_CACHE_SOURCES) {
      fs.mkdirSync(path.dirname(cachePath(dir, source)), { recursive: true });
      fs.writeFileSync(cachePath(dir, source), '{', 'utf8');
    }
    const nowSec = 1_800_000_010;
    const results = await prepareTokscalePricingCacheFallback({
      platform: 'win32',
      cachePaths: cachePaths(dir),
      now: nowSec * 1000
    });

    assert.deepEqual(results.map((result) => result.reason), ['damaged', 'damaged']);
    for (const source of PRICING_CACHE_SOURCES) {
      assert.deepEqual(readCache(cachePath(dir, source)), { timestamp: nowSec, data: {} });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('expired empty pricing caches refresh only when sources are unavailable', async () => {
  resetTokscalePricingCacheFallbackForTests();
  const dir = tmpDir();
  try {
    for (const source of PRICING_CACHE_SOURCES) {
      writeCache(cachePath(dir, source), { timestamp: 1, data: {} });
    }
    const nowSec = 1 + PRICING_CACHE_TTL_SECONDS + 1;

    const results = await prepareTokscalePricingCacheFallback({
      platform: 'win32',
      cachePaths: cachePaths(dir),
      now: nowSec * 1000,
      probeUrlReachable: async () => false
    });

    assert.deepEqual(results.map((result) => result.action), ['wrote', 'wrote']);
    for (const source of PRICING_CACHE_SOURCES) {
      assert.deepEqual(readCache(cachePath(dir, source)), { timestamp: nowSec, data: {} });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('write failures are returned instead of thrown', async () => {
  resetTokscalePricingCacheFallbackForTests();
  const missing = new Error('missing');
  missing.code = 'ENOENT';
  let results;
  await assert.doesNotReject(async () => {
    results = await prepareTokscalePricingCacheFallback({
      platform: 'win32',
      fs: {
        readFileSync() { throw missing; },
        mkdirSync() { throw new Error('denied'); },
        writeFileSync() { throw new Error('unexpected write'); },
        renameSync() {},
        rmSync() {}
      }
    });
  });

  assert.deepEqual(results.map((result) => result.action), ['failed', 'failed']);
  assert.deepEqual(results.map((result) => result.reason), ['missing', 'missing']);
});

test('collector prepares pricing caches before spawning tokscale', async () => {
  const events = [];
  const parsed = await spawnTokscaleJson(['--json'], 1000, {
    ensurePricingCacheFallback: async () => { events.push('prepare'); },
    tokscaleCommand: () => ({ bin: 'tokscale', prefixArgs: [], env: {} }),
    spawn: () => {
      events.push('spawn');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from('{"ok":true}'));
        child.emit('close', 0);
      });
      return child;
    }
  });

  assert.deepEqual(parsed, { ok: true });
  assert.deepEqual(events, ['prepare', 'spawn']);
});