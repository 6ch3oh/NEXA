from __future__ import annotations

import hashlib
import json
import sqlite3
from abc import ABC, abstractmethod
from datetime import datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from pathlib import Path
from typing import Any

from src.contracts import SourceTag, SourceType
from src.domain.security import contains_plaintext_secret
from src.store import StoreConflictError, StoreDataError, WriteResult
from src.store.sqlite_store import ensure_schema

from .models import BudgetCostBasis, BudgetPeriod, BudgetPeriodKind, BudgetPolicy, BudgetScope


class BudgetPolicyStore(ABC):
    """Persistence boundary for BudgetPolicy definitions only."""

    @abstractmethod
    def put_budget_policy(self, policy: BudgetPolicy) -> WriteResult: ...

    @abstractmethod
    def get_budget_policy(self, policy_id: str) -> BudgetPolicy | None: ...

    @abstractmethod
    def load_budget_policies(
        self, scope: BudgetScope | None = None
    ) -> tuple[BudgetPolicy, ...]: ...

    @abstractmethod
    def list_enabled_budget_policies(
        self, scope: BudgetScope | None = None
    ) -> tuple[BudgetPolicy, ...]: ...

    @abstractmethod
    def close(self) -> None: ...


class SQLiteBudgetPolicyStore(BudgetPolicyStore):
    """Standard-library SQLite adapter for V2 BudgetPolicy persistence.

    Budget evaluations remain derived values and are deliberately absent from
    this adapter and from the V2 schema.
    """

    def __init__(self, database_path: str | Path):
        if not isinstance(database_path, (str, Path)) or not str(database_path):
            raise ValueError("database_path must be explicitly provided")
        self.database_path = str(database_path)
        self._connection = sqlite3.connect(self.database_path)
        self._connection.row_factory = sqlite3.Row
        try:
            ensure_schema(self._connection)
        except Exception:
            self._connection.close()
            raise

    def __enter__(self) -> SQLiteBudgetPolicyStore:
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()

    def close(self) -> None:
        self._connection.close()

    def put_budget_policy(self, policy: BudgetPolicy) -> WriteResult:
        if not isinstance(policy, BudgetPolicy):
            raise TypeError("policy must be a BudgetPolicy")
        if (
            policy.source.source_reference is not None
            and contains_plaintext_secret(policy.source.source_reference)
        ):
            raise StoreDataError("policy source_reference contains credential-shaped content")
        row = _policy_values(policy)
        fingerprint = _fingerprint(row)
        with self._connection:
            existing = self._connection.execute(
                "SELECT canonical_fingerprint FROM budget_policies WHERE policy_id = ?",
                (policy.policy_id,),
            ).fetchone()
            if existing is not None:
                if existing[0] == fingerprint:
                    return WriteResult.IDEMPOTENT
                raise StoreConflictError(
                    f"conflicting budget policy identity: {policy.policy_id}"
                )
            columns = [*row, "canonical_fingerprint"]
            placeholders = ", ".join("?" for _ in columns)
            self._connection.execute(
                f"INSERT INTO budget_policies ({', '.join(columns)}) "
                f"VALUES ({placeholders})",
                [*row.values(), fingerprint],
            )
        return WriteResult.INSERTED

    def get_budget_policy(self, policy_id: str) -> BudgetPolicy | None:
        if not isinstance(policy_id, str) or not policy_id.strip():
            raise ValueError("policy_id must not be empty")
        row = self._connection.execute(
            "SELECT * FROM budget_policies WHERE policy_id = ?", (policy_id,)
        ).fetchone()
        return None if row is None else _policy_from_row_checked(row)

    def load_budget_policies(
        self, scope: BudgetScope | None = None
    ) -> tuple[BudgetPolicy, ...]:
        return self._load(enabled_only=False, scope=scope)

    def list_enabled_budget_policies(
        self, scope: BudgetScope | None = None
    ) -> tuple[BudgetPolicy, ...]:
        return self._load(enabled_only=True, scope=scope)

    def _load(
        self, *, enabled_only: bool, scope: BudgetScope | None
    ) -> tuple[BudgetPolicy, ...]:
        if scope is not None and not isinstance(scope, BudgetScope):
            raise TypeError("scope must be a BudgetScope or None")
        clauses: list[str] = []
        parameters: list[str | int] = []
        if enabled_only:
            clauses.append("enabled = ?")
            parameters.append(1)
        if scope is not None:
            clauses.append("scope = ?")
            parameters.append(scope.value)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self._connection.execute(
            f"SELECT * FROM budget_policies{where} ORDER BY policy_id", parameters
        )
        return tuple(_policy_from_row_checked(row) for row in rows)


def _policy_values(policy: BudgetPolicy) -> dict[str, Any]:
    captured_at = policy.source.captured_at
    if captured_at is None:
        raise StoreDataError("policy SourceTag captured_at must be present")
    return {
        "policy_id": policy.policy_id,
        "scope": policy.scope.value,
        "provider_id": policy.provider_id,
        "token_id": policy.token_id,
        "model": policy.model,
        "currency": policy.currency,
        "limit_amount_text": _decimal_text(policy.limit_amount),
        "period_kind": policy.period.kind.value,
        "period_start": _datetime_text(policy.period.start),
        "period_end": _datetime_text(policy.period.end),
        "warning_ratio_text": _decimal_text(policy.warning_ratio),
        "critical_ratio_text": _decimal_text(policy.critical_ratio),
        "enabled": int(policy.enabled),
        "label": policy.label,
        "cost_basis": policy.cost_basis.value,
        "source_type": policy.source.source_type.value,
        "source_reference": policy.source.source_reference,
        "source_captured_at": _datetime_text(captured_at),
        "created_at": _datetime_text(policy.created_at),
        "effective_at": _datetime_text(policy.effective_at),
    }


def _policy_from_row_checked(row: sqlite3.Row) -> BudgetPolicy:
    try:
        enabled = row["enabled"]
        if enabled not in (0, 1):
            raise StoreDataError("persisted BudgetPolicy enabled value is invalid")
        return BudgetPolicy(
            policy_id=row["policy_id"],
            scope=_enum(BudgetScope, row["scope"]),
            provider_id=row["provider_id"],
            token_id=row["token_id"],
            model=row["model"],
            currency=row["currency"],
            limit_amount=_decimal(row["limit_amount_text"]),
            period=BudgetPeriod(
                kind=_enum(BudgetPeriodKind, row["period_kind"]),
                start=_datetime(row["period_start"]),
                end=_datetime(row["period_end"]),
            ),
            warning_ratio=_decimal(row["warning_ratio_text"]),
            critical_ratio=_decimal(row["critical_ratio_text"]),
            enabled=bool(enabled),
            label=row["label"],
            cost_basis=_enum(BudgetCostBasis, row["cost_basis"]),
            source=SourceTag(
                source_type=_enum(SourceType, row["source_type"]),
                source_reference=row["source_reference"],
                captured_at=_datetime(row["source_captured_at"]),
            ),
            created_at=_datetime(row["created_at"]),
            effective_at=_datetime(row["effective_at"]),
        )
    except StoreDataError:
        raise
    except (ValueError, TypeError, InvalidOperation, OverflowError) as exc:
        raise StoreDataError("persisted row is not a valid BudgetPolicy") from exc


def _fingerprint(row: dict[str, Any]) -> str:
    encoded = json.dumps(
        {"record_type": "budget_policy", **row},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


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
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
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


def _enum(enum_type: type[Enum], value: str) -> Any:
    try:
        return enum_type(value)
    except (TypeError, ValueError) as exc:
        raise StoreDataError(f"persisted {enum_type.__name__} value is invalid") from exc
