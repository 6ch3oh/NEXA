import { deepFreeze, requirePlainObject } from '../domain/shared.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { getLearningStatistics } from '../statistics/vocabulary-statistics.mjs';
import { assertLearningProgressStore } from '../learning/learning-progress-store.mjs';
import { assertReviewRecordStore } from '../learning/review-record-store.mjs';
import { assertTodayQueueBuilder } from '../learning/today-queue.mjs';

export const TODAY_VOCABULARY_VIEW_MODEL_VERSION = '0.1';

const EMPTY_SUMMARY = Object.freeze({
  loaded: false,
  totalCount: 0,
  newCount: 0,
  learningCount: 0,
  reviewCount: 0,
  masteredCount: 0,
  completionRate: 0,
});

export function createTodayVocabularyViewModel({
  vocabularyStore,
  progressStore,
  reviewRecordStore,
  queueBuilder,
}) {
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  assertReviewRecordStore(reviewRecordStore);
  assertTodayQueueBuilder(queueBuilder);
  let current = null;

  function loadToday(options) {
    requirePlainObject(options, 'options');
    const queue = queueBuilder.build({ now: options.now, config: options.config ?? {} });
    const day = options.day ?? options.now.slice(0, 10);
    const statistics = getLearningStatistics(vocabularyStore, {
      progressStore,
      reviewRecordStore,
      day,
    });
    current = deepFreeze({
      viewModelVersion: TODAY_VOCABULARY_VIEW_MODEL_VERSION,
      words: queue.todayWords,
      totalCount: queue.totalCount,
      newCount: queue.newCount,
      learningCount: queue.learningCount,
      reviewCount: queue.reviewCount,
      masteredCount: statistics.masteredCount,
      completionRate: statistics.completionRate,
    });
    return current;
  }

  function getSummary() {
    if (current === null) return EMPTY_SUMMARY;
    return Object.freeze({
      loaded: true,
      totalCount: current.totalCount,
      newCount: current.newCount,
      learningCount: current.learningCount,
      reviewCount: current.reviewCount,
      masteredCount: current.masteredCount,
      completionRate: current.completionRate,
    });
  }

  return Object.freeze({
    viewModelVersion: TODAY_VOCABULARY_VIEW_MODEL_VERSION,
    loadToday,
    getSummary,
  });
}
