# AUTHORITATIVE CREATOR OPS FINAL

Goal: `NEXA-CREATOR-FULL-CONSOLIDATION-GOAL-003`  
Status: `READY / SEALED`  
Current authoritative version: `Creator Ops V0.2`  
Public API: `V0.2`  
Persistence schema: `creator_ops_schema_v0.2`  
Seal date: `2026-08-14` (Asia/Shanghai)

## One authoritative code route

```text
Future UI / Core / approved external adapter
                    ↓
          CreatorOpsApplication
                    ↓
 Composition Root / Application Services / Workbenches
                    ↓
 Domain Content Lifecycle + Durable Task/Lock/Recovery
                    ↓
 Package / Asset / QA / Research / Manual Publish Preparation
                    ↓
          Repository + Query Service
                    ↓
       SQLite Production Store V0.2

Legacy immutable evidence
          ↓
Read-only Reader / Adapter / Planner / Case adapter
          ↓
CreatorOpsApplication or explicit import ledger
```

Runtime routes: `1`. Competing runtime routes: `0`.

The following are prohibited integration paths:

- UI → repository or direct SQL;
- UI → `source_import`;
- UI → legacy CLI/writer/executor/orchestrator;
- Dashboard → a second data source;
- WorkItem → mutation of `ContentState` or `DurableTask` truth;
- automatic platform publishing.

## Canonical semantic boundaries

```text
Content lifecycle != WorkItem != DurableTask != Lock
QA != Editorial Review != Post-publish Review != Legacy Case
Asset reference != Asset requirement != Intake submission != Visual review
Legacy technical state != ContentState
```

- `ContentState` owns business lifecycle.
- `WorkItem` is a deterministic operator projection; only its overlay fields are persisted.
- `DurableTask` owns execution/retry/recovery state.
- `DurableTaskLock` owns owner, heartbeat and fencing.
- QA is objective pre-publish evidence. Editorial Review and Post-publish Review remain human/business decisions.
- Legacy Case is research evidence, never a Review shortcut.

## Canonical data path

Production facts live only in `runtime/data/creator_ops_v0_1.sqlite3` (schema V0.2). The historical filename is retained for compatibility; it does not indicate schema V0.1.

`source_import` is immutable legacy evidence. Its JSON, CSV, journals and package trees are not a second store. The production import ledger and canonical activation resolutions record how each actionable legacy record was referenced, skipped, deferred, activated or preserved invalid.

## Consolidation change made by Goal 003

Before Goal 003, `get_work_queue()` used visual requirement facts while `get_dashboard()` re-derived a queue without them. The same A2/B3 content therefore returned `GENERATE_ASSET` from Queue but `PREPARE_ASSETS` from Dashboard; account workload also showed zero blockers.

The query layer now derives the authoritative WorkItem tuple once and injects it into Dashboard and account workload projections. Production read verification proves:

- Queue A2/B3 next action: `GENERATE_ASSET`;
- Dashboard A2/B3 next action: `GENERATE_ASSET`;
- Dashboard queue equals the standalone queue;
- A2/B3 blocked workload: `1` each;
- production DB SHA-256 unchanged by validation.

The controlled package export now also exposes the immutable Dashboard, Queue, Workbench, Package, QA and Visual Intake view types required by a future UI. Repositories and SQLite adapters remain private.

## FINAL_KEEP_CODE

- `api/application.py`, `api/composition.py`, `api/contracts.py`, `api/lifecycle.py`;
- `domain/models.py`, `domain/quality.py`, `state/machine.py`;
- canonical pipeline, work queue, workbenches, runtime, research, QA, visual asset and production workflow services;
- SQLite store, contracts, query service, serialization and schema migration;
- controlled public exports and all regression guards.

## MERGED_CODE

- account codes/platform/provenance through legacy adapters into canonical entities;
- legacy task/lock/recovery maturity into current durable contracts/runtime;
- mature package fields and QA semantics into the canonical package/QA path;
- Legacy Case into a distinct read-only Case adapter;
- visual production requirements and human handoff into the canonical asset pipeline;
- Dashboard, Queue and workload facts into one derived projection.

## REPLACE_PARTIALLY

1. Legacy global technical state: recovery evidence retained; NEXA `ContentState` remains the business owner.
2. Legacy package exporter: mature schema semantics retained; NEXA atomic writer and Application API own execution.
3. Legacy ingest: media/hash/path validation semantics retained; NEXA Asset, persistence and mutation boundaries own runtime.

## REFERENCE_ONLY

- all protected Prompt, content, media, Case and research evidence;
- legacy JSON/CSV/journals/manual run data;
- legacy CLI, scripts, writers, executors and local orchestrator;
- Notion sync implementation and static Notion identity/schema evidence;
- placeholder link-collection projects.

## FUTURE_DELETE_CANDIDATES

Count: `0`.

No legacy file was proven to satisfy every deletion safeguard. Source evidence, prompts, cases, media, production packages and provenance are permanently excluded from deletion by this Goal.

## REAL_PLATFORM_DEPENDENCIES

### ENGINEERING_GAP

- no UI implementation exists in this module; the public surface is now UI-ready;
- no approved external radar/network research provider adapter;
- no approved Notion sync adapter through `CreatorOpsApplication`;
- no platform metrics ingestion adapter;
- no external automation-center adapter using the frozen task/handoff contracts.

### INTENTIONAL_HUMAN_GATE

- production of real A2/B3 visual assets;
- human visual QA and approval;
- human editorial review;
- manual platform publishing and confirmation;
- manual/platform metrics evidence backfill;
- post-publish business review.

Human publishing is an intentional safety boundary, not an engineering defect. `AUTOMATIC_PUBLISHING=NONE` remains authoritative.

## Seal invariants

- source effective coverage `600/600`, `UNKNOWN=0`;
- source raw tree unchanged;
- real content/media/Prompt/Case loss `0`;
- one production database and one public facade;
- Dashboard production-data driven;
- Queue authoritative-fact derived;
- Recovery/restart/transaction/idempotency tests pass;
- future UI may integrate only through the surface defined in `UI_READY_CONTRACT.md`.
