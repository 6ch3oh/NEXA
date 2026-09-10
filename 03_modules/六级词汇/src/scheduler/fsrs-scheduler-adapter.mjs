import { FSRSVersion, Rating, createEmptyCard, fsrs } from 'ts-fsrs';
import { deepFreeze, requireCanonicalIsoDateTime, requirePlainObject } from '../domain/shared.mjs';
import { decodeRatingEvidence } from '../application/rating-evidence-codec.mjs';
import { ReviewRating, validateReviewRating } from './rating-contract.mjs';
import { assertGenericReviewScheduler } from './review-scheduler-contract.mjs';

export const FSRS_SCHEDULER_ADAPTER_VERSION = '0.1';
export const FSRS_IMPLEMENTATION = Object.freeze({
  package: 'ts-fsrs',
  version: '5.4.1',
  license: 'MIT',
  fsrsVersion: FSRSVersion,
});

const FSRS_RATING = Object.freeze({
  [ReviewRating.AGAIN]: Rating.Again,
  [ReviewRating.HARD]: Rating.Hard,
  [ReviewRating.GOOD]: Rating.Good,
  [ReviewRating.EASY]: Rating.Easy,
});

export function createFsrsSchedulerAdapter({ fallbackScheduler, requestRetention = 0.9, maximumInterval = 36_500 }) {
  assertGenericReviewScheduler(fallbackScheduler);
  const engine = fsrs({
    request_retention: requestRetention,
    maximum_interval: maximumInterval,
    enable_fuzz: false,
    enable_short_term: false,
    learning_steps: [],
    relearning_steps: [],
  });

  function schedule(cardState, rating, now) {
    requirePlainObject(cardState, 'cardState');
    const canonicalRating = validateReviewRating(rating);
    const canonicalNow = requireCanonicalIsoDateTime(now, 'now');
    const history = cardState.reviewHistory ?? [];
    if (!Array.isArray(history)) throw new TypeError('cardState.reviewHistory must be an array');
    const decoded = history.map((record) => ({ record, rating: decodeRatingEvidence(record) }))
      .sort((left, right) => left.record.reviewedAt.localeCompare(right.record.reviewedAt)
        || left.record.reviewId.localeCompare(right.record.reviewId));
    if (decoded.some((item) => item.rating === null)) {
      const fallback = fallbackScheduler.schedule(cardState, canonicalRating, canonicalNow);
      return deepFreeze({ ...fallback, schedulerType: 'simple_fallback', migrationMode: 'legacy_history_fallback' });
    }
    try {
      const firstAt = decoded[0]?.record.reviewedAt ?? canonicalNow;
      let card = createEmptyCard(new Date(firstAt));
      for (const item of decoded) {
        card = engine.next(card, new Date(item.record.reviewedAt), FSRS_RATING[item.rating]).card;
      }
      const next = engine.next(card, new Date(canonicalNow), FSRS_RATING[canonicalRating]);
      return deepFreeze({
        dueAt: next.card.due.toISOString(),
        rating: canonicalRating,
        phase: 'long_term',
        schedulerType: 'fsrs',
        migrationMode: decoded.length === 0 ? 'new_card' : 'history_replay',
        fsrs: {
          stability: next.card.stability,
          difficulty: next.card.difficulty,
          scheduledDays: next.card.scheduled_days,
          reps: next.card.reps,
          lapses: next.card.lapses,
          state: next.card.state,
        },
      });
    } catch {
      const fallback = fallbackScheduler.schedule(cardState, canonicalRating, canonicalNow);
      return deepFreeze({ ...fallback, schedulerType: 'simple_fallback', migrationMode: 'history_replay_error_fallback' });
    }
  }

  function getDueAt(cardState) {
    return cardState?.dueAt ?? cardState?.nextReviewAt ?? null;
  }

  function isDue(cardState, now) {
    const canonicalNow = requireCanonicalIsoDateTime(now, 'now');
    const dueAt = getDueAt(cardState);
    return dueAt !== null && dueAt <= canonicalNow;
  }

  return assertGenericReviewScheduler(Object.freeze({
    schedulerVersion: FSRS_SCHEDULER_ADAPTER_VERSION,
    schedulerType: 'fsrs',
    implementation: FSRS_IMPLEMENTATION,
    configuration: Object.freeze({
      requestRetention,
      maximumInterval,
      enableFuzz: false,
      enableShortTerm: false,
      learningSteps: Object.freeze([]),
      relearningSteps: Object.freeze([]),
      source: 'existing-runtime-configuration',
    }),
    fallbackConditions: Object.freeze([
      'legacy_history_without_rating_evidence',
      'history_replay_error',
    ]),
    schedule,
    getDueAt,
    isDue,
  }));
}
