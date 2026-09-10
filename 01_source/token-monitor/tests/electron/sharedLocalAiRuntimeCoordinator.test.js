'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSharedLocalAiRuntimeCoordinator, RUNTIME_OWNERSHIP } = require('../../src/electron/sharedLocalAiRuntimeCoordinator');

function coordinatorFixture(runFile) {
  const provider = { healthCheck: async () => ({ ok: true }), getState: () => ({ runtime_state: 'AI_READY' }) };
  return createSharedLocalAiRuntimeCoordinator({
    provider, lmsPath: 'C:\\Bionic\\lms.exe', fileExists: () => true, runFile,
    clock: () => '2026-09-06T19:00:00+08:00', intervalMs: 1000,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {},
  });
}

test('Runtime Coordinator reuses an existing Bionic server and never stops it', async () => {
  const calls = [];
  const runtime = coordinatorFixture(async (_file, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'server') return { stdout: 'The server is running on port 1234.', stderr: '' };
    return { stdout: JSON.stringify([{ identifier: 'qwen3-4b-instruct-2507' }]), stderr: '' };
  });
  const state = await runtime.start();
  assert.equal(state.status, 'READY');
  assert.equal(state.ownership, RUNTIME_OWNERSHIP.EXTERNAL);
  await runtime.stop();
  assert.equal(calls.includes('server stop'), false);
});

test('Runtime Coordinator starts localhost server, loads only the existing contract model, and owns that server', async () => {
  const calls = [];
  const runtime = coordinatorFixture(async (_file, args) => {
    calls.push(args.join(' '));
    if (args.join(' ') === 'server status') return { stdout: 'The server is not running.', stderr: '' };
    if (args.join(' ') === 'ps --json') return { stdout: '[]', stderr: '' };
    if (args.join(' ') === 'ls --json') return { stdout: JSON.stringify([{ modelKey: 'qwen3-4b-instruct-2507' }]), stderr: '' };
    return { stdout: 'ok', stderr: '' };
  });
  const state = await runtime.start();
  assert.equal(state.status, 'READY');
  assert.equal(state.ownership, RUNTIME_OWNERSHIP.NEXA);
  assert.ok(calls.includes('server start --port 1234 --bind 127.0.0.1'));
  assert.ok(calls.includes('load qwen3-4b-instruct-2507 --identifier qwen3-4b-instruct-2507 --yes'));
  await runtime.stop();
  assert.ok(calls.includes('server stop'));
});

test('Runtime Coordinator refuses to load or download when the contract model is not installed', async () => {
  const calls = [];
  const runtime = coordinatorFixture(async (_file, args) => {
    calls.push(args.join(' '));
    if (args.join(' ') === 'server status') return { stdout: 'The server is running on port 1234.', stderr: '' };
    if (args.join(' ') === 'ps --json') return { stdout: '[]', stderr: '' };
    if (args.join(' ') === 'ls --json') return { stdout: JSON.stringify([{ modelKey: 'another-local-model' }]), stderr: '' };
    throw new Error(`unexpected command: ${args.join(' ')}`);
  });
  const state = await runtime.start();
  assert.equal(state.status, 'UNAVAILABLE');
  assert.equal(state.last_reason, 'MODEL_NOT_INSTALLED');
  assert.equal(calls.some((call) => call.startsWith('load ')), false);
  await runtime.stop();
});

test('Runtime Coordinator uses full schema validation at startup and a model-presence probe while ready', async () => {
  const healthOptions = [];
  const provider = {
    healthCheck: async (options) => { healthOptions.push(options); return { ok: true }; },
    getState: () => ({ runtime_state: 'AI_READY' }),
  };
  const runtime = createSharedLocalAiRuntimeCoordinator({
    provider,
    lmsPath: 'C:\\Bionic\\lms.exe',
    fileExists: () => true,
    runFile: async (_file, args) => args[0] === 'server'
      ? { stdout: 'The server is running on port 1234.', stderr: '' }
      : { stdout: JSON.stringify([{ identifier: 'qwen3-4b-instruct-2507' }]), stderr: '' },
    intervalMs: 1000,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });

  await runtime.start();
  await runtime.reconcile('timer');
  assert.deepEqual(healthOptions, [
    { full: true, deep: false },
    { full: false, deep: false },
  ]);
  await runtime.stop();
});
