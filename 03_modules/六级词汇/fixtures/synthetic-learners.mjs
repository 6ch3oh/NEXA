import { LearningStage, createLearnerProgress } from '../src/domain/learner-progress.mjs';
import { ReviewMode, ReviewResult, createReviewRecord } from '../src/domain/review-record.mjs';
import { createLearnerDataPartition } from '../src/learning/learner-data-partition.mjs';
import { SYNTHETIC_VOCABULARY_ENTRIES } from './synthetic-vocabulary.mjs';

export const SYNTHETIC_LEARNER_FIXTURE_MARKER = 'TEST / SYNTHETIC';
export const SYNTHETIC_LEARNER_A = 'learner:a';
export const SYNTHETIC_LEARNER_B = 'learner:b';
export const SYNTHETIC_PARTITION_NOW = '2026-08-10T12:00:00.000Z';

const [ABANDON, ABSTRACT, ALLOCATE, ALLOCATION] = SYNTHETIC_VOCABULARY_ENTRIES;

export const SYNTHETIC_LEARNER_A_PROGRESS = Object.freeze([
  createLearnerProgress({
    learnerId: SYNTHETIC_LEARNER_A,
    entryId: ABANDON.entryId,
    stage: LearningStage.MASTERED,
    masteryScore: 90,
    reviewCount: 2,
    correctCount: 2,
    incorrectCount: 0,
    streak: 2,
    lapseCount: 0,
    lastReviewedAt: '2026-08-10T08:00:00.000Z',
    nextReviewAt: null,
    updatedAt: '2026-08-10T08:00:00.000Z',
  }),
  createLearnerProgress({
    learnerId: SYNTHETIC_LEARNER_A,
    entryId: ABSTRACT.entryId,
    stage: LearningStage.REVIEWING,
    masteryScore: 40,
    reviewCount: 2,
    correctCount: 1,
    incorrectCount: 1,
    streak: 0,
    lapseCount: 1,
    lastReviewedAt: '2026-08-09T12:00:00.000Z',
    nextReviewAt: SYNTHETIC_PARTITION_NOW,
    updatedAt: '2026-08-09T12:00:00.000Z',
  }),
]);

export const SYNTHETIC_LEARNER_B_PROGRESS = Object.freeze([
  createLearnerProgress({
    learnerId: SYNTHETIC_LEARNER_B,
    entryId: ABANDON.entryId,
    updatedAt: '2026-08-10T07:00:00.000Z',
  }),
  createLearnerProgress({
    learnerId: SYNTHETIC_LEARNER_B,
    entryId: ALLOCATE.entryId,
    stage: LearningStage.LEARNING,
    masteryScore: 10,
    reviewCount: 1,
    correctCount: 0,
    incorrectCount: 0,
    streak: 0,
    lapseCount: 0,
    lastReviewedAt: '2026-08-10T11:00:00.000Z',
    nextReviewAt: '2026-08-11T11:00:00.000Z',
    updatedAt: '2026-08-10T11:00:00.000Z',
  }),
  createLearnerProgress({
    learnerId: SYNTHETIC_LEARNER_B,
    entryId: ALLOCATION.entryId,
    stage: LearningStage.REVIEWING,
    masteryScore: 30,
    reviewCount: 2,
    correctCount: 1,
    incorrectCount: 1,
    streak: 0,
    lapseCount: 1,
    lastReviewedAt: '2026-08-09T12:00:00.000Z',
    nextReviewAt: SYNTHETIC_PARTITION_NOW,
    updatedAt: '2026-08-09T12:00:00.000Z',
  }),
]);

export const SYNTHETIC_LEARNER_REVIEW_RECORDS = Object.freeze([
  createReviewRecord({
    reviewId: 'review:learner-a:abandon:1',
    learnerId: SYNTHETIC_LEARNER_A,
    entryId: ABANDON.entryId,
    mode: ReviewMode.MEANING_RECALL,
    result: ReviewResult.CORRECT,
    score: 1,
    durationMs: 800,
    reviewedAt: '2026-08-10T08:00:00.000Z',
  }),
  createReviewRecord({
    reviewId: 'review:learner-b:allocation:1',
    learnerId: SYNTHETIC_LEARNER_B,
    entryId: ALLOCATION.entryId,
    mode: ReviewMode.CONTEXT,
    result: ReviewResult.INCORRECT,
    score: 0.4,
    durationMs: 1_200,
    reviewedAt: '2026-08-09T12:00:00.000Z',
  }),
]);

export function createSyntheticLearnerPartition() {
  const partition = createLearnerDataPartition();
  SYNTHETIC_LEARNER_A_PROGRESS.forEach((progress) => partition.upsertProgress(SYNTHETIC_LEARNER_A, progress));
  SYNTHETIC_LEARNER_B_PROGRESS.forEach((progress) => partition.upsertProgress(SYNTHETIC_LEARNER_B, progress));
  partition.setFavorite(SYNTHETIC_LEARNER_A, ABANDON.entryId, true);
  partition.setUnknown(SYNTHETIC_LEARNER_A, ABSTRACT.entryId, true);
  partition.setLearningStartedAt(SYNTHETIC_LEARNER_A, ABSTRACT.entryId, '2026-08-08T12:00:00.000Z');
  partition.setUnknown(SYNTHETIC_LEARNER_B, ABANDON.entryId, true);
  partition.setLearningStartedAt(SYNTHETIC_LEARNER_B, ALLOCATE.entryId, '2026-08-10T11:00:00.000Z');
  SYNTHETIC_LEARNER_REVIEW_RECORDS.forEach((record) => partition.appendReviewRecord(record.learnerId, record));
  return partition;
}
