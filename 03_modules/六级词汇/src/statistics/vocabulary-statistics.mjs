import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { LearningStage } from '../domain/learner-progress.mjs';
import { assertLearningProgressStore } from '../learning/learning-progress-store.mjs';
import { assertReviewRecordStore } from '../learning/review-record-store.mjs';

export const VOCABULARY_STATISTICS_VERSION = '0.1';
export const LEARNING_STATISTICS_VERSION = '0.1';

export function getVocabularyStatistics(store) {
  assertVocabularyStore(store);
  return Object.freeze({
    statisticsVersion: VOCABULARY_STATISTICS_VERSION,
    totalWords: store.count(),
    favoriteCount: 0,
    unknownCount: 0,
    masteredCount: 0,
    userStateAvailable: false,
  });
}

function requireDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('day must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError('day must be a valid calendar date');
  }
  return value;
}

function isOnDay(value, day) {
  return typeof value === 'string' && value.slice(0, 10) === day;
}

export function getLearningStatistics(vocabularyStore, { progressStore, reviewRecordStore, day }) {
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  assertReviewRecordStore(reviewRecordStore);
  const canonicalDay = requireDay(day);
  const base = getVocabularyStatistics(vocabularyStore);
  const states = progressStore.listStates();
  const masteredCount = states.filter((state) => state.progress.stage === LearningStage.MASTERED).length;
  const favoriteCount = states.filter((state) => state.favorite).length;
  const unknownCount = states.filter((state) => state.unknown).length;
  const dailyLearnedCount = states.filter((state) => isOnDay(state.learningStartedAt, canonicalDay)).length;
  const dailyReviewCount = reviewRecordStore.list()
    .filter((record) => isOnDay(record.reviewedAt, canonicalDay)).length;
  const completionRate = base.totalWords === 0
    ? 0
    : Math.round((masteredCount / base.totalWords) * 10_000) / 100;
  return Object.freeze({
    statisticsVersion: LEARNING_STATISTICS_VERSION,
    totalWords: base.totalWords,
    dailyLearnedCount,
    dailyReviewCount,
    masteredCount,
    favoriteCount,
    unknownCount,
    completionRate,
    userStateAvailable: true,
  });
}
