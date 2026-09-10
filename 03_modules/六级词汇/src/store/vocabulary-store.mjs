import {
  Cet6ContractError,
  normalizeHeadword,
  normalizeIdentifier,
  requireArray,
} from '../domain/shared.mjs';
import {
  createVocabularyEntry,
  validateVocabularyCollection,
} from '../domain/vocabulary-entry.mjs';
import { SearchMode, searchVocabularyEntries } from '../search/search-contract.mjs';

export const VOCABULARY_STORE_CONTRACT_VERSION = '0.1';

export const VOCABULARY_STORE_METHODS = Object.freeze([
  'add', 'addMany', 'getById', 'getByWord', 'search', 'list', 'count',
]);

export class VocabularyStoreError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'VocabularyStoreError';
    this.code = code;
    this.details = details;
  }
}

export function assertVocabularyStore(store) {
  if (store === null || typeof store !== 'object') {
    throw new VocabularyStoreError('INVALID_STORE', 'vocabulary store object required');
  }
  for (const method of VOCABULARY_STORE_METHODS) {
    if (typeof store[method] !== 'function') {
      throw new VocabularyStoreError('INVALID_STORE', `store.${method}() is required`);
    }
  }
  return store;
}

function duplicateError(error) {
  if (!(error instanceof Cet6ContractError)) return error;
  if (error.code === 'DUPLICATE_ID') {
    return new VocabularyStoreError('DUPLICATE_ENTRY_ID', error.message);
  }
  if (error.code === 'DUPLICATE_HEADWORD') {
    return new VocabularyStoreError('DUPLICATE_HEADWORD', error.message);
  }
  return error;
}

export function createInMemoryVocabularyStore(initialEntries = []) {
  const byId = new Map();
  const idByHeadword = new Map();

  function prepareBatch(entries) {
    requireArray(entries, 'entries');
    const prepared = entries.map((entry) => createVocabularyEntry(entry));
    try {
      validateVocabularyCollection(prepared);
    } catch (error) {
      throw duplicateError(error);
    }
    for (const entry of prepared) {
      if (byId.has(entry.entryId)) {
        throw new VocabularyStoreError('DUPLICATE_ENTRY_ID', `entryId already exists: ${entry.entryId}`);
      }
      if (idByHeadword.has(entry.normalizedHeadword)) {
        throw new VocabularyStoreError(
          'DUPLICATE_HEADWORD',
          `normalized headword already exists: ${entry.normalizedHeadword}`,
        );
      }
    }
    return prepared;
  }

  function addMany(entries) {
    const prepared = prepareBatch(entries);
    for (const entry of prepared) {
      byId.set(entry.entryId, entry);
      idByHeadword.set(entry.normalizedHeadword, entry.entryId);
    }
    return Object.freeze([...prepared]);
  }

  function add(entry) {
    return addMany([entry])[0];
  }

  function getById(entryId) {
    const canonicalId = normalizeIdentifier(entryId, 'entryId');
    return byId.get(canonicalId) ?? null;
  }

  function getByWord(word) {
    if (typeof word === 'string' && word.trim() === '') return null;
    const normalized = normalizeHeadword(word, 'word');
    const entryId = idByHeadword.get(normalized);
    return entryId === undefined ? null : byId.get(entryId);
  }

  function list() {
    return Object.freeze([...byId.values()]);
  }

  function search(query, options = {}) {
    return searchVocabularyEntries(list(), {
      query,
      mode: options.mode ?? SearchMode.NORMALIZED,
      limit: options.limit ?? 50,
    });
  }

  const store = Object.freeze({
    contractVersion: VOCABULARY_STORE_CONTRACT_VERSION,
    add,
    addMany,
    getById,
    getByWord,
    search,
    list,
    count: () => byId.size,
  });

  assertVocabularyStore(store);
  if (initialEntries.length > 0) addMany(initialEntries);
  return store;
}
