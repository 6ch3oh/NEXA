'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WINDOWS,
  createRenderer,
  activityCopy,
  formatCount,
  formatDateTime,
  statusCopy
} = require('../../src/electron/renderer/nexaCreatorOpsHomeWidgetRenderer');
const { createNexaWidgetHost } = require('../../src/electron/renderer/nexaWidgetHost');

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  values() { return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean)); }
  toggle(name, force) {
    const values = this.values();
    const add = force === undefined ? !values.has(name) : force;
    if (add) values.add(name);
    else values.delete(name);
    this.owner.className = [...values].join(' ');
    return add;
  }
  contains(name) { return this.values().has(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.textContent = '';
  }
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelector(selector) {
    const matches = selector === '[data-nexa-widget-status]'
      ? this.attributes.has('data-nexa-widget-status')
      : selector.startsWith('.') && this.classList.contains(selector.slice(1));
    if (matches) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }
  click() {
    for (const listener of this.listeners.get('click') || []) listener({ currentTarget: this });
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName); }
}

function allText(element) {
  return [element.textContent, ...element.children.map(allText)].filter(Boolean).join(' ');
}

function find(element, predicate) {
  if (predicate(element)) return element;
  for (const child of element.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

function performance(overrides = {}) {
  return {
    empty: false,
    snapshot_count: 2,
    represented_publish_count: 2,
    latest_observed_at: '2026-08-23T11:00:00Z',
    aggregation_semantics: 'LATEST_SNAPSHOT_PER_PUBLISH_RECORD',
    totals: {
      views: 150, impressions: 180, likes: 5, comments: 1,
      favorites: 2, shares: 1, followers_delta: 1
    },
    observed_counts: {
      views: 2, impressions: 2, likes: 1, comments: 2,
      favorites: 2, shares: 2, followers_delta: 2
    },
    engagement_average: 0.15,
    engagement_observed_count: 2,
    latest: [],
    ...overrides
  };
}

const WINDOW_SECONDS = Object.freeze({
  '1h': 3_600, '5h': 18_000, '1d': 86_400, '3d': 259_200, '1w': 604_800
});

function selectedWindow(id = '1d') {
  const end = '2026-08-23T12:00:00Z';
  return {
    id,
    duration_seconds: WINDOW_SECONDS[id],
    start_at: new Date(Date.parse(end) - WINDOW_SECONDS[id] * 1000).toISOString(),
    end_at: end,
    semantics: 'EVIDENCE_GATED_SNAPSHOT_WINDOW'
  };
}

function accountSummary(overrides = {}) {
  const base = {
    account_id: 'account-a1', account_name: '星枢日常', source_account_name: 'nexa-a1',
    platform: '小红书', icon_key: 'xiaohongshu', status: 'ACTIVE',
    availability: 'AVAILABLE', availability_label: '数据可用',
    latest_snapshot: {
      views: 150, likes: 5, plays: null, followers_or_new: 1,
      followers_or_new_semantics: 'RECORDED_DELTA', observed_at: '2026-08-23T11:00:00Z',
      availability: 'AVAILABLE', plays_reason: 'UNSUPPORTED_SOURCE_FIELD'
    },
    delta: {
      views: 30, likes: -2, plays: null, followers_or_new: null,
      from_at: '2026-08-22T12:00:00.000Z', to_at: '2026-08-23T12:00:00Z',
      covered_publish_count: 1, observed_publish_count: 1, total_publish_count: 2,
      availability: 'AVAILABLE', availability_label: '数据可用'
    },
    freshness: { latest_metric_at: '2026-08-23T11:00:00Z', age_seconds: 3600 },
    handoff: { route_id: 'creator-ops', target: 'account', account_id: 'account-a1' }
  };
  return {
    ...base,
    ...overrides,
    latest_snapshot: { ...base.latest_snapshot, ...overrides.latest_snapshot },
    delta: { ...base.delta, ...overrides.delta },
    freshness: { ...base.freshness, ...overrides.freshness },
    handoff: { ...base.handoff, ...overrides.handoff }
  };
}

function emptyPerformance() {
  return performance({
    empty: true,
    empty_reason: 'NO_METRICS_IN_WINDOW',
    snapshot_count: 0,
    represented_publish_count: 0,
    latest_observed_at: null,
    totals: {
      views: null, impressions: null, likes: null, comments: null,
      favorites: null, shares: null, followers_delta: null
    },
    observed_counts: {
      views: 0, impressions: 0, likes: 0, comments: 0,
      favorites: 0, shares: 0, followers_delta: 0
    },
    engagement_average: null,
    engagement_observed_count: 0,
    latest: []
  });
}

function summary(overrides = {}) {
  const window = overrides.selected_window ?? selectedWindow();
  return {
    contract_version: '0.2.0',
    module_id: 'creator-ops',
    generated_at: '2026-08-23T12:00:00Z',
    data_classification: 'PRODUCTION',
    availability: { status: 'AVAILABLE', label: '数据可用' },
    selected_window: window,
    time_window: {
      days: window.duration_seconds / 86_400, start_at: window.start_at, end_at: window.end_at
    },
    empty_state: { is_empty: false, reason: null },
    account_summaries: [accountSummary()],
    account_matrix: [{
      account_id: 'account-a1', legacy_account_code: 'A1', platform: '小红书',
      display_name: '星枢日常', content_direction: 'AI效率', status: 'ACTIVE',
      workload: {
        active_content_count: 2, ready_to_publish_count: 1, blocked_count: 0,
        published_recently: 2, metrics_pending: 0, review_pending: 1
      },
      published_in_window: 2,
      performance: performance()
    }],
    performance: performance(),
    recent_activity: [{
      event_type: 'METRICS_RECORDED', entity_id: 'metric-a', content_id: 'content-a',
      occurred_at: '2026-08-23T11:00:00Z', summary: '记录最新表现'
    }],
    freshness: { latest_observed_at: '2026-08-23T11:00:00Z', age_seconds: 3600 },
    ...overrides
  };
}

function rendererFor(getHomeSummary, options = {}) {
  return createRenderer({
    ownerDocument: new FakeDocument(),
    api: { getHomeSummary },
    ...options
  });
}

test('activity Slot renders real account, dashboard, publishing, activity and freshness summaries', async () => {
  const requests = [];
  const renderer = rendererFor(async (request) => {
    requests.push(request);
    return { ok: true, value: summary({ selected_window: selectedWindow(request.window) }) };
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.activate();
  const text = allText(renderer.getElement());
  assert.match(text, /账号 1/);
  assert.match(text, /浏览 150/);
  assert.match(text, /点赞 5/);
  assert.match(text, /粉丝记录增量 \+1/);
  assert.match(text, /1天窗口 · 发布 2 · 待发布 1 · 阻塞 0/);
  assert.match(text, /星枢日常/);
  assert.match(text, /小红书 · 正常运营/);
  assert.match(text, /浏览 150 点赞 5 播放 — 新增 \+1 数据可用/);
  const platformIcon = find(renderer.getElement(), (element) => element.className === 'nexa-creator-platform-icon');
  const accountName = find(renderer.getElement(), (element) => element.textContent === '星枢日常');
  const accountRow = find(renderer.getElement(), (element) => element.className === 'nexa-creator-account-card');
  assert.equal(platformIcon.textContent, '小');
  assert.equal(platformIcon.attributes.get('aria-hidden'), 'true');
  assert.equal(accountName.attributes.get('title'), '星枢日常');
  assert.match(accountRow.attributes.get('aria-label'), /当前数据状态 数据可用/);
  assert.match(text, /记录最新表现/);
  assert.match(text, /最近观测 2026年8月23日/);
  assert.doesNotMatch(text, /\b(?:ACTIVE|UNKNOWN|ASSET_PREPARATION)\b|Current state|T\d{2}:\d{2}:\d{2}/);
  assert.deepEqual(requests, [{ window: '1d' }]);
  assert.equal(renderer.getState().status, 'READY');
});

test('NO_ACCOUNTS is a product empty state and nullable metrics never become zero', async () => {
  const renderer = rendererFor(async () => ({
    ok: true,
    value: summary({
      availability: { status: 'NO_ACCOUNTS', label: '暂无账号' },
      empty_state: { is_empty: true, reason: 'NO_CREATOR_OPS_DATA' },
      account_summaries: [],
      account_matrix: [],
      performance: emptyPerformance(),
      recent_activity: [],
      freshness: { latest_observed_at: null, age_seconds: null }
    })
  }));
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.activate();
  const text = allText(renderer.getElement());
  assert.match(text, /浏览 —/);
  assert.match(text, /尚未配置真实运营账号/);
  assert.match(text, /1天窗口 · 暂无真实指标观测/);
  assert.doesNotMatch(text, /模拟|示例账号|假数据/);
  assert.equal(renderer.getState().label, '暂无账号');
});

test('NO_METRICS and NON_PRODUCTION_DATA keep account identity but withhold metric values', async () => {
  const cases = [
    {
      availability: 'NO_METRICS', label: '暂无表现数据', state: 'READY', stateLabel: '暂无表现',
      copy: /账号已接入，但暂没有真实表现数据/
    },
    {
      availability: 'NON_PRODUCTION_DATA', label: '非生产数据不展示', state: 'LIMITED', stateLabel: '受限',
      copy: /当前来源不是生产数据，表现指标已按合同隐藏/
    }
  ];
  for (const item of cases) {
    const account = accountSummary({
      availability: item.availability,
      availability_label: item.label,
      latest_snapshot: {
        views: null, likes: null, followers_or_new: null, observed_at: null,
        availability: item.availability
      },
      delta: {
        views: null, likes: null, availability: item.availability, availability_label: item.label
      },
      freshness: { latest_metric_at: null, age_seconds: null }
    });
    const renderer = rendererFor(async () => ({
      ok: true,
      value: summary({
        availability: { status: item.availability, label: item.label },
        data_classification: item.availability === 'NON_PRODUCTION_DATA' ? 'TEST' : 'PRODUCTION',
        account_summaries: [account],
        performance: emptyPerformance(),
        recent_activity: [],
        freshness: { latest_observed_at: null, age_seconds: null }
      })
    }));
    renderer.setHostState({ enabled: true, status: 'READY' });
    await renderer.activate();
    const text = allText(renderer.getElement());
    assert.match(text, /星枢日常/);
    assert.match(text, /浏览 —/);
    assert.match(text, item.copy);
    assert.doesNotMatch(text, /浏览 0|点赞 0|播放 0/);
    assert.equal(renderer.getState().status, item.state);
    assert.equal(renderer.getState().label, item.stateLabel);
  }
});

test('NON_PRODUCTION_DATA cannot leak legacy performance or operating counts into Home', async () => {
  const account = accountSummary({
    availability: 'NON_PRODUCTION_DATA',
    availability_label: '非生产数据不展示',
    latest_snapshot: {
      views: null, likes: null, followers_or_new: null, observed_at: null,
      availability: 'NON_PRODUCTION_DATA'
    },
    delta: {
      views: null, likes: null,
      availability: 'NON_PRODUCTION_DATA', availability_label: '非生产数据不展示'
    },
    freshness: { latest_metric_at: null, age_seconds: null }
  });
  const renderer = rendererFor(async () => ({
    ok: true,
    value: summary({
      data_classification: 'TEST',
      availability: { status: 'NON_PRODUCTION_DATA', label: '非生产数据不展示' },
      account_summaries: [account]
    })
  }));
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.activate();
  const text = allText(renderer.getElement());
  assert.match(text, /浏览 —/);
  assert.match(text, /点赞 —/);
  assert.match(text, /新增 —/);
  assert.match(text, /非生产来源，运营计数未展示/);
  assert.match(text, /非生产指标未进入首页/);
  assert.doesNotMatch(text, /浏览 150|点赞 5|新增 \+1|发布 2|待发布 1/);
  assert.match(text, /当前来源不是生产数据，表现指标已按合同隐藏/);
  assert.equal(renderer.getState().status, 'LIMITED');
});

test('Home selector requests every frozen window and keeps the selected state truthful', async () => {
  const requests = [];
  const renderer = rendererFor(async (request) => {
    requests.push(request);
    return { ok: true, value: summary({ selected_window: selectedWindow(request.window) }) };
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.activate();
  for (const window of WINDOWS) await renderer.load(window);
  assert.deepEqual(requests.map((request) => request.window), ['1d', ...WINDOWS]);
  assert.equal(renderer.getState().selectedWindow, '1w');
  const active = find(renderer.getElement(), (element) => element.dataset.range === '1w');
  assert.equal(active.attributes.get('aria-pressed'), 'true');
  assert.equal(active.classList.contains('is-active'), true);
  assert.match(allText(renderer.getElement()), /1周窗口/);
  assert.doesNotMatch(allText(renderer.getElement()), /播放 0/);

  const fiveHour = find(renderer.getElement(), (element) => element.dataset.range === '5h');
  fiveHour.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.at(-1).window, '5h');
  assert.equal(renderer.getState().selectedWindow, '5h');
  assert.equal(fiveHour.attributes.get('aria-pressed'), 'true');
});

test('read failures stay inside the Widget without exposing stack, path, or database details', async () => {
  const secret = 'E:\\private\\creator.sqlite3';
  const renderer = rendererFor(async () => ({
    ok: false,
    error: { code: 'HOST_UNREACHABLE', message: secret, stack: secret }
  }));
  renderer.setHostState({ enabled: true, status: 'READY' });
  assert.equal(await renderer.activate(), null);
  const text = allText(renderer.getElement());
  assert.match(text, /自媒体动态摘要暂不可用，其他桌面功能仍可继续使用/);
  assert.doesNotMatch(text, /读取失败/);
  assert.doesNotMatch(text, /private|sqlite|HOST_UNREACHABLE/);
  assert.equal(renderer.getState().status, 'ERROR');
});

test('Home distinguishes service not started, starting, ready and startup failed', async () => {
  let resolveStart;
  const renderer = rendererFor(() => new Promise((resolve) => { resolveStart = resolve; }));
  renderer.setHostState({ enabled: true, status: 'OFFLINE' });
  assert.equal(renderer.getState().label, '服务未启动');
  assert.match(allText(renderer.getElement()), /无需手动运行 Python/);

  const start = renderer.activate();
  await Promise.resolve();
  assert.equal(renderer.getState().label, '正在启动');
  assert.match(allText(renderer.getElement()), /正式生命周期启动/);
  resolveStart({ ok: true, value: summary() });
  await start;
  assert.equal(renderer.getState().label, '可用');

  renderer.deactivate();
  renderer.setHostState({ enabled: true, status: 'ERROR' });
  assert.equal(renderer.getState().label, '启动失败');
  assert.match(allText(renderer.getElement()), /启动失败/);
  assert.doesNotMatch(allText(renderer.getElement()), /读取失败|异常/);
});

test('failed automatic startup is not mislabeled as a generic summary read failure', async () => {
  const renderer = rendererFor(async () => ({ ok: false, error: { code: 'HOST_PROCESS_EXITED', message: 'private' } }));
  renderer.setHostState({ enabled: true, status: 'OFFLINE' });
  await renderer.activate();
  assert.equal(renderer.getState().label, '启动失败');
  assert.match(allText(renderer.getElement()), /本地服务启动失败/);
  assert.doesNotMatch(allText(renderer.getElement()), /读取失败|异常/);
});

test('an existing lifecycle error remains a startup failure when Home requests its summary', async () => {
  const renderer = rendererFor(async () => ({ ok: false, error: { code: 'OWNER_MISMATCH', message: 'private' } }));
  renderer.setHostState({ enabled: true, status: 'ERROR' });
  await renderer.activate();
  assert.equal(renderer.getState().label, '启动失败');
  assert.match(allText(renderer.getElement()), /本地服务启动失败/);
  assert.doesNotMatch(allText(renderer.getElement()), /摘要暂不可用|读取失败|异常/);
});

test('an unavailable host is presented as startup failure after summary activation fails', async () => {
  const renderer = rendererFor(async () => ({ ok: false, error: { code: 'OWNER_MISMATCH', message: 'private' } }));
  renderer.setHostState({ enabled: true, status: 'UNAVAILABLE' });
  await renderer.activate();
  assert.equal(renderer.getState().label, '启动失败');
  assert.match(allText(renderer.getElement()), /本地服务启动失败/);
  assert.doesNotMatch(allText(renderer.getElement()), /摘要暂不可用|读取失败|异常/);
});

test('a late lifecycle error upgrades an earlier summary error to startup failure', async () => {
  const renderer = rendererFor(async () => ({ ok: false, error: { code: 'OWNER_MISMATCH', message: 'private' } }));
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.activate();
  assert.equal(renderer.getState().label, '摘要暂不可用');
  renderer.setHostState({ enabled: true, status: 'ERROR' });
  assert.equal(renderer.getState().label, '启动失败');
  assert.match(allText(renderer.getElement()), /本地服务启动失败/);
  assert.doesNotMatch(allText(renderer.getElement()), /摘要暂不可用|读取失败|异常/);
});

test('duplicate activation coalesces, activity registration stays unique, and dispose cleans listener', async () => {
  let calls = 0;
  const resolvers = [];
  const renderer = rendererFor(() => {
    calls += 1;
    return new Promise((resolve) => resolvers.push(resolve));
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  const first = renderer.activate();
  const duplicate = renderer.activate();
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolvers.shift()({ ok: true, value: summary() });
  await first;

  const slot = new FakeElement('div');
  const host = createNexaWidgetHost({ slots: { activity: slot } });
  const definition = {
    widgetId: 'module:creator-ops', moduleId: 'creator-ops', slotId: 'activity',
    element: renderer.getElement(), status: 'READY'
  };
  host.register(definition);
  host.clear();
  host.register(definition);
  assert.equal(host.getSnapshot().length, 1);

  renderer.deactivate();
  const reentered = renderer.activate();
  await Promise.resolve();
  assert.equal(calls, 2);
  resolvers.shift()({ ok: true, value: summary() });
  await reentered;
  const button = find(renderer.getElement(), (element) => (
    element.tagName === 'BUTTON' && element.textContent === '进入自媒体运营'
  ));
  const rangeButton = find(renderer.getElement(), (element) => element.dataset.range === '1h');
  assert.equal(button.listenerCount('click'), 1);
  assert.equal(rangeButton.listenerCount('click'), 1);
  assert.equal(renderer.dispose(), true);
  assert.equal(renderer.dispose(), false);
  assert.equal(button.listenerCount('click'), 0);
  assert.equal(rangeButton.listenerCount('click'), 0);
});

test('count formatting preserves null, sign and deterministic grouping', () => {
  assert.equal(formatCount(null), '—');
  assert.equal(formatCount(123456), '123,456');
  assert.equal(formatCount(1, { signed: true }), '+1');
  assert.equal(formatCount(-1, { signed: true }), '-1');
});

test('raw Creator Ops states and timestamps have stable Chinese product projections', () => {
  assert.equal(statusCopy('ACTIVE'), '正常运营');
  assert.equal(statusCopy('UNKNOWN'), '状态未知');
  assert.equal(activityCopy({ event_type: 'ASSET_PREPARATION', summary: 'Current state: ASSET_PREPARATION' }),
    '当前阶段：素材准备');
  assert.match(formatDateTime('2026-08-23T11:00:00Z'), /^2026年8月23日/);
  assert.equal(formatDateTime('not-a-date'), '未知时间');
});
