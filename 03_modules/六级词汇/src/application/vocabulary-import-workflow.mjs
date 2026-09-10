import { randomUUID } from 'node:crypto';
import { deepFreeze } from '../domain/shared.mjs';
import { createSourceClassifiedJsonVocabularyImporter, VocabularySourceClassification } from '../import/source-classified-json-importer.mjs';
import { createSafeVocabularyPackageImporter } from '../import/safe-vocabulary-package-importer.mjs';
import {
  calculateVocabularyContentDigest,
  createVocabularyImportReceipt,
} from '../import/vocabulary-package-contract.mjs';
import {
  LibraryRestoreReason,
  calculateVocabularyLibraryHash,
  createCanonicalVocabularyLibrarySnapshot,
} from '../persistence/library-restore-point.mjs';

export const VOCABULARY_IMPORT_WORKFLOW_VERSION = '0.1';

function failure(code, message, details = undefined) {
  return deepFreeze({ ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } });
}

function assertSafetyAdapter(library, restorePointManager) {
  const enabled = library !== undefined || restorePointManager !== undefined;
  if (!enabled) return false;
  if (library === null || typeof library !== 'object' || typeof library.load !== 'function' || typeof library.save !== 'function') {
    throw new TypeError('rollback-capable workflow requires library.load() and library.save()');
  }
  if (restorePointManager === null || typeof restorePointManager !== 'object'
    || typeof restorePointManager.withTransaction !== 'function') {
    throw new TypeError('rollback-capable workflow requires restorePointManager.withTransaction()');
  }
  return true;
}

export function createVocabularyImportWorkflow({
  store,
  clock = () => new Date().toISOString(),
  onImported = async () => {},
  library = undefined,
  restorePointManager = undefined,
  postImportValidate = async () => {},
}) {
  const previews = new Map();
  const receipts = [];
  const safeImporter = createSafeVocabularyPackageImporter({ store, clock });
  const rollbackSupported = assertSafetyAdapter(library, restorePointManager);
  if (typeof postImportValidate !== 'function') throw new TypeError('postImportValidate must be a function');

  function preview({ input, source = {} }) {
    const classification = source.classification ?? VocabularySourceClassification.USER_PROVIDED;
    if (!Object.values(VocabularySourceClassification).includes(classification)) throw new TypeError('valid source classification required');
    const preliminary = createSourceClassifiedJsonVocabularyImporter(store, {
      classification,
      evidenceRef: source.evidenceRefs?.[0] ?? null,
    }).preview(input);
    if (!preliminary.ok) return preliminary;
    const at = clock();
    const manifest = {
      packageId: source.packageId ?? `local-upload-${Date.parse(at)}`,
      packageVersion: source.packageVersion ?? '0.1',
      collectionId: 'cet6-vocabulary',
      entryCount: preliminary.entryCount,
      contentDigest: calculateVocabularyContentDigest(preliminary.entries),
      provenance: {
        sourceId: source.sourceId ?? 'user-local-upload',
        classification,
        title: source.title ?? 'User-provided local JSON',
        originUrl: source.originUrl ?? null,
        licenseId: source.licenseId ?? null,
        rightsHolder: source.rightsHolder ?? null,
        evidenceRefs: source.evidenceRefs ?? [],
        acquiredAt: at,
        permissions: source.permissions ?? { localStorage: true, modification: true, redistribution: false },
        notes: source.notes ?? 'Stored locally at the user request; no official-source claim.',
      },
      createdAt: at,
    };
    const inspected = safeImporter.dryRun({ input, manifest });
    if (!inspected.ok) return inspected;
    const previewId = randomUUID();
    previews.set(previewId, { input, manifest, createdAt: at });
    return deepFreeze({
      ok: true,
      workflowVersion: VOCABULARY_IMPORT_WORKFLOW_VERSION,
      previewId,
      source: inspected.manifest.provenance,
      quality: inspected.quality,
      duplicates: [],
      entryCount: inspected.entryCount,
      contentDigest: inspected.contentDigest,
      storeCountBefore: inspected.storeCountBefore,
      mutationCount: 0,
      confirmationRequired: true,
    });
  }

  async function confirmWithoutRollback(pending) {
    const result = safeImporter.import({ ...pending, importedAt: clock() });
    if (!result.ok) return result;
    const record = deepFreeze({ manifest: pending.manifest, receipt: result.receipt, quality: result.quality });
    receipts.push(record);
    await onImported(record);
    return deepFreeze({ ...result, source: pending.manifest.provenance });
  }

  function validatePersistedCandidate(loadedInput, candidate, expectedReceiptId) {
    const loaded = createCanonicalVocabularyLibrarySnapshot(loadedInput);
    const expectedHash = calculateVocabularyLibraryHash(candidate);
    const actualHash = calculateVocabularyLibraryHash(loaded);
    if (actualHash !== expectedHash) {
      const error = new Error('persisted vocabulary library hash mismatch');
      error.code = 'POST_IMPORT_LIBRARY_HASH_MISMATCH';
      throw error;
    }
    if (loaded.entries.length !== candidate.entries.length) {
      const error = new Error('persisted vocabulary library count mismatch');
      error.code = 'POST_IMPORT_COLLECTION_COUNT_MISMATCH';
      throw error;
    }
    if (loaded.imports.at(-1)?.receipt?.receiptId !== expectedReceiptId) {
      const error = new Error('persisted import receipt identity mismatch');
      error.code = 'POST_IMPORT_RECEIPT_MISMATCH';
      throw error;
    }
    return loaded;
  }

  async function confirmWithRollback(pending) {
    const inspected = safeImporter.dryRun({ input: pending.input, manifest: pending.manifest });
    if (!inspected.ok) return inspected;
    try {
      return await restorePointManager.withTransaction(async (transaction) => {
        const before = createCanonicalVocabularyLibrarySnapshot(await library.load());
        const runtimeBefore = createCanonicalVocabularyLibrarySnapshot({
          version: before.version,
          entries: store.list(),
          imports: receipts,
          ...(before.contentCollections === undefined ? {} : { contentCollections: before.contentCollections }),
        });
        if (calculateVocabularyLibraryHash(before) !== calculateVocabularyLibraryHash(runtimeBefore)) {
          return failure(
            'LIBRARY_RUNTIME_STATE_MISMATCH',
            'persisted library and runtime store/import receipts must match before a protected import',
          );
        }
        const restorePointId = `library-restore:${Date.parse(clock())}:${randomUUID()}`;
        try {
          await transaction.createRestorePoint({
            restorePointId,
            createdAt: clock(),
            reason: LibraryRestoreReason.PRE_IMPORT,
            librarySnapshot: before,
          });
        } catch (error) {
          return failure('PRE_IMPORT_RESTORE_POINT_FAILED', error.message, { causeCode: error.code ?? 'UNKNOWN' });
        }

        try {
          const importedAt = clock();
          const receipt = createVocabularyImportReceipt({
            receiptId: `receipt-${inspected.manifest.packageId}-${Date.parse(importedAt)}`,
            packageId: inspected.manifest.packageId,
            packageVersion: inspected.manifest.packageVersion,
            collectionId: inspected.manifest.collectionId,
            contentDigest: inspected.contentDigest,
            sourceId: inspected.manifest.provenance.sourceId,
            classification: inspected.manifest.provenance.classification,
            importedAt,
            importedCount: inspected.entries.length,
            entryIds: inspected.entries.map((entry) => entry.entryId),
            rollbackSupported: true,
            preImportRestorePointId: restorePointId,
          });
          const record = deepFreeze({ manifest: inspected.manifest, receipt, quality: inspected.quality });
          const candidate = createCanonicalVocabularyLibrarySnapshot({
            version: before.version,
            entries: [...store.list(), ...inspected.entries],
            imports: [...receipts, record],
            ...(before.contentCollections === undefined ? {} : { contentCollections: before.contentCollections }),
          });
          await library.save(candidate);
          const reloaded = validatePersistedCandidate(await library.load(), candidate, receipt.receiptId);
          await postImportValidate(deepFreeze({ before, candidate, reloaded, record, restorePointId }));
          await onImported(record);
          store.addMany(inspected.entries);
          receipts.push(record);
          return deepFreeze({
            ok: true,
            importerVersion: inspected.importerVersion,
            dryRun: false,
            receipt,
            quality: inspected.quality,
            source: inspected.manifest.provenance,
            storeCountBefore: inspected.storeCountBefore,
            storeCountAfter: store.count(),
            preImportRestorePointId: restorePointId,
            rollbackSupported: true,
          });
        } catch (error) {
          try {
            const rollback = await transaction.restoreLibraryRestorePoint(restorePointId);
            if (rollback.restorePoint.contentHash !== calculateVocabularyLibraryHash(before)
              || rollback.library.entries.length !== before.entries.length) {
              throw Object.assign(new Error('rollback result does not match pre-import library'), { code: 'ROLLBACK_IDENTITY_MISMATCH' });
            }
            return failure('IMPORT_ROLLED_BACK', 'import failed and the pre-import vocabulary library was restored', {
              causeCode: error.code ?? 'IMPORT_COMMIT_FAILED',
              restorePointId,
              libraryHash: rollback.restorePoint.contentHash,
              itemCount: rollback.restorePoint.itemCount,
            });
          } catch (rollbackError) {
            return failure('IMPORT_ROLLBACK_FAILED', 'import failed and rollback could not be verified', {
              causeCode: error.code ?? 'IMPORT_COMMIT_FAILED',
              rollbackCauseCode: rollbackError.code ?? 'UNKNOWN',
              restorePointId,
            });
          }
        }
      });
    } catch (error) {
      return failure('IMPORT_TRANSACTION_FAILED', error.message, { causeCode: error.code ?? 'UNKNOWN' });
    }
  }

  async function confirm(previewId) {
    const pending = previews.get(previewId);
    if (!pending) return deepFreeze({ ok: false, error: { code: 'PREVIEW_NOT_FOUND', message: 'preview is missing, expired, or already used' } });
    previews.delete(previewId);
    return rollbackSupported ? confirmWithRollback(pending) : confirmWithoutRollback(pending);
  }

  function restoreImports(records) {
    if (!Array.isArray(records)) throw new TypeError('import records array required');
    receipts.splice(0, receipts.length, ...records);
  }

  return Object.freeze({
    workflowVersion: VOCABULARY_IMPORT_WORKFLOW_VERSION,
    rollbackSupported,
    preview,
    confirm,
    restoreImports,
    listImports: () => deepFreeze([...receipts]),
    lastImport: () => receipts.at(-1) ?? null,
    listLibraryRestorePoints: rollbackSupported ? () => restorePointManager.listRestorePoints() : undefined,
    inspectLibraryRestorePoint: rollbackSupported ? (restorePointId) => restorePointManager.inspectRestorePoint(restorePointId) : undefined,
    restoreLibraryRestorePoint: rollbackSupported ? (restorePointId) => restorePointManager.restoreLibraryRestorePoint(restorePointId) : undefined,
  });
}
