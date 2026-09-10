import { decodeRatingEvidence } from '../application/rating-evidence-codec.mjs';
import { LearningStage } from '../domain/learner-progress.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { ReviewRating } from '../scheduler/rating-contract.mjs';

export const GENERIC_STUDY_STATISTICS_VERSION = '0.1';

export function getGenericStudyStatistics({ catalog, adapter, learnerId, progressStore, reviewRecordStore, day, plan }) {
  if (typeof catalog?.get !== 'function' || typeof catalog?.count !== 'function') throw new TypeError('catalog required');
  if (typeof adapter?.adapt !== 'function') throw new TypeError('adapter required');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day) throw new TypeError('valid day required');
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  const identities = new Set(catalog.list().map((content) => adapter.adapt(content).studyItem.itemId));
  const states = progressStore.listStates().filter((state) => identities.has(state.entryId));
  const records = reviewRecordStore.list().filter((record) => identities.has(record.entryId) && record.reviewedAt.slice(0, 10) === day);
  const ratings = records.map(decodeRatingEvidence).filter(Boolean);
  const countStage = (stage) => states.filter((state) => state.progress.stage === stage).length;
  const mastered = countStage(LearningStage.MASTERED);
  const todayCompleted = new Set(records.map((record) => record.entryId)).size;
  const planned = plan?.dailyTotalLimit ?? 0;
  return Object.freeze({
    statisticsVersion: GENERIC_STUDY_STATISTICS_VERSION,
    learnerId: canonicalLearnerId,
    day,
    totalItems: catalog.count(),
    todayPlan: planned,
    todayCompleted,
    todayNew: states.filter((state) => state.learningStartedAt?.slice(0, 10) === day).length,
    todayReview: records.length,
    todayRatings: Object.freeze({
      again: ratings.filter((item) => item === ReviewRating.AGAIN).length,
      hard: ratings.filter((item) => item === ReviewRating.HARD).length,
      good: ratings.filter((item) => item === ReviewRating.GOOD).length,
      easy: ratings.filter((item) => item === ReviewRating.EASY).length,
      unmappedLegacy: records.length - ratings.length,
    }),
    stages: Object.freeze({
      new: catalog.count() - states.length + countStage(LearningStage.NEW),
      learning: countStage(LearningStage.LEARNING),
      reviewing: countStage(LearningStage.REVIEWING),
      mastered,
      suspended: countStage(LearningStage.SUSPENDED),
    }),
    favoriteCount: states.filter((state) => state.favorite).length,
    unknownCount: states.filter((state) => state.unknown).length,
    completionRate: planned === 0 ? 0 : Math.min(100, Math.round((todayCompleted / planned) * 10_000) / 100),
    masteryRate: catalog.count() === 0 ? 0 : Math.round((mastered / catalog.count()) * 10_000) / 100,
  });
}
