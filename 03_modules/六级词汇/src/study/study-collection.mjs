import {
  deepFreeze,
  requireCanonicalIsoDateTime,
  requireCanonicalValue,
  requireExactKeys,
  requireNullableString,
  requireRequiredKeys,
} from '../domain/shared.mjs';
import {
  GENERIC_STUDY_CONTRACT_VERSION,
  assertStudyVersion,
  canonicalStudyIdentifier,
  canonicalStudyText,
  studyFail,
} from './study-shared.mjs';

export const StudyCollectionType = Object.freeze({
  VOCABULARY_COLLECTION: 'vocabulary_collection',
  QUESTION_BANK: 'question_bank',
  KNOWLEDGE_COLLECTION: 'knowledge_collection',
});

const COLLECTION_KEYS = [
  'schemaVersion', 'collectionId', 'type', 'title', 'description', 'source', 'createdAt', 'updatedAt',
];

function requireCollectionType(value, path) {
  if (!Object.values(StudyCollectionType).includes(value)) {
    studyFail('INVALID_COLLECTION_TYPE', path, `expected one of ${Object.values(StudyCollectionType).join(', ')}`);
  }
  return value;
}

export function validateStudyCollection(value) {
  requireExactKeys(value, COLLECTION_KEYS, 'studyCollection');
  requireRequiredKeys(value, COLLECTION_KEYS, 'studyCollection');
  assertStudyVersion(value.schemaVersion, 'studyCollection.schemaVersion');
  requireCanonicalValue(value.collectionId, canonicalStudyIdentifier(value.collectionId, 'studyCollection.collectionId'), 'studyCollection.collectionId');
  requireCollectionType(value.type, 'studyCollection.type');
  requireCanonicalValue(value.title, canonicalStudyText(value.title, 'studyCollection.title', { max: 160 }), 'studyCollection.title');
  requireCanonicalValue(value.description, requireNullableString(value.description, 'studyCollection.description', { max: 1_000 }), 'studyCollection.description');
  requireCanonicalValue(value.source, canonicalStudyText(value.source, 'studyCollection.source', { max: 500 }), 'studyCollection.source');
  requireCanonicalIsoDateTime(value.createdAt, 'studyCollection.createdAt');
  requireCanonicalIsoDateTime(value.updatedAt, 'studyCollection.updatedAt');
  if (value.updatedAt < value.createdAt) studyFail('INVALID_STUDY_TIME_ORDER', 'studyCollection.updatedAt', 'must not be earlier than createdAt');
  return value;
}

export function createStudyCollection(input) {
  requireExactKeys(input, COLLECTION_KEYS, 'input');
  if (input.schemaVersion !== undefined) assertStudyVersion(input.schemaVersion, 'input.schemaVersion');
  const collection = {
    schemaVersion: GENERIC_STUDY_CONTRACT_VERSION,
    collectionId: canonicalStudyIdentifier(input.collectionId, 'input.collectionId'),
    type: requireCollectionType(input.type, 'input.type'),
    title: canonicalStudyText(input.title, 'input.title', { max: 160 }),
    description: requireNullableString(input.description ?? null, 'input.description', { max: 1_000 }),
    source: canonicalStudyText(input.source, 'input.source', { max: 500 }),
    createdAt: requireCanonicalIsoDateTime(input.createdAt, 'input.createdAt'),
    updatedAt: requireCanonicalIsoDateTime(input.updatedAt, 'input.updatedAt'),
  };
  validateStudyCollection(collection);
  return deepFreeze(collection);
}
