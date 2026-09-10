import { createHash } from 'node:crypto';
import {
  deepFreeze,
  normalizeIdentifier,
  requireCanonicalIsoDateTime,
  requireInteger,
} from '../domain/shared.mjs';
import { VocabularySourceClassification } from './source-classified-json-importer.mjs';

export const VOCABULARY_PACKAGE_CONTRACT_VERSION = '0.1';

export function createVocabularyProvenance(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('provenance object required');
  const classification = input.classification;
  if (!Object.values(VocabularySourceClassification).includes(classification)) {
    throw new TypeError(`unsupported source classification: ${classification}`);
  }
  const evidenceRefs = normalizeStrings(input.evidenceRefs ?? [], 'evidenceRefs');
  const originUrl = nullableString(input.originUrl, 'originUrl');
  const licenseId = nullableString(input.licenseId, 'licenseId');
  const rightsHolder = nullableString(input.rightsHolder, 'rightsHolder');
  if (classification === VocabularySourceClassification.OFFICIAL
    && (originUrl === null || evidenceRefs.length === 0)) {
    throw new TypeError('OFFICIAL provenance requires originUrl and evidenceRefs');
  }
  if (classification === VocabularySourceClassification.THIRD_PARTY
    && (licenseId === null || evidenceRefs.length === 0)) {
    throw new TypeError('THIRD_PARTY provenance requires licenseId and evidenceRefs');
  }
  const permissions = input.permissions ?? {};
  for (const key of ['localStorage', 'modification', 'redistribution']) {
    if (typeof permissions[key] !== 'boolean') throw new TypeError(`permissions.${key} must be boolean`);
  }
  return deepFreeze({
    contractVersion: VOCABULARY_PACKAGE_CONTRACT_VERSION,
    sourceId: normalizeIdentifier(input.sourceId, 'sourceId'),
    classification,
    title: requireText(input.title, 'title'),
    originUrl,
    licenseId,
    rightsHolder,
    evidenceRefs,
    acquiredAt: requireCanonicalIsoDateTime(input.acquiredAt, 'acquiredAt'),
    permissions: {
      localStorage: permissions.localStorage,
      modification: permissions.modification,
      redistribution: permissions.redistribution,
    },
    notes: nullableString(input.notes, 'notes'),
  });
}

export function calculateVocabularyContentDigest(entries) {
  if (!Array.isArray(entries)) throw new TypeError('entries array required');
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

export function createVocabularyPackageManifest(input) {
  const provenance = createVocabularyProvenance(input.provenance);
  const manifest = {
    contractVersion: VOCABULARY_PACKAGE_CONTRACT_VERSION,
    packageId: normalizeIdentifier(input.packageId, 'packageId'),
    packageVersion: requireText(input.packageVersion, 'packageVersion'),
    collectionId: normalizeIdentifier(input.collectionId, 'collectionId'),
    entryCount: requireInteger(input.entryCount, 'entryCount', { min: 0 }),
    contentDigest: requireDigest(input.contentDigest),
    provenance,
    createdAt: requireCanonicalIsoDateTime(input.createdAt, 'createdAt'),
  };
  return deepFreeze(manifest);
}

export function createVocabularyImportReceipt(input) {
  const entryIds = normalizeStrings(input.entryIds, 'entryIds');
  if (!Object.values(VocabularySourceClassification).includes(input.classification)) {
    throw new TypeError(`unsupported source classification: ${input.classification}`);
  }
  const importedCount = requireInteger(input.importedCount, 'importedCount', { min: 0 });
  if (entryIds.length !== importedCount) throw new TypeError('entryIds length must equal importedCount');
  const rollbackSupported = input.rollbackSupported ?? false;
  if (typeof rollbackSupported !== 'boolean') throw new TypeError('rollbackSupported must be boolean');
  const preImportRestorePointId = input.preImportRestorePointId === undefined || input.preImportRestorePointId === null
    ? null
    : normalizeIdentifier(input.preImportRestorePointId, 'preImportRestorePointId');
  if (rollbackSupported && preImportRestorePointId === null) {
    throw new TypeError('rollbackSupported requires preImportRestorePointId');
  }
  if (!rollbackSupported && preImportRestorePointId !== null) {
    throw new TypeError('preImportRestorePointId requires rollbackSupported');
  }
  return deepFreeze({
    contractVersion: VOCABULARY_PACKAGE_CONTRACT_VERSION,
    receiptId: normalizeIdentifier(input.receiptId, 'receiptId'),
    packageId: normalizeIdentifier(input.packageId, 'packageId'),
    packageVersion: requireText(input.packageVersion, 'packageVersion'),
    collectionId: normalizeIdentifier(input.collectionId, 'collectionId'),
    contentDigest: requireDigest(input.contentDigest),
    sourceId: normalizeIdentifier(input.sourceId, 'sourceId'),
    classification: input.classification,
    importedAt: requireCanonicalIsoDateTime(input.importedAt, 'importedAt'),
    importedCount,
    entryIds,
    safetyBoundary: rollbackSupported ? 'PRE_IMPORT_RESTORE_POINT_AND_ATOMIC_COMMIT' : 'ATOMIC_ADD_MANY',
    rollbackSupported,
    preImportRestorePointId,
  });
}

function requireDigest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError('contentDigest must be SHA-256 hex');
  return value;
}

function requireText(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} must be a non-empty string`);
  return value.trim();
}

function nullableString(value, path) {
  if (value === undefined || value === null) return null;
  return requireText(value, path);
}

function normalizeStrings(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  const result = value.map((item, index) => requireText(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${path} must not contain duplicates`);
  return result;
}
