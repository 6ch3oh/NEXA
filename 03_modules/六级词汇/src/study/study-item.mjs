import {
  deepFreeze,
  normalizeUniqueStrings,
  requireCanonicalIsoDateTime,
  requireCanonicalStringArray,
  requireCanonicalValue,
  requireExactKeys,
  requireRequiredKeys,
} from '../domain/shared.mjs';
import {
  GENERIC_STUDY_CONTRACT_VERSION,
  assertStudyVersion,
  canonicalStudyIdentifier,
  canonicalStudyText,
  createAuthorityRef,
  studyFail,
  validateAuthorityRef,
} from './study-shared.mjs';

export const StudyContentType = Object.freeze({
  VOCABULARY: 'vocabulary',
  QUESTION_ANSWER: 'question_answer',
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  CLOZE: 'cloze',
  CONCEPT: 'concept',
  FORMULA: 'formula',
  IMAGE_PROMPT: 'image_prompt',
});

const ITEM_KEYS = [
  'schemaVersion', 'itemId', 'collectionId', 'contentType', 'source', 'tags',
  'authorityRef', 'createdAt', 'updatedAt',
];

export function createContentTypeRegistry(initialTypes = Object.values(StudyContentType)) {
  const types = new Set();
  const registry = {
    register(contentType) {
      const canonical = canonicalStudyIdentifier(contentType, 'contentType');
      if (types.has(canonical)) studyFail('DUPLICATE_CONTENT_TYPE', 'contentType', `${canonical} already registered`);
      types.add(canonical);
      return registry;
    },
    has(contentType) {
      return types.has(canonicalStudyIdentifier(contentType, 'contentType'));
    },
    list() {
      return Object.freeze([...types].sort());
    },
  };
  initialTypes.forEach((contentType) => registry.register(contentType));
  return Object.freeze(registry);
}

function requireContentType(value, path, registry) {
  const canonical = canonicalStudyIdentifier(value, path);
  if (!registry.has(canonical)) studyFail('UNREGISTERED_CONTENT_TYPE', path, `${canonical} is not registered`);
  return canonical;
}

export function validateStudyItem(value, { contentTypeRegistry = createContentTypeRegistry() } = {}) {
  requireExactKeys(value, ITEM_KEYS, 'studyItem');
  requireRequiredKeys(value, ITEM_KEYS, 'studyItem');
  assertStudyVersion(value.schemaVersion, 'studyItem.schemaVersion');
  requireCanonicalValue(value.itemId, canonicalStudyIdentifier(value.itemId, 'studyItem.itemId'), 'studyItem.itemId');
  requireCanonicalValue(value.collectionId, canonicalStudyIdentifier(value.collectionId, 'studyItem.collectionId'), 'studyItem.collectionId');
  requireContentType(value.contentType, 'studyItem.contentType', contentTypeRegistry);
  requireCanonicalValue(value.source, canonicalStudyText(value.source, 'studyItem.source', { max: 500 }), 'studyItem.source');
  const tags = normalizeUniqueStrings(value.tags, 'studyItem.tags', { maxItems: 50, maxLength: 64, lowercase: true });
  requireCanonicalStringArray(value.tags, tags, 'studyItem.tags');
  validateAuthorityRef(value.authorityRef, 'studyItem.authorityRef');
  requireCanonicalIsoDateTime(value.createdAt, 'studyItem.createdAt');
  requireCanonicalIsoDateTime(value.updatedAt, 'studyItem.updatedAt');
  if (value.updatedAt < value.createdAt) studyFail('INVALID_STUDY_TIME_ORDER', 'studyItem.updatedAt', 'must not be earlier than createdAt');
  return value;
}

export function createStudyItem(input, { contentTypeRegistry = createContentTypeRegistry() } = {}) {
  requireExactKeys(input, ITEM_KEYS, 'input');
  if (input.schemaVersion !== undefined) assertStudyVersion(input.schemaVersion, 'input.schemaVersion');
  const item = {
    schemaVersion: GENERIC_STUDY_CONTRACT_VERSION,
    itemId: canonicalStudyIdentifier(input.itemId, 'input.itemId'),
    collectionId: canonicalStudyIdentifier(input.collectionId, 'input.collectionId'),
    contentType: requireContentType(input.contentType, 'input.contentType', contentTypeRegistry),
    source: canonicalStudyText(input.source, 'input.source', { max: 500 }),
    tags: normalizeUniqueStrings(input.tags ?? [], 'input.tags', { maxItems: 50, maxLength: 64, lowercase: true }),
    authorityRef: createAuthorityRef(input.authorityRef, 'input.authorityRef'),
    createdAt: requireCanonicalIsoDateTime(input.createdAt, 'input.createdAt'),
    updatedAt: requireCanonicalIsoDateTime(input.updatedAt, 'input.updatedAt'),
  };
  validateStudyItem(item, { contentTypeRegistry });
  return deepFreeze(item);
}
