import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const data = join(moduleRoot, 'data', 'ecdict-pilot');
await mkdir(join(data, 'ui-smoke'), { recursive: true });
const port = 45000 + (process.pid % 1000);
const child = spawn(process.execPath, [
  'ui/server.mjs', '--port', String(port),
  '--data-file', join(data, 'learner-state.json'),
  '--preferences-file', join(data, 'ui-smoke', 'plans.json'),
  '--vocabulary-library-file', join(data, 'vocabulary-library.json'),
  '--pronunciation-cache-directory', join(data, 'pronunciation-cache'),
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
  const [htmlResponse, bootstrapResponse, diagnosticsResponse, personalResponse] = await Promise.all([
    fetch(base), fetch(`${base}/api/bootstrap`), fetch(`${base}/api/diagnostics`), fetch(`${base}/api/personal?kind=all&page=1&pageSize=10`),
  ]);
  assert.equal(htmlResponse.status, 200);
  assert.match(await htmlResponse.text(), /NEXA/u);
  const bootstrap = await bootstrapResponse.json();
  const diagnostics = await diagnosticsResponse.json();
  const personal = await personalResponse.json();
  assert.equal(bootstrap.mode, 'PERSISTED_LOCAL_LIBRARY');
  assert.ok(bootstrap.queue.total > 0);
  assert.equal(diagnostics.content.realThirdPartyCount, 100);
  assert.equal(diagnostics.content.syntheticCount, 0);
  assert.equal(diagnostics.content.sources[0].classification, 'THIRD_PARTY');
  assert.equal(diagnostics.pronunciation.usStatus, 'LOCAL_US_PRONUNCIATION_READY');
  assert.equal(diagnostics.pronunciation.ukStatus, 'LOCAL_UK_PRONUNCIATION_READY');
  assert.equal(diagnostics.pronunciation.dualAccentStatus, 'DUAL_ACCENT_LOCAL_TTS_READY');
  assert.equal(diagnostics.pronunciation.defaultAccent, 'us');
  assert.equal(diagnostics.pronunciation.networkTts, false);
  assert.equal(diagnostics.runtime.networkDependency, 0);
  assert.equal(personal.total, 100);
  const entryId = bootstrap.queue.items[0].entryId;
  const open = await fetch(`${base}/api/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entryId }) });
  assert.equal(open.status, 200);
  const card = await open.json();
  assert.ok(card.word);
  assert.equal(card.usPhonetic, null);
  assert.ok(Array.isArray(card.definitions));
  const result = {
    status: 'PASS', http: 200, mode: bootstrap.mode, queue: bootstrap.queue.total,
    home: true, todaySession: true, studyCard: card.word, personalVocabulary: personal.total,
    statistics: bootstrap.home.statistics, planSettings: bootstrap.home.plan,
    diagnostics: {
      realThirdPartyCount: diagnostics.content.realThirdPartyCount,
      syntheticCount: diagnostics.content.syntheticCount,
      source: diagnostics.content.sources[0],
      pronunciation: diagnostics.pronunciation,
      networkDependency: diagnostics.runtime.networkDependency,
    },
  };
  await writeFile(join(data, 'ui-http-smoke.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}
