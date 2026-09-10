import { deepFreeze } from '../domain/shared.mjs';
import { createLearnerDataPartition } from '../learning/learner-data-partition.mjs';
import {
  createLearnerSnapshot,
  hydrateLearnerSnapshot,
} from './learner-snapshot.mjs';
import { PersistenceError, assertPersistenceAdapter } from './persistence-contract.mjs';
import { createSnapshotMigrationPolicy } from './snapshot-migration.mjs';

export const LEARNER_RESTORE_VERSION = '0.1';

export async function saveLearnerData(adapter, partition, timestamps) {
  assertPersistenceAdapter(adapter);
  const snapshot = createLearnerSnapshot(partition, timestamps);
  const result = await adapter.save(snapshot);
  return deepFreeze({ snapshot, result });
}

export async function restoreLearnerData(adapter, {
  migrationPolicy = createSnapshotMigrationPolicy(),
} = {}) {
  assertPersistenceAdapter(adapter);
  if (migrationPolicy === null || typeof migrationPolicy !== 'object'
    || typeof migrationPolicy.migrate !== 'function') {
    throw new PersistenceError('INVALID_MIGRATION_POLICY', 'migrationPolicy.migrate() is required');
  }
  if (!(await adapter.exists())) {
    return Object.freeze({
      restoreVersion: LEARNER_RESTORE_VERSION,
      restored: false,
      snapshot: null,
      partition: createLearnerDataPartition(),
    });
  }
  const loaded = typeof adapter.loadRaw === 'function'
    ? await adapter.loadRaw()
    : await adapter.load();
  if (loaded === null) {
    throw new PersistenceError('PERSISTENCE_STATE_CHANGED', 'snapshot disappeared during restore');
  }
  const snapshot = migrationPolicy.migrate(loaded);
  adapter.validate(snapshot);
  return Object.freeze({
    restoreVersion: LEARNER_RESTORE_VERSION,
    restored: true,
    snapshot,
    partition: hydrateLearnerSnapshot(snapshot),
  });
}
