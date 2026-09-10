import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LibraryRestorePointError,
  LibraryRestoreReason,
  VocabularySourceClassification,
  calculateVocabularyContentDigest,
  calculateVocabularyLibraryHash,
  createInMemoryVocabularyStore,
  createLearnerSnapshot,
  createLocalVocabularyLibrary,
  createLocalVocabularyLibraryRestorePointManager,
  createVocabularyEntry,
  createVocabularyImportWorkflow,
  createVocabularyStudyAdapter,
} from '../src/index.mjs';
import { createSyntheticLearnerPartition } from '../fixtures/synthetic-learners.mjs';
import { SYNTHETIC_TIMESTAMP, SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SNAPSHOT_AT = '2026-08-22T00:00:00.000Z';

function sentinelEntry(suffix = 'default') {
  const headwordSuffix = suffix.replace(/[^a-z]+/gu, ' ').trim();
  return createVocabularyEntry({
    entryId: `cet6:test:rollback-sentinel-${suffix}`,
    headword: `rollback sentinel ${headwordSuffix}`,
    pronunciations: {},
    senses: [{
      senseId: `rollback-sentinel-${suffix}:noun:1`,
      partOfSpeech: 'noun',
      definitionZh: '测试释义：回滚哨兵',
      definitionEn: null,
      examples: [],
      synonyms: [],
      antonyms: [],
    }],
    tags: ['test', 'synthetic', 'rollback'],
    sourceRefs: ['test:library-restore-rollback'],
    createdAt: SYNTHETIC_TIMESTAMP,
    updatedAt: SYNTHETIC_TIMESTAMP,
  });
}

function initialImports(entries) {
  const digest = calculateVocabularyContentDigest(entries);
  return [{
    manifest: {
      packageId: 'base-synthetic-library',
      packageVersion: '0.1',
      contentDigest: digest,
      provenance: { sourceId: 'base-synthetic', classification: VocabularySourceClassification.SYNTHETIC },
    },
    receipt: { receiptId: 'receipt-base-synthetic-library' },
  }];
}

function clock() {
  let tick = 0;
  return () => new Date(Date.parse(SNAPSHOT_AT) + tick++ * 1_000).toISOString();
}

function previewSentinel(workflow, suffix = 'default') {
  return workflow.preview({
    input: JSON.stringify([sentinelEntry(suffix)]),
    source: {
      sourceId: `rollback-test-${suffix}`,
      packageId: `rollback-test-${suffix}`,
      packageVersion: '0.1',
      title: 'TEST / SYNTHETIC rollback package',
      classification: VocabularySourceClassification.SYNTHETIC,
      notes: 'TEST / SYNTHETIC; local rollback verification only.',
    },
  });
}

async function context(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'nexa-library-rollback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'vocabulary-library.json');
  const entries = options.entries ?? SYNTHETIC_VOCABULARY_ENTRIES.slice(0, 2);
  const imports = options.imports ?? initialImports(entries);
  const persistedLibrary = createLocalVocabularyLibrary({ filePath });
  await persistedLibrary.save({ entries, imports });
  const library = options.wrapLibrary?.(persistedLibrary) ?? persistedLibrary;
  const store = createInMemoryVocabularyStore(entries);
  const manager = createLocalVocabularyLibraryRestorePointManager({
    directoryPath: join(directory, 'library-restore-points'),
    library,
    maxRestorePoints: options.maxRestorePoints ?? 5,
  });
  const workflow = createVocabularyImportWorkflow({
    store,
    clock: clock(),
    library,
    restorePointManager: options.restorePointManager ?? manager,
    postImportValidate: options.postImportValidate,
  });
  workflow.restoreImports(imports);
  return { directory, filePath, persistedLibrary, library, entries, imports, store, manager, workflow };
}

test('library restore point records stable identity, source/receipt identity and SHA-256 integrity', async (t) => {
  const { manager } = await context(t);
  const created = await manager.createRestorePoint({
    restorePointId: 'library-restore:manual:1',
    createdAt: SNAPSHOT_AT,
    reason: LibraryRestoreReason.MANUAL_SAFE_POINT,
  });
  assert.equal(created.restorePoint.itemCount, 2);
  assert.equal(created.restorePoint.libraryIdentity, 'cet6-vocabulary-library');
  assert.equal(created.restorePoint.collectionId, 'cet6-vocabulary');
  assert.equal(created.restorePoint.sourceManifestIdentity.packageId, 'base-synthetic-library');
  assert.equal(created.restorePoint.importReceiptIdentity, 'receipt-base-synthetic-library');
  assert.match(created.restorePoint.contentHash, /^[a-f0-9]{64}$/u);
  const listed = await manager.listRestorePoints();
  assert.equal(listed[0].contentHash, created.restorePoint.contentHash);
  const inspected = await manager.inspectRestorePoint(created.restorePoint.restorePointId);
  assert.equal(calculateVocabularyLibraryHash(inspected.librarySnapshot), inspected.contentHash);
});

test('library restore point fails closed when persisted integrity is tampered', async (t) => {
  const { manager } = await context(t);
  const created = await manager.createRestorePoint({
    restorePointId: 'library-restore:manual:tamper',
    createdAt: SNAPSHOT_AT,
    reason: LibraryRestoreReason.MANUAL_SAFE_POINT,
  });
  const path = manager.getRestorePointPath(created.restorePoint.restorePointId);
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.itemCount += 1;
  await writeFile(path, JSON.stringify(record), 'utf8');
  await assert.rejects(
    manager.inspectRestorePoint(created.restorePoint.restorePointId),
    (error) => error instanceof LibraryRestorePointError && error.code === 'INVALID_LIBRARY_RESTORE_POINT',
  );
});

test('library restore point retention keeps the newest five independently from learner restore points', async (t) => {
  const { manager } = await context(t);
  for (let index = 0; index < 6; index += 1) {
    const result = await manager.createRestorePoint({
      restorePointId: `library-restore:manual:${index}`,
      createdAt: new Date(Date.parse(SNAPSHOT_AT) + index * 1_000).toISOString(),
      reason: LibraryRestoreReason.MANUAL_SAFE_POINT,
    });
    if (index === 5) assert.deepEqual(result.prunedRestorePointIds, ['library-restore:manual:0']);
  }
  assert.deepEqual((await manager.listRestorePoints()).map((point) => point.restorePointId), [
    'library-restore:manual:1', 'library-restore:manual:2', 'library-restore:manual:3',
    'library-restore:manual:4', 'library-restore:manual:5',
  ]);
});

test('protected import creates PRE_IMPORT point, commits verified library and marks receipt rollback-capable', async (t) => {
  const { workflow, store, persistedLibrary, manager } = await context(t);
  const preview = previewSentinel(workflow, 'success');
  assert.equal(preview.ok, true);
  const result = await workflow.confirm(preview.previewId);
  assert.equal(result.ok, true);
  assert.equal(result.rollbackSupported, true);
  assert.equal(result.receipt.rollbackSupported, true);
  assert.equal(result.receipt.safetyBoundary, 'PRE_IMPORT_RESTORE_POINT_AND_ATOMIC_COMMIT');
  assert.equal(result.receipt.preImportRestorePointId, result.preImportRestorePointId);
  assert.equal(store.count(), 3);
  assert.equal((await persistedLibrary.load()).entries.length, 3);
  const point = await manager.inspectRestorePoint(result.preImportRestorePointId);
  assert.equal(point.reason, LibraryRestoreReason.PRE_IMPORT);
  assert.equal(point.itemCount, 2);
});

test('import persistence failure automatically restores the pre-import library without mutating Store', async (t) => {
  let failNextSave = true;
  const { workflow, store, persistedLibrary } = await context(t, {
    wrapLibrary: (library) => ({
      ...library,
      async save(snapshot) {
        if (failNextSave) {
          failNextSave = false;
          throw Object.assign(new Error('injected persistence failure'), { code: 'INJECTED_PERSISTENCE_FAILURE' });
        }
        return library.save(snapshot);
      },
    }),
  });
  const before = await persistedLibrary.load();
  const preview = previewSentinel(workflow, 'persistence-failure');
  const result = await workflow.confirm(preview.previewId);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'IMPORT_ROLLED_BACK');
  assert.equal(result.error.details.causeCode, 'INJECTED_PERSISTENCE_FAILURE');
  assert.equal(store.count(), 2);
  assert.equal(calculateVocabularyLibraryHash(await persistedLibrary.load()), calculateVocabularyLibraryHash(before));
  assert.equal(workflow.listImports().length, 1);
});

test('post-import integrity failure rolls persisted candidate back and preserves learner/review/mastered state', async (t) => {
  const partition = createSyntheticLearnerPartition();
  const learnerBefore = createLearnerSnapshot(partition, { createdAt: SNAPSHOT_AT });
  const { workflow, store, persistedLibrary } = await context(t, {
    postImportValidate: async () => {
      throw Object.assign(new Error('injected post-import integrity failure'), { code: 'INJECTED_POST_IMPORT_VALIDATION_FAILURE' });
    },
  });
  const libraryBefore = await persistedLibrary.load();
  const result = await workflow.confirm(previewSentinel(workflow, 'post-validation').previewId);
  assert.equal(result.error.code, 'IMPORT_ROLLED_BACK');
  assert.equal(result.error.details.causeCode, 'INJECTED_POST_IMPORT_VALIDATION_FAILURE');
  assert.equal(store.count(), 2);
  assert.equal(calculateVocabularyLibraryHash(await persistedLibrary.load()), calculateVocabularyLibraryHash(libraryBefore));
  const learnerAfter = createLearnerSnapshot(partition, { createdAt: SNAPSHOT_AT });
  assert.deepEqual(learnerAfter, learnerBefore);
  const learnerA = learnerAfter.learners.find((learner) => learner.learnerId === 'learner:a');
  assert.equal(learnerA.progress.some((progress) => progress.stage === 'mastered'), true);
  assert.equal(learnerAfter.learners.flatMap((learner) => learner.reviewRecords).length, 2);
});

test('reload integrity mismatch automatically rolls back the candidate library', async (t) => {
  let corruptNextLoad = false;
  const { workflow, store, persistedLibrary } = await context(t, {
    wrapLibrary: (library) => ({
      ...library,
      async save(snapshot) {
        const result = await library.save(snapshot);
        if (snapshot.entries.length === 3) corruptNextLoad = true;
        return result;
      },
      async load() {
        const loaded = await library.load();
        if (!corruptNextLoad) return loaded;
        corruptNextLoad = false;
        return { ...loaded, entries: loaded.entries.slice(0, -1) };
      },
    }),
  });
  const before = await persistedLibrary.load();
  const result = await workflow.confirm(previewSentinel(workflow, 'reload-integrity').previewId);
  assert.equal(result.error.code, 'IMPORT_ROLLED_BACK');
  assert.equal(result.error.details.causeCode, 'POST_IMPORT_LIBRARY_HASH_MISMATCH');
  assert.equal(store.count(), 2);
  assert.equal(calculateVocabularyLibraryHash(await persistedLibrary.load()), calculateVocabularyLibraryHash(before));
});

test('missing rollback point fails closed and never reports IMPORT_ROLLED_BACK', async (t) => {
  const brokenManager = {
    async withTransaction(operation) {
      return operation({
        createRestorePoint: async () => ({ restorePoint: { restorePointId: 'missing' } }),
        restoreLibraryRestorePoint: async () => {
          throw Object.assign(new Error('restore point missing'), { code: 'LIBRARY_RESTORE_POINT_NOT_FOUND' });
        },
      });
    },
  };
  const { workflow, store } = await context(t, {
    restorePointManager: brokenManager,
    postImportValidate: async () => { throw Object.assign(new Error('validation failed'), { code: 'VALIDATION_FAILED' }); },
  });
  const result = await workflow.confirm(previewSentinel(workflow, 'missing-point').previewId);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'IMPORT_ROLLBACK_FAILED');
  assert.equal(result.error.details.rollbackCauseCode, 'LIBRARY_RESTORE_POINT_NOT_FOUND');
  assert.equal(store.count(), 2);
});

test('manual library restore is public, verified, and explicitly requires runtime restart', async (t) => {
  const { manager, persistedLibrary, workflow } = await context(t);
  const created = await manager.createRestorePoint({
    restorePointId: 'library-restore:manual:public',
    createdAt: SNAPSHOT_AT,
    reason: LibraryRestoreReason.MANUAL_SAFE_POINT,
  });
  assert.equal(typeof workflow.listLibraryRestorePoints, 'function');
  assert.equal(typeof workflow.inspectLibraryRestorePoint, 'function');
  assert.equal(typeof workflow.restoreLibraryRestorePoint, 'function');
  assert.equal((await workflow.listLibraryRestorePoints()).length, 1);
  assert.equal((await workflow.inspectLibraryRestorePoint(created.restorePoint.restorePointId)).itemCount, 2);
  await persistedLibrary.save({ entries: [...SYNTHETIC_VOCABULARY_ENTRIES.slice(0, 2), sentinelEntry('manual')], imports: initialImports(SYNTHETIC_VOCABULARY_ENTRIES.slice(0, 2)) });
  const restored = await workflow.restoreLibraryRestorePoint(created.restorePoint.restorePointId);
  assert.equal(restored.restored, true);
  assert.equal(restored.restartRequired, true);
  assert.equal(restored.library.entries.length, 2);
  assert.equal(restored.restorePoint.contentHash, created.restorePoint.contentHash);
});

test('real 5311 collection survives isolated controlled import rollback with all identities and learner history intact', async (t) => {
  const sourcePath = join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'vocabulary-library.json');
  const source = await createLocalVocabularyLibrary({ filePath: sourcePath }).load();
  assert.equal(source.entries.length, 5_311);
  const directory = await mkdtemp(join(tmpdir(), 'nexa-5311-library-rollback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'vocabulary-library.json');
  const library = createLocalVocabularyLibrary({ filePath });
  await library.save(source);
  const rawBefore = await readFile(filePath);
  const canonicalHashBefore = calculateVocabularyLibraryHash(source);
  const store = createInMemoryVocabularyStore(source.entries);
  const manager = createLocalVocabularyLibraryRestorePointManager({ directoryPath: join(directory, 'restore-points'), library });
  const workflow = createVocabularyImportWorkflow({
    store,
    clock: clock(),
    library,
    restorePointManager: manager,
    postImportValidate: async () => {
      throw Object.assign(new Error('controlled 5311 rollback'), { code: 'CONTROLLED_5311_ROLLBACK' });
    },
  });
  workflow.restoreImports(source.imports);
  const adapter = createVocabularyStudyAdapter();
  const identityBefore = adapter.adapt(source.entries[0]);
  const partition = createSyntheticLearnerPartition();
  const learnerBefore = createLearnerSnapshot(partition, { createdAt: SNAPSHOT_AT });
  const result = await workflow.confirm(previewSentinel(workflow, 'collection-5311').previewId);
  assert.equal(result.error.code, 'IMPORT_ROLLED_BACK');
  assert.equal(result.error.details.causeCode, 'CONTROLLED_5311_ROLLBACK');
  const restored = await library.load();
  const rawAfter = await readFile(filePath);
  assert.equal(restored.entries.length, 5_311);
  assert.equal(store.count(), 5_311);
  assert.equal(calculateVocabularyLibraryHash(restored), canonicalHashBefore);
  assert.equal(createHash('sha256').update(rawAfter).digest('hex'), createHash('sha256').update(rawBefore).digest('hex'));
  const identityAfter = adapter.adapt(restored.entries[0]);
  assert.equal(identityAfter.studyItem.itemId, identityBefore.studyItem.itemId);
  assert.equal(identityAfter.reviewCards[0].cardId, identityBefore.reviewCards[0].cardId);
  assert.deepEqual(createLearnerSnapshot(partition, { createdAt: SNAPSHOT_AT }), learnerBefore);
});
