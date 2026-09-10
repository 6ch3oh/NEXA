'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const renderer = require('../../src/electron/renderer/nexaDeviceCenterRenderer');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src/electron/renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src/electron/renderer/styles.css'), 'utf8');
const integration = fs.readFileSync(path.join(PROJECT_ROOT, 'src/electron/renderer/nexaRendererIntegration.js'), 'utf8');
const source = fs.readFileSync(path.join(PROJECT_ROOT, 'src/electron/renderer/nexaDeviceCenterRenderer.js'), 'utf8');

test('freezes the seven authoritative product views', () => {
  assert.equal(Object.isFrozen(renderer.VIEWS), true);
  assert.deepEqual(renderer.VIEWS, [
    'overview', 'performance', 'network', 'applications', 'history', 'anomalies', 'diagnostics'
  ]);
});

for (const view of renderer.VIEWS) {
  test(`${view} route parses deterministically`, () => {
    assert.equal(renderer.parseRoute(`#/device-center?view=${view}`), view);
  });
  test(`${view} route serializes through the bounded route`, () => {
    assert.equal(renderer.routeHash(view), `#/device-center?view=${view}`);
  });
}

test('unknown route falls back to overview', () => assert.equal(renderer.parseRoute('#/device-center?view=secret'), 'overview'));
test('foreign route falls back to overview', () => assert.equal(renderer.parseRoute('#/dashi?view=tasks'), 'overview'));
test('unknown route serialization falls back to overview', () => assert.equal(renderer.routeHash('secret'), '#/device-center?view=overview'));
test('query decoding does not allow a second path segment', () => assert.equal(renderer.parseRoute('#/device-center/secret?view=network'), 'network'));

for (const [value, expected] of [
  ['healthy', 'healthy'], ['fresh', 'healthy'], ['degraded', 'warning'],
  ['deferred', 'warning'], ['critical', 'critical'], ['failed', 'critical'], ['other', 'neutral']
]) {
  test(`${value} maps to ${expected} visual truth`, () => assert.equal(renderer.tone(value), expected));
}

test('projection preserves zero', () => assert.equal(renderer.projectionText({ value: 0, unit: 'percent' }), '0 percent'));
test('projection preserves false', () => assert.equal(renderer.projectionText(false), 'false'));
test('projection preserves unknown', () => assert.equal(renderer.projectionText({ availability: 'unknown', reason: 'ROUTE_UNKNOWN' }), 'ROUTE UNKNOWN'));
test('projection preserves deferred', () => assert.equal(renderer.projectionText({ availability: 'deferred', reason: 'FOREIGN_PATH_DEFERRED' }), 'FOREIGN PATH DEFERRED'));
test('projection preserves unsupported', () => assert.equal(renderer.projectionText({ availability: 'unsupported', reason: 'CPU_TEMPERATURE_UNAVAILABLE' }), 'CPU TEMPERATURE UNAVAILABLE'));
test('projection does not turn an empty list into zero', () => assert.equal(renderer.projectionText([]), 'None'));
test('projection labels status without boolean coercion', () => assert.equal(renderer.projectionText({ status: 'action_required' }), 'Action Required'));
test('missing projection stays unavailable', () => assert.equal(renderer.projectionText(undefined), 'Unavailable'));
test('field labels are stable and human-readable', () => assert.equal(renderer.labelFor('active_connection_count'), 'Active Connection Count'));
test('invalid date is unavailable', () => assert.equal(renderer.formatDateTime('not-a-date'), 'Unavailable'));
test('invalid number is unavailable', () => assert.equal(renderer.formatNumber(Number.NaN), 'Unavailable'));

test('legacy renderer remains testable while production selects the module-owned host', () => {
  assert.equal((html.match(/id="nexaDeviceCenterSurface"/g) || []).length, 1);
  assert.equal((html.match(/src="nexaDeviceCenterRenderer\.js"/g) || []).length, 0);
  assert.equal((html.match(/src="nexaDeviceCenterUiIntegrationHost\.js"/g) || []).length, 1);
  assert.match(integration, /NexaDeviceCenterUiIntegrationHost\?\.createRenderer/);
  assert.doesNotMatch(integration, /NexaDeviceCenterRenderer\?\.createRenderer/);
});
test('Device Center has a dedicated accessible L2 navigation', () => assert.match(html, /id="nexaDeviceCenterSubNavigation"[^>]+aria-label="设备与网络视图"/));
test('renderer integration recognizes the Device Center hash', () => assert.match(integration, /startsWith\('#\/device-center'\)/));
test('renderer integration demand-activates the Device Center surface', () => assert.match(
  integration,
  /deviceRoute \? 'device-center'[\s\S]*?transitionActiveUiModule\(nextUiModuleId\)/
));
test('renderer integration deactivates the surface on route exit', () => assert.match(
  integration,
  /previousRenderer\?\.unmount[\s\S]*?'unmount' : 'deactivate'/
));
test('Device Center owns no independent drawer', () => assert.doesNotMatch(html, /nexaDeviceCenterDrawer/));
test('product surface hides legacy panels through the existing shell class', () => assert.match(
  integration,
  /genericRoute \|\| automationCenterRoute \|\| consumptionRoute \|\| todayRoute \|\| dashiRoute \|\|\s*deviceRoute \|\| creatorOpsRoute/
));
test('product surface is responsive below 1200px', () => assert.match(css, /@media \(max-width: 1199px\)[\s\S]*?\.nexa-device-surface/));
test('product cards collapse on compact windows', () => assert.match(css, /\.nexa-device-card-grid[^}]*grid-template-columns:\s*1fr/));
test('history curves have an accessible SVG label', () => assert.match(source, /aria-label', 'Observed history curve'/));
test('network semantics explicitly reject byte inference', () => assert.match(source, /Connection activity is not byte traffic/));
test('Windows notification deferral is explicit', () => assert.match(source, /Windows notification delivery is deferred/));
test('renderer never imports filesystem or child process APIs', () => assert.doesNotMatch(source, /node:(?:fs|path|child_process)|require\(['"]electron/));
test('renderer performs no network request', () => assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|https:\/\//));
test('renderer performs no collector refresh', () => assert.doesNotMatch(source, /\.refresh\s*\(|runObservation|run_observation/));
test('renderer exposes no dangerous recovery action', () => assert.doesNotMatch(source, /delete_history|reset_store|reconfigure/));
test('renderer only acknowledges the bounded dismissed alert action', () => {
  assert.match(source, /ackAlertDismissed/);
  assert.doesNotMatch(source, /executeAction|execute_action/);
});
test('public renderer API is frozen', () => assert.equal(Object.isFrozen(renderer), true));
