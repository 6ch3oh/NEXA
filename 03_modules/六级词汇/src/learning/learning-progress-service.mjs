import {
  requireCanonicalIsoDateTime,
  requireFiniteNumber,
  requireInteger,
  requirePlainObject,
} from '../domain/shared.mjs';
import { LearningStage, createLearnerProgress } from '../domain/learner-progress.mjs';
import {
  ReviewMode,
  ReviewResult,
  createReviewRecord,
} from '../domain/review-record.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { assertLearningProgressStore } from './learning-progress-store.mjs';
import { assertReviewRecordStore } from './review-record-store.mjs';
import { assertReviewScheduler } from './review-scheduler.mjs';

export const LEARNING_PROGRESS_SERVICE_VERSION = '0.1';

export class LearningProgressServiceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LearningProgressServiceError';
    this.code = code;
    this.details = details;
  }
}

function transitionError(current, target) {
  return new LearningProgressServiceError(
    'INVALID_STAGE_TRANSITION',
    `cannot transition from ${current} to ${target}`,
    { current, target },
  );
}

export function createLearningProgressService({
  learnerId,
  vocabularyStore,
  progressStore,
  reviewRecordStore,
  reviewScheduler,
  clock = () => new Date().toISOString(),
}) {
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  assertReviewRecordStore(reviewRecordStore);
  assertReviewScheduler(reviewScheduler);
  if (typeof learnerId !== 'string' || learnerId.trim() === '') {
    throw new LearningProgressServiceError('INVALID_LEARNER_ID', 'learnerId is required');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  function timestamp(options = {}) {
    requirePlainObject(options, 'options');
    return requireCanonicalIsoDateTime(options.at ?? clock(), 'options.at');
  }

  function requireWord(entryId) {
    const entry = vocabularyStore.getById(entryId);
    if (!entry) throw new LearningProgressServiceError('WORD_NOT_FOUND', `word not found: ${entryId}`);
    return entry;
  }

  function ensureProgress(entryId, at) {
    const entry = requireWord(entryId);
    const existing = progressStore.get(entry.entryId);
    if (existing) return existing;
    return progressStore.upsert(createLearnerProgress({
      learnerId,
      entryId: entry.entryId,
      updatedAt: at,
    }));
  }

  function state(entryId) {
    return progressStore.getState(entryId);
  }

  function markLearning(entryId, options = {}) {
    const at = timestamp(options);
    const current = ensureProgress(entryId, at);
    if (current.stage !== LearningStage.NEW) throw transitionError(current.stage, LearningStage.LEARNING);
    const nextReviewAt = reviewScheduler.calculateNextReview({
      stage: LearningStage.LEARNING,
      reviewedAt: at,
    });
    progressStore.upsert(createLearnerProgress({
      ...current,
      stage: LearningStage.LEARNING,
      reviewCount: 1,
      lastReviewedAt: at,
      nextReviewAt,
      updatedAt: at,
    }));
    progressStore.setLearningStartedAt(current.entryId, at);
    return state(current.entryId);
  }

  function markReview(entryId, options = {}) {
    const at = timestamp(options);
    const current = ensureProgress(entryId, at);
    if (![LearningStage.LEARNING, LearningStage.REVIEWING].includes(current.stage)) {
      throw transitionError(current.stage, LearningStage.REVIEWING);
    }
    if (options.result === undefined || options.score === undefined) {
      throw new LearningProgressServiceError(
        'MISSING_REVIEW_EVIDENCE',
        'markReview requires explicit result and score',
      );
    }
    const result = options.result;
    const score = requireFiniteNumber(options.score, 'options.score', { min: 0, max: 1 });
    const durationMs = requireInteger(options.durationMs ?? 0, 'options.durationMs', {
      min: 0,
      max: 86_400_000,
    });
    const nextReviewAt = reviewScheduler.calculateNextReview({
      stage: LearningStage.REVIEWING,
      reviewedAt: at,
      result,
    });
    const nextReviewCount = current.reviewCount + 1;
    const correct = result === ReviewResult.CORRECT;
    const incorrect = result === ReviewResult.INCORRECT;
    const reviewId = options.reviewId
      ?? `review:${current.entryId}:${Date.parse(at)}:${nextReviewCount}`;
    const reviewRecord = createReviewRecord({
      reviewId,
      learnerId,
      entryId: current.entryId,
      mode: options.mode ?? ReviewMode.MEANING_RECALL,
      result,
      score,
      durationMs,
      reviewedAt: at,
    });
    if (reviewRecordStore.has(reviewRecord.reviewId)) {
      throw new LearningProgressServiceError('DUPLICATE_REVIEW_ID', `review already exists: ${reviewRecord.reviewId}`);
    }
    const nextProgress = createLearnerProgress({
      ...current,
      stage: LearningStage.REVIEWING,
      masteryScore: correct
        ? Math.min(100, current.masteryScore + 10)
        : incorrect
          ? Math.max(0, current.masteryScore - 10)
          : current.masteryScore,
      reviewCount: nextReviewCount,
      correctCount: current.correctCount + (correct ? 1 : 0),
      incorrectCount: current.incorrectCount + (incorrect ? 1 : 0),
      streak: correct ? current.streak + 1 : incorrect ? 0 : current.streak,
      lapseCount: current.lapseCount + (incorrect ? 1 : 0),
      lastReviewedAt: at,
      nextReviewAt,
      updatedAt: at,
    });
    progressStore.upsert(nextProgress);
    reviewRecordStore.append(reviewRecord);
    return Object.freeze({ state: state(current.entryId), reviewRecord });
  }

  function markMastered(entryId, options = {}) {
    const at = timestamp(options);
    const current = ensureProgress(entryId, at);
    if (current.stage !== LearningStage.REVIEWING) throw transitionError(current.stage, LearningStage.MASTERED);
    const masteryScore = requireInteger(options.masteryScore ?? 100, 'options.masteryScore', { min: 80, max: 100 });
    progressStore.upsert(createLearnerProgress({
      ...current,
      stage: LearningStage.MASTERED,
      masteryScore,
      nextReviewAt: null,
      updatedAt: at,
    }));
    return state(current.entryId);
  }

  function markUnknown(entryId, options = {}) {
    const at = timestamp(options);
    const current = ensureProgress(entryId, at);
    progressStore.setUnknown(current.entryId, options.unknown ?? true);
    return state(current.entryId);
  }

  function toggleFavorite(entryId, options = {}) {
    const at = timestamp(options);
    const current = ensureProgress(entryId, at);
    const currentState = state(current.entryId);
    progressStore.setFavorite(current.entryId, !currentState.favorite);
    return state(current.entryId);
  }

  function restart(entryId, options = {}) {
    const at = timestamp(options);
    const current = ensureProgress(entryId, at);
    if (current.stage === LearningStage.NEW) throw transitionError(current.stage, LearningStage.NEW);
    progressStore.upsert(createLearnerProgress({ learnerId, entryId: current.entryId, updatedAt: at }));
    progressStore.setLearningStartedAt(current.entryId, null);
    return state(current.entryId);
  }

  return Object.freeze({
    serviceVersion: LEARNING_PROGRESS_SERVICE_VERSION,
    getState: state,
    markLearning,
    markReview,
    markMastered,
    markUnknown,
    toggleFavorite,
    restart,
  });
}
