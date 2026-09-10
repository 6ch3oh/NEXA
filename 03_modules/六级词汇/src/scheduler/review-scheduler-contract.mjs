import { deepFreeze, requireCanonicalIsoDateTime, requirePlainObject } from '../domain/shared.mjs';
import { LearningStage } from '../domain/learner-progress.mjs';
import { ReviewResult } from '../domain/review-record.mjs';
import { ReviewRating, validateReviewRating } from './rating-contract.mjs';
import { createRelearningPolicy } from './relearning-contract.mjs';

export const GENERIC_SCHEDULER_CONTRACT_VERSION = '0.1';
export const GENERIC_SCHEDULER_METHODS = Object.freeze(['schedule', 'getDueAt', 'isDue']);

export class GenericSchedulerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GenericSchedulerError';
    this.code = code;
  }
}

export function assertGenericReviewScheduler(scheduler) {
  if (scheduler === null || typeof scheduler !== 'object') {
    throw new GenericSchedulerError('INVALID_GENERIC_SCHEDULER', 'scheduler object required');
  }
  for (const method of GENERIC_SCHEDULER_METHODS) {
    if (typeof scheduler[method] !== 'function') {
      throw new GenericSchedulerError('INVALID_GENERIC_SCHEDULER', `scheduler.${method}() is required`);
    }
  }
  return scheduler;
}

function toLegacyResult(rating) {
  if (rating === ReviewRating.GOOD || rating === ReviewRating.EASY) return ReviewResult.CORRECT;
  if (rating === ReviewRating.HARD) return ReviewResult.SKIPPED;
  return ReviewResult.INCORRECT;
}

export function createSimpleSchedulerAdapter({ legacyScheduler, relearningPolicy = createRelearningPolicy() }) {
  if (legacyScheduler === null || typeof legacyScheduler !== 'object'
    || typeof legacyScheduler.calculateNextReview !== 'function') {
    throw new GenericSchedulerError('INVALID_LEGACY_SCHEDULER', 'legacyScheduler.calculateNextReview() required');
  }

  function schedule(cardState, rating, now) {
    requirePlainObject(cardState, 'cardState');
    const canonicalRating = validateReviewRating(rating);
    const canonicalNow = requireCanonicalIsoDateTime(now, 'now');
    if (canonicalRating === ReviewRating.AGAIN) {
      return deepFreeze({
        dueAt: relearningPolicy.getNextDueAt({ rating: canonicalRating, now: canonicalNow, stepIndex: 0 }),
        rating: canonicalRating,
        phase: 'relearning',
        relearningStepIndex: 0,
      });
    }
    const stage = cardState.stage ?? LearningStage.REVIEWING;
    const dueAt = legacyScheduler.calculateNextReview({
      stage: stage === LearningStage.LEARNING ? LearningStage.LEARNING : LearningStage.REVIEWING,
      reviewedAt: canonicalNow,
      ...(stage === LearningStage.LEARNING ? {} : { result: toLegacyResult(canonicalRating) }),
    });
    return deepFreeze({ dueAt, rating: canonicalRating, phase: 'long_term', relearningStepIndex: null });
  }

  function getDueAt(cardState) {
    requirePlainObject(cardState, 'cardState');
    return cardState.dueAt ?? cardState.nextReviewAt ?? null;
  }

  function isDue(cardState, now) {
    const canonicalNow = requireCanonicalIsoDateTime(now, 'now');
    const dueAt = getDueAt(cardState);
    return dueAt !== null && dueAt <= canonicalNow;
  }

  return assertGenericReviewScheduler(Object.freeze({
    schedulerVersion: GENERIC_SCHEDULER_CONTRACT_VERSION,
    schedulerType: 'simple_scheduler_adapter',
    schedule,
    getDueAt,
    isDue,
  }));
}
