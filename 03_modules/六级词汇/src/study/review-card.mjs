import {
  deepFreeze,
  requireCanonicalIsoDateTime,
  requireCanonicalValue,
  requireExactKeys,
  requireRequiredKeys,
} from '../domain/shared.mjs';
import {
  GENERIC_STUDY_CONTRACT_VERSION,
  assertStudyVersion,
  canonicalStudyIdentifier,
  createAuthorityRef,
  studyFail,
  validateAuthorityRef,
} from './study-shared.mjs';

export const ReviewCardType = Object.freeze({
  RECOGNITION: 'recognition',
  RECALL: 'recall',
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  CLOZE: 'cloze',
});

const CARD_REF_KEYS = ['authorityRef', 'selector'];
const CARD_KEYS = [
  'schemaVersion', 'cardId', 'itemId', 'cardType', 'promptRef', 'answerRef', 'enabled', 'createdAt',
];

function createCardRef(input, path) {
  requireExactKeys(input, CARD_REF_KEYS, path);
  requireRequiredKeys(input, CARD_REF_KEYS, path);
  return deepFreeze({
    authorityRef: createAuthorityRef(input.authorityRef, `${path}.authorityRef`),
    selector: canonicalStudyIdentifier(input.selector, `${path}.selector`),
  });
}

function validateCardRef(value, path) {
  requireExactKeys(value, CARD_REF_KEYS, path);
  requireRequiredKeys(value, CARD_REF_KEYS, path);
  validateAuthorityRef(value.authorityRef, `${path}.authorityRef`);
  requireCanonicalValue(value.selector, canonicalStudyIdentifier(value.selector, `${path}.selector`), `${path}.selector`);
}

function requireCardType(value, path) {
  const canonical = canonicalStudyIdentifier(value, path);
  if (!Object.values(ReviewCardType).includes(canonical)) {
    studyFail('INVALID_REVIEW_CARD_TYPE', path, `expected one of ${Object.values(ReviewCardType).join(', ')}`);
  }
  return canonical;
}

export function validateReviewCard(value) {
  requireExactKeys(value, CARD_KEYS, 'reviewCard');
  requireRequiredKeys(value, CARD_KEYS, 'reviewCard');
  assertStudyVersion(value.schemaVersion, 'reviewCard.schemaVersion');
  requireCanonicalValue(value.cardId, canonicalStudyIdentifier(value.cardId, 'reviewCard.cardId'), 'reviewCard.cardId');
  requireCanonicalValue(value.itemId, canonicalStudyIdentifier(value.itemId, 'reviewCard.itemId'), 'reviewCard.itemId');
  requireCardType(value.cardType, 'reviewCard.cardType');
  validateCardRef(value.promptRef, 'reviewCard.promptRef');
  validateCardRef(value.answerRef, 'reviewCard.answerRef');
  if (typeof value.enabled !== 'boolean') studyFail('INVALID_REVIEW_CARD_ENABLED', 'reviewCard.enabled', 'boolean required');
  requireCanonicalIsoDateTime(value.createdAt, 'reviewCard.createdAt');
  return value;
}

export function createReviewCard(input) {
  requireExactKeys(input, CARD_KEYS, 'input');
  if (input.schemaVersion !== undefined) assertStudyVersion(input.schemaVersion, 'input.schemaVersion');
  const card = {
    schemaVersion: GENERIC_STUDY_CONTRACT_VERSION,
    cardId: canonicalStudyIdentifier(input.cardId, 'input.cardId'),
    itemId: canonicalStudyIdentifier(input.itemId, 'input.itemId'),
    cardType: requireCardType(input.cardType, 'input.cardType'),
    promptRef: createCardRef(input.promptRef, 'input.promptRef'),
    answerRef: createCardRef(input.answerRef, 'input.answerRef'),
    enabled: input.enabled ?? true,
    createdAt: requireCanonicalIsoDateTime(input.createdAt, 'input.createdAt'),
  };
  validateReviewCard(card);
  return deepFreeze(card);
}

export function validateReviewCardCollection(cards) {
  if (!Array.isArray(cards)) studyFail('INVALID_REVIEW_CARD_COLLECTION', 'cards', 'array required');
  const cardIds = new Set();
  for (const card of cards) {
    validateReviewCard(card);
    if (cardIds.has(card.cardId)) studyFail('DUPLICATE_REVIEW_CARD', 'cards', `duplicate cardId ${card.cardId}`);
    cardIds.add(card.cardId);
  }
  return cards;
}
