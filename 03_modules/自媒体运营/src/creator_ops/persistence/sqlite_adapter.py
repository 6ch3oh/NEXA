"""SQLite adapter for Creator Ops repositories and local transactions."""

from __future__ import annotations

import sqlite3
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator, Sequence

from creator_ops.application.work_queue import WorkItemStatus
from creator_ops.application.runtime import (
    AuditEvent, DurableTask, DurableTaskLock, DurableTaskStatus, DurableTaskType,
    RecoveryDecision, RecoveryEvidence,
)
from creator_ops.application.qa_runtime import (
    QAReceipt, QAReceiptStatus, QAType, RuntimeQACheck,
)
from creator_ops.application.research import (
    ResearchSession, ResearchSource, ResearchSourceType, ResearchStatus,
)
from creator_ops.application.production_import import (
    ProductionBackupReceipt, ProductionImportDisposition, ProductionImportLedgerEntry,
    ProductionImportReceipt,
)
from creator_ops.application.canonical_activation import (
    ActivationResolutionStatus, CanonicalActivationReceipt,
    CanonicalActivationResolution,
)
from creator_ops.application.visual_asset_pipeline import (
    AssetIntakeSubmission, AssetRequirement, AssetRequirementStatus,
    AssetSubmissionStatus, MediaValidationResult, MediaValidationStatus,
    VisualReviewDecision, VisualReviewRecord,
)
from creator_ops.domain.models import (
    Account, AccountStatus, Asset, AssetStatus, AssetType, ContentItem, ContentState,
    ContentType, Creator, CreatorStatus, GenerationMethod, Metrics, PublicationMode,
    PublishReadiness, PublishRecord, PublishStatus, Review, ReviewState, ReviewStatus,
)
from creator_ops.persistence.contracts import WorkItemOverlay
from creator_ops.persistence.errors import PersistenceError, PersistenceErrorCode
from creator_ops.persistence.serialization import (
    dump_datetime, dump_extensions, dump_json, dump_legacy_reference, dump_provenance,
    load_datetime, load_extensions, load_json, load_legacy_reference, load_provenance,
)


SCHEMA_VERSION = "creator_ops_schema_v0.2"
PREVIOUS_SCHEMA_VERSION = "creator_ops_schema_v0.1"


class DatabaseLocation:
    @staticmethod
    def module_root() -> Path:
        return Path(__file__).resolve().parents[3]

    @classmethod
    def default_path(cls) -> Path:
        return cls.module_root() / "runtime" / "data" / "creator_ops_v0_1.sqlite3"

    @classmethod
    def validate(cls, path: Path) -> Path:
        if not path.is_absolute() or str(path).startswith(("\\\\", "//")):
            raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Database path must be an absolute local path")
        resolved = path.resolve(strict=False)
        allowed_roots = (cls.module_root().resolve(), Path(tempfile.gettempdir()).resolve())
        if not any(resolved == root or resolved.is_relative_to(root) for root in allowed_roots):
            raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Database path is outside allowed local storage")
        if resolved == Path(resolved.anchor):
            raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Database path is too broad")
        return resolved


class SQLiteCreatorOpsStore:
    """Connection owner, transaction boundary, repositories and backup contract."""

    def __init__(self, database_path: str | Path = ":memory:") -> None:
        self.database_path = database_path
        self._transaction_depth = 0
        if str(database_path) != ":memory:":
            path = DatabaseLocation.validate(Path(database_path))
            if not path.parent.exists():
                raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Database parent directory does not exist")
        try:
            self.connection = sqlite3.connect(str(database_path), isolation_level=None)
            self.connection.row_factory = sqlite3.Row
            self.connection.execute("PRAGMA foreign_keys = ON")
            self._initialize_schema()
        except PersistenceError:
            if hasattr(self, "connection"):
                self.connection.close()
            raise
        except sqlite3.Error as exc:
            if hasattr(self, "connection"):
                self.connection.close()
            raise PersistenceError(PersistenceErrorCode.STORAGE_ERROR, "Unable to open local database", cause=exc) from exc

        self.creators = SQLiteCreatorRepository(self)
        self.accounts = SQLiteAccountRepository(self)
        self.contents = SQLiteContentRepository(self)
        self.assets = SQLiteAssetRepository(self)
        self.publish_records = SQLitePublishRecordRepository(self)
        self.metrics = SQLiteMetricsRepository(self)
        self.reviews = SQLiteReviewRepository(self)
        self.work_item_overlays = SQLiteWorkItemOverlayRepository(self)
        self.runtime = SQLiteRuntimeRepository(self)
        self.production_import = SQLiteProductionImportRepository(self)
        self.visual_assets = SQLiteVisualAssetRepository(self)

    @classmethod
    def open_default(cls) -> "SQLiteCreatorOpsStore":
        path = DatabaseLocation.default_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        return cls(path)

    def _initialize_schema(self) -> None:
        has_metadata = self.connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='metadata'"
        ).fetchone()
        if has_metadata:
            row = self.connection.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()
            if row is not None and row["value"] == PREVIOUS_SCHEMA_VERSION:
                self._migrate_v0_1_to_v0_2()
                return
            if row is None or row["value"] != SCHEMA_VERSION:
                found = row["value"] if row is not None else "missing"
                self.schema_migration_hook(found, SCHEMA_VERSION)
            self._ensure_current_schema()
            return
        schema_path = Path(__file__).with_name("schema_v0_1.sql")
        try:
            self.connection.executescript(schema_path.read_text(encoding="utf-8"))
            self.connection.execute(
                "INSERT INTO metadata(key,value) VALUES('schema_version',?)", (SCHEMA_VERSION,)
            )
        except (OSError, sqlite3.Error) as exc:
            raise PersistenceError(PersistenceErrorCode.STORAGE_ERROR, "Unable to initialize local schema", cause=exc) from exc

    def _migrate_v0_1_to_v0_2(self) -> None:
        """Additive migration that never rewrites an existing business entity row."""
        schema_path = Path(__file__).with_name("schema_v0_1.sql")
        try:
            self.connection.executescript(schema_path.read_text(encoding="utf-8"))
            self.connection.execute(
                "UPDATE metadata SET value=? WHERE key='schema_version'", (SCHEMA_VERSION,)
            )
        except (OSError, sqlite3.Error) as exc:
            raise PersistenceError(
                PersistenceErrorCode.STORAGE_ERROR, "Unable to migrate local schema", cause=exc,
            ) from exc

    def _ensure_current_schema(self) -> None:
        """Apply create-if-absent extensions within the compatible V0.2 contract."""
        required = {
            "durable_tasks", "durable_task_locks", "recovery_evidence", "audit_events",
            "qa_receipts", "research_sessions", "production_store_metadata",
            "production_import_ledger", "production_import_receipts",
            "production_backup_receipts",
            "canonical_activation_resolutions", "canonical_activation_receipts",
            "asset_requirements", "asset_intake_submissions", "visual_review_decisions",
        }
        present = {
            row[0] for row in self.connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if required.issubset(present):
            return
        schema_path = Path(__file__).with_name("schema_v0_1.sql")
        try:
            self.connection.executescript(schema_path.read_text(encoding="utf-8"))
        except (OSError, sqlite3.Error) as exc:
            raise PersistenceError(
                PersistenceErrorCode.STORAGE_ERROR,
                "Unable to ensure current local schema extensions", cause=exc,
            ) from exc

    @staticmethod
    def schema_migration_hook(found_version: str, target_version: str) -> None:
        """Future DB-schema migration hook; V0.1 fails closed on every mismatch."""
        raise PersistenceError(
            PersistenceErrorCode.SCHEMA_VERSION_UNSUPPORTED,
            f"Database schema version is unsupported (expected {target_version})",
        )

    @property
    def schema_version(self) -> str:
        row = self.connection.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()
        return row["value"]

    @contextmanager
    def transaction(self) -> Iterator[None]:
        if self._transaction_depth:
            raise PersistenceError(PersistenceErrorCode.TRANSACTION_FAILED, "Nested transactions are not supported")
        self._transaction_depth = 1
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            yield
            self.connection.execute("COMMIT")
        except Exception as exc:
            try:
                self.connection.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            if isinstance(exc, PersistenceError) and exc.code is PersistenceErrorCode.TRANSACTION_FAILED:
                raise
            raise PersistenceError(PersistenceErrorCode.TRANSACTION_FAILED, "Local transaction failed", cause=exc) from exc
        finally:
            self._transaction_depth = 0

    def create_local_backup(self, destination: str | Path) -> Path:
        if self._transaction_depth or self.connection.in_transaction:
            raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Backup requires an idle database")
        target = Path(destination)
        target = DatabaseLocation.validate(target)
        if not target.parent.exists() or target.exists() or (
            str(self.database_path) != ":memory:" and target == Path(self.database_path).resolve(strict=False)
        ):
            raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Backup destination must be a new absolute local file")
        backup_connection: sqlite3.Connection | None = None
        try:
            backup_connection = sqlite3.connect(str(target))
            self.connection.backup(backup_connection)
            backup_connection.close()
            return target
        except (OSError, sqlite3.Error) as exc:
            if backup_connection is not None:
                backup_connection.close()
            if target.exists():
                target.unlink()
            raise PersistenceError(PersistenceErrorCode.STORAGE_ERROR, "Local backup failed", cause=exc) from exc

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "SQLiteCreatorOpsStore":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _insert(self, table: str, values: dict[str, Any]) -> None:
        columns = ",".join(values)
        placeholders = ",".join("?" for _ in values)
        try:
            self.connection.execute(
                f"INSERT INTO {table}({columns}) VALUES({placeholders})", tuple(values.values())
            )
        except sqlite3.IntegrityError as exc:
            raise PersistenceError(PersistenceErrorCode.CONFLICT, "Domain identity already exists", cause=exc) from exc
        except sqlite3.Error as exc:
            raise PersistenceError(PersistenceErrorCode.STORAGE_ERROR, "Local storage write failed", cause=exc) from exc

    def _update(self, table: str, id_column: str, entity_id: str, values: dict[str, Any]) -> None:
        assignments = ",".join(f"{name}=?" for name in values)
        try:
            cursor = self.connection.execute(
                f"UPDATE {table} SET {assignments} WHERE {id_column}=?",
                (*values.values(), entity_id),
            )
            if cursor.rowcount != 1:
                raise PersistenceError(PersistenceErrorCode.NOT_FOUND, "Entity was not found")
        except PersistenceError:
            raise
        except sqlite3.Error as exc:
            raise PersistenceError(PersistenceErrorCode.STORAGE_ERROR, "Local storage update failed", cause=exc) from exc

    def _get_row(self, table: str, id_column: str, entity_id: str) -> sqlite3.Row:
        row = self.connection.execute(
            f"SELECT * FROM {table} WHERE {id_column}=?", (entity_id,)
        ).fetchone()
        if row is None:
            raise PersistenceError(PersistenceErrorCode.NOT_FOUND, "Entity was not found")
        return row


class _BaseRepository:
    table: str
    id_column: str

    def __init__(self, store: SQLiteCreatorOpsStore) -> None:
        self.store = store

    def _rows(self, where: str = "", params: Sequence[Any] = ()) -> tuple[sqlite3.Row, ...]:
        sql = f"SELECT * FROM {self.table}" + (f" WHERE {where}" if where else "") + f" ORDER BY {self.id_column}"
        return tuple(self.store.connection.execute(sql, tuple(params)).fetchall())


class SQLiteCreatorRepository(_BaseRepository):
    table, id_column = "creators", "creator_id"

    @staticmethod
    def _values(entity: Creator) -> dict[str, Any]:
        return {
            "creator_id": entity.creator_id, "name": entity.name, "status": entity.status.value,
            "source": entity.source, "provenance_json": dump_provenance(entity.provenance),
            "created_at": dump_datetime(entity.created_at), "updated_at": dump_datetime(entity.updated_at),
            "legacy_reference_json": dump_legacy_reference(entity.legacy_reference),
            "extension_fields_json": dump_extensions(entity.extension_fields), "version": entity.version,
        }

    @staticmethod
    def _hydrate(row: sqlite3.Row) -> Creator:
        return Creator(
            creator_id=row["creator_id"], name=row["name"], status=CreatorStatus(row["status"]),
            source=row["source"], provenance=load_provenance(row["provenance_json"]),
            created_at=load_datetime(row["created_at"]), updated_at=load_datetime(row["updated_at"]),
            legacy_reference=load_legacy_reference(row["legacy_reference_json"]),
            extension_fields=load_extensions(row["extension_fields_json"]), version=row["version"],
        )

    def save(self, entity: Creator) -> None: self.store._insert(self.table, self._values(entity))
    def get_by_id(self, entity_id: str) -> Creator: return self._hydrate(self.store._get_row(self.table, self.id_column, entity_id))
    def list(self) -> tuple[Creator, ...]: return tuple(self._hydrate(row) for row in self._rows())
    def update(self, entity: Creator) -> None:
        values = self._values(entity); values.pop("creator_id"); self.store._update(self.table, self.id_column, entity.creator_id, values)


class SQLiteAccountRepository(_BaseRepository):
    table, id_column = "accounts", "account_id"

    @staticmethod
    def _values(entity: Account) -> dict[str, Any]:
        return {
            "account_id": entity.account_id, "creator_id": entity.creator_id,
            "legacy_account_code": entity.legacy_account_code, "platform": entity.platform,
            "account_name": entity.account_name, "display_name": entity.display_name,
            "content_direction": entity.content_direction, "status": entity.status.value,
            "source": entity.source, "provenance_json": dump_provenance(entity.provenance),
            "created_at": dump_datetime(entity.created_at), "updated_at": dump_datetime(entity.updated_at),
            "legacy_reference_json": dump_legacy_reference(entity.legacy_reference),
            "extension_fields_json": dump_extensions(entity.extension_fields), "version": entity.version,
        }

    @staticmethod
    def _hydrate(row: sqlite3.Row) -> Account:
        return Account(
            account_id=row["account_id"], creator_id=row["creator_id"],
            legacy_account_code=row["legacy_account_code"], platform=row["platform"],
            account_name=row["account_name"], display_name=row["display_name"],
            content_direction=row["content_direction"], status=AccountStatus(row["status"]),
            source=row["source"], provenance=load_provenance(row["provenance_json"]),
            created_at=load_datetime(row["created_at"]), updated_at=load_datetime(row["updated_at"]),
            legacy_reference=load_legacy_reference(row["legacy_reference_json"]),
            extension_fields=load_extensions(row["extension_fields_json"]), version=row["version"],
        )

    def save(self, entity: Account) -> None: self.store._insert(self.table, self._values(entity))
    def get_by_id(self, entity_id: str) -> Account: return self._hydrate(self.store._get_row(self.table, self.id_column, entity_id))
    def list(self) -> tuple[Account, ...]: return tuple(self._hydrate(row) for row in self._rows())
    def update(self, entity: Account) -> None:
        values = self._values(entity); values.pop("account_id"); self.store._update(self.table, self.id_column, entity.account_id, values)
    def find_by_creator_id(self, creator_id: str) -> tuple[Account, ...]:
        return tuple(self._hydrate(row) for row in self._rows("creator_id=?", (creator_id,)))


class SQLiteContentRepository(_BaseRepository):
    table, id_column = "content_items", "content_id"

    @staticmethod
    def _values(entity: ContentItem) -> dict[str, Any]:
        return {
            "content_id": entity.content_id, "creator_id": entity.creator_id, "topic": entity.topic,
            "title": entity.title, "body": entity.body, "script_reference": entity.script_reference,
            "content_type": entity.content_type.value, "platform_intent_json": dump_json(entity.platform_intent),
            "current_state": entity.current_state.value, "review_state": entity.review_state.value,
            "publish_readiness": entity.publish_readiness.value, "source": entity.source,
            "provenance_json": dump_provenance(entity.provenance),
            "created_at": dump_datetime(entity.created_at), "updated_at": dump_datetime(entity.updated_at),
            "legacy_reference_json": dump_legacy_reference(entity.legacy_reference),
            "extension_fields_json": dump_extensions(entity.extension_fields), "version": entity.version,
        }

    def _hydrate(self, row: sqlite3.Row) -> ContentItem:
        content_id = row["content_id"]
        accounts = tuple(item[0] for item in self.store.connection.execute(
            "SELECT account_id FROM content_account_relations WHERE content_id=? ORDER BY account_id", (content_id,)
        ).fetchall())
        assets = tuple(item[0] for item in self.store.connection.execute(
            "SELECT asset_id FROM content_asset_relations WHERE content_id=? ORDER BY asset_id", (content_id,)
        ).fetchall())
        return ContentItem(
            content_id=content_id, creator_id=row["creator_id"], target_accounts=accounts,
            topic=row["topic"], title=row["title"], body=row["body"], script_reference=row["script_reference"],
            content_type=ContentType(row["content_type"]), platform_intent=tuple(load_json(row["platform_intent_json"], [])),
            asset_references=assets, current_state=ContentState(row["current_state"]),
            review_state=ReviewState(row["review_state"]), publish_readiness=PublishReadiness(row["publish_readiness"]),
            source=row["source"], provenance=load_provenance(row["provenance_json"]),
            created_at=load_datetime(row["created_at"]), updated_at=load_datetime(row["updated_at"]),
            legacy_reference=load_legacy_reference(row["legacy_reference_json"]),
            extension_fields=load_extensions(row["extension_fields_json"]), version=row["version"],
        )

    def _sync_relations(self, entity: ContentItem) -> None:
        self.store.connection.execute("DELETE FROM content_account_relations WHERE content_id=?", (entity.content_id,))
        self.store.connection.executemany(
            "INSERT INTO content_account_relations(content_id,account_id) VALUES(?,?)",
            ((entity.content_id, item) for item in entity.target_accounts),
        )
        self.store.connection.execute("DELETE FROM content_asset_relations WHERE content_id=?", (entity.content_id,))
        self.store.connection.executemany(
            "INSERT INTO content_asset_relations(content_id,asset_id) VALUES(?,?)",
            ((entity.content_id, item) for item in entity.asset_references),
        )

    def save(self, entity: ContentItem) -> None:
        self.store._insert(self.table, self._values(entity)); self._sync_relations(entity)
    def get_by_id(self, entity_id: str) -> ContentItem: return self._hydrate(self.store._get_row(self.table, self.id_column, entity_id))
    def list(self) -> tuple[ContentItem, ...]: return tuple(self._hydrate(row) for row in self._rows())
    def update(self, entity: ContentItem) -> None:
        values = self._values(entity); values.pop("content_id"); self.store._update(self.table, self.id_column, entity.content_id, values); self._sync_relations(entity)
    def find_by_account_id(self, account_id: str) -> tuple[ContentItem, ...]:
        rows = self.store.connection.execute(
            "SELECT c.* FROM content_items c JOIN content_account_relations r ON c.content_id=r.content_id WHERE r.account_id=? ORDER BY c.content_id",
            (account_id,),
        ).fetchall()
        return tuple(self._hydrate(row) for row in rows)
    def find_by_states(self, states: Sequence[str]) -> tuple[ContentItem, ...]:
        if not states: return ()
        placeholders = ",".join("?" for _ in states)
        rows = self.store.connection.execute(
            f"SELECT * FROM content_items WHERE current_state IN ({placeholders}) ORDER BY content_id", tuple(states)
        ).fetchall()
        return tuple(self._hydrate(row) for row in rows)


class SQLiteAssetRepository(_BaseRepository):
    table, id_column = "assets", "asset_id"

    @staticmethod
    def _values(entity: Asset) -> dict[str, Any]:
        return {
            "asset_id": entity.asset_id, "asset_type": entity.asset_type.value, "source": entity.source,
            "location": entity.location, "generation_method": entity.generation_method.value,
            "creator_id": entity.creator_id, "status": entity.status.value,
            "provenance_json": dump_provenance(entity.provenance),
            "created_at": dump_datetime(entity.created_at), "updated_at": dump_datetime(entity.updated_at),
            "legacy_reference_json": dump_legacy_reference(entity.legacy_reference),
            "extension_fields_json": dump_extensions(entity.extension_fields), "version": entity.version,
        }

    def _hydrate(self, row: sqlite3.Row) -> Asset:
        asset_id = row["asset_id"]
        contents = tuple(item[0] for item in self.store.connection.execute(
            "SELECT content_id FROM content_asset_relations WHERE asset_id=? ORDER BY content_id", (asset_id,)
        ).fetchall())
        accounts = tuple(item[0] for item in self.store.connection.execute(
            "SELECT account_id FROM asset_account_relations WHERE asset_id=? ORDER BY account_id", (asset_id,)
        ).fetchall())
        return Asset(
            asset_id=asset_id, asset_type=AssetType(row["asset_type"]), source=row["source"],
            location=row["location"], content_relations=contents,
            provenance=load_provenance(row["provenance_json"]), generation_method=GenerationMethod(row["generation_method"]),
            creator_id=row["creator_id"], account_relations=accounts, status=AssetStatus(row["status"]),
            created_at=load_datetime(row["created_at"]), updated_at=load_datetime(row["updated_at"]),
            legacy_reference=load_legacy_reference(row["legacy_reference_json"]),
            extension_fields=load_extensions(row["extension_fields_json"]), version=row["version"],
        )

    def _sync_relations(self, entity: Asset) -> None:
        for content_id in entity.content_relations:
            self.store.connection.execute(
                "INSERT OR IGNORE INTO content_asset_relations(content_id,asset_id) VALUES(?,?)", (content_id, entity.asset_id)
            )
        self.store.connection.execute("DELETE FROM asset_account_relations WHERE asset_id=?", (entity.asset_id,))
        self.store.connection.executemany(
            "INSERT INTO asset_account_relations(asset_id,account_id) VALUES(?,?)",
            ((entity.asset_id, item) for item in entity.account_relations),
        )

    def save(self, entity: Asset) -> None: self.store._insert(self.table, self._values(entity)); self._sync_relations(entity)
    def get_by_id(self, entity_id: str) -> Asset: return self._hydrate(self.store._get_row(self.table, self.id_column, entity_id))
    def list(self) -> tuple[Asset, ...]: return tuple(self._hydrate(row) for row in self._rows())
    def update(self, entity: Asset) -> None:
        values = self._values(entity); values.pop("asset_id"); self.store._update(self.table, self.id_column, entity.asset_id, values); self._sync_relations(entity)
    def find_by_content_id(self, content_id: str) -> tuple[Asset, ...]:
        rows = self.store.connection.execute(
            "SELECT a.* FROM assets a JOIN content_asset_relations r ON a.asset_id=r.asset_id WHERE r.content_id=? ORDER BY a.asset_id", (content_id,)
        ).fetchall()
        return tuple(self._hydrate(row) for row in rows)


class SQLitePublishRecordRepository(_BaseRepository):
    table, id_column = "publish_records", "publish_record_id"

    @staticmethod
    def _values(entity: PublishRecord) -> dict[str, Any]:
        return {
            "publish_record_id": entity.publish_record_id, "platform": entity.platform,
            "account_id": entity.account_id, "content_id": entity.content_id,
            "publish_status": entity.publish_status.value, "planned_time": dump_datetime(entity.planned_time),
            "actual_publish_time": dump_datetime(entity.actual_publish_time), "external_url": entity.external_url,
            "external_post_id": entity.external_post_id, "manual_confirmation": int(entity.manual_confirmation),
            "publication_mode": entity.publication_mode.value, "source": entity.source,
            "provenance_json": dump_provenance(entity.provenance),
            "created_at": dump_datetime(entity.created_at), "updated_at": dump_datetime(entity.updated_at),
            "legacy_reference_json": dump_legacy_reference(entity.legacy_reference),
            "extension_fields_json": dump_extensions(entity.extension_fields), "version": entity.version,
        }

    @staticmethod
    def _hydrate(row: sqlite3.Row) -> PublishRecord:
        return PublishRecord(
            publish_record_id=row["publish_record_id"], platform=row["platform"], account_id=row["account_id"],
            content_id=row["content_id"], publish_status=PublishStatus(row["publish_status"]),
            planned_time=load_datetime(row["planned_time"]), actual_publish_time=load_datetime(row["actual_publish_time"]),
            external_url=row["external_url"], external_post_id=row["external_post_id"],
            manual_confirmation=bool(row["manual_confirmation"]), publication_mode=PublicationMode(row["publication_mode"]),
            source=row["source"], provenance=load_provenance(row["provenance_json"]),
            created_at=load_datetime(row["created_at"]), updated_at=load_datetime(row["updated_at"]),
            legacy_reference=load_legacy_reference(row["legacy_reference_json"]),
            extension_fields=load_extensions(row["extension_fields_json"]), version=row["version"],
        )

    def save(self, entity: PublishRecord) -> None: self.store._insert(self.table, self._values(entity))
    def get_by_id(self, entity_id: str) -> PublishRecord: return self._hydrate(self.store._get_row(self.table, self.id_column, entity_id))
    def list(self) -> tuple[PublishRecord, ...]: return tuple(self._hydrate(row) for row in self._rows())
    def update(self, entity: PublishRecord) -> None:
        values = self._values(entity); values.pop("publish_record_id"); self.store._update(self.table, self.id_column, entity.publish_record_id, values)
    def find_by_content_id(self, content_id: str) -> tuple[PublishRecord, ...]:
        return tuple(self._hydrate(row) for row in self._rows("content_id=?", (content_id,)))
    def find_latest(self, limit: int = 20) -> tuple[PublishRecord, ...]:
        rows = self.store.connection.execute(
            "SELECT * FROM publish_records ORDER BY actual_publish_time DESC, publish_record_id DESC LIMIT ?", (limit,)
        ).fetchall()
        return tuple(self._hydrate(row) for row in rows)


class SQLiteMetricsRepository(_BaseRepository):
    table, id_column = "metrics", "metrics_id"

    @staticmethod
    def _values(entity: Metrics) -> dict[str, Any]:
        return {
            "metrics_id": entity.metrics_id, "publish_record_id": entity.publish_record_id,
            "views": entity.views, "impressions": entity.impressions, "likes": entity.likes,
            "comments": entity.comments, "favorites": entity.favorites, "shares": entity.shares,
            "followers_delta": entity.followers_delta, "engagement": entity.engagement,
            "collected_at": dump_datetime(entity.collected_at), "source": entity.source,
            "provenance_json": dump_provenance(entity.provenance),
            "created_at": dump_datetime(entity.created_at), "updated_at": dump_datetime(entity.updated_at),
            "legacy_reference_json": dump_legacy_reference(entity.legacy_reference),
            "extension_fields_json": dump_extensions(entity.extension_fields), "version": entity.version,
        }

    @staticmethod
    def _hydrate(row: sqlite3.Row) -> Metrics:
        return Metrics(
            metrics_id=row["metrics_id"], publish_record_id=row["publish_record_id"],
            views=row["views"], impressions=row["impressions"], likes=row["likes"], comments=row["comments"],
            favorites=row["favorites"], shares=row["shares"], followers_delta=row["followers_delta"],
            engagement=row["engagement"], collected_at=load_datetime(row["collected_at"]),
            source=row["source"], provenance=load_provenance(row["provenance_json"]),
            created_at=load_datetime(row["created_at"]), updated_at=load_datetime(row["updated_at"]),
            legacy_reference=load_legacy_reference(row["legacy_reference_json"]),
            extension_fields=load_extensions(row["extension_fields_json"]), version=row["version"],
        )

    def save(self, entity: Metrics) -> None: self.store._insert(self.table, self._values(entity))
    def get_by_id(self, entity_id: str) -> Metrics: return self._hydrate(self.store._get_row(self.table, self.id_column, entity_id))
    def list(self) -> tuple[Metrics, ...]: return tuple(self._hydrate(row) for row in self._rows())
    def update(self, entity: Metrics) -> None:
        values = self._values(entity); values.pop("metrics_id"); self.store._update(self.table, self.id_column, entity.metrics_id, values)
    def find_by_publish_record_id(self, publish_record_id: str) -> tuple[Metrics, ...]:
        return tuple(self._hydrate(row) for row in self._rows("publish_record_id=?", (publish_record_id,)))
    def find_latest(self, publish_record_id: str) -> Metrics | None:
        row = self.store.connection.execute(
            "SELECT * FROM metrics WHERE publish_record_id=? ORDER BY collected_at DESC,metrics_id DESC LIMIT 1", (publish_record_id,)
        ).fetchone()
        return self._hydrate(row) if row is not None else None


class SQLiteReviewRepository(_BaseRepository):
    table, id_column = "reviews", "review_id"

    @staticmethod
    def _values(entity: Review) -> dict[str, Any]:
        return {
            "review_id": entity.review_id, "content_id": entity.content_id,
            "publish_record_id": entity.publish_record_id,
            "metric_snapshot_id": entity.metric_snapshot.metrics_id if entity.metric_snapshot else None,
            "strengths_json": dump_json(entity.strengths), "weaknesses_json": dump_json(entity.weaknesses),
            "reusable_patterns_json": dump_json(entity.reusable_patterns),
            "failed_patterns_json": dump_json(entity.failed_patterns), "next_action": entity.next_action,
            "evidence_json": dump_json(entity.evidence), "reviewed_at": dump_datetime(entity.reviewed_at),
            "status": entity.status.value, "source": entity.source,
            "provenance_json": dump_provenance(entity.provenance),
            "created_at": dump_datetime(entity.created_at), "updated_at": dump_datetime(entity.updated_at),
            "legacy_reference_json": dump_legacy_reference(entity.legacy_reference),
            "extension_fields_json": dump_extensions(entity.extension_fields), "version": entity.version,
        }

    def _hydrate(self, row: sqlite3.Row) -> Review:
        snapshot = self.store.metrics.get_by_id(row["metric_snapshot_id"]) if row["metric_snapshot_id"] else None
        return Review(
            review_id=row["review_id"], content_id=row["content_id"], publish_record_id=row["publish_record_id"],
            metric_snapshot=snapshot, strengths=tuple(load_json(row["strengths_json"], [])),
            weaknesses=tuple(load_json(row["weaknesses_json"], [])),
            reusable_patterns=tuple(load_json(row["reusable_patterns_json"], [])),
            failed_patterns=tuple(load_json(row["failed_patterns_json"], [])), next_action=row["next_action"],
            evidence=tuple(load_json(row["evidence_json"], [])), reviewed_at=load_datetime(row["reviewed_at"]),
            status=ReviewStatus(row["status"]), source=row["source"],
            provenance=load_provenance(row["provenance_json"]), created_at=load_datetime(row["created_at"]),
            updated_at=load_datetime(row["updated_at"]), legacy_reference=load_legacy_reference(row["legacy_reference_json"]),
            extension_fields=load_extensions(row["extension_fields_json"]), version=row["version"],
        )

    def save(self, entity: Review) -> None: self.store._insert(self.table, self._values(entity))
    def get_by_id(self, entity_id: str) -> Review: return self._hydrate(self.store._get_row(self.table, self.id_column, entity_id))
    def list(self) -> tuple[Review, ...]: return tuple(self._hydrate(row) for row in self._rows())
    def update(self, entity: Review) -> None:
        values = self._values(entity); values.pop("review_id"); self.store._update(self.table, self.id_column, entity.review_id, values)
    def find_by_content_id(self, content_id: str) -> tuple[Review, ...]:
        return tuple(self._hydrate(row) for row in self._rows("content_id=?", (content_id,)))
    def find_by_publish_record_id(self, publish_record_id: str) -> tuple[Review, ...]:
        return tuple(self._hydrate(row) for row in self._rows("publish_record_id=?", (publish_record_id,)))


class SQLiteWorkItemOverlayRepository(_BaseRepository):
    table, id_column = "work_item_overlays", "work_item_id"

    @staticmethod
    def _values(entity: WorkItemOverlay) -> dict[str, Any]:
        return {
            "work_item_id": entity.work_item_id, "content_id": entity.content_id,
            "status": entity.status.value, "due_at": dump_datetime(entity.due_at),
            "blocked_reason": entity.blocked_reason, "operator_notes": entity.operator_notes,
            "updated_at": dump_datetime(entity.updated_at), "version": entity.version,
        }

    @staticmethod
    def _hydrate(row: sqlite3.Row) -> WorkItemOverlay:
        return WorkItemOverlay(
            work_item_id=row["work_item_id"], content_id=row["content_id"],
            status=WorkItemStatus(row["status"]), due_at=load_datetime(row["due_at"]),
            blocked_reason=row["blocked_reason"], operator_notes=row["operator_notes"],
            updated_at=load_datetime(row["updated_at"]), version=row["version"],
        )

    def save(self, entity: WorkItemOverlay) -> None: self.store._insert(self.table, self._values(entity))
    def get_by_id(self, entity_id: str) -> WorkItemOverlay: return self._hydrate(self.store._get_row(self.table, self.id_column, entity_id))
    def list(self) -> tuple[WorkItemOverlay, ...]: return tuple(self._hydrate(row) for row in self._rows())
    def update(self, entity: WorkItemOverlay) -> None:
        values = self._values(entity); values.pop("work_item_id"); self.store._update(self.table, self.id_column, entity.work_item_id, values)
    def put(self, entity: WorkItemOverlay) -> None:
        try: self.get_by_id(entity.work_item_id)
        except PersistenceError as exc:
            if exc.code is PersistenceErrorCode.NOT_FOUND: self.save(entity); return
            raise
        self.update(entity)
    def find_by_content_id(self, content_id: str) -> tuple[WorkItemOverlay, ...]:
        return tuple(self._hydrate(row) for row in self._rows("content_id=?", (content_id,)))


class SQLiteRuntimeRepository:
    """Single persistence route for task/lock/recovery/audit runtime facts."""

    def __init__(self, store: SQLiteCreatorOpsStore) -> None:
        self.store = store

    @staticmethod
    def _task(row: sqlite3.Row) -> DurableTask:
        return DurableTask(
            row["task_id"], row["content_id"], DurableTaskType(row["task_type"]),
            DurableTaskStatus(row["status"]), row["owner"], row["attempt"],
            row["idempotency_key"], load_datetime(row["created_at"]),
            load_datetime(row["updated_at"]), load_json(row["provenance_json"], {}),
            load_datetime(row["started_at"]), load_datetime(row["completed_at"]),
            row["last_error"], row["recovery_state"], row["version"],
        )

    @staticmethod
    def _task_values(task: DurableTask) -> dict[str, Any]:
        return {
            "task_id": task.task_id, "content_id": task.content_id,
            "task_type": task.task_type.value, "status": task.status.value,
            "owner": task.owner, "attempt": task.attempt,
            "idempotency_key": task.idempotency_key,
            "created_at": dump_datetime(task.created_at), "started_at": dump_datetime(task.started_at),
            "updated_at": dump_datetime(task.updated_at), "completed_at": dump_datetime(task.completed_at),
            "last_error": task.last_error, "recovery_state": task.recovery_state,
            "provenance_json": dump_json(task.provenance), "version": task.version,
        }

    def save_task(self, task: DurableTask) -> None:
        self.store._insert("durable_tasks", self._task_values(task))

    def update_task(self, task: DurableTask) -> None:
        values = self._task_values(task); values.pop("task_id")
        self.store._update("durable_tasks", "task_id", task.task_id, values)

    def get_task(self, task_id: str) -> DurableTask:
        return self._task(self.store._get_row("durable_tasks", "task_id", task_id))

    def list_tasks(self) -> tuple[DurableTask, ...]:
        rows = self.store.connection.execute("SELECT * FROM durable_tasks ORDER BY task_id").fetchall()
        return tuple(self._task(row) for row in rows)

    def find_task_by_idempotency_key(self, key: str) -> DurableTask | None:
        row = self.store.connection.execute(
            "SELECT * FROM durable_tasks WHERE idempotency_key=?", (key,)
        ).fetchone()
        return self._task(row) if row else None

    @staticmethod
    def _lock(row: sqlite3.Row) -> DurableTaskLock:
        return DurableTaskLock(
            row["task_id"], row["owner"], row["fencing_token"],
            load_datetime(row["acquired_at"]), load_datetime(row["heartbeat_at"]),
            load_datetime(row["expires_at"]), load_datetime(row["released_at"]), row["version"],
        )

    def get_lock(self, task_id: str) -> DurableTaskLock | None:
        row = self.store.connection.execute(
            "SELECT * FROM durable_task_locks WHERE task_id=?", (task_id,)
        ).fetchone()
        return self._lock(row) if row else None

    def put_lock(self, lock: DurableTaskLock) -> None:
        self.store.connection.execute(
            """INSERT INTO durable_task_locks(
            task_id,owner,fencing_token,acquired_at,heartbeat_at,expires_at,released_at,version
            ) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET
            owner=excluded.owner,fencing_token=excluded.fencing_token,acquired_at=excluded.acquired_at,
            heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at,
            released_at=excluded.released_at,version=excluded.version""",
            (lock.task_id, lock.owner, lock.fencing_token, dump_datetime(lock.acquired_at),
             dump_datetime(lock.heartbeat_at), dump_datetime(lock.expires_at),
             dump_datetime(lock.released_at), lock.version),
        )

    def list_active_locks(self) -> tuple[DurableTaskLock, ...]:
        rows = self.store.connection.execute(
            "SELECT * FROM durable_task_locks WHERE released_at IS NULL ORDER BY task_id"
        ).fetchall()
        return tuple(self._lock(row) for row in rows)

    def save_recovery(self, item: RecoveryEvidence) -> None:
        self.store._insert("recovery_evidence", {
            "recovery_id": item.recovery_id, "task_id": item.task_id,
            "what_happened": item.what_happened, "previous_state": item.previous_state,
            "decision": item.decision.value, "resulting_state": item.resulting_state,
            "occurred_at": dump_datetime(item.occurred_at),
            "evidence_json": dump_json(item.evidence), "version": item.version,
        })

    def list_recoveries(self, task_id: str | None = None) -> tuple[RecoveryEvidence, ...]:
        sql = "SELECT * FROM recovery_evidence"
        params: tuple[Any, ...] = ()
        if task_id is not None:
            sql += " WHERE task_id=?"; params = (task_id,)
        sql += " ORDER BY occurred_at,recovery_id"
        rows = self.store.connection.execute(sql, params).fetchall()
        return tuple(RecoveryEvidence(
            row["recovery_id"], row["task_id"], row["what_happened"],
            row["previous_state"], RecoveryDecision(row["decision"]), row["resulting_state"],
            load_datetime(row["occurred_at"]), load_json(row["evidence_json"], {}), row["version"],
        ) for row in rows)

    def save_audit(self, event: AuditEvent) -> None:
        self.store._insert("audit_events", {
            "event_id": event.event_id, "content_id": event.content_id, "actor": event.actor,
            "action": event.action, "occurred_at": dump_datetime(event.occurred_at),
            "result": event.result, "previous_state": event.previous_state,
            "resulting_state": event.resulting_state, "failure_reason": event.failure_reason,
            "recovery_reference": event.recovery_reference,
            "evidence_json": dump_json(event.evidence), "version": event.version,
        })

    def list_audit(self, content_id: str | None = None) -> tuple[AuditEvent, ...]:
        sql = "SELECT * FROM audit_events"; params: tuple[Any, ...] = ()
        if content_id is not None:
            sql += " WHERE content_id=?"; params = (content_id,)
        sql += " ORDER BY occurred_at,event_id"
        rows = self.store.connection.execute(sql, params).fetchall()
        return tuple(AuditEvent(
            row["event_id"], row["content_id"], row["actor"], row["action"],
            load_datetime(row["occurred_at"]), row["result"], row["previous_state"],
            row["resulting_state"], row["failure_reason"], row["recovery_reference"],
            load_json(row["evidence_json"], {}), row["version"],
        ) for row in rows)

    def save_qa_receipt(self, receipt: QAReceipt) -> None:
        checks = [{
            "check_id": item.check_id, "passed": item.passed,
            "message": item.message, "evidence": list(item.evidence),
        } for item in receipt.checks]
        self.store._insert("qa_receipts", {
            "qa_id": receipt.qa_id, "content_id": receipt.content_id,
            "package_id": receipt.package_id, "qa_type": receipt.qa_type.value,
            "status": receipt.status.value, "checks_json": dump_json(checks),
            "failures_json": dump_json(receipt.failures),
            "warnings_json": dump_json(receipt.warnings),
            "performed_at": dump_datetime(receipt.performed_at),
            "evidence_json": dump_json(receipt.evidence), "version": receipt.version,
        })

    @staticmethod
    def _qa(row: sqlite3.Row) -> QAReceipt:
        checks = tuple(RuntimeQACheck(
            item["check_id"], item["passed"], item["message"], tuple(item.get("evidence") or ()),
        ) for item in load_json(row["checks_json"], []))
        return QAReceipt(
            row["qa_id"], row["content_id"], row["package_id"], QAType(row["qa_type"]),
            QAReceiptStatus(row["status"]), checks,
            tuple(load_json(row["failures_json"], [])), tuple(load_json(row["warnings_json"], [])),
            load_datetime(row["performed_at"]), load_json(row["evidence_json"], {}), row["version"],
        )

    def find_qa_receipt(self, qa_id: str) -> QAReceipt | None:
        row = self.store.connection.execute("SELECT * FROM qa_receipts WHERE qa_id=?", (qa_id,)).fetchone()
        return self._qa(row) if row else None

    def list_qa_receipts(
        self, *, content_id: str | None = None, qa_type: QAType | None = None,
    ) -> tuple[QAReceipt, ...]:
        conditions: list[str] = []; params: list[Any] = []
        if content_id is not None:
            conditions.append("content_id=?"); params.append(content_id)
        if qa_type is not None:
            conditions.append("qa_type=?"); params.append(qa_type.value)
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        rows = self.store.connection.execute(
            "SELECT * FROM qa_receipts" + where + " ORDER BY performed_at,qa_id", tuple(params)
        ).fetchall()
        return tuple(self._qa(row) for row in rows)

    @staticmethod
    def _research(row: sqlite3.Row) -> ResearchSession:
        sources = tuple(ResearchSource(
            item["source_id"], ResearchSourceType(item["source_type"]), item["reference"],
            item["summary"], tuple(item.get("evidence") or ()),
        ) for item in load_json(row["sources_json"], []))
        return ResearchSession(
            row["research_id"], row["topic"], row["account_id"], row["content_intent"],
            ResearchStatus(row["status"]), sources, tuple(load_json(row["evidence_json"], [])),
            tuple(load_json(row["notes_json"], [])), tuple(load_json(row["findings_json"], [])),
            tuple(load_json(row["open_questions_json"], [])),
            load_json(row["provenance_json"], {}), load_datetime(row["created_at"]),
            load_datetime(row["updated_at"]), row["version"],
        )

    @staticmethod
    def _research_values(item: ResearchSession) -> dict[str, Any]:
        sources = [{
            "source_id": source.source_id, "source_type": source.source_type.value,
            "reference": source.reference, "summary": source.summary,
            "evidence": list(source.evidence),
        } for source in item.sources]
        return {
            "research_id": item.research_id, "topic": item.topic, "account_id": item.account_id,
            "content_intent": item.content_intent, "status": item.status.value,
            "sources_json": dump_json(sources), "evidence_json": dump_json(item.evidence),
            "notes_json": dump_json(item.notes), "findings_json": dump_json(item.findings),
            "open_questions_json": dump_json(item.open_questions),
            "provenance_json": dump_json(item.provenance),
            "created_at": dump_datetime(item.created_at), "updated_at": dump_datetime(item.updated_at),
            "version": item.version,
        }

    def save_research(self, item: ResearchSession) -> None:
        self.store._insert("research_sessions", self._research_values(item))

    def update_research(self, item: ResearchSession) -> None:
        values = self._research_values(item); values.pop("research_id")
        self.store._update("research_sessions", "research_id", item.research_id, values)

    def get_research(self, research_id: str) -> ResearchSession:
        return self._research(self.store._get_row("research_sessions", "research_id", research_id))

    def find_research(self, research_id: str) -> ResearchSession | None:
        row = self.store.connection.execute(
            "SELECT * FROM research_sessions WHERE research_id=?", (research_id,)
        ).fetchone()
        return self._research(row) if row else None

    def list_research(self, account_id: str | None = None) -> tuple[ResearchSession, ...]:
        if account_id is None:
            rows = self.store.connection.execute(
                "SELECT * FROM research_sessions ORDER BY research_id"
            ).fetchall()
        else:
            rows = self.store.connection.execute(
                "SELECT * FROM research_sessions WHERE account_id=? ORDER BY research_id", (account_id,)
            ).fetchall()
        return tuple(self._research(row) for row in rows)


class SQLiteVisualAssetRepository:
    """Only SQLite route for visual requirement, intake and human-review facts."""

    def __init__(self, store: SQLiteCreatorOpsStore) -> None:
        self.store = store

    @staticmethod
    def _requirement_values(item: AssetRequirement) -> dict[str, Any]:
        return {
            "requirement_id": item.requirement_id, "content_id": item.content_id,
            "account_id": item.account_id, "asset_role": item.asset_role,
            "asset_type": item.asset_type, "required": int(item.required),
            "purpose": item.purpose, "platform_context": item.platform_context,
            "visual_subject": item.visual_subject, "composition": item.composition,
            "visual_hierarchy": item.visual_hierarchy,
            "text_overlay_requirement": item.text_overlay_requirement,
            "aspect_ratio": item.aspect_ratio,
            "minimum_dimensions_json": dump_json(item.minimum_dimensions),
            "preferred_dimensions_json": dump_json(item.preferred_dimensions),
            "reference_policy": item.reference_policy,
            "style_requirements_json": dump_json(item.style_requirements),
            "must_include_json": dump_json(item.must_include),
            "must_not_include_json": dump_json(item.must_not_include),
            "brand_account_constraints_json": dump_json(item.brand_account_constraints),
            "qa_rules_json": dump_json(item.qa_rules),
            "provenance_json": dump_json(item.provenance), "status": item.status.value,
            "expected_filename": item.expected_filename,
            "created_at": dump_datetime(item.created_at), "updated_at": dump_datetime(item.updated_at),
            "version": item.version,
        }

    @staticmethod
    def _requirement(row: sqlite3.Row) -> AssetRequirement:
        return AssetRequirement(
            row["requirement_id"], row["content_id"], row["account_id"], row["asset_role"],
            row["asset_type"], bool(row["required"]), row["purpose"], row["platform_context"],
            row["visual_subject"], row["composition"], row["visual_hierarchy"],
            row["text_overlay_requirement"], row["aspect_ratio"],
            tuple(load_json(row["minimum_dimensions_json"], [])),
            tuple(load_json(row["preferred_dimensions_json"], [])), row["reference_policy"],
            tuple(load_json(row["style_requirements_json"], [])),
            tuple(load_json(row["must_include_json"], [])),
            tuple(load_json(row["must_not_include_json"], [])),
            tuple(load_json(row["brand_account_constraints_json"], [])),
            tuple(load_json(row["qa_rules_json"], [])), load_json(row["provenance_json"], {}),
            AssetRequirementStatus(row["status"]), row["expected_filename"],
            load_datetime(row["created_at"]), load_datetime(row["updated_at"]), row["version"],
        )

    def save_requirement(self, item: AssetRequirement) -> None:
        self.store._insert("asset_requirements", self._requirement_values(item))

    def update_requirement(self, item: AssetRequirement) -> None:
        values = self._requirement_values(item); values.pop("requirement_id")
        self.store._update("asset_requirements", "requirement_id", item.requirement_id, values)

    def get_requirement(self, requirement_id: str) -> AssetRequirement:
        return self._requirement(self.store._get_row("asset_requirements", "requirement_id", requirement_id))

    def find_requirement(self, requirement_id: str) -> AssetRequirement | None:
        row = self.store.connection.execute(
            "SELECT * FROM asset_requirements WHERE requirement_id=?", (requirement_id,)
        ).fetchone()
        return self._requirement(row) if row else None

    def list_requirements(self, content_id: str | None = None) -> tuple[AssetRequirement, ...]:
        if content_id is None:
            rows = self.store.connection.execute(
                "SELECT * FROM asset_requirements ORDER BY content_id,requirement_id"
            ).fetchall()
        else:
            rows = self.store.connection.execute(
                "SELECT * FROM asset_requirements WHERE content_id=? ORDER BY requirement_id", (content_id,)
            ).fetchall()
        return tuple(self._requirement(row) for row in rows)

    @staticmethod
    def _media(item: MediaValidationResult) -> dict[str, Any]:
        return {
            "status": item.status.value, "absolute_path": item.absolute_path,
            "detected_type": item.detected_type, "extension": item.extension,
            "size_bytes": item.size_bytes, "sha256": item.sha256,
            "dimensions": item.dimensions, "duration_seconds": item.duration_seconds,
            "errors": item.errors, "warnings": item.warnings,
            "source_import_reference_only": item.source_import_reference_only,
            "version": item.version,
        }

    @staticmethod
    def _load_media(payload: Mapping[str, Any]) -> MediaValidationResult:
        dimensions = payload.get("dimensions")
        return MediaValidationResult(
            MediaValidationStatus(payload["status"]), str(payload["absolute_path"]),
            payload.get("detected_type"), payload.get("extension"), payload.get("size_bytes"),
            payload.get("sha256"), tuple(dimensions) if dimensions else None,
            payload.get("duration_seconds"), tuple(payload.get("errors") or ()),
            tuple(payload.get("warnings") or ()), bool(payload.get("source_import_reference_only")),
            str(payload.get("version") or "0.1"),
        )

    @classmethod
    def _submission_values(cls, item: AssetIntakeSubmission) -> dict[str, Any]:
        return {
            "submission_id": item.submission_id, "requirement_id": item.requirement_id,
            "content_id": item.content_id, "source_path": item.source_path,
            "source_sha256": item.source_sha256, "managed_path": item.managed_path,
            "media_json": dump_json(cls._media(item.media)), "status": item.status.value,
            "duplicate_of": item.duplicate_of, "canonical_asset_id": item.canonical_asset_id,
            "created_at": dump_datetime(item.created_at), "updated_at": dump_datetime(item.updated_at),
            "version": item.version,
        }

    @classmethod
    def _submission(cls, row: sqlite3.Row) -> AssetIntakeSubmission:
        return AssetIntakeSubmission(
            row["submission_id"], row["requirement_id"], row["content_id"], row["source_path"],
            row["source_sha256"], row["managed_path"], cls._load_media(load_json(row["media_json"], {})),
            AssetSubmissionStatus(row["status"]), row["duplicate_of"], row["canonical_asset_id"],
            load_datetime(row["created_at"]), load_datetime(row["updated_at"]), row["version"],
        )

    def save_submission(self, item: AssetIntakeSubmission) -> None:
        self.store._insert("asset_intake_submissions", self._submission_values(item))

    def update_submission(self, item: AssetIntakeSubmission) -> None:
        values = self._submission_values(item); values.pop("submission_id")
        self.store._update("asset_intake_submissions", "submission_id", item.submission_id, values)

    def get_submission(self, submission_id: str) -> AssetIntakeSubmission:
        return self._submission(self.store._get_row("asset_intake_submissions", "submission_id", submission_id))

    def find_submission(self, submission_id: str) -> AssetIntakeSubmission | None:
        row = self.store.connection.execute(
            "SELECT * FROM asset_intake_submissions WHERE submission_id=?", (submission_id,)
        ).fetchone()
        return self._submission(row) if row else None

    def list_submissions(
        self, *, content_id: str | None = None, requirement_id: str | None = None,
    ) -> tuple[AssetIntakeSubmission, ...]:
        conditions: list[str] = []; params: list[Any] = []
        if content_id is not None:
            conditions.append("content_id=?"); params.append(content_id)
        if requirement_id is not None:
            conditions.append("requirement_id=?"); params.append(requirement_id)
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        rows = self.store.connection.execute(
            "SELECT * FROM asset_intake_submissions" + where + " ORDER BY created_at,submission_id",
            tuple(params),
        ).fetchall()
        return tuple(self._submission(row) for row in rows)

    def save_review(self, item: VisualReviewRecord) -> None:
        self.store._insert("visual_review_decisions", {
            "review_id": item.review_id, "submission_id": item.submission_id,
            "content_id": item.content_id, "decision": item.decision.value,
            "operator_checks_json": dump_json(item.operator_checks), "notes": item.notes,
            "reviewed_at": dump_datetime(item.reviewed_at), "version": item.version,
        })

    def list_reviews(self, content_id: str | None = None) -> tuple[VisualReviewRecord, ...]:
        if content_id is None:
            rows = self.store.connection.execute(
                "SELECT * FROM visual_review_decisions ORDER BY reviewed_at,review_id"
            ).fetchall()
        else:
            rows = self.store.connection.execute(
                "SELECT * FROM visual_review_decisions WHERE content_id=? ORDER BY reviewed_at,review_id",
                (content_id,),
            ).fetchall()
        return tuple(VisualReviewRecord(
            row["review_id"], row["submission_id"], row["content_id"],
            VisualReviewDecision(row["decision"]), load_json(row["operator_checks_json"], {}),
            row["notes"], load_datetime(row["reviewed_at"]), row["version"],
        ) for row in rows)


class SQLiteProductionImportRepository:
    def __init__(self, store: SQLiteCreatorOpsStore) -> None:
        self.store = store

    def get_store_metadata(self) -> dict[str, Any]:
        rows = self.store.connection.execute(
            "SELECT key,value_json FROM production_store_metadata ORDER BY key"
        ).fetchall()
        return {row["key"]: load_json(row["value_json"], None) for row in rows}

    def save_store_metadata(self, values: dict[str, Any]) -> None:
        for key, value in values.items():
            self.store.connection.execute(
                "INSERT INTO production_store_metadata(key,value_json) VALUES(?,?)",
                (key, dump_json(value)),
            )

    def update_store_metadata(self, values: dict[str, Any]) -> None:
        for key, value in values.items():
            self.store.connection.execute(
                """INSERT INTO production_store_metadata(key,value_json) VALUES(?,?)
                   ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json""",
                (key, dump_json(value)),
            )

    @staticmethod
    def _entry(row: sqlite3.Row) -> ProductionImportLedgerEntry:
        return ProductionImportLedgerEntry(
            row["entry_id"], row["batch_id"], row["legacy_source"], row["source_sha256"],
            row["legacy_identity"], row["target_entity"], row["target_identity"],
            row["planner_action"], ProductionImportDisposition(row["disposition"]),
            row["reason"], tuple(load_json(row["warnings_json"], [])), row["confidence"],
            bool(row["requires_user_decision"]), load_json(row["canonical_fields_json"], {}),
            row["payload_digest"], load_datetime(row["recorded_at"]), row["version"],
        )

    def save_entry(self, entry: ProductionImportLedgerEntry) -> None:
        self.store._insert("production_import_ledger", {
            "entry_id": entry.entry_id, "batch_id": entry.batch_id,
            "legacy_source": entry.legacy_source, "source_sha256": entry.source_sha256,
            "legacy_identity": entry.legacy_identity, "target_entity": entry.target_entity,
            "target_identity": entry.target_identity, "planner_action": entry.planner_action,
            "disposition": entry.disposition.value, "reason": entry.reason,
            "warnings_json": dump_json(entry.warnings), "confidence": entry.confidence,
            "requires_user_decision": int(entry.requires_user_decision),
            "canonical_fields_json": dump_json(entry.canonical_fields),
            "payload_digest": entry.payload_digest, "recorded_at": dump_datetime(entry.recorded_at),
            "version": entry.version,
        })

    def find_entry(self, entry_id: str) -> ProductionImportLedgerEntry | None:
        row = self.store.connection.execute(
            "SELECT * FROM production_import_ledger WHERE entry_id=?", (entry_id,)
        ).fetchone()
        return self._entry(row) if row else None

    def list_entries(
        self, disposition: ProductionImportDisposition | None = None,
    ) -> tuple[ProductionImportLedgerEntry, ...]:
        if disposition is None:
            rows = self.store.connection.execute(
                "SELECT * FROM production_import_ledger ORDER BY batch_id,entry_id"
            ).fetchall()
        else:
            rows = self.store.connection.execute(
                "SELECT * FROM production_import_ledger WHERE disposition=? ORDER BY batch_id,entry_id",
                (disposition.value,),
            ).fetchall()
        return tuple(self._entry(row) for row in rows)

    def count_entries_for_batch(self, batch_id: str) -> int:
        return self.store.connection.execute(
            "SELECT COUNT(*) FROM production_import_ledger WHERE batch_id=?", (batch_id,)
        ).fetchone()[0]

    def disposition_counts(self) -> dict[str, int]:
        rows = self.store.connection.execute(
            "SELECT disposition,COUNT(*) AS count FROM production_import_ledger GROUP BY disposition"
        ).fetchall()
        return {row["disposition"]: row["count"] for row in rows}

    @staticmethod
    def _receipt(row: sqlite3.Row) -> ProductionImportReceipt:
        return ProductionImportReceipt(
            row["receipt_id"], row["run_id"], row["batch_id"],
            load_datetime(row["started_at"]), load_datetime(row["completed_at"]),
            tuple(load_json(row["source_assets_json"], [])),
            load_json(row["source_fingerprints_json"], {}), row["created"], row["updated"],
            row["referenced"], row["skipped"], row["deferred"], row["invalid"],
            row["conflicts"], row["idempotent_skips"], row["transaction_result"],
            load_json(row["post_write_validation_json"], {}), row["version"],
        )

    def save_receipt(self, receipt: ProductionImportReceipt) -> None:
        self.store._insert("production_import_receipts", {
            "receipt_id": receipt.receipt_id, "run_id": receipt.run_id,
            "batch_id": receipt.batch_id, "started_at": dump_datetime(receipt.started_at),
            "completed_at": dump_datetime(receipt.completed_at),
            "source_assets_json": dump_json(receipt.source_assets),
            "source_fingerprints_json": dump_json(receipt.source_fingerprints),
            "created": receipt.created, "updated": receipt.updated,
            "referenced": receipt.referenced, "skipped": receipt.skipped,
            "deferred": receipt.deferred, "invalid": receipt.invalid,
            "conflicts": receipt.conflicts, "idempotent_skips": receipt.idempotent_skips,
            "transaction_result": receipt.transaction_result,
            "post_write_validation_json": dump_json(receipt.post_write_validation),
            "version": receipt.version,
        })

    def find_receipt(self, receipt_id: str) -> ProductionImportReceipt | None:
        row = self.store.connection.execute(
            "SELECT * FROM production_import_receipts WHERE receipt_id=?", (receipt_id,)
        ).fetchone()
        return self._receipt(row) if row else None

    def list_receipts(self, run_id: str | None = None) -> tuple[ProductionImportReceipt, ...]:
        if run_id is None:
            rows = self.store.connection.execute(
                "SELECT * FROM production_import_receipts ORDER BY completed_at,receipt_id"
            ).fetchall()
        else:
            rows = self.store.connection.execute(
                "SELECT * FROM production_import_receipts WHERE run_id=? ORDER BY completed_at,receipt_id",
                (run_id,),
            ).fetchall()
        return tuple(self._receipt(row) for row in rows)

    def save_backup_receipt(self, receipt: ProductionBackupReceipt) -> None:
        self.store._insert("production_backup_receipts", {
            "receipt_id": receipt.receipt_id, "database_path": receipt.database_path,
            "backup_path": receipt.backup_path, "created_at": dump_datetime(receipt.created_at),
            "backup_sha256": receipt.backup_sha256, "size_bytes": receipt.size_bytes,
            "sqlite_quick_check": receipt.sqlite_quick_check,
            "schema_version": receipt.schema_version, "version": receipt.version,
        })

    def find_backup_receipt(self, receipt_id: str) -> ProductionBackupReceipt | None:
        row = self.store.connection.execute(
            "SELECT * FROM production_backup_receipts WHERE receipt_id=?", (receipt_id,)
        ).fetchone()
        return ProductionBackupReceipt(
            row["receipt_id"], row["database_path"], row["backup_path"],
            load_datetime(row["created_at"]), row["backup_sha256"], row["size_bytes"],
            row["sqlite_quick_check"], row["schema_version"], row["version"],
        ) if row else None

    def save_activation_resolution(self, item: CanonicalActivationResolution) -> None:
        self.store._insert("canonical_activation_resolutions", {
            "entry_id": item.entry_id, "decision_id": item.decision_id,
            "status": item.status.value,
            "canonical_entity_type": item.canonical_entity_type,
            "canonical_entity_id": item.canonical_entity_id,
            "evidence_json": dump_json(item.evidence),
            "resolved_at": dump_datetime(item.resolved_at), "version": item.version,
        })

    def list_activation_resolutions(self) -> tuple[CanonicalActivationResolution, ...]:
        rows = self.store.connection.execute(
            "SELECT * FROM canonical_activation_resolutions ORDER BY decision_id,entry_id"
        ).fetchall()
        return tuple(CanonicalActivationResolution(
            row["entry_id"], row["decision_id"], ActivationResolutionStatus(row["status"]),
            row["canonical_entity_type"], row["canonical_entity_id"],
            load_json(row["evidence_json"], {}), load_datetime(row["resolved_at"]), row["version"],
        ) for row in rows)

    def save_activation_receipt(self, item: CanonicalActivationReceipt) -> None:
        self.store._insert("canonical_activation_receipts", {
            "activation_id": item.activation_id, "decision_digest": item.decision_digest,
            "creator_created": item.creator_created, "accounts_created": item.accounts_created,
            "contents_created": item.contents_created, "deferred_resolved": item.deferred_resolved,
            "invalid_preserved": item.invalid_preserved, "b4_absent": int(item.b4_absent),
            "entity_counts_json": dump_json(item.entity_counts),
            "resolution_counts_json": dump_json(item.resolution_counts),
            "activated_at": dump_datetime(item.activated_at), "version": item.version,
        })

    def find_activation_receipt(self, activation_id: str) -> CanonicalActivationReceipt | None:
        row = self.store.connection.execute(
            "SELECT * FROM canonical_activation_receipts WHERE activation_id=?", (activation_id,)
        ).fetchone()
        if row is None:
            return None
        return CanonicalActivationReceipt(
            row["activation_id"], row["decision_digest"], row["creator_created"],
            row["accounts_created"], row["contents_created"], row["deferred_resolved"],
            row["invalid_preserved"], bool(row["b4_absent"]),
            load_json(row["entity_counts_json"], {}),
            load_json(row["resolution_counts_json"], {}), False,
            load_datetime(row["activated_at"]), row["version"],
        )

    def update_activation_receipt_digest(self, activation_id: str, decision_digest: str) -> None:
        self.store._update(
            "canonical_activation_receipts", "activation_id", activation_id,
            {"decision_digest": decision_digest},
        )
