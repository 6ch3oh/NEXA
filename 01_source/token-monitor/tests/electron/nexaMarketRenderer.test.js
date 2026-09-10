'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ACTION_FORMS,
  ROUTES,
  containsMojibake,
  createRenderer,
  findMarketEmptyState,
  hashForRoute,
  isDiagnosticKey,
  parseMarketHash,
  partitionDto,
  safeVisibleValue,
  titleForKey
} = require('../../src/electron/renderer/nexaMarketRenderer');

class FakeElement {
  constructor(tagName, documentRef) {
    this.tagName = tagName;
    this.ownerDocument = documentRef;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.listeners = {};
  }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
}

function fakeDocument() {
  const documentRef = { createElement: (tagName) => new FakeElement(tagName, documentRef) };
  return documentRef;
}

function ok(value) {
  return Promise.resolve({ ok: true, value });
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function descendants(root) {
  return [root, ...(root.children || []).flatMap(descendants)];
}

test('parses and formats only the frozen public Market routes', () => {
  assert.deepEqual([...ROUTES], [
    'market', 'market/watchlist', 'market/portfolio', 'market/research',
    'market/instrument/:instrument_id', 'market/journal'
  ]);
  assert.deepEqual(parseMarketHash('#/market/watchlist'), {
    routeId: 'market/watchlist', instrumentId: null
  });
  assert.deepEqual(parseMarketHash('#/market/instrument/600519.SH'), {
    routeId: 'market/instrument/:instrument_id', instrumentId: '600519.SH'
  });
  assert.equal(hashForRoute('market/instrument/:instrument_id', '600519.SH'), '#/market/instrument/600519.SH');
});

test('Market empty projections render one truthful task state instead of internal DTO cards', async () => {
  const documentRef = fakeDocument();
  const surface = new FakeElement('section', documentRef);
  const subNavigation = new FakeElement('nav', documentRef);
  const emptyState = {
    area: 'WATCHLIST',
    title: '你还没有添加关注的股票',
    explanation: '自选用于记录你想持续了解的公司，不会产生任何交易。',
    next_action: 'ADD_WATCHLIST',
    next_action_label: '添加关注股票'
  };
  const dto = {
    beginner_mode: true,
    data: {
      page_title: '我的自选',
      items: [],
      empty_state: emptyState,
      allowed_actions: ['ADD_WATCHLIST']
    }
  };
  const api = {
    getRouteManifest: () => ok([{ route_id: 'market/watchlist', title: '自选', required_parameter: null }]),
    setNavigationState: (params) => ok(params),
    getWatchlist: () => ok(dto),
    executeAction: () => ok({ accepted: true })
  };
  const renderer = createRenderer({
    api,
    surface,
    subNavigation,
    location: { hash: '#/market/watchlist' },
    history: { state: null, replaceState() {} }
  });

  assert.equal(findMarketEmptyState(dto), emptyState);
  await renderer.activate();
  const rendered = descendants(surface);
  assert.equal(rendered.filter((node) => node.className === 'nexa-market-route-empty').length, 1);
  assert.ok(rendered.some((node) => node.textContent === emptyState.title));
  assert.ok(rendered.some((node) => node.textContent === emptyState.explanation));
  assert.equal(rendered.find((node) => node.dataset.nexaMarketAction === 'ADD_WATCHLIST').textContent, '添加关注股票');
  assert.equal(rendered.some((node) => node.textContent === '新手模式'), false);
  assert.equal(rendered.some((node) => node.textContent === '页面标题'), false);
  assert.equal(rendered.some((node) => node.textContent === '项目'), false);
  assert.equal(rendered.some((node) => node.dataset.nexaMarketAction === 'VIEW_EVIDENCE'), false);
  assert.equal(rendered.some((node) => node.dataset.nexaMarketAction === 'VIEW_EXPLANATION'), false);
});

test('thin renderer forwards route and action requests and renders returned DTOs', async () => {
  const documentRef = fakeDocument();
  const surface = new FakeElement('section', documentRef);
  const subNavigation = new FakeElement('nav', documentRef);
  const calls = [];
  const history = {
    state: null,
    hash: null,
    replaceState(_state, _title, hash) { this.hash = hash; }
  };
  const api = {
    getRouteManifest: () => ok([
      { route_id: 'market', title: '股票市场', required_parameter: null },
      { route_id: 'market/watchlist', title: '自选', required_parameter: null },
      { route_id: 'market/portfolio', title: '持仓', required_parameter: null },
      { route_id: 'market/research', title: '研究', required_parameter: null },
      { route_id: 'market/instrument/:instrument_id', title: '股票详情', required_parameter: 'instrument_id' },
      { route_id: 'market/journal', title: '决策日志', required_parameter: null }
    ]),
    setNavigationState: (params) => { calls.push(['navigate', params]); return ok(params); },
    getMarketHome: () => ok({ data: {
      page_title: '���г���ҳ', attention_today: [], diagnostic_reference: 'MARKET-001',
      evidence_health: 'healthy', journal_health: 'healthy'
    }, product_api_version: '0.1', allowed_actions: ['ADD_WATCHLIST'] }),
    getWatchlist: (params) => { calls.push(['watchlist', params]); return ok({ items: [] }); },
    getPortfolio: () => ok({ positions: [] }),
    getResearchCenter: () => ok({ research: [] }),
    getDecisionJournal: () => ok({ entries: [] }),
    getInstrumentDetail: (instrumentId) => ok({ instrument_id: instrumentId }),
    executeAction: (action, payload) => { calls.push(['action', action, payload]); return ok({ accepted: true }); }
  };
  const renderer = createRenderer({
    api,
    surface,
    subNavigation,
    location: { hash: '#/market' },
    history
  });

  await renderer.activate();
  assert.equal(renderer.getState().status, 'ready');
  assert.equal(surface.dataset.state, 'ready');
  assert.equal(subNavigation.children.length, 5);
  assert.equal(history.hash, '#/market');
  const rendered = descendants(surface);
  const diagnostics = rendered.find((node) => node.className === 'nexa-market-diagnostics');
  assert.ok(diagnostics);
  assert.equal(diagnostics.children[0].textContent, '连接与诊断');
  assert.equal(diagnostics.attributes.open, undefined);
  assert.equal(rendered.find((node) => node.dataset.nexaMarketAction === 'ADD_WATCHLIST').textContent, '加入自选');
  assert.equal(rendered.find((node) => node.dataset.nexaMarketAction === 'VIEW_EXPLANATION').textContent, '查看通俗说明');
  assert.equal(rendered.map((node) => node.textContent).join(' ').includes('�'), false);
  assert.ok(rendered.some((node) => node.textContent === '市场数据暂不可读'));
  await renderer.navigate('market/watchlist');
  assert.deepEqual(calls.at(-2), ['navigate', { route_id: 'market/watchlist' }]);
  assert.deepEqual(calls.at(-1), ['watchlist', {}]);
  await renderer.executeAction('ADD_WATCHLIST', { instrument_id: 'TEST' });
  assert.deepEqual(calls.find((call) => call[0] === 'action'), [
    'action', 'ADD_WATCHLIST', { instrument_id: 'TEST' }
  ]);
});

test('renderer exits and re-enters through the same public bridge without duplicating navigation', async () => {
  const documentRef = fakeDocument();
  const surface = new FakeElement('section', documentRef);
  const subNavigation = new FakeElement('nav', documentRef);
  const location = { hash: '#/market' };
  const calls = [];
  const api = {
    getRouteManifest: () => ok([
      { route_id: 'market', title: '股票市场', required_parameter: null },
      { route_id: 'market/watchlist', title: '自选', required_parameter: null },
      { route_id: 'market/portfolio', title: '持仓', required_parameter: null },
      { route_id: 'market/research', title: '研究', required_parameter: null },
      { route_id: 'market/instrument/:instrument_id', title: '股票详情', required_parameter: 'instrument_id' },
      { route_id: 'market/journal', title: '决策日志', required_parameter: null }
    ]),
    setNavigationState: (params) => { calls.push(params); return ok(params); },
    getMarketHome: () => ok({ page_title: '市场首页' }),
    getPortfolio: () => ok({ positions: [] })
  };
  const renderer = createRenderer({
    api,
    surface,
    subNavigation,
    location,
    history: { state: null, replaceState() {} }
  });

  await renderer.activate();
  assert.deepEqual(renderer.getState(), {
    active: true, routeId: 'market', instrumentId: null, status: 'ready', errorCode: null
  });
  renderer.deactivate();
  assert.equal(renderer.getState().active, false);

  location.hash = '#/market/portfolio';
  await renderer.activate();
  assert.deepEqual(renderer.getState(), {
    active: true, routeId: 'market/portfolio', instrumentId: null, status: 'ready', errorCode: null
  });
  assert.equal(subNavigation.children.length, 5);
  assert.deepEqual(calls, [
    { route_id: 'market' },
    { route_id: 'market/portfolio' }
  ]);
});

test('late Market results cannot rewrite Host presentation after unmount', async () => {
  const documentRef = fakeDocument();
  const surface = new FakeElement('section', documentRef);
  const subNavigation = new FakeElement('nav', documentRef);
  const pendingHome = deferred();
  const contexts = [];
  const api = {
    getRouteManifest: () => ok([{ route_id: 'market', title: '股票市场', required_parameter: null }]),
    setNavigationState: (params) => ok(params),
    getMarketHome: () => pendingHome.promise
  };
  const renderer = createRenderer({
    api,
    surface,
    subNavigation,
    location: { hash: '#/market' },
    history: { state: null, replaceState() {} },
    onContextChange: (value) => contexts.push(value)
  });

  assert.equal(contexts.length, 0, 'constructor must not publish before integration finishes wiring route renderers');
  const activation = renderer.activate();
  await Promise.resolve();
  const contextCountAtExit = contexts.length;
  assert.equal(renderer.unmount(), true);
  assert.equal(surface.children.length, 0);
  assert.equal(subNavigation.children.length, 0);
  pendingHome.resolve({ ok: true, value: { page_title: '迟到结果' } });
  await activation;

  assert.equal(contexts.length, contextCountAtExit);
  assert.equal(surface.children.length, 0);
  assert.equal(subNavigation.children.length, 0);
  assert.equal(renderer.getState().active, false);
});

test('public bridge failures stay inside the Market surface and a later re-entry recovers', async () => {
  const documentRef = fakeDocument();
  const surface = new FakeElement('section', documentRef);
  const subNavigation = new FakeElement('nav', documentRef);
  const location = { hash: '#/market' };
  let unavailable = true;
  const api = {
    getRouteManifest: () => unavailable
      ? Promise.resolve({ ok: false, error: { code: 'MARKET_PROCESS_UNAVAILABLE' } })
      : ok([{ route_id: 'market', title: '股票市场', required_parameter: null }]),
    setNavigationState: (params) => ok(params),
    getMarketHome: () => unavailable
      ? Promise.resolve({
          ok: false,
          error: { code: 'MARKET_PROCESS_UNAVAILABLE', message: 'private process path must not leak' }
        })
      : ok({ page_title: '市场首页' })
  };
  const renderer = createRenderer({
    api,
    surface,
    subNavigation,
    location,
    history: { state: null, replaceState() {} },
    onOpenSettings: () => { location.openedSettings = true; }
  });

  await renderer.activate();
  assert.deepEqual(renderer.getState(), {
    active: true,
    routeId: 'market',
    instrumentId: null,
    status: 'error',
    errorCode: 'MARKET_PROCESS_UNAVAILABLE'
  });
  assert.equal(descendants(surface).some((node) => node.textContent === '市场数据源或本地投影尚未就绪'), true);
  assert.equal(descendants(surface).some((node) => node.textContent === '影响：行情、自选、持仓与研究记录暂不显示；其他桌面功能不受影响。'), true);
  assert.equal(descendants(surface).some((node) => node.textContent === '重试'), true);
  assert.equal(subNavigation.children.length, 5);
  const settingsButton = descendants(surface).find((node) => node.textContent === '打开模块设置');
  settingsButton.listeners.click();
  assert.equal(location.openedSettings, true);
  assert.equal(descendants(surface).some((node) => node.textContent.includes('private process path')), false);

  renderer.deactivate();
  unavailable = false;
  await renderer.activate();
  assert.equal(renderer.getState().status, 'ready');
  assert.equal(renderer.getState().active, true);
});

test('product actions expose required input forms and aliases without empty payload submission', () => {
  for (const action of [
    'ADD_WATCHLIST', 'REMOVE_WATCHLIST', 'EDIT_NOTE', 'EDIT_TAGS',
    'RECORD_POSITION', 'UPDATE_POSITION', 'CREATE_RESEARCH_DRAFT', 'REVIEW_RESEARCH',
    'CREATE_JOURNAL', 'REVIEW_JOURNAL', 'VIEW_EVIDENCE', 'VIEW_EXPLANATION'
  ]) assert.ok(ACTION_FORMS[action], action);
  assert.equal(ACTION_FORMS.EDIT_NOTE.target, 'UPDATE_WATCHLIST');
  assert.equal(ACTION_FORMS.REVIEW_RESEARCH.target, 'VALIDATE_RESEARCH');
  assert.equal(titleForKey('REMOVE_WATCHLIST'), '移出自选');
  assert.equal(titleForKey('VIEW_EXPLANATION'), '查看通俗说明');
  assert.equal(titleForKey('priority'), '关注级别');
  assert.equal(titleForKey('held'), '已持有');
  assert.equal(titleForKey('available_filters'), '');
  assert.equal(titleForKey('unknown_backend_field'), '');
  assert.equal(safeVisibleValue('NOT_APPLICABLE'), '不适用');
});

test('detail links are visible and evidence results stay on the current page', async () => {
  const documentRef = fakeDocument();
  const surface = new FakeElement('section', documentRef);
  const subNavigation = new FakeElement('nav', documentRef);
  let homeReads = 0;
  const actionCalls = [];
  const api = {
    getRouteManifest: () => ok([
      { route_id: 'market', title: '股票市场', required_parameter: null },
      { route_id: 'market/instrument/:instrument_id', title: '股票详情', required_parameter: 'instrument_id' }
    ]),
    setNavigationState: (params) => ok(params),
    getMarketHome: () => {
      homeReads += 1;
      return ok({ items: [{ instrument_id: '600519.SH', instrument_label: '贵州茅台' }], allowed_actions: ['VIEW_EVIDENCE'] });
    },
    getInstrumentDetail: (instrumentId) => ok({ instrument_id: instrumentId, company_name: '贵州茅台' }),
    executeAction: (action, payload) => {
      actionCalls.push([action, payload]);
      return ok({ updated_projection: { items: [{ plain_title: '真实依据', instrument_id: payload.instrument_id }] } });
    }
  };
  const renderer = createRenderer({
    api, surface, subNavigation, location: { hash: '#/market' },
    history: { state: null, replaceState() {} }
  });
  await renderer.activate();
  const detail = descendants(surface).find((node) => node.dataset.nexaMarketInstrument === '600519.SH');
  assert.equal(detail.textContent, '查看股票详情');

  descendants(surface).find((node) => node.dataset.nexaMarketAction === 'VIEW_EVIDENCE').listeners.click();
  const form = descendants(surface).find((node) => node.dataset.nexaMarketActionForm === 'VIEW_EVIDENCE')
    .children.find((node) => node.tagName === 'form');
  const instrument = descendants(form).find((node) => node.dataset.nexaMarketField === 'instrument_id');
  assert.equal(instrument.value, '600519.SH');
  form.listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(actionCalls, [['VIEW_EVIDENCE', { instrument_id: '600519.SH' }]]);
  assert.equal(homeReads, 1);
  const rendered = descendants(surface).map((node) => node.textContent).join(' ');
  assert.match(rendered, /查看依据已完成/);
  assert.match(rendered, /真实依据/);
});

test('Market presentation has a bounded 480px action and detail layout', () => {
  const css = fs.readFileSync(path.join(
    __dirname, '..', '..', 'src', 'electron', 'renderer', 'styles.css'
  ), 'utf8');
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.nexa-market-actions[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /\.nexa-market-action-form[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /\.nexa-market-dto-grid[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.nexa-market-sub-navigation button\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.nexa-context-bar:has\(\.nexa-market-sub-navigation:not\(\.hidden\)\) > strong[\s\S]*?max-width:\s*none;[\s\S]*?text-overflow:\s*clip/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.nexa-market-sub-navigation\s*\{[^}]*flex:\s*1 1 0;[^}]*margin-left:\s*0/);
});

test('diagnostic health fields are classified without changing DTO values', () => {
  for (const key of [
    'bridge_version', 'cache_health', 'evidence_health', 'journal_health', 'data_health', 'diagnostic_reference',
    'Data Store Health', 'Real Data Availability', 'Store Status', 'Trust Summary'
  ]) assert.equal(isDiagnosticKey(key), true);
  for (const key of ['page_title', 'positions', 'watchlist', 'allowed_actions']) {
    assert.equal(isDiagnosticKey(key), false);
  }
  assert.equal(containsMojibake('���'), true);
  assert.equal(titleForKey('risk_summary'), '风险摘要');
  assert.equal(titleForKey('watchlist_preview'), '自选预览');
  assert.equal(titleForKey('MARKET_HOME'), '市场首页');
  assert.equal(titleForKey('ADD_WATCHLIST'), '加入自选');
  assert.equal(safeVisibleValue('READY'), '可用');
  assert.equal(safeVisibleValue('LIMITED'), '受限');
  assert.equal(safeVisibleValue('OFFLINE'), '离线');
  assert.equal(safeVisibleValue('ERROR'), '异常');
  assert.equal(safeVisibleValue('MODULE_INACTIVE'), '尚未启动');
  assert.equal(safeVisibleValue('MARKET_HOME'), '市场首页');
  assert.equal(safeVisibleValue('COMPLETE'), '完整');
  assert.equal(safeVisibleValue('CRITICAL'), '严重');
  assert.equal(safeVisibleValue('MEDIUM'), '中');
  assert.equal(safeVisibleValue('INFO'), '提示');
  const partitioned = partitionDto({ data: {
    page_title: '市场首页', evidence_health: 'healthy', store_status: { status: 'HEALTHY' }
  }, generated_at: 'now' });
  assert.deepEqual(partitioned.business, { page_title: '市场首页' });
  assert.deepEqual(partitioned.diagnostics, {
    evidence_health: 'healthy', store_status: { status: 'HEALTHY' }, generated_at: 'now'
  });
});

test('renderer contains no Market domain computation or private process/data access', () => {
  const source = fs.readFileSync(path.join(
    __dirname, '..', '..', 'src', 'electron', 'renderer', 'nexaMarketRenderer.js'
  ), 'utf8');
  assert.doesNotMatch(source, /require\s*\(|node:(?:fs|path|child_process)|ipcRenderer|stdin|stdout|PYTHONPATH/i);
  assert.doesNotMatch(source, /calculate|compute|provider selection|portfolio calculation|research score/i);
});
