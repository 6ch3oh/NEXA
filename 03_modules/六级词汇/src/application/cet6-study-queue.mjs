import { decodeRatingEvidence } from './rating-evidence-codec.mjs';
import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { assertLearningProgressStore } from '../learning/learning-progress-store.mjs';
import { assertReviewRecordStore } from '../learning/review-record-store.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { createCet6StudyCardViewModel } from '../viewmodels/cet6-study-card-view-model.mjs';

export const CET6_STUDY_QUEUE_VERSION = '0.1';

export const StudyQueueReason = Object.freeze({
  NEW: 'NEW',
  RELEARNING: 'RELEARNING',
  REVIEW_DUE: 'REVIEW_DUE',
});

export function createCet6StudyQueue({
  learnerId,
  vocabularyStore,
  progressStore,
  reviewRecordStore,
  genericQueueBuilder,
  studyAdapter,
}) {
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  assertReviewRecordStore(reviewRecordStore);
  if (typeof genericQueueBuilder?.build !== 'function') throw new TypeError('genericQueueBuilder.build() required');
  const cardViewModel = createCet6StudyCardViewModel({
    vocabularyStore,
    progressStore,
    reviewRecordStore,
    studyAdapter,
  });

  function reasonFor(entryId, queueType, latestReviewByEntryId) {
    if (queueType === 'new') return StudyQueueReason.NEW;
    const latestRecord = latestReviewByEntryId.get(entryId);
    return latestRecord && decodeRatingEvidence(latestRecord) === 'again'
      ? StudyQueueReason.RELEARNING
      : StudyQueueReason.REVIEW_DUE;
  }

  function build({ now, plan }) {
    const generatedAt = requireCanonicalIsoDateTime(now, 'now');
    const day = generatedAt.slice(0, 10);
    const startedTodayIds = new Set(progressStore.listStates()
      .filter((state) => state.learningStartedAt?.slice(0, 10) === day)
      .map((state) => state.entryId));
    const recordsToday = reviewRecordStore.list().filter((record) => record.reviewedAt.slice(0, 10) === day);
    const reviewedTodayIds = new Set(recordsToday.map((record) => record.entryId));
    const completedReviewIds = new Set([...reviewedTodayIds].filter((entryId) => !startedTodayIds.has(entryId)));
    const completedTodayIds = new Set([...startedTodayIds, ...reviewedTodayIds]);
    const remainingNewLimit = Math.max(0, plan.dailyNewLimit - startedTodayIds.size);
    const remainingReviewLimit = Math.max(0, plan.dailyReviewLimit - completedReviewIds.size);
    const remainingTotalLimit = Math.max(0, plan.dailyTotalLimit - completedTodayIds.size);
    const candidatePlan = Object.freeze({
      ...plan,
      dailyNewLimit: plan.dailyNewLimit,
      dailyReviewLimit: vocabularyStore.count(),
      dailyTotalLimit: Math.max(1, vocabularyStore.count()),
    });
    const genericQueue = genericQueueBuilder.build({ now: generatedAt, plan: candidatePlan });
    const latestReviewByEntryId = new Map();
    for (const record of reviewRecordStore.list()) latestReviewByEntryId.set(record.entryId, record);
    const prepared = genericQueue.todayItems.map((item) => {
      const entryId = item.studyItem.authorityRef.entityId;
      const queueReason = reasonFor(entryId, item.queueType, latestReviewByEntryId);
      const progress = progressStore.get(entryId);
      return {
        learnerId: canonicalLearnerId,
        collectionId: item.studyItem.collectionId,
        itemId: item.studyItem.itemId,
        cardId: item.reviewCard.cardId,
        entryId,
        queueReason,
        dueAt: progress?.nextReviewAt ?? null,
        presentation: cardViewModel.load(entryId, { queueReason }),
      };
    });
    const reasonPriority = Object.freeze({
      [StudyQueueReason.RELEARNING]: 0,
      [StudyQueueReason.REVIEW_DUE]: 1,
      [StudyQueueReason.NEW]: 2,
    });
    const prioritized = prepared
      .map((item, stableIndex) => ({ item, stableIndex }))
      .sort((left, right) => reasonPriority[left.item.queueReason] - reasonPriority[right.item.queueReason]
        || left.stableIndex - right.stableIndex);
    let selectedNew = 0;
    let selectedReview = 0;
    let selectedOrdinary = 0;
    const selected = [];
    for (const candidate of prioritized) {
      const latestRecord = latestReviewByEntryId.get(candidate.item.entryId);
      const dueSameDayRelearning = candidate.item.queueReason === StudyQueueReason.RELEARNING
        && latestRecord?.reviewedAt.slice(0, 10) === day;
      if (dueSameDayRelearning) {
        selected.push(candidate);
        continue;
      }
      if (selectedOrdinary >= remainingTotalLimit) continue;
      if (candidate.item.queueReason === StudyQueueReason.NEW) {
        if (selectedNew >= remainingNewLimit) continue;
        selectedNew += 1;
      } else {
        if (selectedReview >= remainingReviewLimit) continue;
        selectedReview += 1;
      }
      selected.push(candidate);
      selectedOrdinary += 1;
    }
    const items = selected
      .map(({ item }, index, all) => ({ ...item, position: index + 1, total: all.length }));
    return deepFreeze({
      queueVersion: CET6_STUDY_QUEUE_VERSION,
      learnerId: canonicalLearnerId,
      collectionId: genericQueue.collectionId,
      generatedAt,
      plan,
      dailyProgress: Object.freeze({
        completed: completedTodayIds.size,
        newStarted: startedTodayIds.size,
        reviewsCompleted: completedReviewIds.size,
        remainingNewLimit,
        remainingReviewLimit,
        remainingTotalLimit,
      }),
      items,
      total: items.length,
      counts: Object.freeze({
        new: items.filter((item) => item.queueReason === StudyQueueReason.NEW).length,
        relearning: items.filter((item) => item.queueReason === StudyQueueReason.RELEARNING).length,
        reviewDue: items.filter((item) => item.queueReason === StudyQueueReason.REVIEW_DUE).length,
      }),
    });
  }

  return Object.freeze({ queueVersion: CET6_STUDY_QUEUE_VERSION, learnerId: canonicalLearnerId, build });
}
