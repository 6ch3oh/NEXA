'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  NexaElectronShellBridgeError,
  createEmptyNexaElectronShellBridge
} = require('../../src/electron/nexaShellBridge');

const electronDir = path.join(__dirname, '..', '..', 'src', 'electron');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const functionBoundary = nextName
    ? source.indexOf(`function ${nextName}`, start + 1)
    : source.length;
  const asyncFunctionBoundary = nextName
    ? source.indexOf(`async function ${nextName}`, start + 1)
    : -1;
  const end = asyncFunctionBoundary !== -1 && asyncFunctionBoundary < functionBoundary
    ? asyncFunctionBoundary
    : functionBoundary;
  assert.notEqual(start, -1, `missing function ${name}`);
  assert.notEqual(end, -1, `missing function boundary ${nextName}`);
  return source.slice(start, end);
}

function createMainQuitGateHarness(stopImplementation) {
  const main = fs.readFileSync(path.join(electronDir, 'main.js'), 'utf8');
  const legacyCleanup = functionSource(main, 'runLegacyQuitCleanupOnce', 'requestAppQuit');
  const beforeQuit = functionSource(main, 'handleBeforeQuit', 'writeExportTo');
  const createHarness = new Function('stopImplementation', `
    let quitRequested = false;
    let legacyQuitCleanupComplete = false;
    let nexaShellShutdownApproved = false;
    let nexaShellQuitPromise = null;
    let bridgeStopCalls = 0;
    let appQuitCalls = 0;
    let preventDefaultCalls = 0;
    let notionStopCalls = 0;
    let clearIntervalCalls = 0;
    let shortcutCleanupCalls = 0;
    let legacyStopAllCalls = 0;
    const logs = [];
    function stopNexaShellBridgeSafely() {
      bridgeStopCalls += 1;
      return stopImplementation();
    }
    const notionTodoRuntime = { stop() { notionStopCalls += 1; } };
    const rateRefreshTimer = {};
    const appUpdateBackgroundTimer = {};
    function clearInterval() { clearIntervalCalls += 1; }
    function unregisterWindowToggleShortcut() { shortcutCleanupCalls += 1; }
    function stopAll() { legacyStopAllCalls += 1; }
    const console = { log(message) { logs.push(message); } };
    const app = {
      quit() {
        appQuitCalls += 1;
        handleBeforeQuit({ preventDefault() { preventDefaultCalls += 1; } });
      }
    };
    ${legacyCleanup}
    ${beforeQuit}
    async function settle() {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    }
    return {
      invokeQuit() {
        handleBeforeQuit({ preventDefault() { preventDefaultCalls += 1; } });
      },
      settle,
      snapshot() {
        return {
          appQuitCalls,
          approved: nexaShellShutdownApproved,
          bridgeStopCalls,
          clearIntervalCalls,
          inFlight: Boolean(nexaShellQuitPromise),
          legacyStopAllCalls,
          logs: [...logs],
          notionStopCalls,
          preventDefaultCalls,
          quitRequested,
          shortcutCleanupCalls
        };
      }
    };
  `);
  return createHarness(stopImplementation);
}

test('creates a frozen empty bridge with only start and stop', async () => {
  const bridge = createEmptyNexaElectronShellBridge();

  assert.equal(Object.isFrozen(bridge), true);
  assert.deepEqual(Object.keys(bridge).sort(), ['start', 'stop']);
  assert.equal(Object.prototype.hasOwnProperty.call(bridge, 'host'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bridge, 'registry'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bridge, 'binding'), false);
  await bridge.start();
  await bridge.stop();
});

test('construction and start never perform module startup', async () => {
  let startModuleCalls = 0;
  let stopAllCalls = 0;
  const host = {
    listModuleIds: () => [],
    startModule: () => { startModuleCalls += 1; },
    stopAll: async () => { stopAllCalls += 1; }
  };
  const bridge = createEmptyNexaElectronShellBridge({ host });

  assert.deepEqual(host.listModuleIds(), []);
  assert.equal(startModuleCalls, 0);
  await bridge.start();
  assert.equal(startModuleCalls, 0);
  await bridge.stop();
  assert.equal(stopAllCalls, 1);
});

test('rejects malformed injected hosts', () => {
  for (const host of [null, {}, { stopAll: true }]) {
    assert.throws(
      () => createEmptyNexaElectronShellBridge({ host }),
      (error) => error instanceof NexaElectronShellBridgeError && error.code === 'INVALID_HOST'
    );
  }
});

test('start is idempotent and concurrent calls share initialization', async () => {
  const bridge = createEmptyNexaElectronShellBridge({ host: { stopAll: async () => {} } });

  const first = bridge.start();
  const second = bridge.start();
  assert.strictEqual(first, second);
  await first;
  await bridge.start();
});

test('stop is idempotent and concurrent calls share one host shutdown', async () => {
  const gate = deferred();
  let stopAllCalls = 0;
  const bridge = createEmptyNexaElectronShellBridge({
    host: {
      stopAll() {
        stopAllCalls += 1;
        return gate.promise;
      }
    }
  });
  await bridge.start();

  const first = bridge.stop();
  const second = bridge.stop();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(stopAllCalls, 1);
  gate.resolve('stopped');
  assert.equal(await first, 'stopped');
  await second;
  await bridge.stop();
  assert.equal(stopAllCalls, 1);
});

test('stop preserves host errors and permits a later cleanup retry', async () => {
  const failure = new Error('host cleanup failed');
  let stopAllCalls = 0;
  const bridge = createEmptyNexaElectronShellBridge({
    host: {
      async stopAll() {
        stopAllCalls += 1;
        if (stopAllCalls === 1) throw failure;
      }
    }
  });

  await assert.rejects(bridge.stop(), (error) => error === failure);
  await bridge.stop();
  assert.equal(stopAllCalls, 2);
});

test('successful stop permanently rejects later start', async () => {
  const bridge = createEmptyNexaElectronShellBridge({ host: { stopAll: async () => {} } });
  await bridge.start();
  await bridge.stop();

  await assert.rejects(
    bridge.start(),
    (error) => error instanceof NexaElectronShellBridgeError && error.code === 'BRIDGE_STOPPED'
  );
});

test('default production composition is explicitly empty and has no discovery or IPC', () => {
  const source = fs.readFileSync(path.join(electronDir, 'nexaShellBridge.js'), 'utf8');

  assert.match(source, /createNexaModuleRegistry\(\[\], EMPTY_CONTEXT\)/);
  assert.match(source, /createNexaControllerBinding\(registry, \{\}\)/);
  assert.doesNotMatch(source, /startModule|startAll|ipcMain|ipcRenderer|node:fs|readdir|glob|import\s*\(/i);
  assert.doesNotMatch(source, /expense|provider|device|limits|tray|window/i);
});

test('Main attaches one bridge with isolated startup and a guarded async quit gate', () => {
  const main = fs.readFileSync(path.join(electronDir, 'main.js'), 'utf8');
  const startSafely = functionSource(main, 'startNexaShellBridgeSafely', 'stopNexaShellBridgeSafely');
  const stopSafely = functionSource(main, 'stopNexaShellBridgeSafely', 'runLegacyQuitCleanupOnce');
  const legacyCleanup = functionSource(main, 'runLegacyQuitCleanupOnce', 'requestAppQuit');
  const requestQuit = functionSource(main, 'requestAppQuit', 'handleBeforeQuit');
  const beforeQuit = functionSource(main, 'handleBeforeQuit', 'writeExportTo');
  const ready = main.slice(main.indexOf('app.whenReady().then'), main.indexOf("app.on('second-instance'"));

  assert.match(main, /require\('\.\/nexaShellBridge'\)/);
  assert.match(main, /require\('\.\/nexaAppComposition'\)/);
  assert.equal((main.match(/createEmptyNexaElectronShellBridge\(/g) || []).length, 1);
  assert.match(startSafely, /createNexaAppComposition\(/);
  assert.match(startSafely, /moduleControlPreferences:\s*settings\?\.nexaModuleControl/);
  assert.match(startSafely, /persistModuleControlPreferences:\s*persistNexaModuleControlPreferences/);
  assert.match(main, /nexaModuleControl:\s*\{\s*version:\s*1,\s*modules:\s*\{\}\s*\}/);
  assert.match(main, /function persistNexaModuleControlPreferences[\s\S]*?saveSettings\(\{ throwOnError: true \}\)/);
  assert.match(main, /delete rendererSettings\.nexaModuleControl/);
  assert.match(main, /delete normalizedPatch\.nexaModuleControl/);
  assert.match(startSafely, /createEmptyNexaElectronShellBridge\(\{\s*host:\s*composition\.control\s*\}\)/);
  assert.match(ready, /startNexaShellBridgeSafely\(\);/);
  assert.match(startSafely, /nexaShellBridge\.start\(\)/);
  assert.match(startSafely, /applyNexaIpcRegistrationPlan\(/);
  assert.match(startSafely, /nexaAppComposition\.control\.startAutoModules\(\)/);
  assert.match(startSafely, /nexaAppComposition\.registrationPlan/);
  assert.match(startSafely, /ipcMain/);
  assert.match(startSafely, /console\.log\(/);
  assert.ok(
    stopSafely.indexOf('nexaIpcRegistrationHandle.dispose()') < stopSafely.indexOf('nexaShellBridge.stop()'),
    'NEXA IPC handlers must be removed before the Shell host stops'
  );

  assert.match(main, /app\.on\('before-quit', handleBeforeQuit\)/);
  assert.match(beforeQuit, /event\.preventDefault\(\)/);
  assert.match(beforeQuit, /runLegacyQuitCleanupOnce\(\)/);
  assert.match(beforeQuit, /stopNexaShellBridgeSafely\(\)/);
  assert.ok(
    beforeQuit.indexOf('stopNexaShellBridgeSafely()') < beforeQuit.indexOf('runLegacyQuitCleanupOnce()'),
    'Shell stop must complete before legacy cleanup begins'
  );
  assert.match(beforeQuit, /nexaShellShutdownApproved = true;[\s\S]*app\.quit\(\)/);
  assert.match(beforeQuit, /if \(nexaShellShutdownApproved\) return;/);
  assert.match(beforeQuit, /nexaShellQuitPromise = null/);
  assert.match(beforeQuit, /quitRequested = false/);
  assert.match(beforeQuit, /console\.log\(/);

  assert.match(legacyCleanup, /if \(legacyQuitCleanupComplete\) return;/);
  assert.match(legacyCleanup, /legacyQuitCleanupComplete = true/);
  assert.match(legacyCleanup, /notionTodoRuntime\?\.stop\(\)/);
  assert.match(legacyCleanup, /unregisterWindowToggleShortcut\(\)/);
  assert.match(legacyCleanup, /stopAll\(\)/);
  assert.doesNotMatch(requestQuit, /stopAll|app\.exit|process\.exit/);
  assert.match(requestQuit, /app\.quit\(\)/);

  assert.doesNotMatch(beforeQuit, /app\.exit|process\.exit/);
  assert.doesNotMatch(main, /ipcMain\.(?:handle|on)\('nexa:/);
});

test('Main quit gate cleans legacy resources once only after Shell stop succeeds', async () => {
  const harness = createMainQuitGateHarness(async () => undefined);

  harness.invokeQuit();
  assert.deepEqual(harness.snapshot(), {
    appQuitCalls: 0,
    approved: false,
    bridgeStopCalls: 0,
    clearIntervalCalls: 0,
    inFlight: true,
    legacyStopAllCalls: 0,
    logs: [],
    notionStopCalls: 0,
    preventDefaultCalls: 1,
    quitRequested: true,
    shortcutCleanupCalls: 0
  });
  await harness.settle();
  const completed = harness.snapshot();
  assert.equal(completed.bridgeStopCalls, 1);
  assert.equal(completed.legacyStopAllCalls, 1);
  assert.equal(completed.notionStopCalls, 1);
  assert.equal(completed.clearIntervalCalls, 2);
  assert.equal(completed.shortcutCleanupCalls, 1);
  assert.equal(completed.appQuitCalls, 1);
  assert.equal(completed.approved, true);
  assert.equal(completed.inFlight, false);
  assert.equal(completed.preventDefaultCalls, 1);

  harness.invokeQuit();
  await harness.settle();
  assert.deepEqual(harness.snapshot(), completed);
});

test('Main quit gate preserves legacy runtime on Shell failure and permits retry', async () => {
  const failure = new Error('Shell stop failed');
  let attempts = 0;
  const harness = createMainQuitGateHarness(async () => {
    attempts += 1;
    if (attempts === 1) throw failure;
  });

  harness.invokeQuit();
  await harness.settle();
  const failed = harness.snapshot();
  assert.equal(failed.bridgeStopCalls, 1);
  assert.equal(failed.legacyStopAllCalls, 0);
  assert.equal(failed.notionStopCalls, 0);
  assert.equal(failed.clearIntervalCalls, 0);
  assert.equal(failed.shortcutCleanupCalls, 0);
  assert.equal(failed.appQuitCalls, 0);
  assert.equal(failed.approved, false);
  assert.equal(failed.inFlight, false);
  assert.equal(failed.quitRequested, false);
  assert.equal(failed.logs.length, 1);

  harness.invokeQuit();
  await harness.settle();
  const retried = harness.snapshot();
  assert.equal(retried.bridgeStopCalls, 2);
  assert.equal(retried.legacyStopAllCalls, 1);
  assert.equal(retried.notionStopCalls, 1);
  assert.equal(retried.clearIntervalCalls, 2);
  assert.equal(retried.shortcutCleanupCalls, 1);
  assert.equal(retried.appQuitCalls, 1);
  assert.equal(retried.approved, true);
});

test('Main quit gate coalesces pending quit attempts without early cleanup', async () => {
  const gate = deferred();
  const harness = createMainQuitGateHarness(() => gate.promise);

  harness.invokeQuit();
  harness.invokeQuit();
  await harness.settle();
  const pending = harness.snapshot();
  assert.equal(pending.bridgeStopCalls, 1);
  assert.equal(pending.legacyStopAllCalls, 0);
  assert.equal(pending.notionStopCalls, 0);
  assert.equal(pending.appQuitCalls, 0);
  assert.equal(pending.inFlight, true);

  gate.resolve();
  await harness.settle();
  const completed = harness.snapshot();
  assert.equal(completed.bridgeStopCalls, 1);
  assert.equal(completed.legacyStopAllCalls, 1);
  assert.equal(completed.appQuitCalls, 1);
  assert.equal(completed.inFlight, false);
});
