import { assertNoSensitiveData } from '../credential-provider.mjs';
import { ScoringContractError } from '../scoring/score-contracts.mjs';

function round(value) { return value === null ? null : Number(value.toFixed(12)); }

export function determineConfidence({ coverage, evidenceCount, profileStatus, requiredComplete }) {
  if (profileStatus === 'INSUFFICIENT_EVIDENCE') return 'INSUFFICIENT_EVIDENCE';
  if (coverage >= 0.9 && evidenceCount >= 3 && requiredComplete) return 'HIGH';
  if (coverage >= 0.7 && evidenceCount >= 2 && requiredComplete) return 'MEDIUM';
  return 'LOW';
}

export function aggregateScenarioEvidence({ resolvedScenario, evidence }) {
  assertNoSensitiveData({ resolvedScenario, evidence }, 'Scenario aggregation input');
  if (!resolvedScenario || !Array.isArray(resolvedScenario.task_mappings) || !Array.isArray(evidence)) throw new ScoringContractError('PROFILE_AGGREGATION_INPUT_INVALID', 'Resolved Scenario and evidence array are required.');
  const evidenceByTask = new Map();
  for (const item of evidence) {
    const taskScore = item?.task_score;
    if (taskScore?.record_type === 'LEGACY_SUMMARY') throw new ScoringContractError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter Capability Profile aggregation.');
    if (!taskScore || taskScore.record_type !== 'TASK_SCORE') throw new ScoringContractError('PROFILE_EVIDENCE_INVALID', 'Evidence must contain Task Score records.');
    if (evidenceByTask.has(taskScore.benchmark_task_id)) throw new ScoringContractError('PROFILE_EVIDENCE_DUPLICATE', 'Only one Task Score per mapped task is allowed.');
    evidenceByTask.set(taskScore.benchmark_task_id, item);
  }
  const mappedIds = new Set(resolvedScenario.task_mappings.map((mapping) => mapping.benchmark_task_id));
  for (const taskId of evidenceByTask.keys()) if (!mappedIds.has(taskId)) throw new ScoringContractError('PROFILE_EVIDENCE_UNMAPPED', `Evidence task ${taskId} is not mapped by the Scenario.`);
  const totalWeight = resolvedScenario.task_mappings.reduce((sum, mapping) => sum + mapping.weight, 0);
  const includedTasks = [];
  const excludedTasks = [];
  let weightedScore = 0;
  let includedWeight = 0;
  let weightedCoverage = 0;
  let validMetricCount = 0;
  let totalMetricCount = 0;
  const metricIds = new Set();
  for (const mapping of resolvedScenario.task_mappings) {
    const item = evidenceByTask.get(mapping.benchmark_task_id);
    if (!item || item.task_score.task_score === null) {
      excludedTasks.push({ benchmark_task_id: mapping.benchmark_task_id, required: mapping.required, weight: mapping.weight, reason: item ? item.task_score.status : 'MISSING_EVIDENCE' });
      continue;
    }
    const score = item.task_score;
    if (typeof score.task_score !== 'number' || score.task_score < 0 || score.task_score > 1 || typeof score.weight_coverage !== 'number' || score.weight_coverage < 0 || score.weight_coverage > 1) throw new ScoringContractError('PROFILE_TASK_SCORE_INVALID', 'Task Score values must be within [0,1].');
    weightedScore += mapping.weight * score.task_score;
    includedWeight += mapping.weight;
    weightedCoverage += mapping.weight * score.weight_coverage;
    const metrics = Array.isArray(item.metric_scores) ? item.metric_scores : [];
    totalMetricCount += metrics.length;
    validMetricCount += metrics.filter((metric) => metric.status === 'SCORED').length;
    for (const metric of metrics) metricIds.add(metric.metric_id);
    includedTasks.push({ benchmark_task_id: mapping.benchmark_task_id, task_score_id: score.task_score_id, evaluation_id: score.evaluation_id, task_score: score.task_score, task_coverage: score.weight_coverage, weight: mapping.weight, required: mapping.required, mapping_source: mapping.mapping_source });
  }
  const capabilityScore = includedWeight === 0 ? null : weightedScore / includedWeight;
  const coverage = totalWeight === 0 ? 0 : weightedCoverage / totalWeight;
  const evidenceCount = includedTasks.length;
  const requiredComplete = !excludedTasks.some((task) => task.required);
  let profileStatus = 'COMPLETE';
  if (!requiredComplete || evidenceCount < resolvedScenario.definition.minimum_evidence || coverage < resolvedScenario.definition.minimum_coverage) profileStatus = 'INSUFFICIENT_EVIDENCE';
  else if (coverage < 1 || excludedTasks.length > 0) profileStatus = 'PARTIAL';
  const confidenceState = determineConfidence({ coverage, evidenceCount, profileStatus, requiredComplete });
  return {
    capability_score: round(capabilityScore),
    coverage: round(coverage),
    evidence_count: evidenceCount,
    included_tasks: includedTasks,
    excluded_tasks: excludedTasks,
    metric_summary: { valid_metric_count: validMetricCount, total_metric_count: totalMetricCount, metric_ids: [...metricIds].sort() },
    profile_status: profileStatus,
    confidence_state: confidenceState,
    required_complete: requiredComplete,
  };
}
