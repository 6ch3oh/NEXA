import { assertNoSensitiveData } from '../credential-provider.mjs';
import { assertValidCapabilityProfile } from '../profile/capability-profile-builder.mjs';
import { plain, stableSha256 } from '../scoring/score-contracts.mjs';
import { CONFIDENCE_ORDER, evaluateCandidate } from './candidate-evaluator.mjs';
import { assertValidRecommendationPolicy, assertValidRecommendationRequest, RecommendationPolicyError } from './policy-loader.mjs';

const statuses = new Set(['RECOMMENDED', 'NO_ELIGIBLE_CANDIDATE', 'INSUFFICIENT_EVIDENCE', 'ABSTAINED', 'TIE', 'INVALID_REQUEST']);
const decisionKeys = new Set(['schema_version', 'record_type', 'decision_id', 'request_id', 'policy_id', 'scenario_id', 'status', 'recommended_candidate', 'eligible_candidates', 'rejected_candidates', 'candidate_assessments', 'decision_score', 'coverage', 'confidence', 'reason_codes', 'explanation', 'evidence_refs', 'source_class', 'generated_at', 'metadata']);
const evidenceReasons = new Set(['COVERAGE_BELOW_MINIMUM', 'EVIDENCE_BELOW_MINIMUM', 'CONFIDENCE_BELOW_MINIMUM']);

export class RecommendationDecisionError extends Error {
  constructor(code, message, errors = [], cause = null) { super(message, cause ? { cause } : undefined); this.name = 'RecommendationDecisionError'; this.code = code; this.errors = errors; }
}

export function validateRecommendationDecision(decision) {
  const errors = [];
  try { assertNoSensitiveData(decision, 'Recommendation Decision'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(decision)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Decision must be an object.' }] };
  for (const key of Object.keys(decision)) if (!decisionKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of decisionKeys) if (!(key in decision)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (decision.schema_version !== '0.1' || decision.record_type !== 'RECOMMENDATION_DECISION' || !/^decision_[a-f0-9]{64}$/u.test(decision.decision_id ?? '')) errors.push({ path: '/', code: 'contract', message: 'Expected Recommendation Decision V0.1.' });
  if (!statuses.has(decision.status) || !Array.isArray(decision.eligible_candidates) || !Array.isArray(decision.rejected_candidates) || !Array.isArray(decision.candidate_assessments) || !Array.isArray(decision.reason_codes) || !Array.isArray(decision.evidence_refs)) errors.push({ path: '/', code: 'type', message: 'Invalid decision collections or status.' });
  if ((decision.status === 'RECOMMENDED') !== (decision.recommended_candidate !== null)) errors.push({ path: '/recommended_candidate', code: 'semantic', message: 'Only RECOMMENDED decisions contain a winner.' });
  if (!(decision.decision_score === null || (typeof decision.decision_score === 'number' && decision.decision_score >= 0 && decision.decision_score <= 1)) || !(decision.coverage === null || (typeof decision.coverage === 'number' && decision.coverage >= 0 && decision.coverage <= 1))) errors.push({ path: '/', code: 'range', message: 'Invalid decision score or coverage.' });
  if (!['TEST_FIXTURE', 'REAL_RECOMMENDATION'].includes(decision.source_class) || !plain(decision.metadata) || !nonEmpty(decision.generated_at) || Number.isNaN(Date.parse(decision.generated_at))) errors.push({ path: '/', code: 'source_or_time', message: 'Invalid source, metadata, or generated_at.' });
  if (decision.source_class === 'TEST_FIXTURE' && decision.metadata.fixture_only !== true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'Fixture decisions must remain fixture_only.' });
  if (decision.source_class === 'REAL_RECOMMENDATION' && decision.metadata.fixture_only === true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'Real decisions cannot be fixture_only.' });
  return { valid: errors.length === 0, errors };
}

function nonEmpty(value) { return typeof value === 'string' && value.length > 0; }
export function assertValidRecommendationDecision(decision) {
  if (decision?.record_type === 'LEGACY_SUMMARY') throw new RecommendationDecisionError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot become a Recommendation Decision.');
  const checked = validateRecommendationDecision(decision);
  if (!checked.valid) throw new RecommendationDecisionError('RECOMMENDATION_DECISION_INVALID', 'Recommendation Decision validation failed.', checked.errors);
  return decision;
}

function evidenceRef(profile) {
  return { profile_id: profile.profile_id, provider: profile.provider, model: profile.model, scenario_id: profile.scenario_id, task_score_ids: [...profile.provenance.task_score_ids], evaluation_ids: [...profile.provenance.evaluation_ids], suite_score_ids: [...profile.provenance.suite_score_ids] };
}

function compactCandidate(assessment) { return { ...assessment.candidate, suitability_score: assessment.suitability_score, confidence: assessment.confidence, coverage: assessment.coverage }; }

function missingProfileAssessment(candidate) {
  return {
    candidate: { candidate_id: `candidate_${stableSha256(candidate)}`, ...candidate },
    eligible: false,
    abstain_required: false,
    gate_results: [{ code: 'CAPABILITY_PROFILE_NOT_SUPPLIED', passed: false, actual: null, required: candidate.profile_id, kind: 'hard' }],
    preference_contributions: [], suitability_score: null, confidence: null, coverage: null, evidence_count: 0,
    reason_codes: ['CAPABILITY_PROFILE_NOT_SUPPLIED'],
  };
}

function winnerReasons(winner) {
  const positive = winner.preference_contributions.filter((item) => item.contribution > 0).sort((a, b) => b.contribution - a.contribution);
  const map = { capability: 'BEST_CAPABILITY_MATCH', cost_efficiency: 'LOWER_COST_PREFERENCE', latency: 'LOWER_LATENCY_PREFERENCE', throughput: 'HIGHER_THROUGHPUT_PREFERENCE', confidence: 'HIGHER_CONFIDENCE_PREFERENCE', coverage: 'HIGHER_COVERAGE_PREFERENCE' };
  return ['POLICY_PREFERENCES_APPLIED', ...positive.slice(0, 3).map((item) => map[item.preference])];
}

export class OfflineRecommendationEngine {
  constructor({ clock = { now: () => new Date() } } = {}) { this.clock = clock; }

  decide({ request, policy, profiles }) {
    assertNoSensitiveData({ request, policy, profiles }, 'Offline Recommendation input');
    assertValidRecommendationRequest(request);
    assertValidRecommendationPolicy(policy);
    if (!Array.isArray(profiles) || profiles.length === 0) throw new RecommendationDecisionError('PROFILES_REQUIRED', 'At least one supplied Capability Profile is required.');
    if (!policy.applicable_scenarios.includes(request.scenario_id)) throw new RecommendationPolicyError('POLICY_SCENARIO_NOT_APPLICABLE', 'Policy is not applicable to the explicit request Scenario.');
    for (const profile of profiles) {
      if (profile?.record_type === 'LEGACY_SUMMARY') throw new RecommendationDecisionError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter Recommendation Policy.');
      assertValidCapabilityProfile(profile);
    }
    const sources = new Set(profiles.map((profile) => profile.source_class));
    if (sources.has('TEST_FIXTURE') && sources.size > 1) throw new RecommendationDecisionError('MIXED_SOURCE_CLASSES_REJECTED', 'Fixture and real Profiles cannot be mixed in one Decision.');
    if (request.source_policy.fixture_decision_only && !sources.has('TEST_FIXTURE')) throw new RecommendationDecisionError('FIXTURE_SOURCE_REQUIRED', 'Request permits fixture-only decisions.');

    const profileKeys = new Set(profiles.map((profile) => `${profile.provider}\u0000${profile.model}\u0000${profile.profile_id}`));
    const missing = request.candidate_scope.candidates
      .filter((candidate) => !profileKeys.has(`${candidate.provider}\u0000${candidate.model}\u0000${candidate.profile_id}`))
      .map(missingProfileAssessment);
    const assessments = [...profiles.map((profile) => evaluateCandidate({ profile, request, policy })), ...missing];
    const eligible = assessments.filter((item) => item.eligible).sort((left, right) => right.suitability_score - left.suitability_score || CONFIDENCE_ORDER[right.confidence] - CONFIDENCE_ORDER[left.confidence] || right.coverage - left.coverage || left.candidate.candidate_id.localeCompare(right.candidate.candidate_id));
    let status;
    let winner = null;
    let reasonCodes;
    if (eligible.length === 0) {
      const failures = assessments.flatMap((item) => item.reason_codes);
      if (assessments.some((item) => item.abstain_required)) status = 'ABSTAINED';
      else if (failures.length > 0 && failures.every((code) => evidenceReasons.has(code))) status = 'INSUFFICIENT_EVIDENCE';
      else status = policy.abstain_policy.on_no_eligible;
      reasonCodes = [status === 'INSUFFICIENT_EVIDENCE' ? 'ALL_CANDIDATES_INSUFFICIENT_EVIDENCE' : status === 'ABSTAINED' ? 'POLICY_ABSTAINED' : 'NO_ELIGIBLE_CANDIDATE'];
    } else if (eligible.length > 1 && Math.abs(eligible[0].suitability_score - eligible[1].suitability_score) <= policy.tie_policy.epsilon) {
      status = 'TIE';
      reasonCodes = ['TOP_CANDIDATES_TIED'];
    } else {
      status = 'RECOMMENDED';
      winner = eligible[0];
      reasonCodes = winnerReasons(winner);
    }
    reasonCodes = [...new Set(reasonCodes)].slice(0, policy.explanation_rules.maximum_reason_codes);
    const semantic = { request_id: request.request_id, policy_id: policy.policy_id, policy_version: policy.version, scenario_id: request.scenario_id, status, recommended_candidate: winner?.candidate ?? null, assessments };
    const decision = {
      schema_version: '0.1', record_type: 'RECOMMENDATION_DECISION', decision_id: `decision_${stableSha256(semantic)}`,
      request_id: request.request_id, policy_id: policy.policy_id, scenario_id: request.scenario_id, status,
      recommended_candidate: winner ? compactCandidate(winner) : null,
      eligible_candidates: eligible.map(compactCandidate),
      rejected_candidates: assessments.filter((item) => !item.eligible).map(compactCandidate),
      candidate_assessments: assessments,
      decision_score: winner?.suitability_score ?? null, coverage: winner?.coverage ?? null, confidence: winner?.confidence ?? null,
      reason_codes: reasonCodes,
      explanation: status === 'RECOMMENDED' ? `Candidate ${winner.candidate.provider}/${winner.candidate.model} satisfies all hard and evidence gates and has the highest policy suitability score.` : status === 'TIE' ? 'The leading eligible candidates are tied within the explicit policy epsilon; no winner is asserted.' : `No recommendation is asserted because the policy outcome is ${status}.`,
      evidence_refs: profiles.map(evidenceRef),
      source_class: sources.has('TEST_FIXTURE') ? 'TEST_FIXTURE' : 'REAL_RECOMMENDATION',
      generated_at: this.clock.now().toISOString(),
      metadata: { fixture_only: sources.has('TEST_FIXTURE'), engine: 'starbench.offline-recommendation-engine', engine_version: '0.1', policy_version: policy.version, explicit_scenario_only: true },
    };
    assertValidRecommendationDecision(decision);
    return decision;
  }
}
