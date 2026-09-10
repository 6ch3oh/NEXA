'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer');
const renderer = fs.readFileSync(path.join(ROOT, 'nexaConsumptionRenderer.js'), 'utf8');
const integration = fs.readFileSync(path.join(ROOT, 'nexaRendererIntegration.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

function loadApi() {
  const sandbox = { module: { exports: {} }, exports: {}, console };
  vm.runInNewContext(renderer, sandbox, { filename: 'nexaConsumptionRenderer.js' });
  return sandbox.module.exports;
}

test('Consumption owns one dedicated host-composed production surface', () => {
  assert.equal((html.match(/id="nexaConsumptionSurface"/g) || []).length, 1);
  assert.equal((html.match(/src="nexaConsumptionRenderer\.js"/g) || []).length, 1);
  assert.match(integration, /NexaConsumptionRenderer\?\.createRenderer/);
  assert.match(integration, /nextUiModuleId = todayRoute[\s\S]*?consumptionRoute \? 'consumption'/);
  assert.match(integration, /transitionActiveUiModule\(nextUiModuleId\)/);
  assert.match(integration, /previousRenderer\?\.unmount[\s\S]*?'unmount' : 'deactivate'/);
  assert.doesNotMatch(integration, /dedicated business Renderer Surface is not yet integrated/);
  assert.match(css, /\.nexa-consumption-surface\s*\{/);
});

test('renderer consumes only the formal Consumption facade plus safe automatic-import and removal commands', () => {
  assert.match(renderer, /api\.getSnapshot\(\)/);
  assert.match(renderer, /api\.getHomeSummary\(\)/);
  assert.match(renderer, /mobileApi\.awareness\(\{ refresh: false \}\)/);
  assert.match(integration, /mobileApi:\s*api\['mobile-pairing'\]/);
  assert.match(integration, /onOpenDevices:\s*\(\) => navigate\('device-center'\)/);
  assert.match(renderer, /type:\s*'statistics'/);
  assert.match(renderer, /type:\s*'recent'/);
  for (const command of ['list-mobile-drafts', 'auto-import-pending-mobile-drafts', 'update-mobile-draft', 'ignore-mobile-draft', 'merge-mobile-drafts', 'undo-mobile-draft', 'remove-record']) {
    assert.match(renderer, new RegExp(command));
  }
  assert.doesNotMatch(renderer, /confirm-mobile-draft|确认后才会进入消费统计/);
  assert.match(renderer, /wechat:\s*'微信通知'/);
  assert.match(renderer, /alipay:\s*'支付宝通知'/);
  assert.match(renderer, /bank:\s*'银行通知'/);
  assert.match(renderer, /已配对安卓设备识别出的支付摘要会自动计入/);
  assert.match(renderer, /移除该笔记录/);
  assert.match(renderer, /变更历史/);
  assert.doesNotMatch(renderer, /repository|expense-records|dedupe|ingest-candidate|import-legacy|export-legacy|03_modules/i);
  assert.doesNotMatch(renderer, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|require\s*\(/);
});

test('renderer covers loading, ready, empty, error and disabled host recovery', () => {
  for (const state of ['loading', 'empty', 'error']) assert.match(renderer, new RegExp(`['"]${state}['"]`));
  assert.match(integration, /consumptionModule\?\.enabled === true/);
  assert.match(integration, /result\.code === 'MODULE_DISABLED'/);
});

test('utility helpers project only DTO presentation values and safe envelopes', () => {
  const api = loadApi();
  assert.equal(api.formatCents(12345), '¥123.45');
  assert.equal(api.formatCents(undefined), '—');
  assert.equal(api.formatDate('2026-08-23'), '2026年8月23日');
  assert.doesNotMatch(renderer, /`接口 \$\{/);
  assert.deepEqual(api.unwrap({ ok: true, value: { totals: {} } }), { totals: {} });
  assert.throws(() => api.unwrap({ ok: false, error: { code: 'SAFE_ERROR', message: 'failed' } }), (error) => {
    assert.equal(error.code, 'SAFE_ERROR');
    assert.equal(error.message, 'failed');
    return true;
  });
});

test('Mobile awareness distinguishes no device, offline, permission, stale and ready states', () => {
  const api = loadApi();
  assert.equal(api.projectMobileAwareness(null).code, 'STATUS_UNAVAILABLE');
  assert.equal(api.projectMobileAwareness({
    attention: { state: 'UNAVAILABLE', reason: '尚未建立可信手机' },
    overview: { connection_state: 'NEEDS_PAIRING' }
  }).code, 'NO_DEVICE');
  assert.equal(api.projectMobileAwareness({
    attention: { state: 'OFFLINE', reason: '多次安全连接尝试未成功' },
    overview: { connection_state: 'OFFLINE' }
  }).code, 'OFFLINE');
  assert.equal(api.projectMobileAwareness({
    attention: { state: 'NEEDS_ATTENTION', reason: '手机尚未允许通知使用权' },
    overview: { connection_state: 'CONNECTED', capture: '需要允许通知使用权' }
  }).code, 'PERMISSION_REQUIRED');
  assert.equal(api.projectMobileAwareness({
    attention: { state: 'POSSIBLY_STALE', reason: '最近状态已超过正常更新窗口' },
    overview: { connection_state: 'CONNECTED' }
  }).code, 'POSSIBLY_STALE');
  assert.equal(api.projectMobileAwareness({
    attention: { state: 'NORMAL', reason: '手机与同步状态正常' },
    overview: { connection_state: 'CONNECTED', capture: '通知采集正常' }
  }).code, 'READY');
  assert.doesNotMatch(renderer, /notification_body|raw_notification|order_id|account_number/iu);
});
