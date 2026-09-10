import { LearningStage } from '../domain/learner-progress.mjs';
import { deepFreeze } from '../domain/shared.mjs';
import { normalizeLearnerId } from '../identity/learner-identity.mjs';
import { assertLearningProgressStore } from '../learning/learning-progress-store.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';

export const PERSONAL_VOCABULARY_VIEW_MODEL_VERSION = '0.1';
export const PersonalVocabularyList = Object.freeze({
  ALL: 'all',
  FAVORITES: 'favorites',
  UNKNOWN: 'unknown',
  MASTERED: 'mastered',
  LEARNING: 'learning',
  DUE: 'due',
});

export const PersonalVocabularySort = Object.freeze({
  WORD_ASC: 'word-asc',
  WORD_DESC: 'word-desc',
  DUE_ASC: 'due-asc',
});

export function createPersonalVocabularyViewModel({ learnerId, vocabularyStore, progressStore }) {
  const canonicalLearnerId = normalizeLearnerId(learnerId, 'learnerId');
  assertVocabularyStore(vocabularyStore);
  assertLearningProgressStore(progressStore);

  function list(kind = PersonalVocabularyList.ALL, options = {}) {
    if (!Object.values(PersonalVocabularyList).includes(kind)) throw new TypeError(`unsupported personal list: ${kind}`);
    const query = typeof options.query === 'string' ? options.query.normalize('NFKC').trim().toLowerCase() : '';
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;
    const sort = options.sort ?? PersonalVocabularySort.WORD_ASC;
    if (!Number.isInteger(page) || page < 1) throw new TypeError('page must be a positive integer');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new TypeError('pageSize must be 1..200');
    if (!Object.values(PersonalVocabularySort).includes(sort)) throw new TypeError(`unsupported personal sort: ${sort}`);
    const now = options.now ?? null;
    if (kind === PersonalVocabularyList.DUE && (typeof now !== 'string' || Number.isNaN(new Date(now).getTime()) || new Date(now).toISOString() !== now)) {
      throw new TypeError('canonical now required for due list');
    }
    const statesByEntryId = new Map(progressStore.listStates().map((state) => [state.entryId, state]));
    const candidates = kind === PersonalVocabularyList.ALL
      ? vocabularyStore.list().map((entry) => ({ entry, state: statesByEntryId.get(entry.entryId) ?? null }))
      : progressStore.listStates().map((state) => ({ entry: vocabularyStore.getById(state.entryId), state }));
    const items = candidates
      .filter(({ state }) => kind === PersonalVocabularyList.ALL
        || (kind === PersonalVocabularyList.FAVORITES && state?.favorite)
        || (kind === PersonalVocabularyList.UNKNOWN && state.unknown)
        || (kind === PersonalVocabularyList.MASTERED && state.progress.stage === LearningStage.MASTERED)
        || (kind === PersonalVocabularyList.LEARNING && [LearningStage.LEARNING, LearningStage.REVIEWING].includes(state.progress.stage))
        || (kind === PersonalVocabularyList.DUE && [LearningStage.LEARNING, LearningStage.REVIEWING].includes(state.progress.stage)
          && state.progress.nextReviewAt !== null && state.progress.nextReviewAt <= now))
      .map(({ entry, state }) => {
        return entry === null ? null : {
          entryId: entry.entryId,
          word: entry.headword,
          primaryDefinition: entry.senses[0]?.definitionZh ?? null,
          learningState: state?.progress.stage ?? LearningStage.NEW,
          favorite: state?.favorite ?? false,
          unknown: state?.unknown ?? false,
          mastered: state?.progress.stage === LearningStage.MASTERED,
          dueAt: state?.progress.nextReviewAt ?? null,
        };
      })
      .filter(Boolean)
      .filter((item) => query === '' || item.word.toLowerCase().includes(query)
        || item.primaryDefinition?.toLowerCase().includes(query));
    const byWord = (left, right) => left.word.localeCompare(right.word, 'en') || left.entryId.localeCompare(right.entryId, 'en');
    const comparator = sort === PersonalVocabularySort.WORD_DESC
      ? (left, right) => -byWord(left, right)
      : sort === PersonalVocabularySort.DUE_ASC
        ? (left, right) => {
            if (left.dueAt === null && right.dueAt !== null) return 1;
            if (left.dueAt !== null && right.dueAt === null) return -1;
            return (left.dueAt ?? '').localeCompare(right.dueAt ?? '') || byWord(left, right);
          }
        : byWord;
    items.sort(comparator);
    const offset = (page - 1) * pageSize;
    const pagedItems = items.slice(offset, offset + pageSize);
    return deepFreeze({
      viewModelVersion: PERSONAL_VOCABULARY_VIEW_MODEL_VERSION,
      learnerId: canonicalLearnerId,
      kind,
      query,
      page,
      pageSize,
      sort,
      items: pagedItems,
      total: items.length,
      pageCount: Math.ceil(items.length / pageSize),
    });
  }

  return Object.freeze({ viewModelVersion: PERSONAL_VOCABULARY_VIEW_MODEL_VERSION, learnerId: canonicalLearnerId, list });
}
