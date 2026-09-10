import { plain, stableSha256 } from '../scoring/score-contracts.mjs';
import { computeKbfArtifactSha256, KBF_ENGINE_ID, KBF_ENGINE_VERSION, KBF_SOURCE_COMMIT } from './kbf-offline-adapter.mjs';
import { ExternalIdentityRunnerError } from './external-identity-runner-contracts.mjs';
import {
  EVIDENCE_SUFFICIENCY_STATES,
  IDENTITY_MODE_POLICIES,
  validateIdentityTestBudget,
} from './adaptive-identity-budget-contracts.mjs';
import { assessIdentityUsageAgainstBudget, normalizeIdentityTokenUsage } from './identity-token-accounting.mjs';

export const ADAPTIVE_IDENTITY_TEST_PLANNER_VERSION = '0.1.0';
const failureSignals = new Set(['ENDPOINT_UNAVAILABLE', 'FORMAT_INCOMPATIBLE', 'IDENTITY_INCONSISTENT', 'INVALID_ARTIFACT', 'BUDGET_VIOLATION']);
const escalation = Object.freeze({
  QUICK: { mode: 'STANDARD', approval_required: 'USER_SELECT_STANDARD' },
  STANDARD: { mode: 'FULL', approval_required: 'EXPLICIT_FULL_SELECTION' },
  FULL: { mode: 'FORENSIC', approval_required: 'EXPLICIT_FORENSIC_AUTHORIZATION' },
  FORENSIC: null,
});

function fail(code, message) { throw new ExternalIdentityRunnerError(code, message); }
function exact(value, keys, code) {
  if (!plain(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) fail(code, 'Adaptive Identity Planner input is invalid.');
}
function evidenceRank(value) { return EVIDENCE_SUFFICIENCY_STATES.indexOf(value); }

export function evaluateCachedReferenceReuse({ required, cached = null } = {}) {
  exact(required, ['engine_id', 'engine_source_commit', 'engine_version', 'probe_version', 'model_claim'], 'REFERENCE_REQUIREMENT_INVALID');
  if (required.engine_id !== KBF_ENGINE_ID || required.engine_source_commit !== KBF_SOURCE_COMMIT || required.engine_version !== KBF_ENGINE_VERSION || typeof required.probe_version !== 'string' || !required.probe_version || typeof required.model_claim !== 'string' || !required.model_claim) fail('REFERENCE_REQUIREMENT_INVALID', 'Required reference identity is invalid.');
  if (cached === null) return { status: 'CACHE_REUSE_DENIED', reason: 'REFERENCE_CACHE_MISSING', artifact_sha256: null };
  exact(cached, ['engine_id', 'engine_source_commit', 'engine_version', 'probe_version', 'model_claim', 'artifact', 'artifact_sha256', 'freshness_status', 'trust_level', 'provenance_status'], 'CACHED_REFERENCE_INVALID');
  if (cached.freshness_status !== 'CURRENT') return { status: 'CACHE_REUSE_DENIED', reason: 'REFERENCE_CACHE_STALE', artifact_sha256: cached.artifact_sha256 ?? null };
  if (!['OFFICIAL_REFERENCE', 'TRUSTED_REFERENCE'].includes(cached.trust_level) || cached.provenance_status !== 'VERIFIED') return { status: 'CACHE_REUSE_DENIED', reason: 'REFERENCE_PROVENANCE_UNTRUSTED', artifact_sha256: cached.artifact_sha256 ?? null };
  const fields = ['engine_id', 'engine_source_commit', 'engine_version', 'probe_version', 'model_claim'];
  if (fields.some((key) => cached[key] !== required[key])) return { status: 'CACHE_REUSE_DENIED', reason: 'REFERENCE_IDENTITY_MISMATCH', artifact_sha256: cached.artifact_sha256 ?? null };
  if (typeof cached.artifact !== 'string' || !/^[a-f0-9]{64}$/u.test(cached.artifact_sha256 ?? '') || computeKbfArtifactSha256(cached.artifact) !== cached.artifact_sha256) return { status: 'CACHE_REUSE_DENIED', reason: 'REFERENCE_HASH_MISMATCH', artifact_sha256: cached.artifact_sha256 ?? null };
  return { status: 'REUSE_REFERENCE', reason: null, artifact_sha256: cached.artifact_sha256 };
}

export function planProgressiveLongContext({ mode, stages = null, completed = [] } = {}) {
  if (mode === 'QUICK') return { status: 'DISABLED_FOR_QUICK', next_stage: null, stop_reason: 'QUICK_EXCLUDES_LONG_CONTEXT' };
  if (!Array.isArray(stages) || stages.length === 0 || !stages.every((stage) => plain(stage) && typeof stage.stage_id === 'string' && stage.stage_id && Number.isInteger(stage.context_tokens) && stage.context_tokens > 0) || new Set(stages.map((stage) => stage.stage_id)).size !== stages.length) return { status: 'CAPABILITY_CONTRACT_REQUIRED', next_stage: null, stop_reason: 'MODEL_CAPABILITY_CONTRACT_REQUIRED' };
  if (!Array.isArray(completed) || !completed.every((item) => plain(item) && typeof item.stage_id === 'string' && ['PASS', 'FAIL'].includes(item.status))) fail('LONG_CONTEXT_RESULT_INVALID', 'Long-context stage results are invalid.');
  const failed = completed.find((item) => item.status === 'FAIL');
  if (failed) return { status: 'STOPPED', next_stage: null, stop_reason: `PREVIOUS_STAGE_FAILED:${failed.stage_id}` };
  const completedIds = new Set(completed.map((item) => item.stage_id));
  const next = stages.find((stage) => !completedIds.has(stage.stage_id));
  return next ? { status: 'READY_NEXT_STAGE', next_stage: structuredClone(next), stop_reason: null } : { status: 'COMPLETED', next_stage: null, stop_reason: 'ALL_CAPABILITY_STAGES_COMPLETED' };
}

export function planAdaptiveIdentityTest({
  mode,
  claimedModel,
  requestedChecks = null,
  budget,
  currentEvidence = { sufficiency: 'INSUFFICIENT', failure_signals: [], completed_families: [] },
  budgetState = { requests_used: 0, usage: null, monetary_assessment: null },
  previousStageOutcome = 'NONE',
  authorization = { full_mode_selected: false, forensic_authorized: false },
  referenceRequirement,
  cachedReference = null,
  longContextCapability = null,
} = {}) {
  const frozenBudget = validateIdentityTestBudget(budget);
  if (frozenBudget.mode !== mode || typeof claimedModel !== 'string' || !claimedModel) fail('ADAPTIVE_PLANNER_REQUEST_INVALID', 'Planner mode or claimed model is invalid.');
  if (mode === 'FULL' && authorization.full_mode_selected !== true) fail('FULL_EXPLICIT_SELECTION_REQUIRED', 'FULL planning requires explicit user selection.');
  if (mode === 'FORENSIC' && authorization.forensic_authorized !== true) fail('FORENSIC_EXPLICIT_AUTHORIZATION_REQUIRED', 'FORENSIC planning requires explicit authorization.');
  exact(currentEvidence, ['sufficiency', 'failure_signals', 'completed_families'], 'CURRENT_EVIDENCE_INVALID');
  if (!EVIDENCE_SUFFICIENCY_STATES.includes(currentEvidence.sufficiency) || !Array.isArray(currentEvidence.failure_signals) || !Array.isArray(currentEvidence.completed_families)) fail('CURRENT_EVIDENCE_INVALID', 'Current evidence is invalid.');
  exact(budgetState, ['requests_used', 'usage', 'monetary_assessment'], 'IDENTITY_BUDGET_STATE_INVALID');
  const policy = IDENTITY_MODE_POLICIES[mode];
  const checks = requestedChecks ?? [...policy.test_families];
  if (!Array.isArray(checks) || checks.some((family) => !policy.test_families.includes(family))) fail('IDENTITY_TEST_FAMILY_NOT_ALLOWED', 'Requested checks exceed the selected mode.');
  const usageAssessment = assessIdentityUsageAgainstBudget({ budget: frozenBudget, usage: budgetState.usage, requestsUsed: budgetState.requests_used, monetaryAssessment: budgetState.monetary_assessment, usageRequired: budgetState.requests_used > 0 });
  const cache = evaluateCachedReferenceReuse({ required: referenceRequirement, cached: cachedReference });
  const longContext = checks.includes('PROGRESSIVE_LONG_CONTEXT') ? planProgressiveLongContext({ mode, ...(longContextCapability ?? {}) }) : { status: mode === 'QUICK' ? 'DISABLED_FOR_QUICK' : 'NOT_REQUESTED', next_stage: null, stop_reason: null };
  let canContinue = true; let stopReason = null; let evidenceStatus = currentEvidence.sufficiency;
  if (mode === 'FORENSIC') { canContinue = false; stopReason = 'FORENSIC_EXECUTION_NOT_IMPLEMENTED'; }
  else if (currentEvidence.failure_signals.some((signal) => failureSignals.has(signal))) { canContinue = false; stopReason = `STOP_OBVIOUS_FAILURE:${currentEvidence.failure_signals.find((signal) => failureSignals.has(signal))}`; }
  else if (evidenceRank(currentEvidence.sufficiency) >= evidenceRank(frozenBudget.evidence_target)) { canContinue = false; stopReason = 'STOP_EVIDENCE_TARGET_REACHED'; }
  else if (usageAssessment.status === 'STOP_BUDGET_EXHAUSTED') { canContinue = false; stopReason = 'STOP_BUDGET_EXHAUSTED'; evidenceStatus = 'INSUFFICIENT'; }
  else if (longContext.status === 'STOPPED') { canContinue = false; stopReason = 'STOP_PROGRESSIVE_LONG_CONTEXT_FAILURE'; }
  const suggestion = ['ANOMALY_DETECTED', 'DEEPER_ASSESSMENT_SUGGESTED', 'MIXED_ROUTING_SUSPECTED'].includes(previousStageOutcome) ? escalation[mode] : null;
  const effectiveRequestCeiling = Math.max(0, frozenBudget.request_ceiling - budgetState.requests_used);
  const semantic = { mode, claimedModel, checks, budget_id: frozenBudget.budget_id, evidence: currentEvidence, budget_state: usageAssessment, cache, long_context: longContext, can_continue: canContinue, stop_reason: stopReason, suggestion };
  return {
    schema_version: '0.1', record_type: 'ADAPTIVE_IDENTITY_TEST_PLAN',
    plan_id: `identity_plan_${stableSha256(semantic)}`, planner_version: ADAPTIVE_IDENTITY_TEST_PLANNER_VERSION,
    selected_mode: mode, claimed_model: claimedModel, allowed_test_families: [...checks],
    budget_id: frozenBudget.budget_id, effective_request_ceiling: effectiveRequestCeiling,
    can_continue: canContinue, must_stop: !canContinue, stop_reason: stopReason,
    evidence_sufficiency: evidenceStatus, evidence_target: frozenBudget.evidence_target,
    reference_cache: cache, long_context: longContext,
    escalation: suggestion ? { status: 'SUGGEST_ESCALATION', suggested_mode: suggestion.mode, approval_required: suggestion.approval_required } : { status: 'NO_ESCALATION_SUGGESTED', suggested_mode: null, approval_required: null },
    automatic_escalation_allowed: false, execution_mode: mode === 'FORENSIC' ? 'CONTRACT_ONLY' : 'EXISTING_RUNNER',
  };
}
