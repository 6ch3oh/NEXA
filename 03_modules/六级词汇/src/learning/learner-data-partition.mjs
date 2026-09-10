import { LearningStage, validateLearnerProgress } from '../domain/learner-progress.mjs';
import { validateReviewRecord } from '../domain/review-record.mjs';
import { deepFreeze } from '../domain/shared.mjs';
import { DEFAULT_LOCAL_LEARNER_ID, normalizeLearnerId } from '../identity/learner-identity.mjs';
import { createInMemoryLearningProgressStore } from './learning-progress-store.mjs';
import { createInMemoryReviewRecordStore } from './review-record-store.mjs';

export const LEARNER_DATA_PARTITION_VERSION = '0.1';

export class LearnerPartitionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LearnerPartitionError';
    this.code = code;
    this.details = details;
  }
}

function assertLearnerMatch(expectedLearnerId, actualLearnerId, valueType) {
  const canonicalActual = normalizeLearnerId(actualLearnerId, `${valueType}.learnerId`);
  if (canonicalActual !== expectedLearnerId) {
    throw new LearnerPartitionError(
      'LEARNER_MISMATCH',
      `${valueType}.learnerId ${canonicalActual} does not match partition ${expectedLearnerId}`,
      { expectedLearnerId, actualLearnerId: canonicalActual },
    );
  }
}

export function assertLearnerDataPartition(partition) {
  if (partition === null || typeof partition !== 'object') {
    throw new LearnerPartitionError('INVALID_LEARNER_PARTITION', 'learner data partition object required');
  }
  for (const method of [
    'hasLearner', 'openLearner', 'listLearnerIds', 'getProgress', 'upsertProgress',
    'listProgress', 'listByStatus', 'getState', 'listStates', 'setFavorite',
    'setUnknown', 'setLearningStartedAt', 'appendReviewRecord', 'listReviewRecords',
  ]) {
    if (typeof partition[method] !== 'function') {
      throw new LearnerPartitionError('INVALID_LEARNER_PARTITION', `partition.${method}() is required`);
    }
  }
  return partition;
}

export function createLearnerDataPartition() {
  const partitions = new Map();

  function createScopedStores(learnerId) {
    const rawProgressStore = createInMemoryLearningProgressStore();
    const rawReviewRecordStore = createInMemoryReviewRecordStore();
    const progressStore = Object.freeze({
      contractVersion: rawProgressStore.contractVersion,
      get: rawProgressStore.get,
      list: rawProgressStore.list,
      listByStatus: rawProgressStore.listByStatus,
      getState: rawProgressStore.getState,
      listStates: rawProgressStore.listStates,
      setFavorite: rawProgressStore.setFavorite,
      setUnknown: rawProgressStore.setUnknown,
      setLearningStartedAt: rawProgressStore.setLearningStartedAt,
      upsert(progress) {
        validateLearnerProgress(progress);
        assertLearnerMatch(learnerId, progress.learnerId, 'progress');
        return rawProgressStore.upsert(progress);
      },
    });
    const reviewRecordStore = Object.freeze({
      contractVersion: rawReviewRecordStore.contractVersion,
      has: rawReviewRecordStore.has,
      list: rawReviewRecordStore.list,
      listByWord: rawReviewRecordStore.listByWord,
      append(record) {
        validateReviewRecord(record);
        assertLearnerMatch(learnerId, record.learnerId, 'reviewRecord');
        return rawReviewRecordStore.append(record);
      },
    });
    return deepFreeze({ learnerId, progressStore, reviewRecordStore });
  }

  function canonicalLearnerId(learnerId = DEFAULT_LOCAL_LEARNER_ID) {
    return normalizeLearnerId(learnerId, 'learnerId');
  }

  function openLearner(learnerId = DEFAULT_LOCAL_LEARNER_ID) {
    const canonicalId = canonicalLearnerId(learnerId);
    if (!partitions.has(canonicalId)) partitions.set(canonicalId, createScopedStores(canonicalId));
    return partitions.get(canonicalId);
  }

  function readLearner(learnerId) {
    return partitions.get(canonicalLearnerId(learnerId)) ?? null;
  }

  const partition = Object.freeze({
    contractVersion: LEARNER_DATA_PARTITION_VERSION,
    hasLearner(learnerId = DEFAULT_LOCAL_LEARNER_ID) {
      return partitions.has(canonicalLearnerId(learnerId));
    },
    openLearner,
    listLearnerIds() {
      return Object.freeze([...partitions.keys()].sort());
    },
    getProgress(learnerId, entryId) {
      return readLearner(learnerId)?.progressStore.get(entryId) ?? null;
    },
    upsertProgress(learnerId, progress) {
      return openLearner(learnerId).progressStore.upsert(progress);
    },
    listProgress(learnerId) {
      return readLearner(learnerId)?.progressStore.list() ?? Object.freeze([]);
    },
    listByStatus(learnerId, stage) {
      if (!Object.values(LearningStage).includes(stage)) {
        throw new LearnerPartitionError('INVALID_LEARNING_STAGE', `invalid learning stage: ${stage}`);
      }
      return readLearner(learnerId)?.progressStore.listByStatus(stage) ?? Object.freeze([]);
    },
    getState(learnerId, entryId) {
      return readLearner(learnerId)?.progressStore.getState(entryId) ?? null;
    },
    listStates(learnerId) {
      return readLearner(learnerId)?.progressStore.listStates() ?? Object.freeze([]);
    },
    setFavorite(learnerId, entryId, favorite) {
      return openLearner(learnerId).progressStore.setFavorite(entryId, favorite);
    },
    setUnknown(learnerId, entryId, unknown) {
      return openLearner(learnerId).progressStore.setUnknown(entryId, unknown);
    },
    setLearningStartedAt(learnerId, entryId, learningStartedAt) {
      return openLearner(learnerId).progressStore.setLearningStartedAt(entryId, learningStartedAt);
    },
    appendReviewRecord(learnerId, record) {
      return openLearner(learnerId).reviewRecordStore.append(record);
    },
    listReviewRecords(learnerId) {
      return readLearner(learnerId)?.reviewRecordStore.list() ?? Object.freeze([]);
    },
  });

  return assertLearnerDataPartition(partition);
}
