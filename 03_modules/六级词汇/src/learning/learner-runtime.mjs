import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { getLearningStatistics } from '../statistics/vocabulary-statistics.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { assertLearnerDataPartition } from './learner-data-partition.mjs';
import { createLearningProgressService } from './learning-progress-service.mjs';
import { createReviewScheduler } from './review-scheduler.mjs';
import { createTodayQueueBuilder } from './today-queue.mjs';
import { createTodayVocabularyViewModel } from '../viewmodels/today-vocabulary-view-model.mjs';

export const LEARNER_RUNTIME_VERSION = '0.1';

export function createLearnerRuntime({
  learnerId,
  vocabularyStore,
  partition,
  reviewScheduler = createReviewScheduler(),
  clock,
}) {
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  assertVocabularyStore(vocabularyStore);
  assertLearnerDataPartition(partition);
  const { progressStore, reviewRecordStore } = partition.openLearner(canonicalLearnerId);
  const progressService = createLearningProgressService({
    learnerId: canonicalLearnerId,
    vocabularyStore,
    progressStore,
    reviewRecordStore,
    reviewScheduler,
    ...(clock === undefined ? {} : { clock }),
  });
  const queueBuilder = createTodayQueueBuilder({ vocabularyStore, progressStore, reviewScheduler });
  const viewModel = createTodayVocabularyViewModel({
    vocabularyStore,
    progressStore,
    reviewRecordStore,
    queueBuilder,
  });

  return Object.freeze({
    runtimeVersion: LEARNER_RUNTIME_VERSION,
    learnerId: canonicalLearnerId,
    progressStore,
    reviewRecordStore,
    progressService,
    reviewScheduler,
    queueBuilder,
    viewModel,
    getStatistics({ day }) {
      return getLearningStatistics(vocabularyStore, { progressStore, reviewRecordStore, day });
    },
  });
}
