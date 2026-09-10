import { createRatingEvidenceReviewId, decodeRatingEvidence, encodeRatingEvidence } from './rating-evidence-codec.mjs';
import { LearningStage, createLearnerProgress } from '../domain/learner-progress.mjs';
import { ReviewMode, createReviewRecord } from '../domain/review-record.mjs';
import { requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { ReviewRating, validateReviewRating } from '../scheduler/rating-contract.mjs';
import { createRelearningPolicy } from '../scheduler/relearning-contract.mjs';

export const GENERIC_STUDY_SESSION_VERSION = '0.1';

export function createGenericStudySession({ learnerId, catalog, adapter, progressStore, reviewRecordStore, scheduler, clock = () => new Date().toISOString() }) {
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  if (typeof catalog?.get !== 'function') throw new TypeError('catalog.get() required');
  if (typeof adapter?.adapt !== 'function') throw new TypeError('adapter.adapt() required');
  if (typeof scheduler?.schedule !== 'function') throw new TypeError('scheduler.schedule() required');
  const relearning = createRelearningPolicy();
  const timestamp = (options) => requireCanonicalIsoDateTime(options.at ?? clock(), 'options.at');
  const requireContent = (contentId) => {
    const content = catalog.get(contentId);
    if (!content) throw new TypeError(`content not found: ${contentId}`);
    return content;
  };

  function identityFor(contentId) {
    return adapter.adapt(requireContent(contentId)).studyItem.itemId;
  }

  function ensure(contentId, at) {
    const identity = identityFor(contentId);
    return progressStore.get(identity) ?? progressStore.upsert(createLearnerProgress({ learnerId: canonicalLearnerId, entryId: identity, updatedAt: at }));
  }

  function rate(contentId, rating, options = {}) {
    const canonicalRating = validateReviewRating(rating);
    const at = timestamp(options);
    const identity = identityFor(contentId);
    const current = ensure(contentId, at);
    if (current.stage === LearningStage.MASTERED) throw new TypeError('mastered content cannot be rated');
    const history = reviewRecordStore.listByWord(identity);
    let consecutiveAgain = 0;
    for (let i = history.length - 1; i >= 0 && decodeRatingEvidence(history[i]) === ReviewRating.AGAIN; i -= 1) consecutiveAgain += 1;
    const schedule = canonicalRating === ReviewRating.AGAIN
      ? Object.freeze({
        dueAt: relearning.getNextDueAt({ rating: canonicalRating, now: at, stepIndex: Math.min(consecutiveAgain, 1) }),
        phase: 'relearning', rating: canonicalRating, relearningStepIndex: Math.min(consecutiveAgain, 1),
      })
      : scheduler.schedule({ ...current, reviewHistory: history }, canonicalRating, at);
    const evidence = encodeRatingEvidence(canonicalRating);
    const correct = [ReviewRating.GOOD, ReviewRating.EASY].includes(canonicalRating);
    const again = canonicalRating === ReviewRating.AGAIN;
    const record = createReviewRecord({
      reviewId: createRatingEvidenceReviewId(canonicalRating, options.reviewId ?? `review:${identity}:${Date.parse(at)}:${current.reviewCount + 1}`),
      learnerId: canonicalLearnerId,
      entryId: identity,
      mode: options.mode ?? ReviewMode.MEANING_RECALL,
      ...evidence,
      durationMs: options.durationMs ?? 0,
      reviewedAt: at,
    });
    if (reviewRecordStore.has(record.reviewId)) throw new TypeError(`duplicate reviewId: ${record.reviewId}`);
    progressStore.upsert(createLearnerProgress({
      ...current,
      stage: LearningStage.REVIEWING,
      masteryScore: Math.min(100, Math.max(0, current.masteryScore + (canonicalRating === ReviewRating.EASY ? 15 : canonicalRating === ReviewRating.GOOD ? 10 : again ? -10 : 0))),
      reviewCount: current.reviewCount + 1,
      correctCount: current.correctCount + (correct ? 1 : 0),
      incorrectCount: current.incorrectCount + (again ? 1 : 0),
      streak: correct ? current.streak + 1 : again ? 0 : current.streak,
      lapseCount: current.lapseCount + (again ? 1 : 0),
      lastReviewedAt: at,
      nextReviewAt: schedule.dueAt,
      updatedAt: at,
    }));
    reviewRecordStore.append(record);
    return Object.freeze({ rating: canonicalRating, schedule, record, state: progressStore.getState(identity) });
  }

  function master(contentId, options = {}) {
    const at = timestamp(options);
    const identity = identityFor(contentId);
    const current = ensure(contentId, at);
    if (current.reviewCount === 0) throw new TypeError('content must be studied before mastering');
    progressStore.upsert(createLearnerProgress({ ...current, stage: LearningStage.MASTERED, masteryScore: Math.max(80, current.masteryScore), nextReviewAt: null, updatedAt: at }));
    return progressStore.getState(identity);
  }

  return Object.freeze({ sessionVersion: GENERIC_STUDY_SESSION_VERSION, learnerId: canonicalLearnerId, rate, master });
}
