import { assertNoSensitiveData } from '../credential-provider.mjs';

function groupBy(values, keyOf) { const groups = new Map(); for (const value of values) { const key = keyOf(value); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(value); } return groups; }

export class EvidenceSufficiencyError extends Error { constructor(code, message) { super(message); this.name = 'EvidenceSufficiencyError'; this.code = code; } }

export function deriveEvidenceRequirements({ coverageContract, scenarioRequirement }) {
  if (coverageContract?.record_type !== 'PHASE2_BENCHMARK_COVERAGE_CONTRACT' || scenarioRequirement?.record_type !== 'SCENARIO_EVIDENCE_REQUIREMENT') throw new EvidenceSufficiencyError('EVIDENCE_CONTRACT_REQUIRED', 'SB-201 coverage and Scenario evidence contracts are required.');
  const shared = scenarioRequirement.shared_requirement;
  const shape = coverageContract.minimum_campaign_shape;
  const requirements = {
    required_tasks: shared.minimum_tasks,
    required_repeats: shared.runs_per_task_per_candidate,
    planned_observations: shared.minimum_provider_model_observations,
    minimum_successful_observations: shared.minimum_successful_results_per_candidate,
    minimum_coverage: shared.minimum_coverage,
    minimum_evidence_count: shared.minimum_evidence_count,
    minimum_confidence: shared.minimum_confidence,
    maximum_partial: shared.maximum_partial_results,
    maximum_failed: shared.maximum_failed_results,
    maximum_combined_non_success: shared.maximum_combined_partial_or_failed,
  };
  if (requirements.required_tasks !== shape.distinct_tasks_per_scenario || requirements.required_repeats !== shape.runs_per_task_per_candidate || requirements.planned_observations !== shape.requests_per_candidate_per_scenario) throw new EvidenceSufficiencyError('EVIDENCE_CONTRACT_CONFLICT', 'SB-201 contracts disagree on the minimum Campaign shape.');
  return Object.freeze(requirements);
}

export function evaluateEvidenceSufficiency({ observations, requirements }) {
  assertNoSensitiveData(observations, 'Campaign evidence observations');
  if (!Array.isArray(observations) || observations.length === 0 || !requirements) throw new EvidenceSufficiencyError('EVIDENCE_INPUT_INVALID', 'Observations and derived requirements are required.');
  const results = [];
  for (const [key, slots] of groupBy(observations, (slot) => `${slot.candidate_id}|${slot.scenario_id}`)) {
    const [candidateId, scenarioId] = key.split('|');
    const successful = slots.filter((slot) => slot.status === 'SUCCEEDED');
    const failed = slots.filter((slot) => slot.status === 'FAILED');
    const partial = slots.filter((slot) => slot.status === 'PARTIAL');
    const scoredTasks = new Set(successful.filter((slot) => slot.score_status === 'SCORED').map((slot) => slot.benchmark_task_id));
    const taskRepeats = groupBy(slots, (slot) => slot.benchmark_task_id);
    const repeatComplete = [...taskRepeats.values()].filter((taskSlots) => new Set(taskSlots.map((slot) => slot.repeat_index)).size >= requirements.required_repeats).length;
    const coverage = scoredTasks.size / requirements.required_tasks;
    const combinedNonSuccess = failed.length + partial.length;
    const mathematical = slots.length === requirements.planned_observations
      && successful.length >= requirements.minimum_successful_observations
      && scoredTasks.size >= requirements.minimum_evidence_count
      && coverage >= requirements.minimum_coverage
      && repeatComplete >= requirements.required_tasks
      && failed.length <= requirements.maximum_failed
      && partial.length <= requirements.maximum_partial
      && combinedNonSuccess <= requirements.maximum_combined_non_success;
    const fixtureOnly = slots.every((slot) => slot.source_class === 'TEST_FIXTURE');
    const reasons = [];
    if (slots.length !== requirements.planned_observations) reasons.push('PLANNED_OBSERVATION_COUNT_INCOMPLETE');
    if (successful.length < requirements.minimum_successful_observations) reasons.push('SUCCESS_THRESHOLD_NOT_MET');
    if (coverage < requirements.minimum_coverage) reasons.push('TASK_SCORE_COVERAGE_INCOMPLETE');
    if (scoredTasks.size < requirements.minimum_evidence_count) reasons.push('EVIDENCE_COUNT_INSUFFICIENT');
    if (combinedNonSuccess > requirements.maximum_combined_non_success) reasons.push('NON_SUCCESS_LIMIT_EXCEEDED');
    if (fixtureOnly) reasons.push('TEST_FIXTURE_NOT_OFFICIAL_EVIDENCE');
    results.push({ candidate_id: candidateId, scenario_id: scenarioId, required_tasks: requirements.required_tasks, required_repeats: requirements.required_repeats, planned_observations: slots.length, successful_observations: successful.length, failed_observations: failed.length, partial_observations: partial.length, successful_task_coverage: scoredTasks.size, evidence_count: scoredTasks.size, coverage, repeat_task_coverage: repeatComplete, confidence: mathematical ? 'HIGH' : 'INSUFFICIENT_EVIDENCE', mathematically_sufficient: mathematical, officially_eligible: mathematical && !fixtureOnly, evidence_readiness: mathematical ? 'FIXTURE_GATE_SATISFIED_TEST_ONLY' : 'INSUFFICIENT_EVIDENCE', reasons, source_class: fixtureOnly ? 'TEST_FIXTURE' : 'MIXED', real_recommendation_ready: false, real_model_ranking_ready: false });
  }
  return results.sort((a, b) => `${a.candidate_id}|${a.scenario_id}`.localeCompare(`${b.candidate_id}|${b.scenario_id}`));
}
