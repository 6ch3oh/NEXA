import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TODAY_QUEUE_CONFIG,
  LEARNING_REVIEW_INTERVAL_MS,
  LearningProgressServiceError,
  LearningStage,
  QueueType,
  REVIEW_CORRECT_INTERVAL_MS,
  REVIEW_INCORRECT_INTERVAL_MS,
  ReviewMode,
  ReviewResult,
  ReviewRecordStoreError,
  createInMemoryLearningProgressStore,
  createInMemoryReviewRecordStore,
  createInMemoryVocabularyStore,
  createLearnerProgress,
  createLearningProgressService,
  createReviewRecord,
  createReviewScheduler,
  createTodayQueueBuilder,
  createTodayVocabularyViewModel,
  getLearningStatistics,
} from '../src/index.mjs';
import {
  SYNTHETIC_LEARNER_ID,
  SYNTHETIC_LEARNING_METADATA,
  SYNTHETIC_LEARNING_NOW,
  SYNTHETIC_LEARNING_PROGRESS,
  SYNTHETIC_REVIEW_RECORDS,
} from '../fixtures/synthetic-learning.mjs';
import { SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

const STARTED_AT = '2026-08-10T08:00:00.000Z';
const FIRST_REVIEW_AT = '2026-08-11T08:00:00.000Z';

function createHarness({ progress = [], metadata = [], records = [] } = {}) {
  const vocabularyStore = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  const progressStore = createInMemoryLearningProgressStore({ progress, metadata });
  const reviewRecordStore = createInMemoryReviewRecordStore(records);
  const reviewScheduler = createReviewScheduler();
  const progressService = createLearningProgressService({
    learnerId: SYNTHETIC_LEARNER_ID,
    vocabularyStore,
    progressStore,
    reviewRecordStore,
    reviewScheduler,
    clock: () => SYNTHETIC_LEARNING_NOW,
  });
  const queueBuilder = createTodayQueueBuilder({ vocabularyStore, progressStore, reviewScheduler });
  const viewModel = createTodayVocabularyViewModel({
    vocabularyStore,
    progressStore,
    reviewRecordStore,
    queueBuilder,
  });
  return {
    vocabularyStore,
    progressStore,
    reviewRecordStore,
    reviewScheduler,
    progressService,
    queueBuilder,
    viewModel,
  };
}

function moveToReview(harness, entryId) {
  harness.progressService.markLearning(entryId, { at: STARTED_AT });
  return harness.progressService.markReview(entryId, {
    at: FIRST_REVIEW_AT,
    reviewId: `review:test:${entryId.split(':').at(-1)}:service`,
    mode: ReviewMode.MEANING_RECALL,
    result: ReviewResult.CORRECT,
    score: 1,
    durationMs: 1_000,
  });
}

test('NEW transitions deterministically to LEARNING', () => {
  const harness = createHarness();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  const state = harness.progressService.markLearning(entryId, { at: STARTED_AT });
  assert.equal(state.progress.stage, LearningStage.LEARNING);
  assert.equal(state.progress.reviewCount, 1);
  assert.equal(state.learningStartedAt, STARTED_AT);
  assert.equal(state.progress.nextReviewAt, FIRST_REVIEW_AT);
});

test('LEARNING transitions to REVIEWING and appends existing ReviewRecord contract', () => {
  const harness = createHarness();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  const result = moveToReview(harness, entryId);
  assert.equal(result.state.progress.stage, LearningStage.REVIEWING);
  assert.equal(result.state.progress.reviewCount, 2);
  assert.equal(result.state.progress.correctCount, 1);
  assert.equal(result.state.progress.nextReviewAt, '2026-08-14T08:00:00.000Z');
  assert.equal(harness.reviewRecordStore.list().length, 1);
  assert.deepEqual(harness.reviewRecordStore.list()[0], result.reviewRecord);
  assert.notEqual(harness.reviewRecordStore.list()[0], result.reviewRecord);
  assert.ok(Object.isFrozen(result.reviewRecord));
});

test('REVIEWING transitions explicitly to MASTERED', () => {
  const harness = createHarness();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  moveToReview(harness, entryId);
  const state = harness.progressService.markMastered(entryId, {
    at: FIRST_REVIEW_AT,
    masteryScore: 90,
  });
  assert.equal(state.progress.stage, LearningStage.MASTERED);
  assert.equal(state.progress.masteryScore, 90);
  assert.equal(state.progress.nextReviewAt, null);
});

test('illegal main-state transitions fail closed with stable code', () => {
  const harness = createHarness();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  assert.throws(
    () => harness.progressService.markMastered(entryId, { at: STARTED_AT }),
    (error) => error instanceof LearningProgressServiceError && error.code === 'INVALID_STAGE_TRANSITION',
  );
  harness.progressService.markLearning(entryId, { at: STARTED_AT });
  assert.throws(
    () => harness.progressService.markLearning(entryId, { at: FIRST_REVIEW_AT }),
    (error) => error.code === 'INVALID_STAGE_TRANSITION',
  );
});

test('markReview requires explicit evidence and never invents an outcome', () => {
  const harness = createHarness();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  harness.progressService.markLearning(entryId, { at: STARTED_AT });
  assert.throws(
    () => harness.progressService.markReview(entryId, { at: FIRST_REVIEW_AT }),
    (error) => error.code === 'MISSING_REVIEW_EVIDENCE',
  );
  assert.equal(harness.reviewRecordStore.list().length, 0);
  assert.equal(harness.progressStore.get(entryId).stage, LearningStage.LEARNING);
});

test('favorite and unknown are independent sidecar flags, not main states', () => {
  const harness = createHarness();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  const favorite = harness.progressService.toggleFavorite(entryId, { at: STARTED_AT });
  assert.equal(favorite.favorite, true);
  assert.equal(favorite.unknown, false);
  assert.equal(favorite.progress.stage, LearningStage.NEW);
  const unknown = harness.progressService.markUnknown(entryId, { at: STARTED_AT });
  assert.equal(unknown.favorite, true);
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.progress.stage, LearningStage.NEW);
  assert.equal(harness.progressService.toggleFavorite(entryId, { at: STARTED_AT }).favorite, false);
});

test('explicit restart resets current progress but preserves append-only review history', () => {
  const harness = createHarness();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  moveToReview(harness, entryId);
  const reviewBefore = harness.reviewRecordStore.list()[0];
  const restarted = harness.progressService.restart(entryId, { at: '2026-08-12T08:00:00.000Z' });
  assert.equal(restarted.progress.stage, LearningStage.NEW);
  assert.equal(restarted.progress.reviewCount, 0);
  assert.equal(restarted.learningStartedAt, null);
  assert.equal(harness.reviewRecordStore.list().length, 1);
  assert.equal(harness.reviewRecordStore.list()[0], reviewBefore);
});

test('LearningProgressStore upsert/get/list/listByStatus preserve domain objects', () => {
  const progress = SYNTHETIC_LEARNING_PROGRESS.slice(0, 3);
  const store = createInMemoryLearningProgressStore({ progress });
  const entryId = progress[1].entryId;
  assert.equal(store.get(entryId).stage, LearningStage.LEARNING);
  assert.equal(store.list().length, 3);
  assert.equal(store.listByStatus(LearningStage.LEARNING).length, 2);
  assert.ok(Object.isFrozen(store.get(entryId)));
  assert.ok(Object.isFrozen(store.getState(entryId)));
});

test('calculateNextReview uses centralized deterministic intervals', () => {
  const scheduler = createReviewScheduler();
  assert.equal(LEARNING_REVIEW_INTERVAL_MS, 86_400_000);
  assert.equal(REVIEW_CORRECT_INTERVAL_MS, 259_200_000);
  assert.equal(REVIEW_INCORRECT_INTERVAL_MS, 86_400_000);
  assert.equal(scheduler.calculateNextReview({
    stage: LearningStage.LEARNING,
    reviewedAt: STARTED_AT,
  }), FIRST_REVIEW_AT);
  assert.equal(scheduler.calculateNextReview({
    stage: LearningStage.REVIEWING,
    reviewedAt: STARTED_AT,
    result: ReviewResult.CORRECT,
  }), '2026-08-13T08:00:00.000Z');
  assert.equal(scheduler.calculateNextReview({
    stage: LearningStage.REVIEWING,
    reviewedAt: STARTED_AT,
    result: ReviewResult.INCORRECT,
  }), FIRST_REVIEW_AT);
  assert.equal(scheduler.calculateNextReview({
    stage: LearningStage.MASTERED,
  }), null);
});

test('review candidates include overdue and due-now but exclude future and MASTERED', () => {
  const scheduler = createReviewScheduler();
  const candidates = scheduler.getReviewCandidates(SYNTHETIC_LEARNING_PROGRESS, {
    now: SYNTHETIC_LEARNING_NOW,
  });
  assert.deepEqual(candidates.map((item) => item.entryId), [
    SYNTHETIC_VOCABULARY_ENTRIES[1].entryId,
    SYNTHETIC_VOCABULARY_ENTRIES[3].entryId,
    SYNTHETIC_VOCABULARY_ENTRIES[2].entryId,
    SYNTHETIC_VOCABULARY_ENTRIES[6].entryId,
  ]);
  assert.ok(!candidates.some((item) => item.stage === LearningStage.MASTERED));
  assert.ok(!candidates.some((item) => item.entryId === SYNTHETIC_VOCABULARY_ENTRIES[4].entryId));
});

test('ReviewRecordStore is append-only and rejects duplicate identity', () => {
  const store = createInMemoryReviewRecordStore(SYNTHETIC_REVIEW_RECORDS);
  const first = store.list()[0];
  assert.ok(Object.isFrozen(first));
  assert.throws(
    () => store.append(first),
    (error) => error instanceof ReviewRecordStoreError && error.code === 'DUPLICATE_REVIEW_ID',
  );
  assert.equal(store.list().length, SYNTHETIC_REVIEW_RECORDS.length);
});

test('Today Queue priority is REVIEW then LEARNING then NEW', () => {
  const harness = createHarness({
    progress: SYNTHETIC_LEARNING_PROGRESS,
    metadata: SYNTHETIC_LEARNING_METADATA,
    records: SYNTHETIC_REVIEW_RECORDS,
  });
  const queue = harness.queueBuilder.build({ now: SYNTHETIC_LEARNING_NOW });
  assert.deepEqual(queue.todayWords.map((item) => item.queueType), [
    QueueType.REVIEW,
    QueueType.REVIEW,
    QueueType.LEARNING,
    QueueType.LEARNING,
    QueueType.NEW,
    QueueType.NEW,
  ]);
  assert.equal(queue.reviewCount, 2);
  assert.equal(queue.learningCount, 2);
  assert.equal(queue.newCount, 2);
  assert.equal(queue.totalCount, 6);
});

test('Today Queue ordering is stable for identical input', () => {
  const harness = createHarness({
    progress: SYNTHETIC_LEARNING_PROGRESS,
    metadata: SYNTHETIC_LEARNING_METADATA,
  });
  const first = harness.queueBuilder.build({ now: SYNTHETIC_LEARNING_NOW });
  const second = harness.queueBuilder.build({ now: SYNTHETIC_LEARNING_NOW });
  assert.deepEqual(first, second);
  assert.deepEqual(first.todayWords.map((item) => item.entryId).slice(0, 2), [
    SYNTHETIC_VOCABULARY_ENTRIES[3].entryId,
    SYNTHETIC_VOCABULARY_ENTRIES[6].entryId,
  ]);
});

test('Today Queue deduplicates every word across all categories', () => {
  const harness = createHarness({ progress: SYNTHETIC_LEARNING_PROGRESS });
  const queue = harness.queueBuilder.build({ now: SYNTHETIC_LEARNING_NOW });
  const ids = queue.todayWords.map((item) => item.entryId);
  assert.equal(new Set(ids).size, ids.length);
});

test('daily, review and new-word limits are enforced centrally', () => {
  const harness = createHarness({ progress: SYNTHETIC_LEARNING_PROGRESS });
  assert.deepEqual(DEFAULT_TODAY_QUEUE_CONFIG, { dailyLimit: 20, newWordLimit: 10, reviewLimit: 10 });
  const queue = harness.queueBuilder.build({
    now: SYNTHETIC_LEARNING_NOW,
    config: { dailyLimit: 3, reviewLimit: 1, newWordLimit: 1 },
  });
  assert.equal(queue.totalCount, 3);
  assert.equal(queue.reviewCount, 1);
  assert.equal(queue.learningCount, 2);
  assert.equal(queue.newCount, 0);
});

test('TodayVocabularyViewModel has stable pre-load and loaded shapes', () => {
  const harness = createHarness({
    progress: SYNTHETIC_LEARNING_PROGRESS,
    metadata: SYNTHETIC_LEARNING_METADATA,
    records: SYNTHETIC_REVIEW_RECORDS,
  });
  assert.deepEqual(harness.viewModel.getSummary(), {
    loaded: false,
    totalCount: 0,
    newCount: 0,
    learningCount: 0,
    reviewCount: 0,
    masteredCount: 0,
    completionRate: 0,
  });
  const loaded = harness.viewModel.loadToday({ now: SYNTHETIC_LEARNING_NOW });
  assert.ok(Object.isFrozen(loaded));
  assert.equal(loaded.words.length, loaded.totalCount);
  assert.equal(loaded.masteredCount, 1);
  assert.equal(loaded.completionRate, 12.5);
  assert.equal(harness.viewModel.getSummary().loaded, true);
});

test('learning statistics use explicit zero semantics without NaN or Infinity', () => {
  const vocabularyStore = createInMemoryVocabularyStore();
  const progressStore = createInMemoryLearningProgressStore();
  const reviewRecordStore = createInMemoryReviewRecordStore();
  const statistics = getLearningStatistics(vocabularyStore, {
    progressStore,
    reviewRecordStore,
    day: '2026-08-10',
  });
  assert.deepEqual(statistics, {
    statisticsVersion: '0.1',
    totalWords: 0,
    dailyLearnedCount: 0,
    dailyReviewCount: 0,
    masteredCount: 0,
    favoriteCount: 0,
    unknownCount: 0,
    completionRate: 0,
    userStateAvailable: true,
  });
  assert.ok(Number.isFinite(statistics.completionRate));
});

test('learning statistics derive daily and flag counts from real stores', () => {
  const harness = createHarness({
    progress: SYNTHETIC_LEARNING_PROGRESS,
    metadata: SYNTHETIC_LEARNING_METADATA,
    records: SYNTHETIC_REVIEW_RECORDS,
  });
  assert.deepEqual(getLearningStatistics(harness.vocabularyStore, {
    progressStore: harness.progressStore,
    reviewRecordStore: harness.reviewRecordStore,
    day: '2026-08-10',
  }), {
    statisticsVersion: '0.1',
    totalWords: 8,
    dailyLearnedCount: 2,
    dailyReviewCount: 2,
    masteredCount: 1,
    favoriteCount: 2,
    unknownCount: 1,
    completionRate: 12.5,
    userStateAvailable: true,
  });
});

test('unknown vocabulary identity fails without creating progress', () => {
  const harness = createHarness();
  assert.throws(
    () => harness.progressService.markLearning('cet6:test:missing', { at: STARTED_AT }),
    (error) => error.code === 'WORD_NOT_FOUND',
  );
  assert.equal(harness.progressStore.list().length, 0);
});

test('public API exports all formal 003 capabilities', async () => {
  const api = await import('../src/index.mjs');
  for (const name of [
    'createInMemoryLearningProgressStore',
    'createInMemoryReviewRecordStore',
    'createLearningProgressService',
    'createReviewScheduler',
    'calculateNextReview',
    'getReviewCandidates',
    'createTodayQueueBuilder',
    'createTodayVocabularyViewModel',
    'getLearningStatistics',
  ]) {
    assert.equal(typeof api[name], 'function', `${name} must be exported`);
  }
});
