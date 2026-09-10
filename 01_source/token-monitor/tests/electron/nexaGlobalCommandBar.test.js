'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { unwrapTotal } = require('../../src/electron/renderer/nexaGlobalCommandBar');

const ROOT = path.join(__dirname, '..', '..', 'src', 'electron');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'renderer', 'styles.css'), 'utf8');
const bar = fs.readFileSync(path.join(ROOT, 'renderer', 'nexaGlobalCommandBar.js'), 'utf8');
const integration = fs.readFileSync(path.join(ROOT, 'renderer', 'nexaRendererIntegration.js'), 'utf8');
const rendererApp = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

test('one compact Global Command Bar sits below global navigation and above all business content', () => {
  const navigation = html.indexOf('id="nexaTopNavigation"');
  const commandBar = html.indexOf('id="nexaGlobalCommandBar"');
  const workspace = html.indexOf('id="nexaWorkspace"');
  assert.ok(navigation >= 0 && commandBar > navigation && workspace > commandBar);
  assert.equal((html.match(/id="nexaGlobalCommandInput"/g) || []).length, 1);
  assert.match(html, /placeholder="告诉星枢你想做什么……"/);
  assert.match(html, /Ctrl K/);
  assert.match(css, /\.nexa-global-command-form[\s\S]*box-sizing:\s*border-box/);
  assert.match(css, /\.nexa-global-command-form[\s\S]*height:\s*44px/);
  assert.match(css, /\.nexa-global-command-form[\s\S]*max-width:\s*760px/);
  assert.match(html, /id="nexaGlobalCommandModel"/);
  assert.match(html, /id="nexaGlobalCommandHistory"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="nexaGlobalCommandResult"/);
});

test('renderer wires Ctrl/Cmd+K, current module context, route navigation, and bounded clearable history', () => {
  assert.match(bar, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(bar, /event\.key\.toLocaleLowerCase\(\) === 'k'/);
  assert.match(bar, /history\.slice\(0, 8\)/);
  assert.match(bar, /api\.clearHistory\(\)/);
  assert.match(integration, /CURRENT_MODULE:\s*route\?\.moduleId \|\| snapshot\.activeRoute/);
  assert.match(integration, /globalCommandBar = window\.NexaGlobalCommandBar\.createGlobalCommandBar/);
  assert.match(integration, /onNavigate:\s*\(routeId\) => navigate\(routeId\)/);
  assert.match(integration, /globalCommandBar\?\.setHomeActive\(homeRoute\)/);
  assert.match(integration, /activeRoute !== 'home'\) navigate\('home'\)/);
  assert.match(bar, /if \(panelState === 'history'\)[\s\S]*closeResult\(\)/);
  assert.match(bar, /removeEventListener\('click', handleHistoryClick\)/);
  assert.match(bar, /removeEventListener\('pointerdown', handleDocumentPointerDown\)/);
  assert.match(bar, /api\.selectModel\(modelId\)/);
  assert.match(bar, /PROVIDER_RETRY_MS = 15_000/);
  assert.match(bar, /if \(homeActive\) void refreshProviderState\(\)/);
  assert.match(bar, /scheduleProviderRetry\(\)/);
  assert.match(bar, /cancelProviderRetry\(\)/);
});

test('command failures expose Chinese stage, write state, technical details, and redacted copy feedback', () => {
  for (const value of ['失败环节：', '执行结果待确认', '查看技术详情', '复制脱敏诊断报告']) {
    assert.match(bar, new RegExp(value));
  }
  assert.match(bar, /response\?\.diagnostic_id[\s\S]*api\.reportFeedback\(response\.diagnostic_id, 'rendered'\)/u);
  assert.match(bar, /api\.reportFeedback\(response\.diagnostic_id, 'render_failed'\)/u);
  assert.match(integration, /copyText:\s*window\.tokenMonitor\.copyText/u);
});

test('preload exposes only the fixed global command operations', () => {
  for (const channel of [
    'nexa:global-command:get-state', 'nexa:global-command:get-capabilities', 'nexa:global-command:submit',
    'nexa:global-command:confirm', 'nexa:global-command:cancel', 'nexa:global-command:list-history', 'nexa:global-command:clear-history',
    'nexa:global-command:report-feedback',
  ]) assert.match(preload, new RegExp(channel));
  assert.doesNotMatch(preload, /globalCommand[^\n]*shell|globalCommand[^\n]*file|globalCommand[^\n]*credential/iu);
});

test('mobile navigation focuses Desktop and sends only an allowlisted route envelope', () => {
  assert.match(main, /onNavigation:\s*openNexaRouteFromMobileCommand/);
  assert.match(main, /NEXA_MOBILE_COMMAND_ROUTE_IDS\.has\(normalized\)/);
  assert.match(main, /focusExistingWindow\(\);\s*sendMainWindowEvent\('view:open', Object\.freeze\(\{/s);
  assert.match(main, /source:\s*'mobile-global-command'/);
  assert.match(main, /route_id:\s*normalized/);
  assert.match(rendererApp, /viewId\?\.source === 'mobile-global-command'/);
  assert.match(rendererApp, /button\.dataset\.nexaRoute === routeId/);
  assert.match(rendererApp, /if \(routeButton\) routeButton\.click\(\)/);
  assert.match(rendererApp, /result:\s*applied \? 'APPLIED' : 'NOT_APPLIED'/);
  assert.match(main, /renderer=\$\{mobileResult\} route=\$\{mobileRouteId\}/);
});

test('consumption display derives currency totals only from deterministic adapter output', () => {
  assert.deepEqual(unwrapTotal({ totals: { totalExpenseCents: 3610, count: 3 } }), { amount: 36.1, count: 3 });
  assert.equal(unwrapTotal({ amount: 999999 }), null);
});

test('voice transcript insertion is editable and never submits by itself', () => {
  const { insertTranscript } = require('../../src/electron/renderer/nexaGlobalCommandBar');
  assert.equal(insertTranscript('打开', '设备与网络', 2, 2), '打开 设备与网络');
  assert.equal(insertTranscript('请打开日历', '设备', 3, 5), '请打开 设备');
});
