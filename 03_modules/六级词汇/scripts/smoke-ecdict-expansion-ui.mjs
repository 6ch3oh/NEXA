import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pilotData = join(moduleRoot, 'data', 'ecdict-pilot');
const expansionData = join(moduleRoot, 'data', 'ecdict-qualified');
const current = join(expansionData, 'current');
const smoke = join(expansionData, 'ui-smoke');
await mkdir(smoke, { recursive: true });
await copyFile(join(pilotData, 'learner-state.json'), join(smoke, 'learner-state.json'));
const libraryPayload = JSON.parse(await readFile(join(current, 'vocabulary-library.json'), 'utf8'));
const previewEntry = structuredClone(libraryPayload.entries[0]);
previewEntry.entryId = 'cet6:ui-smoke:preview-only';
previewEntry.headword = 'previewword';
previewEntry.normalizedHeadword = 'previewword';

const port = 46000 + (process.pid % 1000);
const child = spawn(process.execPath, [
  'ui/server.mjs', '--port', String(port),
  '--data-file', join(smoke, 'learner-state.json'),
  '--preferences-file', join(smoke, 'plans.json'),
  '--vocabulary-library-file', join(current, 'vocabulary-library.json'),
  '--pronunciation-cache-directory', join(smoke, 'pronunciation-cache'),
  '--learner-id', 'ecdict-pilot-learner',
], { cwd: moduleRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server start timeout: ${stderr}`)), 20_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('NEXA Local Study Center')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderr}`)); });
  });

  const base = `http://127.0.0.1:${port}`;
  const htmlTimed = await timedFetch(base);
  const bootstrapTimed = await timedFetch(`${base}/api/bootstrap`, true);
  const diagnosticsTimed = await timedFetch(`${base}/api/diagnostics`, true);
  const ascTimed = await timedFetch(`${base}/api/personal?kind=all&page=1&pageSize=50&sort=word-asc`, true);
  const descTimed = await timedFetch(`${base}/api/personal?kind=all&page=1&pageSize=50&sort=word-desc`, true);
  const expandedPageTimed = await timedFetch(`${base}/api/personal?kind=all&page=3&pageSize=50&sort=word-asc`, true);
  const searchTimed = await timedFetch(`${base}/api/personal?kind=all&query=ab&page=1&pageSize=10&sort=word-asc`, true);
  const filterTimed = await timedFetch(`${base}/api/personal?kind=learning&page=1&pageSize=50&sort=due-asc`, true);

  assert.match(htmlTimed.value, /NEXA/u);
  const bootstrap = bootstrapTimed.value;
  const diagnostics = diagnosticsTimed.value;
  const stageCounts = bootstrap.home.statistics.stages;
  assert.equal(bootstrap.mode, 'PERSISTED_LOCAL_LIBRARY');
  assert.equal(Object.values(stageCounts).reduce((sum, count) => sum + count, 0), 5_311);
  assert.equal(bootstrap.queue.total, 14);
  assert.equal(diagnostics.content.total, 5_311);
  assert.equal(diagnostics.content.realThirdPartyCount, 5_311);
  assert.equal(diagnostics.content.syntheticCount, 0);
  assert.equal(diagnostics.content.sources[0].classification, 'THIRD_PARTY');
  assert.equal(diagnostics.content.realCET6Status, 'CET6_THIRD_PARTY_REAL_COLLECTION_READY');
  assert.equal(diagnostics.content.sources[0].redistributionStatus, 'REDISTRIBUTION_NOT_ESTABLISHED');
  assert.equal(diagnostics.runtime.networkDependency, 0);
  assert.equal(ascTimed.value.total, 5_311);
  assert.equal(ascTimed.value.items.length, 50);
  assert.ok(ascTimed.value.items[0].word.localeCompare(descTimed.value.items[0].word, 'en') <= 0);
  assert.ok(searchTimed.value.total > 0);
  assert.ok(filterTimed.value.total > 0);

  const stageEntry = expandedPageTimed.value.items[0];
  const openTimed = await timedFetch(`${base}/api/open`, true, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId: stageEntry.entryId }),
  });
  assert.ok(openTimed.value.word);
  assert.ok(openTimed.value.definitions.length > 0);

  const planTimed = await timedFetch(`${base}/api/plan`, true, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dailyNewLimit: 10, dailyReviewLimit: 10, dailyTotalLimit: 20 }),
  });
  assert.equal(planTimed.value.home.plan.dailyTotalLimit, 20);
  const importPreviewTimed = await timedFetch(`${base}/api/import/preview`, true, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: JSON.stringify([previewEntry]),
      source: { title: 'UI Smoke Preview Only', classification: 'USER_PROVIDED' },
    }),
  });
  assert.equal(importPreviewTimed.value.ok, true);
  assert.equal(importPreviewTimed.value.entryCount, 1);
  assert.equal(importPreviewTimed.value.mutationCount, 0);
  const afterPreviewTimed = await timedFetch(`${base}/api/diagnostics`, true);
  assert.equal(afterPreviewTimed.value.content.total, 5_311);

  const result = {
    status: 'PASS',
    collectionCount: 5_311,
    mode: bootstrap.mode,
    home: 'PASS',
    todayQueue: { status: 'PASS', total: bootstrap.queue.total, counts: bootstrap.queue.counts },
    studyCard: { status: 'PASS', word: openTimed.value.word },
    personalVocabulary: { status: 'PASS', total: ascTimed.value.total, pageSize: ascTimed.value.items.length },
    search: 'PASS', filtering: 'PASS', paging: 'PASS', sorting: 'PASS', statistics: 'PASS', planSettings: 'PASS',
    importPreview: { status: 'PASS', mutationCount: importPreviewTimed.value.mutationCount, collectionCountAfterPreview: afterPreviewTimed.value.content.total },
    source: diagnostics.content.sources[0],
    pronunciation: diagnostics.pronunciation,
    runtimeNetworkDependency: diagnostics.runtime.networkDependency,
    responseMs: {
      html: round(htmlTimed.ms), bootstrap: round(bootstrapTimed.ms), diagnostics: round(diagnosticsTimed.ms),
      personalAsc: round(ascTimed.ms), personalDesc: round(descTimed.ms), expandedPage: round(expandedPageTimed.ms), search: round(searchTimed.ms),
      filter: round(filterTimed.ms), openCard: round(openTimed.ms), updatePlan: round(planTimed.ms),
      importPreview: round(importPreviewTimed.ms), afterPreviewDiagnostics: round(afterPreviewTimed.ms),
    },
  };
  await writeFile(join(expansionData, 'ui-http-smoke.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
}

async function timedFetch(url, json = false, options = {}) {
  const started = performance.now();
  const response = await fetch(url, options);
  const value = json ? await response.json() : await response.text();
  const ms = performance.now() - started;
  assert.equal(response.status, 200, `${url}: ${JSON.stringify(value)}`);
  return { value, ms };
}

function round(value) { return Math.round(value * 1_000) / 1_000; }
