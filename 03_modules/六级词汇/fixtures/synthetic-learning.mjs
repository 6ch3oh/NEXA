import {
  LearningStage,
  ReviewMode,
  ReviewResult,
  createLearnerProgress,
  createReviewRecord,
} from '../src/index.mjs';
import { SYNTHETIC_VOCABULARY_ENTRIES } from './synthetic-vocabulary.mjs';

export const SYNTHETIC_LEARNING_FIXTURE_MARKER = 'TEST / SYNTHETIC';
export const SYNTHETIC_LEARNER_ID = 'learner:test';
export const SYNTHETIC_LEARNING_NOW = '2026-08-10T12:00:00.000Z';

function progress(index, values) {
  return createLearnerProgress({
    learnerId: SYNTHETIC_LEARNER_ID,
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[index].entryId,
    ...values,
  });
}

export const SYNTHETIC_LEARNING_PROGRESS = Object.freeze([
  progress(0, { updatedAt: '2026-08-09T08:00:00.000Z' }),
  progress(1, {
    stage: LearningStage.LEARNING,
    masteryScore: 10,
    reviewCount: 1,
    correctCount: 0,
    incorrectCount: 0,
    streak: 0,
    lapseCount: 0,
    lastReviewedAt: '2026-08-08T08:00:00.000Z',
    nextReviewAt: '2026-08-09T08:00:00.000Z',
    updatedAt: '2026-08-08T08:00:00.000Z',
  }),
  progress(2, {
    stage: LearningStage.LEARNING,
    masteryScore: 20,
    reviewCount: 1,
    correctCount: 0,
    incorrectCount: 0,
    streak: 0,
    lapseCount: 0,
    lastReviewedAt: '2026-08-09T12:00:00.000Z',
    nextReviewAt: SYNTHETIC_LEARNING_NOW,
    updatedAt: '2026-08-09T12:00:00.000Z',
  }),
  progress(3, {
    stage: LearningStage.REVIEWING,
    masteryScore: 40,
    reviewCount: 3,
    correctCount: 2,
    incorrectCount: 1,
    streak: 0,
    lapseCount: 1,
    lastReviewedAt: '2026-08-08T10:00:00.000Z',
    nextReviewAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
  }),
  progress(4, {
    stage: LearningStage.REVIEWING,
    masteryScore: 60,
    reviewCount: 2,
    correctCount: 2,
    incorrectCount: 0,
    streak: 2,
    lapseCount: 0,
    lastReviewedAt: '2026-08-10T09:00:00.000Z',
    nextReviewAt: '2026-08-13T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
  }),
  progress(5, {
    stage: LearningStage.MASTERED,
    masteryScore: 90,
    reviewCount: 3,
    correctCount: 3,
    incorrectCount: 0,
    streak: 3,
    lapseCount: 0,
    lastReviewedAt: '2026-08-09T11:00:00.000Z',
    nextReviewAt: null,
    updatedAt: '2026-08-09T11:00:00.000Z',
  }),
  progress(6, {
    stage: LearningStage.REVIEWING,
    masteryScore: 30,
    reviewCount: 2,
    correctCount: 1,
    incorrectCount: 1,
    streak: 0,
    lapseCount: 1,
    lastReviewedAt: '2026-08-09T12:00:00.000Z',
    nextReviewAt: SYNTHETIC_LEARNING_NOW,
    updatedAt: '2026-08-09T12:00:00.000Z',
  }),
  progress(7, { updatedAt: '2026-08-09T08:00:00.000Z' }),
]);

export const SYNTHETIC_LEARNING_METADATA = Object.freeze([
  {
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[1].entryId,
    favorite: false,
    unknown: false,
    learningStartedAt: '2026-08-08T08:00:00.000Z',
  },
  {
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[2].entryId,
    favorite: false,
    unknown: false,
    learningStartedAt: '2026-08-10T08:00:00.000Z',
  },
  {
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[3].entryId,
    favorite: false,
    unknown: false,
    learningStartedAt: '2026-08-07T08:00:00.000Z',
  },
  {
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[4].entryId,
    favorite: false,
    unknown: false,
    learningStartedAt: '2026-08-07T08:00:00.000Z',
  },
  {
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[5].entryId,
    favorite: true,
    unknown: false,
    learningStartedAt: '2026-08-06T08:00:00.000Z',
  },
  {
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[6].entryId,
    favorite: true,
    unknown: true,
    learningStartedAt: '2026-08-10T07:00:00.000Z',
  },
]);

export const SYNTHETIC_REVIEW_RECORDS = Object.freeze([
  createReviewRecord({
    reviewId: 'review:test:allocation:1',
    learnerId: SYNTHETIC_LEARNER_ID,
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[3].entryId,
    mode: ReviewMode.MEANING_RECALL,
    result: ReviewResult.INCORRECT,
    score: 0.25,
    durationMs: 1_200,
    reviewedAt: '2026-08-08T10:00:00.000Z',
  }),
  createReviewRecord({
    reviewId: 'review:test:allow:1',
    learnerId: SYNTHETIC_LEARNER_ID,
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[4].entryId,
    mode: ReviewMode.SPELLING,
    result: ReviewResult.CORRECT,
    score: 1,
    durationMs: 900,
    reviewedAt: '2026-08-10T09:00:00.000Z',
  }),
  createReviewRecord({
    reviewId: 'review:test:issue:1',
    learnerId: SYNTHETIC_LEARNER_ID,
    entryId: SYNTHETIC_VOCABULARY_ENTRIES[6].entryId,
    mode: ReviewMode.CONTEXT,
    result: ReviewResult.INCORRECT,
    score: 0.4,
    durationMs: 1_500,
    reviewedAt: '2026-08-10T10:00:00.000Z',
  }),
]);
