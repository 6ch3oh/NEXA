'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { callLs } = require('../../src/shared/antigravityProbe');

const ROOT = path.join(__dirname, '..', '..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

test('Antigravity language-server requests reject non-loopback hosts before connecting', () => {
  assert.throws(() => callLs({
    scheme: 'https',
    port: 443,
    csrfToken: 'synthetic-test-token',
    method: 'GetUnleashData',
    body: {},
    host: 'remote.example'
  }), /must be loopback/);
});

test('dashboard tooltip helper renders hostile values only through textContent', () => {
  const source = read('src', 'electron', 'renderer', 'dashboard.js');
  const helperStart = source.indexOf('function tooltipElement');
  const helperEnd = source.indexOf('function tooltipRow');
  const tooltipEnd = source.indexOf('let refreshRunning');
  assert.ok(helperStart >= 0 && helperEnd > helperStart && tooltipEnd > helperEnd);

  const helper = vm.runInNewContext(
    `${source.slice(helperStart, helperEnd)}\ntooltipElement;`,
    { document: { createElement: (tagName) => ({ tagName }) } }
  );
  for (const payload of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '&lt;b&gt;', '"quoted"', '<>']) {
    const element = helper('span', 'tt-name', payload);
    assert.equal(element.textContent, payload);
    assert.equal(element.innerHTML, undefined);
  }
  assert.doesNotMatch(source.slice(helperStart, tooltipEnd), /innerHTML/);
  assert.match(source.slice(helperStart, tooltipEnd), /replaceChildren/);
});

test('sync cleanup logging never includes the previous device identifier', () => {
  const source = read('src', 'electron', 'main.js');
  const start = source.indexOf('async function postToHub');
  const end = source.indexOf('\n}', start) + 2;
  const postToHub = source.slice(start, end);
  assert.match(postToHub, /cleanup of previous device identity failed/);
  assert.doesNotMatch(postToHub, /old deviceId|\$\{stale\}/);
});
