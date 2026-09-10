import {
  deepFreeze,
  requireCanonicalIsoDateTime,
  requireInteger,
  requirePlainObject,
} from '../domain/shared.mjs';
import { LearningStage } from '../domain/learner-progress.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { assertLearningProgressStore } from './learning-progress-store.mjs';
import { assertReviewScheduler } from './review-scheduler.mjs';

export const TODAY_QUEUE_VERSION = '0.1';
export const DEFAULT_TODAY_QUEUE_CONFIG = Object.freeze({
  dailyLimit: 20,
  newWordLimit: 10,
  reviewLimit: 10,
});

// Public Study Plans remain capped at 1,000. This larger ceiling is only the
// technical candidate-scan capacity used by an upper queue before daily limits are reapplied.
const MAX_INTERNAL_CANDIDATE_SCAN_LIMIT = 100_000;

export const QueueType = Object.freeze({
  REVIEW: 'review',
  LEARNING: 'learning',
  NEW: 'new',
});

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeConfig(config = {}) {
  requirePlainObject(config, 'config');
  return Object.freeze({
    dailyLimit: requireInteger(config.dailyLimit ?? DEFAULT_TODAY_QUEUE_CONFIG.dailyLimit, 'config.dailyLimit', {
      min: 1,
      max: MAX_INTERNAL_CANDIDATE_SCAN_LIMIT,
    }),
    newWordLimit: requireInteger(
      config.newWordLimit ?? DEFAULT_TODAY_QUEUE_CONFIG.newWordLimit,
      'config.newWordLimit',
      { min: 0, max: MAX_INTERNAL_CANDIDATE_SCAN_LIMIT },
    ),
    reviewLimit: requireInteger(
      config.reviewLimit ?? DEFAULT_TODAY_QUEUE_CONFIG.reviewLimit,
      'config.reviewLimit',
      { min: 0, max: MAX_INTERNAL_CANDIDATE_SCAN_LIMIT },
    ),
  });
}

function createQueueWord(entry, queueType, state) {
  const progress = state?.progress ?? null;
  return deepFreeze({
    entryId: entry.entryId,
    headword: entry.headword,
    normalizedHeadword: entry.normalizedHeadword,
    partOfSpeech: entry.senses[0].partOfSpeech,
    primaryDefinition: entry.senses[0].definitionZh,
    queueType,
    stage: progress?.stage ?? LearningStage.NEW,
    favorite: state?.favorite ?? false,
    unknown: state?.unknown ?? false,
    nextReviewAt: progress?.nextReviewAt ?? null,
  });
}

export function assertTodayQueueBuilder(builder) {
  if (builder === null || typeof builder !== 'object' || typeof builder.build !== 'function') {
    throw new TypeError('TodayQueueBuilder with build() required');
  }
  return builder;
}

export function createTodayQueueBuilder({ vocabularyStore, progressStore, reviewScheduler }) {
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  assertReviewScheduler(reviewScheduler);

  function build({ now, config = {} }) {
    const canonicalNow = requireCanonicalIsoDateTime(now, 'now');
    const limits = normalizeConfig(config);
    const allProgress = progressStore.list();
    const due = reviewScheduler.getReviewCandidates(allProgress, { now: canonicalNow });
    const dueReview = due.filter((progress) => progress.stage === LearningStage.REVIEWING);
    const dueLearning = due.filter((progress) => progress.stage === LearningStage.LEARNING);
    const entries = vocabularyStore.list();
    const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
    const selected = [];
    const selectedIds = new Set();

    function appendProgress(progress, queueType) {
      if (selected.length >= limits.dailyLimit || selectedIds.has(progress.entryId)) return;
      const entry = entryById.get(progress.entryId);
      if (!entry) return;
      selected.push(createQueueWord(entry, queueType, progressStore.getState(progress.entryId)));
      selectedIds.add(progress.entryId);
    }

    dueReview.slice(0, limits.reviewLimit).forEach((progress) => appendProgress(progress, QueueType.REVIEW));
    dueLearning.forEach((progress) => appendProgress(progress, QueueType.LEARNING));

    const newEntries = entries
      .filter((entry) => {
        const progress = progressStore.get(entry.entryId);
        return progress === null || progress.stage === LearningStage.NEW;
      })
      .sort((left, right) => (
        compareText(left.normalizedHeadword, right.normalizedHeadword)
        || compareText(left.entryId, right.entryId)
      ));
    let appendedNew = 0;
    for (const entry of newEntries) {
      if (selected.length >= limits.dailyLimit || appendedNew >= limits.newWordLimit) break;
      if (selectedIds.has(entry.entryId)) continue;
      selected.push(createQueueWord(entry, QueueType.NEW, progressStore.getState(entry.entryId)));
      selectedIds.add(entry.entryId);
      appendedNew += 1;
    }

    const newCount = selected.filter((item) => item.queueType === QueueType.NEW).length;
    const learningCount = selected.filter((item) => item.queueType === QueueType.LEARNING).length;
    const reviewCount = selected.filter((item) => item.queueType === QueueType.REVIEW).length;
    return deepFreeze({
      queueVersion: TODAY_QUEUE_VERSION,
      generatedAt: canonicalNow,
      config: limits,
      todayWords: selected,
      newCount,
      learningCount,
      reviewCount,
      totalCount: selected.length,
    });
  }

  return assertTodayQueueBuilder(Object.freeze({ queueVersion: TODAY_QUEUE_VERSION, build }));
}
