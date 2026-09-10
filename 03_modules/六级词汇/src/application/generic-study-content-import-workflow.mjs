import { randomUUID } from 'node:crypto';
import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { createInMemoryStudyContentCatalog } from '../content/study-content-catalog.mjs';
import {
  calculateStudyContentDigest,
  createGenericStudyContentPackageImporter,
} from '../import/study-content-package-contract.mjs';
import {
  LibraryRestoreReason,
  calculateVocabularyLibraryHash,
  createCanonicalVocabularyLibrarySnapshot,
} from '../persistence/library-restore-point.mjs';

export const GENERIC_STUDY_CONTENT_IMPORT_WORKFLOW_VERSION = '0.1';

export function createGenericStudyContentImportWorkflow({
  catalog,
  library,
  restorePointManager,
  clock = () => new Date().toISOString(),
  postImportValidate = async () => {},
}) {
  if (typeof catalog?.addMany !== 'function') throw new TypeError('catalog required');
  if (typeof library?.load !== 'function' || typeof library?.save !== 'function') throw new TypeError('library required');
  if (typeof restorePointManager?.withTransaction !== 'function') throw new TypeError('restorePointManager required');
  const pending = new Map();

  function preview({ input, manifest }) {
    const inspected = createGenericStudyContentPackageImporter({ catalog, clock }).dryRun({ input, manifest });
    if (!inspected.ok) return inspected;
    const previewId = `study-content-preview:${randomUUID()}`;
    pending.set(previewId, { input, manifest: inspected.manifest });
    return deepFreeze({ ...inspected, previewId, mutationCount: 0 });
  }

  async function confirm(previewId) {
    const request = pending.get(previewId);
    if (!request) return failure('IMPORT_PREVIEW_NOT_FOUND', 'preview is missing or already consumed');
    pending.delete(previewId);
    return restorePointManager.withTransaction(async (transaction) => {
      const before = createCanonicalVocabularyLibrarySnapshot(await library.load());
      const restorePointId = `library-restore:${Date.parse(clock())}:${randomUUID()}`;
      try {
        await transaction.createRestorePoint({ restorePointId, createdAt: requireCanonicalIsoDateTime(clock(), 'clock()'), reason: LibraryRestoreReason.PRE_IMPORT, librarySnapshot: before });
      } catch (error) {
        return failure('PRE_IMPORT_RESTORE_POINT_FAILED', error.message, { causeCode: error.code ?? 'UNKNOWN' });
      }
      try {
        // The authoritative generic importer runs against a staging catalog. The
        // live catalog is mutated only after persistence and integrity checks pass.
        const stagedCatalog = createInMemoryStudyContentCatalog();
        const staged = createGenericStudyContentPackageImporter({ catalog: stagedCatalog, clock }).import({
          ...request,
          receiptId: `study-content-receipt:${randomUUID()}`,
          restorePointId,
          persisted: true,
        });
        if (!staged.ok) throw Object.assign(new Error(staged.error.message), { code: staged.error.code });
        const currentCollections = before.contentCollections ?? [];
        if (currentCollections.some((item) => item.manifest.collectionId === staged.manifest.collectionId)) {
          throw Object.assign(new Error('content collection already exists in local library'), { code: 'CONTENT_COLLECTION_CONFLICT' });
        }
        const candidate = createCanonicalVocabularyLibrarySnapshot({
          ...before,
          contentCollections: [...currentCollections, { manifest: staged.manifest, contents: staged.contents, receipts: [staged.receipt] }],
        });
        await library.save(candidate);
        const reloaded = createCanonicalVocabularyLibrarySnapshot(await library.load());
        if (calculateVocabularyLibraryHash(reloaded) !== calculateVocabularyLibraryHash(candidate)) {
          throw Object.assign(new Error('persisted multi-collection library hash mismatch'), { code: 'POST_IMPORT_LIBRARY_HASH_MISMATCH' });
        }
        const persistedCollection = reloaded.contentCollections?.find((item) => item.manifest.collectionId === staged.manifest.collectionId);
        if (!persistedCollection || persistedCollection.contents.length !== staged.contents.length
          || calculateStudyContentDigest(persistedCollection.contents) !== staged.manifest.contentDigest) {
          throw Object.assign(new Error('persisted content collection integrity mismatch'), { code: 'POST_IMPORT_CONTENT_COLLECTION_MISMATCH' });
        }
        await postImportValidate(deepFreeze({ before, candidate, reloaded, staged, restorePointId }));
        catalog.addMany(staged.contents);
        return deepFreeze({ ok: true, workflowVersion: GENERIC_STUDY_CONTENT_IMPORT_WORKFLOW_VERSION, manifest: staged.manifest, provenance: staged.provenance, receipt: staged.receipt, importedCount: staged.contents.length, preImportRestorePointId: restorePointId, rollbackSupported: true });
      } catch (error) {
        try {
          const rollback = await transaction.restoreLibraryRestorePoint(restorePointId);
          if (rollback.restorePoint.contentHash !== calculateVocabularyLibraryHash(before)) throw Object.assign(new Error('rollback identity mismatch'), { code: 'ROLLBACK_IDENTITY_MISMATCH' });
          return failure('IMPORT_ROLLED_BACK', 'study content import failed and the multi-collection library was restored', { causeCode: error.code ?? 'IMPORT_COMMIT_FAILED', restorePointId });
        } catch (rollbackError) {
          return failure('IMPORT_ROLLBACK_FAILED', 'study content import failed and rollback could not be verified', { causeCode: error.code ?? 'IMPORT_COMMIT_FAILED', rollbackCauseCode: rollbackError.code ?? 'UNKNOWN', restorePointId });
        }
      }
    });
  }

  return Object.freeze({ workflowVersion: GENERIC_STUDY_CONTENT_IMPORT_WORKFLOW_VERSION, preview, confirm });
}

function failure(code, message, details) { return deepFreeze({ ok: false, error: { code, message, ...(details ? { details } : {}) } }); }
