import { ScoringContractError } from './score-contracts.mjs';

function clamp(value) { return Math.min(1, Math.max(0, value)); }

export function scoreNumeric({ value, direction, normalization }) {
  if (value === null || value === undefined) return { status: 'UNSCORED', raw_value: null, normalized_score: null, provenance: { reason: 'unknown_numeric_value' } };
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ScoringContractError('NUMERIC_VALUE_INVALID', 'Numeric score input must be finite or null.');
  if (!['higher_is_better', 'lower_is_better'].includes(direction)) throw new ScoringContractError('NUMERIC_DIRECTION_INVALID', 'Numeric direction is invalid.');
  if (!normalization || !['identity', 'min_max'].includes(normalization.method)) throw new ScoringContractError('NUMERIC_NORMALIZATION_REQUIRED', 'Numeric metric requires bounded identity or min_max normalization.');
  let normalized;
  if (normalization.method === 'identity') normalized = value;
  else {
    if (typeof normalization.min !== 'number' || typeof normalization.max !== 'number' || !Number.isFinite(normalization.min) || !Number.isFinite(normalization.max) || normalization.max <= normalization.min) throw new ScoringContractError('NUMERIC_NORMALIZATION_INVALID', 'min_max requires finite min < max.');
    normalized = (value - normalization.min) / (normalization.max - normalization.min);
  }
  if (direction === 'lower_is_better') normalized = 1 - normalized;
  if (normalization.clamp === true) normalized = clamp(normalized);
  else if (normalized < 0 || normalized > 1) throw new ScoringContractError('NUMERIC_OUT_OF_RANGE', 'Numeric value is outside configured bounds and clamp is false.');
  return {
    status: 'SCORED',
    raw_value: value,
    normalized_score: normalized,
    provenance: { method: normalization.method, direction, min: normalization.min, max: normalization.max, clamp: normalization.clamp },
  };
}
