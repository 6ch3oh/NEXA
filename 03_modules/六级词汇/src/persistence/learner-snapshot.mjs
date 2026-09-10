import {
  deepFreeze,
  normalizeIdentifier,
  requireArray,
  requireCanonicalIsoDateTime,
  requireCanonicalValue,
  requireExactKeys,
  requirePlainObject,
  requireRequiredKeys,
} from '../domain/shared.mjs';
import { validateLearnerProgress } from '../domain/learner-progress.mjs';
import { validateReviewRecord } from '../domain/review-record.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import {
  assertLearnerDataPartition,
  createLearnerDataPartition,
} from '../learning/learner-data-partition.mjs';

export const LEARNER_SNAPSHOT_SCHEMA_VERSION = '0.1';

const SNAPSHOT_KEYS = ['schemaVersion', 'createdAt', 'updatedAt', 'learners'];
const LEARNER_KEYS = ['learnerId', 'progress', 'metadata', 'reviewRecords'];
const METADATA_KEYS = ['entryId', 'favorite', 'unknown', 'learningStartedAt'];

export class SnapshotValidationError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'SnapshotValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined, cause = undefined) {
  throw new SnapshotValidationError(code, message, details, cause === undefined ? undefined : { cause });
}

function validateMetadata(value, path) {
  try {
    requireExactKeys(value, METADATA_KEYS, path);
    requireRequiredKeys(value, METADATA_KEYS, path);
    requireCanonicalValue(value.entryId, normalizeIdentifier(value.entryId, `${path}.entryId`), `${path}.entryId`);
    if (typeof value.favorite !== 'boolean') fail('INVALID_METADATA', `${path}.favorite must be boolean`);
    if (typeof value.unknown !== 'boolean') fail('INVALID_METADATA', `${path}.unknown must be boolean`);
    requireCanonicalIsoDateTime(value.learningStartedAt, `${path}.learningStartedAt`, { nullable: true });
  } catch (error) {
    if (error instanceof SnapshotValidationError) throw error;
    fail('INVALID_METADATA', error.message, { path }, error);
  }
}

function validateLearner(value, index, reviewIds) {
  const path = `snapshot.learners[${index}]`;
  try {
    requireExactKeys(value, LEARNER_KEYS, path);
    requireRequiredKeys(value, LEARNER_KEYS, path);
    requireArray(value.progress, `${path}.progress`);
    requireArray(value.metadata, `${path}.metadata`);
    requireArray(value.reviewRecords, `${path}.reviewRecords`);
  } catch (error) {
    fail('INVALID_SNAPSHOT', error.message, { path }, error);
  }

  let learnerId;
  try {
    learnerId = normalizeLearnerId(value.learnerId, `${path}.learnerId`);
    requireCanonicalValue(value.learnerId, learnerId, `${path}.learnerId`);
  } catch (error) {
    fail('INVALID_LEARNER_ID', error.message, { path: `${path}.learnerId` }, error);
  }

  const progressEntryIds = new Set();
  value.progress.forEach((progress, progressIndex) => {
    const progressPath = `${path}.progress[${progressIndex}]`;
    try {
      validateLearnerProgress(progress);
      if (progress.learnerId !== learnerId) {
        fail('LEARNER_MISMATCH', `${progressPath}.learnerId does not match ${learnerId}`);
      }
      if (progressEntryIds.has(progress.entryId)) {
        fail('DUPLICATE_PROGRESS', `duplicate progress entryId ${progress.entryId}`, { learnerId });
      }
      progressEntryIds.add(progress.entryId);
    } catch (error) {
      if (error instanceof SnapshotValidationError) throw error;
      fail('INVALID_PROGRESS', error.message, { path: progressPath }, error);
    }
  });

  const metadataEntryIds = new Set();
  value.metadata.forEach((metadata, metadataIndex) => {
    const metadataPath = `${path}.metadata[${metadataIndex}]`;
    validateMetadata(metadata, metadataPath);
    if (!progressEntryIds.has(metadata.entryId)) {
      fail('ORPHAN_METADATA', `metadata has no progress for ${metadata.entryId}`, { learnerId });
    }
    if (metadataEntryIds.has(metadata.entryId)) {
      fail('DUPLICATE_METADATA', `duplicate metadata entryId ${metadata.entryId}`, { learnerId });
    }
    metadataEntryIds.add(metadata.entryId);
  });

  value.reviewRecords.forEach((record, recordIndex) => {
    const recordPath = `${path}.reviewRecords[${recordIndex}]`;
    try {
      validateReviewRecord(record);
      if (record.learnerId !== learnerId) {
        fail('LEARNER_MISMATCH', `${recordPath}.learnerId does not match ${learnerId}`);
      }
      if (!progressEntryIds.has(record.entryId)) {
        fail('ORPHAN_REVIEW_RECORD', `review record has no progress for ${record.entryId}`, { learnerId });
      }
      if (reviewIds.has(record.reviewId)) {
        fail('DUPLICATE_REVIEW_RECORD', `duplicate reviewId ${record.reviewId}`);
      }
      reviewIds.add(record.reviewId);
    } catch (error) {
      if (error instanceof SnapshotValidationError) throw error;
      fail('INVALID_REVIEW_RECORD', error.message, { path: recordPath }, error);
    }
  });

  return learnerId;
}

export function validateLearnerSnapshot(snapshot) {
  try {
    requirePlainObject(snapshot, 'snapshot');
    requireExactKeys(snapshot, SNAPSHOT_KEYS, 'snapshot');
    requireRequiredKeys(snapshot, SNAPSHOT_KEYS, 'snapshot');
  } catch (error) {
    fail('INVALID_SNAPSHOT', error.message, undefined, error);
  }
  if (snapshot.schemaVersion !== LEARNER_SNAPSHOT_SCHEMA_VERSION) {
    fail(
      'UNSUPPORTED_SNAPSHOT_VERSION',
      `snapshot.schemaVersion must be ${LEARNER_SNAPSHOT_SCHEMA_VERSION}`,
      { actual: snapshot.schemaVersion },
    );
  }
  try {
    requireCanonicalIsoDateTime(snapshot.createdAt, 'snapshot.createdAt');
    requireCanonicalIsoDateTime(snapshot.updatedAt, 'snapshot.updatedAt');
    requireArray(snapshot.learners, 'snapshot.learners');
  } catch (error) {
    fail('INVALID_SNAPSHOT', error.message, undefined, error);
  }
  if (snapshot.updatedAt < snapshot.createdAt) {
    fail('INVALID_SNAPSHOT_TIME', 'snapshot.updatedAt must not be earlier than createdAt');
  }

  const learnerIds = new Set();
  const reviewIds = new Set();
  snapshot.learners.forEach((learner, index) => {
    const learnerId = validateLearner(learner, index, reviewIds);
    if (learnerIds.has(learnerId)) fail('DUPLICATE_LEARNER', `duplicate learnerId ${learnerId}`);
    learnerIds.add(learnerId);
  });
  return snapshot;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareBy(key) {
  return (left, right) => compareText(left[key], right[key]);
}

export function createLearnerSnapshot(partition, { createdAt, updatedAt = createdAt }) {
  assertLearnerDataPartition(partition);
  requireCanonicalIsoDateTime(createdAt, 'createdAt');
  requireCanonicalIsoDateTime(updatedAt, 'updatedAt');
  const learners = partition.listLearnerIds().map((learnerId) => {
    const progress = [...partition.listProgress(learnerId)].sort(compareBy('entryId'));
    const metadata = partition.listStates(learnerId)
      .map((state) => ({
        entryId: state.entryId,
        favorite: state.favorite,
        unknown: state.unknown,
        learningStartedAt: state.learningStartedAt,
      }))
      .sort(compareBy('entryId'));
    const reviewRecords = [...partition.listReviewRecords(learnerId)]
      .sort((left, right) => (
        compareText(left.reviewedAt, right.reviewedAt)
        || compareText(left.reviewId, right.reviewId)
      ));
    return { learnerId, progress, metadata, reviewRecords };
  });
  const snapshot = { schemaVersion: LEARNER_SNAPSHOT_SCHEMA_VERSION, createdAt, updatedAt, learners };
  validateLearnerSnapshot(snapshot);
  return deepFreeze(snapshot);
}

export function serializeLearnerSnapshot(snapshot) {
  validateLearnerSnapshot(snapshot);
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function parseLearnerSnapshot(input) {
  if (typeof input !== 'string') fail('INVALID_JSON', 'snapshot JSON input must be a string');
  let snapshot;
  try {
    snapshot = JSON.parse(input);
  } catch (error) {
    fail('INVALID_JSON', 'snapshot is not valid JSON', undefined, error);
  }
  validateLearnerSnapshot(snapshot);
  return deepFreeze(snapshot);
}

export function hydrateLearnerSnapshot(snapshot) {
  validateLearnerSnapshot(snapshot);
  const partition = createLearnerDataPartition();
  for (const learner of snapshot.learners) {
    const scoped = partition.openLearner(learner.learnerId);
    learner.progress.forEach((progress) => scoped.progressStore.upsert(progress));
    learner.metadata.forEach((metadata) => {
      scoped.progressStore.setFavorite(metadata.entryId, metadata.favorite);
      scoped.progressStore.setUnknown(metadata.entryId, metadata.unknown);
      scoped.progressStore.setLearningStartedAt(metadata.entryId, metadata.learningStartedAt);
    });
    learner.reviewRecords.forEach((record) => scoped.reviewRecordStore.append(record));
  }
  return partition;
}
