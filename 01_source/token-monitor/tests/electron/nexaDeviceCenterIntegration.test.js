'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEVICE_CENTER_PUBLIC_API_ENTRYPOINT,
  createNexaAppComposition,
  loadDeviceCenterApplication,
  validateDeviceCenterPublicApi
} = require('../../src/electron/nexaAppComposition');
const { applyNexaIpcRegistrationPlan } = require('../../src/electron/nexaIpcRegistration');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function applicationFixture() {
  const calls = { start: 0, shutdown: 0, reads: [], delivered: [], dismissed: [] };
  let timerCount = 0;
  const read = (name, value) => async (options) => {
    calls.reads.push([name, options]);
    return structuredClone(value);
  };
  const application = Object.freeze({
    async start() { calls.start += 1; timerCount = 3; return calls.start === 1; },
    async shutdown() { calls.shutdown += 1; timerCount = 0; return true; },
    async restart() { timerCount = 3; return true; },
    getStatus() { return { state: timerCount ? 'running' : 'stopped', runtime: { timer_count: timerCount } }; },
    getDashboardSnapshot: read('dashboard', { bounded: true, availability: 'available' }),
    getOverview: read('overview', { availability: 'available', device_health: { severity: 'normal' } }),
    getPerformance: read('performance', { availability: 'available', metrics: {} }),
    getNetwork: read('network', { availability: 'partial', foreign_path: { status: 'deferred' } }),
    runNetworkProbe: read('network-probe', { status: 'completed' }),
    getApplications: read('applications', { availability: 'available', network_top5: { availability: 'unavailable', items: [] } }),
    getApplicationDetail: read('application-detail', { availability: 'available' }),
    getHistory: read('history', { availability: 'available', metrics: {} }),
    getAnomalies: read('anomalies', { availability: 'available', active: [], recent_resolved: [] }),
    getAlerts: read('alerts', { availability: 'available', items: [] }),
    getDiagnostics: read('diagnostics', { status: 'healthy', components: [] }),
    getRecovery: read('recovery', { overall_state: 'healthy' }),
    async ackAlertDelivered(id) { calls.delivered.push(id); return { status: 'delivered', id }; },
    async ackAlertDismissed(id) { calls.dismissed.push(id); return { status: 'dismissed', id }; }
  });
  return { application, calls, timerCount: () => timerCount };
}

function ipcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); }
  };
}

async function compositionFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-device-center-core-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const device = applicationFixture();
  const composition = await createNexaAppComposition({
    consumptionRepositoryPath: path.join(root, 'consumption', 'records.json'),
    todayTomorrowDataRoot: path.join(root, 'today-tomorrow'),
    deviceCenterDataRoot: path.join(root, 'device-center'),
    timezone: 'Asia/Shanghai',
    clock: () => '2026-08-14T08:00:00+08:00',
    deviceCenterApplication: device.application
  });
  const electronIpc = ipcMain();
  const registration = await applyNexaIpcRegistrationPlan(composition.registrationPlan, electronIpc);
  t.after(async () => {
    await registration.dispose();
    await composition.host.stopAll();
  });
  return { ...device, composition, electronIpc };
}

test('authoritative Device Center entrypoint is absolute public-api.mjs', () => {
  assert.equal(path.isAbsolute(DEVICE_CENTER_PUBLIC_API_ENTRYPOINT), true);
  assert.equal(path.basename(DEVICE_CENTER_PUBLIC_API_ENTRYPOINT), 'public-api.mjs');
  assert.equal(path.basename(path.dirname(DEVICE_CENTER_PUBLIC_API_ENTRYPOINT)), 'src');
});
test('authoritative entrypoint resolves only to the Device Center module', () => assert.match(DEVICE_CENTER_PUBLIC_API_ENTRYPOINT, /03_modules[\\/]设备与网络[\\/]src[\\/]public-api\.mjs$/));
test('Public API validator accepts V0.1 and its factory', () => assert.doesNotThrow(() => validateDeviceCenterPublicApi({ DEVICE_CENTER_PUBLIC_API_VERSION: '0.1', createDeviceCenterApplication() {} })));
test('Public API validator rejects version drift', () => assert.throws(() => validateDeviceCenterPublicApi({ DEVICE_CENTER_PUBLIC_API_VERSION: '0.2', createDeviceCenterApplication() {} }), /V0\.1/));
test('Public API validator rejects a missing factory', () => assert.throws(() => validateDeviceCenterPublicApi({ DEVICE_CENTER_PUBLIC_API_VERSION: '0.1' }), /V0\.1/));

test('loader creates exactly one application with the Core-owned dataRoot', async () => {
  const device = applicationFixture();
  const root = path.join(os.tmpdir(), 'nexa-device-loader');
  const seen = [];
  const loader = { async load(entrypoint) {
    seen.push(entrypoint);
    return { DEVICE_CENTER_PUBLIC_API_VERSION: '0.1', createDeviceCenterApplication(options) { seen.push(options); return device.application; } };
  } };
  const result = await loadDeviceCenterApplication(loader, root);
  assert.equal(result.application, device.application);
  assert.deepEqual(seen, [DEVICE_CENTER_PUBLIC_API_ENTRYPOINT, { dataRoot: root }]);
  assert.deepEqual(result.status, { ready: true, code: 'READY', publicApiVersion: '0.1' });
});
test('loader failure is fail-soft and creates no timer', async () => {
  const result = await loadDeviceCenterApplication({ load: async () => { throw new Error('private path'); } }, path.join(os.tmpdir(), 'nexa-device-loader'));
  assert.equal(result.status.ready, false);
  assert.equal(result.application.getStatus().runtime.timer_count, 0);
});
test('invalid Public API is fail-soft', async () => {
  const result = await loadDeviceCenterApplication({ load: async () => ({ DEVICE_CENTER_PUBLIC_API_VERSION: '9' }) }, path.join(os.tmpdir(), 'nexa-device-loader'));
  assert.equal(result.status.code, 'INVALID_DEVICE_CENTER_PUBLIC_API');
});
test('factory failure is fail-soft and hides the raw cause', async () => {
  const result = await loadDeviceCenterApplication({ load: async () => ({ DEVICE_CENTER_PUBLIC_API_VERSION: '0.1', createDeviceCenterApplication() { throw new Error('C:\\private\\state'); } }) }, path.join(os.tmpdir(), 'nexa-device-loader'));
  assert.doesNotMatch(JSON.stringify(result.status), /private|state/i);
});

test('production composition registers Device Center once', async (t) => {
  const value = await compositionFixture(t);
  assert.equal(value.composition.host.listModuleIds().filter(id => id === 'device-center').length, 1);
  assert.equal(value.composition.control.getSnapshot().modules.filter(item => item.moduleId === 'device-center').length, 1);
});
test('composition exposes a safe READY handoff status', async (t) => assert.deepEqual((await compositionFixture(t)).composition.deviceCenterStatus, { ready: true, code: 'READY', publicApiVersion: '0.1' }));
test('first Device Center read starts one resident application', async (t) => {
  const value = await compositionFixture(t);
  const response = await value.electronIpc.handlers.get('nexa:device-center:get-overview')({});
  assert.equal(response.ok, true);
  assert.equal(value.calls.start, 1);
  assert.equal(value.timerCount(), 3);
});
test('concurrent reads do not duplicate the application lifecycle', async (t) => {
  const value = await compositionFixture(t);
  await Promise.all([
    value.electronIpc.handlers.get('nexa:device-center:get-overview')({}),
    value.electronIpc.handlers.get('nexa:device-center:get-network')({}),
    value.electronIpc.handlers.get('nexa:device-center:get-history')({}, { window: 'one_day' })
  ]);
  assert.equal(value.calls.start, 1);
});
test('renderer reload semantics keep the same resident application', async (t) => {
  const value = await compositionFixture(t);
  const read = value.electronIpc.handlers.get('nexa:device-center:get-dashboard');
  await read({ sender: { id: 1 } });
  await read({ sender: { id: 2 } });
  assert.equal(value.calls.start, 1);
  assert.equal(value.calls.reads.filter(([name]) => name === 'dashboard').length, 2);
});
test('history options cross production IPC without refresh', async (t) => {
  const value = await compositionFixture(t);
  await value.electronIpc.handlers.get('nexa:device-center:get-history')({}, { window: 'one_day' });
  assert.deepEqual(value.calls.reads.at(-1), ['history', { window: 'one_day' }]);
});
test('Alert Outbox delivered acknowledgement reaches only the application method', async (t) => {
  const value = await compositionFixture(t);
  await value.electronIpc.handlers.get('nexa:device-center:ack-alert-delivered')({}, 'alert-1');
  assert.deepEqual(value.calls.delivered, ['alert-1']);
});
test('Alert Outbox dismissed acknowledgement reaches only the application method', async (t) => {
  const value = await compositionFixture(t);
  await value.electronIpc.handlers.get('nexa:device-center:ack-alert-dismissed')({}, 'alert-2');
  assert.deepEqual(value.calls.dismissed, ['alert-2']);
});
test('host stop clears all resident Device Center timers', async (t) => {
  const value = await compositionFixture(t);
  await value.electronIpc.handlers.get('nexa:device-center:get-overview')({});
  await value.composition.host.stopAll();
  assert.equal(value.calls.shutdown, 1);
  assert.equal(value.timerCount(), 0);
});
test('composition never deep-imports Device Center internals', () => {
  const compositionSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/electron/nexaAppComposition.js'), 'utf8');
  assert.doesNotMatch(compositionSource, /设备与网络[\\/](?:src[\\/])?(?:index|deviceCenterApplication|runtime|collector)/);
});
test('main owns a stable userData Device Center root', () => {
  const main = fs.readFileSync(path.join(PROJECT_ROOT, 'src/electron/main.js'), 'utf8');
  assert.match(main, /deviceCenterDataRoot:\s*path\.join\([\s\S]*?app\.getPath\('userData'\)[\s\S]*?'nexa'[\s\S]*?'device-center'/);
});
test('main does not place Device Center state under source or temp', () => {
  const main = fs.readFileSync(path.join(PROJECT_ROOT, 'src/electron/main.js'), 'utf8');
  const start = main.indexOf('deviceCenterDataRoot:');
  const snippet = main.slice(start, start + 180);
  assert.doesNotMatch(snippet, /__dirname|tmpdir|01_source/);
});
