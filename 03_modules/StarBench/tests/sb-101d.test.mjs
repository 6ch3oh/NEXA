import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BenchmarkHarness } from '../src/benchmark-harness.mjs';
import { OfflineBenchmarkRunner } from '../src/benchmark-runner.mjs';
import { loadBenchmarkSuite } from '../src/benchmark-suite-loader.mjs';
import { BenchmarkTaskRegistry, loadBenchmarkTask } from '../src/benchmark-task-loader.mjs';
import { FakeCredentialProvider } from '../src/credential-provider.mjs';
import { EvaluationStore } from '../src/evaluation-store.mjs';
import { FakeLocalProviderAdapter } from '../src/provider-adapter.mjs';
import { importRawResult } from '../src/raw-result-importer.mjs';
import { RawResultWriter } from '../src/raw-result-writer.mjs';
import { scoreExactMatch } from '../src/scoring/exact-match-scorer.mjs';
import { scoreNumeric } from '../src/scoring/numeric-scorer.mjs';
import { scoreRules } from '../src/scoring/rule-based-scorer.mjs';
import { aggregateSuiteScores } from '../src/scoring/score-aggregator.mjs';
import { validateMetricDefinition, validateScoreResult } from '../src/scoring/score-contracts.mjs';
import { OfflineScoreEngine } from '../src/scoring/score-engine.mjs';
import { ScoreStore } from '../src/scoring/score-store.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '..');
const fixtureDir = resolve(testDir, 'fixtures');
const tempRoot = resolve(testDir, '.tmp-sb-101d');
const fixedClock = { now: () => new Date('2099-08-01T00:00:00.000Z') };
let networkRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests += 1; throw new Error('NETWORK_FORBIDDEN'); };

after(async () => {
  globalThis.fetch = originalFetch;
  await rm(tempRoot, { recursive: true, force: true });
});

async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function scoringTask(name) { return loadBenchmarkTask(resolve(fixtureDir, `scoring-task-${name}.json`), { rootDir: projectRoot }); }

async function makeEvaluation(task, { latencyMs = 10, runId = 'run_scoring_unit', suiteId = 'fixture.scoring.suite' } = {}) {
  const raw = await json(resolve(fixtureDir, 'raw-result-success.json'));
  raw.run_id = runId;
  raw.timestamp = '2099-08-01T00:00:00.000Z';
  raw.benchmark_task = task.benchmark_task_id;
  raw.task_identity = { task_id: task.benchmark_task_id, task_version: task.version };
  raw.prompt_identity = structuredClone(task.prompt_identity);
  raw.latency_ms = latencyMs;
  raw.metadata = { fixture: true, suite_identity: { suite_id: suiteId, suite_version: '1.0.0', suite_definition_sha256: 'a'.repeat(64) } };
  return importRawResult(raw);
}

function metricFrom(task, metricId) {
  return task.evaluation_method.config.metric_definitions.find((metric) => metric.metric_id === metricId);
}

test('Metric Definition and Score Result V0.1 schemas load offline', async () => {
  const metricSchema = await json(resolve(projectRoot, 'schemas', 'metric-definition-v0.1.schema.json'));
  const scoreSchema = await json(resolve(projectRoot, 'schemas', 'score-result-v0.1.schema.json'));
  assert.equal(metricSchema.properties.record_type.const, 'METRIC_DEFINITION');
  assert.deepEqual(metricSchema.properties.direction.enum, ['higher_is_better', 'lower_is_better']);
  assert.equal(scoreSchema.properties.record_type.const, 'SCORE_RESULT');
  assert.deepEqual(scoreSchema.properties.normalized_score.maximum, 1);
});

test('scoring task fixtures load and all Metric Definitions validate', async () => {
  for (const name of ['exact', 'rules']) {
    const task = await scoringTask(name);
    for (const metric of task.evaluation_method.config.metric_definitions) assert.equal(validateMetricDefinition(metric).valid, true);
    assert.deepEqual(task.metrics, task.evaluation_method.config.metric_definitions.map((metric) => metric.metric_id));
  }
});

test('Exact Match supports strict PASS and FAIL', () => {
  assert.equal(scoreExactMatch({ actual: 'BLUE', expected: 'BLUE' }).normalized_score, 1);
  assert.equal(scoreExactMatch({ actual: 'blue', expected: 'BLUE' }).normalized_score, 0);
});

test('Exact Match applies only explicit trim, case, and newline normalization', () => {
  const normalized = scoreExactMatch({ actual: ' blue\r\n', expected: 'BLUE', normalization: ['trim', 'newline_lf', 'lowercase'] });
  assert.equal(normalized.normalized_score, 1);
  assert.deepEqual(normalized.provenance.normalization, ['trim', 'newline_lf', 'lowercase']);
  assert.throws(() => scoreExactMatch({ actual: 'BLUE', expected: 'BLUE', normalization: ['semantic_magic'] }), { code: 'EXACT_MATCH_NORMALIZATION_INVALID' });
});

test('Rule scorer handles contains, not_contains, and regex from task definition', () => {
  const rules = [
    { rule_id: 'contains', type: 'contains', value: 'BLUE' },
    { rule_id: 'not-contains', type: 'not_contains', value: 'RED' },
    { rule_id: 'regex', type: 'regex', pattern: '^BLUE', flags: 'u' },
  ];
  const result = scoreRules({ actual: 'BLUE plan', rules });
  assert.equal(result.normalized_score, 1);
  assert.equal(result.raw_value.passed, 3);
});

test('Rule scorer handles numeric_range and required_fields', () => {
  assert.equal(scoreRules({ actual: 7, rules: [{ rule_id: 'range', type: 'numeric_range', min: 5, max: 10 }] }).normalized_score, 1);
  const fields = scoreRules({ actual: { plan: [], risk: true }, rules: [{ rule_id: 'fields', type: 'required_fields', fields: ['plan', 'risk'] }] });
  assert.equal(fields.normalized_score, 1);
  assert.throws(() => scoreRules({ actual: 'x', rules: [{ rule_id: 'bad', type: 'regex', pattern: '[', flags: 'u' }] }), { code: 'RULE_CONFIG_INVALID' });
});

test('Numeric scorer supports higher and lower direction with bounded normalization', () => {
  const normalization = { method: 'min_max', min: 0, max: 100, clamp: true };
  assert.equal(scoreNumeric({ value: 75, direction: 'higher_is_better', normalization }).normalized_score, 0.75);
  assert.equal(scoreNumeric({ value: 75, direction: 'lower_is_better', normalization }).normalized_score, 0.25);
  assert.equal(scoreNumeric({ value: 120, direction: 'higher_is_better', normalization }).normalized_score, 1);
});

test('null numeric metric stays UNSCORED and is never changed to zero', () => {
  const result = scoreNumeric({ value: null, direction: 'lower_is_better', normalization: { method: 'min_max', min: 0, max: 100, clamp: true } });
  assert.equal(result.status, 'UNSCORED');
  assert.equal(result.raw_value, null);
  assert.equal(result.normalized_score, null);
});

test('Score Engine creates exact metric and task score with complete provenance', async () => {
  const task = await scoringTask('exact');
  const evaluation = await makeEvaluation(task);
  const result = new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation, benchmarkTask: task, observation: { output: ' blue\r\n' } });
  assert.equal(result.metric_scores[0].status, 'SCORED');
  assert.equal(result.metric_scores[0].normalized_score, 1);
  assert.equal(result.task_score.task_score, 1);
  assert.equal(result.task_score.weight_coverage, 1);
  assert.equal(result.metric_scores[0].provenance.evaluation_id, evaluation.evaluation_id);
  assert.equal(result.metric_scores[0].provenance.raw_record_sha256, evaluation.raw_source_identity.raw_record_sha256);
  assert.deepEqual(result.metric_scores[0].provenance.scorer_details.normalization, ['trim', 'newline_lf', 'lowercase']);
  assert.equal(validateScoreResult(result.metric_scores[0]).valid, true);
});

test('manual metric is MANUAL_REQUIRED rather than automatic zero', async () => {
  const task = await scoringTask('exact');
  task.metrics = ['completion'];
  task.evaluation_method.config.metric_definitions = [{
    schema_version: '0.1', record_type: 'METRIC_DEFINITION', metric_id: 'completion', name: 'Manual completion',
    description: 'Requires a human decision.', metric_type: 'manual', direction: 'higher_is_better', weight: 1,
    range: null, normalization: { method: 'none', min: null, max: null, clamp: false }, scorer: 'manual', parameters: {}, required: true, metadata: { synthetic: true },
  }];
  const evaluation = await makeEvaluation(task, { runId: 'run_manual_unit' });
  const result = new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation, benchmarkTask: task });
  assert.equal(result.metric_scores[0].status, 'MANUAL_REQUIRED');
  assert.equal(result.metric_scores[0].normalized_score, null);
  assert.equal(result.task_score.status, 'MANUAL_REQUIRED');
  assert.equal(result.task_score.task_score, null);
});

test('required missing metric produces PARTIAL coverage without fabricated value', async () => {
  const task = await scoringTask('rules');
  const evaluation = await makeEvaluation(task, { latencyMs: null, runId: 'run_missing_required' });
  const result = new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation, benchmarkTask: task, observation: { output: 'BLUE plan' } });
  const latency = result.metric_scores.find((score) => score.metric_id === 'latency');
  assert.equal(latency.status, 'UNSCORED');
  assert.equal(latency.normalized_score, null);
  assert.equal(result.task_score.status, 'PARTIAL');
  assert.equal(result.task_score.weight_coverage, 0.5);
});

test('explicit multi-metric weights yield deterministic partial Task Score', async () => {
  const task = await scoringTask('rules');
  const evaluation = await makeEvaluation(task, { latencyMs: 10, runId: 'run_weighted_task' });
  const result = new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation, benchmarkTask: task, observation: { output: 'BLUE plan' } });
  assert.equal(result.metric_scores.find((score) => score.metric_id === 'instruction_following').normalized_score, 1);
  assert.equal(result.metric_scores.find((score) => score.metric_id === 'latency').normalized_score, 0.9);
  assert.equal(result.metric_scores.find((score) => score.metric_id === 'completion').status, 'MANUAL_REQUIRED');
  assert.equal(result.task_score.task_score, 0.9625);
  assert.equal(result.task_score.weight_coverage, 0.8);
  assert.equal(result.task_score.status, 'PARTIAL');
});

test('Suite Score exposes score, task coverage, and effective metric coverage', async () => {
  const exactTask = await scoringTask('exact');
  const rulesTask = await scoringTask('rules');
  const engine = new OfflineScoreEngine({ clock: fixedClock });
  const exact = engine.scoreEvaluation({ evaluation: await makeEvaluation(exactTask, { runId: 'run_suite_exact' }), benchmarkTask: exactTask, observation: { output: 'BLUE' } }).task_score;
  const rules = engine.scoreEvaluation({ evaluation: await makeEvaluation(rulesTask, { runId: 'run_suite_rules', latencyMs: 10 }), benchmarkTask: rulesTask, observation: { output: 'BLUE plan' } }).task_score;
  const suite = aggregateSuiteScores({
    suiteIdentity: { suite_id: 'fixture.scoring.suite', suite_version: '1.0.0', suite_definition_sha256: 'a'.repeat(64) },
    taskScores: [exact, rules],
    taskWeights: { 'fixture.scoring.exact': 1, 'fixture.scoring.rules': 1 },
    timestamp: fixedClock.now().toISOString(),
  });
  assert.equal(suite.suite_score, 0.98125);
  assert.equal(suite.task_coverage, 1);
  assert.equal(suite.effective_coverage, 0.9);
  assert.equal(suite.status, 'PARTIAL');
});

test('invalid Metric Definition and task scoring config fail closed', async () => {
  const task = await scoringTask('exact');
  const invalidMetric = structuredClone(metricFrom(task, 'correctness'));
  invalidMetric.weight = 0;
  assert.equal(validateMetricDefinition(invalidMetric).valid, false);
  task.evaluation_method.config.metric_definitions[0].weight = 0;
  const evaluation = await makeEvaluation(task, { runId: 'run_invalid_config' });
  assert.throws(() => new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation, benchmarkTask: task, observation: { output: 'BLUE' } }), { code: 'METRIC_DEFINITION_INVALID' });
});

test('Score Store writes, reloads, queries, deduplicates, and isolates TEST_FIXTURE', async () => {
  const task = await scoringTask('exact');
  const evaluation = await makeEvaluation(task, { runId: 'run_store_score' });
  const score = new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation, benchmarkTask: task, observation: { output: 'BLUE' } }).metric_scores[0];
  const store = new ScoreStore({ rootDir: projectRoot, filePath: resolve(tempRoot, 'store', 'scores.jsonl') });
  assert.equal((await store.write(score)).status, 'written');
  const rerun = structuredClone(score);
  rerun.timestamp = '2099-08-02T00:00:00.000Z';
  assert.equal((await store.write(rerun)).status, 'duplicate_skipped');
  assert.equal((await store.readAll()).length, 1);
  assert.equal((await store.queryByEvaluationId(score.evaluation_id)).length, 1);
  assert.equal((await store.queryByRunId(score.run_id)).length, 1);
  assert.equal((await store.queryByBenchmarkTaskId(score.benchmark_task_id)).length, 1);
  assert.equal((await store.queryBySuiteId(score.suite_id)).length, 1);
  assert.equal((await store.queryByMetricId(score.metric_id)).length, 1);
  assert.equal((await store.queryBySourceClass('TEST_FIXTURE')).length, 1);
  assert.equal((await store.queryOfficialScores()).length, 0);
});

test('Score Store rejects paths outside its root', () => {
  assert.throws(() => new ScoreStore({ rootDir: tempRoot, filePath: resolve(projectRoot, 'escape-score.jsonl') }), { code: 'SCORE_STORE_PATH_ESCAPE' });
});

test('TEST_FIXTURE is explicit and LEGACY_SUMMARY cannot produce a Score', async () => {
  const task = await scoringTask('exact');
  const evaluation = await makeEvaluation(task, { runId: 'run_source_isolation' });
  const score = new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation, benchmarkTask: task, observation: { output: 'BLUE' } }).metric_scores[0];
  assert.equal(score.source_class, 'TEST_FIXTURE');
  assert.equal(score.metadata.fixture_only, true);
  assert.throws(() => new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation: { record_type: 'LEGACY_SUMMARY' }, benchmarkTask: task }), { code: 'LEGACY_SUMMARY_REJECTED' });
});

test('Runtime Credential is rejected from score, score_id, provenance, and Store', async () => {
  const task = await scoringTask('exact');
  const evaluation = await makeEvaluation(task, { runId: 'run_credential_reject' });
  const credential = await new FakeCredentialProvider().getCredential();
  assert.throws(() => new OfflineScoreEngine({ clock: fixedClock }).scoreEvaluation({ evaluation, benchmarkTask: task, observation: { output: 'BLUE', runtime_credential: credential } }), { code: 'SENSITIVE_DATA_REJECTED' });
});

test('full offline Task to Suite Score chain persists and queries fixture Scores', async () => {
  const registry = new BenchmarkTaskRegistry();
  for (const name of ['exact', 'rules']) registry.register(await scoringTask(name));
  const suite = await loadBenchmarkSuite(resolve(fixtureDir, 'scoring-suite-basic.json'), { rootDir: projectRoot, registry });
  const rawWriter = new RawResultWriter({ rootDir: projectRoot, filePath: resolve(tempRoot, 'e2e', 'raw.jsonl') });
  const evaluationStore = new EvaluationStore({ rootDir: projectRoot, filePath: resolve(tempRoot, 'e2e', 'evaluations.jsonl') });
  const scoreStore = new ScoreStore({ rootDir: projectRoot, filePath: resolve(tempRoot, 'e2e', 'scores.jsonl') });
  const adapter = new FakeLocalProviderAdapter({ executeHook: async ({ task: harnessTask }) => ({
    success: true,
    usage: {},
    ttft_ms: null,
    cost: null,
    request_metadata: {},
    metadata: { scoring_observation: { output: harnessTask.benchmark_task === 'fixture.scoring.exact' ? ' blue\r\n' : 'BLUE plan' } },
  }) });
  let runNumber = 0;
  let monotonic = 0;
  const harness = new BenchmarkHarness({
    adapter, credentialProvider: new FakeCredentialProvider(), writer: rawWriter,
    runIdFactory: () => `run_scoring_e2e_${++runNumber}`,
    clock: { now: () => new Date('2099-08-03T00:00:00.000Z'), monotonicNow: () => { monotonic += 10; return monotonic; } },
  });
  const runnerOutput = await new OfflineBenchmarkRunner({ harness, store: evaluationStore }).runSuite(suite);
  const engine = new OfflineScoreEngine({ clock: fixedClock });
  const taskScores = [];
  const metricScores = [];
  for (const result of runnerOutput.results) {
    const task = registry.get(result.benchmark_task_id, result.task_identity.task_version);
    const scored = engine.scoreEvaluation({ evaluation: result.evaluation, benchmarkTask: task, observation: result.evaluation.metadata.scoring_observation });
    taskScores.push(scored.task_score);
    metricScores.push(...scored.metric_scores);
  }
  const suiteScore = aggregateSuiteScores({
    suiteIdentity: suite.suite_identity,
    taskScores,
    taskWeights: { 'fixture.scoring.exact': 1, 'fixture.scoring.rules': 1 },
    timestamp: fixedClock.now().toISOString(),
  });
  for (const scoreRecord of [...metricScores, ...taskScores, suiteScore]) await scoreStore.write(scoreRecord);
  assert.equal((await rawWriter.readAll()).length, 2);
  assert.equal((await evaluationStore.readAll()).length, 2);
  assert.equal((await scoreStore.readAll()).length, 7);
  assert.equal((await scoreStore.queryBySuiteId('fixture.scoring.suite')).length, 7);
  assert.equal((await scoreStore.queryBySourceClass('TEST_FIXTURE')).length, 7);
  assert.equal((await scoreStore.queryByRecordType('SCORE_RESULT')).length, 4);
  assert.equal((await scoreStore.queryByRecordType('TASK_SCORE')).length, 2);
  assert.equal((await scoreStore.queryByRecordType('SUITE_SCORE')).length, 1);
  assert.equal((await scoreStore.queryOfficialScores()).length, 0);
  assert.equal(suiteScore.suite_score, 0.98125);
  assert.equal(suiteScore.effective_coverage, 0.9);
  assert.equal(suiteScore.metadata.fixture_only, true);
});

test('scoring implementation contains no network client and network count is zero', async () => {
  const names = ['score-contracts.mjs', 'exact-match-scorer.mjs', 'rule-based-scorer.mjs', 'numeric-scorer.mjs', 'score-aggregator.mjs', 'score-engine.mjs', 'score-store.mjs'];
  const sources = await Promise.all(names.map((name) => readFile(resolve(projectRoot, 'src', 'scoring', name), 'utf8')));
  assert.doesNotMatch(sources.join('\n'), /\bfetch\s*\(|https?\.request\s*\(|from ['"](?:axios|openai)['"]/u);
  assert.equal(networkRequests, 0);
});
