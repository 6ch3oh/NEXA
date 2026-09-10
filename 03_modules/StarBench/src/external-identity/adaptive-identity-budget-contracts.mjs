import { plain, stableSha256 } from '../scoring/score-contracts.mjs';
import { ExternalIdentityRunnerError } from './external-identity-runner-contracts.mjs';

export const IDENTITY_TEST_BUDGET_VERSION = '0.1.0';
export const IDENTITY_TEST_MODES = Object.freeze(['QUICK', 'STANDARD', 'FULL', 'FORENSIC']);
export const EVIDENCE_SUFFICIENCY_STATES = Object.freeze([
  'INSUFFICIENT',
  'SUFFICIENT_FOR_SCREENING',
  'SUFFICIENT_FOR_STANDARD_ASSESSMENT',
  'SUFFICIENT_FOR_FULL_ASSESSMENT',
]);
export const TOKEN_LIMIT_UNKNOWN = 'TBD_BY_MEASUREMENT';

export const IDENTITY_MODE_POLICIES = Object.freeze({
  QUICK: Object.freeze({
    request_ceiling: 4,
    duration_ceiling_ms: 5_000,
    evidence_target: 'SUFFICIENT_FOR_SCREENING',
    approval_level: 'USER_SELECTED_QUICK',
    test_families: Object.freeze(['IDENTITY_SCREENING', 'API_COMPATIBILITY_SCREENING']),
    long_context_policy: 'DISABLED',
    mixed_routing_policy: 'NOT_EVALUATED',
  }),
  STANDARD: Object.freeze({
    request_ceiling: 8,
    duration_ceiling_ms: 10_000,
    evidence_target: 'SUFFICIENT_FOR_STANDARD_ASSESSMENT',
    approval_level: 'USER_SELECTED_STANDARD',
    test_families: Object.freeze(['IDENTITY_ASSESSMENT', 'CORE_CAPABILITY', 'API_COMPATIBILITY', 'BASIC_STABILITY']),
    long_context_policy: 'PROGRESSIVE_BY_MODEL_CAPABILITY_CONTRACT',
    mixed_routing_policy: 'ANOMALY_SIGNAL_ONLY',
  }),
  FULL: Object.freeze({
    request_ceiling: 16,
    duration_ceiling_ms: 15_000,
    evidence_target: 'SUFFICIENT_FOR_FULL_ASSESSMENT',
    approval_level: 'EXPLICIT_USER_SELECTION_REQUIRED',
    test_families: Object.freeze(['REFERENCE_RELAY_COMPARISON', 'IDENTITY_ASSESSMENT', 'CORE_CAPABILITY', 'API_COMPATIBILITY', 'STABILITY', 'PROGRESSIVE_LONG_CONTEXT']),
    long_context_policy: 'PROGRESSIVE_BY_MODEL_CAPABILITY_CONTRACT',
    mixed_routing_policy: 'SIGNAL_FOR_FORENSIC_REVIEW',
  }),
  FORENSIC: Object.freeze({
    request_ceiling: 16,
    duration_ceiling_ms: 15_000,
    evidence_target: 'SUFFICIENT_FOR_FULL_ASSESSMENT',
    approval_level: 'EXPLICIT_USER_AUTHORIZATION_REQUIRED',
    test_families: Object.freeze(['REPEATED_SAMPLES', 'MULTI_SESSION_SAMPLES', 'TEMPORAL_SAMPLES', 'FINGERPRINT_CLUSTER_COMPARISON']),
    long_context_policy: 'MODEL_CAPABILITY_CONTRACT_REQUIRED',
    mixed_routing_policy: 'FORENSIC_CONTRACT_ONLY_EXECUTION_NOT_IMPLEMENTED',
  }),
});

function fail(code, message) { throw new ExternalIdentityRunnerError(code, message); }
function limit(status = TOKEN_LIMIT_UNKNOWN, value = null) { return { status, value }; }
function syntheticLimit(value) {
  if (value === null) return limit();
  if (!Number.isInteger(value) || value < 0) fail('IDENTITY_TOKEN_LIMIT_INVALID', 'Synthetic token limits must be non-negative integers.');
  return limit('SYNTHETIC_TEST_LIMIT', value);
}
function exactObject(value, keys, code) {
  if (!plain(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) fail(code, 'Identity budget contract shape is invalid.');
}

export function createIdentityTestBudget({
  mode,
  sourceClass = 'PLANNING_CONTRACT',
  maxRequests = null,
  fullModeSelected = false,
  forensicAuthorized = false,
  syntheticTokenCeilings = null,
  syntheticMonetaryCeiling = null,
  pricingSnapshotRef = null,
} = {}) {
  if (!IDENTITY_TEST_MODES.includes(mode)) fail('IDENTITY_TEST_MODE_INVALID', 'Identity test mode is invalid.');
  if (!['PLANNING_CONTRACT', 'TEST_FIXTURE'].includes(sourceClass)) fail('IDENTITY_BUDGET_SOURCE_CLASS_INVALID', 'Budget source class is invalid.');
  if (mode === 'FULL' && fullModeSelected !== true) fail('FULL_EXPLICIT_SELECTION_REQUIRED', 'FULL requires explicit user selection.');
  if (mode === 'FORENSIC' && forensicAuthorized !== true) fail('FORENSIC_EXPLICIT_AUTHORIZATION_REQUIRED', 'FORENSIC requires explicit user authorization.');
  const policy = IDENTITY_MODE_POLICIES[mode];
  const requestCeiling = maxRequests ?? policy.request_ceiling;
  if (!Number.isInteger(requestCeiling) || requestCeiling < 1 || requestCeiling > policy.request_ceiling) fail('IDENTITY_REQUEST_CEILING_INVALID', 'Request ceiling must remain within the selected mode policy.');
  if (sourceClass !== 'TEST_FIXTURE' && (syntheticTokenCeilings !== null || syntheticMonetaryCeiling !== null)) fail('SYNTHETIC_BUDGET_LIMIT_NOT_ALLOWED', 'Synthetic limits cannot enter a planning budget.');
  const tokenValues = syntheticTokenCeilings ?? { input: null, output: null, reasoning: null, total: null };
  exactObject(tokenValues, ['input', 'output', 'reasoning', 'total'], 'IDENTITY_TOKEN_LIMIT_INVALID');
  const tokenCeiling = Object.fromEntries(Object.entries(tokenValues).map(([key, value]) => [key, syntheticLimit(value)]));
  let monetaryCeiling = { status: TOKEN_LIMIT_UNKNOWN, amount: null, currency: null, pricing_snapshot_ref: pricingSnapshotRef };
  if (syntheticMonetaryCeiling !== null) {
    exactObject(syntheticMonetaryCeiling, ['amount', 'currency'], 'IDENTITY_MONETARY_LIMIT_INVALID');
    if (typeof syntheticMonetaryCeiling.amount !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/u.test(syntheticMonetaryCeiling.amount) || typeof syntheticMonetaryCeiling.currency !== 'string' || !syntheticMonetaryCeiling.currency) fail('IDENTITY_MONETARY_LIMIT_INVALID', 'Synthetic monetary ceiling is invalid.');
    monetaryCeiling = { status: 'SYNTHETIC_TEST_LIMIT', ...syntheticMonetaryCeiling, pricing_snapshot_ref: pricingSnapshotRef };
  }
  const semantic = {
    source_class: sourceClass,
    mode,
    request_ceiling: requestCeiling,
    token_ceiling: tokenCeiling,
    duration_ceiling_ms: policy.duration_ceiling_ms,
    output_ceiling_bytes: 256 * 1024,
    monetary_ceiling: monetaryCeiling,
    evidence_target: policy.evidence_target,
    automatic_escalation_allowed: false,
    early_stop_policy: ['OBVIOUS_FAILURE', 'EVIDENCE_TARGET_REACHED', 'BUDGET_EXHAUSTED'],
    failure_stop_policy: 'STOP_CURRENT_STAGE_NO_REAL_EXECUTION_RETRY',
    reference_reuse_policy: 'EXACT_IDENTITY_HASH_AND_PROVENANCE_REQUIRED',
    long_context_policy: policy.long_context_policy,
    mixed_routing_policy: policy.mixed_routing_policy,
    approval_level: policy.approval_level,
  };
  return {
    schema_version: '0.1',
    record_type: 'IDENTITY_TEST_BUDGET',
    budget_id: `identity_budget_${stableSha256(semantic)}`,
    budget_version: IDENTITY_TEST_BUDGET_VERSION,
    ...structuredClone(semantic),
  };
}

export function validateIdentityTestBudget(value) {
  const keys = ['schema_version', 'record_type', 'budget_id', 'budget_version', 'source_class', 'mode', 'request_ceiling', 'token_ceiling', 'duration_ceiling_ms', 'output_ceiling_bytes', 'monetary_ceiling', 'evidence_target', 'automatic_escalation_allowed', 'early_stop_policy', 'failure_stop_policy', 'reference_reuse_policy', 'long_context_policy', 'mixed_routing_policy', 'approval_level'];
  exactObject(value, keys, 'IDENTITY_TEST_BUDGET_INVALID');
  const semantic = Object.fromEntries(keys.filter((key) => !['schema_version', 'record_type', 'budget_id', 'budget_version'].includes(key)).map((key) => [key, value[key]]));
  if (value.schema_version !== '0.1' || value.record_type !== 'IDENTITY_TEST_BUDGET' || value.budget_version !== IDENTITY_TEST_BUDGET_VERSION || value.budget_id !== `identity_budget_${stableSha256(semantic)}` || !IDENTITY_TEST_MODES.includes(value.mode) || !EVIDENCE_SUFFICIENCY_STATES.includes(value.evidence_target) || value.automatic_escalation_allowed !== false) fail('IDENTITY_TEST_BUDGET_INVALID', 'Identity Test Budget V0.1 is invalid.');
  return structuredClone(value);
}
