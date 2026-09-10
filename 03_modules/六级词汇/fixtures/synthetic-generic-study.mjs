import {
  CET6_STUDY_COLLECTION_ID,
  ReviewCardType,
  createCet6StudyCollection,
  createReviewCard,
  createVocabularyStudyAdapter,
} from '../src/index.mjs';
import { SYNTHETIC_TIMESTAMP, SYNTHETIC_VOCABULARY_ENTRIES } from './synthetic-vocabulary.mjs';

export const SYNTHETIC_GENERIC_STUDY_MARKER = 'TEST / SYNTHETIC';

export const SYNTHETIC_STUDY_COLLECTION = createCet6StudyCollection({
  createdAt: SYNTHETIC_TIMESTAMP,
});

export const SYNTHETIC_VOCABULARY_STUDY_ADAPTER = createVocabularyStudyAdapter({
  collectionId: CET6_STUDY_COLLECTION_ID,
});

export const SYNTHETIC_STUDY_PROJECTION = SYNTHETIC_VOCABULARY_STUDY_ADAPTER.adapt(
  SYNTHETIC_VOCABULARY_ENTRIES[0],
);

export const SYNTHETIC_SECOND_REVIEW_CARD = createReviewCard({
  cardId: `card-${SYNTHETIC_VOCABULARY_ENTRIES[0].entryId}-recall`,
  itemId: SYNTHETIC_STUDY_PROJECTION.studyItem.itemId,
  cardType: ReviewCardType.RECALL,
  promptRef: {
    authorityRef: SYNTHETIC_STUDY_PROJECTION.studyItem.authorityRef,
    selector: 'senses',
  },
  answerRef: {
    authorityRef: SYNTHETIC_STUDY_PROJECTION.studyItem.authorityRef,
    selector: 'headword',
  },
  enabled: true,
  createdAt: SYNTHETIC_TIMESTAMP,
});
