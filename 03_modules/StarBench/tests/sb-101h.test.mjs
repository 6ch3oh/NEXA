import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BenchmarkHarness } from '../src/benchmark-harness.mjs';
import { FakeCredentialProvider } from '../src/credential-provider.mjs';
import { ResultAdmissionGate, RAW_RESULT_FIELD_POLICY, checkResultIntegrity, validateIncompleteResult } from '../src/intake/result-admission-gate.mjs';
import { validateProvenanceCompleteness } from '../src/intake/provenance-validator.mjs';
import { ResultReadinessChecker, assessRealRecommendationActivation, reviewProviderAdapterContract } from '../src/intake/result-readiness-checker.mjs';
import { FakeLocalProviderAdapter } from '../src/provider-adapter.mjs';
import { importRawResult, validateRawResult } from '../src/raw-result-importer.mjs';
import { RawResultWriter } from '../src/raw-result-writer.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '..');
const fixtureDir = resolve(testDir, 'fixtures');
const tempRoot = resolve(testDir, '.tmp-sb-101h');
const gate = new ResultAdmissionGate();
let networkRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests += 1; throw new Error('NETWORK_FORBIDDEN'); };

after(async () => { globalThis.fetch = originalFetch; await rm(tempRoot, { recursive: true, force: true }); });

async function json(filePath) { return JSON.parse(await readFile(filePath, 'utf8')); }
async function fixture(name) { return json(resolve(fixtureDir, name)); }

test('Phase-1 Contract Manifest loads with all required V0.1 contracts frozen or intake-ready', async () => {
  const manifest = await json(resolve(projectRoot, 'contracts', 'phase1-v0.1-manifest.json'));
  assert.equal(manifest.manifest_id, 'phase1-v0.1-manifest');
  assert.equal(manifest.status, 'FROZEN');
  const required = ['RAW_RESULT', 'Canonical Evaluation', 'Benchmark Task', 'Benchmark Suite', 'Metric Definition', 'Score Result', 'Scenario Definition', 'Capability Profile', 'Recommendation Request', 'Recommendation Policy', 'Recommendation Decision', 'Intent Request', 'Intent Rule', 'Intent Routing Decision'];
  assert.equal(required.every((name) => manifest.contracts.some((contract) => contract.contract_name === name && contract.version === '0.1')), true);
  assert.equal(manifest.contracts.every((contract) => contract.compatibility_policy && contract.breaking_change_policy), true);
});

test('every schema path declared by the frozen manifest exists and parses', async () => {
  const manifest = await json(resolve(projectRoot, 'contracts', 'phase1-v0.1-manifest.json'));
  for (const contract of manifest.contracts) {
    const schemaPath = resolve(projectRoot, contract.schema_path);
    await access(schemaPath);
    assert.ok((await json(schemaPath)).$schema);
  }
});

test('Incomplete Result V0.1 schema and valid partial fixture load offline', async () => {
  const schema = await json(resolve(projectRoot, 'schemas', 'incomplete-result-v0.1.schema.json'));
  const record = await fixture('raw-result-incomplete-valid.json');
  assert.equal(schema.properties.record_type.const, 'INCOMPLETE_RESULT');
  assert.deepEqual(schema.properties.outcome_status.enum, ['COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'INVALID']);
  assert.equal(validateIncompleteResult(record).valid, true);
});

test('RAW_RESULT required and nullable field policy is explicit and never synthesizes zero', () => {
  assert.ok(RAW_RESULT_FIELD_POLICY.identity_required.includes('run_id'));
  assert.ok(RAW_RESULT_FIELD_POLICY.execution_outcome_required.includes('error'));
  assert.ok(RAW_RESULT_FIELD_POLICY.conditionally_optional_nullable.includes('cost'));
  assert.match(RAW_RESULT_FIELD_POLICY.unknown_policy, /never synthesize zero/u);
});

test('complete real-shaped TEST_FIXTURE passes the Gate but remains non-official', async () => {
  const record = await fixture('raw-result-real-shaped-test.json');
  assert.equal(validateRawResult(record).valid, true);
  const decision = gate.assess(record);
  assert.equal(decision.status, 'ADMITTED');
  assert.equal(decision.official_eligible, false);
  assert.ok(decision.reason_codes.includes('TEST_FIXTURE_NON_OFFICIAL'));
});

test('valid partial result is ADMITTED_PARTIAL with declared missing observations', async () => {
  const decision = gate.assess(await fixture('raw-result-incomplete-valid.json'));
  assert.equal(decision.status, 'ADMITTED_PARTIAL');
  assert.ok(decision.missing_fields.includes('completion_tokens'));
  assert.ok(decision.reason_codes.includes('INCOMPLETE_RESULT_ACCEPTED'));
});

test('invalid incomplete fixture is REJECTED without repair', async () => {
  const record = await fixture('raw-result-incomplete-invalid.json');
  assert.equal(validateIncompleteResult(record).valid, false);
  const decision = gate.assess(record);
  assert.equal(decision.status, 'REJECTED');
  assert.equal(record.latency_ms, -1);
});

test('failed incomplete result is distinct from PARTIAL and is admitted as incomplete evidence', async () => {
  const record = await fixture('raw-result-incomplete-valid.json');
  record.outcome_status = 'FAILED'; record.success = false;
  record.error = { category: 'fixture_provider_error', safe_message: 'Controlled fixture failure.', status_code: 503, retryable: true };
  const decision = gate.assess(record);
  assert.equal(validateIncompleteResult(record).valid, true);
  assert.equal(decision.status, 'ADMITTED_PARTIAL');
  assert.equal(record.outcome_status, 'FAILED');
});

test('timeout-shaped result preserves TIMED_OUT and missing completion data', async () => {
  const record = await fixture('raw-result-incomplete-valid.json');
  record.outcome_status = 'TIMED_OUT'; record.success = false;
  record.error = { category: 'timeout', safe_message: 'Controlled fixture timeout.', status_code: null, retryable: true };
  const decision = gate.assess(record);
  assert.equal(decision.status, 'ADMITTED_PARTIAL');
  assert.equal(record.completion_tokens, null);
  assert.equal(record.availability.completion_tokens, 'UNAVAILABLE');
});

test('missing tokens, TTFT, throughput, and cost stay null and are not fabricated', async () => {
  const record = await fixture('raw-result-incomplete-valid.json');
  for (const field of ['ttft_ms', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'throughput_tokens_per_second', 'cost']) assert.equal(record[field], null);
  const decision = gate.assess(record);
  assert.equal(decision.status, 'ADMITTED_PARTIAL');
});

test('invalid timestamp is rejected', async () => {
  const record = await fixture('raw-result-real-shaped-test.json'); record.timestamp = 'not-a-date';
  const decision = gate.assess(record);
  assert.equal(decision.status, 'REJECTED'); assert.ok(decision.reason_codes.includes('SCHEMA_VALIDATION_FAILED'));
});

test('negative latency is rejected', async () => {
  const record = await fixture('raw-result-real-shaped-test.json'); record.latency_ms = -1;
  assert.equal(gate.assess(record).status, 'REJECTED');
});

test('TTFT greater than latency is rejected by integrity checks', async () => {
  const record = await fixture('raw-result-real-shaped-test.json'); record.ttft_ms = 101;
  const decision = gate.assess(record);
  assert.equal(decision.status, 'REJECTED'); assert.ok(decision.integrity_reason_codes.includes('TTFT_EXCEEDS_LATENCY'));
});

test('token total inconsistency is rejected and not automatically corrected', async () => {
  const record = await fixture('raw-result-real-shaped-test.json'); record.total_tokens = 99;
  const decision = gate.assess(record);
  assert.equal(decision.status, 'REJECTED'); assert.ok(decision.integrity_reason_codes.includes('TOKEN_TOTAL_INCONSISTENT')); assert.equal(record.total_tokens, 99);
});

test('invalid source_class is rejected', async () => {
  const record = await fixture('raw-result-real-shaped-test.json'); record.source_class = 'PROVIDER_EXECUTION';
  assert.equal(gate.assess(record).status, 'REJECTED');
});

test('LEGACY_SUMMARY is always rejected before pipeline admission', () => {
  const decision = gate.assess({ record_type: 'LEGACY_SUMMARY', schema_version: 'legacy', summary: 'fixture legacy summary' });
  assert.equal(decision.status, 'REJECTED'); assert.ok(decision.reason_codes.includes('LEGACY_SUMMARY_REJECTED')); assert.equal(decision.official_eligible, false);
});

test('obvious secret fields are quarantined and never admitted', async () => {
  const record = await fixture('raw-result-secret-like.json');
  const decision = gate.assess(record);
  assert.equal(decision.status, 'QUARANTINE_REQUIRED'); assert.equal(decision.secret_status, 'DETECTED'); assert.ok(decision.reason_codes.includes('SENSITIVE_DATA_DETECTED'));
});

test('provenance validator distinguishes COMPLETE, PARTIAL, and INSUFFICIENT', async () => {
  const complete = await fixture('raw-result-real-shaped-test.json');
  const partial = structuredClone(complete); partial.request_provenance.request_id = null;
  const insufficient = structuredClone(complete); insufficient.request_provenance.adapter_identity = '';
  assert.equal(validateProvenanceCompleteness(complete).status, 'COMPLETE');
  assert.equal(validateProvenanceCompleteness(partial).status, 'PARTIAL');
  assert.equal(validateProvenanceCompleteness(insufficient).status, 'INSUFFICIENT');
});

test('known throughput requires explicit provider or computed provenance', async () => {
  const record = await fixture('raw-result-real-shaped-test.json'); delete record.metadata.measurement_provenance.throughput;
  const integrity = checkResultIntegrity(record);
  assert.equal(integrity.status, 'FAIL'); assert.ok(integrity.reason_codes.includes('THROUGHPUT_PROVENANCE_MISSING'));
  assert.equal(gate.assess(record).status, 'REJECTED');
});

test('known cost requires an explicit source and missing cost remains null', async () => {
  const record = await fixture('raw-result-real-shaped-test.json');
  assert.equal(record.cost, null);
  record.cost = { amount: 1, currency: 'FIX', source: 'OBSERVED' };
  delete record.metadata.measurement_provenance.cost;
  const decision = gate.assess(record);
  assert.equal(decision.status, 'REJECTED'); assert.ok(decision.integrity_reason_codes.includes('COST_PROVENANCE_MISSING'));
});

test('Readiness Checker reports ready, partial, rejected, missing fields, provenance, secret, and compatibility', async () => {
  const complete = await fixture('raw-result-real-shaped-test.json');
  const partial = await fixture('raw-result-incomplete-valid.json');
  const invalid = await fixture('raw-result-incomplete-invalid.json');
  const result = new ResultReadinessChecker().check([complete, partial, invalid]);
  assert.deepEqual({ ready: result.ready, partial: result.partial, rejected: result.rejected }, { ready: 1, partial: 1, rejected: 1 });
  assert.ok(result.missing_fields.includes('completion_tokens')); assert.equal(result.provenance_status, 'MIXED'); assert.equal(result.compatibility_status, 'MIXED');
});

test('Readiness secret status becomes DETECTED for a quarantined batch', async () => {
  const result = new ResultReadinessChecker().check([await fixture('raw-result-secret-like.json')]);
  assert.equal(result.secret_status, 'DETECTED'); assert.equal(result.rejected, 1);
});

test('real-shaped TEST_FIXTURE imports structurally but cannot activate real recommendation', async () => {
  const record = await fixture('raw-result-real-shaped-test.json');
  const admission = gate.assess(record);
  const evaluation = importRawResult(record);
  const activation = assessRealRecommendationActivation({ admission_decisions: [admission], evaluations: [evaluation] });
  assert.equal(evaluation.raw_source_identity.source_class, 'TEST_FIXTURE');
  assert.equal(activation.REAL_RECOMMENDATION_READY, false);
  assert.equal(activation.real_raw_result_count, 0);
});

test('current activation gate remains false with real RAW_RESULT count zero', () => {
  const activation = assessRealRecommendationActivation();
  assert.equal(activation.REAL_RECOMMENDATION_READY, false); assert.equal(activation.real_raw_result_count, 0);
  assert.equal(Object.values(activation.conditions).every((value) => value === false), true);
});

test('Provider Adapter and Harness contract cover future intake fields without a network adapter', async () => {
  const review = reviewProviderAdapterContract();
  assert.equal(review.status, 'READY'); assert.equal(review.network_adapter_implemented, false);
  for (const key of ['provider', 'model', 'task_identity', 'prompt_identity', 'parameters', 'response_body_or_reference', 'usage', 'latency', 'ttft', 'request_provenance', 'safe_error', 'credential_runtime_boundary']) assert.ok(review.coverage[key]);
  const writer = new RawResultWriter({ rootDir: projectRoot, filePath: resolve(tempRoot, 'harness', 'raw.jsonl') });
  const adapter = new FakeLocalProviderAdapter({ providerIdentity: 'fixture-provider-contract', modelIdentity: 'fixture-model-contract', executeHook: async () => ({ success: true, usage: { completion_tokens: 2 }, request_metadata: { response_reference: 'fixture-response-ref' } }) });
  let tick = 0;
  const harness = new BenchmarkHarness({ adapter, credentialProvider: new FakeCredentialProvider(), writer, runIdFactory: () => 'run_fixture_contract_review', clock: { now: () => new Date('2099-12-11T00:00:00.000Z'), monotonicNow: () => { tick += 10; return tick; } } });
  const raw = await harness.run({ benchmark_task: 'fixture.contract.task', task_identity: { task_id: 'fixture.contract.task', task_version: '1.0.0' }, prompt_identity: { prompt_id: 'fixture.contract.prompt', prompt_version: '1.0.0' }, parameters: {}, metadata: { fixture_only: true } });
  assert.equal(raw.metadata.measurement_provenance.throughput.source, 'computed'); assert.ok(raw.metadata.measurement_provenance.throughput.formula); assert.equal(raw.metadata.response_reference, 'fixture-response-ref');
});

test('Admission and readiness implementation contain no network or external AI path', async () => {
  const names = ['result-admission-gate.mjs', 'provenance-validator.mjs', 'result-readiness-checker.mjs'];
  const combined = (await Promise.all(names.map((name) => readFile(resolve(projectRoot, 'src', 'intake', name), 'utf8')))).join('\n');
  assert.doesNotMatch(combined, /\bfetch\s*\(|https?\.request\s*\(|from ['"](?:axios|openai)['"]|process\.env/iu);
  assert.equal(networkRequests, 0);
});
