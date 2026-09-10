import { deepFreeze, requirePlainObject } from '../domain/shared.mjs';
import {
  LEARNER_SNAPSHOT_SCHEMA_VERSION,
  validateLearnerSnapshot,
} from './learner-snapshot.mjs';

export const SNAPSHOT_MIGRATION_POLICY_VERSION = '0.1';
export const CURRENT_SCHEMA_VERSION = LEARNER_SNAPSHOT_SCHEMA_VERSION;

export class SnapshotMigrationError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'SnapshotMigrationError';
    this.code = code;
    this.details = details;
  }
}

function requireVersion(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SnapshotMigrationError('INVALID_SCHEMA_VERSION', `${path} must be a non-empty string`);
  }
  return value;
}

function cloneImmutable(value) {
  try {
    return deepFreeze(structuredClone(value));
  } catch (error) {
    throw new SnapshotMigrationError('INVALID_MIGRATION_INPUT', 'snapshot must be structured-cloneable', undefined, {
      cause: error,
    });
  }
}

function compareNumericVersions(left, right) {
  if (!/^\d+\.\d+$/.test(left) || !/^\d+\.\d+$/.test(right)) return null;
  const [leftMajor, leftMinor] = left.split('.').map(Number);
  const [rightMajor, rightMinor] = right.split('.').map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor;
}

export function createSnapshotMigrationPolicy({ currentVersion = CURRENT_SCHEMA_VERSION } = {}) {
  const canonicalCurrent = requireVersion(currentVersion, 'currentVersion');
  const migrations = new Map();

  function registerMigration({ fromVersion, toVersion, migrate }) {
    const from = requireVersion(fromVersion, 'fromVersion');
    const to = requireVersion(toVersion, 'toVersion');
    if (from === to) {
      throw new SnapshotMigrationError('INVALID_MIGRATION_EDGE', 'migration versions must differ');
    }
    if (typeof migrate !== 'function') {
      throw new SnapshotMigrationError('INVALID_MIGRATION_HANDLER', 'migrate must be a function');
    }
    if (migrations.has(from)) {
      throw new SnapshotMigrationError('DUPLICATE_MIGRATION', `migration from ${from} already registered`);
    }
    migrations.set(from, Object.freeze({ fromVersion: from, toVersion: to, migrate }));
    return policy;
  }

  function findPath(fromVersion, targetVersion) {
    const from = requireVersion(fromVersion, 'fromVersion');
    const target = requireVersion(targetVersion, 'targetVersion');
    if (from === target) return Object.freeze([]);
    const path = [];
    const visited = new Set();
    let cursor = from;
    while (cursor !== target) {
      if (visited.has(cursor)) return null;
      visited.add(cursor);
      const edge = migrations.get(cursor);
      if (!edge) return null;
      path.push(edge);
      cursor = edge.toVersion;
    }
    return Object.freeze(path);
  }

  function canMigrate(fromVersion, targetVersion = canonicalCurrent) {
    return findPath(fromVersion, targetVersion) !== null;
  }

  function unsupportedVersion(fromVersion, targetVersion) {
    const comparison = compareNumericVersions(fromVersion, targetVersion);
    if (comparison !== null && comparison > 0) {
      return new SnapshotMigrationError(
        'FUTURE_SCHEMA_VERSION',
        `snapshot schema ${fromVersion} is newer than supported ${targetVersion}`,
      );
    }
    if (comparison !== null && comparison < 0) {
      return new SnapshotMigrationError(
        'UNSUPPORTED_OLD_SCHEMA_VERSION',
        `no migration path from ${fromVersion} to ${targetVersion}`,
      );
    }
    return new SnapshotMigrationError(
      'UNKNOWN_SCHEMA_VERSION',
      `no migration path from ${fromVersion} to ${targetVersion}`,
    );
  }

  function migrate(snapshot, targetVersion = canonicalCurrent) {
    try {
      requirePlainObject(snapshot, 'snapshot');
    } catch (error) {
      throw new SnapshotMigrationError('INVALID_MIGRATION_INPUT', error.message, undefined, { cause: error });
    }
    const fromVersion = requireVersion(snapshot.schemaVersion, 'snapshot.schemaVersion');
    const target = requireVersion(targetVersion, 'targetVersion');
    const path = findPath(fromVersion, target);
    if (path === null) throw unsupportedVersion(fromVersion, target);
    let current = cloneImmutable(snapshot);
    for (const edge of path) {
      let migrated;
      try {
        migrated = edge.migrate(current);
      } catch (error) {
        throw new SnapshotMigrationError('MIGRATION_FAILED', error.message, {
          fromVersion: edge.fromVersion,
          toVersion: edge.toVersion,
        }, { cause: error });
      }
      try {
        requirePlainObject(migrated, 'migratedSnapshot');
      } catch (error) {
        throw new SnapshotMigrationError('INVALID_MIGRATION_OUTPUT', error.message, {
          fromVersion: edge.fromVersion,
          toVersion: edge.toVersion,
        }, { cause: error });
      }
      if (migrated.schemaVersion !== edge.toVersion) {
        throw new SnapshotMigrationError(
          'INVALID_MIGRATION_OUTPUT',
          `migration ${edge.fromVersion} -> ${edge.toVersion} returned schemaVersion ${migrated.schemaVersion}`,
        );
      }
      current = cloneImmutable(migrated);
    }
    if (target === canonicalCurrent) validateLearnerSnapshot(current);
    return current;
  }

  const policy = Object.freeze({
    policyVersion: SNAPSHOT_MIGRATION_POLICY_VERSION,
    currentVersion: canonicalCurrent,
    registerMigration,
    canMigrate,
    migrate,
  });
  return policy;
}
