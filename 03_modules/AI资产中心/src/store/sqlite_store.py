from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable, Iterator, TypeVar

from src.contracts import (
    BalanceSnapshot,
    BalanceUnit,
    CostKind,
    CostRecord,
    PriceDimension,
    PricingSnapshot,
    PricingUnit,
    Provider,
    ProviderCategory,
    ProviderStatus,
    SourceTag,
    SourceType,
    Token,
    TokenStatus,
    UsageRecord,
    AttributionStatus,
    UsageAttribution,
    AuthorityMetadata,
    AuthoritySourceType,
    BillingMode,
    EntitlementLimit,
    EntitlementLimitKind,
    EntitlementSnapshot,
    EntitlementState,
    FreshnessPolicy,
    DailyTimeWindow,
    PricingTimeRule,
    PricingWindowMode,
    PricingAuthorityRecord,
)

from .contract import CanonicalStore, WriteResult
from .errors import StoreConflictError, StoreDataError, UnsupportedSchemaVersion

SCHEMA_VERSION = 4
_V1_EXPECTED_TABLES = {
    "schema_metadata",
    "providers",
    "tokens",
    "balances",
    "usages",
    "pricing",
    "costs",
}
_V2_EXPECTED_TABLES = _V1_EXPECTED_TABLES | {"budget_policies"}
_EXPECTED_TABLES = _V2_EXPECTED_TABLES | {"pricing_authorities", "entitlements"}

T = TypeVar("T")


class SQLiteCanonicalStore(CanonicalStore):
    """Standard-library SQLite adapter for canonical domain records.

    SQL is isolated here. The adapter stores Decimal values as TEXT, aware
    datetimes as ISO-8601, and enum values by their stable string value. Event
    tables use a deterministic canonical-content SHA-256 solely for replay
    idempotency; it is not a credential fingerprint.
    """

    def __init__(self, database_path: str | Path):
        if not isinstance(database_path, (str, Path)) or not str(database_path):
            raise ValueError("database_path must be explicitly provided")
        self.database_path = str(database_path)
        self._connection = sqlite3.connect(self.database_path)
        self._connection.row_factory = sqlite3.Row
        self._transaction_depth = 0
        try:
            self._open_or_initialize()
        except Exception:
            self._connection.close()
            raise

    def __enter__(self) -> SQLiteCanonicalStore:
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()

    def close(self) -> None:
        self._connection.close()

    @contextmanager
    def transaction(self) -> Iterator[SQLiteCanonicalStore]:
        """Run multiple canonical writes in one real SQLite transaction.

        Individual write methods keep their historical auto-commit behaviour
        outside this context.  Inside it they participate in this transaction
        and cannot commit independently.
        """
        if self._transaction_depth:
            raise RuntimeError("nested canonical store transactions are not supported")
        self._connection.execute("BEGIN IMMEDIATE")
        self._transaction_depth = 1
        try:
            yield self
        except BaseException:
            self._connection.rollback()
            raise
        else:
            self._connection.commit()
        finally:
            self._transaction_depth = 0

    def put_provider(self, provider: Provider) -> WriteResult:
        _require_type(provider, Provider, "provider")
        source_type, source_reference, source_captured_at = _source_values(provider.source)
        row = {
            "id": provider.id,
            "provider_key": provider.key,
            "display_name": provider.display_name,
            "category": provider.category.value,
            "status": provider.status.value,
            "source_type": source_type,
            "source_reference": source_reference,
            "source_captured_at": source_captured_at,
        }
        return self._put_stable("providers", "id", provider.id, row)

    def put_token(self, token: Token) -> WriteResult:
        _require_type(token, Token, "token")
        source_type, source_reference, source_captured_at = _source_values(token.source)
        row = {
            "id": token.id,
            "provider_id": token.provider_id,
            "label": token.label,
            "status": token.status.value,
            "masked_identifier": token.masked_identifier,
            "secret_ref": token.secret_ref,
            "source_type": source_type,
            "source_reference": source_reference,
            "source_captured_at": source_captured_at,
        }
        return self._put_stable("tokens", "id", token.id, row)

    def append_balance(self, snapshot: BalanceSnapshot) -> WriteResult:
        _require_type(snapshot, BalanceSnapshot, "snapshot")
        source_type, source_reference, source_captured_at = _source_values(snapshot.source)
        row = {
            "provider_id": snapshot.provider_id,
            "token_id": snapshot.token_id,
            "value_text": _decimal_text(snapshot.value),
            "unit": snapshot.unit.value,
            "observed_at": _datetime_text(snapshot.observed_at),
            "source_type": source_type,
            "source_reference": source_reference,
            "source_captured_at": source_captured_at,
        }
        return self._append_event("balances", row)

    def append_usage(self, usage: UsageRecord) -> WriteResult:
        _require_type(usage, UsageRecord, "usage")
        source_type, source_reference, source_captured_at = _source_values(usage.source)
        row = {
            "usage_id": usage.usage_id,
            "provider_id": usage.provider_id,
            "token_id": usage.token_id,
            "model": usage.model,
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cache_read_tokens": usage.cache_read_tokens,
            "cache_write_tokens": usage.cache_write_tokens,
            "total_tokens": usage.total_tokens,
            "observed_at": _datetime_text(usage.observed_at),
            "source_type": source_type,
            "source_reference": source_reference,
            "source_captured_at": source_captured_at,
            "attribution_status": usage.attribution.status.value,
            "project_id": usage.attribution.project_id,
            "module_id": usage.attribution.module_id,
            "task_id": usage.attribution.task_id,
            "run_id": usage.attribution.run_id,
        }
        return self._append_event("usages", row)

    def append_pricing(self, snapshot: PricingSnapshot) -> WriteResult:
        _require_type(snapshot, PricingSnapshot, "snapshot")
        source_type, source_reference, source_captured_at = _source_values(snapshot.source)
        row = {
            "provider_id": snapshot.provider_id,
            "token_id": snapshot.token_id,
            "model": snapshot.model,
            "price_per_unit_text": _decimal_text(snapshot.price_per_unit),
            "unit": snapshot.unit.value,
            "currency": snapshot.currency,
            "effective_at": _datetime_text(snapshot.effective_at),
            "price_dimension": snapshot.price_dimension.value,
            "source_type": source_type,
            "source_reference": source_reference,
            "source_captured_at": source_captured_at,
        }
        return self._append_event("pricing", row)

    def append_cost(self, record: CostRecord) -> WriteResult:
        _require_type(record, CostRecord, "record")
        source_type, source_reference, source_captured_at = _source_values(record.source)
        row = {
            "provider_id": record.provider_id,
            "token_id": record.token_id,
            "model": record.model,
            "amount_text": _decimal_text(record.amount),
            "currency": record.currency,
            "occurred_at": _datetime_text(record.occurred_at),
            "cost_basis": record.cost_basis,
            "kind": record.kind.value,
            "usage_id": record.usage_id,
            "source_type": source_type,
            "source_reference": source_reference,
            "source_captured_at": source_captured_at,
        }
        return self._append_event("costs", row)

    def append_pricing_authority(self, record: PricingAuthorityRecord) -> WriteResult:
        _require_type(record, PricingAuthorityRecord, "record")
        row = {
            "authority_id": record.authority_id,
            "provider_id": record.provider_id,
            "model": record.model,
            "billing_mode": record.billing_mode.value,
            "effective_from": _datetime_text(record.effective_from),
            "effective_to": (
                _datetime_text(record.effective_to)
                if record.effective_to is not None else None
            ),
            "pricing_tier": record.pricing_tier,
            "time_rule_json": _pricing_time_rule_json(record.time_rule),
            "component_fingerprints_json": json.dumps(
                [_pricing_fingerprint(item) for item in record.components],
                separators=(",", ":"),
            ),
            **_metadata_row(record.metadata),
        }
        return self._append_event("pricing_authorities", row)

    def append_entitlement(self, snapshot: EntitlementSnapshot) -> WriteResult:
        _require_type(snapshot, EntitlementSnapshot, "snapshot")
        row = {
            "entitlement_id": snapshot.entitlement_id,
            "provider_id": snapshot.provider_id,
            "token_id": snapshot.token_id,
            "plan": snapshot.plan,
            "model": snapshot.model,
            "billing_mode": snapshot.billing_mode.value,
            "observed_at": _datetime_text(snapshot.observed_at),
            "state": snapshot.state.value,
            "limits_json": _limits_json(snapshot.limits),
            "fixed_fee_text": _decimal_text(snapshot.fixed_fee) if snapshot.fixed_fee is not None else None,
            "fee_currency": snapshot.fee_currency,
            "billing_cycle": snapshot.billing_cycle,
            "quota_cycle": snapshot.quota_cycle,
            "reset_at": _datetime_text(snapshot.reset_at) if snapshot.reset_at is not None else None,
            **_metadata_row(snapshot.metadata),
        }
        return self._append_event("entitlements", row)

    def load_providers(self) -> tuple[Provider, ...]:
        return self._load(
            "SELECT * FROM providers ORDER BY id",
            lambda row: Provider(
                id=row["id"],
                key=row["provider_key"],
                display_name=row["display_name"],
                category=_enum(ProviderCategory, row["category"]),
                status=_enum(ProviderStatus, row["status"]),
                source=_source_from_row(row),
            ),
        )

    def load_tokens(self) -> tuple[Token, ...]:
        return self._load(
            "SELECT * FROM tokens ORDER BY provider_id, id",
            lambda row: Token(
                id=row["id"],
                provider_id=row["provider_id"],
                label=row["label"],
                status=_enum(TokenStatus, row["status"]),
                masked_identifier=row["masked_identifier"],
                secret_ref=row["secret_ref"],
                source=_source_from_row(row),
            ),
        )

    def load_balances(self) -> tuple[BalanceSnapshot, ...]:
        return self._load(
            "SELECT * FROM balances ORDER BY observed_at, provider_id, token_id, record_fingerprint",
            lambda row: BalanceSnapshot(
                provider_id=row["provider_id"],
                token_id=row["token_id"],
                value=_decimal(row["value_text"]),
                unit=_enum(BalanceUnit, row["unit"]),
                observed_at=_datetime(row["observed_at"]),
                source=_source_from_row(row),
            ),
        )

    def load_usage(self) -> tuple[UsageRecord, ...]:
        return self._load(
            "SELECT * FROM usages ORDER BY observed_at, provider_id, usage_id, record_fingerprint",
            lambda row: UsageRecord(
                usage_id=row["usage_id"],
                provider_id=row["provider_id"],
                token_id=row["token_id"],
                model=row["model"],
                input_tokens=row["input_tokens"],
                output_tokens=row["output_tokens"],
                cache_read_tokens=row["cache_read_tokens"],
                cache_write_tokens=row["cache_write_tokens"],
                total_tokens=row["total_tokens"],
                observed_at=_datetime(row["observed_at"]),
                source=_source_from_row(row),
                attribution=UsageAttribution(
                    status=_enum(AttributionStatus, row["attribution_status"]),
                    project_id=row["project_id"],
                    module_id=row["module_id"],
                    task_id=row["task_id"],
                    run_id=row["run_id"],
                ),
            ),
        )

    def load_pricing(self) -> tuple[PricingSnapshot, ...]:
        return self._load(
            "SELECT * FROM pricing ORDER BY effective_at, provider_id, model, price_dimension, record_fingerprint",
            lambda row: PricingSnapshot(
                provider_id=row["provider_id"],
                token_id=row["token_id"],
                model=row["model"],
                price_per_unit=_decimal(row["price_per_unit_text"]),
                unit=_enum(PricingUnit, row["unit"]),
                currency=row["currency"],
                effective_at=_datetime(row["effective_at"]),
                price_dimension=_enum(PriceDimension, row["price_dimension"]),
                source=_source_from_row(row),
            ),
        )

    def load_costs(self) -> tuple[CostRecord, ...]:
        return self._load(
            "SELECT * FROM costs ORDER BY occurred_at, provider_id, kind, record_fingerprint",
            lambda row: CostRecord(
                provider_id=row["provider_id"],
                token_id=row["token_id"],
                model=row["model"],
                amount=_decimal(row["amount_text"]),
                currency=row["currency"],
                occurred_at=_datetime(row["occurred_at"]),
                cost_basis=row["cost_basis"],
                kind=_enum(CostKind, row["kind"]),
                usage_id=row["usage_id"],
                source=_source_from_row(row),
            ),
        )

    def load_pricing_authorities(self) -> tuple[PricingAuthorityRecord, ...]:
        by_fingerprint = {
            _pricing_fingerprint(item): item for item in self.load_pricing()
        }

        def build(row: sqlite3.Row) -> PricingAuthorityRecord:
            try:
                component_ids = json.loads(row["component_fingerprints_json"])
                components = tuple(by_fingerprint[item] for item in component_ids)
            except (KeyError, TypeError, json.JSONDecodeError) as exc:
                raise StoreDataError("pricing authority components are invalid") from exc
            return PricingAuthorityRecord(
                authority_id=row["authority_id"],
                provider_id=row["provider_id"],
                model=row["model"],
                billing_mode=_enum(BillingMode, row["billing_mode"]),
                effective_from=_datetime(row["effective_from"]),
                components=components,
                metadata=_metadata_from_row(row),
                effective_to=(
                    _datetime(row["effective_to"])
                    if row["effective_to"] is not None else None
                ),
                pricing_tier=row["pricing_tier"],
                time_rule=_pricing_time_rule_from_json(row["time_rule_json"]),
            )

        return self._load(
            "SELECT * FROM pricing_authorities ORDER BY effective_from, provider_id, model, record_fingerprint",
            build,
        )

    def load_entitlements(self) -> tuple[EntitlementSnapshot, ...]:
        def build(row: sqlite3.Row) -> EntitlementSnapshot:
            metadata = _metadata_from_row(row)
            return EntitlementSnapshot(
                entitlement_id=row["entitlement_id"],
                provider_id=row["provider_id"],
                token_id=row["token_id"],
                plan=row["plan"],
                model=row["model"],
                billing_mode=_enum(BillingMode, row["billing_mode"]),
                observed_at=_datetime(row["observed_at"]),
                state=_enum(EntitlementState, row["state"]),
                limits=_limits_from_json(row["limits_json"]),
                fixed_fee=_decimal(row["fixed_fee_text"]) if row["fixed_fee_text"] is not None else None,
                fee_currency=row["fee_currency"],
                billing_cycle=row["billing_cycle"],
                quota_cycle=row["quota_cycle"],
                reset_at=_datetime(row["reset_at"]) if row["reset_at"] is not None else None,
                metadata=metadata,
                source=metadata.source,
            )

        return self._load(
            "SELECT * FROM entitlements ORDER BY observed_at, provider_id, entitlement_id, record_fingerprint",
            build,
        )

    def _open_or_initialize(self) -> None:
        ensure_schema(self._connection)

    def _put_stable(
        self,
        table: str,
        identity_column: str,
        identity_value: str,
        row: dict[str, Any],
    ) -> WriteResult:
        fingerprint = _record_fingerprint(table, row)
        columns = [*row, "canonical_fingerprint"]
        values = [*row.values(), fingerprint]
        with self._write_scope():
            existing = self._connection.execute(
                f"SELECT canonical_fingerprint FROM {table} WHERE {identity_column} = ?",
                (identity_value,),
            ).fetchone()
            if existing is not None:
                if existing[0] == fingerprint:
                    return WriteResult.IDEMPOTENT
                raise StoreConflictError(f"conflicting {table} identity: {identity_value}")
            placeholders = ", ".join("?" for _ in columns)
            self._connection.execute(
                f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
        return WriteResult.INSERTED

    def _append_event(self, table: str, row: dict[str, Any]) -> WriteResult:
        fingerprint = _record_fingerprint(table, row)
        columns = ["record_fingerprint", *row]
        values = [fingerprint, *row.values()]
        placeholders = ", ".join("?" for _ in columns)
        with self._write_scope():
            cursor = self._connection.execute(
                f"INSERT OR IGNORE INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
        return WriteResult.INSERTED if cursor.rowcount == 1 else WriteResult.IDEMPOTENT

    @contextmanager
    def _write_scope(self) -> Iterator[None]:
        if self._transaction_depth:
            yield
        else:
            with self._connection:
                yield

    def _load(self, sql: str, builder: Callable[[sqlite3.Row], T]) -> tuple[T, ...]:
        try:
            return tuple(builder(row) for row in self._connection.execute(sql))
        except StoreDataError:
            raise
        except (ValueError, TypeError, InvalidOperation, OverflowError) as exc:
            raise StoreDataError("persisted row is not a valid canonical record") from exc


def ensure_schema(connection: sqlite3.Connection) -> None:
    """Open V3, initialize it, or transactionally migrate complete V1/V2.

    The V1-to-V2 change is intentionally a single SQLite transaction: the
    BudgetPolicy table and metadata version either both commit or both roll
    back. Unknown versions and incomplete schemas fail closed.
    """

    existing = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    if not existing:
        _initialize_v4(connection)
        return
    if "schema_metadata" not in existing:
        raise StoreDataError("existing database has no schema metadata")
    row = connection.execute(
        "SELECT value FROM schema_metadata WHERE key = 'schema_version'"
    ).fetchone()
    if row is None:
        raise StoreDataError("schema_version is missing")
    try:
        version = int(row[0])
    except (TypeError, ValueError) as exc:
        raise StoreDataError("schema_version is invalid") from exc

    if version == 1:
        missing = _V1_EXPECTED_TABLES - existing
        if missing:
            raise StoreDataError(f"V1 database is missing tables: {sorted(missing)}")
        _migrate_v1_to_v4(connection)
        return
    if version == 2:
        missing = _V2_EXPECTED_TABLES - existing
        if missing:
            raise StoreDataError(f"V2 database is missing tables: {sorted(missing)}")
        _migrate_v2_to_v4(connection)
        return
    if version == 3:
        missing = _EXPECTED_TABLES - existing
        if missing:
            raise StoreDataError(f"V3 database is missing tables: {sorted(missing)}")
        _migrate_v3_to_v4(connection)
        return
    if version == SCHEMA_VERSION:
        missing = _EXPECTED_TABLES - existing
        if missing:
            raise StoreDataError(f"V4 database is missing tables: {sorted(missing)}")
        return
    raise UnsupportedSchemaVersion(f"unsupported schema version: {version}")


def _execute_schema_sql(connection: sqlite3.Connection, sql: str) -> None:
    for statement in sql.split(";\n"):
        if statement.strip():
            connection.execute(statement)


def _initialize_v4(connection: sqlite3.Connection) -> None:
    with connection:
        _execute_schema_sql(connection, _SCHEMA_V1_SQL)
        connection.execute(_BUDGET_POLICY_SCHEMA_SQL)
        _execute_schema_sql(connection, _AUTHORITY_SCHEMA_SQL)
        _add_attribution_columns(connection)
        _add_cost_usage_column(connection)
        connection.execute(
            "INSERT INTO schema_metadata(key, value) VALUES('schema_version', ?)",
            ("4",),
        )


def _migrate_v1_to_v4(connection: sqlite3.Connection) -> None:
    """Apply the existing V2/V3 steps and pricing-time V4 as one transaction."""
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(_BUDGET_POLICY_SCHEMA_SQL)
        _execute_schema_sql(connection, _AUTHORITY_SCHEMA_SQL)
        _add_attribution_columns(connection)
        _add_cost_usage_column(connection)
        _upgrade_goal_event_fingerprints(connection)
        cursor = connection.execute(
            "UPDATE schema_metadata SET value = '4' "
            "WHERE key = 'schema_version' AND value = '1'"
        )
        if cursor.rowcount != 1:
            raise StoreDataError("schema version changed during V1 to V4 migration")
        connection.commit()
    except StoreDataError:
        connection.rollback()
        raise
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        raise StoreDataError("V1 to V4 migration failed") from exc


def _migrate_v2_to_v4(connection: sqlite3.Connection) -> None:
    try:
        connection.execute("BEGIN IMMEDIATE")
        _execute_schema_sql(connection, _AUTHORITY_SCHEMA_SQL)
        _add_attribution_columns(connection)
        _add_cost_usage_column(connection)
        _upgrade_goal_event_fingerprints(connection)
        cursor = connection.execute(
            "UPDATE schema_metadata SET value = '4' "
            "WHERE key = 'schema_version' AND value = '2'"
        )
        if cursor.rowcount != 1:
            raise StoreDataError("schema version changed during V2 to V4 migration")
        connection.commit()
    except StoreDataError:
        connection.rollback()
        raise
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        raise StoreDataError("V2 to V4 migration failed") from exc


def _migrate_v3_to_v4(connection: sqlite3.Connection) -> None:
    try:
        connection.execute("BEGIN IMMEDIATE")
        _add_pricing_authority_time_columns(connection)
        cursor = connection.execute(
            "UPDATE schema_metadata SET value = '4' "
            "WHERE key = 'schema_version' AND value = '3'"
        )
        if cursor.rowcount != 1:
            raise StoreDataError("schema version changed during V3 to V4 migration")
        connection.commit()
    except StoreDataError:
        connection.rollback()
        raise
    except sqlite3.DatabaseError as exc:
        connection.rollback()
        raise StoreDataError("V3 to V4 migration failed") from exc


def _add_pricing_authority_time_columns(connection: sqlite3.Connection) -> None:
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(pricing_authorities)")
    }
    for name, sql_type in (
        ("effective_to", "TEXT"),
        ("pricing_tier", "TEXT"),
        ("time_rule_json", "TEXT"),
    ):
        if name not in columns:
            connection.execute(
                f"ALTER TABLE pricing_authorities ADD COLUMN {name} {sql_type}"
            )


def _add_attribution_columns(connection: sqlite3.Connection) -> None:
    columns = {row[1] for row in connection.execute("PRAGMA table_info(usages)")}
    if "attribution_status" in columns:
        return
    connection.execute(
        "ALTER TABLE usages ADD COLUMN attribution_status TEXT NOT NULL DEFAULT 'unattributed'"
    )
    for name in ("project_id", "module_id", "task_id", "run_id"):
        connection.execute(f"ALTER TABLE usages ADD COLUMN {name} TEXT")


def _add_cost_usage_column(connection: sqlite3.Connection) -> None:
    columns = {row[1] for row in connection.execute("PRAGMA table_info(costs)")}
    if "usage_id" not in columns:
        connection.execute("ALTER TABLE costs ADD COLUMN usage_id TEXT")


def _upgrade_goal_event_fingerprints(connection: sqlite3.Connection) -> None:
    """Keep replay idempotency stable after V3 adds nullable/default columns."""
    for row in connection.execute("SELECT * FROM usages").fetchall():
        values = {
            "usage_id": row["usage_id"], "provider_id": row["provider_id"],
            "token_id": row["token_id"], "model": row["model"],
            "input_tokens": row["input_tokens"], "output_tokens": row["output_tokens"],
            "cache_read_tokens": row["cache_read_tokens"],
            "cache_write_tokens": row["cache_write_tokens"],
            "total_tokens": row["total_tokens"], "observed_at": row["observed_at"],
            "source_type": row["source_type"], "source_reference": row["source_reference"],
            "source_captured_at": row["source_captured_at"],
            "attribution_status": row["attribution_status"],
            "project_id": row["project_id"], "module_id": row["module_id"],
            "task_id": row["task_id"], "run_id": row["run_id"],
        }
        new = _record_fingerprint("usages", values)
        connection.execute("UPDATE usages SET record_fingerprint=? WHERE record_fingerprint=?",
                           (new, row["record_fingerprint"]))
    for row in connection.execute("SELECT * FROM costs").fetchall():
        values = {
            "provider_id": row["provider_id"], "token_id": row["token_id"],
            "model": row["model"], "amount_text": row["amount_text"],
            "currency": row["currency"], "occurred_at": row["occurred_at"],
            "cost_basis": row["cost_basis"], "kind": row["kind"],
            "usage_id": row["usage_id"], "source_type": row["source_type"],
            "source_reference": row["source_reference"],
            "source_captured_at": row["source_captured_at"],
        }
        new = _record_fingerprint("costs", values)
        connection.execute("UPDATE costs SET record_fingerprint=? WHERE record_fingerprint=?",
                           (new, row["record_fingerprint"]))


def _require_type(value: object, expected: type, name: str) -> None:
    if not isinstance(value, expected):
        raise TypeError(f"{name} must be a {expected.__name__}")


def _record_fingerprint(record_type: str, row: dict[str, Any]) -> str:
    payload = {"record_type": record_type, **row}
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _source_values(source: SourceTag) -> tuple[str, str | None, str]:
    _require_type(source, SourceTag, "source")
    if source.captured_at is None:
        raise StoreDataError("SourceTag captured_at must be present")
    return (
        source.source_type.value,
        source.source_reference,
        _datetime_text(source.captured_at),
    )


def _source_from_row(row: sqlite3.Row) -> SourceTag:
    return SourceTag(
        source_type=_enum(SourceType, row["source_type"]),
        source_reference=row["source_reference"],
        captured_at=_datetime(row["source_captured_at"]),
    )


def _decimal_text(value: Decimal) -> str:
    if not isinstance(value, Decimal) or not value.is_finite():
        raise StoreDataError("Decimal value must be finite")
    return str(value)


def _decimal(value: str) -> Decimal:
    try:
        result = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise StoreDataError("persisted Decimal is invalid") from exc
    if not result.is_finite():
        raise StoreDataError("persisted Decimal must be finite")
    return result


def _datetime_text(value: datetime) -> str:
    if not isinstance(value, datetime):
        raise StoreDataError("datetime value is invalid")
    if value.tzinfo is None or value.utcoffset() is None:
        raise StoreDataError("datetime must be timezone-aware")
    return value.isoformat()


def _datetime(value: str) -> datetime:
    try:
        result = datetime.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise StoreDataError("persisted datetime is invalid") from exc
    if result.tzinfo is None or result.utcoffset() is None:
        raise StoreDataError("persisted datetime must be timezone-aware")
    return result


def _enum(enum_type: type[T], value: str) -> T:
    try:
        return enum_type(value)
    except (TypeError, ValueError) as exc:
        raise StoreDataError(f"persisted {enum_type.__name__} value is invalid") from exc


def _pricing_fingerprint(snapshot: PricingSnapshot) -> str:
    source_type, source_reference, source_captured_at = _source_values(snapshot.source)
    return _record_fingerprint("pricing", {
        "provider_id": snapshot.provider_id,
        "token_id": snapshot.token_id,
        "model": snapshot.model,
        "price_per_unit_text": _decimal_text(snapshot.price_per_unit),
        "unit": snapshot.unit.value,
        "currency": snapshot.currency,
        "effective_at": _datetime_text(snapshot.effective_at),
        "price_dimension": snapshot.price_dimension.value,
        "source_type": source_type,
        "source_reference": source_reference,
        "source_captured_at": source_captured_at,
    })


def _pricing_time_rule_json(rule: PricingTimeRule | None) -> str | None:
    if rule is None:
        return None
    return json.dumps(
        {
            "mode": rule.mode.value,
            "timezone": rule.timezone,
            "utc_offset_minutes": rule.utc_offset_minutes,
            "windows": [
                {
                    "start_minute": window.start_minute,
                    "end_minute": window.end_minute,
                    "weekdays": list(window.weekdays),
                }
                for window in rule.windows
            ],
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _pricing_time_rule_from_json(value: str | None) -> PricingTimeRule | None:
    if value is None:
        return None
    try:
        payload = json.loads(value)
        if not isinstance(payload, dict) or set(payload) != {
            "mode", "timezone", "utc_offset_minutes", "windows"
        }:
            raise ValueError
        raw_windows = payload["windows"]
        if not isinstance(raw_windows, list):
            raise ValueError
        windows = tuple(
            DailyTimeWindow(
                start_minute=item["start_minute"],
                end_minute=item["end_minute"],
                weekdays=tuple(item["weekdays"]),
            )
            for item in raw_windows
            if isinstance(item, dict)
            and set(item) == {"start_minute", "end_minute", "weekdays"}
        )
        if len(windows) != len(raw_windows):
            raise ValueError
        return PricingTimeRule(
            timezone=payload["timezone"],
            utc_offset_minutes=payload["utc_offset_minutes"],
            windows=windows,
            mode=PricingWindowMode(payload["mode"]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise StoreDataError("persisted pricing time rule is invalid") from exc


def _metadata_row(metadata: AuthorityMetadata) -> dict[str, Any]:
    source_type, source_reference, source_captured_at = _source_values(metadata.source)
    return {
        "authority_source_type": metadata.authority_source_type.value,
        "official_source": metadata.official_source,
        "fetched_at": _datetime_text(metadata.fetched_at) if metadata.fetched_at is not None else None,
        "last_verified_at": _datetime_text(metadata.last_verified_at) if metadata.last_verified_at is not None else None,
        "freshness_valid_seconds": (
            int(metadata.freshness_policy.valid_for.total_seconds())
            if metadata.freshness_policy.valid_for is not None else None
        ),
        "source_type": source_type,
        "source_reference": source_reference,
        "source_captured_at": source_captured_at,
    }


def _metadata_from_row(row: sqlite3.Row) -> AuthorityMetadata:
    seconds = row["freshness_valid_seconds"]
    return AuthorityMetadata(
        authority_source_type=_enum(AuthoritySourceType, row["authority_source_type"]),
        official_source=row["official_source"],
        fetched_at=_datetime(row["fetched_at"]) if row["fetched_at"] is not None else None,
        last_verified_at=(
            _datetime(row["last_verified_at"])
            if row["last_verified_at"] is not None else None
        ),
        freshness_policy=FreshnessPolicy(
            timedelta(seconds=seconds) if seconds is not None else None
        ),
        source=_source_from_row(row),
    )


def _limits_json(limits: tuple[EntitlementLimit, ...]) -> str:
    payload = [
        {
            "kind": item.kind.value,
            "unit": item.unit,
            "used": str(item.used) if item.used is not None else None,
            "remaining": str(item.remaining) if item.remaining is not None else None,
            "soft_limit": str(item.soft_limit) if item.soft_limit is not None else None,
            "hard_limit": str(item.hard_limit) if item.hard_limit is not None else None,
            "model": item.model,
            "unlimited": item.unlimited,
        }
        for item in limits
    ]
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _limits_from_json(value: str) -> tuple[EntitlementLimit, ...]:
    try:
        payload = json.loads(value)
        return tuple(
            EntitlementLimit(
                kind=_enum(EntitlementLimitKind, item["kind"]),
                unit=item["unit"],
                used=_decimal(item["used"]) if item["used"] is not None else None,
                remaining=_decimal(item["remaining"]) if item["remaining"] is not None else None,
                soft_limit=_decimal(item["soft_limit"]) if item["soft_limit"] is not None else None,
                hard_limit=_decimal(item["hard_limit"]) if item["hard_limit"] is not None else None,
                model=item["model"],
                unlimited=item.get("unlimited", False),
            )
            for item in payload
        )
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise StoreDataError("persisted entitlement limits are invalid") from exc


_SCHEMA_V1_SQL = """
CREATE TABLE schema_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    provider_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL,
    canonical_fingerprint TEXT NOT NULL
);
CREATE TABLE tokens (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    masked_identifier TEXT NOT NULL,
    secret_ref TEXT,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL,
    canonical_fingerprint TEXT NOT NULL
);
CREATE TABLE balances (
    record_fingerprint TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    token_id TEXT,
    value_text TEXT NOT NULL,
    unit TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL
);
CREATE TABLE usages (
    record_fingerprint TEXT PRIMARY KEY,
    usage_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    token_id TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL
);
CREATE TABLE pricing (
    record_fingerprint TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    token_id TEXT,
    model TEXT NOT NULL,
    price_per_unit_text TEXT NOT NULL,
    unit TEXT NOT NULL,
    currency TEXT NOT NULL,
    effective_at TEXT NOT NULL,
    price_dimension TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL
);
CREATE TABLE costs (
    record_fingerprint TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    token_id TEXT,
    model TEXT,
    amount_text TEXT NOT NULL,
    currency TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    cost_basis TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL
)
"""

_BUDGET_POLICY_SCHEMA_SQL = """
CREATE TABLE budget_policies (
    policy_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    provider_id TEXT,
    token_id TEXT,
    model TEXT,
    currency TEXT NOT NULL,
    limit_amount_text TEXT NOT NULL,
    period_kind TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    warning_ratio_text TEXT NOT NULL,
    critical_ratio_text TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    label TEXT,
    cost_basis TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    effective_at TEXT NOT NULL,
    canonical_fingerprint TEXT NOT NULL
)
"""

_AUTHORITY_SCHEMA_SQL = """
CREATE TABLE pricing_authorities (
    record_fingerprint TEXT PRIMARY KEY,
    authority_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    billing_mode TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    pricing_tier TEXT,
    time_rule_json TEXT,
    component_fingerprints_json TEXT NOT NULL,
    authority_source_type TEXT NOT NULL,
    official_source TEXT,
    fetched_at TEXT,
    last_verified_at TEXT,
    freshness_valid_seconds INTEGER,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL
);
CREATE TABLE entitlements (
    record_fingerprint TEXT PRIMARY KEY,
    entitlement_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    token_id TEXT,
    plan TEXT,
    model TEXT,
    billing_mode TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    state TEXT NOT NULL,
    limits_json TEXT NOT NULL,
    fixed_fee_text TEXT,
    fee_currency TEXT,
    billing_cycle TEXT,
    quota_cycle TEXT,
    reset_at TEXT,
    authority_source_type TEXT NOT NULL,
    official_source TEXT,
    fetched_at TEXT,
    last_verified_at TEXT,
    freshness_valid_seconds INTEGER,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    source_captured_at TEXT NOT NULL
)
"""
