import { deepFreeze } from '../domain/shared.mjs';
import { PartOfSpeech, validateVocabularyEntry } from '../domain/vocabulary-entry.mjs';
import { ReviewCardType, createReviewCard } from '../study/review-card.mjs';
import { StudyCollectionType, createStudyCollection } from '../study/study-collection.mjs';
import { StudyContentType, createStudyItem } from '../study/study-item.mjs';
import { createPronunciationSet } from './pronunciation-contract.mjs';

export const CET6_STUDY_ADAPTER_VERSION = '0.1';
export const CET6_STUDY_COLLECTION_ID = 'cet6-vocabulary';
export const CET6_VOCABULARY_AUTHORITY_TYPE = 'cet6-vocabulary-entry';

export function createCet6StudyCollection({
  createdAt,
  updatedAt = createdAt,
  collectionId = CET6_STUDY_COLLECTION_ID,
} = {}) {
  return createStudyCollection({
    collectionId,
    type: StudyCollectionType.VOCABULARY_COLLECTION,
    title: 'CET-6 Vocabulary',
    description: 'CET-6 vocabulary study collection projected from the existing VocabularyEntry domain.',
    source: 'nexa:cet6-vocabulary-domain',
    createdAt,
    updatedAt,
  });
}

export function createVocabularyStudyAdapter({ collectionId = CET6_STUDY_COLLECTION_ID } = {}) {
  function adapt(entry) {
    validateVocabularyEntry(entry);
    const authorityRef = Object.freeze({
      authorityType: CET6_VOCABULARY_AUTHORITY_TYPE,
      entityId: entry.entryId,
    });
    const itemId = `study-${entry.entryId}`;
    const studyItem = createStudyItem({
      itemId,
      collectionId,
      contentType: StudyContentType.VOCABULARY,
      source: entry.sourceRefs[0],
      tags: entry.tags,
      authorityRef,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
    const reviewCard = createReviewCard({
      cardId: `card-${entry.entryId}-recognition`,
      itemId,
      cardType: ReviewCardType.RECOGNITION,
      promptRef: { authorityRef, selector: 'headword' },
      answerRef: { authorityRef, selector: 'senses' },
      enabled: true,
      createdAt: entry.createdAt,
    });
    const pronunciation = createPronunciationSet({
      us: { phonetic: entry.pronunciations.ipaUs },
      uk: { phonetic: entry.pronunciations.ipaUk },
    });

    return deepFreeze({
      adapterVersion: CET6_STUDY_ADAPTER_VERSION,
      studyItem,
      reviewCards: [reviewCard],
      pronunciation,
      presentation: projectPresentation(entry),
    });
  }

  return Object.freeze({
    adapterVersion: CET6_STUDY_ADAPTER_VERSION,
    collectionId,
    authorityType: CET6_VOCABULARY_AUTHORITY_TYPE,
    adapt,
  });
}

function projectPresentation(entry) {
  const partsOfSpeech = [...new Set(entry.senses.map((sense) => sense.partOfSpeech))];
  return deepFreeze({
    word: entry.headword,
    phonetic: {
      us: entry.pronunciations.ipaUs,
      uk: entry.pronunciations.ipaUk,
    },
    partsOfSpeech,
    definitions: entry.senses.map((sense) => ({
      senseId: sense.senseId,
      partOfSpeech: sense.partOfSpeech,
      definitionZh: sense.definitionZh,
      definitionEn: sense.definitionEn,
    })),
    phrases: entry.senses
      .filter((sense) => sense.partOfSpeech === PartOfSpeech.PHRASE)
      .map((sense) => ({ senseId: sense.senseId, text: entry.headword, definitionZh: sense.definitionZh })),
    examples: entry.senses.flatMap((sense) => sense.examples.map((example) => ({
      senseId: sense.senseId,
      ...example,
    }))),
    synonyms: [...new Set(entry.senses.flatMap((sense) => sense.synonyms))],
    antonyms: [...new Set(entry.senses.flatMap((sense) => sense.antonyms))],
  });
}
