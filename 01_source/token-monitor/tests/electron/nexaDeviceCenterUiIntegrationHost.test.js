'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const HOST_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'nexaDeviceCenterUiIntegrationHost.js');
const LEGACY_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'nexaDeviceCenterRenderer.js');
const HTML_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'index.html');
const INTEGRATION_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'renderer', 'nexaRendererIntegration.js');
const MODULE_ENTRY = path.resolve(PROJECT_ROOT, '..', '..', '03_modules', '设备与网络', 'src', 'ui-integration.mjs');

const hostSource = fs.readFileSync(HOST_PATH, 'utf8');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const integration = fs.readFileSync(INTEGRATION_PATH, 'utf8');
const coreHost = require(HOST_PATH);

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.childNodes = [];
    this.attributes = new Map();
    this.className = '';
    this.dataset = {};
    this.classList = {
      add: (...names) => { this.className = [...new Set(`${this.className} ${names.join(' ')}`.trim().split(/\s+/))].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); }
    };
  }
  append(...children) { this.childNodes.push(...children); }
  replaceChildren(...children) { this.childNodes = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener() {}
  removeEventListener() {}
  remove() { this.removed = true; }
}

function fakeDom() {
  const head = new FakeElement('head');
  return {
    document: {
      head,
      createElement: (tag) => new FakeElement(tag),
      createElementNS: (_namespace, tag) => new FakeElement(tag),
      getElementById: () => null
    },
    head
  };
}

test('production path selects the module-owned UI host and preserves the legacy file', () => {
  assert.equal(fs.existsSync(LEGACY_PATH), true);
  assert.equal((html.match(/src="nexaDeviceCenterUiIntegrationHost\.js"/g) || []).length, 1);
  assert.equal((html.match(/src="nexaDeviceCenterRenderer\.js"/g) || []).length, 0);
  assert.match(integration, /NexaDeviceCenterUiIntegrationHost\?\.createRenderer/);
  assert.doesNotMatch(integration, /NexaDeviceCenterRenderer\?\.createRenderer/);
});

test('Core adapter imports only the frozen public UI Integration entry', () => {
  assert.match(hostSource, /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/03_modules\/设备与网络\/src\/ui-integration\.mjs/);
  assert.match(hostSource, /DEVICE_CENTER_UI_INTEGRATION_VERSION !== UI_VERSION/);
  assert.match(hostSource, /entry\.createDeviceCenterUiIntegration/);
  assert.match(hostSource, /integration\.mount\(\{ surface, navigation, onContextChange \}\)/);
  assert.doesNotMatch(hostSource, /src\/(?:application|repository|collectors|runtime)\/|node:(?:fs|path|child_process)/i);
  assert.doesNotMatch(hostSource, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
});

test('packaged renderer resolves the same module-owned entry from outside app.asar', () => {
  const packaged = coreHost.resolveUiEntry({
    location: {
      href: 'file:///E:/NEXA/01_source/token-monitor/dist-visual-daily-use-wave004/win-unpacked/resources/app.asar/src/electron/renderer/index.html'
    }
  });
  assert.equal(packaged, 'file:///E:/NEXA/03_modules/%E8%AE%BE%E5%A4%87%E4%B8%8E%E7%BD%91%E7%BB%9C/src/ui-integration.mjs');
  assert.equal(coreHost.resolveUiEntry({
    location: { href: 'file:///E:/NEXA/01_source/token-monitor/src/electron/renderer/index.html' }
  }), 'file:///E:/NEXA/03_modules/%E8%AE%BE%E5%A4%87%E4%B8%8E%E7%BD%91%E7%BB%9C/src/ui-integration.mjs');
  assert.equal(coreHost.resolveUiEntry({ location: { href: 'https://example.invalid/index.html' } }), coreHost.UI_ENTRY);
});

test('module-owned entry matches the frozen 0.1 factory and mount contract', async () => {
  const entry = await import(pathToFileURL(MODULE_ENTRY).href);
  assert.equal(entry.DEVICE_CENTER_UI_INTEGRATION_VERSION, '0.1');
  assert.equal(typeof entry.createDeviceCenterUiIntegration, 'function');
  assert.deepEqual(entry.DEVICE_CENTER_UI_VIEWS, [
    'overview', 'performance', 'network', 'applications', 'history', 'anomalies', 'diagnostics'
  ]);
  const deviceApi = Object.fromEntries([
    'getOverview', 'getPerformance', 'getNetwork', 'runNetworkProbe', 'getApplications', 'getHistory',
    'getAnomalies', 'getAlerts', 'getDiagnostics', 'getRecovery', 'ackAlertDismissed'
  ].map((method) => [method, async () => ({ ok: true, value: {} })]));
  const fakeDocument = { createElement() {}, createElementNS() {} };
  const value = entry.createDeviceCenterUiIntegration({
    deviceApi,
    host: { document: fakeDocument, readRoute() { return '#/device-center'; }, replaceRoute() {} }
  });
  assert.equal(value.version, '0.1');
  assert.equal(typeof value.mount, 'function');
});

test('Core host capability is bounded to DOM, locale, and Device Center route replacement', () => {
  assert.match(hostSource, /document,/);
  assert.match(hostSource, /locale:\s*\(\) =>/);
  assert.match(hostSource, /readRoute:\s*\(\) =>/);
  assert.match(hostSource, /replaceRoute\(route\)/);
  assert.match(hostSource, /!route\.startsWith\('#\/device-center'\)/);
});

test('Core host projects stable Chinese view and unavailable labels without changing module-owned views', () => {
  assert.deepEqual(coreHost.VIEW_LABELS, {
    overview: '概览', performance: '性能', network: '网络', applications: '应用',
    history: '历史', anomalies: '异常', diagnostics: '诊断'
  });
  assert.match(hostSource, /设备与网络不可用/);
  assert.match(hostSource, /用途：查看本机硬件、网络、应用、历史、异常与诊断/);
  assert.match(hostSource, /原因：模块页面或其本地 UI Integration/);
  assert.match(hostSource, /最近更新：未完成 · 数据状态未知/);
  assert.match(hostSource, /下一步：重试加载本地模块/);
  assert.match(hostSource, /重试加载/);
  assert.match(hostSource, /查看诊断信息/);
});

test('Core adapter dynamically mounts, activates, deactivates, and unmounts the real module UI', async () => {
  const { document } = fakeDom();
  const surface = new FakeElement('section');
  const navigation = new FakeElement('nav');
  const contexts = [];
  const browser = {
    document,
    location: { hash: '#/device-center?view=overview' },
    navigator: { language: 'en' },
    history: {
      state: null,
      replaceState(_state, _title, route) { browser.location.hash = route; }
    }
  };
  const result = (value = {}) => Promise.resolve({ ok: true, value });
  const deviceApi = {
    getOverview: () => result({}), getPerformance: () => result({}), getNetwork: () => result({}), runNetworkProbe: () => result({}),
    getApplications: () => result({}), getHistory: () => result({}), getAnomalies: () => result({}),
    getAlerts: () => result({ items: [] }), getDiagnostics: () => result({}), getRecovery: () => result({}),
    ackAlertDismissed: () => result({})
  };
  const renderer = coreHost.createRenderer({
    api: deviceApi, surface, subNavigation: navigation, document, window: browser,
    onContextChange: (value) => contexts.push(value)
  });
  await renderer.activate();
  assert.equal(navigation.childNodes.length, 7);
  assert.equal(renderer.getView(), 'overview');
  assert.equal(contexts.at(-1).status, '只读');
  assert.ok(surface.childNodes.length > 0);
  renderer.deactivate();
  assert.equal(renderer.unmount(), true);
  assert.equal(navigation.childNodes.length, 0);
  await renderer.activate();
  assert.equal(navigation.childNodes.length, 7);
  assert.equal(contexts.at(-1).status, '只读');
  assert.equal(renderer.unmount(), true);
  assert.equal(navigation.childNodes.length, 0);
});
