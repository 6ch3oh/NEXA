# Legacy Reconciliation Matrix V0.1

## 1. Scope and rules

- Legacy root: `E:\AI工作台\内容创作\06_自媒体运营`
- Intake mode: read-only; no legacy script, test, network command, or migration was executed.
- NEXA baseline: `001 PASS / 002 PASS / 003B PASS / 004 PASS / 005 PASS`.
- Unified status: `NEXA_NEW_BASELINE_PENDING_LEGACY_RECONCILIATION`.
- Allowed decisions: `KEEP`, `KEEP_WITH_ADAPTER`, `MERGE`, `REPLACE_PARTIALLY`, `DEPRECATE_DUPLICATE`, `UNKNOWN`.
- A decision records the future reconciliation direction. It does not authorize deletion, migration, Core/UI wiring, or 006 work.

## 2. Baseline-level matrix

| Baseline | Legacy overlap established by local evidence | Decision | Required reconciliation |
| --- | --- | --- | --- |
| 001 | Five-account registry (`A1/A2/B1/B2/B3`), account roles, platforms, formats, manual-only boundary; no `B4` | `MERGE` | Preserve proven account metadata and merge it into the NEXA asset map; resolve the missing `B4` and account-ID vocabulary before freezing the complete map |
| 002 | Daily brief, selection, run log, content packages, prompts, copy, QA, content registry, provenance and Notion/Obsidian references | `MERGE` | Import legacy evidence through deterministic mappings; preserve `content_id`, source paths and provenance; do not treat empty asset folders as proof of missing external assets |
| 003B | Status-like values and manual work steps exist, but no equivalent canonical Work Queue or state machine | `KEEP_WITH_ADAPTER` | Map legacy status values and daily selection events to the NEXA state model; retain the NEXA queue as the canonical operational model after adapter tests |
| 004 | JSON/Markdown/file persistence and registry reads exist; no SQLite database, repository layer, schema guard or transaction boundary | `KEEP_WITH_ADAPTER` | Keep the NEXA query/persistence layer and add a read/import adapter for the legacy filesystem; no direct bulk migration during intake |
| 005 | CLI scripts and direct file reads/writes overlap command/read use cases; no Facade, Composition Root, stable public DTO API or DB lifecycle | `KEEP_WITH_ADAPTER` | Keep the NEXA API structure, wrap legacy filesystem surfaces with adapters, and delay final authoritative-interface designation until contract and import tests pass |

## 3. NEXA-CREATOR-005 capability mapping

| Legacy capability/evidence | NEXA-CREATOR-005 capability | Decision | Evidence-based rationale |
| --- | --- | --- | --- |
| No unified application service was found | Application API | `KEEP` | Legacy operations are script entry points and direct filesystem calls, not a stable application boundary |
| No Facade class or equivalent boundary was found | Facade | `KEEP` | There is no legacy equivalent to select as authoritative |
| Dynamic adapter import inside `run_selected.py`; no dependency assembly root | Composition Root | `KEEP` | The script runner is orchestration, not an explicit composition root with lifecycle ownership |
| No DB file, SQLite import, schema guard, repository or transaction lifecycle | Local database lifecycle | `KEEP` | NEXA explicit initialization and lifecycle remain unique capabilities |
| Notion page IDs/URLs and Obsidian note paths are stored as references; no UI contract/code | UI interface | `KEEP_WITH_ADAPTER` | References must be mapped as data/provenance and must not be mistaken for a stable UI integration contract |
| No Core interface or Core code contract was found | Core interface | `KEEP` | No legacy equivalent exists; Core wiring remains prohibited by this intake |
| JSON shapes for accounts, briefs, selections, run logs, packages and metadata | Public DTO | `KEEP_WITH_ADAPTER` | Preserve legacy fields through explicit DTO mappers; raw JSON must not silently define the new public contract |
| CLI commands write packages and metadata directly | Command API | `REPLACE_PARTIALLY` | Keep historical scripts intact; future mutation should pass through the NEXA command boundary or a compatibility adapter |
| Registry and JSON/Markdown files are read directly | Read API | `KEEP_WITH_ADAPTER` | Add a filesystem read/import adapter while keeping NEXA queries canonical |
| Eight historical metadata backup snapshots; no general DB backup/lifecycle mechanism | Backup / lifecycle | `KEEP_WITH_ADAPTER` | Preserve snapshots as evidence and map their provenance; retain the NEXA backup/lifecycle contract |

## 4. Legacy vocabulary that requires mapping

| Legacy surface | Observed values or shape | Target treatment |
| --- | --- | --- |
| Account IDs | `A1`, `A2`, `B1`, `B2`, `B3`; no `B4` | Account/asset map adapter; unresolved `B4` remains explicit |
| Content IDs | `A2-20260714-001`, `B3-20260714-001` | Preserve as immutable external IDs and provenance keys unless a later migration specification says otherwise |
| Status values | `candidate_ready`, `planned`, `script_ready`, `prompt_ready`, `waiting_for_user_material`, `skipped` | `LegacyStatusMapper`; no guessed equivalence may advance a WorkItem |
| Daily workflow | brief -> selection -> selected runner -> account adapter -> package files | `LegacyDailyBoardAdapter` and `LegacySelectionAdapter` |
| Content artifacts | `metadata.json`, `sources.md`, `content_package.md`, `publish_copy.md`, `qa_report.md` | `LegacyContentPackageMapper`; distinguish pre-publish copy/QA from actual publication/review evidence |
| Knowledge references | Notion page IDs/URLs and Obsidian note paths | Reference-only adapter; no network or external write in this phase |
| Storage | Direct filesystem directories and JSON/Markdown registries | Read/import adapter into NEXA; keep source files immutable |

## 5. Freeze and wait boundaries

May be structurally frozen now:

- Manual-publish-only and no-login/no-cookie/no-auto-publish safety boundary.
- NEXA 004 schema guard, transaction boundary, repository/query semantics and operator overlay design; no legacy equivalent was found.
- NEXA 005 explicit database initialization, stable result/export boundary, health/runtime and backup contract; no legacy equivalent was found.
- NEXA 003B deterministic state-machine and Work Queue structure; legacy status data still requires an adapter.

Must wait for further reconciliation evidence or an authorized adapter task:

- Complete `A1` through `B4` identity and account mapping.
- Status/event mapping and dry-run validation against legacy packages.
- Import rules for content IDs, provenance, prompts, copy, QA and historical snapshots.
- External Notion/Obsidian evidence, real media locations, publication records, metrics and post-publication reviews.
- Compatibility treatment of legacy CLI/direct writes.
- Contract tests that determine whether 005 becomes the final authoritative interface.

## 6. No rollback decision

`001` through `005` remain `PASS / NEXA_NEW_BASELINE_PENDING_LEGACY_RECONCILIATION`.

Rollback conclusion: `NO`. The intake found overlapping concepts and data, but no evidence that deleting or rewriting the NEXA baseline would preserve more verified capability. All legacy sources remain untouched.
