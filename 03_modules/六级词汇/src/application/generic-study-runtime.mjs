import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { assertLearnerDataPartition } from '../learning/learner-data-partition.mjs';
import { createCollectionStudyPlan } from '../study/study-plan.mjs';
import { getGenericStudyStatistics } from '../statistics/generic-study-statistics.mjs';
import { createGenericContentStudyQueue } from './generic-content-study-queue.mjs';
import { createGenericStudySession } from './generic-study-session.mjs';

export const GENERIC_STUDY_RUNTIME_VERSION = '0.1';

export function createGenericStudyRuntime({ learnerId, collection, catalog, adapter, partition, scheduler, clock }) {
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  assertLearnerDataPartition(partition);
  if (collection?.collectionId !== adapter?.collectionId) throw new TypeError('collection and adapter mismatch');
  const { progressStore, reviewRecordStore } = partition.openLearner(canonicalLearnerId);
  const queue = createGenericContentStudyQueue({
    learnerId: canonicalLearnerId, catalog, adapter, progressStore, reviewRecordStore,
  });
  const session = createGenericStudySession({
    learnerId: canonicalLearnerId, catalog, adapter, progressStore, reviewRecordStore, scheduler,
    ...(clock === undefined ? {} : { clock }),
  });
  const createPlan = (limits = {}) => createCollectionStudyPlan({ ...limits, collectionId: collection.collectionId });
  const getStatistics = ({ day, plan = createPlan() }) => getGenericStudyStatistics({
    catalog, adapter, learnerId: canonicalLearnerId, progressStore, reviewRecordStore, day, plan,
  });
  return Object.freeze({
    runtimeVersion: GENERIC_STUDY_RUNTIME_VERSION,
    learnerId: canonicalLearnerId,
    collection,
    catalog,
    adapter,
    progressStore,
    reviewRecordStore,
    queue,
    session,
    createPlan,
    getStatistics,
    home({ now, plan = createPlan() }) {
      const today = queue.build({ now, plan });
      return Object.freeze({
        runtimeVersion: GENERIC_STUDY_RUNTIME_VERSION,
        learnerId: canonicalLearnerId,
        collectionId: collection.collectionId,
        plan,
        today: Object.freeze({ total: today.total }),
        statistics: getStatistics({ day: now.slice(0, 10), plan }),
      });
    },
  });
}
