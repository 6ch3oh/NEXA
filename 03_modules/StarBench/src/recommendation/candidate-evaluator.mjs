import { assertValidCapabilityProfile } from '../profile/capability-profile-builder.mjs';
import { stableSha256 } from '../scoring/score-contracts.mjs';

export const CONFIDENCE_ORDER = Object.freeze({ INSUFFICIENT_EVIDENCE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 });

function candidateOf(profile) {
  return {
    candidate_id: `candidate_${stableSha256({ provider: profile.provider, model: profile.model, profile_id: profile.profile_id })}`,
    provider: profile.provider,
    model: profile.model,
    profile_id: profile.profile_id,
  };
}

function gate(code, passed, actual, required, kind = 'hard') { return { code, passed, actual, required, kind }; }

function normalize(value, rule) {
  if (value === null || value === undefined) return null;
  let normalized = (value - rule.min) / (rule.max - rule.min);
  if (rule.direction === 'lower_is_better') normalized = 1 - normalized;
  return rule.clamp ? Math.max(0, Math.min(1, normalized)) : normalized;
}

function inScope(profile, request) {
  return request.candidate_scope.candidates.some((candidate) => candidate.provider === profile.provider && candidate.model === profile.model && candidate.profile_id === profile.profile_id);
}

function observation(profile, name) {
  const value = profile.metadata?.recommendation_observations?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function addUnknown(assessment, code, policy) {
  assessment.gate_results.push(gate(code, false, null, 'known value'));
  assessment.reason_codes.push(code);
  if (policy.hard_gates.unknown_constraint_behavior === 'ABSTAIN_UNKNOWN') assessment.abstain_required = true;
}

export function evaluateCandidate({ profile, request, policy }) {
  assertValidCapabilityProfile(profile);
  const assessment = {
    candidate: candidateOf(profile),
    eligible: true,
    abstain_required: false,
    gate_results: [],
    preference_contributions: [],
    suitability_score: null,
    confidence: profile.confidence_state,
    coverage: profile.coverage,
    evidence_count: profile.evidence_count,
    reason_codes: [],
  };
  const add = (code, passed, actual, required, kind = 'hard') => {
    assessment.gate_results.push(gate(code, passed, actual, required, kind));
    if (!passed) assessment.reason_codes.push(code);
  };

  add('SCENARIO_MISMATCH', profile.scenario_id === request.scenario_id, profile.scenario_id, request.scenario_id);
  add('OUTSIDE_CANDIDATE_SCOPE', inScope(profile, request), profile.profile_id, 'explicit candidate scope');
  add('SOURCE_CLASS_NOT_ALLOWED', request.source_policy.allowed_source_classes.includes(profile.source_class), profile.source_class, request.source_policy.allowed_source_classes);

  const hard = request.hard_constraints;
  const minimumCapability = Math.max(policy.hard_gates.minimum_capability_score, hard.minimum_capability_score ?? 0);
  add('CAPABILITY_BELOW_MINIMUM', profile.capability_score !== null && profile.capability_score >= minimumCapability, profile.capability_score, minimumCapability);
  const minimumCoverage = Math.max(policy.evidence_gates.minimum_coverage, request.minimum_coverage);
  add('COVERAGE_BELOW_MINIMUM', profile.coverage >= minimumCoverage, profile.coverage, minimumCoverage, 'evidence');
  const minimumEvidence = Math.max(policy.evidence_gates.minimum_evidence, request.minimum_evidence);
  add('EVIDENCE_BELOW_MINIMUM', profile.evidence_count >= minimumEvidence, profile.evidence_count, minimumEvidence, 'evidence');
  const minimumConfidence = CONFIDENCE_ORDER[policy.evidence_gates.minimum_confidence] > CONFIDENCE_ORDER[request.minimum_confidence]
    ? policy.evidence_gates.minimum_confidence : request.minimum_confidence;
  add('CONFIDENCE_BELOW_MINIMUM', CONFIDENCE_ORDER[profile.confidence_state] >= CONFIDENCE_ORDER[minimumConfidence], profile.confidence_state, minimumConfidence, 'evidence');

  add('PROVIDER_NOT_ALLOWED', hard.provider_allowlist.length === 0 || hard.provider_allowlist.includes(profile.provider), profile.provider, hard.provider_allowlist);
  add('PROVIDER_DENIED', !hard.provider_denylist.includes(profile.provider), profile.provider, hard.provider_denylist);
  add('MODEL_NOT_ALLOWED', hard.model_allowlist.length === 0 || hard.model_allowlist.includes(profile.model), profile.model, hard.model_allowlist);
  add('MODEL_DENIED', !hard.model_denylist.includes(profile.model), profile.model, hard.model_denylist);
  const metricIds = new Set(profile.metric_summary.metric_ids);
  add('REQUIRED_METRIC_MISSING', hard.required_metrics.every((metricId) => metricIds.has(metricId)), [...metricIds].sort(), hard.required_metrics);

  const cost = observation(profile, 'cost');
  const latency = observation(profile, 'latency_ms');
  const throughput = observation(profile, 'throughput_tokens_per_second');
  if (hard.maximum_cost !== null) {
    if (cost === null) addUnknown(assessment, 'COST_UNKNOWN', policy);
    else add('COST_ABOVE_MAXIMUM', cost <= hard.maximum_cost, cost, hard.maximum_cost);
  }
  if (hard.maximum_latency_ms !== null) {
    if (latency === null) addUnknown(assessment, 'LATENCY_UNKNOWN', policy);
    else add('LATENCY_ABOVE_MAXIMUM', latency <= hard.maximum_latency_ms, latency, hard.maximum_latency_ms);
  }

  assessment.eligible = assessment.gate_results.every((result) => result.passed);
  if (!assessment.eligible) return assessment;

  const weights = { ...policy.preference_weights, ...request.preferences.weight_overrides };
  const values = {
    capability: profile.capability_score,
    cost_efficiency: normalize(cost, policy.normalization_rules.cost),
    latency: normalize(latency, policy.normalization_rules.latency),
    throughput: normalize(throughput, policy.normalization_rules.throughput),
    confidence: policy.normalization_rules.confidence_values[profile.confidence_state],
    coverage: profile.coverage,
  };
  const missing = Object.entries(weights).filter(([key, weight]) => weight > 0 && values[key] === null).map(([key]) => key);
  if (missing.length > 0 && policy.missing_preference_handling !== 'RENORMALIZE_AVAILABLE') {
    assessment.eligible = false;
    assessment.abstain_required = policy.missing_preference_handling === 'ABSTAIN';
    assessment.reason_codes.push('PREFERENCE_DATA_MISSING');
    assessment.gate_results.push(gate('PREFERENCE_DATA_MISSING', false, missing, 'available preference data', 'preference'));
    return assessment;
  }
  const effectiveTotal = Object.entries(weights).reduce((total, [key, weight]) => total + (values[key] === null ? 0 : weight), 0);
  if (effectiveTotal <= 0) {
    assessment.eligible = false;
    assessment.reason_codes.push('NO_EFFECTIVE_PREFERENCE_WEIGHT');
    return assessment;
  }
  for (const [key, configuredWeight] of Object.entries(weights)) {
    const value = values[key];
    const effectiveWeight = value === null ? 0 : configuredWeight / effectiveTotal;
    assessment.preference_contributions.push({ preference: key, raw_value: key === 'cost_efficiency' ? cost : key === 'latency' ? latency : key === 'throughput' ? throughput : profile[key === 'confidence' ? 'confidence_state' : key], normalized_value: value, configured_weight: configuredWeight, effective_weight: effectiveWeight, contribution: value === null ? 0 : value * effectiveWeight });
  }
  assessment.suitability_score = assessment.preference_contributions.reduce((total, item) => total + item.contribution, 0);
  assessment.reason_codes.push('ELIGIBLE');
  return assessment;
}
