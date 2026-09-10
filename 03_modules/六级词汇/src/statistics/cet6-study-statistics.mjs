import { decodeRatingEvidence } from '../application/rating-evidence-codec.mjs';
import { LearningStage } from '../domain/learner-progress.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { assertLearningProgressStore } from '../learning/learning-progress-store.mjs';
import { assertReviewRecordStore } from '../learning/review-record-store.mjs';
import { ReviewRating } from '../scheduler/rating-contract.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';

export const CET6_STUDY_STATISTICS_VERSION = '0.1';

function requireDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('day must use YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new TypeError('invalid day');
  return value;
}

export function getCet6StudyStatistics(vocabularyStore, {
  learnerId,
  progressStore,
  reviewRecordStore,
  day,
  dailyPlan = null,
}) {
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  assertReviewRecordStore(reviewRecordStore);
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  const canonicalDay = requireDay(day);
  const states = progressStore.listStates().filter((state) => vocabularyStore.getById(state.entryId) !== null);
  const records = reviewRecordStore.list().filter((record) => (
    vocabularyStore.getById(record.entryId) !== null
    && record.reviewedAt.slice(0, 10) === canonicalDay
  ));
  const ratings = records.map(decodeRatingEvidence).filter(Boolean);
  const countStage = (stage) => states.filter((state) => state.progress.stage === stage).length;
  const planned = dailyPlan?.dailyTotalLimit ?? 0;
  const todayNew = states.filter((state) => state.learningStartedAt?.slice(0, 10) === canonicalDay).length;
  const todayCompleted = new Set(records.map((record) => record.entryId)).size;
  const masteredCount = countStage(LearningStage.MASTERED);
  return Object.freeze({
    statisticsVersion: CET6_STUDY_STATISTICS_VERSION,
    learnerId: canonicalLearnerId,
    day: canonicalDay,
    todayPlan: planned,
    todayCompleted,
    todayNew,
    todayReview: records.length,
    todayRatings: Object.freeze({
      again: ratings.filter((rating) => rating === ReviewRating.AGAIN).length,
      hard: ratings.filter((rating) => rating === ReviewRating.HARD).length,
      good: ratings.filter((rating) => rating === ReviewRating.GOOD).length,
      easy: ratings.filter((rating) => rating === ReviewRating.EASY).length,
      unmappedLegacy: records.length - ratings.length,
    }),
    stages: Object.freeze({
      new: vocabularyStore.count() - states.length + countStage(LearningStage.NEW),
      learning: countStage(LearningStage.LEARNING),
      reviewing: countStage(LearningStage.REVIEWING),
      mastered: masteredCount,
      suspended: countStage(LearningStage.SUSPENDED),
    }),
    favoriteCount: states.filter((state) => state.favorite).length,
    unknownCount: states.filter((state) => state.unknown).length,
    completionRate: planned === 0 ? 0 : Math.min(100, Math.round((todayCompleted / planned) * 10_000) / 100),
    masteryRate: vocabularyStore.count() === 0 ? 0 : Math.round((masteredCount / vocabularyStore.count()) * 10_000) / 100,
  });
}
