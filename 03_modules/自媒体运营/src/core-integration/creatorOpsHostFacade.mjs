import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;
const CONTRACT_VERSION = '1.0';
const OWNERSHIP_CONTRACT_VERSION = '0.1';
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STATES = Object.freeze({
  CREATED: 'CREATED', STARTING: 'STARTING', READY: 'READY',
  STOPPING: 'STOPPING', STOPPED: 'STOPPED', ERROR: 'ERROR',
});

class CreatorOpsHostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CreatorOpsHostError';
    this.code = code;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateOptions(options) {
  const host = options.host ?? LOOPBACK_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  if (host !== LOOPBACK_HOST) {
    throw new CreatorOpsHostError('INVALID_HOST', 'Creator Ops UI is loopback-only');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CreatorOpsHostError('INVALID_PORT', 'Creator Ops UI port must be an integer from 1 to 65535');
  }
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120_000) {
    throw new CreatorOpsHostError('INVALID_STARTUP_TIMEOUT', 'Creator Ops UI startup timeout is invalid');
  }
  return { host, port, startupTimeoutMs };
}

function requestJson({
  method = 'GET', url, controlToken = null, ownerId = null,
  ownerGeneration = null, timeoutMs = 2_000, body = null,
}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = { Accept: 'application/json' };
    if (controlToken !== null) headers['X-Creator-Ops-Control'] = controlToken;
    if (ownerId !== null) headers['X-Creator-Ops-Owner'] = ownerId;
    if (ownerGeneration !== null) headers['X-Creator-Ops-Generation'] = String(ownerGeneration);
    const encodedBody = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    if (encodedBody !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(encodedBody.length);
    }
    const request = http.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          reject(new CreatorOpsHostError('HOST_PROTOCOL_ERROR', 'Creator Ops UI returned an invalid response'));
          return;
        }
        const status = response.statusCode ?? 500;
        if (status < 200 || status >= 300) {
          reject(new CreatorOpsHostError(
            typeof payload?.error?.code === 'string' ? payload.error.code : 'HOST_HTTP_ERROR',
            typeof payload?.error?.message === 'string' ? payload.error.message : 'Creator Ops UI host rejected the request',
          ));
          return;
        }
        resolve(payload);
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => reject(new CreatorOpsHostError('HOST_UNREACHABLE', 'Creator Ops UI host is unavailable')));
    request.end(encodedBody);
  });
}

function childIsAlive(child) {
  return child !== null && child.exitCode === null && child.signalCode === null;
}

function ownershipMatches(value, { ownerId, ownerGeneration, host, port }) {
  const endpoint = value?.endpoint;
  return value?.contractVersion === OWNERSHIP_CONTRACT_VERSION &&
    value?.ownerId === ownerId && value?.ownerGeneration === ownerGeneration &&
    value?.controlTokenVerified === true && value?.state === STATES.READY && value?.ready === true &&
    endpoint?.host === host && endpoint?.port === port &&
    endpoint?.url === `http://${host}:${port}/`;
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onExit = () => { cleanup(); resolve(); };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new CreatorOpsHostError('HOST_STOP_TIMEOUT', 'Creator Ops UI host did not stop in time'));
    }, timeoutMs);
    const cleanup = () => { clearTimeout(timeout); child.off('exit', onExit); };
    child.once('exit', onExit);
  });
}

export class CreatorOpsUIHostFacade {
  #host;
  #port;
  #startupTimeoutMs;
  #state = STATES.CREATED;
  #errorCode = null;
  #message = 'Creator Ops UI host created';
  #endpoint = null;
  #generation = 0;
  #child = null;
  #controlToken = null;
  #ownerId = null;
  #ownerGeneration = null;
  #startPromise = null;
  #stopPromise = null;

  constructor(options = {}) {
    const validated = validateOptions(options);
    this.#host = validated.host;
    this.#port = validated.port;
    this.#startupTimeoutMs = validated.startupTimeoutMs;
  }

  getReadiness() {
    const ownedChildAlive = childIsAlive(this.#child) && this.#controlToken !== null && this.#ownerId !== null;
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      state: this.#state,
      ready: this.#state === STATES.READY && ownedChildAlive,
      errorCode: this.#errorCode,
      message: this.#message,
      endpoint: this.#endpoint === null ? null : Object.freeze({ ...this.#endpoint }),
      runtimeInstanceCount: ownedChildAlive ? 1 : 0,
      generation: this.#generation,
    });
  }

  getSnapshot() {
    return this.getReadiness();
  }

  async start() {
    if (this.#state === STATES.READY && childIsAlive(this.#child) && this.#ownerId !== null) {
      return this.getReadiness();
    }
    if (this.#startPromise !== null) return this.#startPromise;
    if (this.#state === STATES.STOPPING) {
      throw new CreatorOpsHostError('HOST_STOPPING', 'Creator Ops UI host is stopping');
    }
    this.#startPromise = this.#startOnce();
    try {
      return await this.#startPromise;
    } finally {
      this.#startPromise = null;
    }
  }

  async #startOnce() {
    this.#state = STATES.STARTING;
    this.#errorCode = null;
    this.#message = 'Creator Ops UI host is starting';
    this.#endpoint = null;
    this.#controlToken = randomBytes(32).toString('hex');
    this.#ownerId = randomBytes(16).toString('hex');
    this.#ownerGeneration = this.#generation + 1;
    const python = process.env.CREATOR_OPS_PYTHON || 'python';
    const sourceRoot = path.join(MODULE_ROOT, 'src');
    const pathSeparator = process.platform === 'win32' ? ';' : ':';
    const inheritedPythonPath = process.env.PYTHONPATH;
    const pythonPath = inheritedPythonPath ? `${sourceRoot}${pathSeparator}${inheritedPythonPath}` : sourceRoot;
    const child = spawn(python, [
      '-m', 'creator_ops.ui.host', '--host', this.#host, '--port', String(this.#port),
    ], {
      cwd: MODULE_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath,
        PYTHONDONTWRITEBYTECODE: '1',
        CREATOR_OPS_INTERNAL_CONTROL_TOKEN: this.#controlToken,
        CREATOR_OPS_UI_OWNER_ID: this.#ownerId,
        CREATOR_OPS_UI_OWNER_GENERATION: String(this.#ownerGeneration),
        CREATOR_OPS_UI_OWNER_PID: String(process.pid),
      },
      windowsHide: true,
      stdio: 'ignore',
    });
    this.#child = child;
    child.once('exit', () => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#controlToken = null;
      this.#ownerId = null;
      this.#ownerGeneration = null;
      if (this.#state === STATES.STOPPING) {
        this.#state = STATES.STOPPED;
        this.#errorCode = null;
        this.#message = 'Creator Ops UI host is stopped';
      } else if (this.#state !== STATES.ERROR) {
        this.#state = STATES.ERROR;
        this.#errorCode = 'HOST_PROCESS_EXITED';
        this.#message = 'Creator Ops UI host process exited unexpectedly';
      }
    });

    const ownershipUrl = `http://${this.#host}:${this.#port}/api/v1/host-ownership`;
    const expectedOwnership = Object.freeze({
      ownerId: this.#ownerId,
      ownerGeneration: this.#ownerGeneration,
      host: this.#host,
      port: this.#port,
    });
    const deadline = Date.now() + this.#startupTimeoutMs;
    try {
      while (Date.now() < deadline) {
        try {
          const ownership = await requestJson({
            url: ownershipUrl,
            controlToken: this.#controlToken,
            ownerId: this.#ownerId,
            ownerGeneration: this.#ownerGeneration,
          });
          if (ownershipMatches(ownership, expectedOwnership) && childIsAlive(child)) {
            this.#state = STATES.READY;
            this.#errorCode = null;
            this.#message = 'Creator Ops UI host is ready';
            this.#endpoint = ownership.endpoint;
            this.#generation = this.#ownerGeneration;
            return this.getReadiness();
          }
          throw new CreatorOpsHostError('OWNER_MISMATCH', 'Creator Ops UI endpoint belongs to another owner');
        } catch (error) {
          if (error?.code !== 'HOST_UNREACHABLE') {
            throw new CreatorOpsHostError('OWNER_MISMATCH', 'Creator Ops UI endpoint belongs to another owner');
          }
        }
        if (!childIsAlive(child)) {
          throw new CreatorOpsHostError('HOST_PROCESS_EXITED', 'Creator Ops UI host process exited during startup');
        }
        await delay(POLL_INTERVAL_MS);
      }
      throw new CreatorOpsHostError('HOST_START_TIMEOUT', 'Creator Ops UI host did not become ready in time');
    } catch (error) {
      this.#state = STATES.ERROR;
      this.#errorCode = error instanceof CreatorOpsHostError ? error.code : 'HOST_START_FAILED';
      this.#message = 'Creator Ops UI host could not start';
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        try { await waitForChildExit(child, STOP_TIMEOUT_MS); } catch { /* best-effort orphan cleanup */ }
      }
      if (this.#child === child) this.#child = null;
      this.#controlToken = null;
      this.#ownerId = null;
      this.#ownerGeneration = null;
      throw new CreatorOpsHostError(this.#errorCode, this.#message);
    }
  }

  async stop() {
    if (this.#state === STATES.CREATED || (this.#state === STATES.STOPPED && this.#child === null)) {
      this.#state = STATES.STOPPED;
      this.#errorCode = null;
      this.#message = 'Creator Ops UI host is stopped';
      return this.getReadiness();
    }
    if (this.#stopPromise !== null) return this.#stopPromise;
    this.#stopPromise = this.#stopOnce();
    try {
      return await this.#stopPromise;
    } finally {
      this.#stopPromise = null;
    }
  }

  async #stopOnce() {
    if (this.#startPromise !== null) {
      try { await this.#startPromise; } catch { /* startup cleanup already ran */ }
    }
    const child = this.#child;
    if (child === null) {
      this.#state = STATES.STOPPED;
      this.#errorCode = null;
      this.#message = 'Creator Ops UI host is stopped';
      return this.getReadiness();
    }
    this.#state = STATES.STOPPING;
    this.#errorCode = null;
    this.#message = 'Creator Ops UI host is stopping';
    const controlToken = this.#controlToken;
    const ownerId = this.#ownerId;
    const ownerGeneration = this.#ownerGeneration;
    const ownershipUrl = `http://${this.#host}:${this.#port}/api/v1/host-ownership`;
    const shutdownUrl = `http://${this.#host}:${this.#port}/api/v1/host-shutdown`;
    try {
      const ownership = await requestJson({
        url: ownershipUrl, controlToken, ownerId, ownerGeneration, timeoutMs: 3_000,
      });
      if (!ownershipMatches(ownership, {
        ownerId, ownerGeneration, host: this.#host, port: this.#port,
      })) {
        throw new CreatorOpsHostError('OWNER_MISMATCH', 'Creator Ops UI endpoint belongs to another owner');
      }
      await requestJson({
        method: 'POST', url: shutdownUrl, controlToken, ownerId, ownerGeneration, timeoutMs: 3_000,
      });
      await waitForChildExit(child, STOP_TIMEOUT_MS);
    } catch {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        try { await waitForChildExit(child, STOP_TIMEOUT_MS); } catch { /* best-effort orphan cleanup */ }
      }
      this.#child = null;
      this.#controlToken = null;
      this.#ownerId = null;
      this.#ownerGeneration = null;
      this.#state = STATES.ERROR;
      this.#errorCode = 'HOST_STOP_FAILED';
      this.#message = 'Creator Ops UI host could not stop cleanly';
      throw new CreatorOpsHostError(this.#errorCode, this.#message);
    }
    this.#child = null;
    this.#controlToken = null;
    this.#ownerId = null;
    this.#ownerGeneration = null;
    this.#state = STATES.STOPPED;
    this.#errorCode = null;
    this.#message = 'Creator Ops UI host is stopped';
    return this.getReadiness();
  }

  async execute(command) {
    if (command?.type === 'GET_READINESS') return this.getReadiness();
    if (command?.type === 'WORKS_QUERY') return this.#worksRequest('query', command.request);
    if (command?.type === 'WORKS_COMMAND') return this.#worksRequest('command', command.command);
    throw new CreatorOpsHostError('UNSUPPORTED_COMMAND', 'Creator Ops host command is unsupported');
  }

  async #worksRequest(kind, payload) {
    if (
      this.#state !== STATES.READY || !childIsAlive(this.#child) || this.#controlToken === null ||
      this.#ownerId === null || this.#ownerGeneration === null || this.#endpoint === null
    ) {
      throw new CreatorOpsHostError('HOST_NOT_READY', 'Creator Ops UI host is not ready');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new CreatorOpsHostError('INVALID_WORKS_REQUEST', 'Creator Ops Works request is invalid');
    }
    return requestJson({
      method: 'POST', url: `${this.#endpoint.url}api/v1/integration/works/${kind}`,
      controlToken: this.#controlToken, ownerId: this.#ownerId,
      ownerGeneration: this.#ownerGeneration, body: payload, timeoutMs: 30_000,
    });
  }
}

export function createCreatorOpsUIHost(options = {}) {
  return new CreatorOpsUIHostFacade(options);
}

export function createCreatorOpsController(options = {}) {
  return createCreatorOpsUIHost(options);
}

export { CreatorOpsHostError, STATES as CREATOR_OPS_UI_HOST_STATES };
export { OWNERSHIP_CONTRACT_VERSION as CREATOR_OPS_UI_HOST_OWNERSHIP_CONTRACT_VERSION };
