"""SQLite-backed module-local Customer Request Ledger and outbox."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterator

from automation_center.domain.customer_request import (
    AIUsageOutboxEvent,
    ActorType,
    CustomerRequestRecord,
    CustomerRequestStatus,
    CustomerRequestSummary,
    DataClassification,
    DataRetentionRecord,
    DeletionState,
    InvocationLedgerLink,
    KnowledgeReviewState,
    OutboxDeliveryState,
    RequestInputType,
    RequestResultStatus,
    RetentionDataClass,
    summarize_costs,
)
from automation_center.domain.model_gateway import UserTier
from automation_center.domain.model_invocation import CostSource, InvocationStatus, ModelInvocationRecord


class RequestLedgerError(RuntimeError):
    pass


class RequestNotFoundError(RequestLedgerError):
    pass


class IdempotencyConflictError(RequestLedgerError):
    pass


@dataclass(frozen=True, slots=True)
class InvocationWriteResult:
    invocation_id: str
    event_id: str
    created: bool


class SQLiteRequestLedger:
    """A bounded-query, service-free local ledger using atomic SQLite transactions."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self.path)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA foreign_keys = ON")
        self._create_schema()

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> "SQLiteRequestLedger":
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.close()

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        try:
            self._connection.execute("BEGIN IMMEDIATE")
            yield self._connection
            self._connection.commit()
        except Exception:
            self._connection.rollback()
            raise

    def _create_schema(self) -> None:
        self._connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS customer_requests (
                request_id TEXT PRIMARY KEY,
                actor_type TEXT NOT NULL,
                customer_id TEXT NOT NULL,
                user_tier TEXT NOT NULL,
                capability_id TEXT NOT NULL,
                workflow_id TEXT,
                execution_id TEXT,
                trace_id TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL,
                input_type TEXT NOT NULL,
                input_summary TEXT,
                input_ref TEXT,
                source_url TEXT,
                result_status TEXT NOT NULL,
                result_summary TEXT,
                result_ref TEXT,
                markdown_ref TEXT,
                knowledge_review_state TEXT NOT NULL,
                knowledge_destination_ref TEXT,
                data_classification TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_requests_customer_time
                ON customer_requests(customer_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_requests_tier_time
                ON customer_requests(user_tier, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_requests_status_time
                ON customer_requests(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_requests_review_time
                ON customer_requests(knowledge_review_state, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_requests_actor_time
                ON customer_requests(actor_type, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_requests_capability_time
                ON customer_requests(capability_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_requests_time
                ON customer_requests(created_at DESC);

            CREATE TABLE IF NOT EXISTS request_artifacts (
                request_id TEXT NOT NULL REFERENCES customer_requests(request_id),
                artifact_ref TEXT NOT NULL,
                PRIMARY KEY(request_id, artifact_ref)
            );
            CREATE TABLE IF NOT EXISTS request_retention (
                request_id TEXT NOT NULL REFERENCES customer_requests(request_id),
                data_class TEXT NOT NULL,
                created_at TEXT NOT NULL,
                retain_until TEXT,
                deletion_state TEXT NOT NULL,
                deleted_at TEXT,
                PRIMARY KEY(request_id, data_class)
            );
            CREATE TABLE IF NOT EXISTS request_invocations (
                invocation_id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL REFERENCES customer_requests(request_id),
                invocation_ref TEXT NOT NULL,
                model_profile TEXT NOT NULL,
                resolved_provider TEXT NOT NULL,
                resolved_model TEXT NOT NULL,
                invocation_status TEXT NOT NULL,
                cost_amount REAL,
                cost_currency TEXT,
                cost_source TEXT NOT NULL,
                input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                latency_ms INTEGER,
                safe_error TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_invocations_request
                ON request_invocations(request_id, created_at);
            CREATE INDEX IF NOT EXISTS ix_invocations_model
                ON request_invocations(resolved_model, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_invocations_provider_model_time
                ON request_invocations(resolved_provider, resolved_model, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_invocations_time
                ON request_invocations(created_at DESC);

            CREATE TABLE IF NOT EXISTS usage_outbox (
                event_id TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                request_id TEXT NOT NULL REFERENCES customer_requests(request_id),
                invocation_id TEXT NOT NULL UNIQUE REFERENCES request_invocations(invocation_id),
                created_at TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                delivery_state TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_outbox_delivery
                ON usage_outbox(delivery_state, created_at);
            """
        )
        self._ensure_invocation_projection_columns()
        self._connection.commit()

    def _ensure_invocation_projection_columns(self) -> None:
        """Idempotently extend v0.1 ledgers without a migration framework."""

        existing = {
            row["name"]
            for row in self._connection.execute("PRAGMA table_info(request_invocations)").fetchall()
        }
        columns = {
            "input_tokens": "INTEGER",
            "output_tokens": "INTEGER",
            "total_tokens": "INTEGER",
            "latency_ms": "INTEGER",
            "safe_error": "TEXT",
        }
        for name, sql_type in columns.items():
            if name not in existing:
                self._connection.execute(
                    f"ALTER TABLE request_invocations ADD COLUMN {name} {sql_type}"
                )

    def create_request(self, value: CustomerRequestRecord) -> bool:
        existing = self._connection.execute(
            "SELECT request_id FROM customer_requests WHERE request_id=?", (value.request_id,)
        ).fetchone()
        if existing is not None:
            if self.get_request(value.request_id) == value:
                return False
            raise IdempotencyConflictError("request_id already exists with different data")
        with self._transaction() as connection:
            self._insert_request(connection, value)
        return True

    def update_request(self, value: CustomerRequestRecord) -> None:
        existing = self.get_request(value.request_id)
        if (
            existing.actor_type is not value.actor_type
            or existing.customer_id != value.customer_id
            or existing.user_tier is not value.user_tier
            or existing.capability_id != value.capability_id
            or existing.created_at != value.created_at
        ):
            raise IdempotencyConflictError("immutable request identity cannot change")
        if value.updated_at < existing.updated_at:
            raise IdempotencyConflictError("updated_at cannot move backwards")
        with self._transaction() as connection:
            connection.execute("DELETE FROM request_artifacts WHERE request_id=?", (value.request_id,))
            connection.execute("DELETE FROM request_retention WHERE request_id=?", (value.request_id,))
            connection.execute(
                """UPDATE customer_requests SET workflow_id=?, execution_id=?, trace_id=?,
                started_at=?, completed_at=?, updated_at=?, status=?, input_type=?,
                input_summary=?, input_ref=?, source_url=?, result_status=?, result_summary=?,
                result_ref=?, markdown_ref=?, knowledge_review_state=?,
                knowledge_destination_ref=?, data_classification=? WHERE request_id=?""",
                self._mutable_values(value) + (value.request_id,),
            )
            self._insert_children(connection, value)

    def link_invocation(self, value: ModelInvocationRecord) -> InvocationWriteResult:
        request = self.get_request(value.request_id)
        if (
            request.customer_id != value.customer_id
            or request.user_tier is not value.user_tier
            or request.capability_id != value.capability_id
        ):
            raise IdempotencyConflictError("invocation identity does not match request ledger")
        link = InvocationLedgerLink.from_record(value)
        event_id = "nexa-usage-" + link.invocation_id.removeprefix("nexa-inv-")
        idempotency_key = f"AI_USAGE_EVENT:{link.invocation_id}"
        payload = value.to_ai_usage_event_candidate()
        payload["invocation_id"] = link.invocation_id
        event_contract = AIUsageOutboxEvent(
            event_id=event_id,
            idempotency_key=idempotency_key,
            request_id=link.request_id,
            invocation_id=link.invocation_id,
            created_at=link.created_at,
            event_type="AI_USAGE_EVENT",
            payload=payload,
            delivery_state=OutboxDeliveryState.PENDING,
        )
        payload_json = _canonical_json(event_contract.payload)

        existing = self._connection.execute(
            "SELECT * FROM request_invocations WHERE invocation_id=?", (link.invocation_id,)
        ).fetchone()
        if existing is not None:
            if not self._link_matches_existing(self._link_from_row(existing), link):
                raise IdempotencyConflictError("invocation idempotency conflict")
            event = self._connection.execute(
                "SELECT payload_json FROM usage_outbox WHERE idempotency_key=?", (idempotency_key,)
            ).fetchone()
            if event is None or event["payload_json"] != payload_json:
                raise IdempotencyConflictError("outbox idempotency conflict")
            return InvocationWriteResult(link.invocation_id, event_id, False)

        with self._transaction() as connection:
            connection.execute(
                """INSERT INTO request_invocations (
                    invocation_id, request_id, invocation_ref, model_profile,
                    resolved_provider, resolved_model, invocation_status,
                    cost_amount, cost_currency, cost_source, input_tokens,
                    output_tokens, total_tokens, latency_ms, safe_error, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    link.invocation_id,
                    link.request_id,
                    link.invocation_ref,
                    link.model_profile,
                    link.resolved_provider,
                    link.resolved_model,
                    link.invocation_status.value,
                    link.cost_amount,
                    link.cost_currency,
                    link.cost_source.value,
                    link.input_tokens,
                    link.output_tokens,
                    link.total_tokens,
                    link.latency_ms,
                    link.safe_error,
                    _iso(link.created_at),
                ),
            )
            connection.execute(
                """INSERT INTO usage_outbox VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    event_id,
                    idempotency_key,
                    link.request_id,
                    link.invocation_id,
                    _iso(link.created_at),
                    "AI_USAGE_EVENT",
                    payload_json,
                    OutboxDeliveryState.PENDING.value,
                ),
            )
        return InvocationWriteResult(link.invocation_id, event_id, True)

    @staticmethod
    def _link_matches_existing(existing: InvocationLedgerLink, incoming: InvocationLedgerLink) -> bool:
        """Treat null newly-migrated projection fields as unknown, never as a conflict."""

        stable_fields = (
            "invocation_id", "request_id", "invocation_ref", "model_profile",
            "resolved_provider", "resolved_model", "invocation_status", "cost_amount",
            "cost_currency", "cost_source", "created_at",
        )
        if any(getattr(existing, name) != getattr(incoming, name) for name in stable_fields):
            return False
        projection_fields = (
            "input_tokens", "output_tokens", "total_tokens", "latency_ms", "safe_error",
        )
        return all(
            getattr(existing, name) is None
            or getattr(existing, name) == getattr(incoming, name)
            for name in projection_fields
        )

    def mark_outbox(self, event_id: str, state: OutboxDeliveryState) -> None:
        if state is OutboxDeliveryState.PENDING:
            raise ValueError("delivery state cannot transition back to PENDING")
        row = self._connection.execute(
            "SELECT delivery_state FROM usage_outbox WHERE event_id=?", (event_id,)
        ).fetchone()
        if row is None:
            raise RequestNotFoundError("outbox event was not found")
        current = OutboxDeliveryState(row["delivery_state"])
        if current is state:
            return
        if current is OutboxDeliveryState.DELIVERED:
            raise ValueError("DELIVERED outbox events are terminal")
        with self._transaction() as connection:
            cursor = connection.execute(
                "UPDATE usage_outbox SET delivery_state=? WHERE event_id=?",
                (state.value, event_id),
            )
            if cursor.rowcount != 1:
                raise RequestNotFoundError("outbox event was not found")

    def get_request(self, request_id: str) -> CustomerRequestRecord:
        row = self._connection.execute(
            "SELECT * FROM customer_requests WHERE request_id=?", (request_id,)
        ).fetchone()
        if row is None:
            raise RequestNotFoundError("customer request was not found")
        return self._request_from_row(row)

    def list_by_actor(self, actor_type: ActorType, *, limit: int = 100) -> tuple[CustomerRequestRecord, ...]:
        return self._query("actor_type=?", (actor_type.value,), limit)

    def list_by_customer(self, customer_id: str, *, limit: int = 100) -> tuple[CustomerRequestRecord, ...]:
        return self._query("customer_id=?", (customer_id,), limit)

    def list_by_time(
        self, start: datetime, end: datetime, *, limit: int = 100
    ) -> tuple[CustomerRequestRecord, ...]:
        if end < start:
            raise ValueError("end cannot precede start")
        return self._query("created_at>=? AND created_at<=?", (_iso(start), _iso(end)), limit)

    def list_by_tier(self, tier: UserTier, *, limit: int = 100) -> tuple[CustomerRequestRecord, ...]:
        return self._query("user_tier=?", (tier.value,), limit)

    def list_failed(self, *, limit: int = 100) -> tuple[CustomerRequestRecord, ...]:
        return self._query("status=?", (CustomerRequestStatus.FAILED.value,), limit)

    def list_pending_review(self, *, limit: int = 100) -> tuple[CustomerRequestRecord, ...]:
        return self._query(
            "knowledge_review_state IN (?, ?)",
            (KnowledgeReviewState.NOT_REVIEWED.value, KnowledgeReviewState.PENDING_REVIEW.value),
            limit,
        )

    def list_by_model(self, model: str, *, limit: int = 100) -> tuple[CustomerRequestRecord, ...]:
        bounded = _limit(limit)
        rows = self._connection.execute(
            """SELECT DISTINCT r.* FROM customer_requests r
            JOIN request_invocations i ON i.request_id=r.request_id
            WHERE i.resolved_model=? ORDER BY r.created_at DESC, r.request_id LIMIT ?""",
            (model, bounded),
        ).fetchall()
        return tuple(self._request_from_row(row) for row in rows)

    def list_outbox(
        self, state: OutboxDeliveryState | None = None, *, limit: int = 100
    ) -> tuple[AIUsageOutboxEvent, ...]:
        bounded = _limit(limit)
        if state is None:
            rows = self._connection.execute(
                "SELECT * FROM usage_outbox ORDER BY created_at, event_id LIMIT ?", (bounded,)
            ).fetchall()
        else:
            rows = self._connection.execute(
                "SELECT * FROM usage_outbox WHERE delivery_state=? ORDER BY created_at, event_id LIMIT ?",
                (state.value, bounded),
            ).fetchall()
        return tuple(self._outbox_from_row(row) for row in rows)

    def summarize_request(self, request_id: str) -> CustomerRequestSummary:
        request = self.get_request(request_id)
        rows = self._connection.execute(
            "SELECT * FROM request_invocations WHERE request_id=? ORDER BY created_at, invocation_id",
            (request_id,),
        ).fetchall()
        links = tuple(self._link_from_row(row) for row in rows)
        result_refs = tuple(
            item
            for item in (request.result_ref, request.markdown_ref, *request.artifact_refs)
            if item is not None
        )
        return CustomerRequestSummary(
            request=request,
            invocation_ids=tuple(item.invocation_id for item in links),
            result_refs=result_refs,
            cost_summary=summarize_costs(links),
            knowledge_review_state=request.knowledge_review_state,
        )

    def _query(self, where: str, args: tuple[Any, ...], limit: int) -> tuple[CustomerRequestRecord, ...]:
        rows = self._connection.execute(
            f"SELECT * FROM customer_requests WHERE {where} ORDER BY created_at DESC, request_id LIMIT ?",
            args + (_limit(limit),),
        ).fetchall()
        return tuple(self._request_from_row(row) for row in rows)

    def _insert_request(self, connection: sqlite3.Connection, value: CustomerRequestRecord) -> None:
        connection.execute(
            """INSERT INTO customer_requests (
                request_id, actor_type, customer_id, user_tier, capability_id,
                workflow_id, execution_id, trace_id, created_at, started_at,
                completed_at, updated_at, status, input_type, input_summary,
                input_ref, source_url, result_status, result_summary, result_ref,
                markdown_ref, knowledge_review_state, knowledge_destination_ref,
                data_classification
            ) VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                value.request_id,
                value.actor_type.value,
                value.customer_id,
                value.user_tier.value,
                value.capability_id,
                value.workflow_id,
                value.execution_id,
                value.trace_id,
                _iso(value.created_at),
                _iso_optional(value.started_at),
                _iso_optional(value.completed_at),
                _iso(value.updated_at),
                value.status.value,
                value.input_type.value,
                value.input_summary,
                value.input_ref,
                value.source_url,
                value.result_status.value,
                value.result_summary,
                value.result_ref,
                value.markdown_ref,
                value.knowledge_review_state.value,
                value.knowledge_destination_ref,
                value.data_classification.value,
            ),
        )
        self._insert_children(connection, value)

    @staticmethod
    def _mutable_values(value: CustomerRequestRecord) -> tuple[Any, ...]:
        return (
            value.workflow_id,
            value.execution_id,
            value.trace_id,
            _iso_optional(value.started_at),
            _iso_optional(value.completed_at),
            _iso(value.updated_at),
            value.status.value,
            value.input_type.value,
            value.input_summary,
            value.input_ref,
            value.source_url,
            value.result_status.value,
            value.result_summary,
            value.result_ref,
            value.markdown_ref,
            value.knowledge_review_state.value,
            value.knowledge_destination_ref,
            value.data_classification.value,
        )

    @staticmethod
    def _insert_children(connection: sqlite3.Connection, value: CustomerRequestRecord) -> None:
        connection.executemany(
            "INSERT INTO request_artifacts VALUES (?, ?)",
            ((value.request_id, item) for item in value.artifact_refs),
        )
        connection.executemany(
            "INSERT INTO request_retention VALUES (?, ?, ?, ?, ?, ?)",
            (
                (
                    value.request_id,
                    item.data_class.value,
                    _iso(item.created_at),
                    _iso_optional(item.retain_until),
                    item.deletion_state.value,
                    _iso_optional(item.deleted_at),
                )
                for item in value.retention
            ),
        )

    def _request_from_row(self, row: sqlite3.Row) -> CustomerRequestRecord:
        request_id = row["request_id"]
        artifacts = tuple(
            item["artifact_ref"]
            for item in self._connection.execute(
                "SELECT artifact_ref FROM request_artifacts WHERE request_id=? ORDER BY artifact_ref",
                (request_id,),
            ).fetchall()
        )
        retention = tuple(
            DataRetentionRecord(
                RetentionDataClass(item["data_class"]),
                _datetime(item["created_at"]),
                _datetime_optional(item["retain_until"]),
                DeletionState(item["deletion_state"]),
                _datetime_optional(item["deleted_at"]),
            )
            for item in self._connection.execute(
                "SELECT * FROM request_retention WHERE request_id=? ORDER BY data_class",
                (request_id,),
            ).fetchall()
        )
        return CustomerRequestRecord(
            request_id=request_id,
            actor_type=ActorType(row["actor_type"]),
            customer_id=row["customer_id"],
            user_tier=UserTier(row["user_tier"]),
            capability_id=row["capability_id"],
            workflow_id=row["workflow_id"],
            execution_id=row["execution_id"],
            trace_id=row["trace_id"],
            created_at=_datetime(row["created_at"]),
            started_at=_datetime_optional(row["started_at"]),
            completed_at=_datetime_optional(row["completed_at"]),
            updated_at=_datetime(row["updated_at"]),
            status=CustomerRequestStatus(row["status"]),
            input_type=RequestInputType(row["input_type"]),
            input_summary=row["input_summary"],
            input_ref=row["input_ref"],
            source_url=row["source_url"],
            result_status=RequestResultStatus(row["result_status"]),
            result_summary=row["result_summary"],
            result_ref=row["result_ref"],
            artifact_refs=artifacts,
            markdown_ref=row["markdown_ref"],
            knowledge_review_state=KnowledgeReviewState(row["knowledge_review_state"]),
            knowledge_destination_ref=row["knowledge_destination_ref"],
            data_classification=DataClassification(row["data_classification"]),
            retention=retention,
        )

    @staticmethod
    def _link_from_row(row: sqlite3.Row) -> InvocationLedgerLink:
        return InvocationLedgerLink(
            invocation_id=row["invocation_id"],
            request_id=row["request_id"],
            invocation_ref=row["invocation_ref"],
            model_profile=row["model_profile"],
            resolved_provider=row["resolved_provider"],
            resolved_model=row["resolved_model"],
            invocation_status=InvocationStatus(row["invocation_status"]),
            cost_amount=row["cost_amount"],
            cost_currency=row["cost_currency"],
            cost_source=CostSource(row["cost_source"]),
            input_tokens=row["input_tokens"],
            output_tokens=row["output_tokens"],
            total_tokens=row["total_tokens"],
            latency_ms=row["latency_ms"],
            safe_error=row["safe_error"],
            created_at=_datetime(row["created_at"]),
        )

    @staticmethod
    def _outbox_from_row(row: sqlite3.Row) -> AIUsageOutboxEvent:
        return AIUsageOutboxEvent(
            event_id=row["event_id"],
            idempotency_key=row["idempotency_key"],
            request_id=row["request_id"],
            invocation_id=row["invocation_id"],
            created_at=_datetime(row["created_at"]),
            event_type=row["event_type"],
            payload=json.loads(row["payload_json"]),
            delivery_state=OutboxDeliveryState(row["delivery_state"]),
        )


def _limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 500:
        raise ValueError("query limit must be between 1 and 500")
    return value


def _canonical_json(value: Any) -> str:
    if hasattr(value, "items"):
        value = dict(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _iso_optional(value: datetime | None) -> str | None:
    return None if value is None else _iso(value)


def _datetime(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def _datetime_optional(value: str | None) -> datetime | None:
    return None if value is None else _datetime(value)
