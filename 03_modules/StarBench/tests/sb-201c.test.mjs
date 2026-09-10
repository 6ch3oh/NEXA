import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BenchmarkHarness } from '../src/benchmark-harness.mjs';
import { OfflineBenchmarkRunner } from '../src/benchmark-runner.mjs';
import { BenchmarkTaskRegistry, loadBenchmarkTask } from '../src/benchmark-task-loader.mjs';
import { loadBenchmarkSuite } from '../src/benchmark-suite-loader.mjs';
import { FakeCredentialProvider } from '../src/credential-provider.mjs';
import { EvaluationStore } from '../src/evaluation-store.mjs';
import { FakeLocalProviderAdapter } from '../src/provider-adapter.mjs';
import { RawResultWriter } from '../src/raw-result-writer.mjs';
import { CampaignHarnessAdapter, buildRuntimeScoringViewForTest } from '../src/campaign/campaign-harness-adapter.mjs';
import { CampaignRunner } from '../src/campaign/campaign-runner.mjs';
import { buildCampaignSummary } from '../src/campaign/campaign-summary.mjs';
import { deriveEvidenceRequirements } from '../src/campaign/evidence-sufficiency.mjs';
import { ObservationMatrix } from '../src/campaign/observation-matrix.mjs';
import { createCampaignPlan, loadCampaignDefinition, loadCandidateDefinition, validateCampaignDefinition, validateCandidateDefinition } from '../src/campaign/campaign-planner.mjs';
import { OfflineScoreEngine } from '../src/scoring/score-engine.mjs';
import { ScoreStore } from '../src/scoring/score-store.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = join(root, 'tests', '.tmp-sb-201c');
const suitePath = join(root, 'benchmarks', 'phase2', 'phase2-minimum-suite-v0.1.json');
const taskDirs = ['planning', 'coding', 'instruction-following'];
const taskFiles = (await Promise.all(taskDirs.map(async (dir) => (await readdir(join(root, 'benchmarks', 'phase2', dir))).filter((name) => name.endsWith('.json')).sort().map((name) => join(root, 'benchmarks', 'phase2', dir, name))))).flat();
const tasks = await Promise.all(taskFiles.map((file) => loadBenchmarkTask(file, { rootDir: root })));
const registry = new BenchmarkTaskRegistry(); for (const task of tasks) registry.register(task);
const resolvedSuite = await loadBenchmarkSuite(suitePath, { rootDir: root, registry });
const campaign = await loadCampaignDefinition(join(root, 'tests', 'fixtures', 'campaign-phase2-minimum.json'), { rootDir: root });
const candidates = await Promise.all(['candidate-fixture-a.json', 'candidate-fixture-b.json'].map((name) => loadCandidateDefinition(join(root, 'tests', 'fixtures', name), { rootDir: root })));
const coverageContract = JSON.parse(await readFile(join(root, 'contracts', 'phase2-benchmark-coverage-v0.1.json'), 'utf8'));
const scenarioRequirement = JSON.parse(await readFile(join(root, 'contracts', 'scenario-evidence-requirement-v0.1.json'), 'utf8'));
const requirements = deriveEvidenceRequirements({ coverageContract, scenarioRequirement });
const plan = createCampaignPlan({ campaign, resolvedSuite, candidates: [...candidates].reverse() });
let networkRequests = 0; const originalFetch = globalThis.fetch; globalThis.fetch = async () => { networkRequests += 1; throw new Error('NETWORK_FORBIDDEN'); };
after(async () => { globalThis.fetch = originalFetch; await rm(tempRoot, { recursive: true, force: true }); });

async function sha256(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
function taskOutput(taskId) {
  const task = registry.get(taskId, '1.0.0');
  if (task.expected_output.reference !== null) return task.expected_output.reference;
  if (taskId === 'phase2.instruction-following.legacy-anchor') return '问题\n原因\n建议';
  return 'fixture-only response';
}

async function createFixtureRuntime() {
  await rm(tempRoot, { recursive: true, force: true });
  const matrixClock = { now: () => new Date('2099-08-01T00:00:30.000Z') };
  const matrix = new ObservationMatrix({ slots: plan.slots, clock: matrixClock });
  const adapters = new Map(); const runtimeDetails = new Map();
  for (const candidate of candidates) {
    let runNumber = 0; let monotonic = 0;
    const providerAdapter = new FakeLocalProviderAdapter({ providerIdentity: candidate.provider, modelIdentity: candidate.model, executeHook: async ({ task }) => {
      const slot = task.parameters.campaign_observation; const output = taskOutput(task.benchmark_task);
      const fail = candidate.candidate_id === 'fixture-candidate-b' && task.benchmark_task === 'phase2.instruction-following.format-constraint' && slot.repeat_index === 1;
      const partial = candidate.candidate_id === 'fixture-candidate-b' && task.benchmark_task === 'phase2.instruction-following.prohibited-items' && slot.repeat_index === 2;
      if (fail) return { success: false, usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 }, request_metadata: { request_id: null, response_reference: null }, error: { category: 'fixture_failure', message: 'Deterministic fixture failure.', statusCode: null, retryable: false }, metadata: { scoring_observation: { output: null }, campaign_observation_status: 'FAILED' } };
      return { success: true, usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }, request_metadata: { request_id: `fixture-${candidate.candidate_id}-${slot.schedule_index}`, response_reference: `fixture-${candidate.candidate_id}-${slot.schedule_index}` }, metadata: { scoring_observation: { output }, campaign_observation_status: partial ? 'PARTIAL' : 'SUCCEEDED' } };
    } });
    const fakeCredentialProvider = new FakeCredentialProvider();
    const writer = new RawResultWriter({ filePath: join(tempRoot, candidate.candidate_id, 'raw-results.jsonl'), rootDir: root });
    const evaluationStore = new EvaluationStore({ filePath: join(tempRoot, candidate.candidate_id, 'evaluations.jsonl'), rootDir: root });
    const scoreStore = new ScoreStore({ filePath: join(tempRoot, candidate.candidate_id, 'scores.jsonl'), rootDir: root });
    const clock = { now: () => new Date('2099-08-01T00:01:00.000Z'), monotonicNow: () => { monotonic += 5; return monotonic; } };
    const harness = new BenchmarkHarness({ adapter: providerAdapter, credentialProvider: fakeCredentialProvider, writer, recordType: 'TEST_FIXTURE', runIdFactory: () => { runNumber += 1; return `run_${candidate.candidate_id.replaceAll('-', '_')}_${String(runNumber).padStart(3, '0')}`; }, clock, executionEnvironment: { runtime: 'node', network: 'disabled', fixture_only: true } });
    const benchmarkRunner = new OfflineBenchmarkRunner({ harness, store: evaluationStore });
    const scoreEngine = new OfflineScoreEngine({ clock: { now: () => new Date('2099-08-01T00:02:00.000Z') } });
    adapters.set(candidate.candidate_id, new CampaignHarnessAdapter({ candidate, benchmarkRunner, scoreEngine, scoreStore }));
    runtimeDetails.set(candidate.candidate_id, { providerAdapter, fakeCredentialProvider, writer, evaluationStore, scoreStore });
  }
  return { matrix, adapters, runtimeDetails };
}

let e2ePromise;
async function runE2E() {
  if (!e2ePromise) e2ePromise = (async () => {
    const runtime = await createFixtureRuntime();
    const firstRunner = new CampaignRunner({ plan, matrix: runtime.matrix, taskRegistry: registry, harnessAdapters: runtime.adapters, requirements, clock: { now: () => new Date('2099-08-01T00:03:00.000Z') } });
    const first = await firstRunner.run({ maxSlots: 10 });
    const resumedMatrix = new ObservationMatrix({ slots: runtime.matrix.snapshot(), clock: { now: () => new Date('2099-08-01T00:04:00.000Z') } });
    const resumedRunner = new CampaignRunner({ plan, matrix: resumedMatrix, taskRegistry: registry, harnessAdapters: runtime.adapters, requirements, clock: { now: () => new Date('2099-08-01T00:05:00.000Z') } });
    const resumed = await resumedRunner.run();
    const duplicate = await resumedRunner.run();
    return { ...runtime, first, resumed, duplicate, resumedMatrix };
  })();
  return e2ePromise;
}

test('three Campaign Runtime schemas are present and parse as Draft 2020-12 JSON Schema', async () => {
  for (const name of ['campaign-definition-v0.1.schema.json', 'candidate-definition-v0.1.schema.json', 'campaign-observation-v0.1.schema.json']) {
    const schema = JSON.parse(await readFile(join(root, 'schemas', name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema'); assert.equal(schema.type, 'object'); assert.equal(schema.additionalProperties, false);
  }
});

test('Campaign Definition validates the TEST_ONLY non-authorized fixture', () => {
  assert.deepEqual(validateCampaignDefinition(campaign), { valid: true, errors: [] });
  assert.equal(campaign.budget_status, 'NOT_AUTHORIZED_REAL_EXECUTION'); assert.equal(campaign.retry_policy.retry_budget, 0);
});

test('Campaign Definition rejects malformed identity and repeat count', () => {
  const invalid = structuredClone(campaign); invalid.campaign_id = 'INVALID ID'; invalid.runs_per_task = 0;
  assert.equal(validateCampaignDefinition(invalid).valid, false);
});

test('both Candidate Definitions validate and remain fully synthetic', () => {
  assert.deepEqual(candidates.map((candidate) => candidate.candidate_id), ['fixture-candidate-a', 'fixture-candidate-b']);
  for (const candidate of candidates) { assert.deepEqual(validateCandidateDefinition(candidate), { valid: true, errors: [] }); assert.equal(candidate.status, 'TEST_ONLY'); assert.equal(candidate.source_class, 'TEST_FIXTURE'); assert.equal(candidate.metadata.real_capability_claim, false); }
});

test('Candidate identity is data and never contains a Provider Adapter instance', () => {
  for (const candidate of candidates) { assert.equal('adapter' in candidate, false); assert.equal('adapter_identity' in candidate, false); }
  assert.notEqual(candidates[0].provider, candidates[1].provider); assert.notEqual(candidates[0].model, candidates[1].model);
});

test('planner consumes the nine-task formal Suite without changing task count', () => {
  assert.equal(tasks.length, 9); assert.equal(resolvedSuite.tasks.length, 9); assert.equal(plan.planned_observations, 36);
});

test('planner generates exactly 36 unique observation identities', () => {
  assert.equal(plan.slots.length, 36); assert.equal(new Set(plan.slots.map((slot) => slot.observation_id)).size, 36);
});

test('deterministic schedule follows declared Candidate, Suite order, and repeat order', () => {
  const second = createCampaignPlan({ campaign: structuredClone(campaign), resolvedSuite, candidates });
  assert.deepEqual(second.slots.map((slot) => slot.observation_id), plan.slots.map((slot) => slot.observation_id));
  assert.deepEqual(plan.slots.slice(0, 4).map((slot) => [slot.candidate_id, slot.suite_order, slot.repeat_index]), [['fixture-candidate-a', 0, 1], ['fixture-candidate-a', 0, 2], ['fixture-candidate-a', 1, 1], ['fixture-candidate-a', 1, 2]]);
});

test('repeat identity is explicit and not encoded by random task ids', () => {
  const pair = plan.slots.filter((slot) => slot.candidate_id === 'fixture-candidate-a' && slot.benchmark_task_id === 'phase2.planning.legacy-anchor');
  assert.deepEqual(pair.map((slot) => slot.repeat_index), [1, 2]); assert.notEqual(pair[0].observation_id, pair[1].observation_id);
  assert.equal(pair[0].benchmark_task_id, pair[1].benchmark_task_id); assert.equal(pair[0].run_id, null); assert.equal(pair[1].run_id, null);
});

test('Observation Matrix exposes explicit PLANNED state for every slot', () => {
  const matrix = new ObservationMatrix({ slots: plan.slots }); assert.equal(matrix.list().filter((slot) => slot.status === 'PLANNED').length, 36);
});

test('Observation Matrix rejects duplicate slot identity', () => {
  assert.throws(() => new ObservationMatrix({ slots: [plan.slots[0], plan.slots[0]] }), { code: 'OBSERVATION_DUPLICATE' });
});

test('SB-201 evidence requirements are derived without changing either contract', () => {
  assert.deepEqual(requirements, { required_tasks: 3, required_repeats: 2, planned_observations: 6, minimum_successful_observations: 5, minimum_coverage: 1, minimum_evidence_count: 3, minimum_confidence: 'HIGH', maximum_partial: 1, maximum_failed: 1, maximum_combined_non_success: 1 });
});

test('runtime scoring view is an in-memory adapter and leaves formal Task unchanged', () => {
  const task = registry.get('phase2.instruction-following.format-constraint', '1.0.0'); const before = JSON.stringify(task); const view = buildRuntimeScoringViewForTest(task);
  assert.equal(JSON.stringify(task), before); assert.ok(view.evaluation_method.config.metric_definitions.length > 0); assert.equal(view.prompt_identity.prompt_id, task.prompt_identity.prompt_id);
});

test('Runner fails closed for a non-fixture or authorized-real Campaign state', () => {
  const realPlan = structuredClone(plan); realPlan.campaign.source_class = 'AUTHORED_DEFINITION'; realPlan.campaign.campaign_state = 'AUTHORIZED'; realPlan.campaign.budget_status = 'AUTHORIZED';
  assert.throws(() => new CampaignRunner({ plan: realPlan, matrix: new ObservationMatrix({ slots: realPlan.slots }), taskRegistry: registry, harnessAdapters: new Map(), requirements }), { code: 'REAL_CAMPAIGN_NOT_AUTHORIZED' });
});

test('stop policy STOP retains failure and leaves remaining slots planned', async () => {
  const stopPlan = structuredClone(plan); stopPlan.campaign.stop_policy = { on_failure: 'STOP', max_failures: null };
  const adapters = new Map(candidates.map((candidate) => [candidate.candidate_id, { executeObservation: async () => ({ observation_status: 'FAILED', run_id: null, score_status: null, artifacts: {}, error: { code: 'FIXTURE_STOP', safe_message: 'Fixture stop.' } }) }]));
  const runner = new CampaignRunner({ plan: stopPlan, matrix: new ObservationMatrix({ slots: stopPlan.slots }), taskRegistry: registry, harnessAdapters: adapters, requirements });
  const result = await runner.run(); assert.equal(result.executed_slots, 1); assert.equal(result.stopped, true); assert.equal(result.summary.failed_observations, 1); assert.equal(result.summary.remaining_observations, 35);
});

test('first run executes exactly ten slots and exposes 26 remaining', async () => {
  const result = await runE2E(); assert.equal(result.first.executed_slots, 10); assert.equal(result.first.summary.attempted_observations, 10); assert.equal(result.first.summary.remaining_observations, 26); assert.equal(result.first.observations.length, 36);
});

test('resume executes only the remaining 26 slots', async () => {
  const result = await runE2E(); assert.equal(result.resumed.executed_slots, 26); assert.equal(result.resumed.summary.attempted_observations, 36); assert.equal(result.resumed.summary.remaining_observations, 0); assert.equal(result.resumed.summary.campaign_complete, true);
});

test('duplicate protection makes a completed Campaign rerun execute zero slots', async () => {
  const result = await runE2E(); assert.equal(result.duplicate.executed_slots, 0); assert.equal(result.duplicate.observations.length, 36); assert.equal(new Set(result.duplicate.observations.map((slot) => slot.observation_id)).size, 36);
});

test('planned repeat and retry remain different semantics', async () => {
  const result = await runE2E(); assert.equal(campaign.runs_per_task, 2); assert.equal(campaign.retry_policy.retry_budget, 0); assert.ok(result.resumed.observations.every((slot) => slot.attempt_count === 1));
});

test('run ids are created by Harness and remain distinct from observation identities', async () => {
  const result = await runE2E(); const runIds = result.resumed.observations.map((slot) => slot.run_id); assert.equal(new Set(runIds).size, 36); assert.ok(runIds.every((runId) => runId?.startsWith('run_'))); assert.ok(result.resumed.observations.every((slot) => slot.run_id !== slot.observation_id));
});

test('full E2E retains one deterministic failure and one partial observation', async () => {
  const result = await runE2E(); assert.equal(result.resumed.summary.successful_observations, 34); assert.equal(result.resumed.summary.failed_observations, 1); assert.equal(result.resumed.summary.partial_observations, 1);
  assert.equal(result.resumed.observations.filter((slot) => slot.status === 'FAILED').length, 1); assert.equal(result.resumed.observations.filter((slot) => slot.status === 'PARTIAL').length, 1);
});

test('existing Harness, Importer, Evaluation Store, Score Engine, and Score Store complete the fixture chain', async () => {
  const result = await runE2E(); let rawCount = 0; let evaluationCount = 0; let taskScoreCount = 0;
  for (const details of result.runtimeDetails.values()) { rawCount += (await details.writer.readAll()).length; evaluationCount += (await details.evaluationStore.readAll()).length; taskScoreCount += (await details.scoreStore.queryByRecordType('TASK_SCORE')).length; }
  assert.equal(rawCount, 36); assert.equal(evaluationCount, 36); assert.equal(taskScoreCount, 36);
});

test('every Campaign artifact remains TEST_FIXTURE and official Score queries stay empty', async () => {
  const result = await runE2E();
  for (const details of result.runtimeDetails.values()) { assert.ok((await details.writer.readAll()).every((record) => record.record_type === 'TEST_FIXTURE' && record.source_class === 'TEST_FIXTURE')); assert.deepEqual(await details.scoreStore.queryOfficialScores(), []); }
  assert.ok(result.resumed.observations.every((slot) => slot.source_class === 'TEST_FIXTURE'));
});

test('Legacy Summary and the sealed activation task never enter Campaign observations', async () => {
  const result = await runE2E(); const ids = new Set(result.resumed.observations.map((slot) => slot.benchmark_task_id));
  assert.equal(ids.has('deepseek-real-activation-instruction-v0.1'), false); assert.ok(result.resumed.observations.every((slot) => slot.record_type === 'CAMPAIGN_OBSERVATION')); assert.equal(ids.size, 9);
});

test('Campaign Summary includes Candidate, Scenario, Task, and repeat detail', async () => {
  const result = await runE2E(); const summary = result.resumed.summary;
  assert.equal(summary.candidate_summary.length, 2); assert.equal(summary.scenario_summary.length, 3); assert.equal(summary.task_summary.length, 9); assert.equal(summary.repeat_coverage.length, 18); assert.ok(summary.repeat_coverage.every((entry) => entry.complete));
});

test('Fixture Candidate A passes the mathematical Instruction gate only', async () => {
  const result = await runE2E(); const ready = result.resumed.summary.evidence_readiness.find((item) => item.candidate_id === 'fixture-candidate-a' && item.scenario_id === 'instruction_following');
  assert.equal(ready.successful_observations, 6); assert.equal(ready.coverage, 1); assert.equal(ready.evidence_count, 3); assert.equal(ready.confidence, 'HIGH'); assert.equal(ready.mathematically_sufficient, true); assert.equal(ready.officially_eligible, false);
});

test('Fixture Candidate B fails the 5/6 and combined non-success gates', async () => {
  const result = await runE2E(); const insufficient = result.resumed.summary.evidence_readiness.find((item) => item.candidate_id === 'fixture-candidate-b' && item.scenario_id === 'instruction_following');
  assert.equal(insufficient.successful_observations, 4); assert.equal(insufficient.coverage, 1); assert.equal(insufficient.evidence_count, 3); assert.equal(insufficient.mathematically_sufficient, false); assert.ok(insufficient.reasons.includes('SUCCESS_THRESHOLD_NOT_MET')); assert.ok(insufficient.reasons.includes('NON_SUCCESS_LIMIT_EXCEEDED'));
});

test('Campaign Runtime never recommends, ranks, or activates real readiness', async () => {
  const result = await runE2E(); assert.equal(result.resumed.summary.real_recommendation_ready, false); assert.equal(result.resumed.summary.real_model_ranking_ready, false); assert.ok(result.resumed.summary.evidence_readiness.every((item) => item.officially_eligible === false && item.real_recommendation_ready === false));
});

test('Campaign budget accounting remains fixture-only and bounded at 36', async () => {
  const result = await runE2E(); assert.equal(campaign.metadata.planned_request_count, 36); assert.equal(campaign.metadata.max_requests, 36); assert.equal(result.resumed.summary.attempted_observations, 36); assert.equal(campaign.metadata.real_request_count, 0);
});

test('Fake Provider calls total 36 while real and network requests stay zero', async () => {
  const result = await runE2E(); const fakeCalls = [...result.runtimeDetails.values()].reduce((sum, detail) => sum + detail.providerAdapter.callCount, 0); assert.equal(fakeCalls, 36); assert.equal(networkRequests, 0); assert.ok([...result.runtimeDetails.values()].every((detail) => detail.fakeCredentialProvider.accessCount === 18));
});

test('all nine formal SB-201B Task files remain byte-identical', async () => {
  const expected = new Map([
    ['planning/legacy-anchor-planning-v0.1.json','57014c671d981b560c6d7159d5fb6ca9d768926a214c109535468fbf2ebe341a'],['planning/planning-complementary-01-v0.1.json','a1d1ae5419a7cac6eb1b7b2130394c2886510ac7bf977b1d185a10260d33ea11'],['planning/planning-complementary-02-v0.1.json','7475801be258ac5278f15cf3d3292ace59ee5c594b8ecb8bb1fab3a5a3a7bea9'],
    ['coding/coding-complementary-01-v0.1.json','30a1fad3014034f7347d93dc15dc4bb9ab5b1789a2781cae3f16cfdc1802b6b9'],['coding/coding-complementary-02-v0.1.json','0cc0aa57ad7e50053c442de9b210721b27916afa2b16068caad723f9a54f67eb'],['coding/legacy-anchor-coding-v0.1.json','527f28b890db7c59b0f0c02ab2377da3f29904a6feca78a73e6f08c744e8da6c'],
    ['instruction-following/instruction-complementary-01-v0.1.json','ee805818ad75a714875d0937dddb13629336d9bc6084ee63b3d9876e3bd7582e'],['instruction-following/instruction-complementary-02-v0.1.json','cab50d23fca8ad61ec3d8db0e2bac1bc18c10e28aab0059a2c1aede66b21d53c'],['instruction-following/legacy-anchor-instruction-v0.1.json','0e718827a1d92de1d07e8dab9bf8e2cdfe5f43a32498a44befade248acfc0b90']
  ]);
  for (const [relativePath, digest] of expected) assert.equal(await sha256(join(root, 'benchmarks', 'phase2', ...relativePath.split('/'))), digest);
});

test('Phase-1 and SB-201 contracts remain byte-identical', async () => {
  assert.equal(await sha256(join(root, 'contracts', 'phase1-v0.1-manifest.json')), '341d57171921e15d1c58e1c151dae02c202d05ba7d4d20c54087352a11009d94');
  assert.equal(await sha256(join(root, 'contracts', 'phase2-benchmark-coverage-v0.1.json')), '47efbfc96fe456329dfa0bed6ae4494346ada2ce281ae2e6058aa20b762b4896');
  assert.equal(await sha256(join(root, 'contracts', 'scenario-evidence-requirement-v0.1.json')), '0456f03144c8adc90b8387d364e883e695a502572ce63f3b0ca48267696dd813');
});

test('Campaign Summary builder is deterministic for fixed observations and timestamp', async () => {
  const result = await runE2E(); const rebuilt = buildCampaignSummary({ campaign, observations: result.resumed.observations, requirements, generatedAt: result.resumed.summary.generated_at }); assert.deepEqual(rebuilt, result.resumed.summary);
});
