import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';

import { OFFICIALITY_INFERENCE } from '../src/external-identity/contracts.mjs';
import { consumeExternalIdentityEvidence } from '../src/external-identity/external-identity-engine-port.mjs';
import {
  getPinnedKbfSourceManifest,
  runExternalIdentityEngine,
} from '../src/external-identity/external-identity-engine-runner.mjs';
import {
  createLocalMockRunnerRequest,
  EXTERNAL_IDENTITY_RUNNER_MODE,
  EXTERNAL_IDENTITY_RUNNER_VERSION,
  REAL_PROVIDER_MODE,
  REMOTE_ENDPOINT_ALLOWED,
  RUNNER_EXPECTED_RESULT_ARTIFACT,
  RUNNER_PINNED_PYTHON_EXECUTABLE,
  RUNNER_TOKEN_BUDGET,
} from '../src/external-identity/external-identity-runner-contracts.mjs';
import { computeKbfArtifactSha256, KBF_SOURCE_COMMIT } from '../src/external-identity/kbf-offline-adapter.mjs';
import { startLocalKbfMockServer } from './runtime/external-identity/local-kbf-mock-server.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(projectRoot, 'tests', 'fixtures', 'external-identity');
const kbfRoot = resolve(projectRoot, 'source_import', 'third_party_candidates', 'KBF');
const runnerSourcePath = resolve(projectRoot, 'src', 'external-identity', 'external-identity-engine-runner.mjs');
let referenceArtifact;
let referenceHash;
let successReport;
let successRequests;

function request(endpointUrl, runId, overrides = {}) {
  return createLocalMockRunnerRequest({
    run_id: runId,
    endpoint_url: endpointUrl,
    reference_artifact: referenceArtifact,
    expected_reference_sha256: referenceHash,
    ...overrides,
  });
}

function processExists(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

before(async () => {
  referenceArtifact = await readFile(resolve(fixtureRoot, 'runner-kbf-reference-legacy.json'), 'utf8');
  referenceHash = computeKbfArtifactSha256(referenceArtifact);
  const mock = await startLocalKbfMockServer({ behavior: 'insufficient' });
  process.env.STARBENCH_RUNNER_TEST_SECRET = 'must-never-reach-child';
  try {
    successReport = await runExternalIdentityEngine(request(mock.endpointUrl, 'runner-success'));
    successRequests = structuredClone(mock.requests);
  } finally {
    delete process.env.STARBENCH_RUNNER_TEST_SECRET;
    await mock.close();
  }
});

test('Runner contract freezes LOCAL_MOCK_ONLY and disables real Provider mode', () => {
  assert.equal(EXTERNAL_IDENTITY_RUNNER_VERSION, '0.1.0');
  assert.equal(EXTERNAL_IDENTITY_RUNNER_MODE, 'LOCAL_MOCK_ONLY');
  assert.equal(REAL_PROVIDER_MODE, 'DISABLED');
  assert.equal(REMOTE_ENDPOINT_ALLOWED, false);
  assert.equal(RUNNER_TOKEN_BUDGET, 'TBD_BY_MEASUREMENT');
  assert.equal(RUNNER_EXPECTED_RESULT_ARTIFACT, 'artifacts/kbf-result.json');
  assert.equal(RUNNER_PINNED_PYTHON_EXECUTABLE, 'C:\\Users\\26352\\AppData\\Local\\Python\\pythoncore-3.13-64\\python.exe');
});

test('Local mock Runner starts pinned KBF and exits normally', () => {
  assert.equal(successReport.execution_status, 'COMPLETED', JSON.stringify(successReport, null, 2));
  assert.equal(successReport.exit_code, 0);
  assert.equal(successReport.engine_source_commit, KBF_SOURCE_COMMIT);
  assert.equal(successReport.request_count, 2);
  assert.ok(successRequests.every((entry) => entry.remoteAddress === '127.0.0.1'));
});

test('KBF native result enters the existing Port', () => {
  assert.equal(successReport.normalization_result.engine.engine_id, 'KBF');
  assert.equal(successReport.normalization_result.source_verdict, 'UNDETERMINED');
  assert.equal(successReport.normalization_result.normalized_verdict, 'INSUFFICIENT_EVIDENCE');
  assert.equal(successReport.normalization_result.provenance.adapter_identity, 'starbench.kbf-offline-adapter');
  assert.match(successReport.produced_artifact_sha256, /^[a-f0-9]{64}$/u);
});

test('Runner cleans its workspace and leaves no KBF process', () => {
  assert.equal(successReport.workspace_cleaned, true);
  assert.equal(successReport.residual_process, false);
  assert.equal(processExists(successReport.process_id), false);
});

test('Runtime timeout terminates KBF without a residual process', async () => {
  const mock = await startLocalKbfMockServer({ behavior: 'hang' });
  try {
    const report = await runExternalIdentityEngine(request(mock.endpointUrl, 'runner-timeout', { runtime_budget_ms: 300 }));
    assert.equal(report.execution_status, 'STOPPED');
    assert.equal(report.failure_reason.code, 'RUNNER_TIMEOUT');
    assert.equal(report.workspace_cleaned, true);
    assert.equal(processExists(report.process_id), false);
  } finally { await mock.close(); }
});

test('Request budget is enforced before an extra localhost request', async () => {
  const mock = await startLocalKbfMockServer({ behavior: 'insufficient' });
  try {
    const report = await runExternalIdentityEngine(request(mock.endpointUrl, 'runner-request-budget', { request_budget: 1 }));
    assert.equal(report.execution_status, 'STOPPED');
    assert.equal(report.failure_reason.code, 'RUNNER_REQUEST_BUDGET_EXHAUSTED');
    assert.equal(report.request_count, 1);
    assert.equal(mock.requests.length, 1);
  } finally { await mock.close(); }
});

test('Non-localhost endpoints are rejected before process execution', () => {
  for (const endpoint_url of ['https://127.0.0.1:443/v1/chat/completions', 'http://192.0.2.1:8000/v1/chat/completions']) {
    assert.throws(() => request(endpoint_url, 'runner-remote-reject'), (error) => error.code === 'RUNNER_REMOTE_ENDPOINT_REJECTED');
  }
});

test('Arbitrary command fields are rejected by the strict Runner contract', () => {
  assert.throws(() => request('http://127.0.0.1:1/v1/chat/completions', 'runner-command', { command: 'cmd.exe /c whoami' }), (error) => error.code === 'RUNNER_CONTRACT_ADDITIONAL_PROPERTY');
});

test('Arbitrary output path fields are rejected by the strict Runner contract', () => {
  assert.throws(() => request('http://127.0.0.1:1/v1/chat/completions', 'runner-output', { output_root: 'C:\\Windows\\Temp' }), (error) => error.code === 'RUNNER_CONTRACT_ADDITIONAL_PROPERTY');
});

test('Path traversal run identifiers are rejected', () => {
  assert.throws(() => request('http://127.0.0.1:1/v1/chat/completions', '../runner-escape'), (error) => error.code === 'RUNNER_RUN_ID_UNSAFE');
});

test('KBF execution uses a fixed argumentized spawn with no shell', async () => {
  const source = await readFile(runnerSourcePath, 'utf8');
  assert.match(source, /spawn\(RUNNER_PINNED_PYTHON_EXECUTABLE, argumentsList/u);
  assert.match(source, /shell: false/u);
  assert.doesNotMatch(source, /exec(?:File)?\s*\(|shell:\s*true/u);
});

test('Pinned KBF source files retain their frozen hashes', async () => {
  for (const [relative, expected] of Object.entries(getPinnedKbfSourceManifest())) {
    const body = await readFile(resolve(kbfRoot, ...relative.split('/')));
    assert.equal(computeKbfArtifactSha256(body.toString('utf8')), expected, relative);
  }
});

test('Produced artifact hash mismatch stops before Port authority', async () => {
  const mock = await startLocalKbfMockServer({ behavior: 'insufficient' });
  try {
    const report = await runExternalIdentityEngine(request(mock.endpointUrl, 'runner-hash-mismatch', { expected_produced_artifact_sha256: '0'.repeat(64) }));
    assert.equal(report.execution_status, 'STOPPED');
    assert.equal(report.failure_reason.code, 'RUNNER_RESULT_HASH_MISMATCH');
    assert.equal(report.normalization_result, null);
  } finally { await mock.close(); }
});

test('Malformed native result is rejected by the existing Port', () => {
  const malformed = '{not-json';
  assert.throws(() => consumeExternalIdentityEvidence({ engineId: 'KBF', referenceArtifact, targetArtifact: malformed, expectedReferenceSha256: referenceHash, expectedRawArtifactSha256: computeKbfArtifactSha256(malformed), engineSourceCommit: KBF_SOURCE_COMMIT }), (error) => error.code === 'KBF_ARTIFACT_JSON_INVALID');
});

test('SAME fixture still cannot infer an official model', async () => {
  const targetArtifact = await readFile(resolve(fixtureRoot, 'kbf-legacy-same.json'), 'utf8');
  const portReference = await readFile(resolve(fixtureRoot, 'kbf-reference-legacy.json'), 'utf8');
  const observation = consumeExternalIdentityEvidence({ engineId: 'KBF', referenceArtifact: portReference, targetArtifact, expectedReferenceSha256: computeKbfArtifactSha256(portReference), expectedRawArtifactSha256: computeKbfArtifactSha256(targetArtifact), engineSourceCommit: KBF_SOURCE_COMMIT });
  assert.equal(observation.officiality_inference, OFFICIALITY_INFERENCE);
  assert.equal(Object.hasOwn(observation, 'official'), false);
});

test('Child stderr is bounded and redacts sensitive response fields', async () => {
  const mock = await startLocalKbfMockServer({ behavior: 'secret-error' });
  try {
    const report = await runExternalIdentityEngine(request(mock.endpointUrl, 'runner-secret-log', { request_budget: 8, runtime_budget_ms: 5_000 }));
    assert.equal(report.execution_status, 'STOPPED');
    assert.equal(report.failure_reason.code, 'RUNNER_KBF_EXIT_INVALID');
    assert.doesNotMatch(`${report.stdout}\n${report.stderr}\n${JSON.stringify(report.failure_reason)}`, /runner-super-secret|runner-private-key|must-never-reach-child/u);
    assert.ok(Buffer.byteLength(report.stderr, 'utf8') <= 16 * 1024);
  } finally { await mock.close(); }
});

test('Parent environment secrets are not inherited or logged', () => {
  assert.doesNotMatch(`${successReport.stdout}\n${successReport.stderr}`, /must-never-reach-child/u);
});

test('Result file size budget stops oversized native output', async () => {
  const mock = await startLocalKbfMockServer({ behavior: 'insufficient' });
  try {
    const report = await runExternalIdentityEngine(request(mock.endpointUrl, 'runner-output-budget', { output_budget: { max_files: 1, max_file_bytes: 128, max_total_bytes: 128 } }));
    assert.equal(report.execution_status, 'STOPPED');
    assert.equal(report.failure_reason.code, 'RUNNER_OUTPUT_FILE_SIZE_EXCEEDED');
  } finally { await mock.close(); }
});

test('REAL_PROVIDER mode fails closed', () => {
  assert.throws(() => request('http://127.0.0.1:1/v1/chat/completions', 'runner-real-provider', { execution_mode: 'REAL_PROVIDER' }), (error) => error.code === 'RUNNER_REAL_PROVIDER_MODE_DISABLED');
});

test('Reference hash mismatch fails before any subprocess is created', async () => {
  const mock = await startLocalKbfMockServer({ behavior: 'insufficient' });
  try {
    await assert.rejects(() => runExternalIdentityEngine(request(mock.endpointUrl, 'runner-reference-hash', { expected_reference_sha256: '0'.repeat(64) })), (error) => error.code === 'RUNNER_REFERENCE_HASH_MISMATCH');
    assert.equal(mock.requests.length, 0);
  } finally { await mock.close(); }
});
