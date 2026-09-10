import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ImportErrorCode,
  ImportFormat,
  SearchMode,
  VOCABULARY_STORE_METHODS,
  VocabularyStoreError,
  assertImporterContract,
  assertVocabularyStore,
  createInMemoryVocabularyStore,
  createJsonVocabularyImporter,
  createVocabularyImporter,
  getVocabularyStatistics,
} from '../src/index.mjs';
import {
  DUPLICATE_IDENTITY_FIXTURE,
  INVALID_FIELD_FIXTURE,
  SYNTHETIC_FIXTURE_MARKER,
  SYNTHETIC_VOCABULARY_ENTRIES,
} from '../fixtures/synthetic-vocabulary.mjs';

test('fixture pack contains eight explicitly synthetic entries and required coverage', () => {
  assert.equal(SYNTHETIC_FIXTURE_MARKER, 'TEST / SYNTHETIC');
  assert.equal(SYNTHETIC_VOCABULARY_ENTRIES.length, 8);
  assert.ok(SYNTHETIC_VOCABULARY_ENTRIES.every((entry) => (
    entry.tags.includes('test')
    && entry.tags.includes('synthetic')
    && entry.sourceRefs.includes('test:synthetic-cet6-fixture')
  )));
  assert.ok(SYNTHETIC_VOCABULARY_ENTRIES.some((entry) => entry.headword.includes(' ')));
  assert.ok(SYNTHETIC_VOCABULARY_ENTRIES.some((entry) => entry.senses.length > 1));
  assert.ok(SYNTHETIC_VOCABULARY_ENTRIES.some((entry) => entry.senses.some((sense) => sense.examples.length > 0)));
});

test('store contract exposes the complete V0.1 method boundary', () => {
  const store = createInMemoryVocabularyStore();
  assert.equal(assertVocabularyStore(store), store);
  assert.ok(VOCABULARY_STORE_METHODS.every((method) => typeof store[method] === 'function'));
  assert.equal(store.count(), 0);
  assert.deepEqual(store.list(), []);
});

test('add, addMany and list preserve stable insertion order', () => {
  const store = createInMemoryVocabularyStore();
  store.add(SYNTHETIC_VOCABULARY_ENTRIES[2]);
  store.addMany([SYNTHETIC_VOCABULARY_ENTRIES[0], SYNTHETIC_VOCABULARY_ENTRIES[7]]);
  assert.equal(store.count(), 3);
  assert.deepEqual(store.list().map((entry) => entry.headword), ['allocate', 'abandon', 'robust']);
  assert.ok(Object.isFrozen(store.list()));
});

test('getById and getByWord use canonical case-insensitive identity', () => {
  const store = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  assert.equal(store.getById('CET6:TEST:ABANDON')?.headword, 'abandon');
  assert.equal(store.getByWord('  AbAnDoN  ')?.entryId, 'cet6:test:abandon');
  assert.equal(store.getByWord('BREAK   DOWN')?.entryId, 'cet6:test:break-down');
  assert.equal(store.getByWord(''), null);
  assert.equal(store.getByWord('missing'), null);
});

test('duplicate batches fail atomically by id or normalized headword', () => {
  const store = createInMemoryVocabularyStore([SYNTHETIC_VOCABULARY_ENTRIES[7]]);
  assert.throws(
    () => store.addMany([SYNTHETIC_VOCABULARY_ENTRIES[2], SYNTHETIC_VOCABULARY_ENTRIES[7]]),
    (error) => error instanceof VocabularyStoreError && error.code === 'DUPLICATE_ENTRY_ID',
  );
  assert.equal(store.count(), 1);
  assert.throws(
    () => createInMemoryVocabularyStore(DUPLICATE_IDENTITY_FIXTURE),
    (error) => error.code === 'DUPLICATE_HEADWORD',
  );
});

test('exact, prefix and normalized search are deterministic', () => {
  const store = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  assert.deepEqual(
    store.search('  ALLOCATE ', { mode: SearchMode.EXACT }).map((entry) => entry.headword),
    ['allocate'],
  );
  assert.deepEqual(
    store.search('ALLO', { mode: SearchMode.PREFIX }).map((entry) => entry.headword),
    ['allocate', 'allocation', 'allow'],
  );
  assert.deepEqual(
    store.search('LOC', { mode: SearchMode.NORMALIZED }).map((entry) => entry.headword),
    ['allocate', 'allocation'],
  );
  assert.deepEqual(store.search('', { mode: SearchMode.NORMALIZED }), []);
});

test('JSON validate accepts array or JSON text without writing', () => {
  const store = createInMemoryVocabularyStore();
  const importer = createJsonVocabularyImporter(store);
  assert.equal(assertImporterContract(importer), importer);
  assert.deepEqual(importer.validate(SYNTHETIC_VOCABULARY_ENTRIES), {
    ok: true,
    format: ImportFormat.JSON,
    entryCount: 8,
  });
  assert.equal(importer.validate(JSON.stringify(SYNTHETIC_VOCABULARY_ENTRIES)).ok, true);
  assert.equal(store.count(), 0);
});

test('preview returns canonical entries and never writes to store', () => {
  const store = createInMemoryVocabularyStore();
  const importer = createJsonVocabularyImporter(store);
  const preview = importer.preview(JSON.stringify(SYNTHETIC_VOCABULARY_ENTRIES));
  assert.equal(preview.ok, true);
  assert.equal(preview.entryCount, 8);
  assert.equal(preview.entries[0].normalizedHeadword, 'abandon');
  assert.ok(Object.isFrozen(preview));
  assert.equal(store.count(), 0);
});

test('import writes the complete validated collection', () => {
  const store = createInMemoryVocabularyStore();
  const result = createJsonVocabularyImporter(store).import(JSON.stringify(SYNTHETIC_VOCABULARY_ENTRIES));
  assert.equal(result.ok, true);
  assert.equal(result.importedCount, 8);
  assert.equal(result.entryIds.length, 8);
  assert.equal(store.count(), 8);
});

test('invalid JSON, root, fields and versions return stable failures', () => {
  const importer = createJsonVocabularyImporter(createInMemoryVocabularyStore());
  assert.equal(importer.validate('{').error.code, ImportErrorCode.INVALID_JSON);
  assert.equal(importer.validate('{}').error.code, ImportErrorCode.INVALID_IMPORT_ROOT);
  assert.equal(importer.validate([INVALID_FIELD_FIXTURE]).error.code, ImportErrorCode.INVALID_ENTRY);
  const invalidVersion = structuredClone(SYNTHETIC_VOCABULARY_ENTRIES[0]);
  invalidVersion.schemaVersion = '9.9';
  assert.equal(importer.validate([invalidVersion]).error.code, ImportErrorCode.UNSUPPORTED_VERSION);
});

test('duplicate identity is rejected before store mutation', () => {
  const store = createInMemoryVocabularyStore();
  const result = createJsonVocabularyImporter(store).import(DUPLICATE_IDENTITY_FIXTURE);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ImportErrorCode.DUPLICATE_IDENTITY);
  assert.equal(store.count(), 0);
});

test('duplicate identity against existing store is also atomic', () => {
  const store = createInMemoryVocabularyStore([SYNTHETIC_VOCABULARY_ENTRIES[0]]);
  const result = createJsonVocabularyImporter(store).import(SYNTHETIC_VOCABULARY_ENTRIES);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ImportErrorCode.DUPLICATE_IDENTITY);
  assert.equal(store.count(), 1);
});

test('all declared non-JSON formats return UNSUPPORTED_FORMAT', () => {
  const store = createInMemoryVocabularyStore();
  for (const format of Object.values(ImportFormat).filter((value) => value !== ImportFormat.JSON)) {
    const importer = createVocabularyImporter({ format, store });
    for (const method of ['validate', 'preview', 'import']) {
      const result = importer[method]('synthetic input');
      assert.equal(result.ok, false);
      assert.equal(result.error.code, ImportErrorCode.UNSUPPORTED_FORMAT);
      assert.equal(result.error.details.format, format);
    }
  }
});

test('statistics report real totals and explicit user-state defaults', () => {
  const store = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  assert.deepEqual(getVocabularyStatistics(store), {
    statisticsVersion: '0.1',
    totalWords: 8,
    favoriteCount: 0,
    unknownCount: 0,
    masteredCount: 0,
    userStateAvailable: false,
  });
});
