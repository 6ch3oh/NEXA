'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'src/electron/renderer/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(ROOT, 'src/electron/renderer/nexaDataCenterRenderer.js'), 'utf8');

test('Data Center exposes every truthful Token range and custom dates', () => {
  for (const value of ['today', 'rolling24h', '7d', '30d', '1y', 'all', 'custom']) {
    assert.match(html, new RegExp(`value="${value}"`));
  }
  assert.match(html, /id="nexaTokenStartDate"/);
  assert.match(html, /id="nexaTokenEndDate"/);
  assert.match(renderer, /细粒度区间标记为缺口/);
});

test('Data Center supports type-first inventory and date-first Day Lens without raw content', () => {
  for (const api of ['getDashboardHistory', 'getLocalAiState', 'list-mobile-drafts', 'getDiagnostics', 'listAutomations', 'listDevices', 'getDateSummary', 'getHistory']) {
    assert.match(renderer, new RegExp(api));
  }
  assert.match(html, /id="nexaDayLensDate"/);
  assert.doesNotMatch(renderer, /raw_text|credential|secret/iu);
});

test('Desktop exposes the Mobile update type, verification, confirmation and rollback state', () => {
  assert.match(html, /id="nexaMobileUpdateStatus"/);
  assert.match(html, /可用运行时包 v1/);
  assert.match(html, /SHA-256/);
  assert.match(html, /原生 APK 需要系统\/OEM 确认/);
  assert.match(html, /回滚：上一运行时包已保留/);
});
