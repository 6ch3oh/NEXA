import {
  requireArray,
  requireCanonicalIsoDateTime,
  requireEnum,
  requirePlainObject,
} from '../domain/shared.mjs';
import { LearningStage, validateLearnerProgress } from '../domain/learner-progress.mjs';
import { ReviewResult } from '../domain/review-record.mjs';

export const REVIEW_SCHEDULER_VERSION = '0.1';
export const MILLISECONDS_PER_DAY = 86_400_000;
export const LEARNING_REVIEW_INTERVAL_MS = MILLISECONDS_PER_DAY;
export const REVIEW_CORRECT_INTERVAL_MS = 3 * MILLISECONDS_PER_DAY;
export const REVIEW_INCORRECT_INTERVAL_MS = MILLISECONDS_PER_DAY;
export const REVIEW_SKIPPED_INTERVAL_MS = MILLISECONDS_PER_DAY;

export class ReviewSchedulerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewSchedulerError';
    this.code = code;
  }
}

function addInterval(isoDateTime, intervalMs) {
  return new Date(Date.parse(isoDateTime) + intervalMs).toISOString();
}

function compareDue(left, right) {
  if (left.nextReviewAt < right.nextReviewAt) return -1;
  if (left.nextReviewAt > right.nextReviewAt) return 1;
  if (left.entryId < right.entryId) return -1;
  if (left.entryId > right.entryId) return 1;
  return 0;
}

export function calculateNextReview(input) {
  requirePlainObject(input, 'schedule');
  const stage = requireEnum(input.stage, LearningStage, 'schedule.stage');
  if ([LearningStage.NEW, LearningStage.MASTERED, LearningStage.SUSPENDED].includes(stage)) return null;
  const reviewedAt = requireCanonicalIsoDateTime(input.reviewedAt, 'schedule.reviewedAt');
  if (stage === LearningStage.LEARNING) {
    return addInterval(reviewedAt, LEARNING_REVIEW_INTERVAL_MS);
  }
  if (input.result === undefined) {
    throw new ReviewSchedulerError('MISSING_REVIEW_RESULT', 'reviewing stage requires an explicit review result');
  }
  const result = requireEnum(input.result, ReviewResult, 'schedule.result');
  const interval = result === ReviewResult.CORRECT
    ? REVIEW_CORRECT_INTERVAL_MS
    : result === ReviewResult.INCORRECT
      ? REVIEW_INCORRECT_INTERVAL_MS
      : REVIEW_SKIPPED_INTERVAL_MS;
  return addInterval(reviewedAt, interval);
}

export function getReviewCandidates(progressValues, { now }) {
  requireArray(progressValues, 'progressValues');
  const canonicalNow = requireCanonicalIsoDateTime(now, 'now');
  return Object.freeze(progressValues
    .map((progress) => {
      validateLearnerProgress(progress);
      return progress;
    })
    .filter((progress) => (
      [LearningStage.LEARNING, LearningStage.REVIEWING].includes(progress.stage)
      && progress.nextReviewAt !== null
      && progress.nextReviewAt <= canonicalNow
    ))
    .sort(compareDue));
}

export function createReviewScheduler() {
  return Object.freeze({
    schedulerVersion: REVIEW_SCHEDULER_VERSION,
    calculateNextReview,
    getReviewCandidates,
  });
}

export function assertReviewScheduler(scheduler) {
  if (scheduler === null || typeof scheduler !== 'object'
    || typeof scheduler.calculateNextReview !== 'function'
    || typeof scheduler.getReviewCandidates !== 'function') {
    throw new ReviewSchedulerError('INVALID_SCHEDULER', 'review scheduler contract required');
  }
  return scheduler;
}
