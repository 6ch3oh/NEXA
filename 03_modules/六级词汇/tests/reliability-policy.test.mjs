import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_MAX_RESTORE_POINTS,
  RestorePointError,
  SINGLE_WRITER_SCOPE,
  SnapshotMigrationError,
  calculateSnapshotHash,
  createInMemoryVocabularyStore,
  createLearnerRuntime,
  createLearnerSnapshot,
  createLocalFilePersistenceAdapter,
  createLocalRestorePointManager,
  createSingleWriterCoordinator,
  createSnapshotMigrationPolicy,
  restoreLearnerData,
  validateLearnerSnapshot,
} from '../src/index.mjs';
import {
  SYNTHETIC_LEGACY_SCHEMA_VERSION,
  SYNTHETIC_MIGRATION_FIXTURE_MARKER,
  createSyntheticLegacySnapshot,
  registerSyntheticLegacyMigration,
} from '../fixtures/synthetic-migration.mjs';
import {
  SYNTHETIC_LEARNER_A,
  SYNTHETIC_LEARNER_B,
  SYNTHETIC_LEARNER_REVIEW_RECORDS,
  SYNTHETIC_PARTITION_NOW,
  createSyntheticLearnerPartition,
} from '../fixtures/synthetic-learners.mjs';
import { SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

const CREATED_AT = '2026-08-10T00:00:00.000Z';

function snapshotAt(updatedAt = '2026-08-10T12:00:00.000Z', partition = createSyntheticLearnerPartition()) {
  return createLearnerSnapshot(partition, { createdAt: CREATED_AT, updatedAt });
}

function vocabularyStore() {
  return createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
}

async function createTempContext(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nexa-cet6-005-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, 'learner-state.json');
  const restorePointDirectory = join(root, 'restore-points');
  return {
    root,
    filePath,
    restorePointDirectory,
    adapter: createLocalFilePersistenceAdapter({ filePath }),
    manager: createLocalRestorePointManager({
      directoryPath: restorePointDirectory,
      ...(options.maxRestorePoints === undefined ? {} : { maxRestorePoints: options.maxRestorePoints }),
      ...(options.migrationPolicy === undefined ? {} : { migrationPolicy: options.migrationPolicy }),
    }),
  };
}

async function createPoint(manager, index, snapshot = snapshotAt(`2026-08-10T1${index}:00:00.000Z`)) {
  return manager.createRestorePoint({
    restorePointId: `restore:test:${index}`,
    createdAt: `2026-08-10T1${index}:30:00.000Z`,
    snapshot,
  });
}

test('createRestorePoint persists a validated Snapshot with SHA-256 integrity', async (t) => {
  const { manager } = await createTempContext(t);
  const snapshot = snapshotAt();
  const result = await createPoint(manager, 2, snapshot);
  assert.equal(result.restorePoint.restorePointId, 'restore:test:2');
  assert.equal(result.restorePoint.sourceSnapshotHash, calculateSnapshotHash(snapshot));
  assert.match(result.restorePoint.sourceSnapshotHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.prunedRestorePointIds, []);
});

test('listRestorePoints returns stable chronological metadata without implicit restore', async (t) => {
  const { manager } = await createTempContext(t);
  await createPoint(manager, 2);
  await createPoint(manager, 1);
  const points = await manager.listRestorePoints();
  assert.deepEqual(points.map((point) => point.restorePointId), ['restore:test:1', 'restore:test:2']);
  assert.ok(points.every((point) => !Object.hasOwn(point, 'snapshot')));
});

test('restoreFromPoint validates and hydrates a valid restore point explicitly', async (t) => {
  const { manager } = await createTempContext(t);
  const snapshot = snapshotAt();
  await createPoint(manager, 2, snapshot);
  const restored = await manager.restoreFromPoint('restore:test:2');
  assert.deepEqual(restored.snapshot, snapshot);
  assert.deepEqual(restored.partition.listLearnerIds(), [SYNTHETIC_LEARNER_A, SYNTHETIC_LEARNER_B]);
});

test('deleteRestorePoint removes only the explicitly selected point', async (t) => {
  const { manager } = await createTempContext(t);
  await createPoint(manager, 1);
  await createPoint(manager, 2);
  assert.equal(await manager.deleteRestorePoint('restore:test:1'), true);
  assert.deepEqual((await manager.listRestorePoints()).map((point) => point.restorePointId), ['restore:test:2']);
  await assert.rejects(
    manager.restoreFromPoint('restore:test:1'),
    (error) => error instanceof RestorePointError && error.code === 'RESTORE_POINT_NOT_FOUND',
  );
});

test('restore point retention prunes the oldest point at the centralized limit', async (t) => {
  const { manager } = await createTempContext(t, { maxRestorePoints: 2 });
  assert.equal(DEFAULT_MAX_RESTORE_POINTS, 5);
  await createPoint(manager, 1);
  await createPoint(manager, 2);
  const third = await createPoint(manager, 3);
  assert.deepEqual(third.prunedRestorePointIds, ['restore:test:1']);
  assert.deepEqual((await manager.listRestorePoints()).map((point) => point.restorePointId), [
    'restore:test:2',
    'restore:test:3',
  ]);
});

test('corrupted restore point JSON fails closed', async (t) => {
  const { manager } = await createTempContext(t);
  await createPoint(manager, 1);
  const path = manager.getRestorePointPath('restore:test:1');
  await writeFile(path, '{broken', 'utf8');
  await assert.rejects(
    manager.restoreFromPoint('restore:test:1'),
    (error) => error.code === 'INVALID_RESTORE_POINT_JSON',
  );
});

test('restore point hash mismatch fails closed before hydrate', async (t) => {
  const { manager } = await createTempContext(t);
  await createPoint(manager, 1);
  const path = manager.getRestorePointPath('restore:test:1');
  const tampered = JSON.parse(await readFile(path, 'utf8'));
  tampered.snapshot.updatedAt = '2026-08-10T19:00:00.000Z';
  await writeFile(path, JSON.stringify(tampered), 'utf8');
  await assert.rejects(
    manager.restoreFromPoint('restore:test:1'),
    (error) => error.code === 'RESTORE_POINT_HASH_MISMATCH',
  );
});

test('concurrent local saves are serialized for the same target', async (t) => {
  const { adapter } = await createTempContext(t);
  const snapshots = [
    snapshotAt('2026-08-10T12:00:00.000Z'),
    snapshotAt('2026-08-10T13:00:00.000Z'),
    snapshotAt('2026-08-10T14:00:00.000Z'),
  ];
  const results = await Promise.all(snapshots.map((snapshot) => adapter.save(snapshot)));
  assert.ok(results.every((result) => result.writerScope === SINGLE_WRITER_SCOPE));
  assert.deepEqual(await adapter.load(), snapshots[2]);
});

test('Single Writer execution order follows invocation order deterministically', async () => {
  const coordinator = createSingleWriterCoordinator();
  const events = [];
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = coordinator.run('target:test', async () => {
    events.push('first:start');
    await gate;
    events.push('first:end');
  });
  const second = coordinator.run('target:test', async () => events.push('second'));
  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second']);
});

test('failed write releases the Single Writer queue', async () => {
  const coordinator = createSingleWriterCoordinator();
  const events = [];
  const failed = coordinator.run('target:failure', async () => {
    events.push('failed');
    throw new Error('synthetic write failure');
  });
  const next = coordinator.run('target:failure', async () => {
    events.push('next');
    return 'ok';
  });
  await assert.rejects(failed, /synthetic write failure/);
  assert.equal(await next, 'ok');
  assert.deepEqual(events, ['failed', 'next']);
});

test('a new write succeeds after an earlier failure and pending count returns to zero', async () => {
  const coordinator = createSingleWriterCoordinator();
  await assert.rejects(coordinator.run('target:recovery', async () => { throw new Error('fail'); }));
  assert.equal(await coordinator.run('target:recovery', async () => 42), 42);
  assert.equal(coordinator.getPendingCount('target:recovery'), 0);
});

test('concurrent saves never expose truncated or half-written JSON', async (t) => {
  const { adapter, filePath } = await createTempContext(t);
  await Promise.all([
    adapter.save(snapshotAt('2026-08-10T12:00:00.000Z')),
    adapter.save(snapshotAt('2026-08-10T13:00:00.000Z')),
  ]);
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(validateLearnerSnapshot(parsed), parsed);
  assert.equal(parsed.updatedAt, '2026-08-10T13:00:00.000Z');
});

test('concurrent saves leave no uncontrolled temporary residue', async (t) => {
  const { adapter, root } = await createTempContext(t);
  await Promise.all([
    adapter.save(snapshotAt('2026-08-10T12:00:00.000Z')),
    adapter.save(snapshotAt('2026-08-10T13:00:00.000Z')),
    adapter.save(snapshotAt('2026-08-10T14:00:00.000Z')),
  ]);
  assert.deepEqual(await readdir(root), ['learner-state.json']);
});

test('same-version migration is a defensive no-op', () => {
  const policy = createSnapshotMigrationPolicy();
  const snapshot = snapshotAt();
  const result = policy.migrate(snapshot);
  assert.equal(CURRENT_SCHEMA_VERSION, '0.1');
  assert.deepEqual(result, snapshot);
  assert.notEqual(result, snapshot);
  assert.ok(Object.isFrozen(result));
});

test('registered synthetic legacy migration upgrades to current schema', () => {
  const policy = registerSyntheticLegacyMigration(createSnapshotMigrationPolicy());
  const legacy = createSyntheticLegacySnapshot(snapshotAt());
  assert.equal(SYNTHETIC_MIGRATION_FIXTURE_MARKER, 'TEST_FIXTURE_ONLY');
  assert.equal(policy.canMigrate(SYNTHETIC_LEGACY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION), true);
  const migrated = policy.migrate(legacy);
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(Object.hasOwn(migrated, 'migrationFixtureMarker'), false);
  validateLearnerSnapshot(migrated);
});

test('unknown old schema without a registered path fails closed', () => {
  const unknownOld = { ...structuredClone(snapshotAt()), schemaVersion: '0.0' };
  assert.throws(
    () => createSnapshotMigrationPolicy().migrate(unknownOld),
    (error) => error instanceof SnapshotMigrationError && error.code === 'UNSUPPORTED_OLD_SCHEMA_VERSION',
  );
});

test('future schema fails closed without guessing', () => {
  const future = { ...structuredClone(snapshotAt()), schemaVersion: '9.9' };
  assert.throws(
    () => createSnapshotMigrationPolicy().migrate(future),
    (error) => error.code === 'FUTURE_SCHEMA_VERSION',
  );
});

test('migration input remains immutable and output is a defensive object', () => {
  const policy = registerSyntheticLegacyMigration(createSnapshotMigrationPolicy());
  const legacy = createSyntheticLegacySnapshot(snapshotAt());
  const before = JSON.stringify(legacy);
  const migrated = policy.migrate(legacy);
  assert.equal(JSON.stringify(legacy), before);
  assert.notEqual(migrated, legacy);
  assert.ok(Object.isFrozen(legacy));
  assert.ok(Object.isFrozen(migrated));
});

test('migration failure does not mutate current live learner state', () => {
  const live = createSyntheticLearnerPartition();
  const before = live.listStates(SYNTHETIC_LEARNER_A);
  const failingPolicy = registerSyntheticLegacyMigration(createSnapshotMigrationPolicy(), { fail: true });
  assert.throws(
    () => failingPolicy.migrate(createSyntheticLegacySnapshot(snapshotAt())),
    (error) => error.code === 'MIGRATION_FAILED',
  );
  assert.deepEqual(live.listStates(SYNTHETIC_LEARNER_A), before);
});

test('restoreLearnerData restores through an explicit registered migration path', async (t) => {
  const { adapter, filePath, restorePointDirectory } = await createTempContext(t);
  const legacy = createSyntheticLegacySnapshot(snapshotAt());
  await writeFile(filePath, JSON.stringify(legacy), 'utf8');
  const policy = registerSyntheticLegacyMigration(createSnapshotMigrationPolicy());
  const restored = await restoreLearnerData(adapter, { migrationPolicy: policy });
  assert.equal(restored.snapshot.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(restored.partition.listLearnerIds(), [SYNTHETIC_LEARNER_A, SYNTHETIC_LEARNER_B]);

  const manager = createLocalRestorePointManager({
    directoryPath: restorePointDirectory,
    migrationPolicy: policy,
  });
  const legacyPoint = {
    schemaVersion: '0.1',
    restorePointId: 'restore:test:legacy',
    createdAt: '2026-08-10T15:00:00.000Z',
    sourceSnapshotHash: calculateSnapshotHash(legacy),
    snapshot: legacy,
  };
  await mkdir(restorePointDirectory, { recursive: true });
  await writeFile(manager.getRestorePointPath(legacyPoint.restorePointId), JSON.stringify(legacyPoint), 'utf8');
  const restoredPoint = await manager.restoreFromPoint(legacyPoint.restorePointId);
  assert.equal(restoredPoint.snapshot.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(restoredPoint.partition.listLearnerIds(), [SYNTHETIC_LEARNER_A, SYNTHETIC_LEARNER_B]);
});

test('backup then modify then restore returns the explicit earlier state', async (t) => {
  const { manager } = await createTempContext(t);
  const live = createSyntheticLearnerPartition();
  await createPoint(manager, 1, snapshotAt('2026-08-10T11:00:00.000Z', live));
  const entryId = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;
  live.setFavorite(SYNTHETIC_LEARNER_B, entryId, true);
  assert.equal(live.getState(SYNTHETIC_LEARNER_B, entryId).favorite, true);
  const restored = await manager.restoreFromPoint('restore:test:1');
  assert.equal(restored.partition.getState(SYNTHETIC_LEARNER_B, entryId).favorite, false);
});

test('restore point preserves every learner partition', async (t) => {
  const { manager } = await createTempContext(t);
  const snapshot = snapshotAt();
  await createPoint(manager, 1, snapshot);
  const restored = await manager.restoreFromPoint('restore:test:1');
  assert.deepEqual(restored.partition.listStates(SYNTHETIC_LEARNER_A), createSyntheticLearnerPartition().listStates(SYNTHETIC_LEARNER_A));
  assert.deepEqual(restored.partition.listStates(SYNTHETIC_LEARNER_B), createSyntheticLearnerPartition().listStates(SYNTHETIC_LEARNER_B));
});

test('restore point preserves append-only ReviewRecords', async (t) => {
  const { manager } = await createTempContext(t);
  await createPoint(manager, 1, snapshotAt());
  const restored = await manager.restoreFromPoint('restore:test:1');
  assert.deepEqual(restored.partition.listReviewRecords(SYNTHETIC_LEARNER_A), [SYNTHETIC_LEARNER_REVIEW_RECORDS[0]]);
  assert.deepEqual(restored.partition.listReviewRecords(SYNTHETIC_LEARNER_B), [SYNTHETIC_LEARNER_REVIEW_RECORDS[1]]);
});

test('restore point preserves Today Queue semantics', async (t) => {
  const { manager } = await createTempContext(t);
  const original = createSyntheticLearnerPartition();
  const store = vocabularyStore();
  const before = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: store,
    partition: original,
  }).queueBuilder.build({ now: SYNTHETIC_PARTITION_NOW });
  await createPoint(manager, 1, snapshotAt('2026-08-10T11:00:00.000Z', original));
  const restored = await manager.restoreFromPoint('restore:test:1');
  const after = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: store,
    partition: restored.partition,
  }).queueBuilder.build({ now: SYNTHETIC_PARTITION_NOW });
  assert.deepEqual(after, before);
});

test('restore point preserves learner Statistics semantics', async (t) => {
  const { manager } = await createTempContext(t);
  const original = createSyntheticLearnerPartition();
  const store = vocabularyStore();
  const before = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: store,
    partition: original,
  }).getStatistics({ day: '2026-08-10' });
  await createPoint(manager, 1, snapshotAt('2026-08-10T11:00:00.000Z', original));
  const restored = await manager.restoreFromPoint('restore:test:1');
  const after = createLearnerRuntime({
    learnerId: SYNTHETIC_LEARNER_A,
    vocabularyStore: store,
    partition: restored.partition,
  }).getStatistics({ day: '2026-08-10' });
  assert.deepEqual(after, before);
});

test('public API exports all formal 005 reliability capabilities', async () => {
  const api = await import('../src/index.mjs');
  for (const name of [
    'createLocalRestorePointManager',
    'createRestorePointRecord',
    'validateRestorePoint',
    'calculateSnapshotHash',
    'createSingleWriterCoordinator',
    'createSnapshotMigrationPolicy',
  ]) {
    assert.equal(typeof api[name], 'function', `${name} must be exported`);
  }
  assert.equal(api.SINGLE_WRITER_SCOPE, 'PROCESS_LOCAL_SINGLE_WRITER');
  assert.equal(api.CURRENT_SCHEMA_VERSION, api.LEARNER_SNAPSHOT_SCHEMA_VERSION);
});
