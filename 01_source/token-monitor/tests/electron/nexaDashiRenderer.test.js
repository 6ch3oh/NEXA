'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const rendererPath = path.join(root, 'src', 'electron', 'renderer', 'nexaDashiRenderer.js');
const integrationPath = path.join(root, 'src', 'electron', 'renderer', 'nexaRendererIntegration.js');
const htmlPath = path.join(root, 'src', 'electron', 'renderer', 'index.html');
const cssPath = path.join(root, 'src', 'electron', 'renderer', 'styles.css');
const renderer = require(rendererPath);
const rendererSource = fs.readFileSync(rendererPath, 'utf8');
const integrationSource = fs.readFileSync(integrationPath, 'utf8');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.nodeType = 1;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }
  querySelectorAll() { return []; }
}

function success(data) {
  return Promise.resolve({ ok: true, hostStatus: 'ready', value: { ok: true, status: 'SUCCESS', data, meta: {} } });
}

test('Dashi is one top-level route with exactly three L2 read views', () => {
  assert.match(htmlSource, /id="nexaDashiSubNavigation"[^>]*aria-label="Dashi 任务板视图"/);
  assert.equal((htmlSource.match(/data-nexa-dashi-view=/g) || []).length, 3);
  assert.match(htmlSource, /data-nexa-dashi-view="overview"/);
  assert.match(htmlSource, /data-nexa-dashi-view="projects"/);
  assert.match(htmlSource, /data-nexa-dashi-view="tasks"/);
  assert.match(htmlSource, /id="nexaDashiSurface"/);
  assert.match(integrationSource, /snapshot\.activeRoute === 'dashi'/);
});

test('Renderer consumes exactly the seven Public Read API V0.1 methods and no write surface', () => {
  for (const member of [
    'getSourceHealth', 'getBoardOverview', 'listProjects', 'getProjectDetail', 'listTasks',
    'getTaskDetail', 'getTaskExecutionContext'
  ]) assert.match(rendererSource, new RegExp(`readApi\\.${member}\\(`));
  assert.doesNotMatch(rendererSource, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|setInterval|setTimeout/);
  assert.doesNotMatch(rendererSource, /readApi\.(?:createTask|updateTask|deleteTask|runTask|retryTask|acceptTask|rejectTask|openCodex|openEvidence)\s*\(/);
  assert.doesNotMatch(rendererSource, /sqlite|DatabaseSync|03_modules|source_import|taskctl/i);
});

test('missing, stale, disconnected, and host failures preserve their frozen Chinese semantics', () => {
  assert.equal(renderer.missingReason('NO_RUN'), '当前没有关联执行记录');
  assert.equal(renderer.missingReason('NO_EXPLICIT_RUN_ASSOCIATION'), '没有可靠的显式执行关联');
  assert.equal(renderer.missingReason('NO_CODEX_THREAD'), '当前没有可展示的关联任务会话');
  assert.equal(renderer.missingReason('NO_ACCEPTANCE_RESULT'), '尚无验收结果');
  assert.equal(renderer.missingReason('NO_EVIDENCE'), '没有证据记录');
  assert.equal(renderer.missingReason('EVIDENCE_MISSING'), '已记录证据，但对应文件当前缺失');
  assert.equal(renderer.missingReason('SOURCE_STALE'), '来源可读，但数据可能已过期');
  assert.equal(renderer.missingReason('NOT_AVAILABLE'), '不可用');
  assert.equal(renderer.missingReason('PARTIAL'), '部分数据可用');
  assert.match(rendererSource, /statePanel\('partial', '部分数据可用'/);
  assert.match(rendererSource, /以下指标受当前只读来源能力限制/);
  assert.equal(renderer.sourceHealthLabel('CONNECTED_STALE'), '已连接 · 数据可能已过期');
  assert.equal(renderer.sourceHealthLabel('DISCONNECTED'), 'Dashi 数据源未连接');
  assert.equal(renderer.sourcePresentation({ sourceType: 'dashi-authoritative-canonical-read', provenance: 'REAL_READ_SOURCE' }), '本地只读数据');
  assert.equal(renderer.sourcePresentation({}), '不可用');
  assert.equal(renderer.errorPresentation({ hostFailure: true }).title, 'Dashi 请求暂不可用');
  assert.equal(renderer.displayLabel('RUNNING'), '运行中');
  assert.equal(renderer.displayLabel('STALE'), '数据可能已过期');
  assert.equal(renderer.activitySummary({ summary: 'Task updated' }), '任务已更新');
});

test('normal Dashi presentation does not leak frozen English product terms', () => {
  for (const term of ['Task updated', 'Run 关联', "drawerField('Run'", "drawerField('Codex Thread'", 'Public Read API']) {
    assert.equal(rendererSource.includes(term), false, term);
  }
  assert.equal(renderer.FILTER_LABELS.stale, '数据可能已过期');
  assert.match(rendererSource, /stale: '数据可能已过期'/);
});

test('Dashi timestamps use a compact Shanghai date without a raw GMT marker', () => {
  const formatted = renderer.formatDateTime('2026-08-05T02:03:00.000Z');
  assert.match(formatted, /^2026\/08\/05\s+10:03$/);
  assert.doesNotMatch(formatted, /GMT|UTC|时区/i);
});

test('host and Dashi envelopes remain distinct and arbitrary backend messages do not render', () => {
  const payload = { id: 'task-1' };
  assert.deepEqual(renderer.unwrap({ ok: true, value: { ok: true, status: 'SUCCESS', data: payload, meta: {} } }).data, payload);
  assert.throws(() => renderer.unwrap({
    ok: false, hostStatus: 'request-failed', error: { code: 'HOST_FAIL', message: 'sensitive host detail' }
  }), (error) => error.hostFailure === true && error.message === 'Dashi read request failed');
  assert.throws(() => renderer.unwrap({
    ok: true, value: { ok: false, status: 'SOURCE_READ_FAILED', error: { code: 'SOURCE_READ_FAILED', message: 'raw source detail' } }
  }), (error) => error.hostFailure === false && error.message === 'Dashi read request failed');
});

test('enter, exit, and re-enter attach one navigation listener and clean it on exit', async (t) => {
  const priorDocument = global.document;
  const priorWindow = global.window;
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  global.window = {
    location: { hash: '#/dashi?view=overview' },
    history: { state: null, replaceState(_state, _title, hash) { global.window.location.hash = hash; } }
  };
  t.after(() => {
    global.document = priorDocument;
    global.window = priorWindow;
  });

  const controls = ['overview', 'projects', 'tasks'].map((view) => {
    const control = new FakeElement('button');
    control.dataset.nexaDashiView = view;
    return control;
  });
  const subNavigation = new FakeElement('nav');
  subNavigation.querySelectorAll = () => controls;
  const surface = new FakeElement('section');
  const drawer = { closeCalls: 0, close() { this.closeCalls += 1; }, open() {} };
  const api = {
    getSourceHealth: () => success({
      connected: true,
      status: 'CONNECTED_STALE',
      freshness: { state: 'stale', sourceUpdatedAt: null }
    }),
    getBoardOverview: () => success({
      projectCount: 0,
      taskCount: 0,
      runningCount: 0,
      blockedCount: 0,
      failedCount: 0,
      waitingAcceptanceCount: null,
      staleTaskCount: 0,
      activeProjects: [],
      lastActivity: null,
      readiness: { waitingAcceptanceCount: 'PARTIAL' }
    }),
    listProjects: () => success([]),
    getProjectDetail: () => success({}),
    listTasks: () => success({ filter: 'all', items: [] }),
    getTaskDetail: () => success({}),
    getTaskExecutionContext: () => success({})
  };
  const instance = renderer.createRenderer({ api, surface, subNavigation, drawer });

  assert.equal(instance.getState().active, false);
  assert.deepEqual(controls.map((control) => control.listenerCount('click')), [0, 0, 0]);
  instance.activate();
  instance.activate();
  assert.equal(instance.getState().active, true);
  assert.deepEqual(controls.map((control) => control.listenerCount('click')), [1, 1, 1]);
  await instance.load();

  instance.deactivate();
  assert.equal(instance.getState().active, false);
  assert.deepEqual(controls.map((control) => control.listenerCount('click')), [0, 0, 0]);
  assert.equal(drawer.closeCalls, 1);

  instance.activate();
  assert.equal(instance.getState().active, true);
  assert.deepEqual(controls.map((control) => control.listenerCount('click')), [1, 1, 1]);
  await instance.load();
  instance.deactivate();
});

test('route state supports overview, filters, and project deep links without a second shell', () => {
  assert.deepEqual(renderer.parseRoute('#/dashi?view=tasks&filter=blocked'), {
    view: 'tasks', projectId: null, filter: 'blocked'
  });
  assert.deepEqual(renderer.parseRoute('#/dashi/projects/project%201?from=projects'), {
    view: 'project', projectId: 'project 1', filter: 'all'
  });
  assert.equal(renderer.routeHash({ view: 'project', projectId: 'project 1', filter: 'all' }),
    '#/dashi/projects/project%201?from=projects');
  assert.equal(renderer.routeHash({ view: 'tasks', projectId: null, filter: 'stale' }),
    '#/dashi?view=tasks&filter=stale');
  assert.equal((htmlSource.match(/id="nexaRightDrawer"/g) || []).length, 1);
  assert.doesNotMatch(htmlSource, /dashiDrawer|dashiSidebar/i);
  assert.match(rendererSource, /if \(state\.view === 'project'\)[\s\S]*?← 返回项目/);
});

test('task and execution status remain separate and the shared Drawer has no actions for Dashi', () => {
  assert.match(rendererSource, /taskStatus/);
  assert.match(rendererSource, /taskExecutionLabel/);
  assert.match(rendererSource, /taskAcceptanceLabel/);
  assert.match(rendererSource, /taskEvidenceLabel/);
  assert.match(rendererSource, /description: view === 'execution' \? '执行上下文 · 只读' : '任务详情 · 只读'/);
  assert.match(rendererSource, /actions: \[\]/);
  assert.match(rendererSource, /重试读取/);
  assert.doesNotMatch(rendererSource, /task\.taskStatus[^\n]*accept|execution[^\n]*ACCEPTED/i);
});

test('Core-owned Dashi presentation uses Chinese product labels while preserving the Dashi brand', () => {
  for (const copy of ['DASHI · 只读', '需要关注', '任务状态', '执行状态', '数据状态']) {
    assert.match(rendererSource, new RegExp(copy));
  }
  assert.doesNotMatch(rendererSource, /READ ONLY · DASHI|>Attention<|Freshness /);
});

test('responsive layout has only local table overflow and the frozen standard Drawer width', () => {
  assert.match(cssSource, /\.nexa-dashi-surface[\s\S]*?max\(28px, calc\(\(100% - 1180px\) \/ 2\)\)/);
  assert.match(cssSource, /\.nexa-dashi-table-region[^}]*overflow-x:\s*auto/);
  assert.match(cssSource, /\.nexa-dashi-table[^}]*min-width:\s*980px/);
  assert.match(cssSource, /@media \(max-width: 1199px\)[\s\S]*\.nexa-dashi-surface/);
  assert.match(cssSource, /\.nexa-right-drawer[\s\S]*?width:\s*min\(420px, calc\(100vw - 48px\)\)/);
  assert.doesNotMatch(cssSource, /\.nexa-dashi-surface[^}]*overflow-x:\s*auto/);
  assert.match(cssSource, /@media \(max-width: 600px\)[\s\S]*?\.nexa-dashi-metric-band\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(cssSource, /@media \(max-width: 600px\)[\s\S]*?\.nexa-dashi-metric\s*\{[^}]*min-width:\s*0/);
  assert.match(cssSource, /\.nexa-dashi-header h1[^}]*white-space:\s*nowrap/);
  assert.match(cssSource, /@media \(max-width: 600px\)[\s\S]*?\.nexa-dashi-header\s*\{[^}]*flex-direction:\s*column/);
});
