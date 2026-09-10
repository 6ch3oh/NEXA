import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { assertTodayQueueBuilder } from '../learning/today-queue.mjs';
import { assertLearningProgressStore } from '../learning/learning-progress-store.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { createStudyProgressView } from '../study/study-progress-view.mjs';
import { toLegacyTodayQueueConfig } from '../study/study-plan.mjs';
import { studyFail } from '../study/study-shared.mjs';

export const GENERIC_TODAY_STUDY_QUEUE_VERSION = '0.1';

export function createGenericTodayStudyQueue({ legacyQueueBuilder, vocabularyStore, progressStore, studyAdapter }) {
  assertTodayQueueBuilder(legacyQueueBuilder);
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  if (!studyAdapter || typeof studyAdapter.adapt !== 'function' || typeof studyAdapter.collectionId !== 'string') {
    throw new TypeError('studyAdapter with collectionId and adapt() required');
  }

  function build({ now, plan }) {
    const generatedAt = requireCanonicalIsoDateTime(now, 'now');
    if (!plan || plan.collectionId !== studyAdapter.collectionId) {
      studyFail('STUDY_PLAN_COLLECTION_MISMATCH', 'plan.collectionId', `must equal ${studyAdapter.collectionId}`);
    }
    const legacyQueue = legacyQueueBuilder.build({
      now: generatedAt,
      config: toLegacyTodayQueueConfig(plan),
    });
    const todayItems = legacyQueue.todayWords.map((queueWord) => {
      const entry = vocabularyStore.getById(queueWord.entryId);
      if (!entry) studyFail('MISSING_STUDY_AUTHORITY', 'queueWord.entryId', queueWord.entryId);
      const projection = studyAdapter.adapt(entry);
      const learnerProgress = progressStore.get(queueWord.entryId);
      return {
        studyItem: projection.studyItem,
        reviewCard: projection.reviewCards[0],
        presentation: projection.presentation,
        pronunciation: projection.pronunciation,
        progress: learnerProgress === null ? null : createStudyProgressView({
          itemId: projection.studyItem.itemId,
          learnerProgress,
        }),
        queueType: queueWord.queueType,
      };
    });
    return deepFreeze({
      queueVersion: GENERIC_TODAY_STUDY_QUEUE_VERSION,
      generatedAt,
      collectionId: plan.collectionId,
      plan,
      todayItems,
      newCount: legacyQueue.newCount,
      learningCount: legacyQueue.learningCount,
      reviewCount: legacyQueue.reviewCount,
      totalCount: legacyQueue.totalCount,
    });
  }

  return Object.freeze({ queueVersion: GENERIC_TODAY_STUDY_QUEUE_VERSION, build });
}
