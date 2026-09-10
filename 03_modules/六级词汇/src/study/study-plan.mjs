import { deepFreeze, requireInteger, requirePlainObject } from '../domain/shared.mjs';
import { canonicalStudyIdentifier } from './study-shared.mjs';

export const STUDY_PLAN_VERSION = '0.1';
export const DEFAULT_STUDY_PLAN_LIMITS = Object.freeze({
  dailyNewLimit: 10,
  dailyReviewLimit: 10,
  dailyTotalLimit: 20,
});

export function createCollectionStudyPlan(input) {
  requirePlainObject(input, 'studyPlan');
  const plan = deepFreeze({
    planVersion: STUDY_PLAN_VERSION,
    collectionId: canonicalStudyIdentifier(input.collectionId, 'studyPlan.collectionId'),
    dailyNewLimit: requireInteger(input.dailyNewLimit ?? DEFAULT_STUDY_PLAN_LIMITS.dailyNewLimit, 'studyPlan.dailyNewLimit', { min: 0, max: 1_000 }),
    dailyReviewLimit: requireInteger(input.dailyReviewLimit ?? DEFAULT_STUDY_PLAN_LIMITS.dailyReviewLimit, 'studyPlan.dailyReviewLimit', { min: 0, max: 1_000 }),
    dailyTotalLimit: requireInteger(input.dailyTotalLimit ?? DEFAULT_STUDY_PLAN_LIMITS.dailyTotalLimit, 'studyPlan.dailyTotalLimit', { min: 1, max: 1_000 }),
  });
  return plan;
}

export function toLegacyTodayQueueConfig(studyPlan) {
  return Object.freeze({
    dailyLimit: studyPlan.dailyTotalLimit,
    newWordLimit: studyPlan.dailyNewLimit,
    reviewLimit: studyPlan.dailyReviewLimit,
  });
}
