import { createHash } from 'node:crypto';

import { assertNoSensitiveData } from '../credential-provider.mjs';

const metricKeys = new Set([
  'schema_version', 'record_type', 'metric_id', 'name', 'description', 'metric_type', 'direction',
  'weight', 'range', 'normalization', 'scorer', 'parameters', 'required', 'metadata',
]);
const scoreKeys = new Set([
  'schema_version', 'record_type', 'score_id', 'evaluation_id', 'run_id', 'benchmark_task_id',
  'suite_id', 'metric_id', 'raw_value', 'normalized_score', 'weight', 'weighted_score',
  'scoring_method', 'status', 'provenance', 'error', 'timestamp', 'source_class', 'metadata',
]);
const statuses = new Set(['SCORED', 'UNSCORED', 'MANUAL_REQUIRED', 'NOT_APPLICABLE', 'INVALID', 'FAILED']);
const scorers = new Set(['exact_match', 'rule_based', 'numeric', 'manual']);
const metricTypes = new Set(['binary', 'numeric', 'categorical', 'manual']);
const directions = new Set(['higher_is_better', 'lower_is_better']);
const sourceClasses = new Set(['TEST_FIXTURE', 'RAW_RESULT', 'IMPORTED_REAL_RESULT']);
const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

export function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function normalized(value) {
  if (typeof value === 'string') return value.normalize('NFC').replace(/\r\n?/gu, '\n');
  if (Array.isArray(value)) return value.map(normalized);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
}

export function stableSha256(value) {
  assertNoSensitiveData(value, 'Scoring hash input');
  return createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
}

export class ScoringContractError extends Error {
  constructor(code, message, errors = [], cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScoringContractError';
    this.code = code;
    this.errors = errors;
  }
}

export function validateMetricDefinition(metric) {
  const errors = [];
  try { assertNoSensitiveData(metric, 'Metric Definition'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(metric)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Metric Definition must be an object.' }] };
  for (const key of Object.keys(metric)) if (!metricKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of metricKeys) if (!(key in metric)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (metric.schema_version !== '0.1' || metric.record_type !== 'METRIC_DEFINITION') errors.push({ path: '/', code: 'contract', message: 'Expected Metric Definition V0.1.' });
  if (!idPattern.test(metric.metric_id ?? '')) errors.push({ path: '/metric_id', code: 'pattern', message: 'Invalid metric_id.' });
  for (const key of ['name', 'description']) if (!nonEmptyString(metric[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!metricTypes.has(metric.metric_type)) errors.push({ path: '/metric_type', code: 'enum', message: 'Invalid metric type.' });
  if (!directions.has(metric.direction)) errors.push({ path: '/direction', code: 'enum', message: 'Invalid direction.' });
  if (!finite(metric.weight) || metric.weight <= 0) errors.push({ path: '/weight', code: 'range', message: 'Weight must be positive.' });
  if (metric.range !== null && (!plain(metric.range) || !finite(metric.range.min) || !finite(metric.range.max) || metric.range.max <= metric.range.min || Object.keys(metric.range).some((key) => !['min', 'max'].includes(key)))) errors.push({ path: '/range', code: 'range', message: 'Range must contain finite min < max or be null.' });
  const normalization = metric.normalization;
  if (!plain(normalization) || !['identity', 'min_max', 'none'].includes(normalization?.method) || !('min' in (normalization ?? {})) || !('max' in (normalization ?? {})) || typeof normalization?.clamp !== 'boolean' || Object.keys(normalization ?? {}).some((key) => !['method', 'min', 'max', 'clamp'].includes(key))) errors.push({ path: '/normalization', code: 'type', message: 'Invalid normalization contract.' });
  if (normalization?.method === 'min_max' && (!finite(normalization.min) || !finite(normalization.max) || normalization.max <= normalization.min)) errors.push({ path: '/normalization', code: 'range', message: 'min_max requires finite min < max.' });
  if (normalization?.method === 'identity' && (normalization.min !== 0 || normalization.max !== 1)) errors.push({ path: '/normalization', code: 'range', message: 'identity normalization requires [0, 1].' });
  if (normalization?.method === 'none' && (normalization.min !== null || normalization.max !== null)) errors.push({ path: '/normalization', code: 'range', message: 'none normalization requires null bounds.' });
  if (!scorers.has(metric.scorer)) errors.push({ path: '/scorer', code: 'enum', message: 'Invalid scorer.' });
  if (!plain(metric.parameters)) errors.push({ path: '/parameters', code: 'type', message: 'parameters must be an object.' });
  if (typeof metric.required !== 'boolean') errors.push({ path: '/required', code: 'type', message: 'required must be boolean.' });
  if (!plain(metric.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  if (metric.scorer === 'numeric' && metric.metric_type !== 'numeric') errors.push({ path: '/scorer', code: 'semantic', message: 'Numeric scorer requires numeric metric type.' });
  if (metric.scorer === 'manual' && metric.metric_type !== 'manual') errors.push({ path: '/scorer', code: 'semantic', message: 'Manual scorer requires manual metric type.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidMetricDefinition(metric) {
  const checked = validateMetricDefinition(metric);
  if (!checked.valid) throw new ScoringContractError('METRIC_DEFINITION_INVALID', 'Metric Definition validation failed.', checked.errors);
  return metric;
}

export function validateScoreResult(score) {
  const errors = [];
  try { assertNoSensitiveData(score, 'Score Result'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(score)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Score Result must be an object.' }] };
  for (const key of Object.keys(score)) if (!scoreKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of scoreKeys) if (!(key in score)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (score.schema_version !== '0.1' || score.record_type !== 'SCORE_RESULT') errors.push({ path: '/', code: 'contract', message: 'Expected Score Result V0.1.' });
  if (!/^score_[a-f0-9]{64}$/u.test(score.score_id ?? '')) errors.push({ path: '/score_id', code: 'pattern', message: 'Invalid score_id.' });
  if (!/^eval_[a-f0-9]{32}$/u.test(score.evaluation_id ?? '') || !/^run_[A-Za-z0-9_-]+$/u.test(score.run_id ?? '')) errors.push({ path: '/', code: 'traceability', message: 'Invalid evaluation or run identity.' });
  for (const key of ['benchmark_task_id', 'metric_id']) if (!nonEmptyString(score[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!(score.suite_id === null || nonEmptyString(score.suite_id))) errors.push({ path: '/suite_id', code: 'type', message: 'suite_id must be string or null.' });
  if (!(score.normalized_score === null || (finite(score.normalized_score) && score.normalized_score >= 0 && score.normalized_score <= 1))) errors.push({ path: '/normalized_score', code: 'range', message: 'Normalized score must be null or [0,1].' });
  if (!finite(score.weight) || score.weight <= 0) errors.push({ path: '/weight', code: 'range', message: 'Weight must be positive.' });
  if (!(score.weighted_score === null || (finite(score.weighted_score) && score.weighted_score >= 0))) errors.push({ path: '/weighted_score', code: 'range', message: 'Weighted score must be null or non-negative.' });
  if (!scorers.has(score.scoring_method) || !statuses.has(score.status)) errors.push({ path: '/', code: 'enum', message: 'Invalid scoring method or status.' });
  if (score.status === 'SCORED' && (score.normalized_score === null || score.weighted_score === null)) errors.push({ path: '/status', code: 'semantic', message: 'SCORED requires normalized and weighted scores.' });
  if (score.status !== 'SCORED' && (score.normalized_score !== null || score.weighted_score !== null)) errors.push({ path: '/status', code: 'semantic', message: 'Non-scored status requires null scores.' });
  const provenance = score.provenance;
  if (!plain(provenance) || provenance?.engine !== 'starbench.offline-score-engine' || provenance?.engine_version !== '0.1' || !/^[a-f0-9]{64}$/u.test(provenance?.metric_definition_sha256 ?? '') || provenance?.evaluation_id !== score.evaluation_id || !/^[a-f0-9]{64}$/u.test(provenance?.raw_record_sha256 ?? '') || !['EVALUATION_FIELD', 'LOCAL_TEST_OBSERVATION', 'NONE'].includes(provenance?.observation_source) || !plain(provenance?.scorer_details)) errors.push({ path: '/provenance', code: 'traceability', message: 'Invalid score provenance.' });
  if (score.error !== null && (!plain(score.error) || !nonEmptyString(score.error.code) || typeof score.error.safe_message !== 'string' || Object.keys(score.error).some((key) => !['code', 'safe_message'].includes(key)))) errors.push({ path: '/error', code: 'type', message: 'Invalid safe error.' });
  if (!nonEmptyString(score.timestamp) || Number.isNaN(Date.parse(score.timestamp))) errors.push({ path: '/timestamp', code: 'format', message: 'Invalid timestamp.' });
  if (!sourceClasses.has(score.source_class)) errors.push({ path: '/source_class', code: 'enum', message: 'Invalid source class.' });
  if (!plain(score.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  if (score.source_class === 'TEST_FIXTURE' && score.metadata?.fixture_only !== true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'TEST_FIXTURE Scores must be marked fixture_only.' });
  if (score.source_class !== 'TEST_FIXTURE' && score.metadata?.fixture_only === true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'Non-fixture Scores cannot be marked fixture_only.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidScoreResult(score) {
  const checked = validateScoreResult(score);
  if (!checked.valid) throw new ScoringContractError('SCORE_RESULT_INVALID', 'Score Result validation failed.', checked.errors);
  return score;
}
