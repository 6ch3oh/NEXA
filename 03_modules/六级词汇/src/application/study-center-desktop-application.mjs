import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHomeLearningSummary } from './home-learning-summary-adapter.mjs';

export const STUDY_CENTER_DESKTOP_APPLICATION_VERSION = '0.1.0';
export const STUDY_CENTER_MODULE_ID = 'study-center';
export const STUDY_CENTER_ROUTE_ID = 'study-center';
export const STUDY_CENTER_PRODUCT_NAME = '学习中心';

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const authoritativeDataRoot = join(moduleRoot, 'data', 'ecdict-qualified', 'current');
const serverEntrypoint = join(moduleRoot, 'ui', 'server.mjs');
const ownedDataRoots = new Set();
const DEFAULT_PORT = 4316;
const DEFAULT_FALLBACK_PORTS = Object.freeze([4416, 4516, 4616, 4816]);

export const STUDY_CENTER_DESKTOP_CONTRACT = Object.freeze({
  contractVersion: STUDY_CENTER_DESKTOP_APPLICATION_VERSION,
  moduleId: STUDY_CENTER_MODULE_ID,
  routeId: STUDY_CENTER_ROUTE_ID,
  productName: STUDY_CENTER_PRODUCT_NAME,
  runtime: 'DESKTOP_MANAGED_LOOPBACK',
  host: '127.0.0.1',
  defaultPort: DEFAULT_PORT,
  fallbackPorts: DEFAULT_FALLBACK_PORTS,
  runtimeNetworkDependency: 0,
  singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER',
  methods: Object.freeze(['start', 'stop', 'getReadiness', 'getHomeSummary', 'getPronunciationAudio', 'updateStudyPlan']),
});

function absoluteNonRoot(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) === parse(resolve(value)).root) {
    throw new TypeError(`${name} must be an absolute non-root path`);
  }
  return resolve(value);
}

function readiness(state, code, endpoint = null) {
  return Object.freeze({
    applicationVersion: STUDY_CENTER_DESKTOP_APPLICATION_VERSION,
    state,
    code,
    ready: state === 'READY',
    endpoint: endpoint ? Object.freeze({ ...endpoint }) : null,
    runtimeNetworkDependency: 0,
    singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER',
  });
}

function waitForExit(runtimeProcess, timeoutMs) {
  if (runtimeProcess.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => {
    const timer = setTimeout(resolveExit, timeoutMs);
    timer.unref?.();
    runtimeProcess.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

export function createStudyCenterDesktopApplication(options = {}) {
  const dataRoot = absoluteNonRoot(options.dataRoot ?? authoritativeDataRoot, 'dataRoot');
  const libraryFile = absoluteNonRoot(
    options.libraryFile ?? join(authoritativeDataRoot, 'vocabulary-library.json'),
    'libraryFile',
  );
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('port must be a valid TCP port');
  const portCandidates = options.port === undefined
    ? Object.freeze([port, ...DEFAULT_FALLBACK_PORTS.filter((candidate) => candidate !== port)])
    : Object.freeze([port]);
  const spawnRuntime = options.spawnRuntime ?? spawn;
  if (typeof spawnRuntime !== 'function') throw new TypeError('spawnRuntime must be a function');
  const startupTimeoutMs = options.startupTimeoutMs ?? 20_000;
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 100) throw new TypeError('startupTimeoutMs must be at least 100');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  let runtimeProcess = null;
  let current = readiness('STOPPED', 'STOPPED');
  let startPromise = null;

  function canRetryOnAnotherPort(error) {
    return error?.code === 'STUDY_CENTER_START_FAILED' &&
      /listen (?:EACCES|EADDRINUSE):/u.test(String(error?.message || ''));
  }

  async function launchRuntime(candidatePort) {
    current = readiness('STARTING', candidatePort === port ? 'STARTING' : 'PORT_FALLBACK');
    const endpoint = { host: '127.0.0.1', port: candidatePort, url: `http://127.0.0.1:${candidatePort}/`, owned: true };
    const args = [
      serverEntrypoint,
      '--port', String(candidatePort),
      '--data-file', join(dataRoot, 'learner-state.json'),
      '--preferences-file', join(dataRoot, 'study-plans.json'),
      '--vocabulary-library-file', libraryFile,
      '--word-forms-file', join(dirname(libraryFile), 'word-forms.json'),
      '--vocabulary-enrichment-file', join(dirname(libraryFile), 'vocabulary-enrichment-wave006.json'),
      '--mock-exam-file', join(dataRoot, 'mock-exams.json'),
      '--pronunciation-cache-directory', join(dataRoot, 'pronunciation-cache'),
      '--vocabulary-restore-point-directory', join(dataRoot, 'library-restore-points'),
      '--desktop-managed',
    ];
    if (dataRoot !== authoritativeDataRoot) args.push('--read-only-library');

    runtimeProcess = spawnRuntime(process.execPath, args, {
      cwd: moduleRoot,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    return await new Promise((resolveStart, rejectStart) => {
      let stderr = '';
      const timer = setTimeout(() => fail(
        'STUDY_CENTER_START_TIMEOUT',
        stderr || 'Study Center runtime did not become ready',
      ), startupTimeoutMs);
      timer.unref?.();

      const cleanup = () => {
        clearTimeout(timer);
        runtimeProcess?.stdout?.off?.('data', onStdout);
        runtimeProcess?.stderr?.off?.('data', onStderr);
        runtimeProcess?.off?.('error', onError);
        runtimeProcess?.off?.('exit', onExitBeforeReady);
      };
      const fail = (code, message) => {
        cleanup();
        current = readiness('ERROR', code);
        runtimeProcess?.kill?.();
        runtimeProcess = null;
        rejectStart(Object.assign(new Error(message), { code }));
      };
      const onStdout = (chunk) => {
        const text = String(chunk);
        if (!text.includes(`NEXA Local Study Center: http://127.0.0.1:${candidatePort}`)) return;
        cleanup();
        current = readiness('READY', 'READY', endpoint);
        resolveStart(current);
      };
      const onStderr = (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-2_000); };
      const onError = (error) => fail('STUDY_CENTER_PROCESS_ERROR', error?.message || 'Study Center runtime process failed');
      const onExitBeforeReady = () => fail('STUDY_CENTER_START_FAILED', stderr || 'Study Center runtime exited before ready');
      runtimeProcess.stdout?.on?.('data', onStdout);
      runtimeProcess.stderr?.on?.('data', onStderr);
      runtimeProcess.once?.('error', onError);
      runtimeProcess.once?.('exit', onExitBeforeReady);
    });
  }

  async function start() {
    if (current.ready) return current;
    if (startPromise) return startPromise;
    if (ownedDataRoots.has(dataRoot)) throw Object.assign(new Error('Study Center dataRoot already has an owner'), { code: 'STUDY_CENTER_SINGLE_WRITER_CONFLICT' });

    startPromise = (async () => {
      await stat(libraryFile);
      ownedDataRoots.add(dataRoot);
      let lastError = null;
      for (const candidatePort of portCandidates) {
        try {
          return await launchRuntime(candidatePort);
        } catch (error) {
          lastError = error;
          if (!canRetryOnAnotherPort(error) || candidatePort === portCandidates.at(-1)) throw error;
        }
      }
      throw lastError;
    })().catch((error) => {
      ownedDataRoots.delete(dataRoot);
      throw error;
    }).finally(() => { startPromise = null; });
    return startPromise;
  }

  async function stop() {
    if (startPromise) {
      try { await startPromise; } catch { /* start already projected the failure */ }
    }
    const processToStop = runtimeProcess;
    runtimeProcess = null;
    if (processToStop && processToStop.exitCode === null) {
      if (processToStop.connected && typeof processToStop.send === 'function') {
        try { processToStop.send({ type: 'NEXA_STUDY_CENTER_STOP' }); } catch { processToStop.kill?.(); }
      } else processToStop.kill?.();
      await waitForExit(processToStop, 3_000);
      if (processToStop.exitCode === null) processToStop.kill?.();
    }
    ownedDataRoots.delete(dataRoot);
    current = readiness('STOPPED', 'STOPPED');
    return current;
  }

  function getReadiness() { return current; }

  async function getHomeSummary(input = {}) {
    if (!current.ready || !current.endpoint) {
      throw Object.assign(new Error('学习中心尚未就绪'), { code: 'STUDY_CENTER_NOT_READY' });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        input.cursor !== undefined && (!Number.isSafeInteger(input.cursor) || input.cursor < 0 || input.cursor > 100_000) ||
        input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 4) ||
        Object.keys(input).some((key) => !['cursor', 'limit'].includes(key))) {
      throw Object.assign(new Error('学习摘要请求无效'), { code: 'STUDY_CENTER_HOME_SUMMARY_INVALID_REQUEST' });
    }
    const query = new URLSearchParams();
    if (input.cursor !== undefined) query.set('cursor', String(input.cursor));
    if (input.limit !== undefined) query.set('limit', String(input.limit));
    const suffix = query.size > 0 ? `?${query}` : '';
    let response;
    try {
      response = await fetchImpl(`${current.endpoint.url}api/home-summary${suffix}`, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch {
      throw Object.assign(new Error('学习摘要暂不可用'), { code: 'STUDY_CENTER_HOME_SUMMARY_UNAVAILABLE' });
    }
    if (!response?.ok) {
      throw Object.assign(new Error('学习摘要暂不可用'), { code: 'STUDY_CENTER_HOME_SUMMARY_HTTP_ERROR' });
    }
    let envelope;
    try { envelope = await response.json(); }
    catch {
      throw Object.assign(new Error('学习摘要暂不可用'), { code: 'STUDY_CENTER_HOME_SUMMARY_INVALID' });
    }
    if (envelope?.ok !== true) {
      throw Object.assign(new Error('学习摘要暂不可用'), { code: 'STUDY_CENTER_HOME_SUMMARY_UNAVAILABLE' });
    }
    try { return validateHomeLearningSummary(envelope.value); }
    catch {
      throw Object.assign(new Error('学习摘要暂不可用'), { code: 'STUDY_CENTER_HOME_SUMMARY_INVALID' });
    }
  }

  async function getPronunciationAudio(input = {}) {
    if (!current.ready || !current.endpoint) {
      throw Object.assign(new Error('学习中心尚未就绪'), { code: 'STUDY_CENTER_NOT_READY' });
    }
    const word = typeof input.word === 'string' ? input.word.trim() : '';
    const accent = input.accent;
    if (!word || word.length > 120 || !['us', 'uk'].includes(accent)) {
      throw Object.assign(new Error('发音请求无效'), { code: 'INVALID_PRONUNCIATION_REQUEST' });
    }
    let response;
    try {
      response = await fetchImpl(`${current.endpoint.url}api/pronounce`, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ word, accent }),
      });
    } catch {
      throw Object.assign(new Error('本地发音服务暂不可用'), { code: 'PRONUNCIATION_UNAVAILABLE' });
    }
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(new Error('本地发音响应无效'), { code: 'PRONUNCIATION_INVALID' }); }
    if (!response.ok || result?.ok === false || typeof result?.audioUrl !== 'string' || !result.audioUrl.startsWith('/api/audio?')) {
      const code = typeof result?.error?.code === 'string' ? result.error.code : 'PRONUNCIATION_UNAVAILABLE';
      throw Object.assign(new Error('本地发音暂不可用'), { code });
    }
    let audioResponse;
    try { audioResponse = await fetchImpl(new URL(result.audioUrl, current.endpoint.url), { cache: 'no-store', redirect: 'error' }); }
    catch { throw Object.assign(new Error('本地发音音频暂不可用'), { code: 'PRONUNCIATION_AUDIO_UNAVAILABLE' }); }
    const length = Number(audioResponse.headers?.get?.('content-length') ?? 0);
    if (!audioResponse.ok || (Number.isFinite(length) && length > 2_000_000)) {
      throw Object.assign(new Error('本地发音音频无效'), { code: 'PRONUNCIATION_AUDIO_INVALID' });
    }
    const bytes = Buffer.from(await audioResponse.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 2_000_000) {
      throw Object.assign(new Error('本地发音音频无效'), { code: 'PRONUNCIATION_AUDIO_INVALID' });
    }
    return Object.freeze({
      accent,
      source: typeof result.source === 'string' ? result.source : 'LOCAL_TTS',
      generated: result.generated === true,
      mimeType: 'audio/wav',
      dataBase64: bytes.toString('base64'),
      runtimeNetworkDependency: 0,
    });
  }

  async function updateStudyPlan(input = {}) {
    if (!current.ready || !current.endpoint) {
      throw Object.assign(new Error('学习中心尚未就绪'), { code: 'STUDY_CENTER_NOT_READY' });
    }
    const allowed = ['dailyNewLimit', 'dailyReviewLimit', 'dailyTotalLimit'];
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some((key) => !allowed.includes(key)) ||
        allowed.some((key) => input[key] !== undefined && (!Number.isInteger(input[key]) || input[key] < 0 || input[key] > 1_000)) ||
        (input.dailyTotalLimit !== undefined && input.dailyTotalLimit < 1)) {
      throw Object.assign(new Error('学习计划请求无效'), { code: 'INVALID_STUDY_PLAN_REQUEST' });
    }
    let response;
    try {
      response = await fetchImpl(`${current.endpoint.url}api/plan`, {
        method: 'POST', cache: 'no-store', redirect: 'error',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
    } catch {
      throw Object.assign(new Error('学习计划暂不可用'), { code: 'STUDY_PLAN_UNAVAILABLE' });
    }
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(new Error('学习计划响应无效'), { code: 'STUDY_PLAN_INVALID' }); }
    if (!response.ok || result?.ok !== true || !result?.home?.plan) {
      throw Object.assign(new Error('学习计划暂不可用'), { code: 'STUDY_PLAN_UPDATE_FAILED' });
    }
    return Object.freeze({ plan: Object.freeze({ ...result.home.plan }), source: 'study-center-public-adapter' });
  }

  return Object.freeze({ start, stop, getReadiness, getHomeSummary, getPronunciationAudio, updateStudyPlan });
}
