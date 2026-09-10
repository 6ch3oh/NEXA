'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MARKET_MODULE_ROOT } = require('../../src/electron/nexaAppComposition');
const { createNexaMarketStdioClient } = require('../../src/electron/nexaMarketStdioClient');

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

test('Core client completes the real Python lifecycle with a UTF-8 Chinese product roundtrip', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-market-core-smoke-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const client = createNexaMarketStdioClient({
    pythonExecutable: 'python',
    moduleRoot: MARKET_MODULE_ROOT,
    requestTimeoutMs: 15_000,
    shutdownTimeoutMs: 3_000,
    killTimeoutMs: 3_000
  });

  const initialized = await client.open({
    data_root: dataRoot,
    timezone: 'Asia/Shanghai',
    runtime_mode: 'EMPTY',
    network_refresh_enabled: false
  });
  const pid = client.getDiagnostics().pid;
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.network_refresh_enabled, false);
  assert.equal(initialized.processing, 'SERIAL_REQUEST_PROCESSING');
  assert.equal(processExists(pid), true);

  const started = await client.request('start', {});
  assert.equal(started.lifecycle, 'READY');
  assert.equal(started.bridge_version, 'nexa.market.desktop-bridge.v0.1');
  assert.equal(started.network_capability.authorized, false);
  const status = await client.request('get_module_status', {});
  assert.equal(status.lifecycle, 'READY');
  assert.equal(status.network_capability.authorized, false);
  const snapshot = await client.request('get_desktop_snapshot', {});
  assert.equal(snapshot.bridge_version, 'nexa.market.desktop-bridge.v0.1');
  assert.equal(snapshot.module_status.lifecycle, 'READY');
  assert.equal(snapshot.module_status.network_capability.authorized, false);
  const home = await client.request('get_market_home', {});
  const visibleHome = JSON.stringify(home);
  assert.match(visibleHome, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(visibleHome, /�|Ã|â(?:€|™)|ï¿½/);

  const shutdown = await client.shutdown();
  assert.equal(shutdown.shutdown, true);
  assert.equal(shutdown.disposed, true);
  assert.equal(shutdown.killFallbackUsed, false);
  assert.equal(client.getDiagnostics().pid, null);
  assert.equal(processExists(pid), false);
});
