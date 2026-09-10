# FINAL CREATOR OPS FUNCTION MAP

Goal: `NEXA-CREATOR-FULL-CONSOLIDATION-GOAL-003`  
Status: `SEALED`  
Authoritative version: `Creator Ops V0.2 / Public API V0.2 / SQLite schema V0.2`  
Evidence date: `2026-08-14` (Asia/Shanghai)

## Coverage rule

The six immutable legacy roots are owned at two levels:

- File level: `SourceReconciliationCatalog` assigns all `600/600` effective files (`805,312,168` bytes) to an explicit capability and allowed decision. `UNKNOWN=0`.
- Capability level: the 38 rows below identify the one runtime owner or the deliberate read-only/reference boundary.

Environment and cache trees (`.venv`, `node_modules`, `__pycache__`, `.git`) are excluded from the effective-business denominator but remain untouched in `source_import`.

## Authoritative function map

| # | Capability | Authoritative source / path | Origin | Classification | Runtime status | Data authority | Tests / evidence | Legacy compatibility / future dependency |
|---:|---|---|---|---|---|---|---|---|
| 1 | Creator identity | `domain/models.py::Creator` + SQLite `creators` | NEXA | KEEP | READY | SQLite canonical row | canonical activation + persistence tests | Legacy had no stronger Creator aggregate |
| 2 | A1/A2/B1/B2/B3/B4 account semantics | `Account` + `RealLegacyAdapter` + SQLite `accounts` | MERGED | MERGE | READY | SQLite canonical row; legacy code retained | 006, production import, activation tests | B4 remains preserved/deferred; no guessed identity |
| 3 | Platform identity and provenance | `Account.platform`, `legacy_account_code`, `Provenance` | MERGED | MERGE | READY | Canonical entities + immutable source reference | domain/import/activation tests | External platform identifiers require manual evidence |
| 4 | Notion identity | immutable Notion schemas and references | LEGACY | REFERENCE_ONLY | DEFERRED | `source_import` evidence | 60/60 legacy Notion tests | Real Notion connection is an external integration |
| 5 | Content identity | `ContentItem.content_id` | NEXA | KEEP | READY | SQLite `content_items.content_id` | domain/persistence/API tests | Title matching is never authoritative |
| 6 | Topic/title/body/script/account relations | `ContentItem` + relation tables | NEXA | KEEP | READY | SQLite canonical content | pipeline/import/asset tests | Legacy fields preserved through provenance/adapters |
| 7 | Legacy content intake/provenance | `RealLegacyReader/Adapter` → production import ledger | MERGED | MERGE | READY | Ledger + canonical rows + source reference | 34/34 accounted; import/activation tests | Read-only adapter; no source write-back |
| 8 | Business content lifecycle | `state/machine.py` + `ContentState` | NEXA | KEEP | READY | Canonical content state | state/pipeline/workflow tests | One business lifecycle only |
| 9 | Legacy technical transaction/sync state | NEXA recovery evidence and durable runtime | MERGED | REPLACE_PARTIALLY | READY | `durable_tasks`, locks, recovery evidence | 454 legacy + V0.2 recovery tests | Technical `completed/notion_synced` never becomes content state |
| 10 | WorkItem / NextAction / priority | `application/work_queue.py` | NEXA | KEEP | READY | Derived from canonical facts | queue/workbench/Goal 003 tests | Not persisted as a second lifecycle |
| 11 | Operator overlay | `WorkItemOverlay` + `work_item_overlays` | NEXA | KEEP | READY | Only operator-owned status/due/note fields | persistence/API tests | Derived fields cannot be overwritten |
| 12 | DurableTask execution truth | `application/runtime.py` + `durable_tasks` | MERGED | MERGE | READY | SQLite durable task rows | runtime/restart/failure tests | WorkItem is not DurableTask |
| 13 | Lock, heartbeat and fencing | `DurableTaskLock` + `durable_task_locks` | MERGED | MERGE | READY | SQLite lock row/fencing token | concurrency/lock tests; legacy state evidence | No lock stealing |
| 14 | Crash, stale-lock and retry recovery | `DurableRuntimeService.recover` | MERGED | MERGE | READY | recovery evidence + audit event | recovery/restart/failure tests | Bounded retry; ambiguous evidence routes to human review |
| 15 | Package staging interruption recovery | `LocalPackageWriter` + runtime audit/recovery | MERGED | MERGE | READY | target hashes + audit evidence | package writer/failure tests | Explicit rollback confirmation required |
| 16 | Content Package aggregate/manifest | `viewmodels/content_package.py` + package manifest | MERGED | MERGE | READY | Canonical content/package identity | 165 legacy + package/QA tests | Mature legacy roles/required/extra fields retained |
| 17 | Package writer/executor | `LocalPackageWriter` | MERGED | REPLACE_PARTIALLY | READY | Create-only staging + atomic finalize | package writer/concurrency tests | Legacy writer/CLI is not callable runtime |
| 18 | Asset domain and relations | `Asset` + SQLite asset relation tables | NEXA | KEEP | READY | SQLite canonical asset rows | persistence/real asset tests | Original files remain reference-first |
| 19 | Legacy ingest/media/path validation | current validator/planner semantics behind NEXA boundary | MERGED | REPLACE_PARTIALLY | READY | Canonical Asset + validation evidence | 160 legacy + asset pipeline tests | Legacy archive executor is not authoritative |
| 20 | Visual requirement, intake, review and activation | `visual_asset_pipeline.py` + three V0.2 tables | NEXA | KEEP | READY | SQLite requirement/submission/review rows | 12 visual pipeline tests | Human visual approval is mandatory |
| 21 | Production prompts | immutable Prompt files + provenance references | LEGACY | REFERENCE_ONLY | READY | byte-preserved `source_import` / production packets | source catalog + frozen packet tests | Future prompt registry may index, never rewrite source |
| 22 | Objective pre-publish QA | `QAReport`, `QAReceipt`, `QAService` | MERGED | MERGE | READY | SQLite `qa_receipts` | QA/package/visual tests | QA is not editorial or post-publish review |
| 23 | Editorial review | content review state + real review workbench | NEXA | KEEP | READY | canonical content/review command evidence | pipeline/real asset tests | Intentional human gate |
| 24 | Post-publish review | `Review` + SQLite `reviews` | NEXA | KEEP | READY | review row linked by publish ID | persistence/workbench tests | Never mapped from Legacy Case |
| 25 | Local Research Core | `application/research.py` | NEXA | KEEP | READY | SQLite research sessions | local/restart research tests | Provider-neutral and offline |
| 26 | Legacy research/methodology/evidence | immutable scripts, notes, football/case research | LEGACY | REFERENCE_ONLY | PARTIAL | `source_import` evidence | source catalog + legacy tests | Radar/network provider is future integration |
| 27 | Publish readiness and manual workbench | pipeline gate + `ManualPublishingWorkbench` | NEXA | KEEP | READY | canonical content + latest QA | pipeline/workbench/QA tests | Human platform action remains outside runtime |
| 28 | PublishRecord and manual confirmation | `PublishRecord` + `confirm_manual_publish` | NEXA | KEEP | READY | SQLite publish row | domain/persistence/API tests | Cannot exist without explicit manual confirmation |
| 29 | Metrics | `Metrics` + SQLite `metrics` | NEXA | KEEP | READY | canonical metrics row; null distinct from zero | domain/persistence/workbench tests | Manual/platform backfill is external input |
| 30 | Case Library | `LegacyCaseLibraryMapper` read-only adapter | MERGED | MERGE | READY | legacy case identity/evidence | 46 cases; adapter tests | Case remains distinct from Review |
| 31 | Production persistence/lifecycle/backup | `SQLiteCreatorOpsStore` behind composition root | NEXA | KEEP | READY | one production DB | persistence/migration/restart/backup tests | Repositories are not public exports |
| 32 | Legacy JSON/CSV/state stores | immutable evidence + read-only adapters | LEGACY | REFERENCE_ONLY | READY | `source_import` only | catalog and 861 legacy tests | Never a second production store |
| 33 | Public API / DTO / composition root | `CreatorOpsApplication` | NEXA | KEEP | READY | application-mediated access | API/route guard/Goal 003 tests | UI/Core may not call SQL, repository, source or legacy CLI |
| 34 | Dashboard / Queue / Health / UI projections | canonical query service + exported frozen view types | MERGED | MERGE | READY | production SQLite-derived facts | Goal 003 parity and production read proof | Dashboard and Queue now share the exact derived WorkItem tuple |
| 35 | Legacy CLI/writer/executor/orchestrator | immutable executable evidence | LEGACY | REFERENCE_ONLY | DEFERRED | no NEXA runtime authority | 22 orchestrator + other legacy suites | Any future use requires an adapter through the Application API |
| 36 | Automation trigger/result/handoff contracts | current offline DTO/planners | MERGED | MERGE | READY | canonical contract payload | authoritative/automation tests | External automation center must adapt, not bypass |
| 37 | Notion sync runtime | immutable tested implementation | LEGACY | REFERENCE_ONLY | DEFERRED | no production authority | 60/60 legacy tests | Requires explicit connection/login authorization |
| 38 | Automatic publishing prohibition | `automatic_publishing=NONE`, manual confirmation gate | NEXA | KEEP | READY | runtime invariant | health/API/workflow/route guard tests | Real publishing is an intentional human gate |

## Classification totals

| Classification | Count |
|---|---:|
| KEEP | 17 |
| MERGE | 12 |
| REPLACE_PARTIALLY | 3 |
| REFERENCE_ONLY | 6 |
| DELETE_CANDIDATE | 0 |
| **Total capabilities** | **38** |

`UNKNOWN=0`. No file qualifies for deletion under the ten-point safety rule.
