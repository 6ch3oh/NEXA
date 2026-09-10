'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainPath = path.join(__dirname, '..', '..', 'src', 'electron', 'main.js');

test('NEXA IPC registration finishes before the first renderer window is created', () => {
  const source = fs.readFileSync(mainPath, 'utf8');
  const readyStart = source.indexOf('app.whenReady().then(');
  const readyEnd = source.indexOf("app.on('second-instance'", readyStart);
  assert.notEqual(readyStart, -1);
  assert.notEqual(readyEnd, -1);

  const readyLifecycle = source.slice(readyStart, readyEnd);
  assert.match(readyLifecycle, /app\.whenReady\(\)\.then\(async \(\) =>/);

  const registration = readyLifecycle.indexOf('await startNexaShellBridgeSafely();');
  const firstWindow = readyLifecycle.indexOf('createWindow();');
  assert.ok(registration >= 0, 'NEXA startup must be awaited in app.whenReady');
  assert.ok(firstWindow >= 0, 'the initial renderer window must still be created');
  assert.ok(registration < firstWindow, 'IPC registration must precede renderer loading');
  assert.equal(
    (readyLifecycle.match(/startNexaShellBridgeSafely\(\)/g) || []).length,
    1,
    'the startup lifecycle must not schedule a second unawaited NEXA registration'
  );
});

test('pending Mobile expense events replay after the durable store opens and before the HTTPS listener starts', () => {
  const source = fs.readFileSync(mainPath, 'utf8');
  const readyStart = source.indexOf('app.whenReady().then(');
  const readyEnd = source.indexOf("app.on('second-instance'", readyStart);
  const embeddedHubStart = source.indexOf('async function startEmbeddedHub()');
  const embeddedHubEnd = source.indexOf('async function stopEmbeddedHub()', embeddedHubStart);
  const shellStart = source.indexOf('function startNexaShellBridgeSafely()');
  const shellEnd = source.indexOf('async function stopNexaShellBridgeSafely()', shellStart);
  assert.notEqual(embeddedHubStart, -1);
  assert.notEqual(embeddedHubEnd, -1);
  assert.notEqual(shellStart, -1);
  assert.notEqual(shellEnd, -1);
  assert.notEqual(readyStart, -1);
  assert.notEqual(readyEnd, -1);

  const readyLifecycle = source.slice(readyStart, readyEnd);
  const embeddedHubLifecycle = source.slice(embeddedHubStart, embeddedHubEnd);
  const shellLifecycle = source.slice(shellStart, shellEnd);
  const storeCreation = embeddedHubLifecycle.indexOf(
    'const mobileSyncStore = createMobileSyncStore({ filePath: mobileSyncDataFile() });'
  );
  const replay = embeddedHubLifecycle.indexOf(
    'await replayPendingMobileExpenseBusinessEvents(mobileSyncStore);'
  );
  const listenerStart = embeddedHubLifecycle.indexOf('await hub.start();');
  const compositionStartup = readyLifecycle.indexOf('await startNexaShellBridgeSafely();');
  const modeStartup = readyLifecycle.indexOf('startMode();');

  assert.ok(compositionStartup >= 0, 'composition startup must run in app.whenReady');
  assert.ok(modeStartup > compositionStartup, 'host mode must start after composition startup finishes');
  assert.ok(storeCreation >= 0, 'the durable Mobile Sync Store must be opened');
  assert.ok(replay > storeCreation, 'pending business events must replay from the opened store');
  assert.ok(listenerStart > replay, 'pending events must replay before accepting new Mobile requests');
  assert.doesNotMatch(
    shellLifecycle,
    /replayPendingMobileExpenseBusinessEvents/,
    'shell startup runs before host-mode store creation and must not consume the only replay attempt'
  );
});
