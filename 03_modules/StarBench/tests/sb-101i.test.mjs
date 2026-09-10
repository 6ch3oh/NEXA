import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadBenchmarkTask } from '../src/benchmark-task-loader.mjs';
import { RuntimeCredential } from '../src/credential-provider.mjs';
import { loadScenarioDefinition } from '../src/profile/scenario-registry.mjs';
import {
  DEEPSEEK_ACTIVATION_CONFIG,
  DeepSeekEnvironmentCredentialProvider,
  DeepSeekOfficialAdapter,
  deepSeekCredentialPresence,
  getDeepSeekActivationPreflight,
} from '../src/providers/deepseek-official-adapter.mjs';
import { loadRecommendationPolicy } from '../src/recommendation/policy-loader.mjs';
import { runActivationPreflight, runOneShotActivation } from '../scripts/run-real-activation.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '..');
const tempRoot = resolve(testDir, '.tmp-sb-101i');
const realDir = resolve(projectRoot, 'benchmarks', 'real');
let networkRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests += 1; throw new Error('NETWORK_FORBIDDEN'); };

after(async () => { globalThis.fetch = originalFetch; await rm(tempRoot, { recursive: true, force: true }); });

test('official activation configuration is fixed to the single authorized target and request shape', () => {
  assert.deepEqual(DEEPSEEK_ACTIVATION_CONFIG, {
    endpoint: 'https://api.deepseek.com/chat/completions', hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
    model: 'deepseek-v4-flash', thinking: 'disabled', stream: false, max_tokens: 32, retry_count: 0, timeout_ms: 30000,
  });
});

test('credential preflight reveals presence only', () => {
  assert.equal(deepSeekCredentialPresence({}), 'ABSENT');
  assert.equal(deepSeekCredentialPresence({ DEEPSEEK_API_KEY: 'runtime-only-test-value' }), 'PRESENT');
  const preflight = getDeepSeekActivationPreflight({ DEEPSEEK_API_KEY: 'runtime-only-test-value' });
  assert.equal(preflight.DEEPSEEK_API_KEY, 'PRESENT');
  assert.equal(JSON.stringify(preflight).includes('runtime-only-test-value'), false);
});

test('environment Credential stays opaque and cannot be serialized', async () => {
  const provider = new DeepSeekEnvironmentCredentialProvider({ environment: { DEEPSEEK_API_KEY: 'runtime-only-test-value' } });
  const credential = await provider.getCredential({ run_id: 'run_fixture_opaque' });
  assert.ok(credential instanceof RuntimeCredential);
  assert.throws(() => JSON.stringify(credential), { code: 'CREDENTIAL_SERIALIZATION_FORBIDDEN' });
});

test('official Adapter sends fixed body through an injected no-network transport exactly once', async () => {
  let calls = 0;
  const adapter = new DeepSeekOfficialAdapter({ requestImplementation: async (_credential, body) => {
    calls += 1;
    assert.equal(body.model, 'deepseek-v4-flash'); assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.stream, false); assert.equal(body.max_tokens, 32);
    return { success: true, usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }, ttft_ms: null, cost: null, request_metadata: { request_id: 'fixture-response-id', response_reference: 'fixture-response-id' }, metadata: { scoring_observation: { output: 'STARBENCH_ACTIVATION_OK' }, provider_response_status: 200 } };
  } });
  const credential = new RuntimeCredential(Object.freeze({ read: () => 'runtime-only-test-value' }));
  const result = await adapter.execute({ credential, task: { prompt_text: 'Return activation token.' } });
  assert.equal(result.success, true); assert.equal(calls, 1); assert.equal(adapter.requestCount, 1);
  await assert.rejects(adapter.execute({ credential, task: { prompt_text: 'Return activation token.' } }), { category: 'request_budget_exhausted' });
  assert.equal(calls, 1);
});

test('provider failure is returned safely without retry', async () => {
  let calls = 0;
  const adapter = new DeepSeekOfficialAdapter({ requestImplementation: async () => { calls += 1; return { success: false, usage: {}, ttft_ms: null, cost: null, request_metadata: { request_id: null, response_reference: null }, error: { category: 'fixture_failure', message: 'Controlled failure.', statusCode: 503, retryable: false }, metadata: { provider_response_status: 503 } }; } });
  const credential = new RuntimeCredential(Object.freeze({ read: () => 'runtime-only-test-value' }));
  const result = await adapter.execute({ credential, task: { prompt_text: 'Return activation token.' } });
  assert.equal(result.success, false); assert.equal(calls, 1); assert.equal(adapter.requestCount, 1);
});

test('formal activation Task, Scenario, and evidence-gated Policy load against frozen contracts', async () => {
  const task = await loadBenchmarkTask(resolve(realDir, 'deepseek-activation-instruction-v0.1.json'), { rootDir: projectRoot });
  const scenario = await loadScenarioDefinition(resolve(realDir, 'deepseek-activation-scenario-v0.1.json'), { rootDir: projectRoot });
  const policy = await loadRecommendationPolicy(resolve(realDir, 'deepseek-activation-recommendation-policy-v0.1.json'), { rootDir: projectRoot });
  assert.equal(task.source_class, 'AUTHORED_DEFINITION'); assert.equal(task.expected_output.reference, 'STARBENCH_ACTIVATION_OK');
  assert.equal(scenario.minimum_evidence, 2); assert.equal(policy.evidence_gates.minimum_evidence, 2); assert.equal(policy.evidence_gates.minimum_confidence, 'MEDIUM');
});

test('zero-call preflight blocks absent Credential without reserving the request budget', async () => {
  const dataRoot = resolve(tempRoot, 'absent');
  const result = await runActivationPreflight({ environment: {}, dataRoot });
  assert.equal(result.status, 'BLOCKED_CREDENTIAL_NOT_INJECTED'); assert.equal(result.DEEPSEEK_API_KEY, 'ABSENT');
  await assert.rejects(access(resolve(dataRoot, 'activation-attempt.json')));
});

test('zero-call preflight passes all fixed configuration checks with injected test environment', async () => {
  const result = await runActivationPreflight({ environment: { DEEPSEEK_API_KEY: 'runtime-only-test-value' }, dataRoot: resolve(tempRoot, 'ready') });
  assert.equal(result.status, 'READY'); assert.equal(result.DEEPSEEK_API_KEY, 'PRESENT'); assert.equal(Object.values(result.checks).every(Boolean), true);
});

test('simulated one-shot chain proves ordering, persistence, admission, scoring, honest Profile, and abstention without network', async () => {
  const dataRoot = resolve(tempRoot, 'chain');
  let transportCalls = 0; let markerObservedBeforeTransport = false;
  const adapter = new DeepSeekOfficialAdapter({ requestImplementation: async (_credential, body) => {
    transportCalls += 1;
    const marker = JSON.parse(await readFile(resolve(dataRoot, 'activation-attempt.json'), 'utf8'));
    markerObservedBeforeTransport = marker.status === 'REQUEST_RESERVED' && /^run_real_activation_/u.test(marker.run_id);
    assert.equal(body.messages[0].content.includes('STARBENCH_ACTIVATION_OK'), true);
    return { success: true, usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }, ttft_ms: null, cost: null, request_metadata: { request_id: 'fixture-activation-response', response_reference: 'fixture-activation-response' }, metadata: { scoring_observation: { output: 'STARBENCH_ACTIVATION_OK' }, provider_response_status: 200 } };
  } });
  let tick = 0;
  const clock = { now: () => new Date('2099-12-20T00:00:00.000Z'), monotonicNow: () => { tick += 10; return tick; } };
  const summary = await runOneShotActivation({ environment: { DEEPSEEK_API_KEY: 'runtime-only-test-value' }, dataRoot, adapter, clock, testMode: true });
  assert.equal(summary.status, 'PASS_TEST_FIXTURE'); assert.equal(transportCalls, 1); assert.equal(summary.api_request_count, 1); assert.equal(markerObservedBeforeTransport, true);
  assert.equal(summary.raw_result.record_type, 'TEST_FIXTURE'); assert.equal(summary.raw_result.source_class, 'TEST_FIXTURE'); assert.equal(summary.admission.status, 'ADMITTED');
  assert.equal(summary.canonical_evaluation.status, 'GENERATED'); assert.equal(summary.score.status, 'SCORED');
  assert.equal(summary.profile.evidence_count, 1); assert.equal(summary.profile.confidence, 'INSUFFICIENT_EVIDENCE');
  assert.equal(summary.recommendation.status, 'INSUFFICIENT_EVIDENCE'); assert.equal(summary.recommendation.recommended_candidate, null);
  assert.equal(summary.activation.REAL_RECOMMENDATION_READY, false); assert.equal(summary.activation.real_raw_result_count, 0);
  const rawText = await readFile(resolve(dataRoot, 'raw-results.jsonl'), 'utf8');
  assert.equal(rawText.includes('runtime-only-test-value'), false);
  for (const file of ['raw-results.jsonl', 'evaluations.jsonl', 'scores.jsonl', 'profiles.jsonl', 'decisions.jsonl', 'activation-summary.json', 'activation-attempt.json']) await access(resolve(dataRoot, file));
});

test('persistent attempt marker prevents a second activation command', async () => {
  const dataRoot = resolve(tempRoot, 'chain');
  const result = await runOneShotActivation({ environment: { DEEPSEEK_API_KEY: 'runtime-only-test-value' }, dataRoot, testMode: true });
  assert.equal(result.status, 'PREFLIGHT_FAILED'); assert.equal(result.api_request_count, 0); assert.equal(result.preflight.checks.attempt_not_previously_reserved, false);
});

test('source contains one authorized URL and no hardcoded Credential, AMD, retry, fallback, or extra endpoint', async () => {
  const source = await readFile(resolve(projectRoot, 'src', 'providers', 'deepseek-official-adapter.mjs'), 'utf8');
  const urls = source.match(/https:\/\/[^'"\s]+/gu) ?? [];
  assert.deepEqual([...new Set(urls)], ['https://api.deepseek.com/chat/completions']);
  assert.doesNotMatch(source, /\bsk-[A-Za-z0-9_-]{8,}\b/u);
  assert.doesNotMatch(source, /AMD_API_Test|api\.amd|\/models|telemetry|analytics/iu);
  assert.equal(networkRequests, 0);
});
