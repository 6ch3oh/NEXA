"""Read-only database inspection used before the SQLite adapter is built."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

from creator_ops.api.contracts import DatabaseState
from creator_ops.persistence.sqlite_adapter import (
    DatabaseLocation, PREVIOUS_SCHEMA_VERSION, SCHEMA_VERSION,
)


@dataclass(frozen=True)
class DatabaseInspection:
    state: DatabaseState
    schema_version: str | None
    message: str


class DatabaseLifecycleService:
    """Inspect an existing file through SQLite read-only mode; never creates it."""

    def __init__(self, database_path: str | Path) -> None:
        self.database_path = DatabaseLocation.validate(Path(database_path))

    def inspect(self) -> DatabaseInspection:
        path = self.database_path
        if not path.exists():
            return DatabaseInspection(DatabaseState.NOT_INITIALIZED, None, "Local store is not initialized")
        if not path.is_file():
            return DatabaseInspection(DatabaseState.STORAGE_ERROR, None, "Database location is not a file")
        connection: sqlite3.Connection | None = None
        try:
            connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
            has_metadata = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='metadata'"
            ).fetchone()
            if has_metadata is None:
                return DatabaseInspection(
                    DatabaseState.UNSUPPORTED_SCHEMA, None,
                    "Existing file is not a compatible Creator Ops database",
                )
            row = connection.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()
            found = row[0] if row else None
            if found not in {SCHEMA_VERSION, PREVIOUS_SCHEMA_VERSION}:
                return DatabaseInspection(
                    DatabaseState.UNSUPPORTED_SCHEMA, found,
                    "Database schema version is unsupported",
                )
            message = "Compatible local store is ready"
            if found == PREVIOUS_SCHEMA_VERSION:
                message = "Compatible local store is ready for additive V0.2 migration"
            return DatabaseInspection(DatabaseState.READY, found, message)
        except (sqlite3.Error, OSError):
            return DatabaseInspection(DatabaseState.STORAGE_ERROR, None, "Unable to inspect local database")
        finally:
            if connection is not None:
                connection.close()
