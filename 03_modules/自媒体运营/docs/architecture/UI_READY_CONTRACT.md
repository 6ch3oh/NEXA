# UI READY CONTRACT

Status: `READY / IMPLEMENTED`  
Goal: `NEXA-CREATOR-FULL-CONSOLIDATION-GOAL-003` → `NEXA-CREATOR-UI-PRODUCT-GOAL-001` → `NEXA-CREATOR-OPS-CORE-HANDOFF-001`  
Facades: `creator_ops.CreatorOpsApplication` (Python) / `src/index.mjs` (Core)  
API version: `0.2`

## Implemented local UI

`CREATOR_OPS_LOCAL_UI_V0.1 = READY`.

The reference implementation is `src/creator_ops/ui/**`; its normal operator entry is `start_creator_ops_ui.cmd`. It uses a zero-dependency Python standard-library loopback host and vanilla HTML/CSS/JavaScript. The UI adapter imports only the controlled top-level `creator_ops` public surface. `tests/test_creator_ops_ui.py` enforces the import boundary automatically.

The versioned Core consumer handoff is now ready through `src/index.mjs`. It hosts the same UI and preserves this facade; it does not create a second database, workflow, repository route or publishing executor.

## Core host contract

The authoritative Core entrypoint is `src/index.mjs`; its machine-readable mirror is `creator-ops.integration.json`. The frozen identities are `moduleId=creator-ops` and `routeId=creator-ops`, with UI host contract `1.0`. Core calls `createCreatorOpsUIHost()` or `createCreatorOpsController()`, awaits `start()`, consumes the returned `endpoint`, and calls `stop()` during shell shutdown. Core must not parse stdout or import the private host facade.

Host readiness distinguishes `CREATED`, `STARTING`, `READY`, `STOPPING`, `STOPPED`, and `ERROR`, and always exposes safe `errorCode`, safe `message`, endpoint, runtime count, and generation. Detailed ownership and lifecycle rules are frozen in `CREATOR_OPS_CORE_HANDOFF_V1.md`.
## Integration rule

A future UI may import only names exposed through `creator_ops.__all__` and call a `CreatorOpsApplication` instance created by `create_creator_ops_application(...)`.

It must not import persistence adapters, repositories, query services, legacy CLI modules or `source_import`. It must not infer state changes from button clicks. Commands return `CommandResult`; the UI refreshes canonical reads after success.

## Lifecycle

1. Construct with `create_creator_ops_application()` or an explicitly authorized database path.
2. Call `open()`.
3. If the database is absent, show initialization as a deliberate operator action; call `initialize_local_store(confirmation=True)` only after explicit confirmation.
4. Call `close()` when the application scope ends. Close is idempotent.

The local host owns these calls. It opens and serves the application on one server thread so the SQLite connection remains on its owning thread, then closes on that same thread during shutdown. It binds only `127.0.0.1`, releases the port/connection cleanly and is restart-safe. It never silently initializes the formal production database.

Lifecycle states and errors are public values: `DatabaseState`, `LifecycleStatus`, `LifecycleResult`, `CreatorOpsAPIError`, `PublicError`, `CommandStatus` and `CommandResult`.

The UI must not display raw database paths or exception traces as user-facing errors. Use stable error `code`, `message` and command `status`.

## Stable read surface

| UI need | Facade method | Public result |
|---|---|---|
| Runtime/version | `get_runtime_info()` | `RuntimeInfo` |
| Health/business blockers | `health()` | `HealthReport` |
| Operator dashboard | `get_dashboard(now=...)` | `OperatorDashboard` |
| Work queue | `get_work_queue(now=...)` | `tuple[WorkItem, ...]` |
| Content list/detail | `list_content(...)`, `get_content_detail(...)` | `ContentDTO`, `ContentDetailDTO` |
| Creator/account list | `list_creators()`, `list_accounts()` | `CreatorDTO`, `AccountDTO` |
| Account workload | `get_account_workload(...)` | `AccountWorkload` |
| Manual publish preparation | `get_publishing_workbench(...)` | `ManualPublishingWorkbench` |
| Editorial/post-publish review | `get_real_review_workbench(...)`, `get_review_workbench(...)` | `RealReviewWorkbench`, `ReviewWorkbench` |
| Package compatibility | `validate_legacy_package(...)`, `map_legacy_content_request(...)` | public package contracts |
| Formal QA history | `list_qa_receipts(...)` | `tuple[QAReceipt, ...]` |
| Task/recovery | `list_runtime_tasks()`, `list_recovery_evidence(...)` | `DurableTask`, `RecoveryEvidence` |
| Research | `list_research(...)`, `plan_topics(...)` | `ResearchSession`, `TopicCandidate` |
| Asset requirements | `get_asset_requirements(...)` | `tuple[AssetRequirement, ...]` |
| Human image handoff | `get_visual_production_packet(...)` | `VisualProductionPacket` |
| Intake status | `get_asset_intake_status(...)` | `AssetIntakeStatus` |
| Intake submissions | `list_asset_submissions(...)` | `tuple[AssetIntakeSubmission, ...]` |
| Visual review | `get_visual_review_workbench(...)` | `VisualReviewWorkbench` |
| Visual review history | `list_visual_review_records(...)` | `tuple[VisualReviewRecord, ...]` |
| Audit trail | `get_audit_trail(...)`, `get_activity()` | `AuditEvent`, `ActivityEvent` |

All listed UI view types are frozen dataclasses or immutable tuples and are exported on the controlled public surface. They are not SQLite rows.

## Authoritative screen semantics

### Dashboard and Queue

`get_dashboard(now).work_queue == get_work_queue(now)` for the same database state and time. Dashboard must render the returned WorkItems and NextActions; it must not recompute priority, blockers or next action.

`AccountWorkload.blocked_count` includes canonical lifecycle blocks and blocked WorkItems such as missing required visual assets.

### Content detail

Use `content_id` for identity. Never join by title. `ContentDetailDTO` is the authoritative aggregate of content, accounts, assets, publish records, metrics and reviews.

### Package and QA

Package readiness is not a UI calculation. The UI displays package/QA results and calls command methods. Only current package and Publish Prep QA evidence may permit readiness.

### Review

- QA: objective pre-publish checks;
- Real/Editorial Review: human business approval before publish;
- ReviewWorkbench/Review: post-publish analysis;
- LegacyCase: research evidence.

These must be separate UI concepts.

### Asset intake

The visual flow is:

```text
VisualProductionPacket
→ submit_asset
→ AssetIntakeStatus
→ VisualReviewWorkbench
→ review_visual_asset (explicit human confirmation)
→ continue_visual_asset_pipeline
```

The UI cannot auto-approve, fabricate a verified asset, move source assets or bypass the human visual gate.

### Publishing

The UI may prepare and display the Manual Publishing Workbench. `confirm_manual_publish(...)` records evidence only after the operator confirms the real external action. There is no publish executor, login flow, cookie/token storage or network publishing capability.

## Stable command families

- identity/content: create creator/account/idea, draft, attach/activate asset;
- QA/package: run QA, build package, explicitly roll back staging;
- runtime: create/acquire/heartbeat/release/complete/fail/recover task;
- review/publishing: submit/approve/reject review, mark ready, manual publish confirmation, metrics/review backfill;
- visual intake: freeze requirements, submit, review, complete package and recover;
- backup/import/activation: explicit confirmation and receipt-bearing commands only.

Every command must be treated as idempotent-or-conflict according to its contract. A UI must not silently retry a conflict with changed payload.

## Health interpretation

- `HEALTHY` means the local runtime and database are operational.
- `business_state=BUSINESS_BLOCKED` may coexist with healthy engineering state, for example while real assets are missing.
- `automatic_publishing` and `network_capability` must remain `NONE`.
- Human gates are displayed as required operator actions, not system outages.

## Compatibility guarantee

New fields may be added compatibly. Existing public names and meanings must not change without an explicit API-version decision and regression update. Internal repositories, SQL tables and legacy source shapes are not UI contracts.

V0.1 adds compatible `ProvenanceDTO`, `created_at` and `updated_at` presentation fields to existing public DTOs. UI contract regression tests must fail before any future incompatible change can silently break the product.

Full implementation and acceptance evidence are recorded in `CREATOR_OPS_LOCAL_UI_V0_1.md` and `NEXA_CREATOR_UI_PRODUCT_GOAL_001_REPORT.md`.
