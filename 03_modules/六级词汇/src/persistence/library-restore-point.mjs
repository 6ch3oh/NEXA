import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
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
import { createJsonVocabularyImporter } from '../import/json-vocabulary-importer.mjs';
import { createInMemoryVocabularyStore } from '../store/vocabulary-store.mjs';
import { DEFAULT_MAX_RESTORE_POINTS, stableJsonStringify } from './restore-point.mjs';
import { processLocalSingleWriter } from './single-writer.mjs';
import { validateStudyContentLibraryCollection } from '../import/study-content-package-contract.mjs';

export const LIBRARY_RESTORE_POINT_VERSION = '0.1';
export const LIBRARY_RESTORE_POINT_FILE_SUFFIX = '.library-restore-point.json';
export const LibraryRestoreReason = Object.freeze({
  PRE_IMPORT: 'PRE_IMPORT',
  MANUAL_SAFE_POINT: 'MANUAL_SAFE_POINT',
});

const RECORD_KEYS = [
  'schemaVersion', 'restorePointId', 'createdAt', 'libraryIdentity', 'collectionId',
  'itemCount', 'contentHash', 'sourceManifestIdentity', 'importReceiptIdentity',
  'previousLibraryVersion', 'reason', 'librarySnapshot',
];

export class LibraryRestorePointError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'LibraryRestorePointError';
    this.code = code;
    this.details = details;
  }
}

function requireText(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} must be a non-empty string`);
  return value.trim();
}

function requireHash(value, path) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new LibraryRestorePointError('INVALID_LIBRARY_RESTORE_POINT_HASH', `${path} must be lowercase SHA-256 hex`);
  }
  return value;
}

function cloneJson(value, path) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new LibraryRestorePointError('INVALID_LIBRARY_SNAPSHOT', `${path} must contain JSON values only`, undefined, { cause: error });
  }
}

export function createCanonicalVocabularyLibrarySnapshot(input) {
  try {
    requireExactKeys(input, ['version', 'entries', 'imports', 'contentCollections'], 'librarySnapshot');
    requireRequiredKeys(input, ['version', 'entries', 'imports'], 'librarySnapshot');
    const version = requireText(input.version, 'librarySnapshot.version');
    if (!Array.isArray(input.entries)) throw new TypeError('librarySnapshot.entries must be an array');
    if (!Array.isArray(input.imports)) throw new TypeError('librarySnapshot.imports must be an array');
    const preview = createJsonVocabularyImporter(createInMemoryVocabularyStore()).preview(input.entries);
    if (!preview.ok) throw new TypeError(`invalid library entries: ${preview.error.code}`);
    if (input.contentCollections !== undefined && !Array.isArray(input.contentCollections)) throw new TypeError('librarySnapshot.contentCollections must be an array');
    const contentCollections = input.contentCollections?.map(validateStudyContentLibraryCollection);
    const snapshot = {
      version,
      entries: preview.entries,
      imports: cloneJson(input.imports, 'librarySnapshot.imports'),
      ...(contentCollections === undefined ? {} : { contentCollections }),
    };
    stableJsonStringify(snapshot);
    return deepFreeze(snapshot);
  } catch (error) {
    if (error instanceof LibraryRestorePointError) throw error;
    throw new LibraryRestorePointError('INVALID_LIBRARY_SNAPSHOT', error.message, undefined, { cause: error });
  }
}

export function calculateVocabularyLibraryHash(input) {
  const snapshot = createCanonicalVocabularyLibrarySnapshot(input);
  return createHash('sha256').update(stableJsonStringify(snapshot), 'utf8').digest('hex');
}

function sourceManifestIdentity(snapshot) {
  const manifest = snapshot.contentCollections?.at(-1)?.manifest ?? snapshot.imports.at(-1)?.manifest;
  if (manifest === undefined) return null;
  const provenance = manifest.provenance;
  return deepFreeze({
    packageId: normalizeIdentifier(manifest.packageId, 'sourceManifestIdentity.packageId'),
    packageVersion: requireText(manifest.packageVersion, 'sourceManifestIdentity.packageVersion'),
    contentDigest: requireHash(manifest.contentDigest, 'sourceManifestIdentity.contentDigest'),
    sourceId: normalizeIdentifier(provenance?.sourceId, 'sourceManifestIdentity.sourceId'),
    classification: requireText(provenance?.classification, 'sourceManifestIdentity.classification'),
  });
}

function importReceiptIdentity(snapshot) {
  const receiptId = snapshot.contentCollections?.at(-1)?.receipts?.at(-1)?.receiptId ?? snapshot.imports.at(-1)?.receipt?.receiptId;
  return receiptId === undefined ? null : normalizeIdentifier(receiptId, 'importReceiptIdentity');
}

function sameJson(left, right) {
  return stableJsonStringify(left) === stableJsonStringify(right);
}

export function validateLibraryRestorePoint(record) {
  try {
    requireExactKeys(record, RECORD_KEYS, 'libraryRestorePoint');
    requireRequiredKeys(record, RECORD_KEYS, 'libraryRestorePoint');
    if (record.schemaVersion !== LIBRARY_RESTORE_POINT_VERSION) {
      throw new LibraryRestorePointError(
        'UNSUPPORTED_LIBRARY_RESTORE_POINT_VERSION',
        `libraryRestorePoint.schemaVersion must be ${LIBRARY_RESTORE_POINT_VERSION}`,
      );
    }
    requireCanonicalValue(record.restorePointId, normalizeIdentifier(record.restorePointId, 'restorePointId'), 'restorePointId');
    requireCanonicalIsoDateTime(record.createdAt, 'createdAt');
    requireCanonicalValue(record.libraryIdentity, normalizeIdentifier(record.libraryIdentity, 'libraryIdentity'), 'libraryIdentity');
    requireCanonicalValue(record.collectionId, normalizeIdentifier(record.collectionId, 'collectionId'), 'collectionId');
    if (!Object.values(LibraryRestoreReason).includes(record.reason)) throw new TypeError('unsupported library restore reason');
    const snapshot = createCanonicalVocabularyLibrarySnapshot(record.librarySnapshot);
    requireInteger(record.itemCount, 'itemCount', { min: 0 });
    const expectedItemCount = snapshot.entries.length + (snapshot.contentCollections ?? []).reduce((sum, item) => sum + item.contents.length, 0);
    if (record.itemCount !== expectedItemCount) throw new TypeError('itemCount does not match library snapshot');
    requireHash(record.contentHash, 'contentHash');
    const actualHash = calculateVocabularyLibraryHash(snapshot);
    if (record.contentHash !== actualHash) {
      throw new LibraryRestorePointError('LIBRARY_RESTORE_POINT_HASH_MISMATCH', 'library restore point integrity check failed', {
        expected: record.contentHash,
        actual: actualHash,
      });
    }
    if (record.previousLibraryVersion !== snapshot.version) throw new TypeError('previousLibraryVersion does not match snapshot');
    const expectedManifest = sourceManifestIdentity(snapshot);
    if (!sameJson(record.sourceManifestIdentity, expectedManifest)) throw new TypeError('sourceManifestIdentity does not match snapshot');
    const expectedReceipt = importReceiptIdentity(snapshot);
    if (record.importReceiptIdentity !== expectedReceipt) throw new TypeError('importReceiptIdentity does not match snapshot');
    return record;
  } catch (error) {
    if (error instanceof LibraryRestorePointError) throw error;
    throw new LibraryRestorePointError('INVALID_LIBRARY_RESTORE_POINT', error.message, undefined, { cause: error });
  }
}

export function createLibraryRestorePointRecord({
  restorePointId,
  createdAt,
  libraryIdentity,
  collectionId,
  reason,
  librarySnapshot,
}) {
  const snapshot = createCanonicalVocabularyLibrarySnapshot(librarySnapshot);
  const record = {
    schemaVersion: LIBRARY_RESTORE_POINT_VERSION,
    restorePointId: normalizeIdentifier(restorePointId, 'restorePointId'),
    createdAt: requireCanonicalIsoDateTime(createdAt, 'createdAt'),
    libraryIdentity: normalizeIdentifier(libraryIdentity, 'libraryIdentity'),
    collectionId: normalizeIdentifier(collectionId, 'collectionId'),
    itemCount: snapshot.entries.length + (snapshot.contentCollections ?? []).reduce((sum, item) => sum + item.contents.length, 0),
    contentHash: calculateVocabularyLibraryHash(snapshot),
    sourceManifestIdentity: sourceManifestIdentity(snapshot),
    importReceiptIdentity: importReceiptIdentity(snapshot),
    previousLibraryVersion: snapshot.version,
    reason,
    librarySnapshot: snapshot,
  };
  validateLibraryRestorePoint(record);
  return deepFreeze(record);
}

export function parseLibraryRestorePoint(input) {
  if (typeof input !== 'string') throw new LibraryRestorePointError('INVALID_LIBRARY_RESTORE_POINT_JSON', 'JSON string required');
  let record;
  try { record = JSON.parse(input); }
  catch (error) {
    throw new LibraryRestorePointError('INVALID_LIBRARY_RESTORE_POINT_JSON', 'library restore point is not valid JSON', undefined, { cause: error });
  }
  validateLibraryRestorePoint(record);
  return deepFreeze(record);
}

function compareRecords(left, right) {
  return left.createdAt.localeCompare(right.createdAt) || left.restorePointId.localeCompare(right.restorePointId);
}

function metadata(record) {
  return deepFreeze({
    schemaVersion: record.schemaVersion,
    restorePointId: record.restorePointId,
    createdAt: record.createdAt,
    libraryIdentity: record.libraryIdentity,
    collectionId: record.collectionId,
    itemCount: record.itemCount,
    contentHash: record.contentHash,
    sourceManifestIdentity: record.sourceManifestIdentity,
    importReceiptIdentity: record.importReceiptIdentity,
    previousLibraryVersion: record.previousLibraryVersion,
    reason: record.reason,
  });
}

export function createLocalVocabularyLibraryRestorePointManager({
  directoryPath,
  library,
  libraryIdentity = 'cet6-vocabulary-library',
  collectionId = 'cet6-vocabulary',
  maxRestorePoints = DEFAULT_MAX_RESTORE_POINTS,
  writerCoordinator = processLocalSingleWriter,
}) {
  if (typeof directoryPath !== 'string' || !isAbsolute(directoryPath)) {
    throw new LibraryRestorePointError('INVALID_LIBRARY_RESTORE_POINT_PATH', 'absolute directoryPath required');
  }
  if (library === null || typeof library !== 'object' || typeof library.load !== 'function' || typeof library.save !== 'function') {
    throw new LibraryRestorePointError('INVALID_LIBRARY_ADAPTER', 'library.load() and library.save() are required');
  }
  const canonicalLibraryIdentity = normalizeIdentifier(libraryIdentity, 'libraryIdentity');
  const canonicalCollectionId = normalizeIdentifier(collectionId, 'collectionId');
  const limit = requireInteger(maxRestorePoints, 'maxRestorePoints', { min: 1, max: 100 });
  if (writerCoordinator === null || typeof writerCoordinator !== 'object' || typeof writerCoordinator.run !== 'function') {
    throw new LibraryRestorePointError('INVALID_WRITER_COORDINATOR', 'writerCoordinator.run() is required');
  }
  const writerTarget = `vocabulary-library-restore:${library.filePath ?? canonicalLibraryIdentity}`;

  function pathFor(restorePointId) {
    return join(directoryPath, `${encodeURIComponent(normalizeIdentifier(restorePointId, 'restorePointId'))}${LIBRARY_RESTORE_POINT_FILE_SUFFIX}`);
  }

  async function exists(path) {
    try { return (await stat(path)).isFile(); }
    catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw new LibraryRestorePointError('LIBRARY_RESTORE_POINT_IO_FAILED', error.message, { path }, { cause: error });
    }
  }

  async function loadRecordsUnlocked() {
    let names;
    try { names = await readdir(directoryPath); }
    catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw new LibraryRestorePointError('LIBRARY_RESTORE_POINT_IO_FAILED', error.message, { directoryPath }, { cause: error });
    }
    const records = [];
    for (const name of names.filter((item) => item.endsWith(LIBRARY_RESTORE_POINT_FILE_SUFFIX)).sort()) {
      records.push(parseLibraryRestorePoint(await readFile(join(directoryPath, name), 'utf8')));
    }
    return records.sort(compareRecords);
  }

  async function safeWrite(record) {
    await mkdir(directoryPath, { recursive: true });
    const finalPath = pathFor(record.restorePointId);
    if (await exists(finalPath)) throw new LibraryRestorePointError('DUPLICATE_LIBRARY_RESTORE_POINT', `restore point already exists: ${record.restorePointId}`);
    const temporaryPath = join(directoryPath, `.${basename(finalPath)}.tmp-${process.pid}-${Date.now()}`);
    let handle = null;
    let renamed = false;
    try {
      handle = await open(temporaryPath, 'wx');
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporaryPath, finalPath);
      renamed = true;
    } catch (error) {
      if (error instanceof LibraryRestorePointError) throw error;
      throw new LibraryRestorePointError('LIBRARY_RESTORE_POINT_WRITE_FAILED', error.message, { restorePointId: record.restorePointId }, { cause: error });
    } finally {
      if (handle) { try { await handle.close(); } catch { /* preserve primary error */ } }
      if (!renamed) { try { await unlink(temporaryPath); } catch { /* best-effort temp cleanup */ } }
    }
  }

  async function createUnlocked(input) {
    const snapshot = input.librarySnapshot ?? await library.load();
    const record = createLibraryRestorePointRecord({
      ...input,
      libraryIdentity: canonicalLibraryIdentity,
      collectionId: canonicalCollectionId,
      librarySnapshot: snapshot,
    });
    await safeWrite(record);
    const records = await loadRecordsUnlocked();
    const prunedRestorePointIds = [];
    while (records.length > limit) {
      const oldest = records.shift();
      await unlink(pathFor(oldest.restorePointId));
      prunedRestorePointIds.push(oldest.restorePointId);
    }
    return deepFreeze({ restorePoint: record, prunedRestorePointIds });
  }

  async function inspectUnlocked(restorePointId) {
    const canonicalId = normalizeIdentifier(restorePointId, 'restorePointId');
    const path = pathFor(canonicalId);
    if (!(await exists(path))) throw new LibraryRestorePointError('LIBRARY_RESTORE_POINT_NOT_FOUND', `restore point not found: ${canonicalId}`);
    return parseLibraryRestorePoint(await readFile(path, 'utf8'));
  }

  async function listUnlocked() {
    return deepFreeze((await loadRecordsUnlocked()).map(metadata));
  }

  async function restoreUnlocked(restorePointId) {
    const record = await inspectUnlocked(restorePointId);
    await library.save(record.librarySnapshot);
    const reloaded = createCanonicalVocabularyLibrarySnapshot(await library.load());
    const actualHash = calculateVocabularyLibraryHash(reloaded);
    const actualItemCount = reloaded.entries.length + (reloaded.contentCollections ?? []).reduce((sum, item) => sum + item.contents.length, 0);
    if (actualHash !== record.contentHash || actualItemCount !== record.itemCount) {
      throw new LibraryRestorePointError('LIBRARY_RESTORE_VALIDATION_FAILED', 'restored library failed integrity validation', {
        expectedHash: record.contentHash,
        actualHash,
        expectedItemCount: record.itemCount,
        actualItemCount,
      });
    }
    return deepFreeze({ restored: true, restartRequired: true, restorePoint: metadata(record), library: reloaded });
  }

  const transactionApi = Object.freeze({
    createRestorePoint: createUnlocked,
    inspectRestorePoint: inspectUnlocked,
    listRestorePoints: listUnlocked,
    restoreLibraryRestorePoint: restoreUnlocked,
  });

  function withTransaction(operation) {
    if (typeof operation !== 'function') throw new TypeError('transaction operation function required');
    return writerCoordinator.run(writerTarget, () => operation(transactionApi));
  }

  return Object.freeze({
    managerVersion: LIBRARY_RESTORE_POINT_VERSION,
    directoryPath,
    libraryIdentity: canonicalLibraryIdentity,
    collectionId: canonicalCollectionId,
    maxRestorePoints: limit,
    getRestorePointPath: pathFor,
    withTransaction,
    createRestorePoint: (input) => withTransaction((transaction) => transaction.createRestorePoint(input)),
    listRestorePoints: () => withTransaction((transaction) => transaction.listRestorePoints()),
    inspectRestorePoint: (restorePointId) => withTransaction((transaction) => transaction.inspectRestorePoint(restorePointId)),
    restoreLibraryRestorePoint: (restorePointId) => withTransaction((transaction) => transaction.restoreLibraryRestorePoint(restorePointId)),
  });
}
