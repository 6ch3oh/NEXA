import { createPronunciationCapability } from '../application/pronunciation-playback.mjs';
import { LearningStage } from '../domain/learner-progress.mjs';
import { deepFreeze } from '../domain/shared.mjs';
import { assertLearningProgressStore } from '../learning/learning-progress-store.mjs';
import { assertReviewRecordStore } from '../learning/review-record-store.mjs';
import { decodeRatingEvidence } from '../application/rating-evidence-codec.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';

export const CET6_STUDY_CARD_VIEW_MODEL_VERSION = '0.1';

export function createCet6StudyCardViewModel({ vocabularyStore, progressStore, reviewRecordStore, studyAdapter }) {
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);
  assertReviewRecordStore(reviewRecordStore);
  if (typeof studyAdapter?.adapt !== 'function') throw new TypeError('studyAdapter.adapt() required');

  function load(entryId, { queueReason = null } = {}) {
    const entry = vocabularyStore.getById(entryId);
    if (!entry) return null;
    const projection = studyAdapter.adapt(entry);
    const state = progressStore.getState(entry.entryId);
    const progress = state?.progress ?? null;
    const records = reviewRecordStore.listByWord(entry.entryId);
    const latestRecord = records.at(-1) ?? null;
    return deepFreeze({
      viewModelVersion: CET6_STUDY_CARD_VIEW_MODEL_VERSION,
      collectionId: projection.studyItem.collectionId,
      itemId: projection.studyItem.itemId,
      cardId: projection.reviewCards[0].cardId,
      entryId: entry.entryId,
      word: projection.presentation.word,
      usPhonetic: projection.presentation.phonetic.us,
      ukPhonetic: projection.presentation.phonetic.uk,
      pronunciations: {
        us: createPronunciationCapability(projection.pronunciation, 'us'),
        uk: createPronunciationCapability(projection.pronunciation, 'uk'),
      },
      defaultAccent: projection.pronunciation.defaultAccent,
      partsOfSpeech: projection.presentation.partsOfSpeech,
      definitions: projection.presentation.definitions,
      phrases: projection.presentation.phrases,
      examples: projection.presentation.examples,
      synonyms: projection.presentation.synonyms,
      antonyms: projection.presentation.antonyms,
      definitionVisibleByDefault: true,
      learningState: progress?.stage ?? LearningStage.NEW,
      favorite: state?.favorite ?? false,
      unknown: state?.unknown ?? false,
      mastered: progress?.stage === LearningStage.MASTERED,
      queueReason,
      dueAt: progress?.nextReviewAt ?? null,
      lastReviewedAt: progress?.lastReviewedAt ?? null,
      latestRating: latestRecord === null ? null : decodeRatingEvidence(latestRecord),
      relearning: Object.freeze({
        active: latestRecord !== null && decodeRatingEvidence(latestRecord) === 'again'
          && progress?.nextReviewAt !== null,
        dueAt: latestRecord !== null && decodeRatingEvidence(latestRecord) === 'again'
          ? progress?.nextReviewAt ?? null : null,
      }),
    });
  }

  return Object.freeze({ viewModelVersion: CET6_STUDY_CARD_VIEW_MODEL_VERSION, load });
}
