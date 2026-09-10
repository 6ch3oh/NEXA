import { deepFreeze } from '../src/domain/shared.mjs';
import { validateLearnerSnapshot } from '../src/persistence/learner-snapshot.mjs';
import { CURRENT_SCHEMA_VERSION } from '../src/persistence/snapshot-migration.mjs';

export const SYNTHETIC_MIGRATION_FIXTURE_MARKER = 'TEST_FIXTURE_ONLY';
export const SYNTHETIC_LEGACY_SCHEMA_VERSION = '0.0-test';

export function createSyntheticLegacySnapshot(currentSnapshot) {
  validateLearnerSnapshot(currentSnapshot);
  return deepFreeze({
    schemaVersion: SYNTHETIC_LEGACY_SCHEMA_VERSION,
    createdAt: currentSnapshot.createdAt,
    updatedAt: currentSnapshot.updatedAt,
    learners: structuredClone(currentSnapshot.learners),
    migrationFixtureMarker: SYNTHETIC_MIGRATION_FIXTURE_MARKER,
  });
}

export function registerSyntheticLegacyMigration(policy, { fail = false } = {}) {
  return policy.registerMigration({
    fromVersion: SYNTHETIC_LEGACY_SCHEMA_VERSION,
    toVersion: CURRENT_SCHEMA_VERSION,
    migrate(legacySnapshot) {
      if (fail) throw new Error('synthetic migration failure');
      if (legacySnapshot.migrationFixtureMarker !== SYNTHETIC_MIGRATION_FIXTURE_MARKER) {
        throw new Error('missing TEST_FIXTURE_ONLY marker');
      }
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: legacySnapshot.createdAt,
        updatedAt: legacySnapshot.updatedAt,
        learners: structuredClone(legacySnapshot.learners),
      };
    },
  });
}
