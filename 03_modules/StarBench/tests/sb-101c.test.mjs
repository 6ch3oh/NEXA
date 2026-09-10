import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BenchmarkHarness } from '../src/benchmark-harness.mjs';
import { OfflineBenchmarkRunner } from '../src/benchmark-runner.mjs';
import {
  assertValidBenchmarkSuite,
  computeSuiteIdentity,
  loadBenchmarkSuite,
  resolveBenchmarkSuite,
} from '../src/benchmark-suite-loader.mjs';
import {
  assertValidBenchmarkTask,
  BenchmarkTaskRegistry,
  computePromptIdentity,
  computeTaskDefinitionSha256,
  computeTaskIdentity,
  loadBenchmarkTask,
  validateBenchmarkTask,
} from '../src/benchmark-task-loader.mjs';
import { FakeCredentialProvider } from '../src/credential-provider.mjs';
import { EvaluationStore } from '../src/evaluation-store.mjs';
import { FakeLocalProviderAdapter } from '../src/provider-adapter.mjs';
import { RawResultWriter } from '../src/raw-result-writer.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '..');
const fixtureDir = resolve(testDir, 'fixtures');
const tempRoot = resolve(testDir, '.tmp-sb-101c');
const taskNames = ['planning', 'coding', 'instruction'];
let networkRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests += 1; throw new Error('NETWORK_FORBIDDEN'); };

after(async () => {
  globalThis.fetch = originalFetch;
  await rm(tempRoot, { recursive: true, force: true });
});

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function taskFixture(name) { return json(resolve(fixtureDir, `benchmark-task-${name}.json`)); }
async function suiteFixture() { return json(resolve(fixtureDir, 'benchmark-suite-basic.json')); }

async function registryWithFixtures() {
  const registry = new BenchmarkTaskRegistry();
  for (const name of taskNames) registry.register(await loadBenchmarkTask(resolve(fixtureDir, `benchmark-task-${name}.json`), { rootDir: projectRoot }));
  return registry;
}

test('Benchmark Task and Suite V0.1 schemas load offline', async () => {
  const taskSchema = await json(resolve(projectRoot, 'schemas', 'benchmark-task-v0.1.schema.json'));
  const suiteSchema = await json(resolve(projectRoot, 'schemas', 'benchmark-suite-v0.1.schema.json'));
  assert.equal(taskSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(taskSchema.properties.record_type.const, 'BENCHMARK_TASK');
  assert.equal(suiteSchema.properties.record_type.const, 'BENCHMARK_SUITE');
});

test('three legal task fixtures load with required categories and source boundary', async () => {
  const tasks = await Promise.all(taskNames.map((name) => loadBenchmarkTask(resolve(fixtureDir, `benchmark-task-${name}.json`), { rootDir: projectRoot })));
  assert.deepEqual(tasks.map((task) => task.category), ['planning', 'coding', 'instruction_following']);
  assert.deepEqual(tasks.map((task) => task.source_class), ['TEST_FIXTURE', 'TEST_FIXTURE', 'TEST_FIXTURE']);
  assert.deepEqual(tasks.map((task) => task.evaluation_method.type), ['rule_based', 'deterministic', 'exact_match']);
});

test('invalid task and mismatched prompt identity fail closed', async () => {
  const missingName = await taskFixture('planning');
  delete missingName.name;
  assert.equal(validateBenchmarkTask(missingName).valid, false);
  const changedPrompt = await taskFixture('planning');
  changedPrompt.prompt.instruction += ' Changed.';
  const checked = validateBenchmarkTask(changedPrompt);
  assert.equal(checked.valid, false);
  assert.equal(checked.errors.some((error) => error.code === 'identity_mismatch'), true);
});

test('task identity and task definition hash are stable and distinct from run identity', async () => {
  const task = await taskFixture('planning');
  assert.deepEqual(computeTaskIdentity(task), computeTaskIdentity(structuredClone(task)));
  assert.equal(computeTaskDefinitionSha256(task), computeTaskDefinitionSha256(structuredClone(task)));
  assert.equal(computeTaskIdentity(task).task_id, task.benchmark_task_id);
  assert.notEqual(computeTaskIdentity(task).task_id, 'run_fixture_1');
});

test('prompt identity is canonical, stable, and changes with prompt content', async () => {
  const task = await taskFixture('coding');
  const reordered = structuredClone(task);
  reordered.prompt = { input_template: task.prompt.input_template, instruction: task.prompt.instruction };
  reordered.input_definition = Object.fromEntries(Object.entries(task.input_definition).reverse());
  assert.deepEqual(computePromptIdentity(task), task.prompt_identity);
  assert.deepEqual(computePromptIdentity(reordered), task.prompt_identity);
  const changed = structuredClone(task);
  changed.prompt.input_template += '\nReturn no comments.';
  assert.notEqual(computePromptIdentity(changed).prompt_id, task.prompt_identity.prompt_id);
});

test('runtime Credential is rejected from task, prompt, and suite identities', async () => {
  const credential = await new FakeCredentialProvider().getCredential();
  const task = await taskFixture('instruction');
  task.metadata.runtime_credential = credential;
  assert.throws(() => computePromptIdentity(task), { code: 'SENSITIVE_DATA_REJECTED' });
  assert.throws(() => computeTaskIdentity(task), { code: 'SENSITIVE_DATA_REJECTED' });
  const suite = await suiteFixture();
  suite.metadata.runtime_credential = credential;
  assert.throws(() => computeSuiteIdentity(suite), { code: 'SENSITIVE_DATA_REJECTED' });
});

test('LEGACY_SUMMARY cannot enter Task or Suite loaders', () => {
  assert.throws(() => assertValidBenchmarkTask({ record_type: 'LEGACY_SUMMARY' }), { code: 'LEGACY_SUMMARY_REJECTED' });
  assert.throws(() => assertValidBenchmarkSuite({ record_type: 'LEGACY_SUMMARY' }), { code: 'LEGACY_SUMMARY_REJECTED' });
});

test('task registry resolves stable id and version and rejects duplicates', async () => {
  const registry = await registryWithFixtures();
  assert.equal(registry.list().length, 3);
  assert.equal(registry.get('fixture.coding.sum', '1.0.0').category, 'coding');
  const duplicate = await taskFixture('coding');
  assert.throws(() => registry.register(duplicate), { code: 'BENCHMARK_TASK_DUPLICATE' });
});

test('Suite loader resolves references in deterministic declared order', async () => {
  const registry = await registryWithFixtures();
  const first = await loadBenchmarkSuite(resolve(fixtureDir, 'benchmark-suite-basic.json'), { rootDir: projectRoot, registry });
  const second = resolveBenchmarkSuite(await suiteFixture(), registry);
  const expected = ['fixture.planning.rollout', 'fixture.coding.sum', 'fixture.instruction.blue'];
  assert.deepEqual(first.tasks.map((entry) => entry.task.benchmark_task_id), expected);
  assert.deepEqual(second.tasks.map((entry) => entry.task.benchmark_task_id), expected);
  assert.deepEqual(first.suite_identity, second.suite_identity);
  assert.match(first.suite_identity.suite_definition_sha256, /^[a-f0-9]{64}$/u);
});

test('Suite loader rejects missing and duplicate task references', async () => {
  const registry = await registryWithFixtures();
  const missing = await suiteFixture();
  missing.task_references[0].benchmark_task_id = 'fixture.missing.task';
  assert.throws(() => resolveBenchmarkSuite(missing, registry), { code: 'BENCHMARK_TASK_REFERENCE_MISSING' });
  const duplicate = await suiteFixture();
  duplicate.task_references[1] = { ...duplicate.task_references[0], order: 31 };
  assert.throws(() => resolveBenchmarkSuite(duplicate, registry), { code: 'BENCHMARK_SUITE_INVALID' });
});

test('Task and Suite loaders reject paths outside their root', async () => {
  await assert.rejects(loadBenchmarkTask(resolve(projectRoot, 'README.md'), { rootDir: fixtureDir }), { code: 'TASK_PATH_ESCAPE' });
  await assert.rejects(loadBenchmarkSuite(resolve(projectRoot, 'README.md'), { rootDir: fixtureDir, registry: new BenchmarkTaskRegistry() }), { code: 'SUITE_PATH_ESCAPE' });
});

test('Offline Runner reuses Harness for deterministic three-task end-to-end flow', async () => {
  const registry = await registryWithFixtures();
  const suite = await loadBenchmarkSuite(resolve(fixtureDir, 'benchmark-suite-basic.json'), { rootDir: projectRoot, registry });
  const rawWriter = new RawResultWriter({ rootDir: projectRoot, filePath: resolve(tempRoot, 'e2e', 'raw.jsonl') });
  const store = new EvaluationStore({ rootDir: projectRoot, filePath: resolve(tempRoot, 'e2e', 'evaluations.jsonl') });
  const executedTasks = [];
  const adapter = new FakeLocalProviderAdapter({ executeHook: async ({ task }) => {
    executedTasks.push(task.benchmark_task);
    assert.equal(typeof task.prompt.instruction, 'string');
    assert.equal(typeof task.input_definition, 'object');
    return { success: true, usage: {}, ttft_ms: null, cost: null, request_metadata: {}, metadata: { fixture_execution: true } };
  } });
  const credentialProvider = new FakeCredentialProvider();
  let runNumber = 0;
  let monotonic = 0;
  const harness = new BenchmarkHarness({
    adapter,
    credentialProvider,
    writer: rawWriter,
    runIdFactory: () => `run_suite_${++runNumber}`,
    clock: { now: () => new Date('2099-06-01T00:00:00.000Z'), monotonicNow: () => { monotonic += 5; return monotonic; } },
  });
  const runner = new OfflineBenchmarkRunner({ harness, store });
  const output = await runner.runSuite(suite);
  const expected = ['fixture.planning.rollout', 'fixture.coding.sum', 'fixture.instruction.blue'];
  assert.deepEqual(executedTasks, expected);
  assert.deepEqual(output.results.map((result) => result.benchmark_task_id), expected);
  assert.equal(adapter.callCount, 3);
  assert.equal(credentialProvider.accessCount, 3);
  assert.equal((await rawWriter.readAll()).length, 3);
  assert.equal((await store.readAll()).length, 3);
});

test('RAW_RESULT and Canonical Evaluation retain task, prompt, suite, and run traceability', async () => {
  const registry = await registryWithFixtures();
  const suite = await loadBenchmarkSuite(resolve(fixtureDir, 'benchmark-suite-basic.json'), { rootDir: projectRoot, registry });
  const rawWriter = new RawResultWriter({ rootDir: projectRoot, filePath: resolve(tempRoot, 'trace', 'raw.jsonl') });
  const store = new EvaluationStore({ rootDir: projectRoot, filePath: resolve(tempRoot, 'trace', 'evaluations.jsonl') });
  let runNumber = 0;
  const harness = new BenchmarkHarness({
    adapter: new FakeLocalProviderAdapter(), credentialProvider: new FakeCredentialProvider(), writer: rawWriter,
    runIdFactory: () => `run_trace_${++runNumber}`,
    clock: { now: () => new Date('2099-06-02T00:00:00.000Z'), monotonicNow: (() => { let value = 0; return () => ++value; })() },
  });
  const output = await new OfflineBenchmarkRunner({ harness, store }).runSuite(suite);
  for (const result of output.results) {
    assert.notEqual(result.raw_result.run_id, result.raw_result.task_identity.task_id);
    assert.equal(result.raw_result.benchmark_task, result.benchmark_task_id);
    assert.equal(result.raw_result.task_identity.task_id, result.benchmark_task_id);
    assert.deepEqual(result.raw_result.prompt_identity, result.prompt_identity);
    assert.deepEqual(result.raw_result.metadata.suite_identity, suite.suite_identity);
    assert.deepEqual(result.evaluation.task_identity, result.raw_result.task_identity);
    assert.deepEqual(result.evaluation.provenance.prompt_identity, result.prompt_identity);
    assert.deepEqual(result.evaluation.metadata.suite_identity, suite.suite_identity);
    assert.equal((await store.queryByRunId(result.raw_result.run_id)).length, 1);
    assert.equal((await store.queryByBenchmarkTask(result.benchmark_task_id)).length, 1);
  }
});

test('definitions declare metrics and evaluation contracts without fabricated scores', async () => {
  for (const name of taskNames) {
    const task = await taskFixture(name);
    assert.equal(Array.isArray(task.metrics), true);
    assert.equal(typeof task.evaluation_method.type, 'string');
    assert.equal('score' in task.metadata, false);
    assert.equal(task.metadata.real_model_score, false);
  }
});

test('new implementation contains no network client and uses Fake Provider only', async () => {
  const sources = await Promise.all(['benchmark-task-loader.mjs', 'benchmark-suite-loader.mjs', 'benchmark-runner.mjs'].map((name) => readFile(resolve(projectRoot, 'src', name), 'utf8')));
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /\bfetch\s*\(|https?\.request\s*\(|from ['"](?:axios|openai)['"]/u);
  const adapter = new FakeLocalProviderAdapter();
  assert.equal(adapter.endpointClass, 'LOCAL_ONLY');
  assert.equal(networkRequests, 0);
});

test('network request count remains zero', () => {
  assert.equal(networkRequests, 0);
});
