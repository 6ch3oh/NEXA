'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const UI_ENTRY = path.join(ROOT, 'src', 'ui-integration.mjs');
const UI_STYLESHEET = path.join(ROOT, 'src', 'device-center-ui.css');
const PUBLIC_ENTRY = path.join(ROOT, 'src', 'public-api.mjs');
const UI_CONTRACT = path.join(ROOT, 'docs', 'DEVICE_CENTER_UI_INTEGRATION_V0.1.md');
const loadUi = () => import(pathToFileURL(UI_ENTRY).href);
const loadPublic = () => import(pathToFileURL(PUBLIC_ENTRY).href);

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  add(...names) {
    const values = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    for (const name of names) values.add(name);
    this.owner.className = [...values].join(' ');
  }
  remove(...names) {
    const removed = new Set(names);
    this.owner.className = this.owner.className.split(/\s+/).filter(name => name && !removed.has(name)).join(' ');
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.childNodes = [];
    this.attributes = new Map();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.listeners = new Map();
    this.parentNode = null;
    this.textContent = '';
    this.id = '';
  }
  append(...children) {
    for (const child of children) {
      if (child === undefined || child === null) continue;
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...children);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  async dispatch(type) {
    await Promise.all([...this.listeners.get(type) || []].map(listener => listener({ currentTarget: this })));
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter(child => child !== this);
    this.parentNode = null;
  }
}

class FakeDocument {
  constructor() { this.head = new FakeElement('head'); }
  createElement(tagName) { return new FakeElement(tagName); }
  createElementNS(_namespace, tagName) { return new FakeElement(tagName); }
  getElementById(id) {
    const visit = node => {
      if (node.id === id) return node;
      for (const child of node.childNodes) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.head);
  }
}

function textTree(node) {
  return [node.textContent, ...node.childNodes.map(textTree)].filter(Boolean).join(' ');
}

function findByText(node, text) {
  if (node.textContent === text) return node;
  for (const child of node.childNodes) {
    const found = findByText(child, text);
    if (found) return found;
  }
  return null;
}

function apiFixture(overrides = {}) {
  const calls = [];
  const envelope = value => Promise.resolve({ ok: true, value });
  const api = {
    getOverview: () => { calls.push(['overview']); return envelope({
      schema_version: '0.1',
      contract: 'DeviceCenterOverviewDTO V0.1',
      availability: 'available',
      device_health: { status: 'healthy', reason_count: 0 },
      cpu: { availability: 'available', value: 17, unit: 'percent' },
      ram: { availability: 'available', value: 42, unit: 'percent' },
      gpu: { availability: 'available', value: 8, unit: 'percent' },
      gpu_temperature: { availability: 'available', value: 51, unit: 'celsius' },
      cpu_temperature: { availability: 'unsupported', value: null, reason: 'CPU_TEMPERATURE_UNAVAILABLE' },
      network_availability: 'available',
      public_ip: { availability: 'available', value: '203.0.113.10' },
      approximate_location: { availability: 'available', country: '中国', region: '上海', city: '上海', isp: '示例 ISP', asn: 'AS64500' },
      apex: { runtime: 'available', route_model: 'unknown', confidence: 'high', limited_visibility: true },
      active_anomaly_count: 0,
      last_updated: '2026-08-23T10:43:53.619Z',
      overall_freshness: 'fresh'
    }); },
    getPerformance: () => { calls.push(['performance']); return envelope({ availability: 'available', metrics: {} }); },
    getNetwork: () => { calls.push(['network']); return envelope({ availability: 'partial', foreign_path: { status: 'deferred' }, apex: { runtime: 'available', route_model: 'unknown', confidence: 'high', limited_visibility: true }, network_probe: { status: 'target_pending', status_label: '探针待配置', target_status: 'not_configured', targets: [], tiers: { light: { availability: 'target_pending' }, quality: { availability: 'target_pending' }, full: { availability: 'target_pending', execution_policy: 'user_initiated_only' } }, last_result: null } }); },
    runNetworkProbe: request => { calls.push(['probe', request]); return envelope({ status: 'completed', tier: request.tier, latency_ms: 12, failure_rate: 0 }); },
    getApplications: () => { calls.push(['applications']); return envelope({ availability: 'available', cpu_top5: [], ram_top5: [], network_top5: { availability: 'unavailable', reason: 'APPLICATION_BYTE_ACCOUNTING_NOT_AVAILABLE', items: [] }, top_active_connections: { availability: 'available', items: [] } }); },
    getHistory: options => { calls.push(['history', options]); return envelope({ availability: 'unavailable', metrics: {}, empty_state: { code: 'NO_HISTORY_DATA' } }); },
    getAnomalies: () => { calls.push(['anomalies']); return envelope({ availability: 'available', active: [], recent_resolved: [] }); },
    getAlerts: options => { calls.push(['alerts', options]); return envelope({ availability: 'available', items: [{ alert_id: 'alert-1', title: 'CPU alert', summary: 'CPU critical', delivery_status: 'pending' }] }); },
    getDiagnostics: () => { calls.push(['diagnostics']); return envelope({ status: 'healthy', components: [] }); },
    getRecovery: () => { calls.push(['recovery']); return envelope({ overall_state: 'healthy' }); },
    ackAlertDismissed: id => { calls.push(['dismiss', id]); return envelope({ status: 'dismissed', id }); },
    ...overrides
  };
  return { api, calls };
}

function hostFixture(route = '#/device-center?view=overview') {
  const document = new FakeDocument();
  const routes = [];
  let currentRoute = route;
  return {
    document,
    routes,
    host: {
      document,
      locale: 'en-US',
      readRoute: () => currentRoute,
      replaceRoute(value) { currentRoute = value; routes.push(value); }
    }
  };
}

test('authoritative module-owned UI entry exists', () => assert.equal(fs.existsSync(UI_ENTRY), true));
test('module-owned stylesheet exists as a static asset', () => assert.equal(fs.existsSync(UI_STYLESHEET), true));
test('UI integration is a separate ESM entry', () => assert.equal(path.extname(UI_ENTRY), '.mjs'));
test('UI integration version is explicit', async () => assert.equal((await loadUi()).DEVICE_CENTER_UI_INTEGRATION_VERSION, '0.1'));
test('user-visible primary language is explicit', async () => assert.equal((await loadUi()).DEVICE_CENTER_UI_LANGUAGE, 'zh-CN'));
test('UI factory is exported', async () => assert.equal(typeof (await loadUi()).createDeviceCenterUiIntegration, 'function'));
test('seven Device Center views remain module-owned and frozen', async () => {
  const ui = await loadUi();
  assert.equal(Object.isFrozen(ui.DEVICE_CENTER_UI_VIEWS), true);
  assert.deepEqual(ui.DEVICE_CENTER_UI_VIEWS, ['overview', 'performance', 'network', 'applications', 'history', 'anomalies', 'diagnostics']);
  assert.deepEqual(ui.DEVICE_CENTER_UI_VIEW_LABELS, {
    overview: '概览', performance: '性能', network: '网络', applications: '应用',
    history: '历史', anomalies: '异常', diagnostics: '诊断'
  });
});

test('backend Public API v0.1 exports remain byte-for-byte compatible in shape', async () => {
  const publicApi = await loadPublic();
  assert.equal(publicApi.DEVICE_CENTER_PUBLIC_API_VERSION, '0.1');
  assert.deepEqual(Object.keys(publicApi).sort(), ['DEVICE_CENTER_PUBLIC_API_VERSION', 'createDeviceCenterApplication', 'default']);
});

test('package exposes UI integration without replacing backend public entry', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.exports['./public-api'], './src/public-api.mjs');
  assert.equal(pkg.exports['./ui-integration'], './src/ui-integration.mjs');
});

test('route mapping is bounded and owned by the module', async () => {
  const ui = await loadUi();
  assert.equal(ui.parseDeviceCenterRoute('#/device-center?view=network'), 'network');
  assert.equal(ui.parseDeviceCenterRoute('#/other?view=network'), 'overview');
  assert.equal(ui.deviceCenterRoute('secret'), '#/device-center?view=overview');
});

test('projection preserves unavailable, deferred, zero and false truth', async () => {
  const ui = await loadUi();
  assert.equal(ui.projectDeviceValue({ availability: 'unsupported', value: null, reason: 'CPU_TEMPERATURE_UNAVAILABLE' }), '当前硬件或驱动未提供该数据');
  assert.equal(ui.projectDeviceValue({ availability: 'deferred', value: null, reason: 'FOREIGN_PATH_DEFERRED' }), '境外路径暂缓');
  assert.equal(ui.projectDeviceValue({ value: 0, unit: 'percent' }, 'zh-CN'), '0%');
  assert.equal(ui.projectDeviceValue(false), '否');
  assert.equal(ui.labelForDeviceField('available'), '可用');
  assert.equal(ui.labelForDeviceField('unavailable'), '不可用');
  assert.equal(ui.labelForDeviceField('unsupported'), '不支持');
  assert.equal(ui.labelForDeviceField('unknown'), '未知');
  assert.equal(ui.labelForDeviceField('deferred'), '暂缓');
  assert.equal(ui.labelForDeviceField('healthy'), '正常');
});

test('GPU product UI preserves available truth and localizes the bounded unavailable reason', async () => {
  const ui = await loadUi();
  const rawReason = 'GPU collection is deferred in NEXA-DEVICE-NET-002.';
  const unavailableGpu = { availability: 'unavailable', value: null, reason: rawReason };

  assert.equal(ui.projectDeviceValue({ availability: 'available', value: 8, unit: 'percent' }, 'zh-CN'), '8%');
  assert.equal(ui.projectDeviceValue(unavailableGpu, 'zh-CN'), 'GPU 数据暂未采集');
  assert.equal(unavailableGpu.reason, rawReason);

  const overviewDevice = apiFixture({
    getOverview: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      device_health: { status: 'healthy', reason_count: 0 },
      gpu: unavailableGpu,
      network_availability: 'available',
      apex: { runtime: 'available', route_model: 'system_proxy', confidence: 'high', limited_visibility: false }
    } })
  });
  const overviewFixture = hostFixture();
  const overviewSurface = overviewFixture.document.createElement('main');
  const overviewController = ui.createDeviceCenterUiIntegration({ deviceApi: overviewDevice.api, host: overviewFixture.host })
    .mount({ surface: overviewSurface, navigation: overviewFixture.document.createElement('nav') });
  await overviewController.activate();
  const overviewText = textTree(overviewSurface);
  assert.match(overviewText, /GPU\s+不可用\s+GPU 数据暂未采集/);
  assert.match(overviewText, /APEX 状态\s+运行中\s+路由状态：已识别/);
  assert.doesNotMatch(overviewText, /GPU collection is deferred|NEXA-DEVICE-NET-002/);
  overviewController.unmount();

  const performanceDevice = apiFixture({
    getPerformance: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      metrics: { gpu: { availability: 'unavailable', current: unavailableGpu, history: { points: [] } } }
    } })
  });
  const performanceFixture = hostFixture('#/device-center?view=performance');
  const performanceSurface = performanceFixture.document.createElement('main');
  const performanceController = ui.createDeviceCenterUiIntegration({ deviceApi: performanceDevice.api, host: performanceFixture.host })
    .mount({ surface: performanceSurface, navigation: performanceFixture.document.createElement('nav') });
  await performanceController.activate();
  const performanceText = textTree(performanceSurface);
  assert.match(performanceText, /GPU\s+不可用\s+GPU 数据暂未采集/);
  assert.doesNotMatch(performanceText, /GPU collection is deferred|NEXA-DEVICE-NET-002/);
  performanceController.unmount();
});

test('Network product UI preserves available truth and localizes the bounded unavailable reason', async () => {
  const ui = await loadUi();
  const rawReason = 'Network sample pair is unavailable.';
  const unavailableSample = { availability: 'unavailable', value: null, unit: 'bytes_per_second', reason: rawReason };

  assert.equal(ui.projectDeviceValue({ availability: 'available', value: 128, unit: 'bytes_per_second' }, 'zh-CN'), '128 字节/秒');
  assert.equal(ui.projectDeviceValue(unavailableSample, 'zh-CN'), '网络采样暂不可用');
  assert.equal(unavailableSample.reason, rawReason);

  const performanceDevice = apiFixture({
    getPerformance: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      metrics: {
        network_upload: { availability: 'available', current: { availability: 'available', value: 128, unit: 'bytes_per_second', freshness: 'fresh' }, history: { points: [] } },
        network_download: { availability: 'unavailable', current: unavailableSample, history: { points: [] } },
        gpu: { availability: 'unavailable', current: { availability: 'unavailable', value: null, reason: 'GPU collection is deferred in NEXA-DEVICE-NET-002.' }, history: { points: [] } }
      }
    } })
  });
  const performanceFixture = hostFixture('#/device-center?view=performance');
  const performanceSurface = performanceFixture.document.createElement('main');
  const performanceController = ui.createDeviceCenterUiIntegration({ deviceApi: performanceDevice.api, host: performanceFixture.host })
    .mount({ surface: performanceSurface, navigation: performanceFixture.document.createElement('nav') });
  await performanceController.activate();
  const performanceText = textTree(performanceSurface);
  assert.match(performanceText, /网络上传\s+最新\s+128 字节\/秒/);
  assert.match(performanceText, /网络下载\s+不可用\s+网络采样暂不可用/);
  assert.match(performanceText, /GPU\s+不可用\s+GPU 数据暂未采集/);
  assert.doesNotMatch(performanceText, /Network sample pair is unavailable|GPU collection is deferred|NEXA-DEVICE-NET-002/);
  performanceController.unmount();

  const networkDevice = apiFixture({
    getNetwork: () => Promise.resolve({ ok: true, value: {
      availability: 'unavailable',
      total_upload: unavailableSample,
      total_download: unavailableSample,
      domestic_path: { status: 'contract_ready' },
      foreign_path: { status: 'deferred' },
      apex: { runtime: 'available', route_model: 'system_proxy', confidence: 'high', limited_visibility: false }
    } })
  });
  const networkFixture = hostFixture('#/device-center?view=network');
  const networkSurface = networkFixture.document.createElement('main');
  const networkController = ui.createDeviceCenterUiIntegration({ deviceApi: networkDevice.api, host: networkFixture.host })
    .mount({ surface: networkSurface, navigation: networkFixture.document.createElement('nav') });
  await networkController.activate();
  const networkText = textTree(networkSurface);
  assert.equal(ui.projectDeviceValue({ status: 'contract_ready' }, 'zh-CN'), '已就绪');
  assert.match(networkText, /境内路径\s+已就绪/);
  assert.match(networkText, /APEX 状态\s+运行中\s+路由状态：已识别/);
  assert.doesNotMatch(networkText, /contract_ready|Network sample pair is unavailable/);
  networkController.unmount();
});

test('frozen stable unavailable reasons have deterministic Chinese product coverage', async () => {
  const ui = await loadUi();
  const coverage = new Map([
    ['GPU collection is deferred in NEXA-DEVICE-NET-002.', 'GPU 数据暂未采集'],
    ['Network sample pair is unavailable.', '网络采样暂不可用'],
    ['System collector unavailable during snapshot.', '系统数据暂不可用'],
    ['Network collector unavailable during snapshot.', '网络数据暂不可用'],
    ['CPU sample is unavailable.', 'CPU 数据暂不可用'],
    ['RAM sample is unavailable.', '内存数据暂不可用'],
    ['Capability is unavailable.', '此项能力暂不可用'],
    ['Metric unavailable.', '此项指标暂不可用'],
    ['Network interfaces are unavailable.', '网络接口信息暂不可用'],
    ['Windows network collection requires win32.', '当前环境暂不支持网络数据采集']
  ]);

  for (const [rawReason, productCopy] of coverage) {
    const value = { availability: 'unavailable', value: null, reason: rawReason };
    assert.equal(ui.projectDeviceValue(value, 'zh-CN'), productCopy);
    assert.equal(value.availability, 'unavailable');
    assert.equal(value.value, null);
    assert.equal(value.reason, rawReason);
  }

  const metricNames = ['cpu', 'ram', 'gpu', 'gpu_temperature', 'cpu_temperature', 'network_upload', 'network_download', 'temperature', 'network', 'disk'];
  const metrics = Object.fromEntries([...coverage.entries()].map(([reason], index) => [metricNames[index], {
    availability: 'unavailable',
    current: { availability: 'unavailable', value: null, reason },
    history: { points: [] }
  }]));
  const device = apiFixture({
    getPerformance: () => Promise.resolve({ ok: true, value: { availability: 'available', metrics } })
  });
  const fixture = hostFixture('#/device-center?view=performance');
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  const rendered = textTree(surface);
  for (const [rawReason, productCopy] of coverage) {
    assert.match(rendered, new RegExp(productCopy));
    assert.doesNotMatch(rendered, new RegExp(rawReason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal((rendered.match(/不可用|不支持/g) || []).length >= coverage.size, true);
  controller.unmount();
});

test('factory rejects an incomplete Device DTO capability', async () => {
  const ui = await loadUi();
  const { host } = hostFixture();
  assert.throws(() => ui.createDeviceCenterUiIntegration({ deviceApi: {}, host }), /deviceApi\.getOverview/);
});

test('unpaired Android state explains the complete install, permission and secure pairing path', async () => {
  const ui = await loadUi();
  const device = apiFixture();
  const fixture = hostFixture();
  const surface = fixture.document.createElement('main');
  const mobileApi = {
    awareness: async () => ({ ok: true, value: {
      attention: { state: 'NEEDS_ATTENTION', reason: '需要完成手机配对' },
      overview: { connection_state: 'NEEDS_PAIRING' },
      details: { paired: false },
      freshness: {}
    } })
  };
  const controller = ui.createDeviceCenterUiIntegration({
    deviceApi: device.api,
    mobileApi,
    host: fixture.host
  }).mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();

  const rendered = textTree(surface);
  assert.match(rendered, /尚未发现已配对手机/);
  assert.match(rendered, /安装手机端 NEXA/);
  assert.match(rendered, /开启通知使用权/);
  assert.match(rendered, /二维码/);
  assert.match(rendered, /六位 SAS/);
  controller.unmount();
});

test('module creates navigation, styles, route and overview rendering through generic host capabilities', async () => {
  const ui = await loadUi();
  const device = apiFixture();
  const fixture = hostFixture();
  const integration = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host });
  const surface = fixture.document.createElement('main');
  const navigation = fixture.document.createElement('nav');
  const contexts = [];
  const controller = integration.mount({ surface, navigation, onContextChange: value => contexts.push(value) });
  assert.equal(navigation.childNodes.length, 7);
  assert.equal(fixture.document.head.childNodes.length, 1);
  const stylesheet = fixture.document.head.childNodes[0];
  assert.equal(stylesheet.tagName, 'link');
  assert.equal(stylesheet.rel, 'stylesheet');
  assert.equal(stylesheet.href, ui.DEVICE_CENTER_UI_STYLESHEET_URL);
  assert.equal(stylesheet.textContent, '');
  await controller.activate();
  assert.deepEqual(device.calls, [['overview']]);
  assert.match(textTree(surface), /设备中心/);
  assert.match(textTree(surface), /不支持/);
  assert.match(textTree(surface), /当前硬件或驱动未提供该数据/);
  assert.match(textTree(surface), /CPU/);
  assert.match(textTree(surface), /APEX/);
  assert.match(textTree(surface), /最近更新\s+\d{2}:\d{2}/);
  assert.doesNotMatch(textTree(surface), /2026-08-23T10:43:53\.619Z/);
  assert.deepEqual(contexts.at(-1), { title: '概览', status: '只读' });
  assert.equal(controller.getView(), 'overview');
  assert.equal(fixture.routes.at(-1), '#/device-center?view=overview');
  assert.equal(controller.unmount(), true);
  assert.equal(navigation.childNodes.length, 0);
  assert.equal(surface.childNodes.length, 0);
  assert.equal(fixture.document.head.childNodes.length, 0);
});

test('module owns network copy and route-specific DTO selection', async () => {
  const ui = await loadUi();
  const device = apiFixture();
  const fixture = hostFixture('#/device-center?view=network');
  const integration = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host });
  const surface = fixture.document.createElement('main');
  const controller = integration.mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  assert.deepEqual(device.calls, [['network']]);
  assert.match(textTree(surface), /连接活动不等同于字节流量/);
  controller.unmount();
});

test('network view safely projects compact local address cards and exposes the complete bounded list on demand', async () => {
  const ui = await loadUi();
  const device = apiFixture({
    getNetwork: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      local_ip: {
        ipv4: ['192.168.1.8', '172.19.32.1'],
        ipv6: ['2001:db8::1', 'fe80::1', 'fe80::2']
      },
      interfaces: [{ name: 'WLAN', description: 'Wireless adapter', status: 'Up', connection_type: 'wireless' }],
      capability_states: { network: 'READY' },
      public_ip: { availability: 'unavailable', value: null, reason: 'SOURCE_NOT_CONFIGURED' },
      foreign_path: { status: 'deferred' },
      apex: { runtime: 'available', route_model: 'unknown' }
    } })
  });
  const fixture = hostFixture('#/device-center?view=network');
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();

  const ipv6Card = findByText(surface, '本地 IPv6')?.parentNode;
  assert.match(textTree(ipv6Card), /2001:db8:1:…/);
  assert.match(textTree(ipv6Card), /共 3 个地址/);
  assert.doesNotMatch(textTree(ipv6Card), /2001:db8::1|fe80::1|fe80::2/);

  const ipv4Card = findByText(surface, '本地 IPv4')?.parentNode;
  assert.match(textTree(ipv4Card), /192\.168\.\*\.\*/);
  assert.doesNotMatch(textTree(ipv4Card), /192\.168\.1\.8|172\.19\.32\.1/);

  const disclosureSummary = findByText(surface, '全部本机地址 · IPv4 2 · IPv6 3');
  assert.equal(disclosureSummary?.parentNode?.tagName, 'details');
  assert.match(textTree(disclosureSummary.parentNode), /172\.19\.32\.1/);
  assert.match(textTree(disclosureSummary.parentNode), /fe80::2/);
  assert.match(textTree(surface), /已连接/);
  assert.match(textTree(surface), /无线/);
  assert.doesNotMatch(textTree(surface), /\bUp\b|\bwireless\b/);
  controller.unmount();
});

test('network view presents missing allowlisted targets as pending instead of a system error', async () => {
  const ui = await loadUi();
  const device = apiFixture();
  const fixture = hostFixture('#/device-center?view=network');
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  const rendered = textTree(surface);
  assert.match(rendered, /APEX 网络探针/);
  assert.match(rendered, /探针待配置/);
  assert.match(rendered, /这不是系统异常/);
  assert.equal(findByText(surface, '运行轻量检查').disabled, true);
  assert.equal(findByText(surface, '检查线路质量').disabled, true);
  assert.equal(findByText(surface, '开始完整测速').disabled, true);
  assert.equal(device.calls.some(call => call[0] === 'probe'), false);
  controller.unmount();
});

test('configured full speed test crosses the UI boundary only from an explicit click', async () => {
  const ui = await loadUi();
  const device = apiFixture({
    getNetwork: () => Promise.resolve({ ok: true, value: {
      availability: 'available', interfaces: [], foreign_path: { status: 'deferred' },
      apex: { runtime: 'available', route_model: 'system_proxy', confidence: 'high', limited_visibility: false },
      network_probe: {
        status: 'ready', status_label: '可运行', target_status: 'configured',
        targets: [{ target_id: 'approved-fixture', display_name: '获批目标', route: 'domestic', supported_tiers: ['light', 'quality', 'full'], privacy_notice: '合成测试目标。' }],
        tiers: { light: { availability: 'available' }, quality: { availability: 'available' }, full: { availability: 'available', execution_policy: 'user_initiated_only' } }, last_result: null
      }
    } })
  });
  const fixture = hostFixture('#/device-center?view=network');
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  assert.equal(device.calls.some(call => call[0] === 'probe'), false);
  await findByText(surface, '开始完整测速').dispatch('click');
  const request = device.calls.find(call => call[0] === 'probe')?.[1];
  assert.deepEqual(request, { tier: 'full', target_id: 'approved-fixture', user_initiated: true });
  controller.unmount();
});

test('overview truthfully separates APEX runtime, network observation and route recognition', async () => {
  const ui = await loadUi();
  const device = apiFixture();
  const fixture = hostFixture();
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();

  const apexCard = findByText(surface, 'APEX 状态')?.parentNode;
  assert.ok(apexCard);
  assert.match(textTree(apexCard), /运行中/);
  assert.match(textTree(apexCard), /路由状态：未识别/);
  assert.doesNotMatch(textTree(apexCard), /可用/);

  const networkCard = findByText(surface, '网络观测')?.parentNode;
  assert.ok(networkCard);
  assert.match(textTree(networkCard), /可用/);
  assert.doesNotMatch(textTree(surface), /网络\s+不可用\s+网络观测/);
  controller.unmount();
});

test('APEX route recognition requires an authoritative identified route model', async () => {
  const ui = await loadUi();
  const routeModels = ['unknown', 'UNKNOWN', 'unknown_with_strong_evidence', 'UNKNOWN_WITH_STRONG_EVIDENCE', null];
  for (const routeModel of routeModels) {
    const device = apiFixture({
      getOverview: () => Promise.resolve({ ok: true, value: {
        availability: 'available',
        device_health: { status: 'healthy', reason_count: 0 },
        network_availability: 'available',
        apex: { runtime: 'available', route_model: routeModel, confidence: 'low', limited_visibility: true }
      } })
    });
    const fixture = hostFixture();
    const surface = fixture.document.createElement('main');
    const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
      .mount({ surface, navigation: fixture.document.createElement('nav') });
    await controller.activate();
    const apexCard = findByText(surface, 'APEX 状态')?.parentNode;
    assert.match(textTree(apexCard), /运行中/);
    assert.match(textTree(apexCard), /路由状态：未识别/);
    assert.doesNotMatch(textTree(apexCard), /路由状态：已识别/);
    controller.unmount();
  }

  const device = apiFixture({
    getOverview: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      device_health: { status: 'healthy', reason_count: 0 },
      network_availability: 'available',
      apex: { runtime: 'available', route_model: 'system_proxy', confidence: 'high', limited_visibility: false }
    } })
  });
  const fixture = hostFixture();
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  assert.match(textTree(findByText(surface, 'APEX 状态')?.parentNode), /路由状态：已识别/);
  controller.unmount();
});

test('APEX unavailable or unknown runtime never implies an identified route', async () => {
  const ui = await loadUi();
  for (const [runtime, runtimeLabel] of [['unavailable', '未运行'], ['unknown', '未知']]) {
    const device = apiFixture({
      getOverview: () => Promise.resolve({ ok: true, value: {
        availability: 'available',
        device_health: { status: 'healthy', reason_count: 0 },
        network_availability: 'available',
        apex: { runtime, route_model: 'unknown', confidence: 'low', limited_visibility: true }
      } })
    });
    const fixture = hostFixture();
    const surface = fixture.document.createElement('main');
    const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
      .mount({ surface, navigation: fixture.document.createElement('nav') });
    await controller.activate();
    const apexCard = findByText(surface, 'APEX 状态')?.parentNode;
    assert.match(textTree(apexCard), new RegExp(runtimeLabel));
    assert.match(textTree(apexCard), /路由状态：未识别/);
    assert.doesNotMatch(textTree(apexCard), /路由状态：已识别/);
    controller.unmount();
  }
});

test('overview removes engineering contract metadata while diagnostics preserves it', async () => {
  const ui = await loadUi();
  const overviewDevice = apiFixture();
  const overviewFixture = hostFixture();
  const overviewSurface = overviewFixture.document.createElement('main');
  const overviewController = ui.createDeviceCenterUiIntegration({ deviceApi: overviewDevice.api, host: overviewFixture.host })
    .mount({ surface: overviewSurface, navigation: overviewFixture.document.createElement('nav') });
  await overviewController.activate();
  const overviewText = textTree(overviewSurface);
  assert.doesNotMatch(overviewText, /DeviceCenterOverviewDTO|架构版本|数据合同|观测实况/);
  overviewController.unmount();

  const diagnosticDevice = apiFixture();
  const diagnosticFixture = hostFixture('#/device-center?view=diagnostics');
  const diagnosticSurface = diagnosticFixture.document.createElement('main');
  const diagnosticController = ui.createDeviceCenterUiIntegration({ deviceApi: diagnosticDevice.api, host: diagnosticFixture.host })
    .mount({ surface: diagnosticSurface, navigation: diagnosticFixture.document.createElement('nav') });
  await diagnosticController.activate();
  const diagnosticText = textTree(diagnosticSurface);
  assert.match(diagnosticText, /技术信息/);
  assert.match(diagnosticText, /DeviceCenterOverviewDTO V0\.1/);
  assert.match(diagnosticText, /2026-08-23T10:43:53\.619Z/);
  assert.ok(diagnosticDevice.calls.some(call => call[0] === 'overview'));
  diagnosticController.unmount();
});

test('health warning with zero active anomalies receives a truthful explanation', async () => {
  const ui = await loadUi();
  const base = apiFixture();
  const originalOverview = base.api.getOverview;
  base.api.getOverview = async () => {
    const result = await originalOverview();
    return {
      ...result,
      value: {
        ...result.value,
        device_health: { status: 'warning', reason_count: 1 },
        active_anomaly_count: 0
      }
    };
  };
  const fixture = hostFixture();
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: base.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  assert.match(textTree(surface), /健康提示来自当前观测，不等同于已确认的活跃异常/);
  assert.match(textTree(findByText(surface, '活跃异常')?.parentNode), /0/);
  controller.unmount();
});

test('unsupported CPU temperature and deferred application bytes remain explicit without fabricated values', async () => {
  const ui = await loadUi();
  const overviewDevice = apiFixture();
  const overviewFixture = hostFixture();
  const overviewSurface = overviewFixture.document.createElement('main');
  const overviewController = ui.createDeviceCenterUiIntegration({ deviceApi: overviewDevice.api, host: overviewFixture.host })
    .mount({ surface: overviewSurface, navigation: overviewFixture.document.createElement('nav') });
  await overviewController.activate();
  const temperatureCard = findByText(overviewSurface, 'CPU 温度')?.parentNode;
  assert.match(textTree(temperatureCard), /不支持/);
  assert.match(textTree(temperatureCard), /当前硬件或驱动未提供该数据/);
  assert.doesNotMatch(textTree(temperatureCard), /0\s*°C/);
  overviewController.unmount();

  const appDevice = apiFixture();
  const appFixture = hostFixture('#/device-center?view=applications');
  const appSurface = appFixture.document.createElement('main');
  const appController = ui.createDeviceCenterUiIntegration({ deviceApi: appDevice.api, host: appFixture.host })
    .mount({ surface: appSurface, navigation: appFixture.document.createElement('nav') });
  await appController.activate();
  assert.match(textTree(appSurface), /应用流量字节统计不可用/);
  assert.doesNotMatch(textTree(appSurface), /connection count|连接数.*流量/i);
  appController.unmount();
});

test('overview renders computer identity, Windows build, CPU topology and memory capacity', async () => {
  const ui = await loadUi();
  const device = apiFixture({
    getOverview: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      device_health: { status: 'healthy', reason_count: 0 },
      computer_name: { availability: 'available', value: 'DESKTOP-NEXA' },
      windows_version: { availability: 'available', value: 'Windows 11 Pro · 10.0.26100' },
      windows_build: { availability: 'available', value: '26100' },
      cpu: { availability: 'available', value: 25, unit: 'percent', model: 'Fixture CPU' },
      cpu_topology: { availability: 'available', logical_processors: 24, physical_cores: 12 },
      memory_capacity: { availability: 'available', total: { value: 32 * 1024 ** 3, unit: 'bytes' }, used: { value: 10 * 1024 ** 3, unit: 'bytes' }, available: { value: 22 * 1024 ** 3, unit: 'bytes' } },
      ram: { availability: 'available', value: 31.25, unit: 'percent' },
      gpu: { availability: 'available', value: 8, unit: 'percent', model: 'Fixture GPU' },
      gpu_temperature: { availability: 'available', value: 51, unit: 'celsius' },
      cpu_temperature: { availability: 'unsupported', value: null, reason: 'CPU_TEMPERATURE_UNAVAILABLE' },
      network_availability: 'available', interfaces: [], apex: { runtime: 'available', route_model: 'unknown' },
      capability_states: {}, active_anomaly_count: 0, last_updated: '2026-08-23T10:43:53.619Z', overall_freshness: 'fresh'
    } })
  });
  const fixture = hostFixture();
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  const rendered = textTree(surface);
  assert.match(rendered, /DESKTOP-NEXA/);
  assert.match(rendered, /Windows build\s+26100/);
  assert.match(rendered, /12 物理核心 · 24 逻辑处理器/);
  assert.match(rendered, /内存容量\s+32 GB/);
  controller.unmount();
});

test('network renders gateway and DNS presence without configuration values', async () => {
  const ui = await loadUi();
  const device = apiFixture({
    getNetwork: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      interfaces: [{ name: 'Ethernet', description: 'Physical Adapter', status: 'Up', connection_type: 'ethernet', gateway_present: true, dns_present: false }],
      gateway_dns_presence: { gateway: { availability: 'available', value: true }, dns: { availability: 'available', value: false } },
      local_ip: { ipv4: ['192.168.1.8'], ipv6: [] },
      network_probe: { status: 'target_pending', target_status: 'not_configured', targets: [], tiers: {} },
      apex: { runtime: 'available', route_model: 'unknown' }, capability_states: {}
    } })
  });
  const fixture = hostFixture('#/device-center?view=network');
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  const rendered = textTree(surface);
  assert.match(rendered, /网关存在状态\s+已检测/);
  assert.match(rendered, /DNS 存在状态\s+未检测到/);
  assert.match(rendered, /网关：已检测 · DNS：未检测到/);
  assert.equal(rendered.includes('网关：192.168'), false);
  assert.equal(rendered.includes('DNS：8.8.8.8'), false);
  controller.unmount();
});

test('network renders a truthful primary path and physical or virtual adapter classes', async () => {
  const ui = await loadUi();
  const device = apiFixture({
    getNetwork: () => Promise.resolve({ ok: true, value: {
      availability: 'available', observed_at: '2026-08-23T10:43:53.619Z',
      total_upload: { availability: 'available', value: 20, unit: 'bytes_per_second' },
      total_download: { availability: 'available', value: 80, unit: 'bytes_per_second' },
      default_routes: { primary: { interface_name: '以太网 2', adapter_class: 'physical', next_hop_masked: '10.17.*.*', route_metric: 25, operational_status: 'Up', recent_upload_rate: 20, recent_download_rate: 80 } },
      interfaces: [{ name: '以太网 2', description: 'USB Ethernet', status: 'Up', connection_type: 'ethernet', adapter_class: 'physical', recent_upload_rate: 20, recent_download_rate: 80, gateway_present: true, dns_present: true }, { name: 'Radmin VPN', description: 'Radmin', status: 'Up', connection_type: 'ethernet', adapter_class: 'virtual', recent_upload_rate: 1, recent_download_rate: 1, gateway_present: true, dns_present: true }],
      gateway_dns_presence: {}, local_ip: {}, network_probe: { status: 'target_pending', target_status: 'not_configured', targets: [], tiers: {} }, apex: {}, capability_states: {}
    } })
  });
  const fixture = hostFixture('#/device-center?view=network');
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host }).mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  const rendered = textTree(surface);
  assert.match(rendered, /当前主网络路径/);
  assert.match(rendered, /以太网 2/);
  assert.match(rendered, /10\.17\.\*\.\*/);
  assert.match(rendered, /路由 metric\s+25/);
  assert.match(rendered, /Radmin VPN/);
  assert.match(rendered, /虚拟网卡/);
  controller.unmount();
});

test('application rankings preserve distinct ViewModel labels and process-name fallbacks', async () => {
  const ui = await loadUi();
  const device = apiFixture({
    getApplications: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      cpu_top5: [
        { application_id: 'process-name:chrome.exe', label: 'Google Chrome', process_name: 'chrome.exe', value: 18 },
        { application_id: 'process-name:code.exe', process_name: 'Code.exe', value: 9 }
      ],
      ram_top5: [],
      network_top5: { availability: 'unavailable', reason: 'APPLICATION_BYTE_ACCOUNTING_NOT_AVAILABLE', items: [] },
      top_active_connections: { availability: 'available', items: [] }
    } })
  });
  const fixture = hostFixture('#/device-center?view=applications');
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  const rendered = textTree(surface);
  assert.match(rendered, /Google Chrome/);
  assert.match(rendered, /Code\.exe/);
  controller.unmount();
});

test('all seven route identities render Chinese product names without changing route keys', async () => {
  const ui = await loadUi();
  const expected = new Map([
    ['overview', '设备中心'], ['performance', '性能'], ['network', '网络'], ['applications', '应用'],
    ['history', '历史'], ['anomalies', '异常'], ['diagnostics', '诊断']
  ]);
  for (const [view, label] of expected) {
    const device = apiFixture();
    const fixture = hostFixture(`#/device-center?view=${view}`);
    const integration = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host });
    const surface = fixture.document.createElement('main');
    const navigation = fixture.document.createElement('nav');
    const controller = integration.mount({ surface, navigation });
    await controller.activate();
    assert.equal(controller.getView(), view);
    assert.equal(fixture.routes.at(-1), `#/device-center?view=${view}`);
    const rendered = textTree(surface);
    assert.match(rendered, new RegExp(label));
    assert.doesNotMatch(rendered, /\b(?:Overview|Performance|Applications|History|Anomalies|Diagnostics|Available|Unavailable|Unsupported|Deferred|Unknown|Healthy|Dismiss)\b/);
    assert.deepEqual(navigation.childNodes.map(node => node.textContent), ['概览', '性能', '网络', '应用', '历史', '异常', '诊断']);
    controller.unmount();
  }
});

test('generated anomaly and alert copy is presented in Chinese while technical acronyms remain intact', async () => {
  const ui = await loadUi();
  const device = apiFixture({
    getAnomalies: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      active: [{ component: 'cpu', type: 'sustained_high_cpu', severity: 'critical', last_seen: '2026-08-13T00:00:00Z' }],
      recent_resolved: []
    } }),
    getAlerts: () => Promise.resolve({ ok: true, value: {
      availability: 'available',
      items: [{ alert_id: 'alert-1', title: 'Device cpu alert', summary: 'sustained_high_cpu remains active.', delivery_status: 'pending' }]
    } })
  });
  const fixture = hostFixture('#/device-center?view=anomalies');
  const surface = fixture.document.createElement('main');
  const controller = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host })
    .mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  const rendered = textTree(surface);
  assert.match(rendered, /CPU：CPU 持续高占用/);
  assert.match(rendered, /CPU 告警/);
  assert.match(rendered, /此前检测到的CPU 持续高占用告警尚未确认/);
  assert.match(rendered, /不代表当前实时异常仍然存在/);
  assert.doesNotMatch(rendered, /仍为活跃|Device cpu alert|remains active/);
  controller.unmount();
});

test('module-owned navigation switches view state without inline visibility styles', async () => {
  const ui = await loadUi();
  const device = apiFixture();
  const fixture = hostFixture();
  const integration = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host });
  const surface = fixture.document.createElement('main');
  const navigation = fixture.document.createElement('nav');
  const controller = integration.mount({ surface, navigation });
  await controller.activate();
  await navigation.childNodes[2].dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getView(), 'network');
  assert.equal(fixture.routes.at(-1), '#/device-center?view=network');
  assert.ok(device.calls.some(call => call[0] === 'network'));
  assert.equal(navigation.childNodes[2].getAttribute('aria-current'), 'page');
  assert.equal(Object.hasOwn(surface, 'style'), false);
  controller.deactivate();
  assert.equal(controller.unmount(), true);
  assert.equal(surface.className.includes('nexa-device-surface'), false);
});

test('module owns pending-alert dismissal action mapping', async () => {
  const ui = await loadUi();
  const device = apiFixture();
  const fixture = hostFixture('#/device-center?view=anomalies');
  const integration = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host });
  const surface = fixture.document.createElement('main');
  const controller = integration.mount({ surface, navigation: fixture.document.createElement('nav') });
  await controller.activate();
  const dismiss = findByText(surface, '忽略');
  assert.ok(dismiss);
  await dismiss.dispatch('click');
  assert.ok(device.calls.some(call => call[0] === 'dismiss' && call[1] === 'alert-1'));
  controller.unmount();
});

test('UI source has zero Core-specific imports and no cross-module path dependency', () => {
  const source = fs.readFileSync(UI_ENTRY, 'utf8');
  assert.doesNotMatch(source, /01_source|token-monitor|nexaDeviceCenterRenderer|nexaRendererIntegration/);
  assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"](?:node:|electron|\.\.\/\.\.\/)/);
});

test('production UI performs zero inline-style or dynamic style-element writes', () => {
  const source = fs.readFileSync(UI_ENTRY, 'utf8');
  assert.doesNotMatch(source, /\.style(?:\.|\s*=|\[)/);
  assert.doesNotMatch(source, /setAttribute\s*\(\s*['"]style['"]/);
  assert.doesNotMatch(source, /\bcssText\b|style\s*=\s*['"]|<style\b/i);
  assert.doesNotMatch(source, /createElement\s*\(\s*['"]style['"]\s*\)/i);
  assert.doesNotMatch(source, /adoptedStyleSheets|insertRule|replaceSync/);
  assert.doesNotMatch(source, /unsafe-inline/);
});

test('mount uses one same-module external stylesheet link and removes it on unmount', async () => {
  const ui = await loadUi();
  const device = apiFixture();
  const fixture = hostFixture();
  const integration = ui.createDeviceCenterUiIntegration({ deviceApi: device.api, host: fixture.host });
  const controller = integration.mount({
    surface: fixture.document.createElement('main'),
    navigation: fixture.document.createElement('nav')
  });
  assert.match(ui.DEVICE_CENTER_UI_STYLESHEET_URL, /device-center-ui\.css$/);
  assert.equal(new URL(ui.DEVICE_CENTER_UI_STYLESHEET_URL).protocol, 'file:');
  assert.deepEqual(fixture.document.head.childNodes.map(node => node.tagName), ['link']);
  assert.equal(controller.unmount(), true);
  assert.equal(fixture.document.head.childNodes.length, 0);
});

test('UI source performs no collection, persistence, process or network work', () => {
  const source = fs.readFileSync(UI_ENTRY, 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|https:\/\//);
  assert.doesNotMatch(source, /node:child_process|\b(?:spawn|spawnSync|exec|execFile)\s*\(|\.collect(?:Snapshot)?\s*\(|historyStore|writeFile|readFile/);
  assert.doesNotMatch(source, /runObservation|run_observation|executeAction|execute_action/);
});

test('UI stylesheet URL, static CSS and default integration export are module assets', async () => {
  const ui = await loadUi();
  const css = fs.readFileSync(UI_STYLESHEET, 'utf8');
  assert.match(ui.DEVICE_CENTER_UI_STYLESHEET_URL, /device-center-ui\.css$/);
  assert.match(css, /\.nexa-device-surface/);
  assert.match(css, /@media \(max-width: 1199px\)/);
  assert.match(css, /\.nexa-device-subnavigation[^}]*max-width:\s*100%/);
  assert.match(css, /\.nexa-device-subnavigation[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)[^{]*\{[^}]*\.nexa-device-subnavigation[^}]*repeat\(4,/);
  assert.match(css, /\.nexa-device-curve-grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(260px,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 520px\)[^{]*\{[^}]*\.nexa-device-curve-grid,\s*\.nexa-device-top-grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.nexa-device-top-list li > span[^}]*min-width:\s*0[^}]*overflow-wrap:\s*break-word[^}]*word-break:\s*keep-all/);
  assert.match(css, /\.nexa-device-subnavigation button[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.nexa-device-status-value[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.nexa-device-header[^}]*overflow:\s*visible/);
  assert.match(css, /\.nexa-device-surface[^}]*overflow:\s*visible/);
  assert.doesNotMatch(css, /\.nexa-device-surface[^}]*overflow:\s*hidden\s+auto/);
  assert.doesNotMatch(css, /max-height:\s*520px/);
  assert.doesNotMatch(css, /<style\b|style=/i);
  assert.equal(Object.isFrozen(ui.default), true);
});

test('module integration contract assigns content ownership and preserves backend V0.1', () => {
  const contract = fs.readFileSync(UI_CONTRACT, 'utf8');
  assert.match(contract, /MODULE_OWNED_UI_INTEGRATION = READY/);
  assert.match(contract, /createDeviceCenterUiIntegration/);
  assert.match(contract, /Backend Public API：`UNCHANGED \/ 0\.1`/);
  assert.match(contract, /Core-specific imports：`0`/);
});
