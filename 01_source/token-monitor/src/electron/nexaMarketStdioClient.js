'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const MARKET_TRANSPORT_PROTOCOL = 'nexa.market.desktop-stdio.v0.1';
const MARKET_PROCESS_ARGS = Object.freeze(['-m', 'nexa_market.transport.stdio_rpc']);
const MARKET_METHOD_ALLOWLIST = Object.freeze([
  'initialize',
  'start',
  'stop',
  'dispose',
  'get_module_status',
  'get_desktop_snapshot',
  'get_route_manifest',
  'set_navigation_state',
  'get_market_home',
  'get_watchlist',
  'get_portfolio',
  'get_instrument_detail',
  'get_research_center',
  'get_decision_journal',
  'list_evidence',
  'explain_term',
  'refresh_local_projection',
  'execute_action',
  'shutdown'
]);
const MARKET_METHODS = new Set(MARKET_METHOD_ALLOWLIST);
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const DEFAULT_KILL_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_QUEUE = 32;
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 32 * 1024;

class NexaMarketStdioClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaMarketStdioClientError';
    this.code = code;
  }
}

function clientError(code, message) {
  return new NexaMarketStdioClientError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function positiveInteger(value, fallback, field) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw clientError('INVALID_MARKET_CLIENT_OPTIONS', `${field} must be a positive integer`);
  }
  return resolved;
}

function validateOptions(options) {
  if (!isPlainObject(options)) {
    throw clientError('INVALID_MARKET_CLIENT_OPTIONS', 'Market stdio client options must be a plain object');
  }
  if (typeof options.pythonExecutable !== 'string' || options.pythonExecutable.trim() === '') {
    throw clientError('INVALID_PYTHON_EXECUTABLE', 'Market Python executable must be explicitly configured');
  }
  if (typeof options.moduleRoot !== 'string' || !path.isAbsolute(options.moduleRoot)) {
    throw clientError('INVALID_MARKET_MODULE_ROOT', 'Market module root must be an absolute path');
  }
  if (options.spawnProcess !== undefined && typeof options.spawnProcess !== 'function') {
    throw clientError('INVALID_MARKET_CLIENT_OPTIONS', 'spawnProcess must be a function');
  }
}

function validateInitialization(value) {
  if (!isPlainObject(value) || typeof value.data_root !== 'string' || !path.isAbsolute(value.data_root) ||
      typeof value.timezone !== 'string' || value.timezone.trim() === '' ||
      typeof value.runtime_mode !== 'string' || value.runtime_mode.trim() === '' ||
      value.network_refresh_enabled !== false ||
      Object.keys(value).some((field) => ![
        'data_root', 'timezone', 'runtime_mode', 'network_refresh_enabled'
      ].includes(field))) {
    throw clientError(
      'INVALID_MARKET_INITIALIZATION',
      'Market initialization must use only the frozen data_root/timezone/runtime_mode/network_refresh_enabled fields'
    );
  }
  return Object.freeze({ ...value, network_refresh_enabled: false });
}

function stableRemoteError(value) {
  if (!isPlainObject(value) || typeof value.code !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code) || typeof value.message !== 'string') {
    throw clientError('MARKET_MALFORMED_RESPONSE', 'Market transport returned an invalid error envelope');
  }
  return clientError(value.code, value.message);
}

function exactFields(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

class NexaMarketStdioClient {
  constructor(options = {}) {
    validateOptions(options);
    this.pythonExecutable = options.pythonExecutable;
    this.moduleRoot = path.resolve(options.moduleRoot);
    this.spawnProcess = options.spawnProcess || spawn;
    this.requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs'
    );
    this.shutdownTimeoutMs = positiveInteger(
      options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS, 'shutdownTimeoutMs'
    );
    this.killTimeoutMs = positiveInteger(options.killTimeoutMs, DEFAULT_KILL_TIMEOUT_MS, 'killTimeoutMs');
    this.maxQueue = positiveInteger(options.maxQueue, DEFAULT_MAX_QUEUE, 'maxQueue');
    this.maxRequestBytes = positiveInteger(
      options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 'maxRequestBytes'
    );
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 'maxResponseBytes'
    );
    this.maxStderrBytes = positiveInteger(
      options.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES, 'maxStderrBytes'
    );
    this.state = 'idle';
    this.child = null;
    this.queue = [];
    this.active = null;
    this.stdoutBuffer = '';
    this.stderrBuffer = Buffer.alloc(0);
    this.nextRequestId = 1;
    this.expectedExit = false;
    this.closePromise = Promise.resolve();
    this.resolveClose = null;
    this.fatalError = null;
    this.killFallbackUsed = false;
    this.lastPid = null;
  }

  spawn() {
    if (this.child) throw clientError('MARKET_PROCESS_ALREADY_RUNNING', 'Market process is already running');
    if (!['idle', 'stopped'].includes(this.state)) {
      throw this.fatalError || clientError('MARKET_CLIENT_NOT_RESTARTABLE', 'Market client is not restartable');
    }
    this.state = 'running';
    this.expectedExit = false;
    this.fatalError = null;
    this.killFallbackUsed = false;
    this.stdoutBuffer = '';
    this.stderrBuffer = Buffer.alloc(0);
    this.closePromise = new Promise((resolve) => { this.resolveClose = resolve; });
    let child;
    try {
      child = this.spawnProcess(this.pythonExecutable, [...MARKET_PROCESS_ARGS], {
        cwd: this.moduleRoot,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8'
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (_error) {
      this.state = 'failed';
      this.fatalError = clientError('MARKET_PROCESS_SPAWN_FAILED', 'Market process could not be started');
      this.resolveClose?.();
      this.resolveClose = null;
      throw this.fatalError;
    }
    if (!child?.stdin || !child?.stdout || !child?.stderr || typeof child.on !== 'function') {
      try { child?.kill?.(); } catch (_) {}
      this.state = 'failed';
      this.fatalError = clientError('MARKET_PROCESS_SPAWN_FAILED', 'Market process stdio is unavailable');
      this.resolveClose?.();
      this.resolveClose = null;
      throw this.fatalError;
    }
    this.child = child;
    this.lastPid = Number.isSafeInteger(child.pid) ? child.pid : null;
    child.stdout.setEncoding?.('utf8');
    child.stdout.on('data', (chunk) => this._onStdout(String(chunk)));
    child.stderr.on('data', (chunk) => this._onStderr(chunk));
    child.on('error', () => this._fail(
      clientError('MARKET_PROCESS_ERROR', 'Market process emitted an error')
    ));
    child.on('close', (code, signal) => this._onClose(code, signal));
    return Object.freeze({
      executable: this.pythonExecutable,
      args: MARKET_PROCESS_ARGS,
      cwd: this.moduleRoot,
      pid: this.lastPid
    });
  }

  async open(initialization) {
    const frozenInitialization = validateInitialization(initialization);
    this.spawn();
    try {
      const result = await this.request('initialize', frozenInitialization);
      if (result?.initialized !== true || result?.network_refresh_enabled !== false ||
          result?.processing !== 'SERIAL_REQUEST_PROCESSING') {
        throw clientError('MARKET_INITIALIZATION_REJECTED', 'Market transport initialization was invalid');
      }
      return result;
    } catch (error) {
      await this._terminateAfterFailure();
      throw error;
    }
  }

  request(method, params = {}) {
    return this._enqueue(method, params, false);
  }

  _enqueue(method, params, allowDuringShutdown) {
    if (typeof method !== 'string' || !MARKET_METHODS.has(method)) {
      return Promise.reject(clientError('MARKET_METHOD_NOT_ALLOWED', 'Market method is not allowlisted'));
    }
    if (!isPlainObject(params)) {
      return Promise.reject(clientError('INVALID_MARKET_PARAMS', 'Market params must be a plain object'));
    }
    if (!this.child || (this.state !== 'running' && !(allowDuringShutdown && this.state === 'stopping'))) {
      return Promise.reject(this.fatalError || clientError(
        'MARKET_PROCESS_NOT_RUNNING', 'Market process is not running'
      ));
    }
    if (this.queue.length + (this.active ? 1 : 0) >= this.maxQueue) {
      return Promise.reject(clientError('MARKET_REQUEST_QUEUE_FULL', 'Market request queue is full'));
    }
    const id = `core-market-${this.nextRequestId++}`;
    const envelope = { protocol_version: MARKET_TRANSPORT_PROTOCOL, id, method, params };
    let line;
    try { line = `${JSON.stringify(envelope)}\n`; }
    catch { return Promise.reject(clientError('INVALID_MARKET_PARAMS', 'Market params are not JSON serializable')); }
    if (Buffer.byteLength(line, 'utf8') > this.maxRequestBytes) {
      return Promise.reject(clientError('MARKET_REQUEST_TOO_LARGE', 'Market request exceeds the Core limit'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id, line, resolve, reject, timer: null });
      this._pump();
    });
  }

  _pump() {
    if (this.active || this.queue.length === 0 || !this.child) return;
    const pending = this.queue.shift();
    this.active = pending;
    pending.timer = setTimeout(() => {
      if (this.active !== pending) return;
      this._fail(clientError('MARKET_REQUEST_TIMEOUT', 'Market request timed out'));
    }, this.requestTimeoutMs);
    pending.timer.unref?.();
    try {
      this.child.stdin.write(pending.line, 'utf8', (error) => {
        if (error && this.active === pending) {
          this._fail(clientError('MARKET_STDIN_WRITE_FAILED', 'Market request could not be written'));
        }
      });
    } catch (_) {
      this._fail(clientError('MARKET_STDIN_WRITE_FAILED', 'Market request could not be written'));
    }
  }

  _onStdout(chunk) {
    if (this.state === 'failed') return;
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > this.maxResponseBytes) {
      this._fail(clientError('MARKET_RESPONSE_TOO_LARGE', 'Market response exceeds the Core limit'));
      return;
    }
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline !== -1 && this.state !== 'failed') {
      let line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this._handleResponseLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  _handleResponseLine(line) {
    if (!this.active) {
      this._fail(clientError('MARKET_UNMATCHED_RESPONSE', 'Market response has no pending request'));
      return;
    }
    let response;
    try { response = JSON.parse(line); }
    catch {
      this._fail(clientError('MARKET_MALFORMED_RESPONSE', 'Market response is not valid JSON'));
      return;
    }
    if (!isPlainObject(response) || response.protocol_version !== MARKET_TRANSPORT_PROTOCOL) {
      this._fail(clientError('MARKET_PROTOCOL_MISMATCH', 'Market response protocol is invalid'));
      return;
    }
    if (response.id !== this.active.id) {
      this._fail(clientError('MARKET_UNMATCHED_RESPONSE', 'Market response id is not pending'));
      return;
    }
    if (typeof response.ok !== 'boolean' ||
        (response.ok && !exactFields(response, ['id', 'ok', 'protocol_version', 'result'])) ||
        (!response.ok && !exactFields(response, ['error', 'id', 'ok', 'protocol_version']))) {
      this._fail(clientError('MARKET_MALFORMED_RESPONSE', 'Market response envelope is invalid'));
      return;
    }
    const pending = this.active;
    this.active = null;
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.result);
    else {
      try { pending.reject(stableRemoteError(response.error)); }
      catch (error) { this._fail(error); return; }
    }
    this._pump();
  }

  _onStderr(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    this.stderrBuffer = Buffer.concat([this.stderrBuffer, bytes]);
    if (this.stderrBuffer.length > this.maxStderrBytes) {
      this.stderrBuffer = this.stderrBuffer.subarray(this.stderrBuffer.length - this.maxStderrBytes);
    }
  }

  _onClose(code, signal) {
    const child = this.child;
    this.child = null;
    this.resolveClose?.(Object.freeze({ code, signal }));
    this.resolveClose = null;
    if (this.active || this.queue.length > 0) {
      this._fail(clientError('MARKET_PROCESS_EXITED', 'Market process exited with pending requests'), false);
      return;
    }
    if (this.expectedExit) this.state = 'stopped';
    else if (this.state !== 'failed') {
      this.state = 'failed';
      this.fatalError = clientError('MARKET_PROCESS_EXITED', 'Market process exited unexpectedly');
    }
    return child;
  }

  _fail(error, terminate = true) {
    if (!this.fatalError) this.fatalError = error;
    this.state = 'failed';
    const failure = this.fatalError;
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.reject(failure);
      this.active = null;
    }
    for (const pending of this.queue.splice(0)) pending.reject(failure);
    if (terminate && this.child) {
      try { this.child.kill(); } catch (_) {}
    }
  }

  async _waitForClose(timeoutMs) {
    if (!this.child) return true;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    });
    const closed = await Promise.race([this.closePromise.then(() => true), timeout]);
    clearTimeout(timer);
    return closed;
  }

  async _terminateAfterFailure() {
    if (!this.child) return;
    try { this.child.kill(); } catch (_) {}
    await this._waitForClose(this.killTimeoutMs);
  }

  async shutdown() {
    if (!this.child) {
      this.state = 'stopped';
      return Object.freeze({ shutdown: true, disposed: false, killFallbackUsed: false });
    }
    if (this.state === 'failed') {
      await this._terminateAfterFailure();
      if (this.child) throw clientError(
        'MARKET_PROCESS_TERMINATION_FAILED', 'Market process did not exit after failure'
      );
      this.state = 'stopped';
      return Object.freeze({ shutdown: true, disposed: false, killFallbackUsed: true });
    }
    this.state = 'stopping';
    this.expectedExit = true;
    let result;
    try { result = await this._enqueue('shutdown', {}, true); }
    catch (_) { result = { shutdown: false, disposed: false }; }
    let closed = await this._waitForClose(this.shutdownTimeoutMs);
    if (!closed && this.child) {
      this.killFallbackUsed = true;
      try { this.child.kill(); } catch (_) {}
      closed = await this._waitForClose(this.killTimeoutMs);
    }
    if (!closed || this.child) {
      this.state = 'failed';
      throw clientError('MARKET_PROCESS_TERMINATION_FAILED', 'Market process did not exit');
    }
    this.state = 'stopped';
    return Object.freeze({
      ...(isPlainObject(result) ? result : {}),
      shutdown: result?.shutdown === true,
      disposed: result?.disposed === true,
      killFallbackUsed: this.killFallbackUsed
    });
  }

  async restart(initialization) {
    await this.shutdown();
    return this.open(initialization);
  }

  getDiagnostics() {
    return Object.freeze({
      state: this.state,
      pid: this.child && Number.isSafeInteger(this.child.pid) ? this.child.pid : null,
      lastPid: this.lastPid,
      pendingCount: this.queue.length + (this.active ? 1 : 0),
      stderr: this.stderrBuffer.toString('utf8'),
      killFallbackUsed: this.killFallbackUsed
    });
  }
}

function createNexaMarketStdioClient(options) {
  return new NexaMarketStdioClient(options);
}

module.exports = {
  DEFAULT_MAX_QUEUE,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  MARKET_METHOD_ALLOWLIST,
  MARKET_PROCESS_ARGS,
  MARKET_TRANSPORT_PROTOCOL,
  NexaMarketStdioClient,
  NexaMarketStdioClientError,
  createNexaMarketStdioClient,
  validateInitialization
};
