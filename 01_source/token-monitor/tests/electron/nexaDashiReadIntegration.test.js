'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DASHI_DESKTOP_ENTRYPOINT,
  DASHI_PUBLIC_API_ENTRYPOINT,
  createNexaAppComposition
} = require('../../src/electron/nexaAppComposition');
const { applyNexaIpcRegistrationPlan } = require('../../src/electron/nexaIpcRegistration');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel)
  };
}

test('Core reaches the real Dashi source only through its authoritative Public Read API', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-dashi-core-smoke-'));
  t.after(() => fs.rmSync(tempDir, { force: true, recursive: true }));
  const composition = await createNexaAppComposition({
    consumptionRepositoryPath: path.join(tempDir, 'consumption.json'),
    todayTomorrowDataRoot: path.join(tempDir, 'today-tomorrow'),
    deviceCenterDataRoot: path.join(tempDir, 'device-center'),
    timezone: 'Asia/Shanghai',
    clock: () => '2026-08-13T08:00:00+08:00'
  });
  const ipcMain = createIpcMain();
  const registration = await applyNexaIpcRegistrationPlan(composition.registrationPlan, ipcMain);
  t.after(async () => {
    await registration.dispose();
    await composition.host.stopAll();
  });

  assert.equal(path.basename(DASHI_DESKTOP_ENTRYPOINT), 'dashi-desktop-entry.mjs');
  assert.equal(DASHI_PUBLIC_API_ENTRYPOINT, DASHI_DESKTOP_ENTRYPOINT);
  assert.equal(path.dirname(DASHI_DESKTOP_ENTRYPOINT), path.join('<TEST_PROJECT_ROOT>', '03_modules', 'Dashi任务板'));

  const health = await ipcMain.handlers.get('nexa:dashi:get-source-health')({});
  const overview = await ipcMain.handlers.get('nexa:dashi:get-board-overview')({});
  const projects = await ipcMain.handlers.get('nexa:dashi:list-projects')({});
  const tasks = await ipcMain.handlers.get('nexa:dashi:list-tasks')({}, {});

  for (const envelope of [health, overview, projects, tasks]) {
    assert.equal(envelope.ok, true);
    assert.equal(envelope.hostStatus, 'ready');
    assert.equal(typeof envelope.value.status, 'string');
  }
  assert.equal(health.value.status, 'SUCCESS');
  assert.equal(health.value.data.connected, true);
  assert.equal(health.value.data.status, 'CONNECTED_STALE');
  assert.equal(overview.value.ok, true);
  assert.equal(projects.value.ok, true);
  assert.equal(tasks.value.ok, true);
  assert.ok(Array.isArray(projects.value.data));
  assert.ok(Array.isArray(tasks.value.data.items));
  assert.equal(JSON.stringify([health, overview, projects, tasks]).includes('E:\\\\'), false);

  if (projects.value.data.length > 0) {
    const project = await ipcMain.handlers.get('nexa:dashi:get-project-detail')(
      {}, projects.value.data[0].id
    );
    assert.equal(project.ok, true);
    assert.equal(project.value.ok, true);
  }
  if (tasks.value.data.items.length > 0) {
    const taskId = tasks.value.data.items[0].identity.task.id;
    const detail = await ipcMain.handlers.get('nexa:dashi:get-task-detail')({}, taskId);
    const context = await ipcMain.handlers.get('nexa:dashi:get-task-execution-context')({}, taskId);
    assert.equal(detail.ok, true);
    assert.equal(context.ok, true);
    assert.equal(detail.value.ok, true);
    assert.equal(context.value.ok, true);
  }
});

test('Dashi Core production code has no SQLite, B deep import, network, write, refresh, or runner path', () => {
  const bridge = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'electron', 'nexaDashiReadBridge.js'),
    'utf8'
  );
  const composition = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'electron', 'nexaAppComposition.js'),
    'utf8'
  );
  const production = `${bridge}\n${composition}`;

  assert.doesNotMatch(production, /node:sqlite|DatabaseSync|source_import|dashi-live-read-binding/i);
  assert.doesNotMatch(bridge, /fetch|WebSocket|EventSource|writeFile|appendFile|refresh|runner|process\.kill|pid/i);
  assert.doesNotMatch(composition, /Dashi任务板[\\/]src|Dashi任务板[\\/]lib/i);
});
