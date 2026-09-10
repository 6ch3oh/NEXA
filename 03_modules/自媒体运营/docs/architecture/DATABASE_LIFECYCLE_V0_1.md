# Database Lifecycle Contract V0.1

The formal default contract is:

`<PROJECT_ROOT>\03_modules\自媒体运营\runtime\data\creator_ops_v0_1.sqlite3`

## States

- `NOT_INITIALIZED`: the database file does not exist.
- `READY`: a compatible database exists but is not open.
- `OPEN`: the composition root owns an open connection and queries are available.
- `CLOSED`: a previously opened compatible connection has been released.
- `UNSUPPORTED_SCHEMA`: the file is not a Creator Ops V0.1 database or its schema
  does not equal `creator_ops_schema_v0.1`.
- `STORAGE_ERROR`: local inspection/opening failed.

Inspection uses SQLite read-only mode, so `open()` cannot create the file or its
parent. A missing database returns `INITIALIZATION_REQUIRED`.

Only `initialize_local_store(confirmation=True)` may create a database and its
parent. `confirmation=False` creates nothing. Repeating initialization against
an open or compatible database is idempotent and never truncates, overwrites, or
deletes data. Unknown files and higher schema versions fail closed. V0.1 performs
no migration; a future destructive/incompatible migration must first require an
explicit successful local backup.

Backups are explicit, local, non-overwriting snapshots. They are rejected for an
uninitialized/closed store, an unsafe database state, an existing target, the
source file itself, or a path outside approved local roots. There is no upload or
scheduled backup.

All automated tests use temporary databases. Merely resolving or opening the
default path must not create `runtime/data` or the formal database.

