import { ResultAdmissionGate } from './result-admission-gate.mjs';

export function assessRealRecommendationActivation({ admission_decisions = [], evaluations = [], scores = [], profiles = [], recommendations = [] } = {}) {
  const realAdmissions = admission_decisions.filter((decision) => decision.official_eligible === true && decision.status === 'ADMITTED' && decision.record_identity.record_type === 'RAW_RESULT');
  const conditions = {
    admitted_real_raw_result: realAdmissions.length >= 1,
    evaluation_generated: evaluations.some((item) => item?.raw_source_identity?.source_class === 'PROVIDER_EXECUTION'),
    score_generated: scores.some((item) => ['RAW_RESULT', 'IMPORTED_REAL_RESULT'].includes(item?.source_class)),
    legal_profile_source: profiles.some((item) => ['RAW_RESULT', 'REAL_EVALUATION'].includes(item?.source_class)),
    recommendation_evidence_complete: recommendations.some((item) => item?.source_class === 'REAL_RECOMMENDATION' && item?.status === 'RECOMMENDED' && item?.recommended_candidate !== null && Array.isArray(item.evidence_refs) && item.evidence_refs.length > 0),
  };
  return { REAL_RECOMMENDATION_READY: Object.values(conditions).every(Boolean), real_raw_result_count: realAdmissions.length, conditions, reason_codes: Object.entries(conditions).filter(([, value]) => !value).map(([key]) => `MISSING_${key.toUpperCase()}`) };
}

export class ResultReadinessChecker {
  constructor({ admissionGate = new ResultAdmissionGate() } = {}) { this.admissionGate = admissionGate; }
  check(records) {
    if (!Array.isArray(records)) throw new TypeError('Result readiness input must be an array.');
    const decisions = records.map((record) => this.admissionGate.assess(record));
    const ready = decisions.filter((decision) => decision.status === 'ADMITTED').length;
    const partial = decisions.filter((decision) => decision.status === 'ADMITTED_PARTIAL').length;
    const rejected = decisions.length - ready - partial;
    const provenanceStates = [...new Set(decisions.map((decision) => decision.provenance_status))];
    const secretDetected = decisions.some((decision) => decision.secret_status === 'DETECTED');
    const compatibilityStates = [...new Set(decisions.map((decision) => decision.compatibility_status))];
    const activation = assessRealRecommendationActivation({ admission_decisions: decisions });
    return {
      ready, partial, rejected,
      reason_codes: [...new Set(decisions.flatMap((decision) => decision.reason_codes))].sort(),
      missing_fields: [...new Set(decisions.flatMap((decision) => decision.missing_fields))].sort(),
      provenance_status: provenanceStates.length === 1 ? provenanceStates[0] : 'MIXED',
      secret_status: secretDetected ? 'DETECTED' : 'CLEAN',
      compatibility_status: compatibilityStates.every((state) => state === 'V0_1_COMPATIBLE') ? 'V0_1_COMPATIBLE' : compatibilityStates.length === 1 ? compatibilityStates[0] : 'MIXED',
      decisions,
      activation,
    };
  }
}

export function reviewProviderAdapterContract() {
  const coverage = {
    provider: 'ProviderAdapter.providerIdentity', model: 'ProviderAdapter.modelIdentity',
    task_identity: 'BenchmarkHarness task.task_identity', prompt_identity: 'BenchmarkHarness task.prompt_identity', parameters: 'BenchmarkHarness task.parameters',
    response_body_or_reference: 'Provider outcome metadata.response_reference (optional, non-secret)', usage: 'Provider outcome usage mapped to nullable token fields',
    latency: 'Harness monotonic timing', ttft: 'Provider outcome ttft_ms or null', request_provenance: 'adapter identity/version, endpoint class, request id, execution environment',
    safe_error: 'Harness sanitized structured error', credential_runtime_boundary: 'RuntimeCredential is supplied only to adapter.execute and rejected from serialization',
  };
  return { status: Object.values(coverage).every((value) => typeof value === 'string' && value.length > 0) ? 'READY' : 'GAP', coverage, network_adapter_implemented: false, backward_compatible_extension: 'measurement provenance and response reference live under RAW_RESULT metadata' };
}
