import { createHash, randomUUID } from 'node:crypto';
import { deepFreeze, normalizeIdentifier, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { createInMemoryStudyContentCatalog } from '../content/study-content-catalog.mjs';
import {
  GenericStudyImportFormat,
  GenericStudySourceClassification,
  createGenericStudyContentImporter,
} from './generic-study-content-importer.mjs';

export const STUDY_CONTENT_PACKAGE_CONTRACT_VERSION = '0.1';

export function calculateStudyContentDigest(contents) {
  if (!Array.isArray(contents)) throw new TypeError('contents array required');
  return createHash('sha256').update(JSON.stringify(contents), 'utf8').digest('hex');
}

export function createStudyContentProvenance(input) {
  requireObject(input, 'provenance');
  const classification = requireEnum(input.classification, Object.values(GenericStudySourceClassification), 'provenance.classification');
  const official = input.official === false ? false : fail('provenance.official must be false for the current generic source contract');
  const publicExamAuthority = input.publicExamAuthority == null ? null : requireText(input.publicExamAuthority, 'provenance.publicExamAuthority');
  if (classification === GenericStudySourceClassification.SYNTHETIC && publicExamAuthority !== null) {
    throw new TypeError('SYNTHETIC provenance cannot claim a public exam authority');
  }
  const permissions = input.permissions;
  requireObject(permissions, 'provenance.permissions');
  for (const key of ['localStorage', 'modification', 'redistribution']) {
    if (typeof permissions[key] !== 'boolean') throw new TypeError(`provenance.permissions.${key} boolean required`);
  }
  return deepFreeze({
    sourceId: normalizeIdentifier(input.sourceId, 'provenance.sourceId'),
    classification,
    title: requireText(input.title, 'provenance.title'),
    official,
    publicExamAuthority,
    originUrl: optionalText(input.originUrl, 'provenance.originUrl'),
    licenseId: optionalText(input.licenseId, 'provenance.licenseId'),
    evidenceRefs: requireStringArray(input.evidenceRefs ?? [], 'provenance.evidenceRefs'),
    acquiredAt: requireCanonicalIsoDateTime(input.acquiredAt, 'provenance.acquiredAt'),
    permissions: deepFreeze({ ...permissions }),
    notes: optionalText(input.notes, 'provenance.notes'),
  });
}

export function createStudyContentPackageManifest(input) {
  requireObject(input, 'manifest');
  const provenance = createStudyContentProvenance(input.provenance);
  const manifest = {
    schemaVersion: STUDY_CONTENT_PACKAGE_CONTRACT_VERSION,
    packageId: normalizeIdentifier(input.packageId, 'manifest.packageId'),
    packageVersion: requireText(input.packageVersion, 'manifest.packageVersion'),
    collectionId: normalizeIdentifier(input.collectionId, 'manifest.collectionId'),
    contentType: normalizeIdentifier(input.contentType, 'manifest.contentType'),
    itemCount: requireCount(input.itemCount, 'manifest.itemCount'),
    contentDigest: requireHash(input.contentDigest, 'manifest.contentDigest'),
    provenance,
    createdAt: requireCanonicalIsoDateTime(input.createdAt, 'manifest.createdAt'),
  };
  if (!provenance.permissions.localStorage) throw new TypeError('manifest provenance does not permit local storage');
  return deepFreeze(manifest);
}

export function createStudyContentImportReceipt(input) {
  requireObject(input, 'receipt');
  return deepFreeze({
    schemaVersion: STUDY_CONTENT_PACKAGE_CONTRACT_VERSION,
    receiptId: normalizeIdentifier(input.receiptId, 'receipt.receiptId'),
    packageId: normalizeIdentifier(input.packageId, 'receipt.packageId'),
    collectionId: normalizeIdentifier(input.collectionId, 'receipt.collectionId'),
    contentType: normalizeIdentifier(input.contentType, 'receipt.contentType'),
    importedCount: requireCount(input.importedCount, 'receipt.importedCount'),
    contentDigest: requireHash(input.contentDigest, 'receipt.contentDigest'),
    importedAt: requireCanonicalIsoDateTime(input.importedAt, 'receipt.importedAt'),
    restorePointId: input.restorePointId == null ? null : normalizeIdentifier(input.restorePointId, 'receipt.restorePointId'),
    rollbackCapable: input.rollbackCapable === true,
    persisted: input.persisted === true,
  });
}

export function createGenericStudyContentPackageImporter({ catalog, clock = () => new Date().toISOString() }) {
  if (typeof catalog?.addMany !== 'function' || typeof catalog?.get !== 'function') throw new TypeError('catalog required');

  function dryRun({ input, manifest }) {
    try {
      const canonicalManifest = createStudyContentPackageManifest(manifest);
      const source = sourceFrom(canonicalManifest);
      const importer = createGenericStudyContentImporter({ format: GenericStudyImportFormat.JSON, catalog, source });
      const preview = importer.preview(input);
      if (!preview.ok) return preview;
      if (preview.contentCount !== canonicalManifest.itemCount) return failure('MANIFEST_COUNT_MISMATCH', 'manifest itemCount does not match content');
      if (preview.contentDigest !== canonicalManifest.contentDigest) return failure('MANIFEST_DIGEST_MISMATCH', 'manifest digest does not match content');
      if (preview.contents.some((content) => content.contentType !== canonicalManifest.contentType)) {
        return failure('MANIFEST_CONTENT_TYPE_MISMATCH', 'manifest contentType does not match every item');
      }
      return deepFreeze({ ok: true, packageVersion: STUDY_CONTENT_PACKAGE_CONTRACT_VERSION, manifest: canonicalManifest, source, contents: preview.contents, contentCount: preview.contentCount, contentDigest: preview.contentDigest, mutationCount: 0 });
    } catch (error) {
      return failure('INVALID_STUDY_CONTENT_PACKAGE', error.message);
    }
  }

  function importPackage({ input, manifest, receiptId = `study-content-receipt:${randomUUID()}`, restorePointId = null, persisted = false }) {
    const preview = dryRun({ input, manifest });
    if (!preview.ok) return preview;
    try {
      catalog.addMany(preview.contents);
      const importedAt = requireCanonicalIsoDateTime(clock(), 'clock()');
      const receipt = createStudyContentImportReceipt({
        receiptId,
        packageId: preview.manifest.packageId,
        collectionId: preview.manifest.collectionId,
        contentType: preview.manifest.contentType,
        importedCount: preview.contentCount,
        contentDigest: preview.contentDigest,
        importedAt,
        restorePointId,
        rollbackCapable: restorePointId !== null,
        persisted,
      });
      return deepFreeze({ ok: true, packageVersion: STUDY_CONTENT_PACKAGE_CONTRACT_VERSION, manifest: preview.manifest, provenance: preview.manifest.provenance, receipt, contents: preview.contents });
    } catch (error) {
      return failure('CATALOG_REJECTED', error.message);
    }
  }

  return Object.freeze({ packageVersion: STUDY_CONTENT_PACKAGE_CONTRACT_VERSION, dryRun, import: importPackage });
}

export function validateStudyContentLibraryCollection(input) {
  requireObject(input, 'contentCollection');
  const manifest = createStudyContentPackageManifest(input.manifest);
  if (!Array.isArray(input.contents)) throw new TypeError('contentCollection.contents array required');
  if (!Array.isArray(input.receipts)) throw new TypeError('contentCollection.receipts array required');
  const catalog = createInMemoryStudyContentCatalog();
  const importer = createGenericStudyContentImporter({ format: GenericStudyImportFormat.JSON, catalog, source: sourceFrom(manifest) });
  const preview = importer.preview(JSON.stringify({ schemaVersion: '0.1', contents: input.contents }));
  if (!preview.ok) throw new TypeError(`invalid contentCollection contents: ${preview.error.code}`);
  if (preview.contentCount !== manifest.itemCount || preview.contentDigest !== manifest.contentDigest) throw new TypeError('contentCollection does not match manifest');
  const receipts = input.receipts.map(createStudyContentImportReceipt);
  if (receipts.some((receipt) => receipt.collectionId !== manifest.collectionId || receipt.contentDigest !== manifest.contentDigest)) throw new TypeError('contentCollection receipt mismatch');
  return deepFreeze({ manifest, contents: preview.contents, receipts });
}

function sourceFrom(manifest) {
  return {
    classification: manifest.provenance.classification,
    sourceRef: manifest.provenance.sourceId,
    licenseId: manifest.provenance.licenseId,
    evidenceRef: manifest.provenance.evidenceRefs[0] ?? null,
    importedAt: manifest.provenance.acquiredAt,
  };
}
function requireObject(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} object required`); }
function requireText(value, path) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} required`); return value.trim(); }
function optionalText(value, path) { return value == null ? null : requireText(value, path); }
function requireStringArray(value, path) { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) throw new TypeError(`${path} string array required`); return deepFreeze([...new Set(value.map((item) => item.trim()))]); }
function requireEnum(value, values, path) { if (!values.includes(value)) throw new TypeError(`${path} unsupported`); return value; }
function requireCount(value, path) { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${path} non-negative integer required`); return value; }
function requireHash(value, path) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${path} SHA-256 required`); return value; }
function fail(message) { throw new TypeError(message); }
function failure(code, message) { return deepFreeze({ ok: false, error: { code, message } }); }
