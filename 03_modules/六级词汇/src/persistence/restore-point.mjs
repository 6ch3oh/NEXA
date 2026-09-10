import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import {
  deepFreeze,
  normalizeIdentifier,
  requireCanonicalIsoDateTime,
  requireCanonicalValue,
  requireExactKeys,
  requireInteger,
  requirePlainObject,
  requireRequiredKeys,
} from '../domain/shared.mjs';
import { hydrateLearnerSnapshot, validateLearnerSnapshot } from './learner-snapshot.mjs';
import { createSnapshotMigrationPolicy } from './snapshot-migration.mjs';
import { SINGLE_WRITER_SCOPE, processLocalSingleWriter } from './single-writer.mjs';

export const RESTORE_POINT_VERSION = '0.1';
export const DEFAULT_MAX_RESTORE_POINTS = 5;
export const RESTORE_POINT_FILE_SUFFIX = '.restore-point.json';

const RESTORE_POINT_KEYS = [
  'schemaVersion', 'restorePointId', 'createdAt', 'sourceSnapshotHash', 'snapshot',
];

export class RestorePointError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'RestorePointError';
    this.code = code;
    this.details = details;
  }
}

function canonicalJsonValue(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new RestorePointError('INVALID_INTEGRITY_INPUT', 'cyclic value is not supported');
    ancestors.add(value);
    const result = value.map((item) => canonicalJsonValue(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (value !== null && typeof value === 'object') {
    requirePlainObject(value, 'integrityValue');
    if (ancestors.has(value)) throw new RestorePointError('INVALID_INTEGRITY_INPUT', 'cyclic value is not supported');
    ancestors.add(value);
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalJsonValue(value[key], ancestors);
    ancestors.delete(value);
    return result;
  }
  throw new RestorePointError('INVALID_INTEGRITY_INPUT', 'only JSON values can be hashed');
}

export function stableJsonStringify(value) {
  return JSON.stringify(canonicalJsonValue(value));
}

export function calculateSnapshotHash(snapshot) {
  return createHash('sha256').update(stableJsonStringify(snapshot), 'utf8').digest('hex');
}

function canonicalRestorePointId(value, path = 'restorePointId') {
  return normalizeIdentifier(value, path);
}

export function validateRestorePoint(restorePoint) {
  try {
    requireExactKeys(restorePoint, RESTORE_POINT_KEYS, 'restorePoint');
    requireRequiredKeys(restorePoint, RESTORE_POINT_KEYS, 'restorePoint');
    if (restorePoint.schemaVersion !== RESTORE_POINT_VERSION) {
      throw new RestorePointError(
        'UNSUPPORTED_RESTORE_POINT_VERSION',
        `restorePoint.schemaVersion must be ${RESTORE_POINT_VERSION}`,
      );
    }
    requireCanonicalValue(
      restorePoint.restorePointId,
      canonicalRestorePointId(restorePoint.restorePointId, 'restorePoint.restorePointId'),
      'restorePoint.restorePointId',
    );
    requireCanonicalIsoDateTime(restorePoint.createdAt, 'restorePoint.createdAt');
    requirePlainObject(restorePoint.snapshot, 'restorePoint.snapshot');
    if (typeof restorePoint.snapshot.schemaVersion !== 'string' || restorePoint.snapshot.schemaVersion === '') {
      throw new RestorePointError('INVALID_RESTORE_POINT', 'snapshot.schemaVersion is required');
    }
    if (typeof restorePoint.sourceSnapshotHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(restorePoint.sourceSnapshotHash)) {
      throw new RestorePointError('INVALID_RESTORE_POINT_HASH', 'sourceSnapshotHash must be lowercase SHA-256 hex');
    }
  } catch (error) {
    if (error instanceof RestorePointError) throw error;
    throw new RestorePointError('INVALID_RESTORE_POINT', error.message, undefined, { cause: error });
  }
  const actualHash = calculateSnapshotHash(restorePoint.snapshot);
  if (actualHash !== restorePoint.sourceSnapshotHash) {
    throw new RestorePointError('RESTORE_POINT_HASH_MISMATCH', 'restore point snapshot integrity check failed', {
      expected: restorePoint.sourceSnapshotHash,
      actual: actualHash,
    });
  }
  return restorePoint;
}

export function createRestorePointRecord({ restorePointId, createdAt, snapshot }) {
  validateLearnerSnapshot(snapshot);
  const record = {
    schemaVersion: RESTORE_POINT_VERSION,
    restorePointId: canonicalRestorePointId(restorePointId),
    createdAt: requireCanonicalIsoDateTime(createdAt, 'createdAt'),
    sourceSnapshotHash: calculateSnapshotHash(snapshot),
    snapshot,
  };
  validateRestorePoint(record);
  return deepFreeze(record);
}

export function parseRestorePoint(input) {
  if (typeof input !== 'string') {
    throw new RestorePointError('INVALID_RESTORE_POINT_JSON', 'restore point JSON input must be a string');
  }
  let value;
  try {
    value = JSON.parse(input);
  } catch (error) {
    throw new RestorePointError('INVALID_RESTORE_POINT_JSON', 'restore point is not valid JSON', undefined, {
      cause: error,
    });
  }
  validateRestorePoint(value);
  return deepFreeze(value);
}

function compareRestorePoints(left, right) {
  if (left.createdAt < right.createdAt) return -1;
  if (left.createdAt > right.createdAt) return 1;
  if (left.restorePointId < right.restorePointId) return -1;
  if (left.restorePointId > right.restorePointId) return 1;
  return 0;
}

export function createLocalRestorePointManager({
  directoryPath,
  maxRestorePoints = DEFAULT_MAX_RESTORE_POINTS,
  migrationPolicy = createSnapshotMigrationPolicy(),
  writerCoordinator = processLocalSingleWriter,
}) {
  if (typeof directoryPath !== 'string' || directoryPath.trim() === '' || !isAbsolute(directoryPath)) {
    throw new RestorePointError('INVALID_RESTORE_POINT_PATH', 'directoryPath must be an explicit absolute path');
  }
  const limit = requireInteger(maxRestorePoints, 'maxRestorePoints', { min: 1, max: 100 });
  if (migrationPolicy === null || typeof migrationPolicy !== 'object'
    || typeof migrationPolicy.migrate !== 'function') {
    throw new RestorePointError('INVALID_MIGRATION_POLICY', 'migrationPolicy.migrate() is required');
  }
  if (writerCoordinator === null || typeof writerCoordinator !== 'object'
    || typeof writerCoordinator.run !== 'function') {
    throw new RestorePointError('INVALID_WRITER_COORDINATOR', 'writerCoordinator.run() is required');
  }
  const writerTarget = `restore-points:${directoryPath}`;

  function pathFor(restorePointId) {
    const fileId = encodeURIComponent(canonicalRestorePointId(restorePointId));
    return join(directoryPath, `${fileId}${RESTORE_POINT_FILE_SUFFIX}`);
  }

  async function exists(path) {
    try {
      return (await stat(path)).isFile();
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw new RestorePointError('RESTORE_POINT_IO_FAILED', error.message, { path }, { cause: error });
    }
  }

  async function loadRecords() {
    let names;
    try {
      names = await readdir(directoryPath);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw new RestorePointError('RESTORE_POINT_IO_FAILED', error.message, { directoryPath }, { cause: error });
    }
    const records = [];
    for (const name of names.filter((item) => item.endsWith(RESTORE_POINT_FILE_SUFFIX)).sort()) {
      const path = join(directoryPath, name);
      try {
        records.push(parseRestorePoint(await readFile(path, 'utf8')));
      } catch (error) {
        if (error instanceof RestorePointError) throw error;
        throw new RestorePointError('RESTORE_POINT_IO_FAILED', error.message, { path }, { cause: error });
      }
    }
    return records.sort(compareRestorePoints);
  }

  async function listRestorePoints() {
    const records = await loadRecords();
    return deepFreeze(records.map((record) => ({
      schemaVersion: record.schemaVersion,
      restorePointId: record.restorePointId,
      createdAt: record.createdAt,
      sourceSnapshotHash: record.sourceSnapshotHash,
      snapshotSchemaVersion: record.snapshot.schemaVersion,
    })));
  }

  async function safeWrite(record) {
    await mkdir(directoryPath, { recursive: true });
    const finalPath = pathFor(record.restorePointId);
    if (await exists(finalPath)) {
      throw new RestorePointError('DUPLICATE_RESTORE_POINT', `restore point already exists: ${record.restorePointId}`);
    }
    const tempPath = join(
      directoryPath,
      `.${basename(finalPath)}.tmp-${process.pid}-${Date.now()}`,
    );
    let handle = null;
    let renamed = false;
    try {
      handle = await open(tempPath, 'wx');
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(tempPath, finalPath);
      renamed = true;
    } catch (error) {
      if (error instanceof RestorePointError) throw error;
      throw new RestorePointError('RESTORE_POINT_WRITE_FAILED', error.message, {
        restorePointId: record.restorePointId,
      }, { cause: error });
    } finally {
      if (handle !== null) {
        try { await handle.close(); } catch { /* preserve primary error */ }
      }
      if (!renamed) {
        try { await unlink(tempPath); } catch { /* cleanup is best effort and never touches finalPath */ }
      }
    }
  }

  async function createRestorePoint(input) {
    const record = createRestorePointRecord(input);
    return writerCoordinator.run(writerTarget, async () => {
      await safeWrite(record);
      const records = await loadRecords();
      const prunedRestorePointIds = [];
      while (records.length > limit) {
        const oldest = records.shift();
        await unlink(pathFor(oldest.restorePointId));
        prunedRestorePointIds.push(oldest.restorePointId);
      }
      return deepFreeze({ restorePoint: record, prunedRestorePointIds });
    });
  }

  async function restoreFromPoint(restorePointId) {
    const canonicalId = canonicalRestorePointId(restorePointId);
    const path = pathFor(canonicalId);
    if (!(await exists(path))) {
      throw new RestorePointError('RESTORE_POINT_NOT_FOUND', `restore point not found: ${canonicalId}`);
    }
    const record = parseRestorePoint(await readFile(path, 'utf8'));
    const snapshot = migrationPolicy.migrate(record.snapshot);
    validateLearnerSnapshot(snapshot);
    return Object.freeze({
      restorePoint: record,
      snapshot,
      partition: hydrateLearnerSnapshot(snapshot),
    });
  }

  async function deleteRestorePoint(restorePointId) {
    const canonicalId = canonicalRestorePointId(restorePointId);
    return writerCoordinator.run(writerTarget, async () => {
      const path = pathFor(canonicalId);
      try {
        await unlink(path);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw new RestorePointError('RESTORE_POINT_NOT_FOUND', `restore point not found: ${canonicalId}`);
        }
        throw new RestorePointError('RESTORE_POINT_IO_FAILED', error.message, { path }, { cause: error });
      }
      return true;
    });
  }

  return Object.freeze({
    managerVersion: RESTORE_POINT_VERSION,
    writerScope: SINGLE_WRITER_SCOPE,
    directoryPath,
    maxRestorePoints: limit,
    getRestorePointPath: pathFor,
    createRestorePoint,
    listRestorePoints,
    restoreFromPoint,
    deleteRestorePoint,
  });
}
