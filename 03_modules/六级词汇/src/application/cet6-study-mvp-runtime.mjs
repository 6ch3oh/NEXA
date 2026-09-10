import { CET6_STUDY_COLLECTION_ID, createVocabularyStudyAdapter } from '../adapters/vocabulary-study-adapter.mjs';
import { createGenericTodayStudyQueue } from '../adapters/generic-today-study-queue.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { assertLearnerDataPartition } from '../learning/learner-data-partition.mjs';
import { createReviewScheduler } from '../learning/review-scheduler.mjs';
import { createTodayQueueBuilder } from '../learning/today-queue.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { createCollectionStudyPlan } from '../study/study-plan.mjs';
import { getCet6StudyStatistics } from '../statistics/cet6-study-statistics.mjs';
import { createCet6StudyCardViewModel } from '../viewmodels/cet6-study-card-view-model.mjs';
import { createPersonalVocabularyViewModel } from '../viewmodels/personal-vocabulary-view-model.mjs';
import { createCet6StudyQueue } from './cet6-study-queue.mjs';
import { createCet6StudySession } from './cet6-study-session.mjs';

export const CET6_STUDY_MVP_RUNTIME_VERSION = '0.1';

export function createCet6StudyMvpRuntime({ learnerId, vocabularyStore, partition, clock, scheduler }) {
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  assertVocabularyStore(vocabularyStore);
  assertLearnerDataPartition(partition);
  const { progressStore, reviewRecordStore } = partition.openLearner(canonicalLearnerId);
  const legacyScheduler = createReviewScheduler();
  const legacyQueueBuilder = createTodayQueueBuilder({ vocabularyStore, progressStore, reviewScheduler: legacyScheduler });
  const studyAdapter = createVocabularyStudyAdapter({ collectionId: CET6_STUDY_COLLECTION_ID });
  const genericQueueBuilder = createGenericTodayStudyQueue({
    legacyQueueBuilder,
    vocabularyStore,
    progressStore,
    studyAdapter,
  });
  const queue = createCet6StudyQueue({
    learnerId: canonicalLearnerId,
    vocabularyStore,
    progressStore,
    reviewRecordStore,
    genericQueueBuilder,
    studyAdapter,
  });
  const session = createCet6StudySession({
    learnerId: canonicalLearnerId,
    vocabularyStore,
    progressStore,
    reviewRecordStore,
    ...(scheduler === undefined ? {} : { scheduler }),
    ...(clock === undefined ? {} : { clock }),
  });
  const card = createCet6StudyCardViewModel({ vocabularyStore, progressStore, reviewRecordStore, studyAdapter });
  const personalVocabulary = createPersonalVocabularyViewModel({
    learnerId: canonicalLearnerId,
    vocabularyStore,
    progressStore,
  });

  function createPlan(limits = {}) {
    return createCollectionStudyPlan({ ...limits, collectionId: CET6_STUDY_COLLECTION_ID });
  }

  function home({ now, plan = createPlan() }) {
    const todayQueue = queue.build({ now, plan });
    const statistics = getCet6StudyStatistics(vocabularyStore, {
      learnerId: canonicalLearnerId,
      progressStore,
      reviewRecordStore,
      day: now.slice(0, 10),
      dailyPlan: plan,
    });
    return Object.freeze({
      viewModelVersion: '0.1',
      learnerId: canonicalLearnerId,
      collectionId: CET6_STUDY_COLLECTION_ID,
      plan,
      today: Object.freeze({ total: todayQueue.total, counts: todayQueue.counts }),
      statistics,
    });
  }

  return Object.freeze({
    runtimeVersion: CET6_STUDY_MVP_RUNTIME_VERSION,
    learnerId: canonicalLearnerId,
    collectionId: CET6_STUDY_COLLECTION_ID,
    progressStore,
    reviewRecordStore,
    scheduler: scheduler ?? null,
    studyAdapter,
    createPlan,
    queue,
    session,
    card,
    personalVocabulary,
    home,
    getStatistics({ day, plan = createPlan() }) {
      return getCet6StudyStatistics(vocabularyStore, {
        learnerId: canonicalLearnerId,
        progressStore,
        reviewRecordStore,
        day,
        dailyPlan: plan,
      });
    },
  });
}
