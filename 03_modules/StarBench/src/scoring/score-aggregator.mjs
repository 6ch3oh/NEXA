import { assertNoSensitiveData } from '../credential-provider.mjs';
import { ScoringContractError, stableSha256 } from './score-contracts.mjs';

function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function round(value) { return value === null ? null : Number(value.toFixed(12)); }

export function aggregateTaskScores({ metricScores, timestamp = new Date().toISOString() }) {
  assertNoSensitiveData(metricScores, 'Task score inputs');
  if (!Array.isArray(metricScores) || metricScores.length === 0) throw new ScoringContractError('TASK_METRIC_SCORES_REQUIRED', 'Task aggregation requires metric scores.');
  const first = metricScores[0];
  if (!metricScores.every((score) => score.evaluation_id === first.evaluation_id && score.benchmark_task_id === first.benchmark_task_id && positive(score.weight))) throw new ScoringContractError('TASK_METRIC_SCORES_INCONSISTENT', 'Metric scores must belong to one task evaluation with positive weights.');
  const totalWeight = metricScores.reduce((sum, score) => sum + score.weight, 0);
  const included = metricScores.filter((score) => score.status === 'SCORED');
  const includedWeight = included.reduce((sum, score) => sum + score.weight, 0);
  const excluded = metricScores.filter((score) => score.status !== 'SCORED');
  const taskScore = includedWeight === 0 ? null : included.reduce((sum, score) => sum + score.normalized_score * score.weight, 0) / includedWeight;
  const weightCoverage = includedWeight / totalWeight;
  const requiredMissing = excluded.some((score) => score.metadata.required === true);
  const manualRequired = excluded.some((score) => score.status === 'MANUAL_REQUIRED' && score.metadata.required === true);
  let status = 'SCORED';
  if (included.length === 0) status = manualRequired ? 'MANUAL_REQUIRED' : 'UNSCORED';
  else if (weightCoverage < 1 || requiredMissing) status = 'PARTIAL';
  const result = {
    schema_version: '0.1',
    record_type: 'TASK_SCORE',
    task_score_id: `taskscore_${stableSha256({ evaluation_id: first.evaluation_id, metric_score_ids: metricScores.map((score) => score.score_id).sort() })}`,
    evaluation_id: first.evaluation_id,
    run_id: first.run_id,
    benchmark_task_id: first.benchmark_task_id,
    suite_id: first.suite_id,
    task_score: round(taskScore),
    included_metrics: included.map((score) => score.metric_id),
    excluded_metrics: excluded.map((score) => ({ metric_id: score.metric_id, status: score.status, required: score.metadata.required === true })),
    weight_coverage: round(weightCoverage),
    status,
    provenance: { method: 'weighted_mean_of_scored_metrics', total_weight: totalWeight, included_weight: includedWeight },
    timestamp,
    source_class: first.source_class,
    metadata: { fixture_only: first.source_class === 'TEST_FIXTURE' },
  };
  assertNoSensitiveData(result, 'Task Score');
  return result;
}

export function aggregateSuiteScores({ suiteIdentity, taskScores, taskWeights, timestamp = new Date().toISOString() }) {
  assertNoSensitiveData({ suiteIdentity, taskScores, taskWeights }, 'Suite score inputs');
  if (!suiteIdentity || typeof suiteIdentity.suite_id !== 'string' || !Array.isArray(taskScores) || taskScores.length === 0 || !taskWeights || typeof taskWeights !== 'object') throw new ScoringContractError('SUITE_SCORE_INPUT_INVALID', 'Suite identity, task scores, and explicit task weights are required.');
  const weightedTasks = taskScores.map((taskScore) => {
    const weight = taskWeights[taskScore.benchmark_task_id];
    if (!positive(weight)) throw new ScoringContractError('SUITE_TASK_WEIGHT_INVALID', `Missing positive weight for ${taskScore.benchmark_task_id}.`);
    return { taskScore, weight };
  });
  const totalWeight = weightedTasks.reduce((sum, item) => sum + item.weight, 0);
  const included = weightedTasks.filter((item) => item.taskScore.task_score !== null);
  const scoreWeight = included.reduce((sum, item) => sum + item.weight, 0);
  const suiteScore = scoreWeight === 0 ? null : included.reduce((sum, item) => sum + item.taskScore.task_score * item.weight, 0) / scoreWeight;
  const effectiveCoverage = weightedTasks.reduce((sum, item) => sum + item.weight * item.taskScore.weight_coverage, 0) / totalWeight;
  const sourceSet = new Set(taskScores.map((score) => score.source_class));
  let status = 'SCORED';
  if (included.length === 0) status = taskScores.some((score) => score.status === 'MANUAL_REQUIRED') ? 'MANUAL_REQUIRED' : 'UNSCORED';
  else if (effectiveCoverage < 1 || taskScores.some((score) => score.status !== 'SCORED')) status = 'PARTIAL';
  const result = {
    schema_version: '0.1',
    record_type: 'SUITE_SCORE',
    suite_score_id: `suitescore_${stableSha256({ suite_identity: suiteIdentity, task_score_ids: taskScores.map((score) => score.task_score_id).sort(), task_weights: taskWeights })}`,
    suite_identity: structuredClone(suiteIdentity),
    suite_score: round(suiteScore),
    included_tasks: included.map((item) => item.taskScore.benchmark_task_id),
    excluded_tasks: weightedTasks.filter((item) => item.taskScore.task_score === null).map((item) => ({ benchmark_task_id: item.taskScore.benchmark_task_id, status: item.taskScore.status })),
    task_coverage: round(included.length / taskScores.length),
    effective_coverage: round(effectiveCoverage),
    status,
    provenance: { method: 'weighted_mean_with_task_metric_coverage', total_task_weight: totalWeight, scored_task_weight: scoreWeight },
    timestamp,
    source_class: sourceSet.size === 1 ? taskScores[0].source_class : 'MIXED',
    metadata: { fixture_only: sourceSet.size === 1 && taskScores[0].source_class === 'TEST_FIXTURE' },
  };
  assertNoSensitiveData(result, 'Suite Score');
  return result;
}
