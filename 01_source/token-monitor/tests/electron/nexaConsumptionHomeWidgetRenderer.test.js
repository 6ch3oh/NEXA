'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  categoryShare,
  createRenderer,
  formatYuan,
  sortRecentTransactions
} = require('../../src/electron/renderer/nexaConsumptionHomeWidgetRenderer');
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
    this.style = { values: new Map(), setProperty: (name, value) => this.style.values.set(name, value) };
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

function summary(overrides = {}) {
  return {
    contract: 'ConsumptionHomeSummary',
    contractVersion: '0.2',
    availability: { status: 'available', reason: null },
    period: { startDate: '2026-08-01', endDate: '2026-08-23' },
    currency: 'CNY',
    month_expense_cents: 123456,
    today_expense_cents: 3680,
    totals_by_currency: [
      { currency: 'CNY', month_expense_cents: 123456, today_expense_cents: 3680 }
    ],
    category_distribution: [
      { category_id: 'food', category_name: '餐饮', amount_cents: 82000, currency: 'CNY', percentage: 66.42 },
      { category_id: 'shopping', category_name: '购物', amount_cents: 41456, currency: 'CNY', percentage: 33.58 }
    ],
    recent_transactions: [
      {
        occurred_at: '2026-08-23', title: '咖啡', category_id: 'food', category_name: '餐饮',
        amount_cents: 1800, currency: 'CNY', direction: 'expense', platform: 'wechat'
      },
      {
        occurred_at: '2026-08-22', title: '地铁', category_id: 'transport', category_name: '交通',
        amount_cents: 400, currency: 'CNY', direction: 'expense', platform: 'alipay'
      }
    ],
    top_category: {
      category_id: 'food', category_name: '餐饮', amount_cents: 82000,
      currency: 'CNY', percentage: 66.42
    },
    freshness: {
      as_of_date: '2026-08-23', latest_occurred_at: '2026-08-23',
      status: 'current', semantics: 'latest_record_date'
    },
    source: { kind: 'canonical_expense_repository', mode: 'core_injected_read_only' },
    empty_state: null,
    generated_at: '2026-08-23T00:00:00.000Z',
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

test('Data Slot requests and renders the additive V0.2 real summary', async () => {
  const calls = [];
  const renderer = rendererFor(async (options) => {
    calls.push(options);
    return { ok: true, value: summary() };
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.activate();
  const text = allText(renderer.getElement());
  assert.match(text, /本期消费 [¥￥]1,234\.56/);
  assert.match(text, /今日消费 [¥￥]36\.80/);
  assert.match(text, /分类分布/);
  assert.match(text, /餐饮 [¥￥]820\.00 · 66\.4%/);
  assert.match(text, /购物 [¥￥]414\.56 · 33\.6%/);
  assert.match(text, /咖啡 [¥￥]18\.00 · 8月23日/);
  assert.match(text, /地铁 [¥￥]4\.00 · 8月22日/);
  assert.match(text, /数据截至 8月23日 · 本期数据当前有效/);
  assert.deepEqual(calls, [{ contractVersion: '0.2', recentLimit: 5 }]);
  const ring = renderer.getElement().querySelector('.nexa-consumption-category-ring');
  assert.match(ring.style.values.get('--nexa-category-gradient'), /^conic-gradient\(/);
  assert.match(ring.attributes.get('aria-label'), /餐饮 66\.4%，购物 33\.6%/);
  assert.equal(renderer.getState().status, 'READY');
});

test('historical and empty freshness remain product states rather than connectivity claims', async () => {
  const historical = rendererFor(async () => ({
    ok: true,
    value: summary({
      freshness: {
        as_of_date: '2026-08-23', latest_occurred_at: '2026-08-20',
        status: 'historical', semantics: 'latest_record_date'
      }
    })
  }));
  historical.setHostState({ enabled: true, status: 'READY' });
  await historical.activate();
  assert.match(allText(historical.getElement()), /最近记录属于历史日期/);

  const empty = rendererFor(async () => ({
    ok: true,
    value: summary({
      availability: { status: 'no_data', reason: 'NO_RECORDS' },
      currency: null,
      month_expense_cents: null,
      today_expense_cents: null,
      totals_by_currency: [],
      category_distribution: [],
      recent_transactions: [],
      top_category: null,
      freshness: {
        as_of_date: '2026-08-23', latest_occurred_at: null,
        status: 'empty', semantics: 'latest_record_date'
      },
      empty_state: { code: 'NO_CONSUMPTION_RECORDS', message: '本月暂无消费记录。' }
    })
  }));
  empty.setHostState({ enabled: true, status: 'READY' });
  await empty.activate();
  const text = allText(empty.getElement());
  assert.match(text, /本期消费 暂无记录/);
  assert.match(text, /本月尚无可观测消费金额/);
  assert.match(text, /分类分布暂无/);
  assert.match(text, /当前期间暂无消费记录/);
  assert.match(text, /当前期间暂无真实消费记录/);
  assert.doesNotMatch(text, /[¥￥]0\.00/);
  assert.doesNotMatch(text, /模拟|示例交易|同步成功/);
  assert.equal(empty.getState().label, '暂无记录');
});

test('multi-currency data stays separated and never fabricates a combined total or percentage', async () => {
  const renderer = rendererFor(async () => ({
    ok: true,
    value: summary({
      availability: { status: 'partial', reason: 'MULTI_CURRENCY' },
      currency: null,
      month_expense_cents: null,
      today_expense_cents: null,
      totals_by_currency: [
        { currency: 'CNY', month_expense_cents: 100, today_expense_cents: 100 },
        { currency: 'USD', month_expense_cents: 200, today_expense_cents: 200 }
      ],
      category_distribution: [
        { category_id: 'travel', category_name: '旅行', amount_cents: 200, currency: 'USD', percentage: 100 },
        { category_id: 'food', category_name: '餐饮', amount_cents: 100, currency: 'CNY', percentage: 100 }
      ],
      recent_transactions: [
        {
          occurred_at: '2026-08-23', title: '美元记录', category_id: 'travel', category_name: '旅行',
          amount_cents: 200, currency: 'USD', direction: 'expense', platform: 'manual'
        },
        {
          occurred_at: '2026-08-23', title: '人民币记录', category_id: 'food', category_name: '餐饮',
          amount_cents: 100, currency: 'CNY', direction: 'expense', platform: 'manual'
        }
      ],
      top_category: null
    })
  }));
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.activate();
  const text = allText(renderer.getElement());
  assert.match(text, /多币种分别统计/);
  assert.match(text, /未跨币种合并总额/);
  assert.match(text, /CNY：本月 [¥￥]1\.00 · 今日 [¥￥]1\.00/);
  assert.match(text, /USD：本月 (?:US\$|\$)2\.00 · 今日 (?:US\$|\$)2\.00/);
  assert.match(text, /各币种分类（不合并）/);
  assert.match(text, /旅行 (?:US\$|\$)2\.00/);
  assert.match(text, /餐饮 [¥￥]1\.00/);
  assert.doesNotMatch(text, /旅行 .*100\.0%|餐饮 .*100\.0%/);
  assert.equal(renderer.getState().status, 'LIMITED');
  assert.equal(renderer.getState().label, '按币种展示');
  const ring = renderer.getElement().querySelector('.nexa-consumption-category-ring');
  assert.equal(ring.style.values.get('--nexa-category-gradient'), 'conic-gradient(#e8edf8 0 100%)');
  assert.equal(ring.attributes.get('aria-label'), '多币种分类金额按原币种展示，不合并占比');
});

test('cents to yuan is a deterministic display-only conversion', () => {
  assert.equal(formatYuan(123456), '¥1,234.56');
  assert.equal(formatYuan(3680), '¥36.80');
  assert.equal(formatYuan(-400), '-¥4.00');
  assert.equal(formatYuan(1.5), '—');
});

test('category share and recent sorting retain their compatibility helpers', async () => {
  assert.equal(categoryShare(summary()), 0.6642);
  assert.deepEqual(
    sortRecentTransactions([
      { id: 'old', occurredAt: '2026-08-01' },
      { id: 'new', occurred_at: '2026-08-23' }
    ]).map((row) => row.id),
    ['new', 'old']
  );
  const renderer = rendererFor(async () => ({
    ok: true,
    value: summary({ recent_transactions: [
      {
        occurred_at: '2026-08-01', title: '旧记录', category_id: 'other', category_name: '其他',
        amount_cents: 100, currency: 'CNY', direction: 'expense', platform: 'manual'
      },
      {
        occurred_at: '2026-08-23', title: '新记录', category_id: 'food', category_name: '餐饮',
        amount_cents: 200, currency: 'CNY', direction: 'expense', platform: 'manual'
      }
    ] })
  }));
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.activate();
  const text = allText(renderer.getElement());
  assert.ok(text.indexOf('新记录') < text.indexOf('旧记录'));
  assert.match(text, /分类分布/);
});

test('getSummary failures stay local and never expose repository or path details', async () => {
  const secret = 'E:\\private\\expense.sqlite';
  const renderer = rendererFor(async () => ({
    ok: false,
    error: { code: 'QUERY_FAILED', message: secret, stack: secret }
  }));
  renderer.setHostState({ enabled: true, status: 'READY' });
  assert.equal(await renderer.activate(), null);
  const text = allText(renderer.getElement());
  assert.match(text, /消费摘要暂不可用，其他桌面功能仍可继续使用/);
  assert.doesNotMatch(text, /读取失败/);
  assert.doesNotMatch(text, /private|sqlite|QUERY_FAILED/);
  assert.equal(renderer.getState().status, 'ERROR');
});

test('duplicate init coalesces, leave/re-enter stays stable, and dispose releases the listener', async () => {
  let calls = 0;
  const resolvers = [];
  const renderer = rendererFor(() => {
    calls += 1;
    return new Promise((resolve) => { resolvers.push(resolve); });
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
  const host = createNexaWidgetHost({ slots: { data: slot } });
  const definition = {
    widgetId: 'module:consumption', moduleId: 'consumption', slotId: 'data',
    element: renderer.getElement(), status: 'READY'
  };
  host.register(definition);
  host.clear();
  host.register(definition);
  assert.equal(host.getSnapshot().length, 1);

  renderer.deactivate();
  assert.equal(renderer.getState().active, false);
  renderer.setHostState({ enabled: false, status: 'OFFLINE' });
  assert.equal(await renderer.activate(), null);
  renderer.setHostState({ enabled: true, status: 'READY' });
  renderer.deactivate();
  const reentered = renderer.activate();
  await Promise.resolve();
  assert.equal(calls, 2);
  resolvers.shift()({ ok: true, value: summary({ today_expense_cents: 400 }) });
  await reentered;
  assert.equal(renderer.getState().status, 'READY');

  const openButton = find(renderer.getElement(), (element) => (
    element.tagName === 'BUTTON' && element.textContent === '查看消费中心'
  ));
  assert.equal(openButton.listenerCount('click'), 1);
  assert.equal(renderer.dispose(), true);
  assert.equal(renderer.dispose(), false);
  assert.equal(openButton.listenerCount('click'), 0);
});
