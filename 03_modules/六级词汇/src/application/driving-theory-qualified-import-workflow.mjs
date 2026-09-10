import { randomUUID } from 'node:crypto';
import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { createInMemoryStudyContentCatalog } from '../content/study-content-catalog.mjs';
import { createGenericStudyContentPackageImporter } from '../import/study-content-package-contract.mjs';
import {
  LibraryRestoreReason,
  calculateVocabularyLibraryHash,
  createCanonicalVocabularyLibrarySnapshot,
} from '../persistence/library-restore-point.mjs';
import { DRIVING_THEORY_USER_PDF_COLLECTION_ID } from '../import/driving-theory-user-pdf-pilot.mjs';

export const DRIVING_THEORY_QUALIFIED_IMPORT_WORKFLOW_VERSION = '1.0';

export function createDrivingTheoryQualifiedImportWorkflow({
  library,
  restorePointManager,
  baselineContentCollections,
  packageInput,
  packageManifest,
  frozenIdentity,
  clock = () => new Date().toISOString(),
  postImportValidate = async () => {},
}) {
  if (typeof library?.load !== 'function' || typeof library?.save !== 'function') throw new TypeError('library required');
  if (typeof restorePointManager?.withTransaction !== 'function') throw new TypeError('restorePointManager required');
  if (!Array.isArray(baselineContentCollections)) throw new TypeError('baselineContentCollections array required');
  if (packageManifest?.collectionId !== DRIVING_THEORY_USER_PDF_COLLECTION_ID) throw new TypeError('driving collection identity required');
  if (!frozenIdentity || typeof frozenIdentity !== 'object') throw new TypeError('frozenIdentity required');
  const canonicalBaselines = baselineContentCollections.map((item) => createCanonicalVocabularyLibrarySnapshot({ version: '0.1', entries: [], imports: [], contentCollections: [item] }).contentCollections[0]);
  const pending = new Map();

  async function preview() {
    const stagedCatalog = createInMemoryStudyContentCatalog();
    const inspected = createGenericStudyContentPackageImporter({ catalog: stagedCatalog, clock }).dryRun({ input: packageInput, manifest: packageManifest });
    if (!inspected.ok) return inspected;
    const persisted = createCanonicalVocabularyLibrarySnapshot(await library.load());
    const before = mergeRuntimeBaselines(persisted, canonicalBaselines);
    const existing = before.contentCollections.find((item) => item.manifest.collectionId === DRIVING_THEORY_USER_PDF_COLLECTION_ID);
    if (!existing) return failure('PILOT_COLLECTION_MISSING', 'pre-import Driving Pilot collection is missing');
    if (existing.contents.length !== 20) {
      return failure(existing.contents.length === 500 ? 'DRIVING_FULL_IMPORT_ALREADY_APPLIED' : 'PRE_IMPORT_COLLECTION_COUNT_MISMATCH', `expected 20 Pilot items, received ${existing.contents.length}`);
    }
    const fullById = new Map(inspected.contents.map((item) => [item.contentId, item]));
    for (const content of existing.contents) {
      if (!fullById.has(content.contentId) || JSON.stringify(fullById.get(content.contentId)) !== JSON.stringify(content)) {
        return failure('PILOT_20_CONTENT_IDENTITY_MISMATCH', `Pilot content identity mismatch: ${content.contentId}`);
      }
    }
    const previewId = `driving-qualified-preview:${randomUUID()}`;
    const beforeHash = calculateVocabularyLibraryHash(before);
    pending.set(previewId, { before, beforeHash, inspected, existing });
    return deepFreeze({
      ok: true,
      workflowVersion: DRIVING_THEORY_QUALIFIED_IMPORT_WORKFLOW_VERSION,
      previewId,
      mutationCount: 0,
      sourceDatasetId: frozenIdentity.datasetId,
      sourceDatasetVersion: frozenIdentity.datasetVersion,
      sourceDatasetSha256: frozenIdentity.datasetSha256,
      collectionIdentity: DRIVING_THEORY_USER_PDF_COLLECTION_ID,
      existingItemCount: existing.contents.length,
      newItemCount: inspected.contents.length - existing.contents.length,
      finalItemCount: inspected.contents.length,
      beforeLibraryHash: beforeHash,
      manifest: inspected.manifest,
    });
  }

  async function confirm(previewId) {
    const request = pending.get(previewId);
    if (!request) return failure('IMPORT_PREVIEW_NOT_FOUND', 'preview is missing or already consumed');
    pending.delete(previewId);
    return restorePointManager.withTransaction(async (transaction) => {
      const current = mergeRuntimeBaselines(createCanonicalVocabularyLibrarySnapshot(await library.load()), canonicalBaselines);
      if (calculateVocabularyLibraryHash(current) !== request.beforeHash) return failure('PRE_IMPORT_LIBRARY_CHANGED', 'library changed after preview');
      const timestamp = requireCanonicalIsoDateTime(clock(), 'clock()');
      const restorePointId = `library-restore:${Date.parse(timestamp)}:${randomUUID()}`;
      try {
        await transaction.createRestorePoint({ restorePointId, createdAt: timestamp, reason: LibraryRestoreReason.PRE_IMPORT, librarySnapshot: request.before });
      } catch (error) {
        return failure('PRE_IMPORT_RESTORE_POINT_FAILED', error.message, { causeCode: error.code ?? 'UNKNOWN' });
      }
      try {
        const stagedCatalog = createInMemoryStudyContentCatalog();
        const staged = createGenericStudyContentPackageImporter({ catalog: stagedCatalog, clock: () => timestamp }).import({
          input: packageInput,
          manifest: packageManifest,
          receiptId: `study-content-receipt:${randomUUID()}`,
          restorePointId,
          persisted: true,
        });
        if (!staged.ok) throw Object.assign(new Error(staged.error.message), { code: staged.error.code });
        const upgradedCollection = {
          manifest: staged.manifest,
          contents: staged.contents,
          // A receipt is bound to its manifest digest. The Pilot receipt therefore
          // cannot be carried onto the 500-item manifest even though the first 20
          // StudyItem identities are deliberately preserved.
          receipts: [staged.receipt],
        };
        const candidate = createCanonicalVocabularyLibrarySnapshot({
          ...request.before,
          contentCollections: request.before.contentCollections.map((item) => item.manifest.collectionId === DRIVING_THEORY_USER_PDF_COLLECTION_ID ? upgradedCollection : item),
        });
        await library.save(candidate);
        const reloaded = createCanonicalVocabularyLibrarySnapshot(await library.load());
        const candidateHash = calculateVocabularyLibraryHash(candidate);
        if (calculateVocabularyLibraryHash(reloaded) !== candidateHash) throw Object.assign(new Error('post-import library hash mismatch'), { code: 'POST_IMPORT_LIBRARY_HASH_MISMATCH' });
        const saved = reloaded.contentCollections.find((item) => item.manifest.collectionId === DRIVING_THEORY_USER_PDF_COLLECTION_ID);
        if (!saved || saved.contents.length !== 500 || saved.manifest.contentDigest !== staged.manifest.contentDigest) {
          throw Object.assign(new Error('post-import Driving collection mismatch'), { code: 'POST_IMPORT_DRIVING_COLLECTION_MISMATCH' });
        }
        await postImportValidate(deepFreeze({ before: request.before, candidate, reloaded, staged, restorePointId }));
        const formalReceipt = deepFreeze({
          IMPORT_ID: `driving-qualified-import:${randomUUID()}`,
          SOURCE_DATASET_ID: frozenIdentity.datasetId,
          SOURCE_DATASET_VERSION: frozenIdentity.datasetVersion,
          SOURCE_DATASET_SHA256: frozenIdentity.datasetSha256,
          SOURCE_CLASSIFICATION: 'USER_PROVIDED',
          SOURCE_ORIGIN_CLASSIFICATION: 'THIRD_PARTY_SOURCE_UNVERIFIED',
          OFFICIAL: false,
          IMPORTED_ITEM_COUNT: staged.contents.length,
          EXISTING_ITEM_COUNT: request.existing.contents.length,
          NEW_ITEM_COUNT: staged.contents.length - request.existing.contents.length,
          COLLECTION_IDENTITY: DRIVING_THEORY_USER_PDF_COLLECTION_ID,
          PRE_IMPORT_RESTORE_POINT_ID: restorePointId,
          ROLLBACK_SUPPORTED: true,
          IMPORTED_AT: timestamp,
          MANIFEST_IDENTITY: {
            packageId: staged.manifest.packageId,
            packageVersion: staged.manifest.packageVersion,
            contentDigest: staged.manifest.contentDigest,
          },
          BEFORE_LIBRARY_SHA256: request.beforeHash,
          AFTER_LIBRARY_SHA256: candidateHash,
          STANDARD_RECEIPT_ID: staged.receipt.receiptId,
        });
        return deepFreeze({
          ok: true,
          workflowVersion: DRIVING_THEORY_QUALIFIED_IMPORT_WORKFLOW_VERSION,
          previewMutationCount: 0,
          importedCount: 500,
          existingItemCount: 20,
          newItemCount: 480,
          finalCollectionCount: 500,
          preImportRestorePointId: restorePointId,
          rollbackSupported: true,
          receipt: formalReceipt,
          standardReceipt: staged.receipt,
          beforeLibraryHash: request.beforeHash,
          afterLibraryHash: candidateHash,
        });
      } catch (error) {
        try {
          const rollback = await transaction.restoreLibraryRestorePoint(restorePointId);
          if (rollback.restorePoint.contentHash !== request.beforeHash) throw Object.assign(new Error('rollback identity mismatch'), { code: 'ROLLBACK_IDENTITY_MISMATCH' });
          return failure('IMPORT_ROLLED_BACK', 'Driving full import failed and the protected library was restored', { causeCode: error.code ?? 'IMPORT_COMMIT_FAILED', restorePointId, restoredLibraryHash: rollback.restorePoint.contentHash });
        } catch (rollbackError) {
          return failure('IMPORT_ROLLBACK_FAILED', 'Driving full import failed and rollback could not be verified', { causeCode: error.code ?? 'IMPORT_COMMIT_FAILED', rollbackCauseCode: rollbackError.code ?? 'UNKNOWN', restorePointId });
        }
      }
    });
  }

  return Object.freeze({ workflowVersion: DRIVING_THEORY_QUALIFIED_IMPORT_WORKFLOW_VERSION, preview, confirm });
}

function mergeRuntimeBaselines(persisted, baselineCollections) {
  const collections = [...(persisted.contentCollections ?? [])];
  for (const baseline of baselineCollections) {
    if (!collections.some((item) => item.manifest.collectionId === baseline.manifest.collectionId)) collections.push(baseline);
  }
  return createCanonicalVocabularyLibrarySnapshot({ ...persisted, contentCollections: collections });
}

function failure(code, message, details) { return deepFreeze({ ok: false, error: { code, message, ...(details ? { details } : {}) } }); }
