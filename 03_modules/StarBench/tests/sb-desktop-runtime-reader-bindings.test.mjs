import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

import { importRawResult, validateCanonicalEvaluation } from '../src/raw-result-importer.mjs';
import {
  STARBENCH_DESKTOP_CAPABILITIES,
  STARBENCH_DESKTOP_HANDOFF_CONTRACT,
  STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT,
  STARBENCH_DESKTOP_RUNTIME_READER_BINDING_VERSION,
  createStarBenchDesktopApplication,
  createStarBenchDesktopRuntimeReaderBindings,
} from '../src/public/starbench-desktop-entry.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(projectRoot, 'tests', 'fixtures');
const tempRoots = [];
async function temporaryRoot() { const root = await mkdtemp(join(tmpdir(), 'starbench-desktop-readers-')); tempRoots.push(root); return root; }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function writeJsonl(path, records) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${records.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8'); }
afterEach(async () => { await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

test('machine-readable Runtime Reader Binding contract matches the public contract', async () => {
  const manifest = await json(resolve(projectRoot, 'contracts', 'starbench-desktop-runtime-reader-bindings-v0.1.json'));
  assert.deepEqual(manifest, STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT);
  assert.equal(manifest.contract_version, STARBENCH_DESKTOP_RUNTIME_READER_BINDING_VERSION);
});

test('binding factory is exported only through the stable Desktop public entrypoint', async () => {
  const entry = await import('../src/public/starbench-desktop-entry.mjs');
  assert.equal(typeof entry.createStarBenchDesktopRuntimeReaderBindings, 'function');
  assert.equal(STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.public_entrypoint, STARBENCH_DESKTOP_HANDOFF_CONTRACT.entrypoint);
});

test('factory returns exactly six frozen read functions', () => {
  const bindings = createStarBenchDesktopRuntimeReaderBindings();
  assert.deepEqual(Object.keys(bindings), STARBENCH_DESKTOP_CAPABILITIES);
  assert.ok(Object.values(bindings).every((reader) => typeof reader === 'function'));
  assert.equal(Object.isFrozen(bindings), true);
});

test('missing runtime data root leaves every binding explicitly unavailable', async () => {
  const bindings = createStarBenchDesktopRuntimeReaderBindings();
  for (const reader of Object.values(bindings)) assert.equal((await reader()).status, 'unavailable');
});

test('empty runtime root reports empty for existing Store-backed readers', async () => {
  const root = await temporaryRoot();
  const bindings = createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root });
  for (const capability of ['evaluation_results', 'evaluation_history', 'evidence', 'token_cost_observations']) {
    const result = await bindings[capability]();
    assert.equal(result.status, 'empty');
    assert.equal(result.summary.product_state, 'EMPTY');
    assert.equal(result.summary.source_health, 'HEALTHY');
    assert.equal(result.summary.user_configuration_required, false);
    assert.ok(result.summary.checked_at);
  }
});

test('evaluation history reads existing Canonical Evaluation without mutation', async () => {
  const root = await temporaryRoot();
  const raw = await json(resolve(fixtureRoot, 'raw-result-success.json'));
  const evaluation = importRawResult(raw);
  await writeJsonl(join(root, 'evaluations', 'evaluations.jsonl'), [evaluation]);
  const result = await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }).evaluation_history();
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.items, [evaluation]);
  assert.deepEqual(validateCanonicalEvaluation(result.items[0]), { valid: true, errors: [] });
});

test('evaluation results binding reuses the existing ScoreStore and returns empty honestly', async () => {
  const root = await temporaryRoot();
  assert.equal((await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }).evaluation_results()).status, 'empty');
});

test('evidence binding reuses the existing ScoreStore and returns empty honestly', async () => {
  const root = await temporaryRoot();
  assert.equal((await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }).evidence()).status, 'empty');
});

test('request records binding is formal but unavailable without a production Ledger source', async () => {
  const root = await temporaryRoot();
  const result = await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }).request_records();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.summary.reason_code, 'REQUEST_LEDGER_RUNTIME_SOURCE_NOT_AVAILABLE');
  assert.equal(result.summary.product_state, 'UNAVAILABLE');
  assert.equal(result.summary.user_status.label, '能力尚不可用');
  assert.equal(result.summary.user_configuration_required, false);
});

test('Token Cost binding reuses existing HistoricalUsageStore and preserves null cost', async () => {
  const root = await temporaryRoot();
  const target = join(root, 'token-accounting', 'historical-usage.jsonl');
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(fixtureRoot, 'token-intelligence', 'historical-usage-known.jsonl'), target);
  const result = await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }).token_cost_observations();
  assert.equal(result.status, 'ready');
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((item) => item.cost === null && item.total_tokens !== null));
});

test('external identity evidence binding is formal but unavailable without a persisted Canonical source', async () => {
  const root = await temporaryRoot();
  const result = await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }).external_identity_evidence();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.summary.reason_code, 'EXTERNAL_IDENTITY_RUNTIME_SOURCE_NOT_AVAILABLE');
  assert.equal(result.summary.product_state, 'UNAVAILABLE');
  assert.equal(result.summary.safety_notice, '外部身份参考不得证明官方身份。');
});

test('bounded pagination reports partial with an opaque cursor', async () => {
  const root = await temporaryRoot();
  const raw = await json(resolve(fixtureRoot, 'raw-result-success.json'));
  const secondRaw = structuredClone(raw); secondRaw.run_id = 'run_fixture_success_2'; secondRaw.request_provenance.request_id = 'fixture-request-success-2';
  await writeJsonl(join(root, 'evaluations', 'evaluations.jsonl'), [importRawResult(raw), importRawResult(secondRaw)]);
  const bindings = createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root });
  const first = await bindings.evaluation_history({ limit: 1 });
  const second = await bindings.evaluation_history({ limit: 1, cursor: first.cursor });
  assert.equal(first.status, 'partial');
  assert.equal(first.cursor, '1');
  assert.equal(second.status, 'ready');
  assert.equal(second.cursor, null);
});

test('configured age policy reports stale without changing evidence', async () => {
  const root = await temporaryRoot();
  const evaluation = importRawResult(await json(resolve(fixtureRoot, 'raw-result-success.json')));
  await writeJsonl(join(root, 'evaluations', 'evaluations.jsonl'), [evaluation]);
  const result = await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root, staleAfterMs: 1, clock: () => '2100-01-01T00:00:00.000Z' }).evaluation_history();
  assert.equal(result.status, 'stale');
  assert.deepEqual(result.items, [evaluation]);
});

test('storage failures are projected to error without private path, stack, or internal user copy', async () => {
  const root = await temporaryRoot();
  const blockedPath = join(root, 'evaluations', 'evaluations.jsonl');
  await mkdir(blockedPath, { recursive: true });
  const result = await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }).evaluation_history();
  const serialized = JSON.stringify(result);
  assert.equal(result.status, 'error');
  assert.equal(result.summary.product_state, 'ERROR');
  assert.equal(result.summary.user_status.label, '读取暂时失败');
  assert.doesNotMatch(JSON.stringify(result.summary.user_status), /Canonical Identity|Core|Store|Ledger|Desktop handoff/u);
  assert.equal(serialized.includes(blockedPath), false);
  assert.equal(serialized.includes('stack'), false);
});

test('malformed persisted Canonical Evaluation fails closed as an error', async () => {
  const root = await temporaryRoot();
  await writeJsonl(join(root, 'evaluations', 'evaluations.jsonl'), [{ record_type: 'CANONICAL_EVALUATION', malformed: true }]);
  assert.equal((await createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }).evaluation_history()).status, 'error');
});

test('runtime bindings integrate directly with the existing Desktop Application factory', async () => {
  const root = await temporaryRoot();
  const app = createStarBenchDesktopApplication({ readers: createStarBenchDesktopRuntimeReaderBindings({ dataRoot: root }) });
  assert.equal((await app.start()).status, 'ready');
  assert.equal((await app.read('evaluation_history')).status, 'empty');
  assert.equal((await app.read('request_records')).status, 'unavailable');
});

test('runtime binding exposes no Store, path, write, execute, ingest, mutation, or Credential capability', () => {
  const bindings = createStarBenchDesktopRuntimeReaderBindings();
  const serialized = JSON.stringify(bindings);
  assert.equal(serialized, '{}');
  for (const forbidden of ['write', 'create', 'update', 'delete', 'execute', 'mutate', 'ingest', 'finalize', 'credential', 'dataRoot']) assert.equal(Object.hasOwn(bindings, forbidden), false);
});

test('StarBench retains composition ownership and private Store exposure is false', () => {
  assert.equal(STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.ownership, 'STARBENCH_INTERNAL_COMPOSITION');
  assert.equal(STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.private_store_exposure, false);
  assert.equal(STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.write_capability_exposed, false);
});

test('Canonical Identity and External Engine authority semantics remain frozen', () => {
  assert.equal(STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.canonical_identity_authority, 'STARBENCH');
  assert.equal(STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.external_identity_engine_role, 'UNTRUSTED_EXTERNAL_EVIDENCE');
  assert.equal(STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT.officiality_inference, 'NOT_ALLOWED');
});

test('implementation composes existing Stores without defining a second Store or Ledger', async () => {
  const source = await readFile(resolve(projectRoot, 'src', 'public', 'starbench-runtime-reader-bindings.mjs'), 'utf8');
  assert.match(source, /EvaluationStore/u);
  assert.match(source, /ScoreStore/u);
  assert.match(source, /HistoricalUsageStore/u);
  assert.doesNotMatch(source, /class\s+\w*(?:Store|Ledger)|\.write\s*\(|\.append\s*\(/u);
});

test('implementation contains no Provider, external execution, Credential, or network client', async () => {
  const source = await readFile(resolve(projectRoot, 'src', 'public', 'starbench-runtime-reader-bindings.mjs'), 'utf8');
  assert.doesNotMatch(source, /provider-adapter|external-identity-engine-runner|credential-provider|node:https|node:http|fetch\s*\(|spawn\s*\(|execFile\s*\(/u);
});
