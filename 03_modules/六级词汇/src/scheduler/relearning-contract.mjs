import { deepFreeze, requireInteger } from '../domain/shared.mjs';
import { ReviewRating, validateReviewRating } from './rating-contract.mjs';

export const RELEARNING_CONTRACT_VERSION = '0.1';
export const MILLISECONDS_PER_MINUTE = 60_000;
export const DEFAULT_RELEARNING_STEPS_MS = Object.freeze([
  MILLISECONDS_PER_MINUTE,
  10 * MILLISECONDS_PER_MINUTE,
]);

export function createRelearningPolicy({ stepsMs = DEFAULT_RELEARNING_STEPS_MS } = {}) {
  if (!Array.isArray(stepsMs) || stepsMs.length === 0) throw new TypeError('stepsMs must be a non-empty array');
  const canonicalSteps = stepsMs.map((step, index) => requireInteger(step, `stepsMs[${index}]`, { min: 1 }));
  return deepFreeze({
    policyVersion: RELEARNING_CONTRACT_VERSION,
    stepsMs: canonicalSteps,
    getStep(index) {
      return canonicalSteps[requireInteger(index, 'index', { min: 0, max: canonicalSteps.length - 1 })];
    },
    getNextDueAt({ rating, now, stepIndex = 0 }) {
      if (validateReviewRating(rating) !== ReviewRating.AGAIN) return null;
      const parsed = new Date(now);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== now) throw new TypeError('now must be canonical UTC ISO');
      const step = canonicalSteps[requireInteger(stepIndex, 'stepIndex', { min: 0, max: canonicalSteps.length - 1 })];
      return new Date(parsed.getTime() + step).toISOString();
    },
  });
}
