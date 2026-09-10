# AUTHORITATIVE BASELINE MANIFEST V0.1

Sealed for V0.2 construction on `2026-08-13`.

- Public API: `creator_ops.CreatorOpsApplication`
- Composition Root: `creator_ops.api.composition.CreatorOpsCompositionRoot`
- Domain: `domain/models.py`, `state/machine.py`, `services/content_pipeline.py`
- Operations: `application/work_queue.py`, `application/workbenches.py`
- Persistence: one `SQLiteCreatorOpsStore`; schema baseline v0.1, additive V0.2 migration only
- Package/QA: `viewmodels/content_package.py`, `domain/quality.py`
- Legacy: read-only adapters and `SourceReconciliationCatalog`
- Test baseline: NEXA `145/145 PASS`; Legacy `861/861 PASS`
- Source evidence: 600 files; six fingerprints recorded in `CREATOR_SOURCE_RECONCILIATION.md`
- Route: Public API → Application → Domain/Workflow → Package/QA/Assets → Persistence/Adapters
- Automatic publishing: `NONE`; network capability: `NONE`

Contract guards prohibit a second publish path, stored Work Queue truth, ViewModel SQLite access,
writable source_import use, legacy CLI as public entry, and Public API bypass of Application services.
