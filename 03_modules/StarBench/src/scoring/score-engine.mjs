import { assertNoSensitiveData, sanitizeErrorMessage } from '../credential-provider.mjs';
import { assertValidBenchmarkTask } from '../benchmark-task-loader.mjs';
import { validateCanonicalEvaluation } from '../raw-result-importer.mjs';
import { scoreExactMatch } from './exact-match-scorer.mjs';
import { scoreNumeric } from './numeric-scorer.mjs';
import { scoreRules } from './rule-based-scorer.mjs';
import { aggregateTaskScores } from './score-aggregator.mjs';
import {
  assertValidMetricDefinition,
  assertValidScoreResult,
  ScoringContractError,
  stableSha256,
} from './score-contracts.mjs';

const engineIdentity = 'starbench.offline-score-engine';
const engineVersion = '0.1';

function sourceClass(evaluation) {
  const rawSource = evaluation.raw_source_identity?.source_class;
  if (rawSource === 'TEST_FIXTURE') return 'TEST_FIXTURE';
  if (rawSource === 'PROVIDER_EXECUTION') return evaluation.metadata?.imported_real_result === true ? 'IMPORTED_REAL_RESULT' : 'RAW_RESULT';
  throw new ScoringContractError('SCORE_SOURCE_CLASS_REJECTED', 'Evaluation source class cannot enter official scoring.');
}

function suiteId(evaluation) {
  const value = evaluation.metadata?.suite_identity?.suite_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nonScored(status, rawValue = null, error = null) {
  return { status, raw_value: rawValue, normalized_score: null, error, provenance: { reason: status.toLocaleLowerCase('en-US') } };
}

export class OfflineScoreEngine {
  constructor({ clock = { now: () => new Date() } } = {}) {
    this.clock = clock;
  }

  scoreEvaluation({ evaluation, benchmarkTask, observation = null }) {
    assertNoSensitiveData({ evaluation, benchmarkTask, observation }, 'Offline scoring input');
    if (evaluation?.record_type === 'LEGACY_SUMMARY' || benchmarkTask?.record_type === 'LEGACY_SUMMARY') throw new ScoringContractError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter the scoring engine.');
    const checked = validateCanonicalEvaluation(evaluation);
    if (!checked.valid) throw new ScoringContractError('CANONICAL_EVALUATION_INVALID', 'Scoring requires a valid Canonical Evaluation.', checked.errors);
    assertValidBenchmarkTask(benchmarkTask);
    if (evaluation.benchmark_task !== benchmarkTask.benchmark_task_id || evaluation.task_identity.task_version !== benchmarkTask.version) throw new ScoringContractError('TASK_EVALUATION_MISMATCH', 'Benchmark Task identity does not match Canonical Evaluation.');
    const definitions = benchmarkTask.evaluation_method.config?.metric_definitions;
    if (!Array.isArray(definitions) || definitions.length === 0) throw new ScoringContractError('SCORING_CONFIG_INVALID', 'Task must declare metric_definitions in evaluation_method.config.');
    for (const definition of definitions) assertValidMetricDefinition(definition);
    const ids = definitions.map((definition) => definition.metric_id);
    if (new Set(ids).size !== ids.length || ids.length !== benchmarkTask.metrics.length || !benchmarkTask.metrics.every((metricId) => ids.includes(metricId))) throw new ScoringContractError('SCORING_CONFIG_INVALID', 'Task metrics and Metric Definitions must match exactly.');
    const metricScores = definitions.map((definition) => this.#scoreMetric({ evaluation, benchmarkTask, observation, definition }));
    const timestamp = this.clock.now().toISOString();
    const taskScore = aggregateTaskScores({ metricScores, timestamp });
    return { metric_scores: metricScores, task_score: taskScore };
  }

  #scoreMetric({ evaluation, benchmarkTask, observation, definition }) {
    const definitionHash = stableSha256(definition);
    const timestamp = this.clock.now().toISOString();
    let outcome;
    let observationSource = 'NONE';
    try {
      if (definition.parameters.applicable === false) outcome = nonScored('NOT_APPLICABLE');
      else if (definition.scorer === 'manual') outcome = nonScored('MANUAL_REQUIRED');
      else if (definition.scorer === 'exact_match') {
        observationSource = 'LOCAL_TEST_OBSERVATION';
        if (observation === null || observation?.output === null || observation?.output === undefined || benchmarkTask.expected_output.reference === null) outcome = nonScored('UNSCORED');
        else outcome = { status: 'SCORED', ...scoreExactMatch({ actual: observation.output, expected: benchmarkTask.expected_output.reference, normalization: definition.parameters.normalization ?? [] }), error: null };
      } else if (definition.scorer === 'rule_based') {
        observationSource = 'LOCAL_TEST_OBSERVATION';
        if (observation === null || observation?.output === null || observation?.output === undefined) outcome = nonScored('UNSCORED');
        else outcome = { status: 'SCORED', ...scoreRules({ actual: observation.output, rules: definition.parameters.rules }), error: null };
      } else if (definition.scorer === 'numeric') {
        observationSource = 'EVALUATION_FIELD';
        const field = definition.parameters.source_field;
        if (typeof field !== 'string' || !['latency_ms', 'ttft_ms', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'throughput_tokens_per_second'].includes(field)) throw new ScoringContractError('NUMERIC_SOURCE_FIELD_INVALID', 'Numeric source_field is not an allowed Canonical Evaluation field.');
        outcome = { ...scoreNumeric({ value: evaluation[field], direction: definition.direction, normalization: definition.normalization }), error: null };
      } else throw new ScoringContractError('SCORER_UNSUPPORTED', 'Unsupported scorer.');
    } catch (error) {
      if (error instanceof ScoringContractError) throw error;
      outcome = nonScored('FAILED', null, { code: 'SCORER_FAILED', safe_message: sanitizeErrorMessage(error?.message) });
    }
    const normalizedScore = outcome.normalized_score;
    const weightedScore = normalizedScore === null ? null : normalizedScore * definition.weight;
    const identityPayload = {
      evaluation_id: evaluation.evaluation_id,
      metric_definition_sha256: definitionHash,
      raw_value: outcome.raw_value,
      normalized_score: normalizedScore,
      status: outcome.status,
    };
    const result = {
      schema_version: '0.1',
      record_type: 'SCORE_RESULT',
      score_id: `score_${stableSha256(identityPayload)}`,
      evaluation_id: evaluation.evaluation_id,
      run_id: evaluation.run_id,
      benchmark_task_id: benchmarkTask.benchmark_task_id,
      suite_id: suiteId(evaluation),
      metric_id: definition.metric_id,
      raw_value: outcome.raw_value,
      normalized_score: normalizedScore,
      weight: definition.weight,
      weighted_score: weightedScore,
      scoring_method: definition.scorer,
      status: outcome.status,
      provenance: {
        engine: engineIdentity,
        engine_version: engineVersion,
        metric_definition_sha256: definitionHash,
        evaluation_id: evaluation.evaluation_id,
        raw_record_sha256: evaluation.raw_source_identity.raw_record_sha256,
        observation_source: observationSource,
        scorer_details: structuredClone(outcome.provenance ?? {}),
      },
      error: outcome.error ?? null,
      timestamp,
      source_class: sourceClass(evaluation),
      metadata: {
        required: definition.required,
        metric_type: definition.metric_type,
        direction: definition.direction,
        fixture_only: sourceClass(evaluation) === 'TEST_FIXTURE',
      },
    };
    assertValidScoreResult(result);
    return result;
  }
}
