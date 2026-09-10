import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  STUDY_CENTER_DESKTOP_APPLICATION_VERSION,
  STUDY_CENTER_DESKTOP_CONTRACT,
  createStudyCenterDesktopApplication,
} from '../src/index.mjs';

const libraryFile = fileURLToPath(new URL('../data/ecdict-qualified/current/vocabulary-library.json', import.meta.url));

function createFakeRuntime(onSpawn) {
  return (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.connected = true;
    child.kill = () => {
      child.exitCode = 0;
      child.emit('exit', 0);
    };
    child.send = (message) => {
      assert.deepEqual(message, { type: 'NEXA_STUDY_CENTER_STOP' });
      child.kill();
    };
    onSpawn?.({ executable, args, options, child });
    const port = args[args.indexOf('--port') + 1];
    queueMicrotask(() => child.stdout.write(`NEXA Local Study Center: http://127.0.0.1:${port}/\n`));
    return child;
  };
}

test('Desktop contract exposes one versioned Study Center lifecycle boundary', () => {
  assert.equal(STUDY_CENTER_DESKTOP_APPLICATION_VERSION, '0.1.0');
  assert.deepEqual(STUDY_CENTER_DESKTOP_CONTRACT.methods, ['start', 'stop', 'getReadiness', 'getHomeSummary', 'getPronunciationAudio', 'updateStudyPlan']);
  assert.equal(STUDY_CENTER_DESKTOP_CONTRACT.moduleId, 'study-center');
  assert.equal(STUDY_CENTER_DESKTOP_CONTRACT.routeId, 'study-center');
  assert.equal(STUDY_CENTER_DESKTOP_CONTRACT.productName, '学习中心');
  assert.equal(STUDY_CENTER_DESKTOP_CONTRACT.runtimeNetworkDependency, 0);
  assert.deepEqual(STUDY_CENTER_DESKTOP_CONTRACT.fallbackPorts, [4416, 4516, 4616, 4816]);
});

for (const listenError of [
  ['EACCES', 'permission denied'],
  ['EADDRINUSE', 'address already in use'],
]) test(`Desktop application falls back after loopback listen ${listenError[0]}`, async () => {
  const dataRoot = join(process.cwd(), 'tmp', 'study-center-port-fallback');
  const attemptedPorts = [];
  let attempt = 0;
  const spawnRuntime = (_executable, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.connected = true;
    child.kill = () => {
      if (child.exitCode !== null) return;
      child.exitCode = 0;
      child.emit('exit', 0);
    };
    child.send = () => child.kill();
    const candidatePort = Number(args[args.indexOf('--port') + 1]);
    attemptedPorts.push(candidatePort);
    const currentAttempt = attempt++;
    queueMicrotask(() => {
      if (currentAttempt === 0) {
        child.stderr.write(`Error: listen ${listenError[0]}: ${listenError[1]} 127.0.0.1:${candidatePort}\n`);
        child.exitCode = 1;
        child.emit('exit', 1);
      } else {
        child.stdout.write(`NEXA Local Study Center: http://127.0.0.1:${candidatePort}/\n`);
      }
    });
    return child;
  };
  const application = createStudyCenterDesktopApplication({ dataRoot, libraryFile, spawnRuntime });
  const started = await application.start();
  assert.deepEqual(attemptedPorts, [4316, 4416]);
  assert.equal(started.endpoint.url, 'http://127.0.0.1:4416/');
  assert.equal(started.code, 'READY');
  await application.stop();
});

test('Desktop application reads and validates only the narrow loopback Home summary', async () => {
  const dataRoot = join(process.cwd(), 'tmp', 'study-center-home-summary-contract');
  const calls = [];
  const summary = {
    contract_version: '0.1.0',
    cards: [],
    availability: 'empty',
    empty_state: { is_empty: true, reason: 'NO_CARDS_DUE' },
    today_learned: 0,
    due_review: 0,
    total_progress: 0,
    progress_current: 0,
    progress_total: 5311,
    updated_at: null,
    generated_at: '2026-09-02T00:30:00.000Z',
    freshness: { status: 'not_started', updated_at: null },
    learning_center_handoff: { route_id: 'study-center', action: 'open-learning-center' },
  };
  const application = createStudyCenterDesktopApplication({
    dataRoot,
    libraryFile,
    spawnRuntime: createFakeRuntime(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async json() { return { ok: true, value: summary }; } };
    },
  });
  await application.start();
  assert.deepEqual(await application.getHomeSummary(), summary);
  assert.equal(calls[0].url, 'http://127.0.0.1:4316/api/home-summary');
  assert.equal(calls[0].options.method, 'GET');
  await application.getHomeSummary({ cursor: 4, limit: 2 });
  assert.equal(calls[1].url, 'http://127.0.0.1:4316/api/home-summary?cursor=4&limit=2');
  await assert.rejects(() => application.getHomeSummary({ cursor: -1 }), { code: 'STUDY_CENTER_HOME_SUMMARY_INVALID_REQUEST' });
  await application.stop();
});

test('Desktop application owns one loopback runtime and isolates mutable paths', async () => {
  const dataRoot = join(process.cwd(), 'tmp', 'study-center-desktop-contract');
  let launch;
  const application = createStudyCenterDesktopApplication({
    dataRoot,
    libraryFile,
    spawnRuntime: createFakeRuntime((value) => { launch = value; }),
  });

  const started = await application.start();
  assert.equal(started.ready, true);
  assert.equal(started.endpoint.url, 'http://127.0.0.1:4316/');
  assert.equal(started.singleWriterScope, 'PROCESS_LOCAL_SINGLE_WRITER');
  assert.ok(launch.args.includes('--desktop-managed'));
  assert.ok(launch.args.includes('--read-only-library'));
  assert.ok(launch.args.includes(join(dataRoot, 'learner-state.json')));
  assert.ok(launch.args.includes(join(dataRoot, 'mock-exams.json')));
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, '1');

  const stopped = await application.stop();
  assert.equal(stopped.state, 'STOPPED');
});

test('Desktop application returns bounded local pronunciation audio without an external request', async () => {
  const dataRoot = join(process.cwd(), 'tmp', 'study-center-pronunciation-contract');
  const calls = [];
  const bytes = new TextEncoder().encode('RIFF-local-wave');
  const application = createStudyCenterDesktopApplication({
    dataRoot,
    libraryFile,
    spawnRuntime: createFakeRuntime(),
    fetchImpl: async (url, options) => {
      calls.push({ url:String(url), options });
      if (String(url).endsWith('/api/pronounce')) return {
        ok:true,
        async json() { return { ok:true, audioUrl:'/api/audio?token=local-token', source:'LOCAL_TTS_CACHE', generated:false }; },
      };
      return {
        ok:true,
        headers:{ get(name) { return name === 'content-length' ? String(bytes.byteLength) : null; } },
        async arrayBuffer() { return bytes.buffer; },
      };
    },
  });
  await application.start();
  const result = await application.getPronunciationAudio({ word:'abandon', accent:'us' });
  assert.equal(result.mimeType, 'audio/wav');
  assert.equal(result.runtimeNetworkDependency, 0);
  assert.equal(Buffer.from(result.dataBase64, 'base64').toString(), 'RIFF-local-wave');
  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:4316/api/pronounce',
    'http://127.0.0.1:4316/api/audio?token=local-token',
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { word:'abandon', accent:'us' });
  await application.stop();
});

test('Desktop application updates the study plan through its owned loopback runtime', async () => {
  const dataRoot = join(process.cwd(), 'tmp', 'study-center-plan-contract');
  const calls = [];
  const plan = { planVersion:'0.1', collectionId:'cet6-vocabulary', dailyNewLimit:8, dailyReviewLimit:12, dailyTotalLimit:20 };
  const application = createStudyCenterDesktopApplication({
    dataRoot,
    libraryFile,
    spawnRuntime: createFakeRuntime(),
    fetchImpl: async (url, options) => {
      calls.push({ url:String(url), options });
      return { ok:true, async json() { return { ok:true, home:{ plan } }; } };
    },
  });
  await application.start();
  const result = await application.updateStudyPlan({ dailyNewLimit:8, dailyReviewLimit:12, dailyTotalLimit:20 });
  assert.deepEqual(result.plan, plan);
  assert.equal(result.source, 'study-center-public-adapter');
  assert.equal(calls[0].url, 'http://127.0.0.1:4316/api/plan');
  assert.deepEqual(JSON.parse(calls[0].options.body), { dailyNewLimit:8, dailyReviewLimit:12, dailyTotalLimit:20 });
  await application.stop();
});

test('Desktop application refuses a second process-local writer for one dataRoot', async () => {
  const dataRoot = join(process.cwd(), 'tmp', 'study-center-single-writer-contract');
  const first = createStudyCenterDesktopApplication({ dataRoot, libraryFile, spawnRuntime: createFakeRuntime() });
  const second = createStudyCenterDesktopApplication({ dataRoot, libraryFile, spawnRuntime: createFakeRuntime() });
  await first.start();
  await assert.rejects(() => second.start(), { code: 'STUDY_CENTER_SINGLE_WRITER_CONFLICT' });
  await first.stop();
});
