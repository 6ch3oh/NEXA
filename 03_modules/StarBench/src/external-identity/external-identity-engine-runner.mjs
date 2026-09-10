import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { consumeExternalIdentityEvidence } from './external-identity-engine-port.mjs';
import { computeKbfArtifactSha256, KBF_ENGINE_ID } from './kbf-offline-adapter.mjs';
import {
  EXTERNAL_IDENTITY_RUNNER_VERSION,
  RUNNER_ALLOWED_OUTPUT_ROOT,
  RUNNER_EXPECTED_RESULT_ARTIFACT,
  RUNNER_PINNED_PYTHON_EXECUTABLE,
  validateExternalIdentityRunnerRequest,
} from './external-identity-runner-contracts.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, '..', '..');
const kbfSourceRoot = resolve(projectRoot, 'source_import', 'third_party_candidates', 'KBF');
const runtimeRoot = resolve(projectRoot, ...RUNNER_ALLOWED_OUTPUT_ROOT.split('/'));
const localRequestsShim = resolve(moduleDirectory, 'runtime', 'kbf_local_requests.py');
const MAX_LOG_BYTES = 16 * 1024;
const KBF_SOURCE_MANIFEST = Object.freeze({
  'scripts/kbf_test.py': 'b760577088735ac5521f6cbd98d25604185df5d012f16be562ef3fa667f06f04',
  'scripts/kbf_common.py': '99840daf31aa0e97f8ec5ce54a61224a38b921dfe861a6f6535f7d46aefbbacb',
  'scripts/protocols.py': '243adc45b80f228c2fbbeefaa7d07e8c84bdea77c3f636d5f4a5a26cd56d164a',
  'scripts/domains.py': '85be7049ac94627ac4c97534da48fd98fece487c191f8d7733ef4280567acc40',
});

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function within(root, candidate) { return candidate === root || candidate.startsWith(`${root}${sep}`); }
function sanitizeLog(value) {
  return value
    .replace(/Authorization\s*:\s*Bearer\s+[^\s"']+/giu, 'Authorization: Bearer [REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{6,}/gu, 'Bearer [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|token|secret)["']?\s*[:=]\s*)[^\s,;}]+/giu, '$1[REDACTED]');
}
function boundedCollector(stream) {
  const parts = []; let bytes = 0; let truncated = false;
  stream.on('data', (chunk) => {
    const buffer = Buffer.from(chunk);
    const remaining = MAX_LOG_BYTES - bytes;
    if (remaining > 0) {
      const kept = buffer.subarray(0, remaining);
      parts.push(kept); bytes += kept.length;
    }
    if (buffer.length > remaining) truncated = true;
  });
  return () => ({ text: sanitizeLog(Buffer.concat(parts).toString('utf8')), truncated });
}
async function verifyAndStageKbf(stageRoot) {
  for (const [relative, expected] of Object.entries(KBF_SOURCE_MANIFEST)) {
    const source = resolve(kbfSourceRoot, ...relative.split('/'));
    const body = await readFile(source);
    if (sha256(body) !== expected) throw Object.assign(new Error(`Pinned KBF source hash mismatch: ${relative}`), { code: 'RUNNER_KBF_SOURCE_HASH_MISMATCH' });
    const destination = resolve(stageRoot, ...relative.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await copyFile(localRequestsShim, resolve(stageRoot, 'scripts', 'requests.py'));
}
async function artifactFacts(artifactRoot, expectedArtifact, outputBudget) {
  const names = await readdir(artifactRoot, { withFileTypes: true });
  if (names.some((entry) => !entry.isFile()) || names.length > outputBudget.max_files) throw Object.assign(new Error('Runner artifact file-count budget exceeded.'), { code: 'RUNNER_OUTPUT_FILE_COUNT_EXCEEDED' });
  let total = 0;
  for (const entry of names) {
    const candidate = resolve(artifactRoot, entry.name);
    if (!within(artifactRoot, candidate)) throw Object.assign(new Error('Runner artifact escaped its output root.'), { code: 'RUNNER_OUTPUT_PATH_ESCAPE' });
    const facts = await lstat(candidate);
    if (!facts.isFile() || facts.isSymbolicLink()) throw Object.assign(new Error('Runner artifact must be a regular file.'), { code: 'RUNNER_OUTPUT_TYPE_INVALID' });
    if (facts.size > outputBudget.max_file_bytes) throw Object.assign(new Error('Runner artifact file-size budget exceeded.'), { code: 'RUNNER_OUTPUT_FILE_SIZE_EXCEEDED' });
    total += facts.size;
  }
  if (total > outputBudget.max_total_bytes) throw Object.assign(new Error('Runner total output budget exceeded.'), { code: 'RUNNER_OUTPUT_TOTAL_SIZE_EXCEEDED' });
  await stat(expectedArtifact);
}
function baseReport(request) {
  return {
    runner_version: EXTERNAL_IDENTITY_RUNNER_VERSION,
    engine_id: request.engine_id,
    engine_source_commit: request.engine_source_commit,
    execution_mode: request.execution_mode,
    target_endpoint_type: request.target_endpoint_type,
    target_model_claim: request.target_model_claim,
    request_budget: request.request_budget,
    request_count: 0,
    runtime_budget_ms: request.runtime_budget_ms,
    token_budget: request.token_budget,
    allowed_output_root: RUNNER_ALLOWED_OUTPUT_ROOT,
    expected_result_artifact: RUNNER_EXPECTED_RESULT_ARTIFACT,
    execution_status: 'STOPPED',
    exit_code: null,
    process_id: null,
    stdout: '',
    stderr: '',
    stdout_truncated: false,
    stderr_truncated: false,
    produced_artifact_sha256: null,
    normalization_result: null,
    warnings: [],
    failure_reason: null,
    workspace_cleaned: false,
    residual_process: false,
  };
}
function failure(report, code, message) {
  report.execution_status = 'STOPPED';
  report.failure_reason = { code, message: sanitizeLog(message) };
  return report;
}
async function readRequestCount(path) {
  try {
    const value = Number.parseInt(await readFile(path, 'ascii'), 10);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}

export async function runExternalIdentityEngine(input = {}) {
  const request = validateExternalIdentityRunnerRequest(input);
  if (computeKbfArtifactSha256(request.reference_artifact) !== request.expected_reference_sha256) throw Object.assign(new Error('Reference artifact SHA-256 mismatch.'), { code: 'RUNNER_REFERENCE_HASH_MISMATCH' });
  try { assertNoSensitiveData(JSON.parse(request.reference_artifact), 'Runner reference artifact'); } catch (error) { throw Object.assign(new Error('Runner reference artifact is invalid or sensitive.', { cause: error }), { code: 'RUNNER_REFERENCE_ARTIFACT_REJECTED' }); }

  const runRoot = resolve(runtimeRoot, request.run_id);
  if (!within(runtimeRoot, runRoot)) throw Object.assign(new Error('Runner workspace escaped the allowed output root.'), { code: 'RUNNER_OUTPUT_PATH_ESCAPE' });
  const stageRoot = resolve(runRoot, 'kbf');
  const artifactRoot = resolve(stageRoot, 'artifacts');
  const resultPath = resolve(stageRoot, ...RUNNER_EXPECTED_RESULT_ARTIFACT.split('/'));
  const referencePath = resolve(stageRoot, 'probes', 'reference', 'starbench-local-mock.json');
  const countPath = resolve(runRoot, 'request-count.txt');
  let report = baseReport(request);
  let child = null;

  try {
    await mkdir(runRoot, { recursive: false });
    await verifyAndStageKbf(stageRoot);
    await mkdir(dirname(referencePath), { recursive: true });
    await writeFile(referencePath, request.reference_artifact, { encoding: 'utf8', flag: 'wx' });

    const environment = {
      SYSTEMROOT: process.env.SystemRoot ?? 'C:\\Windows',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      STARBENCH_REQUEST_BUDGET: String(request.request_budget),
      STARBENCH_REQUEST_COUNT_FILE: countPath,
      STARBENCH_LOCAL_HTTP_TIMEOUT_MS: String(Math.max(100, Math.min(request.runtime_budget_ms, 2_000))),
    };
    const argumentsList = [
      resolve(stageRoot, 'scripts', 'kbf_test.py'),
      '--reference', 'probes/reference/starbench-local-mock.json',
      '--target', request.target_model_claim,
      '--api-base', request.endpoint_url,
      '--api-key', 'test-only-placeholder',
      '--protocol', 'openai-chat',
      '--batch-size', '1',
      '--min-coverage', '0.5',
      '--output', RUNNER_EXPECTED_RESULT_ARTIFACT,
    ];
    child = spawn(RUNNER_PINNED_PYTHON_EXECUTABLE, argumentsList, { cwd: stageRoot, env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    report.process_id = child.pid ?? null;
    const stdout = boundedCollector(child.stdout);
    const stderr = boundedCollector(child.stderr);
    const completed = await new Promise((resolveCompletion) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, request.runtime_budget_ms);
      child.once('error', (error) => { clearTimeout(timer); resolveCompletion({ error, timedOut }); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolveCompletion({ code, signal, timedOut }); });
    });
    const stdoutResult = stdout(); const stderrResult = stderr();
    Object.assign(report, { stdout: stdoutResult.text, stderr: stderrResult.text, stdout_truncated: stdoutResult.truncated, stderr_truncated: stderrResult.truncated });
    report.exit_code = Number.isInteger(completed.code) ? completed.code : null;
    report.request_count = await readRequestCount(countPath);
    if (completed.timedOut) { failure(report, 'RUNNER_TIMEOUT', 'Pinned KBF exceeded the runtime budget and was terminated.'); }
    else if (completed.error) { failure(report, 'RUNNER_PROCESS_START_FAILED', completed.error.message); }
    else if (report.exit_code !== 0) {
      const code = report.stderr.includes('STARBENCH_REQUEST_BUDGET_EXHAUSTED') ? 'RUNNER_REQUEST_BUDGET_EXHAUSTED' : 'RUNNER_KBF_EXIT_INVALID';
      failure(report, code, `Pinned KBF exited with code ${report.exit_code}.`);
    } else {
      await artifactFacts(artifactRoot, resultPath, request.output_budget);
      const targetArtifact = await readFile(resultPath, 'utf8');
      const producedHash = computeKbfArtifactSha256(targetArtifact);
      report.produced_artifact_sha256 = producedHash;
      if (request.expected_produced_artifact_sha256 !== null && request.expected_produced_artifact_sha256 !== producedHash) failure(report, 'RUNNER_RESULT_HASH_MISMATCH', 'Produced KBF artifact SHA-256 did not match the caller-frozen expectation.');
      else {
        try {
          report.normalization_result = consumeExternalIdentityEvidence({
            engineId: KBF_ENGINE_ID,
            referenceArtifact: request.reference_artifact,
            targetArtifact,
            expectedReferenceSha256: request.expected_reference_sha256,
            expectedRawArtifactSha256: producedHash,
            engineSourceCommit: request.engine_source_commit,
          });
          report.execution_status = 'COMPLETED';
          report.warnings = [...new Set(['LOCAL_MOCK_ONLY', 'MOCK_TOKEN_USAGE_NOT_PROVIDER_COST', ...report.normalization_result.warnings])].sort();
        } catch (error) { failure(report, 'RUNNER_NORMALIZATION_FAILED', `${error.code ?? error.name}: ${error.message}`); }
      }
    }
  } catch (error) {
    failure(report, error.code ?? 'RUNNER_EXECUTION_FAILED', error.message);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    try { await rm(runRoot, { recursive: true, force: true }); report.workspace_cleaned = true; } catch (error) { failure(report, 'RUNNER_WORKSPACE_CLEANUP_FAILED', error.message); }
  }
  return structuredClone(report);
}

export function getPinnedKbfSourceManifest() { return structuredClone(KBF_SOURCE_MANIFEST); }
