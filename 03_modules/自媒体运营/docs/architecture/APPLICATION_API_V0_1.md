# Creator Ops Application API V0.1

## Public entry point

Consumers import only from `creator_ops` and create the facade with:

```python
from creator_ops import create_creator_ops_application

app = create_creator_ops_application(optional_absolute_local_database_path)
```

`API_VERSION` is `0.1`. The top-level package exports only the facade, factory,
public DTO/result types, versions, and lifecycle/result enums. SQLite adapters,
repositories, serializers, transaction helpers, Domain entities, and internal
services are not public exports.

## Lifecycle and diagnostics

- `open()` opens only an existing compatible database.
- `initialize_local_store(confirmation=True)` is the only creation path.
- `close()` is idempotent and releases the connection.
- `health()` reports module, schema, query, historical-asset, publishing, and
  network status without making a network request.
- `get_runtime_info()` reports the actual local path and capabilities.

## Read API

- `get_dashboard(now=...)`
- `get_work_queue(now=...)`
- `get_content_detail(content_id)`
- `list_content(state=...)`
- `list_accounts()`
- `get_account_workload(account_id, now=...)`
- `get_publishing_workbench(...)`
- `get_metrics_workbench(...)`
- `get_review_workbench(...)`
- `get_activity()`

List/detail operations return public DTOs. Existing operator dashboard and
workbench read models are reused; no repository row is returned.

## Command API

Supported local commands include creator/account bootstrap, idea creation,
drafting, asset attachment, review submit/approve/reject, ready gating, manual
publish confirmation, metrics, post-publish review, operator overlay updates,
and explicit local backup.

Every command returns `CommandResult` with `command`, `status`, `entity_id`,
`content_id`, `updated_state`, `warnings`, `error`, and optional public `data`.
Stable statuses are `SUCCESS`, `REJECTED`, `NOT_FOUND`, `CONFLICT`,
`VALIDATION_ERROR`, `CONFIRMATION_REQUIRED`, and `STORAGE_ERROR`.

The facade contains no SQL. Commands flow through the persistent application
service, existing Domain/Pipeline rules, transaction boundary, and repositories.
Manual publish continues through the single 002/003B/004 path and requires
`manual_confirmation=True`. It records a completed manual action; it never logs
in, calls a platform API, automates a browser, or publishes externally.

## Capability truth

- Automatic publishing: `NONE`
- Network capability: `NONE`
- Historical assets: `HISTORICAL_ASSET_LOCATION_UNRESOLVED`

