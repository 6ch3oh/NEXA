'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const RUNTIME_OWNERSHIP = Object.freeze({
  EXTERNAL: 'EXTERNAL_EXISTING_INSTANCE',
  NEXA: 'NEXA_STARTED_INSTANCE',
});
const COORDINATOR_STATES = Object.freeze({
  STOPPED: 'STOPPED', STARTING: 'STARTING', READY: 'READY', UNAVAILABLE: 'UNAVAILABLE',
});
const DEFAULT_RECONCILE_INTERVAL_MS = 15_000;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function safeCode(value, fallback = 'RUNTIME_UNAVAILABLE') {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) ? value : fallback;
}
function defaultLmsPath() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return '';
  return path.join(process.env.LOCALAPPDATA, 'Programs', 'Bionic', 'resources', 'app', '.webpack-bionic', 'lms.exe');
}
function defaultRunFile(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      windowsHide: true,
      timeout: options.timeoutMs || 120_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(Object.freeze({ stdout: String(stdout || ''), stderr: String(stderr || '') }));
    });
  });
}
function serverIsRunning(output) {
  return /server is running on port\s+1234/iu.test(String(output || ''));
}
function loadedModelPresent(output, modelId) {
  try {
    const rows = JSON.parse(String(output || ''));
    return Array.isArray(rows) && rows.some((row) => row?.identifier === modelId || row?.modelKey === modelId);
  } catch { return false; }
}
function installedModelPresent(output, modelId) {
  try {
    const payload = JSON.parse(String(output || ''));
    const pending = [payload];
    while (pending.length > 0) {
      const value = pending.pop();
      if (Array.isArray(value)) {
        pending.push(...value);
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      if ([value.identifier, value.modelKey, value.model_key, value.id, value.name]
        .some((candidate) => candidate === modelId)) return true;
      pending.push(...Object.values(value));
    }
    return false;
  } catch { return false; }
}

function createSharedLocalAiRuntimeCoordinator({
  provider,
  lmsPath = defaultLmsPath(),
  fileExists = fs.existsSync,
  runFile = defaultRunFile,
  clock = () => new Date().toISOString(),
  intervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  modelId = 'qwen3-4b-instruct-2507',
} = {}) {
  if (!provider || typeof provider.healthCheck !== 'function' || typeof provider.getState !== 'function') throw new TypeError('Shared Local AI Provider is required');
  if (typeof lmsPath !== 'string' || typeof fileExists !== 'function' || typeof runFile !== 'function' || typeof clock !== 'function') throw new TypeError('Runtime Coordinator options are invalid');
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) throw new TypeError('intervalMs must be at least 1000');
  let active = false;
  let timer = null;
  let inFlight = null;
  let ownership = null;
  let revision = 0;
  let state = Object.freeze({
    status: COORDINATOR_STATES.STOPPED, ownership: null, runtime: 'Bionic', lms_available: false,
    localhost_only: true, port: 1234, model_id: modelId, model_loaded: false,
    last_reason: null, last_checked_at: null, revision,
  });

  function publish(patch) {
    const next = { ...state, ...patch, revision: revision + 1 };
    if (JSON.stringify({ ...state, revision: 0 }) === JSON.stringify({ ...next, revision: 0 })) return state;
    revision += 1;
    state = Object.freeze({ ...next, revision });
    return state;
  }
  function getState() { return clone(state); }
  async function command(args, timeoutMs) { return runFile(lmsPath, Object.freeze([...args]), { timeoutMs }); }

  async function performReconcile(trigger) {
    const quickProbe = trigger === 'timer' && state.status === COORDINATOR_STATES.READY &&
      provider.getState()?.runtime_state === 'AI_READY';
    publish({ status: COORDINATOR_STATES.STARTING, last_reason: trigger === 'startup' ? null : state.last_reason });
    if (!lmsPath || !fileExists(lmsPath)) {
      return publish({ status: COORDINATOR_STATES.UNAVAILABLE, lms_available: false, model_loaded: false, last_reason: 'BIONIC_CLI_NOT_FOUND', last_checked_at: clock() });
    }
    publish({ lms_available: true });
    try {
      const serverStatus = await command(['server', 'status'], 15_000).catch((error) => ({ stdout: error?.stdout || '', stderr: error?.stderr || '' }));
      if (!serverIsRunning(`${serverStatus.stdout}\n${serverStatus.stderr}`)) {
        await command(['server', 'start', '--port', '1234', '--bind', '127.0.0.1'], 30_000);
        ownership = RUNTIME_OWNERSHIP.NEXA;
      } else if (ownership === null) {
        ownership = RUNTIME_OWNERSHIP.EXTERNAL;
      }
      const loaded = await command(['ps', '--json'], 20_000);
      if (!loadedModelPresent(loaded.stdout, modelId)) {
        const installed = await command(['ls', '--json'], 20_000);
        if (!installedModelPresent(installed.stdout, modelId)) {
          throw Object.assign(new Error('contract model is not installed'), { code: 'MODEL_NOT_INSTALLED' });
        }
        await command(['load', modelId, '--identifier', modelId, '--yes'], 120_000);
      }
      const health = await provider.healthCheck({ full: !quickProbe, deep: false });
      if (!health?.ok) throw Object.assign(new Error('provider health failed'), { code: health?.code });
      return publish({
        status: COORDINATOR_STATES.READY, ownership, model_loaded: true,
        last_reason: null, last_checked_at: clock(),
      });
    } catch (error) {
      return publish({
        status: COORDINATOR_STATES.UNAVAILABLE, ownership, model_loaded: false,
        last_reason: safeCode(error?.code || provider.getState()?.diagnostic_code), last_checked_at: clock(),
      });
    }
  }
  function reconcile(trigger = 'recovery') {
    if (inFlight) return inFlight;
    inFlight = performReconcile(trigger).finally(() => { inFlight = null; });
    return inFlight;
  }
  async function start() {
    if (active) return reconcile('startup');
    active = true;
    const result = await reconcile('startup');
    if (timer === null) {
      timer = setIntervalFn(() => { if (active) void reconcile('timer'); }, intervalMs);
      timer?.unref?.();
    }
    return result;
  }
  async function stop() {
    active = false;
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
    if (inFlight) await inFlight.catch(() => undefined);
    if (ownership === RUNTIME_OWNERSHIP.NEXA && lmsPath && fileExists(lmsPath)) {
      await command(['server', 'stop'], 30_000).catch(() => undefined);
    }
    ownership = null;
    return publish({ status: COORDINATOR_STATES.STOPPED, ownership: null, model_loaded: false, last_reason: null, last_checked_at: clock() });
  }

  return Object.freeze({ start, stop, reconcile, notifyResume: () => reconcile('resume'), getState });
}

module.exports = {
  COORDINATOR_STATES, DEFAULT_RECONCILE_INTERVAL_MS, RUNTIME_OWNERSHIP,
  createSharedLocalAiRuntimeCoordinator, defaultLmsPath, installedModelPresent, loadedModelPresent, serverIsRunning,
};
