'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CAPABILITIES,
  createRenderer,
  presentationState,
  productSummary,
  statusLabel
} = require('../../src/electron/renderer/nexaStarBenchRenderer');

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.textContent = '';
    this.className = '';
    this.listeners = new Map();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
}

function createSurface() {
  const ownerDocument = { createElement: (tagName) => new FakeElement(tagName, ownerDocument) };
  return new FakeElement('section', ownerDocument);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('projects every public readiness state without inventing business meaning', () => {
  assert.deepEqual(
    ['ready', 'empty', 'partial', 'unavailable', 'stale', 'error'].map(statusLabel),
    ['可用', '暂无记录', '部分可用', '能力尚不可用', '数据较旧', '读取失败']
  );
  assert.deepEqual(
    ['ready', 'empty', 'partial', 'unavailable', 'stale', 'error'].map(presentationState),
    ['READY', 'READY', 'LIMITED', 'UNAVAILABLE', 'LIMITED', 'ERROR']
  );
});

test('renders all six safe read capabilities with product summary semantics and null cost', async () => {
  const surface = createSurface();
  const reads = [];
  const contexts = [];
  const renderer = createRenderer({
    surface,
    onContextChange: (value) => contexts.push(value),
    api: {
      async start() { return { ok: true, value: { status: 'ready' } }; },
      async stop() { return { ok: true }; },
      async getReadiness() { return { ok: true, value: { status: 'ready' } }; },
      async read(capability) {
        reads.push(capability);
        const unavailable = ['request_records', 'external_identity_evidence'].includes(capability);
        return { ok: true, value: {
          status: unavailable ? 'unavailable' : 'empty',
          items: capability === 'token_cost_observations' ? [{ cost: null }] : [],
          summary: {
            product_state: unavailable ? 'UNAVAILABLE' : 'EMPTY',
            source_health: unavailable ? 'NOT_AVAILABLE' : 'HEALTHY',
            freshness: unavailable ? 'UNKNOWN' : 'CURRENT',
            checked_at: '2026-08-30T08:00:00Z',
            user_status: unavailable
              ? { label: '能力尚不可用', message: '当前尚未接入可读取的数据来源，不需要你进行配置。' }
              : { label: '暂无记录', message: '数据源正常，当前没有可显示记录。' },
            ...(capability === 'external_identity_evidence'
              ? { safety_notice: '外部身份参考不得证明官方身份。' } : {})
          }
        } };
      }
    }
  });
  const result = await renderer.activate();
  assert.equal(result.status, 'READY');
  assert.deepEqual(reads, CAPABILITIES.map(({ id }) => id));
  assert.equal(surface.children.length, 1);
  const serialized = JSON.stringify(surface);
  assert.match(serialized, /4 项可读取，2 项尚不可用/);
  assert.match(serialized, /外部身份参考不得证明官方身份/);
  assert.match(serialized, /用途：/);
  assert.match(serialized, /原因：/);
  assert.match(serialized, /下一步：/);
  assert.match(serialized, /刷新公开数据|查看配置与数据来源/);
  assert.match(serialized, /最近检查：/);
  assert.match(serialized, /\\"cost\\": null/);
  for (const internal of ['Canonical Identity', 'Core', 'Store', 'Ledger', 'Desktop handoff']) {
    assert.doesNotMatch(serialized, new RegExp(internal));
  }
  assert.equal(contexts.at(-1).status, 'READY');
});

test('product summary owns EMPTY, UNAVAILABLE, STALE, and ERROR user semantics', () => {
  assert.deepEqual(productSummary({ status: 'ready', summary: {
    product_state: 'STALE', source_health: 'STALE', freshness: 'STALE',
    checked_at: '2026-08-30T08:00:00Z',
    user_status: { label: '数据可能已过期', message: '请结合最近更新时间判断。' }
  } }), {
    status: 'stale', label: '数据可能已过期', message: '请结合最近更新时间判断。',
    checkedAt: '2026-08-30T08:00:00Z', sourceHealth: 'STALE', freshness: 'STALE', safetyNotice: null
  });
});

test('stale empty capabilities never present themselves as current empty data', async () => {
  const surface = createSurface();
  const renderer = createRenderer({
    surface,
    api: {
      async start() { return { ok: true, value: { status: 'stale' } }; },
      async stop() { return { ok: true }; },
      async getReadiness() { return { ok: true, value: { status: 'stale' } }; },
      async read() {
        return { ok: true, value: {
          status: 'stale', items: [], summary: { product_state: 'STALE', freshness: 'STALE' }
        } };
      }
    }
  });
  assert.equal((await renderer.activate()).status, 'LIMITED');
  const serialized = JSON.stringify(surface);
  assert.match(serialized, /数据来源返回了较旧状态/);
  assert.match(serialized, /最近检查时间/);
  assert.doesNotMatch(serialized, /数据来源可读，但当前没有可显示记录/);
});

test('stale activation cannot write after unmount and repeated enter/leave is stable', async () => {
  const surface = createSurface();
  const gate = deferred();
  let starts = 0;
  let stops = 0;
  let reads = 0;
  const renderer = createRenderer({
    surface,
    api: {
      async start() { starts += 1; if (starts === 1) await gate.promise; return { ok: true, value: { status: 'unavailable' } }; },
      async stop() { stops += 1; return { ok: true }; },
      async getReadiness() { return { ok: true, value: { status: 'unavailable' } }; },
      async read() { reads += 1; return { ok: true, value: { status: 'unavailable', items: [] } }; }
    }
  });
  const staleActivation = renderer.activate();
  await Promise.resolve();
  await Promise.resolve();
  const firstUnmount = renderer.unmount();
  gate.resolve();
  await Promise.all([staleActivation, firstUnmount]);
  assert.equal(surface.children.length, 0);
  assert.equal(reads, 0);

  await renderer.activate();
  assert.equal(reads, CAPABILITIES.length);
  await renderer.unmount();
  assert.equal(surface.children.length, 0);
  assert.equal(starts, 2);
  assert.equal(stops, 2);
});

test('module failure remains inside the StarBench surface', async () => {
  const surface = createSurface();
  const renderer = createRenderer({
    surface,
    api: {
      async start() { return { ok: false, error: { code: 'PUBLIC_ENTRY_UNAVAILABLE' } }; },
      async stop() { return { ok: true }; },
      async getReadiness() { throw new Error('must not be called'); },
      async read() { throw new Error('must not be called'); }
    }
  });
  assert.equal((await renderer.activate()).status, 'ERROR');
  assert.equal(surface.children.length, 1);
  const serialized = JSON.stringify(surface);
  assert.match(serialized, /StarBench 当前不可用/);
  assert.match(serialized, /用途：StarBench/);
  assert.match(serialized, /原因：本地只读服务/);
  assert.match(serialized, /数据新鲜度未知/);
  assert.match(serialized, /下一步：重新连接/);
  assert.match(serialized, /重新连接/);
});

test('failed capability reads expose bounded guidance and never raw failure details', async () => {
  const surface = createSurface();
  const renderer = createRenderer({
    surface,
    api: {
      async start() { return { ok: true, value: { status: 'ready' } }; },
      async stop() { return { ok: true }; },
      async getReadiness() { return { ok: true, value: { status: 'ready' } }; },
      async read() { return { ok: false, error: { code: 'private/path', message: 'secret detail' } }; }
    }
  });
  assert.equal((await renderer.activate()).status, 'ERROR');
  const serialized = JSON.stringify(surface);
  assert.match(serialized, /STARBENCH_READ_UNAVAILABLE/);
  assert.match(serialized, /重新读取公开数据/);
  assert.match(serialized, /最近检查：未提供 · 数据新鲜度未知/);
  assert.doesNotMatch(serialized, /private\/path|secret detail/);
});
