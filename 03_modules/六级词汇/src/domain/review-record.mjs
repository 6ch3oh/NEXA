import {
  CET6_CONTRACT_VERSION,
  assertVersion,
  deepFreeze,
  fail,
  normalizeIdentifier,
  requireCanonicalIsoDateTime,
  requireCanonicalValue,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireInteger,
  requireRequiredKeys,
} from './shared.mjs';

export const ReviewMode = Object.freeze({
  MEANING_RECALL: 'meaning_recall',
  WORD_RECALL: 'word_recall',
  SPELLING: 'spelling',
  LISTENING: 'listening',
  CONTEXT: 'context',
});

export const ReviewResult = Object.freeze({
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  SKIPPED: 'skipped',
});

const REVIEW_KEYS = [
  'schemaVersion', 'reviewId', 'learnerId', 'entryId', 'mode', 'result', 'score',
  'durationMs', 'reviewedAt',
];

export function validateReviewRecord(value) {
  requireExactKeys(value, REVIEW_KEYS, 'review');
  requireRequiredKeys(value, REVIEW_KEYS, 'review');
  assertVersion(value.schemaVersion, 'review.schemaVersion');
  requireCanonicalValue(value.reviewId, normalizeIdentifier(value.reviewId, 'review.reviewId'), 'review.reviewId');
  requireCanonicalValue(
    value.learnerId,
    normalizeIdentifier(value.learnerId, 'review.learnerId'),
    'review.learnerId',
  );
  requireCanonicalValue(value.entryId, normalizeIdentifier(value.entryId, 'review.entryId'), 'review.entryId');
  requireEnum(value.mode, ReviewMode, 'review.mode');
  requireEnum(value.result, ReviewResult, 'review.result');
  requireFiniteNumber(value.score, 'review.score', { min: 0, max: 1 });
  requireInteger(value.durationMs, 'review.durationMs', { min: 0, max: 86_400_000 });
  requireCanonicalIsoDateTime(value.reviewedAt, 'review.reviewedAt');
  if (value.result === ReviewResult.SKIPPED && value.score !== 0) {
    fail('INVALID_REVIEW_SCORE', 'review.score', 'skipped review must have score 0');
  }
  if (value.result === ReviewResult.CORRECT && value.score === 0) {
    fail('INVALID_REVIEW_SCORE', 'review.score', 'correct review must have a positive score');
  }
  if (value.result === ReviewResult.INCORRECT && value.score === 1) {
    fail('INVALID_REVIEW_SCORE', 'review.score', 'incorrect review cannot have a perfect score');
  }
  return value;
}

export function createReviewRecord(input) {
  requireExactKeys(input, REVIEW_KEYS, 'input');
  if (input.schemaVersion !== undefined) assertVersion(input.schemaVersion, 'input.schemaVersion');
  const review = {
    schemaVersion: CET6_CONTRACT_VERSION,
    reviewId: normalizeIdentifier(input.reviewId, 'input.reviewId'),
    learnerId: normalizeIdentifier(input.learnerId, 'input.learnerId'),
    entryId: normalizeIdentifier(input.entryId, 'input.entryId'),
    mode: requireEnum(input.mode, ReviewMode, 'input.mode'),
    result: requireEnum(input.result, ReviewResult, 'input.result'),
    score: requireFiniteNumber(input.score, 'input.score', { min: 0, max: 1 }),
    durationMs: requireInteger(input.durationMs, 'input.durationMs', { min: 0, max: 86_400_000 }),
    reviewedAt: requireCanonicalIsoDateTime(input.reviewedAt, 'input.reviewedAt'),
  };
  validateReviewRecord(review);
  return deepFreeze(review);
}
