import {
  deepFreeze,
  normalizeIdentifier,
  requireArray,
  requireCanonicalIsoDateTime,
  requireEnum,
  requireExactKeys,
  requirePlainObject,
  requireRequiredKeys,
} from '../domain/shared.mjs';
import {
  LearningStage,
  createLearnerProgress,
  validateLearnerProgress,
} from '../domain/learner-progress.mjs';

export const LEARNING_PROGRESS_STORE_VERSION = '0.1';

export const LEARNING_PROGRESS_STORE_METHODS = Object.freeze([
  'get', 'upsert', 'list', 'listByStatus', 'getState', 'listStates',
  'setFavorite', 'setUnknown', 'setLearningStartedAt',
]);

const METADATA_KEYS = ['entryId', 'favorite', 'unknown', 'learningStartedAt'];

export class LearningProgressStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LearningProgressStoreError';
    this.code = code;
  }
}

function canonicalEntryId(value, path = 'entryId') {
  return normalizeIdentifier(value, path);
}

function normalizeMetadata(value, path) {
  requirePlainObject(value, path);
  requireExactKeys(value, METADATA_KEYS, path);
  requireRequiredKeys(value, METADATA_KEYS, path);
  if (typeof value.favorite !== 'boolean') throw new TypeError(`${path}.favorite: boolean required`);
  if (typeof value.unknown !== 'boolean') throw new TypeError(`${path}.unknown: boolean required`);
  return deepFreeze({
    entryId: canonicalEntryId(value.entryId, `${path}.entryId`),
    favorite: value.favorite,
    unknown: value.unknown,
    learningStartedAt: requireCanonicalIsoDateTime(
      value.learningStartedAt,
      `${path}.learningStartedAt`,
      { nullable: true },
    ),
  });
}

function defaultMetadata(entryId) {
  return deepFreeze({ entryId, favorite: false, unknown: false, learningStartedAt: null });
}

export function assertLearningProgressStore(store) {
  if (store === null || typeof store !== 'object') {
    throw new LearningProgressStoreError('INVALID_PROGRESS_STORE', 'learning progress store object required');
  }
  for (const method of LEARNING_PROGRESS_STORE_METHODS) {
    if (typeof store[method] !== 'function') {
      throw new LearningProgressStoreError('INVALID_PROGRESS_STORE', `store.${method}() is required`);
    }
  }
  return store;
}

export function createInMemoryLearningProgressStore({ progress = [], metadata = [] } = {}) {
  requireArray(progress, 'progress');
  requireArray(metadata, 'metadata');
  const progressByEntryId = new Map();
  const metadataByEntryId = new Map();

  function upsert(value) {
    validateLearnerProgress(value);
    const stored = createLearnerProgress(value);
    progressByEntryId.set(stored.entryId, stored);
    if (!metadataByEntryId.has(stored.entryId)) {
      metadataByEntryId.set(stored.entryId, defaultMetadata(stored.entryId));
    }
    return stored;
  }

  function get(entryId) {
    return progressByEntryId.get(canonicalEntryId(entryId)) ?? null;
  }

  function list() {
    return Object.freeze([...progressByEntryId.values()]);
  }

  function listByStatus(stage) {
    requireEnum(stage, LearningStage, 'stage');
    return Object.freeze(list().filter((item) => item.stage === stage));
  }

  function updateMetadata(entryId, changes) {
    const canonicalId = canonicalEntryId(entryId);
    if (!progressByEntryId.has(canonicalId)) {
      throw new LearningProgressStoreError('PROGRESS_NOT_FOUND', `learning progress not found: ${canonicalId}`);
    }
    const current = metadataByEntryId.get(canonicalId) ?? defaultMetadata(canonicalId);
    const updated = normalizeMetadata({ ...current, ...changes }, 'metadata');
    metadataByEntryId.set(canonicalId, updated);
    return updated;
  }

  function getState(entryId) {
    const canonicalId = canonicalEntryId(entryId);
    const storedProgress = progressByEntryId.get(canonicalId);
    if (!storedProgress) return null;
    const sidecar = metadataByEntryId.get(canonicalId) ?? defaultMetadata(canonicalId);
    return deepFreeze({ progress: storedProgress, ...sidecar });
  }

  function listStates() {
    return Object.freeze(list().map((item) => getState(item.entryId)));
  }

  const store = Object.freeze({
    contractVersion: LEARNING_PROGRESS_STORE_VERSION,
    get,
    upsert,
    list,
    listByStatus,
    getState,
    listStates,
    setFavorite(entryId, favorite) {
      if (typeof favorite !== 'boolean') throw new TypeError('favorite: boolean required');
      return updateMetadata(entryId, { favorite });
    },
    setUnknown(entryId, unknown) {
      if (typeof unknown !== 'boolean') throw new TypeError('unknown: boolean required');
      return updateMetadata(entryId, { unknown });
    },
    setLearningStartedAt(entryId, learningStartedAt) {
      requireCanonicalIsoDateTime(learningStartedAt, 'learningStartedAt', { nullable: true });
      return updateMetadata(entryId, { learningStartedAt });
    },
  });

  progress.forEach(upsert);
  metadata.forEach((value, index) => {
    const normalized = normalizeMetadata(value, `metadata[${index}]`);
    if (!progressByEntryId.has(normalized.entryId)) {
      throw new LearningProgressStoreError('ORPHAN_METADATA', `no progress for ${normalized.entryId}`);
    }
    metadataByEntryId.set(normalized.entryId, normalized);
  });
  return assertLearningProgressStore(store);
}
