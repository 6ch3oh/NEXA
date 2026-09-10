# Creator Ops Local Persistence V0.1

## Technology and boundary

The adapter uses Python's standard-library `sqlite3`; the module has no existing
database package and no new dependency or ORM was introduced.

The layering remains:

`Domain → Repository Contract → SQLite Adapter`

Domain imports no SQLite code. Pipeline imports no repository code. SQL exists
only inside the persistence adapter. Domain IDs are table primary keys; no
SQLite auto-increment identity is exposed to the application.

## Database location

The formal default is:

`<PROJECT_ROOT>\03_modules\自媒体运营\runtime\data\creator_ops_v0_1.sqlite3`

V0.1 validates paths fail-closed. A database/backup must be an absolute local
path inside this module or the operating-system temporary directory used by
tests. Relative, UNC/network, drive-root and random user paths are rejected.
This task created no formal operating database; every database was temporary.

## Schema V0.1

Schema version: `creator_ops_schema_v0.1`

Structured tables:

- metadata
- creators
- accounts
- content_items
- content_account_relations
- assets
- content_asset_relations
- asset_account_relations
- publish_records
- metrics
- reviews
- work_item_overlays

Queryable IDs, states, statuses, timestamps, relations and metrics are columns.
JSON is limited to nested provenance, legacy reference, extension fields,
platform intent and review list fields. Whole Domain objects are never stored as
single blobs.

## Serialization and hydration

Dedicated helpers round-trip aware timestamps, enums, provenance, legacy
references, nullable fields and extension JSON. Invalid serialization or stored
JSON/timestamp values produce stable `VALIDATION_ERROR` failures. Metrics map
SQLite NULL to Python `None` and integer zero to `0` without coercion.

## Repository and errors

Creator, Account, Content, Asset, PublishRecord, Metrics and Review repositories
support save/get/list/update and required relationship queries. Duplicate Domain
IDs return `CONFLICT`; missing IDs return `NOT_FOUND`.

Public error codes are:

- NOT_FOUND
- CONFLICT
- VALIDATION_ERROR
- STORAGE_ERROR
- SCHEMA_VERSION_UNSUPPORTED
- TRANSACTION_FAILED

Messages do not include SQL or database paths; internal cause is retained for
diagnostics/tests.

## Transactions and backup

The application coordinator uses one local `BEGIN IMMEDIATE` transaction for
manual publish, initial metrics recording and review completion. Any exception
rolls back every write and returns `TRANSACTION_FAILED`.

`create_local_backup` is an explicit local-only SQLite snapshot. It refuses an
existing destination or an active transaction and performs no cloud upload,
scheduling or third-party sync.

## Version and migration boundary

Opening an existing database requires the exact V0.1 version. Missing or unknown
versions call the explicit future schema-migration hook, which currently rejects
the database. This hook concerns Creator Ops DB schema only; legacy historical
asset migration remains the separate 003A/Compatibility boundary.
