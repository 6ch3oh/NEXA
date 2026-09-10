import { LearningStage, createLearnerProgress } from '../domain/learner-progress.mjs';
import { ReviewMode, createReviewRecord } from '../domain/review-record.mjs';
import {
  requireCanonicalIsoDateTime,
  requireInteger,
} from '../domain/shared.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { assertLearningProgressStore } from '../learning/learning-progress-store.mjs';
import { assertReviewRecordStore } from '../learning/review-record-store.mjs';
import { createReviewScheduler } from '../learning/review-scheduler.mjs';
import { ReviewRating, validateReviewRating } from '../scheduler/rating-contract.mjs';
import { createRelearningPolicy } from '../scheduler/relearning-contract.mjs';
import { createSimpleSchedulerAdapter } from '../scheduler/review-scheduler-contract.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import {
  createRatingEvidenceReviewId,
  decodeRatingEvidence,
  encodeRatingEvidence,
} from './rating-evidence-codec.mjs';

export const CET6_STUDY_SESSION_VERSION = '0.1';

export class Cet6StudySessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Cet6StudySessionError';
    this.code = code;
  }
}

export function createCet6StudySession({
  learnerId,
  vocabularyStore,
  progressStore,
  reviewRecordStore,
  scheduler = createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() }),
  relearningPolicy = createRelearningPolicy(),
  clock = () => new Date().toISOString(),
}) {
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  assertReviewRecordStore(reviewRecordStore);
  if (typeof scheduler?.schedule !== 'function') throw new TypeError('scheduler.schedule() required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  function requireEntry(entryId) {
    const entry = vocabularyStore.getById(entryId);
    if (!entry) throw new Cet6StudySessionError('WORD_NOT_FOUND', `word not found: ${entryId}`);
    return entry;
  }

  function at(options) {
    return requireCanonicalIsoDateTime(options.at ?? clock(), 'options.at');
  }

  function getState(entryId) {
    requireEntry(entryId);
    return progressStore.getState(entryId);
  }

  function ensureProgress(entryId, timestamp) {
    const current = progressStore.get(entryId);
    if (current) return current;
    return progressStore.upsert(createLearnerProgress({
      learnerId: canonicalLearnerId,
      entryId,
      updatedAt: timestamp,
    }));
  }

  function start(entryId, options = {}) {
    const entry = requireEntry(entryId);
    const timestamp = at(options);
    const current = ensureProgress(entry.entryId, timestamp);
    if (current.stage !== LearningStage.NEW) return progressStore.getState(entry.entryId);
    const progress = createLearnerProgress({
      learnerId: canonicalLearnerId,
      entryId: entry.entryId,
      stage: LearningStage.LEARNING,
      reviewCount: 1,
      lastReviewedAt: timestamp,
      nextReviewAt: timestamp,
      updatedAt: timestamp,
    });
    progressStore.upsert(progress);
    progressStore.setLearningStartedAt(entry.entryId, timestamp);
    return progressStore.getState(entry.entryId);
  }

  function rate(entryId, rating, options = {}) {
    const entry = requireEntry(entryId);
    const canonicalRating = validateReviewRating(rating);
    const timestamp = at(options);
    let current = progressStore.get(entry.entryId);
    if (current === null || current.stage === LearningStage.NEW) {
      start(entry.entryId, { at: timestamp });
      current = progressStore.get(entry.entryId);
    }
    if (current.stage === LearningStage.MASTERED) {
      throw new Cet6StudySessionError('WORD_ALREADY_MASTERED', `word is mastered: ${entry.entryId}`);
    }
    if (![LearningStage.LEARNING, LearningStage.REVIEWING].includes(current.stage)) {
      throw new Cet6StudySessionError('WORD_NOT_REVIEWABLE', `word cannot be rated from ${current.stage}`);
    }
    const durationMs = requireInteger(options.durationMs ?? 0, 'options.durationMs', { min: 0, max: 86_400_000 });
    const evidence = encodeRatingEvidence(canonicalRating);
    const nextReviewCount = current.reviewCount + 1;
    const baseReviewId = options.reviewId ?? `review:${entry.entryId}:${Date.parse(timestamp)}:${nextReviewCount}`;
    const reviewId = createRatingEvidenceReviewId(canonicalRating, baseReviewId);
    const reviewRecord = createReviewRecord({
      reviewId,
      learnerId: canonicalLearnerId,
      entryId: entry.entryId,
      mode: options.mode ?? ReviewMode.MEANING_RECALL,
      ...evidence,
      durationMs,
      reviewedAt: timestamp,
    });
    if (reviewRecordStore.has(reviewId)) {
      throw new Cet6StudySessionError('DUPLICATE_REVIEW_ID', `review already exists: ${reviewId}`);
    }
    const previousRatings = reviewRecordStore.listByWord(entry.entryId).map(decodeRatingEvidence);
    let consecutiveAgain = 0;
    for (let index = previousRatings.length - 1; index >= 0 && previousRatings[index] === ReviewRating.AGAIN; index -= 1) {
      consecutiveAgain += 1;
    }
    const schedule = canonicalRating === ReviewRating.AGAIN
      ? Object.freeze({
        dueAt: relearningPolicy.getNextDueAt({
          rating: canonicalRating,
          now: timestamp,
          stepIndex: Math.min(consecutiveAgain, relearningPolicy.stepsMs.length - 1),
        }),
        rating: canonicalRating,
        phase: 'relearning',
        relearningStepIndex: Math.min(consecutiveAgain, relearningPolicy.stepsMs.length - 1),
      })
      : scheduler.schedule({ ...current, reviewHistory: reviewRecordStore.listByWord(entry.entryId) }, canonicalRating, timestamp);
    const correct = [ReviewRating.GOOD, ReviewRating.EASY].includes(canonicalRating);
    const again = canonicalRating === ReviewRating.AGAIN;
    const hard = canonicalRating === ReviewRating.HARD;
    const masteryDelta = canonicalRating === ReviewRating.EASY ? 15
      : canonicalRating === ReviewRating.GOOD ? 10
        : again ? -10 : 0;
    const nextProgress = createLearnerProgress({
      ...current,
      stage: LearningStage.REVIEWING,
      masteryScore: Math.min(100, Math.max(0, current.masteryScore + masteryDelta)),
      reviewCount: nextReviewCount,
      correctCount: current.correctCount + (correct ? 1 : 0),
      incorrectCount: current.incorrectCount + (again ? 1 : 0),
      streak: correct ? current.streak + 1 : again ? 0 : current.streak,
      lapseCount: current.lapseCount + (again ? 1 : 0),
      lastReviewedAt: timestamp,
      nextReviewAt: schedule.dueAt,
      updatedAt: timestamp,
    });
    progressStore.upsert(nextProgress);
    reviewRecordStore.append(reviewRecord);
    return Object.freeze({
      sessionVersion: CET6_STUDY_SESSION_VERSION,
      rating: canonicalRating,
      state: progressStore.getState(entry.entryId),
      reviewRecord,
      schedule,
      hard,
    });
  }

  function advanceRelearning(entryId, options = {}) {
    requireEntry(entryId);
    const timestamp = at(options);
    const current = progressStore.get(entryId);
    if (!current) throw new Cet6StudySessionError('PROGRESS_NOT_FOUND', `progress not found: ${entryId}`);
    const records = reviewRecordStore.listByWord(entryId);
    const latest = records.at(-1);
    if (!latest || decodeRatingEvidence(latest) !== ReviewRating.AGAIN) {
      throw new Cet6StudySessionError('NOT_IN_RELEARNING', `word is not in relearning: ${entryId}`);
    }
    const nextReviewAt = relearningPolicy.getNextDueAt({ rating: ReviewRating.AGAIN, now: timestamp, stepIndex: 1 });
    progressStore.upsert(createLearnerProgress({ ...current, nextReviewAt, updatedAt: timestamp }));
    return Object.freeze({ stepIndex: 1, dueAt: nextReviewAt, state: progressStore.getState(entryId) });
  }

  function master(entryId, options = {}) {
    requireEntry(entryId);
    const timestamp = at(options);
    const current = progressStore.get(entryId);
    if (!current || ![LearningStage.LEARNING, LearningStage.REVIEWING].includes(current.stage)) {
      throw new Cet6StudySessionError('WORD_NOT_MASTERABLE', `word cannot be mastered: ${entryId}`);
    }
    progressStore.upsert(createLearnerProgress({
      ...current,
      stage: LearningStage.MASTERED,
      masteryScore: Math.max(80, current.masteryScore),
      nextReviewAt: null,
      updatedAt: timestamp,
    }));
    return progressStore.getState(entryId);
  }

  function setFavorite(entryId, favorite, options = {}) {
    requireEntry(entryId);
    if (typeof favorite !== 'boolean') throw new TypeError('favorite must be boolean');
    ensureProgress(entryId, at(options));
    progressStore.setFavorite(entryId, favorite);
    return progressStore.getState(entryId);
  }

  function setUnknown(entryId, unknown, options = {}) {
    requireEntry(entryId);
    if (typeof unknown !== 'boolean') throw new TypeError('unknown must be boolean');
    ensureProgress(entryId, at(options));
    progressStore.setUnknown(entryId, unknown);
    return progressStore.getState(entryId);
  }

  return Object.freeze({
    sessionVersion: CET6_STUDY_SESSION_VERSION,
    learnerId: canonicalLearnerId,
    getState,
    start,
    rate,
    advanceRelearning,
    master,
    setFavorite,
    setUnknown,
  });
}
