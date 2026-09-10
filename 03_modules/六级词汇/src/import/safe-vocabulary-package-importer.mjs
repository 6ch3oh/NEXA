import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { ImportErrorCode, createImportFailure } from './importer-contract.mjs';
import { createSourceClassifiedJsonVocabularyImporter } from './source-classified-json-importer.mjs';
import {
  calculateVocabularyContentDigest,
  createVocabularyImportReceipt,
  createVocabularyPackageManifest,
} from './vocabulary-package-contract.mjs';
import { createVocabularyQualityReport } from './vocabulary-quality-report.mjs';

export const SAFE_VOCABULARY_PACKAGE_IMPORTER_VERSION = '0.1';

export function createSafeVocabularyPackageImporter({ store, clock = () => new Date().toISOString() }) {
  assertVocabularyStore(store);
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  function dryRun({ input, manifest: manifestInput }) {
    let manifest;
    try {
      manifest = createVocabularyPackageManifest(manifestInput);
    } catch (error) {
      return createImportFailure('INVALID_MANIFEST', error.message);
    }
    if (!manifest.provenance.permissions.localStorage) {
      return createImportFailure('LOCAL_STORAGE_NOT_PERMITTED', 'source rights do not permit local storage');
    }
    const importer = createSourceClassifiedJsonVocabularyImporter(store, {
      classification: manifest.provenance.classification,
      evidenceRef: manifest.provenance.evidenceRefs[0] ?? null,
    });
    const preview = importer.preview(input);
    if (!preview.ok) return preview;
    const digest = calculateVocabularyContentDigest(preview.entries);
    if (manifest.entryCount !== preview.entryCount) {
      return createImportFailure('MANIFEST_ENTRY_COUNT_MISMATCH', 'manifest entryCount does not match content', {
        expected: manifest.entryCount,
        actual: preview.entryCount,
      });
    }
    if (manifest.contentDigest !== digest) {
      return createImportFailure('MANIFEST_DIGEST_MISMATCH', 'manifest contentDigest does not match content');
    }
    const conflicts = preview.entries.flatMap((entry) => {
      const byId = store.getById(entry.entryId);
      const byWord = store.getByWord(entry.headword);
      return byId || byWord ? [{ entryId: entry.entryId, headword: entry.headword }] : [];
    });
    if (conflicts.length > 0) {
      return createImportFailure(ImportErrorCode.DUPLICATE_IDENTITY, 'package conflicts with existing vocabulary', { conflicts });
    }
    return deepFreeze({
      ok: true,
      importerVersion: SAFE_VOCABULARY_PACKAGE_IMPORTER_VERSION,
      dryRun: true,
      manifest,
      source: importer.source,
      quality: createVocabularyQualityReport(preview.entries),
      entryCount: preview.entryCount,
      contentDigest: digest,
      entries: preview.entries,
      storeCountBefore: store.count(),
      mutationCount: 0,
    });
  }

  function importPackage(request) {
    const inspected = dryRun(request);
    if (!inspected.ok) return inspected;
    const importedAt = requireCanonicalIsoDateTime(request.importedAt ?? clock(), 'importedAt');
    const importer = createSourceClassifiedJsonVocabularyImporter(store, {
      classification: inspected.manifest.provenance.classification,
      evidenceRef: inspected.manifest.provenance.evidenceRefs[0] ?? null,
    });
    const result = importer.import(request.input);
    if (!result.ok) return result;
    const receipt = createVocabularyImportReceipt({
      receiptId: `receipt-${inspected.manifest.packageId}-${Date.parse(importedAt)}`,
      packageId: inspected.manifest.packageId,
      packageVersion: inspected.manifest.packageVersion,
      collectionId: inspected.manifest.collectionId,
      contentDigest: inspected.contentDigest,
      sourceId: inspected.manifest.provenance.sourceId,
      classification: inspected.manifest.provenance.classification,
      importedAt,
      importedCount: result.importedCount,
      entryIds: result.entryIds,
    });
    return deepFreeze({
      ok: true,
      importerVersion: SAFE_VOCABULARY_PACKAGE_IMPORTER_VERSION,
      dryRun: false,
      receipt,
      quality: inspected.quality,
      storeCountBefore: inspected.storeCountBefore,
      storeCountAfter: store.count(),
    });
  }

  return Object.freeze({ importerVersion: SAFE_VOCABULARY_PACKAGE_IMPORTER_VERSION, dryRun, import: importPackage });
}
