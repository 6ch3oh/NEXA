'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererPath = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer', 'nexaMobilePairingRenderer.js');
const htmlPath = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer', 'index.html');
const cssPath = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer', 'styles.css');

test('desktop settings exposes the complete Mobile Pairing surface and loads its renderer', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const id of [
    'mobilePairingStart', 'mobilePairingCancel', 'mobilePairingQr', 'mobilePairingCountdown',
    'mobilePairingFingerprint', 'mobilePairingDevice', 'mobilePairingSas', 'mobilePairingAllow',
    'mobilePairingReject', 'mobilePairingDeviceList', 'mobilePairingRotateCertificate'
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<script src="nexaMobilePairingRenderer\.js"><\/script>/);
  assert.match(html, /class="settings-note hub-warning"[\s\S]*?<\/p>\s*<\/div>\s*<section id="mobilePairingPanel"/);
  assert.match(html, /二维码仅用于首次建立可信设备关系/);
  assert.match(html, /width="372" height="372"/);
});

test('renderer makes default-user pairing visible and activates the existing Host runtime on Start', () => {
  const source = fs.readFileSync(rendererPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(source, /data:image\/svg\+xml;base64,/);
  assert.match(source, /removeAttribute\('src'\)/);
  assert.match(source, /getSettings\(\)[\s\S]*?hubMode !== 'host'/);
  assert.match(source, /updateSettings\(\{ hubMode: 'host' \}\)/);
  assert.match(source, /renderCertificate\(await ensurePairingRuntime\(\)\)[\s\S]*?api\.start\(\)/);
  assert.match(source, /已有可信设备在Hub启动后会自动重连/);
  assert.match(source, /正在寻找已配对手机/);
  assert.match(source, /网络发生变化，正在重新寻找/);
  assert.match(source, /手机离线/);
  assert.match(source, /new Intl\.DateTimeFormat\('zh-CN'/);
  assert.match(source, /localizedDateTime\(device\.paired_at, '未知时间'\)/);
  assert.match(source, /localizedDateTime\(device\.last_authenticated_at, '刚刚'\)/);
  assert.match(source, /localizedDateTime\(info\.expires_at, '未知时间'\)/);
  assert.doesNotMatch(source, /\$\{device\.(?:paired_at|last_authenticated_at)\s*\|\|/);
  assert.doesNotMatch(source, /certificateExpiry\.textContent\s*=\s*`\$\{info\.expires_at\}/);
  assert.match(source, /需要重新配对/);
  assert.match(source, /nexa\.mobile-pairing\.repair-required\.v1/);
  assert.match(source, /自动选择安全局域网连接/);
  assert.match(source, /recommended_render_pixels/);
  assert.match(source, /renderPixels === moduleCount \* 4/);
  assert.doesNotMatch(source, /https:\/\/\$\{session\.endpoint\.host\}/);
  assert.match(css, /--mobile-pairing-qr-size:\s*372px/);
  assert.match(css, /\.mobile-pairing-qr img\s*\{[^}]*width:\s*var\(--mobile-pairing-qr-size\);[^}]*height:\s*var\(--mobile-pairing-qr-size\);/);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(css, /\.mobile-pairing-qr\.hidden,[\s\S]*?\.mobile-pairing-claim\.hidden\s*\{\s*display:\s*none/);
  assert.doesNotMatch(source, /innerHTML/);
  assert.doesNotMatch(source, /credentialIssuer|privateKey|credentialStore|device_credential/);
});

test('normal settings projects certificate trust without rendering the full fingerprint', () => {
  const source = fs.readFileSync(rendererPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /<span>证书信任<\/span><code id="mobilePairingFingerprint">/);
  assert.match(source, /fingerprint\.textContent = info \? '已配置' : '未配置'/);
  assert.doesNotMatch(source, /fingerprint\.textContent\s*=\s*info\.fingerprint_display/);
  assert.doesNotMatch(source, /certificate_fingerprint_sha256\.match/);
});

test('trusted-device summary uses the same current connection projection as My Phone', () => {
  const source = fs.readFileSync(rendererPath, 'utf8');
  assert.match(source, /latestAwarenessDeviceId = overview\.mobile_identity/);
  assert.match(source, /latestAwarenessConnectionState = overview\.connection_state/);
  assert.match(source, /function isLatestAwarenessDevice\(device\)/);
  assert.match(source, /device\?\.device_id_summary === summary/);
  assert.match(source, /const connectionState = isLatestAwarenessDevice\(device\)/);
  assert.match(source, /renderAwareness\(await api\.awareness\(\{ refresh \}\)\);\s*await refreshDevices\(\);/);
});

test('normal awareness actions do not expose raw IPC or Control errors', () => {
  const source = fs.readFileSync(rendererPath, 'utf8');
  const actionSource = source.slice(
    source.indexOf('async function runAwarenessAction'),
    source.indexOf('function clearTimer')
  );
  assert.doesNotMatch(actionSource, /setMessage\(error\?\.message/);
  assert.match(actionSource, /正在完成上一项安全请求，请稍后重试/);
  assert.match(actionSource, /手机暂未响应，请确认 NEXA Mobile 正在运行后重试/);
  assert.match(actionSource, /操作暂不可用，请稍后重试/);
});

test('desktop diagnostics renders ledger reconciliation metadata without notification content', () => {
  const source = fs.readFileSync(rendererPath, 'utf8');
  assert.match(source, /账本对账/);
  assert.match(source, /手机账本/);
  assert.match(source, /账本头序号/);
  assert.match(source, /电脑最新接收/);
  assert.match(source, /mobile_latest_fingerprint_prefix/);
  assert.doesNotMatch(source, /notification_(?:body|title|text)/);
});
