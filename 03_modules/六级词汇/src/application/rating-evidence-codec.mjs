import { ReviewResult } from '../domain/review-record.mjs';
import { ReviewRating, validateReviewRating } from '../scheduler/rating-contract.mjs';

export const RATING_EVIDENCE_CODEC_VERSION = '0.1';

const EVIDENCE_BY_RATING = Object.freeze({
  [ReviewRating.AGAIN]: Object.freeze({ result: ReviewResult.INCORRECT, score: 0 }),
  [ReviewRating.HARD]: Object.freeze({ result: ReviewResult.SKIPPED, score: 0 }),
  [ReviewRating.GOOD]: Object.freeze({ result: ReviewResult.CORRECT, score: 0.75 }),
  [ReviewRating.EASY]: Object.freeze({ result: ReviewResult.CORRECT, score: 1 }),
});

export function encodeRatingEvidence(rating) {
  return EVIDENCE_BY_RATING[validateReviewRating(rating)];
}

export function createRatingEvidenceReviewId(rating, baseId) {
  const canonicalRating = validateReviewRating(rating);
  if (typeof baseId !== 'string' || baseId.trim() === '') throw new TypeError('baseId required');
  return `rating:${canonicalRating}:${baseId}`;
}

export function decodeRatingEvidence(reviewRecord) {
  if (!reviewRecord || typeof reviewRecord.reviewId !== 'string') return null;
  const rating = Object.values(ReviewRating).find((candidate) => reviewRecord.reviewId.startsWith(`rating:${candidate}:`));
  if (!rating) return null;
  const expected = EVIDENCE_BY_RATING[rating];
  if (reviewRecord.result === expected.result && reviewRecord.score === expected.score) return rating;
  return null;
}
