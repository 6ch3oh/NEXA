import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_LOCAL_LEARNER_ID,
  LearningStage,
  LearnerIdentityError,
  LearnerPartitionError,
  SnapshotValidationError,
  assertPersistenceAdapter,
  createInMemoryVocabularyStore,
  createLearnerDataPartition,
  createLearnerIdentity,
  createLearnerRuntime,
  createLearnerSnapshot,
  createLocalFilePersistenceAdapter,
  hydrateLearnerSnapshot,
  normalizeLearnerId,
  parseLearnerSnapshot,
  restoreLearnerData,
  saveLearnerData,
  serializeLearnerSnapshot,
  validateLearnerSnapshot,
} from '../src/index.mjs';
import {
  SYNTHETIC_LEARNER_A,
  SYNTHETIC_LEARNER_A_PROGRESS,
  SYNTHETIC_LEARNER_B,
  SYNTHETIC_LEARNER_B_PROGRESS,
  SYNTHETIC_LEARNER_FIXTURE_MARKER,
  SYNTHETIC_LEARNER_REVIEW_RECORDS,
  SYNTHETIC_PARTITION_NOW,
  createSyntheticLearnerPartition,
} from '../fixtures/synthetic-learners.mjs';
import { SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

const SNAPSHOT_CREATED_AT = '2026-08-10T00:00:00.000Z';
const SNAPSHOT_UPDATED_AT = '2026-08-10T12:00:00.000Z';

function snapshotOf(partition = createSyntheticLearnerPartition(), updatedAt = SNAPSHOT_UPDATED_AT) {
  return createLearnerSnapshot(partition, { createdAt: SNAPSHOT_CREATED_AT, updatedAt });
}

async function createTempAdapter(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nexa-cet6-004-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'learner-state.json');
  return {
    directory,
    filePath,
    adapter: createLocalFilePersistenceAdapter({ filePath }),
  };
}

function vocabularyStore() {
  return createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
}

test('learnerId validation is canonical and fails closed with a stable error', () => {
  assert.equal(normalizeLearnerId('Learner:A'), SYNTHETIC_LEARNER_A);
  assert.throws(
    () => normalizeLearnerId('invalid learner id'),
    (error) => error instanceof LearnerIdentityError && error.code === 'INVALID_LEARNER_ID',
  );
});

test('default local learner is centralized and caller-overridable', () => {
  assert.equal(DEFAULT_LOCAL_LEARNER_ID, 'local-default');
  assert.deepEqual(createLearnerIdentity(), { schemaVersion: '0.1', learnerId: DEFAULT_LOCAL_LEARNER_ID });
  assert.equal(createLearnerDataPartition().openLearner().learnerId, DEFAULT_LOCAL_LEARNER_ID);
});

test('Learner A progress cannot be read from Learner B partition', () => {
  const partition = createSyntheticLearnerPartition();
  const entryId = SYNTHETIC_LEARNER_A_PROGRESS[1].entryId;
  assert.equal(partition.getProgress(SYNTHETIC_LEARNER_A, entryId).learnerId, SYNTHETIC_LEARNER_A);
  assert.equal(partition.getProgress(SYNTHETIC_LEARNER_B, entryId), null);
  assert.throws(
    () => partition.upsertProgress(SYNTHETIC_LEARNER_B, SYNTHETIC_LEARNER_A_PROGRESS[1]),
    (error) => error instanceof LearnerPartitionError && error.code === 'LEARNER_MISMATCH',
  );
});

test('favorite metadata is learner-isolated', () => {
  const partition = createSyntheticLearnerPartition();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  assert.equal(partition.getState(SYNTHETIC_LEARNER_A, entryId).favorite, true);
  assert.equal(partition.getState(SYNTHETIC_LEARNER_B, entryId).favorite, false);
});

test('unknown metadata is learner-isolated', () => {
  const partition = createSyntheticLearnerPartition();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  assert.equal(partition.getState(SYNTHETIC_LEARNER_A, entryId).unknown, false);
  assert.equal(partition.getState(SYNTHETIC_LEARNER_B, entryId).unknown, true);
});

test('MASTERED state for Learner A remains NEW for Learner B', () => {
  const partition = createSyntheticLearnerPartition();
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  assert.equal(partition.getProgress(SYNTHETIC_LEARNER_A, entryId).stage, LearningStage.MASTERED);
  assert.equal(partition.getProgress(SYNTHETIC_LEARNER_B, entryId).stage, LearningStage.NEW);
  assert.equal(partition.listByStatus(SYNTHETIC_LEARNER_A, LearningStage.MASTERED).length, 1);
  assert.equal(partition.listByStatus(SYNTHETIC_LEARNER_B, LearningStage.MASTERED).length, 0);
});

test('ReviewRecord reads and writes are learner-isolated', () => {
  const partition = createSyntheticLearnerPartition();
  assert.deepEqual(partition.listReviewRecords(SYNTHETIC_LEARNER_A), [SYNTHETIC_LEARNER_REVIEW_RECORDS[0]]);
  assert.deepEqual(partition.listReviewRecords(SYNTHETIC_LEARNER_B), [SYNTHETIC_LEARNER_REVIEW_RECORDS[1]]);
  assert.throws(
    () => partition.appendReviewRecord(SYNTHETIC_LEARNER_B, SYNTHETIC_LEARNER_REVIEW_RECORDS[0]),
    (error) => error.code === 'LEARNER_MISMATCH',
  );
});

test('snapshot serialization is stable JSON without runtime containers', () => {
  const snapshot = snapshotOf();
  const first = serializeLearnerSnapshot(snapshot);
  const second = serializeLearnerSnapshot(snapshot);
  assert.equal(first, second);
  assert.deepEqual(parseLearnerSnapshot(first), snapshot);
  assert.ok(!first.includes('[object Map]'));
  assert.ok(Object.isFrozen(snapshot));
});

test('snapshot validation accepts the complete synthetic learner fixture', () => {
  assert.equal(SYNTHETIC_LEARNER_FIXTURE_MARKER, 'TEST / SYNTHETIC');
  const snapshot = snapshotOf();
  assert.equal(validateLearnerSnapshot(snapshot), snapshot);
  assert.deepEqual(snapshot.learners.map((learner) => learner.learnerId), [
    SYNTHETIC_LEARNER_A,
    SYNTHETIC_LEARNER_B,
  ]);
});

test('file persistence saves a validated snapshot in a temporary test directory', async (t) => {
  const { adapter, filePath } = await createTempAdapter(t);
  assert.equal(assertPersistenceAdapter(adapter), adapter);
  assert.equal(await adapter.exists(), false);
  const result = await adapter.save(snapshotOf());
  assert.equal(await adapter.exists(), true);
  assert.equal(result.filePath, filePath);
  assert.ok(result.bytes > 0);
});

test('file persistence loads the same canonical snapshot', async (t) => {
  const { adapter } = await createTempAdapter(t);
  const snapshot = snapshotOf();
  await adapter.save(snapshot);
  assert.deepEqual(await adapter.load(), snapshot);
});

test('save and restore preserve learner progress exactly', async (t) => {
  const { adapter } = await createTempAdapter(t);
  const original = createSyntheticLearnerPartition();
  await saveLearnerData(adapter, original, {
    createdAt: SNAPSHOT_CREATED_AT,
    updatedAt: SNAPSHOT_UPDATED_AT,
  });
  const restored = await restoreLearnerData(adapter);
  assert.equal(restored.restored, true);
  assert.deepEqual(restored.partition.listProgress(SYNTHETIC_LEARNER_A), original.listProgress(SYNTHETIC_LEARNER_A));
  assert.deepEqual(restored.partition.listStates(SYNTHETIC_LEARNER_B), original.listStates(SYNTHETIC_LEARNER_B));
});

test('save and restore preserve append-only review records exactly', async (t) => {
  const { adapter } = await createTempAdapter(t);
  await adapter.save(snapshotOf());
  const restored = await restoreLearnerData(adapter);
  assert.deepEqual(
    restored.partition.listReviewRecords(SYNTHETIC_LEARNER_A),
    [SYNTHETIC_LEARNER_REVIEW_RECORDS[0]],
  );
  assert.deepEqual(
    restored.partition.listReviewRecords(SYNTHETIC_LEARNER_B),
    [SYNTHETIC_LEARNER_REVIEW_RECORDS[1]],
  );
});

test('Today Queue output is identical after restore', async (t) => {
  const { adapter } = await createTempAdapter(t);
  const original = createSyntheticLearnerPartition();
  const before = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: vocabularyStore(),
    partition: original,
  }).queueBuilder.build({ now: SYNTHETIC_PARTITION_NOW });
  await adapter.save(snapshotOf(original));
  const restored = await restoreLearnerData(adapter);
  const after = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: vocabularyStore(),
    partition: restored.partition,
  }).queueBuilder.build({ now: SYNTHETIC_PARTITION_NOW });
  assert.deepEqual(after, before);
});

test('learning Statistics output is identical after restore', async (t) => {
  const { adapter } = await createTempAdapter(t);
  const original = createSyntheticLearnerPartition();
  const before = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: vocabularyStore(),
    partition: original,
  }).getStatistics({ day: '2026-08-10' });
  await adapter.save(snapshotOf(original));
  const restored = await restoreLearnerData(adapter);
  const after = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: vocabularyStore(),
    partition: restored.partition,
  }).getStatistics({ day: '2026-08-10' });
  assert.deepEqual(after, before);
});

test('invalid JSON fails closed and remains on disk unchanged', async (t) => {
  const { adapter, filePath } = await createTempAdapter(t);
  await writeFile(filePath, '{broken-json', 'utf8');
  await assert.rejects(
    adapter.load(),
    (error) => error instanceof SnapshotValidationError && error.code === 'INVALID_JSON',
  );
  assert.equal(await readFile(filePath, 'utf8'), '{broken-json');
});

test('unsupported snapshot schemaVersion fails closed', () => {
  const invalid = structuredClone(snapshotOf());
  invalid.schemaVersion = '9.9';
  assert.throws(
    () => validateLearnerSnapshot(invalid),
    (error) => error.code === 'UNSUPPORTED_SNAPSHOT_VERSION',
  );
});

test('invalid LearnerProgress fails closed', () => {
  const invalid = structuredClone(snapshotOf());
  invalid.learners[0].progress[0].stage = 'invented';
  assert.throws(
    () => validateLearnerSnapshot(invalid),
    (error) => error.code === 'INVALID_PROGRESS',
  );
});

test('invalid ReviewRecord fails closed', () => {
  const invalid = structuredClone(snapshotOf());
  invalid.learners[0].reviewRecords[0].score = 0;
  assert.throws(
    () => validateLearnerSnapshot(invalid),
    (error) => error.code === 'INVALID_REVIEW_RECORD',
  );
});

test('missing fields, invalid learnerId and duplicate identities are rejected', () => {
  const missing = structuredClone(snapshotOf());
  delete missing.updatedAt;
  assert.throws(() => validateLearnerSnapshot(missing), (error) => error.code === 'INVALID_SNAPSHOT');

  const invalidLearner = structuredClone(snapshotOf());
  invalidLearner.learners[0].learnerId = 'invalid learner';
  assert.throws(() => validateLearnerSnapshot(invalidLearner), (error) => error.code === 'INVALID_LEARNER_ID');

  const duplicateProgress = structuredClone(snapshotOf());
  duplicateProgress.learners[0].progress.push(structuredClone(duplicateProgress.learners[0].progress[0]));
  assert.throws(() => validateLearnerSnapshot(duplicateProgress), (error) => error.code === 'DUPLICATE_PROGRESS');

  const duplicateReview = structuredClone(snapshotOf());
  duplicateReview.learners[0].reviewRecords.push(structuredClone(duplicateReview.learners[0].reviewRecords[0]));
  assert.throws(() => validateLearnerSnapshot(duplicateReview), (error) => error.code === 'DUPLICATE_REVIEW_RECORD');
});

test('restore never silently clears a corrupt existing snapshot', async (t) => {
  const { adapter, filePath } = await createTempAdapter(t);
  await adapter.save(snapshotOf());
  const corrupt = '{"schemaVersion":"0.1"}';
  await writeFile(filePath, corrupt, 'utf8');
  await assert.rejects(restoreLearnerData(adapter), (error) => error.code === 'INVALID_SNAPSHOT');
  assert.equal(await adapter.exists(), true);
  assert.equal(await readFile(filePath, 'utf8'), corrupt);
});

test('safe writes replace through a temporary sibling and leave no temporary artifact', async (t) => {
  const { adapter, directory } = await createTempAdapter(t);
  await adapter.save(snapshotOf());
  await adapter.save(snapshotOf(createSyntheticLearnerPartition(), '2026-08-10T13:00:00.000Z'));
  const files = await readdir(directory);
  assert.deepEqual(files, ['learner-state.json']);
  assert.ok(!files.some((name) => name.startsWith(adapter.tempFilePrefix)));
  assert.equal((await adapter.load()).updatedAt, '2026-08-10T13:00:00.000Z');
});

test('Learner A and B Today Queues use isolated state over one Vocabulary Store', () => {
  const partition = createSyntheticLearnerPartition();
  const sharedVocabularyStore = vocabularyStore();
  const queueA = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: sharedVocabularyStore,
    partition,
  }).queueBuilder.build({ now: SYNTHETIC_PARTITION_NOW });
  const queueB = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_B,
    vocabularyStore: sharedVocabularyStore,
    partition,
  }).queueBuilder.build({ now: SYNTHETIC_PARTITION_NOW });
  const sharedEntryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  assert.equal(queueA.todayWords.some((word) => word.entryId === sharedEntryId), false);
  assert.equal(queueB.todayWords.some((word) => word.entryId === sharedEntryId), true);
  assert.notDeepEqual(queueA, queueB);
});

test('Learner A and B Statistics are isolated over one Vocabulary Store', () => {
  const partition = createSyntheticLearnerPartition();
  const sharedVocabularyStore = vocabularyStore();
  const statisticsA = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: sharedVocabularyStore,
    partition,
  }).getStatistics({ day: '2026-08-10' });
  const statisticsB = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_B,
    vocabularyStore: sharedVocabularyStore,
    partition,
  }).getStatistics({ day: '2026-08-10' });
  assert.deepEqual(
    [statisticsA.masteredCount, statisticsA.favoriteCount, statisticsA.unknownCount, statisticsA.dailyReviewCount],
    [1, 1, 1, 1],
  );
  assert.deepEqual(
    [statisticsB.masteredCount, statisticsB.favoriteCount, statisticsB.unknownCount, statisticsB.dailyReviewCount],
    [0, 0, 1, 0],
  );
});

test('public API exports every formal 004 capability', async () => {
  const api = await import('../src/index.mjs');
  for (const name of [
    'createLearnerIdentity',
    'createLearnerDataPartition',
    'createLearnerRuntime',
    'createLearnerSnapshot',
    'validateLearnerSnapshot',
    'serializeLearnerSnapshot',
    'parseLearnerSnapshot',
    'hydrateLearnerSnapshot',
    'createLocalFilePersistenceAdapter',
    'saveLearnerData',
    'restoreLearnerData',
  ]) {
    assert.equal(typeof api[name], 'function', `${name} must be exported`);
  }
  assert.equal(typeof api.DEFAULT_LOCAL_LEARNER_ID, 'string');
  assert.deepEqual(hydrateLearnerSnapshot(snapshotOf()).listLearnerIds(), [SYNTHETIC_LEARNER_A, SYNTHETIC_LEARNER_B]);
});
