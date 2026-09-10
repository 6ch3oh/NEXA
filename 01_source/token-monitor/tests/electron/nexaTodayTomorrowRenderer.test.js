'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const RENDERER_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'nexaTodayTomorrowRenderer.js');
const DRAWER_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'nexaRightDrawer.js');
const INTEGRATION_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'nexaRendererIntegration.js');
const HTML_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'index.html');
const CSS_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'styles.css');

const rendererSource = fs.readFileSync(RENDERER_PATH, 'utf8');
const drawerSource = fs.readFileSync(DRAWER_PATH, 'utf8');
const integrationSource = fs.readFileSync(INTEGRATION_PATH, 'utf8');
const htmlSource = fs.readFileSync(HTML_PATH, 'utf8');
const cssSource = fs.readFileSync(CSS_PATH, 'utf8');

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  values() { return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean)); }
  contains(name) { return this.values().has(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.value = '';
  }
  append(...children) {
    for (const child of children) {
      if (child === undefined || child === null) continue;
      child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ currentTarget: this, preventDefault() {}, ...event });
    }
  }
  querySelector(selector) { return find(this, (item) => matches(item, selector)); }
  scrollIntoView() {}
  focus() {}
}

function matches(element, selector) {
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  return element.tagName === selector.toUpperCase();
}

function find(element, predicate) {
  if (predicate(element)) return element;
  for (const child of element.children) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}

function findAll(element, predicate, result = []) {
  if (predicate(element)) result.push(element);
  for (const child of element.children) findAll(child, predicate, result);
  return result;
}

function allText(element) {
  return [element.textContent, ...element.children.map(allText)].filter(Boolean).join(' ');
}

function loadApi(source, name) {
  const sandbox = { module: { exports: {} }, exports: {}, console };
  vm.runInNewContext(source, sandbox, { filename: name });
  return sandbox.module.exports;
}

function loadRendererWithDocument(document) {
  const sandbox = {
    module: { exports: {} }, exports: {}, console, document,
    window: { confirm: () => true }
  };
  vm.runInNewContext(rendererSource, sandbox, { filename: RENDERER_PATH });
  return sandbox.module.exports;
}

test('Today/Tomorrow remains the real Calendar work surface while Home uses its summary Widget', () => {
  assert.match(htmlSource, /id="nexaHomeSubNavigation"[^>]*aria-label="今日与明日"/);
  assert.match(htmlSource, /data-nexa-day-view="today"[^>]*aria-current="page"/);
  assert.match(htmlSource, /data-nexa-day-view="tomorrow"/);
  assert.match(htmlSource, /id="nexaTodayTomorrowSurface"/);
  assert.match(integrationSource, /snapshot\.activeRoute === 'calendar'/);
  assert.match(integrationSource, /todayTomorrowRenderer\?\.setView\(view\)/);
  assert.match(integrationSource, /todayTomorrowRenderer\?\.openDate/);
  assert.match(rendererSource, /function openDate\(date\)/);
  assert.doesNotMatch(integrationSource, /listRoutes\([^)]*today|listRoutes\([^)]*tomorrow/);
});

test('renderer consumes only the formal NEXA public bridge and never storage or 08 private imports', () => {
  assert.match(rendererSource, /api\.getView\(/);
  assert.match(rendererSource, /api\.execute\(/);
  assert.doesNotMatch(rendererSource, /sqlite|repository|DatabaseSync|03_modules|src[\\/]planning|src[\\/]services/i);
  assert.doesNotMatch(rendererSource, /fetch\(|WebSocket|EventSource|XMLHttpRequest/i);
});

test('planning keeps Deadline read-only and sends concrete time or migration only after user actions', () => {
  assert.match(rendererSource, /截止时间保持只读/);
  assert.match(rendererSource, /保存计划时间/);
  assert.match(rendererSource, /status === 'CONFLICT_WARNING'/);
  assert.match(rendererSource, /确认并保留冲突/);
  assert.match(rendererSource, /acceptConflicts:\s*true/);
  assert.match(rendererSource, /加入明日草稿/);
  assert.match(rendererSource, /保存计划/);
  assert.match(rendererSource, /type:\s*'confirm-carryover'/);
  assert.doesNotMatch(rendererSource, /due_at\s*:/);
});

test('one shared RightDrawer shell owns close, dirty confirmation, focus restore and focus containment', () => {
  assert.equal((htmlSource.match(/id="nexaRightDrawer"/g) || []).length, 1);
  assert.match(htmlSource, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(drawerSource, /confirmClose/);
  assert.match(drawerSource, /returnFocus/);
  assert.match(drawerSource, /event\.key === 'Escape'/);
  assert.match(drawerSource, /event\.key === 'Tab'/);
  assert.match(drawerSource, /sibling\.inert = true/);
  assert.match(drawerSource, /关闭\$\{title\.textContent\}/);
  assert.match(htmlSource, /id="nexaRightDrawerClose"[^>]*aria-label="关闭详情"/);
  assert.doesNotMatch(drawerSource, /`Close \$\{title\.textContent\}`/);
  assert.doesNotMatch(rendererSource, /todayDrawer|tomorrowDrawer/i);
});

test('Renderer state contract covers loading, ready/empty, error and explicit stale without recomputation', () => {
  for (const state of ['loading', 'ready', 'error', 'stale']) {
    assert.match(rendererSource, new RegExp(`['"]${state}['"]`));
  }
  assert.match(rendererSource, /今天暂无重点事项/);
  assert.match(rendererSource, /明天尚未安排计划/);
  assert.match(rendererSource, /next\?\.stale === true/);
  assert.doesNotMatch(rendererSource, /staleAfter|Date\.now\(\)\s*-/);
});

test('layout implements the frozen 1440 and 1024 grid, semantic surfaces, and overlay Drawer', () => {
  assert.match(cssSource, /max\(28px, calc\(\(100% - 1180px\) \/ 2\)\)/);
  assert.match(cssSource, /grid-template-columns:\s*minmax\(0, 2fr\) minmax\(280px, 1fr\)/);
  assert.match(cssSource, /grid-template-columns:\s*minmax\(0, 1\.45fr\) minmax\(320px, 1fr\)/);
  assert.match(cssSource, /@media \(max-width: 1199px\)[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(cssSource, /width:\s*min\(420px, calc\(100vw - 48px\)\)/);
  assert.match(cssSource, /position:\s*absolute; z-index:\s*30/);
  assert.match(cssSource, /\.nexa-right-drawer-actions[\s\S]*align-items:\s*center/);
  assert.match(cssSource, /\.nexa-right-drawer-actions button[^{]*\{[^}]*min-height:\s*36px/);
});

test('utility helpers preserve local dates and fail closed on unsafe envelopes', () => {
  const api = loadApi(rendererSource, RENDERER_PATH);
  assert.equal(api.localDate(new Date(2026, 7, 13, 23, 30)), '2026-08-13');
  assert.equal(api.formatRange('16:00'), '16:00');
  assert.notEqual(api.formatRange('2026-08-13T16:00:00+08:00'), 'Invalid Date');
  assert.deepEqual(api.unwrap({ ok: true, value: { date: '2026-08-13' } }), { date: '2026-08-13' });
  assert.throws(() => api.unwrap({ ok: false, error: { code: 'SAFE_FAILURE', message: 'failed' } }), (error) => {
    assert.equal(error.code, 'SAFE_FAILURE');
    assert.equal(error.message, 'failed');
    return true;
  });
});

test('Calendar L1 owns a stable 42-day month context with today semantics and keyboard navigation', () => {
  const api = loadApi(rendererSource, RENDERER_PATH);
  const range = api.monthRange('2026-09');
  assert.equal(range.start, '2026-08-30');
  assert.equal(range.end, '2026-10-10');
  const days = api.calendarDays('2026-09', {
    dates: [{ date: '2026-09-02', sublabel: '待办 2 项' }]
  }, '2026-09-02', '2026-09-02');
  assert.equal(days.length, 42);
  assert.equal(days.filter((day) => day.today).length, 1);
  assert.equal(days.find((day) => day.today).sublabel, '待办 2 项');
  assert.match(rendererSource, /aria-current', 'date'/);
  assert.match(rendererSource, /回到今天/);
  assert.match(rendererSource, /ArrowLeft:[^\n]*-1[\s\S]*ArrowRight:[^\n]*1[\s\S]*ArrowUp:[^\n]*-7[\s\S]*ArrowDown:[^\n]*7/);
});

test('Calendar L1 exposes only the global command shortcut and makes zero local proposal calls', async () => {
  const document = {
    createElement: (tag) => new FakeElement(tag),
    getElementById: () => null
  };
  const rendererApi = loadRendererWithDocument(document);
  const surface = new FakeElement('section');
  let proposalCalls = 0;
  let openedContext = null;
  const renderer = rendererApi.createRenderer({
    surface,
    drawer: { open() {}, close() {}, setDirty() {} },
    now: new Date(2026, 8, 2, 9, 0),
    onOpenGlobalCommand(context) { openedContext = context; },
    api: {
      async getView(_view, date) {
        return { ok: true, value: {
          date, fixed_calendar_events: [], confirmed_task_plans: [], unplaced_tasks: [],
          priority_suggestions: [], reminders: [], carryover_suggestions: []
        } };
      },
      async execute() { return { ok: true, value: {} }; },
      async getMonthSummary() { return { ok: true, value: { dates: [] } }; },
      async getLocalAiState() {
        return { ok: true, value: { status: 'unconfigured', can_propose: false } };
      },
      async proposeLocalAi() { proposalCalls += 1; return { ok: false, error: { code: 'AI_UNCONFIGURED' } }; },
      async confirmLocalAi() { return { ok: false, error: { code: 'CONFIRMATION_REQUIRED' } }; },
      async cancelLocalAi() { return { ok: false, error: { code: 'PROPOSAL_NOT_FOUND' } }; },
      async undoLocalAi() { return { ok: false, error: { code: 'PROPOSAL_NOT_FOUND' } }; }
    }
  });
  await renderer.activate();
  assert.equal(findAll(surface, (item) => item.classList.contains('nexa-calendar-page-day')).length, 42);
  assert.match(allText(surface), /等待你提供本地模型地址、模型名、协议与授权方式/);
  assert.equal(findAll(surface, (item) => item.tagName === 'INPUT' && /明天下午/.test(item.placeholder || '')).length, 0);
  const shortcut = find(surface, (item) => item.textContent === '聚焦全局命令栏');
  assert.ok(shortcut);
  shortcut.dispatch('click');
  assert.match(openedContext.selectedDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(proposalCalls, 0);
  renderer.deactivate();
});

test('Calendar L1 does not render a second natural-language proposal workflow', async () => {
  const document = {
    createElement: (tag) => new FakeElement(tag),
    getElementById: () => null
  };
  const rendererApi = loadRendererWithDocument(document);
  const surface = new FakeElement('section');
  let opened = 0;
  const renderer = rendererApi.createRenderer({
    surface,
    drawer: { open() {}, close() {}, setDirty() {} },
    now: new Date(2026, 8, 2, 9, 0),
    onOpenGlobalCommand() { opened += 1; },
    api: {
      async getView(_view, date) {
        return { ok: true, value: {
          date, fixed_calendar_events: [], confirmed_task_plans: [], unplaced_tasks: [],
          priority_suggestions: [], reminders: [], carryover_suggestions: []
        } };
      },
      async execute() { return { ok: true, value: {} }; },
      async getMonthSummary() { return { ok: true, value: { dates: [] } }; },
      async getLocalAiState() { return { ok: true, value: { status: 'ready', can_propose: true } }; }
    }
  });
  await renderer.activate();
  assert.equal(findAll(surface, (item) => item.tagName === 'FORM' && item.className === 'nexa-calendar-ai-page-form').length, 0);
  assert.equal(findAll(surface, (item) => item.tagName === 'INPUT' && /明天下午/.test(item.placeholder || '')).length, 0);
  find(surface, (item) => item.textContent === '聚焦全局命令栏').dispatch('click');
  assert.equal(opened, 1);
  renderer.deactivate();
});
