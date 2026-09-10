import { assertNoSensitiveData } from '../credential-provider.mjs';
import { ScoringContractError } from './score-contracts.mjs';

const transforms = new Set(['trim', 'lowercase', 'uppercase', 'newline_lf']);

function applyTransforms(value, normalization) {
  if (typeof value !== 'string') {
    if (normalization.length > 0) throw new ScoringContractError('EXACT_MATCH_TYPE_INVALID', 'String normalization requires string values.');
    return value;
  }
  let result = value;
  for (const transform of normalization) {
    if (!transforms.has(transform)) throw new ScoringContractError('EXACT_MATCH_NORMALIZATION_INVALID', `Unsupported explicit normalization: ${transform}.`);
    if (transform === 'trim') result = result.trim();
    if (transform === 'lowercase') result = result.toLocaleLowerCase('en-US');
    if (transform === 'uppercase') result = result.toLocaleUpperCase('en-US');
    if (transform === 'newline_lf') result = result.replace(/\r\n?/gu, '\n');
  }
  return result;
}

export function scoreExactMatch({ actual, expected, normalization = [] }) {
  assertNoSensitiveData({ actual, expected }, 'Exact Match input');
  if (!Array.isArray(normalization) || !normalization.every((item) => typeof item === 'string') || new Set(normalization).size !== normalization.length) {
    throw new ScoringContractError('EXACT_MATCH_NORMALIZATION_INVALID', 'Normalization must be a unique string array.');
  }
  const matched = Object.is(applyTransforms(actual, normalization), applyTransforms(expected, normalization));
  return {
    raw_value: matched,
    normalized_score: matched ? 1 : 0,
    provenance: { normalization: [...normalization], comparison: 'strict_after_explicit_normalization' },
  };
}
