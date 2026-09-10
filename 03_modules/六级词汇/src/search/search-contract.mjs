import {
  normalizeHeadword,
  requireArray,
  requireEnum,
  requireInteger,
  requirePlainObject,
} from '../domain/shared.mjs';
import { validateVocabularyEntry } from '../domain/vocabulary-entry.mjs';

export const VOCABULARY_SEARCH_CONTRACT_VERSION = '0.1';

export const SearchMode = Object.freeze({
  EXACT: 'exact',
  PREFIX: 'prefix',
  NORMALIZED: 'normalized',
});

export class VocabularySearchError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'VocabularySearchError';
    this.code = code;
  }
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeQueryText(value) {
  if (typeof value !== 'string') {
    throw new VocabularySearchError('INVALID_SEARCH_QUERY', 'search query must be a string');
  }
  if (value.trim() === '') return '';
  return normalizeHeadword(value, 'search.query');
}

export function createVocabularySearchQuery(input) {
  requirePlainObject(input, 'search');
  const mode = requireEnum(input.mode ?? SearchMode.NORMALIZED, SearchMode, 'search.mode');
  const limit = requireInteger(input.limit ?? 50, 'search.limit', { min: 1, max: 1_000 });
  return Object.freeze({
    contractVersion: VOCABULARY_SEARCH_CONTRACT_VERSION,
    query: input.query,
    normalizedQuery: normalizeQueryText(input.query),
    mode,
    limit,
  });
}

function matchRank(entry, query) {
  if (entry.normalizedHeadword === query) return 0;
  if (entry.normalizedHeadword.startsWith(query)) return 1;
  if (entry.normalizedHeadword.includes(query)) return 2;
  return Number.POSITIVE_INFINITY;
}

export function searchVocabularyEntries(entries, searchInput) {
  requireArray(entries, 'entries');
  entries.forEach(validateVocabularyEntry);
  const query = createVocabularySearchQuery(searchInput);
  if (query.normalizedQuery === '') return Object.freeze([]);

  const matches = entries
    .map((entry) => ({ entry, rank: matchRank(entry, query.normalizedQuery) }))
    .filter(({ rank }) => {
      if (query.mode === SearchMode.EXACT) return rank === 0;
      if (query.mode === SearchMode.PREFIX) return rank <= 1;
      return Number.isFinite(rank);
    })
    .sort((left, right) => (
      left.rank - right.rank
      || compareText(left.entry.normalizedHeadword, right.entry.normalizedHeadword)
      || compareText(left.entry.entryId, right.entry.entryId)
    ))
    .slice(0, query.limit)
    .map(({ entry }) => entry);

  return Object.freeze(matches);
}
