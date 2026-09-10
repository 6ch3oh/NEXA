import { normalizeIdentifier, requireArray } from '../domain/shared.mjs';
import { createReviewRecord, validateReviewRecord } from '../domain/review-record.mjs';

export const REVIEW_RECORD_STORE_VERSION = '0.1';

export class ReviewRecordStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewRecordStoreError';
    this.code = code;
  }
}

export function assertReviewRecordStore(store) {
  if (store === null || typeof store !== 'object') {
    throw new ReviewRecordStoreError('INVALID_REVIEW_STORE', 'review record store object required');
  }
  for (const method of ['append', 'has', 'list', 'listByWord']) {
    if (typeof store[method] !== 'function') {
      throw new ReviewRecordStoreError('INVALID_REVIEW_STORE', `store.${method}() is required`);
    }
  }
  return store;
}

export function createInMemoryReviewRecordStore(initialRecords = []) {
  requireArray(initialRecords, 'initialRecords');
  const recordsById = new Map();

  function append(value) {
    validateReviewRecord(value);
    const record = createReviewRecord(value);
    if (recordsById.has(record.reviewId)) {
      throw new ReviewRecordStoreError('DUPLICATE_REVIEW_ID', `reviewId already exists: ${record.reviewId}`);
    }
    recordsById.set(record.reviewId, record);
    return record;
  }

  const store = Object.freeze({
    contractVersion: REVIEW_RECORD_STORE_VERSION,
    append,
    has(reviewId) {
      return recordsById.has(normalizeIdentifier(reviewId, 'reviewId'));
    },
    list() {
      return Object.freeze([...recordsById.values()]);
    },
    listByWord(entryId) {
      const canonicalId = normalizeIdentifier(entryId, 'entryId');
      return Object.freeze([...recordsById.values()].filter((record) => record.entryId === canonicalId));
    },
  });

  initialRecords.forEach(append);
  return assertReviewRecordStore(store);
}
