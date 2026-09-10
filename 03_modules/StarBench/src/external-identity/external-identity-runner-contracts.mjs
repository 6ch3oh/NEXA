import { ExternalIdentityContractError } from './contracts.mjs';
import { KBF_ENGINE_ID, KBF_SOURCE_COMMIT } from './kbf-offline-adapter.mjs';

export const EXTERNAL_IDENTITY_RUNNER_VERSION = '0.1.0';
export const EXTERNAL_IDENTITY_RUNNER_MODE = 'LOCAL_MOCK_ONLY';
export const REAL_PROVIDER_MODE = 'DISABLED';
export const REMOTE_ENDPOINT_ALLOWED = false;
export const RUNNER_TARGET_ENDPOINT_TYPE = 'LOCAL_OPENAI_COMPATIBLE_MOCK';
export const RUNNER_TOKEN_BUDGET = 'TBD_BY_MEASUREMENT';
export const RUNNER_ALLOWED_OUTPUT_ROOT = 'tests/runtime/external-identity';
export const RUNNER_EXPECTED_RESULT_ARTIFACT = 'artifacts/kbf-result.json';
export const RUNNER_PINNED_PYTHON_EXECUTABLE = 'C:\\Users\\26352\\AppData\\Local\\Python\\pythoncore-3.13-64\\python.exe';

const requestKeys = Object.freeze([
  'run_id', 'engine_id', 'engine_source_commit', 'execution_mode',
  'reference_artifact', 'expected_reference_sha256', 'target_endpoint_type',
  'endpoint_url', 'target_model_claim', 'request_budget', 'runtime_budget_ms',
  'output_budget', 'token_budget', 'expected_produced_artifact_sha256',
]);

export class ExternalIdentityRunnerError extends ExternalIdentityContractError {
  constructor(code, message, errors = [], cause = null) {
    super(code, message, errors, cause);
    this.name = 'ExternalIdentityRunnerError';
  }
}

function fail(code, message, errors = [], cause = null) {
  throw new ExternalIdentityRunnerError(code, message, errors, cause);
}

function exactKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('RUNNER_CONTRACT_INVALID', 'Runner request must be one object.');
  const extras = Object.keys(value).filter((key) => !requestKeys.includes(key));
  if (extras.length > 0) fail('RUNNER_CONTRACT_ADDITIONAL_PROPERTY', 'Runner request contains non-whitelisted fields.', extras.map((key) => ({ path: `/${key}`, code: 'additional_property' })));
}

function safeRunId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value) && !value.includes('..');
}

function safeModelClaim(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(value) && !value.includes('..') && !value.includes('//');
}

function validSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function assertLocalMockEndpoint(endpointUrl) {
  let parsed;
  try { parsed = new URL(endpointUrl); } catch (error) { fail('RUNNER_ENDPOINT_INVALID', 'Runner endpoint must be a valid URL.', [], error); }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) fail('RUNNER_REMOTE_ENDPOINT_REJECTED', 'Runner V0.1 only permits plain HTTP localhost endpoints without URL credentials, query, or fragment.');
  if (!parsed.port || parsed.pathname !== '/v1/chat/completions') fail('RUNNER_ENDPOINT_INVALID', 'Local mock endpoint must use an explicit port and /v1/chat/completions.');
  return parsed.toString();
}

export function validateExternalIdentityRunnerRequest(value) {
  exactKeys(value);
  if (!safeRunId(value.run_id)) fail('RUNNER_RUN_ID_UNSAFE', 'run_id must be a bounded safe local identifier.');
  if (value.engine_id !== KBF_ENGINE_ID || value.engine_source_commit !== KBF_SOURCE_COMMIT) fail('RUNNER_ENGINE_UNSUPPORTED', 'Runner V0.1 only executes the pinned KBF engine.');
  if (value.execution_mode !== EXTERNAL_IDENTITY_RUNNER_MODE) fail('RUNNER_REAL_PROVIDER_MODE_DISABLED', 'Runner V0.1 only supports LOCAL_MOCK_ONLY.');
  if (value.target_endpoint_type !== RUNNER_TARGET_ENDPOINT_TYPE) fail('RUNNER_ENDPOINT_TYPE_INVALID', 'Runner target endpoint type is invalid.');
  assertLocalMockEndpoint(value.endpoint_url);
  if (!safeModelClaim(value.target_model_claim)) fail('RUNNER_MODEL_CLAIM_INVALID', 'target_model_claim is invalid.');
  if (typeof value.reference_artifact !== 'string' || value.reference_artifact.length === 0 || value.reference_artifact.length > 512 * 1024) fail('RUNNER_REFERENCE_ARTIFACT_INVALID', 'reference_artifact must be bounded JSON text.');
  if (!validSha256(value.expected_reference_sha256)) fail('RUNNER_REFERENCE_HASH_INVALID', 'expected_reference_sha256 is invalid.');
  if (!Number.isInteger(value.request_budget) || value.request_budget < 1 || value.request_budget > 16) fail('RUNNER_REQUEST_BUDGET_INVALID', 'request_budget must be an integer from 1 through 16.');
  if (!Number.isInteger(value.runtime_budget_ms) || value.runtime_budget_ms < 250 || value.runtime_budget_ms > 15_000) fail('RUNNER_RUNTIME_BUDGET_INVALID', 'runtime_budget_ms must be an integer from 250 through 15000.');
  const budget = value.output_budget;
  if (!budget || typeof budget !== 'object' || Array.isArray(budget) || Object.keys(budget).sort().join(',') !== 'max_file_bytes,max_files,max_total_bytes') fail('RUNNER_OUTPUT_BUDGET_INVALID', 'output_budget requires only max_files, max_file_bytes, and max_total_bytes.');
  if (!Number.isInteger(budget.max_files) || budget.max_files !== 1 || !Number.isInteger(budget.max_file_bytes) || budget.max_file_bytes < 128 || budget.max_file_bytes > 1024 * 1024 || !Number.isInteger(budget.max_total_bytes) || budget.max_total_bytes < budget.max_file_bytes || budget.max_total_bytes > 1024 * 1024) fail('RUNNER_OUTPUT_BUDGET_INVALID', 'Runner output budget is outside V0.1 bounds.');
  if (value.token_budget !== RUNNER_TOKEN_BUDGET) fail('RUNNER_TOKEN_BUDGET_INVALID', 'Mock token budget must remain TBD_BY_MEASUREMENT.');
  if (value.expected_produced_artifact_sha256 !== null && !validSha256(value.expected_produced_artifact_sha256)) fail('RUNNER_EXPECTED_RESULT_HASH_INVALID', 'Expected produced artifact hash must be null or SHA-256.');
  return structuredClone(value);
}

export function createLocalMockRunnerRequest(overrides = {}) {
  return validateExternalIdentityRunnerRequest({
    run_id: 'local-mock-run',
    engine_id: KBF_ENGINE_ID,
    engine_source_commit: KBF_SOURCE_COMMIT,
    execution_mode: EXTERNAL_IDENTITY_RUNNER_MODE,
    reference_artifact: '{}',
    expected_reference_sha256: '0'.repeat(64),
    target_endpoint_type: RUNNER_TARGET_ENDPOINT_TYPE,
    endpoint_url: 'http://127.0.0.1:1/v1/chat/completions',
    target_model_claim: 'synthetic/starbench-local-mock',
    request_budget: 4,
    runtime_budget_ms: 10_000,
    output_budget: { max_files: 1, max_file_bytes: 256 * 1024, max_total_bytes: 256 * 1024 },
    token_budget: RUNNER_TOKEN_BUDGET,
    expected_produced_artifact_sha256: null,
    ...overrides,
  });
}
