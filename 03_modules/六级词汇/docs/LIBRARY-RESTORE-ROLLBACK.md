# Vocabulary Library Restore Point and Import Rollback V0.1

Task: `NEXA-STUDY-CENTER-LIBRARY-RESTORE-ROLLBACK-001`

## Boundary

Library restore points are a content-persistence capability. They are deliberately separate from learner snapshot restore points:

- learner restore protects `LearnerProgress`, metadata and append-only `ReviewRecord` data;
- library restore protects the persisted vocabulary entries and import records;
- neither file format embeds or rewrites the other domain.

The public entry point is `createLocalVocabularyLibraryRestorePointManager`. It provides create, list, inspect and restore operations. `createVocabularyImportWorkflow` exposes the same list/inspect/restore operations when configured with a library and restore-point manager.

## Restore point record

Each `.library-restore-point.json` record contains:

- stable restore-point ID and canonical UTC creation time;
- library and collection identities;
- item count and canonical SHA-256 content hash;
- latest source manifest identity and import receipt identity when present;
- previous library version and reason (`PRE_IMPORT` or `MANUAL_SAFE_POINT`);
- the validated library snapshot required for restoration.

The manager uses a separate directory and suffix from learner restore points. Retention is five points by default, reusing the established policy value without mixing file domains.

## Protected confirm sequence

Rollback-capable import confirm follows this order:

1. Re-run dry-run validation against the current Store.
2. Verify that the persisted Library, runtime Store and restored import receipts describe the same pre-import state.
3. Create a `PRE_IMPORT` Library Restore Point.
4. Build the candidate library without mutating the Store.
5. Atomically persist the candidate library.
6. Reload it and verify canonical hash, collection count and receipt identity.
7. Run the optional post-import validator.
8. Only after every persistence check passes, atomically add the prepared entries to the existing Store and commit the receipt in memory.

The Store has no clear/replace/remove rollback operation and none was added. Staging the Store mutation last means a failed persistence or validation step never requires clearing and rebuilding the Store, so existing StudyItem and ReviewCard identities remain derived from the same `VocabularyEntry.entryId` values.

If a step after safe-point creation fails, the workflow restores and reload-validates the pre-import library and returns `IMPORT_ROLLED_BACK`. If the point is missing, corrupt or cannot be verified, it returns `IMPORT_ROLLBACK_FAILED`; it never claims a successful rollback.

## Receipt truth

New receipts created through the protected workflow record:

- `rollbackSupported=true`;
- `safetyBoundary=PRE_IMPORT_RESTORE_POINT_AND_ATOMIC_COMMIT`;
- `preImportRestorePointId=<actual point>`.

Unprotected/historical imports retain `rollbackSupported=false` and `ATOMIC_ADD_MANY`. Historical receipts are not rewritten.

## Manual restore semantics

Manual restore verifies the point, atomically writes its Library snapshot, reloads it and verifies hash/count. The result explicitly returns `restartRequired=true`, because a live Store is intentionally not cleared and rebuilt. The restored Library becomes authoritative on the next normal runtime start.

## Verified evidence

`tests/library-restore-rollback.test.mjs` covers integrity tampering, five-point retention, protected success, persistence failure rollback, reload/hash mismatch rollback, injected post-validation failure, missing-point fail-closed behavior, manual restore, and a real isolated 5,311-entry rollback. The 5,311 test verifies canonical and byte-level hashes, count, StudyItem ID, ReviewCard ID and an unchanged learner snapshot containing MASTERED, flags and review history.

Runtime network dependency remains zero.
