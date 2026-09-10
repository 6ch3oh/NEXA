"""Stable module-local customer request ledger contracts."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from enum import StrEnum
import hashlib
import json
import math
import re
from types import MappingProxyType
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlsplit

from .model_gateway import UserTier
from .model_invocation import CostSource, InvocationStatus, ModelInvocationRecord, contains_secret


REQUEST_LEDGER_VERSION = "0.1"
OWNER_IDENTITY = "owner:nexa"


class ActorType(StrEnum):
    OWNER = "OWNER"
    CUSTOMER = "CUSTOMER"


class CustomerRequestStatus(StrEnum):
    RECEIVED = "RECEIVED"
    VALIDATING = "VALIDATING"
    ACCEPTED = "ACCEPTED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    PARTIAL_SUCCESS = "PARTIAL_SUCCESS"
    FAILED = "FAILED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class RequestInputType(StrEnum):
    TEXT = "TEXT"
    URL = "URL"
    DOCUMENT = "DOCUMENT"
    FORM = "FORM"
    REFERENCE = "REFERENCE"


class RequestResultStatus(StrEnum):
    NOT_AVAILABLE = "NOT_AVAILABLE"
    AVAILABLE = "AVAILABLE"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class KnowledgeReviewState(StrEnum):
    NOT_APPLICABLE = "NOT_APPLICABLE"
    NOT_REVIEWED = "NOT_REVIEWED"
    PENDING_REVIEW = "PENDING_REVIEW"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


class DataClassification(StrEnum):
    OWNER_PRIVATE = "OWNER_PRIVATE"
    CUSTOMER_PRIVATE = "CUSTOMER_PRIVATE"
    REVIEW_CANDIDATE = "REVIEW_CANDIDATE"
    AGGREGATED_USAGE = "AGGREGATED_USAGE"


class RetentionDataClass(StrEnum):
    REQUEST_METADATA = "REQUEST_METADATA"
    RAW_INPUT = "RAW_INPUT"
    RESULT = "RESULT"
    ARTIFACT = "ARTIFACT"
    TRACE = "TRACE"


class DeletionState(StrEnum):
    RETAIN = "RETAIN"
    DELETE_SCHEDULED = "DELETE_SCHEDULED"
    DELETED = "DELETED"


class OutboxDeliveryState(StrEnum):
    PENDING = "PENDING"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"


class RequestCostSummaryStatus(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    UNAVAILABLE = "UNAVAILABLE"
    MIXED_CURRENCY = "MIXED_CURRENCY"


_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$")
_LOGICAL_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/+-]{0,511}$")
_SENSITIVE_QUERY = re.compile(r"(?:token|key|secret|password|auth)", re.IGNORECASE)
_TERMINAL = {
    CustomerRequestStatus.SUCCEEDED,
    CustomerRequestStatus.PARTIAL_SUCCESS,
    CustomerRequestStatus.FAILED,
    CustomerRequestStatus.REJECTED,
    CustomerRequestStatus.CANCELLED,
}
_TRANSITIONS = {
    CustomerRequestStatus.RECEIVED: {
        CustomerRequestStatus.VALIDATING,
        CustomerRequestStatus.REJECTED,
        CustomerRequestStatus.CANCELLED,
    },
    CustomerRequestStatus.VALIDATING: {
        CustomerRequestStatus.ACCEPTED,
        CustomerRequestStatus.REJECTED,
        CustomerRequestStatus.CANCELLED,
    },
    CustomerRequestStatus.ACCEPTED: {
        CustomerRequestStatus.RUNNING,
        CustomerRequestStatus.CANCELLED,
    },
    CustomerRequestStatus.RUNNING: {
        CustomerRequestStatus.SUCCEEDED,
        CustomerRequestStatus.PARTIAL_SUCCESS,
        CustomerRequestStatus.FAILED,
        CustomerRequestStatus.CANCELLED,
    },
}


@dataclass(frozen=True, slots=True)
class DataRetentionRecord:
    data_class: RetentionDataClass
    created_at: datetime
    retain_until: datetime | None
    deletion_state: DeletionState = DeletionState.RETAIN
    deleted_at: datetime | None = None

    def __post_init__(self) -> None:
        _aware(self.created_at, "created_at")
        _aware(self.retain_until, "retain_until")
        _aware(self.deleted_at, "deleted_at")
        object.__setattr__(self, "created_at", _utc(self.created_at))
        if self.retain_until is not None:
            object.__setattr__(self, "retain_until", _utc(self.retain_until))
        if self.deleted_at is not None:
            object.__setattr__(self, "deleted_at", _utc(self.deleted_at))
        if self.retain_until is not None and self.retain_until < self.created_at:
            raise ValueError("retain_until cannot precede created_at")
        if self.deletion_state is DeletionState.DELETED and self.deleted_at is None:
            raise ValueError("DELETED requires deleted_at")
        if self.deletion_state is not DeletionState.DELETED and self.deleted_at is not None:
            raise ValueError("deleted_at is only valid for DELETED")

    def transition(self, state: DeletionState, *, at: datetime) -> "DataRetentionRecord":
        allowed = {
            DeletionState.RETAIN: {DeletionState.DELETE_SCHEDULED},
            DeletionState.DELETE_SCHEDULED: {DeletionState.RETAIN, DeletionState.DELETED},
            DeletionState.DELETED: set(),
        }
        if state not in allowed[self.deletion_state]:
            raise ValueError(f"invalid deletion transition: {self.deletion_state}->{state}")
        _aware(at, "at")
        return replace(
            self,
            deletion_state=state,
            deleted_at=_utc(at) if state is DeletionState.DELETED else None,
        )


@dataclass(frozen=True, slots=True)
class CustomerRequestRecord:
    request_id: str
    actor_type: ActorType
    customer_id: str
    user_tier: UserTier
    capability_id: str
    workflow_id: str | None
    execution_id: str | None
    trace_id: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    updated_at: datetime
    status: CustomerRequestStatus
    input_type: RequestInputType
    input_summary: str | None
    input_ref: str | None
    source_url: str | None
    result_status: RequestResultStatus
    result_summary: str | None
    result_ref: str | None
    artifact_refs: tuple[str, ...]
    markdown_ref: str | None
    knowledge_review_state: KnowledgeReviewState
    knowledge_destination_ref: str | None
    data_classification: DataClassification
    retention: tuple[DataRetentionRecord, ...]

    @classmethod
    def new(
        cls,
        *,
        request_id: str,
        actor_type: ActorType,
        customer_id: str,
        user_tier: UserTier,
        capability_id: str,
        input_type: RequestInputType,
        created_at: datetime,
        input_summary: str | None = None,
        input_ref: str | None = None,
        source_url: str | None = None,
        workflow_id: str | None = None,
        execution_id: str | None = None,
        trace_id: str | None = None,
    ) -> "CustomerRequestRecord":
        review = (
            KnowledgeReviewState.NOT_APPLICABLE
            if actor_type is ActorType.OWNER
            else KnowledgeReviewState.NOT_REVIEWED
        )
        classification = (
            DataClassification.OWNER_PRIVATE
            if actor_type is ActorType.OWNER
            else DataClassification.CUSTOMER_PRIVATE
        )
        retention = tuple(
            DataRetentionRecord(item, created_at, None)
            for item in RetentionDataClass
        )
        return cls(
            request_id=request_id,
            actor_type=actor_type,
            customer_id=customer_id,
            user_tier=user_tier,
            capability_id=capability_id,
            workflow_id=workflow_id,
            execution_id=execution_id,
            trace_id=trace_id,
            created_at=created_at,
            started_at=None,
            completed_at=None,
            updated_at=created_at,
            status=CustomerRequestStatus.RECEIVED,
            input_type=input_type,
            input_summary=input_summary,
            input_ref=input_ref,
            source_url=source_url,
            result_status=RequestResultStatus.NOT_AVAILABLE,
            result_summary=None,
            result_ref=None,
            artifact_refs=(),
            markdown_ref=None,
            knowledge_review_state=review,
            knowledge_destination_ref=None,
            data_classification=classification,
            retention=retention,
        )

    def __post_init__(self) -> None:
        for name in ("request_id", "customer_id", "capability_id"):
            object.__setattr__(self, name, _identifier(getattr(self, name), name))
        for name in ("workflow_id", "execution_id", "trace_id"):
            value = getattr(self, name)
            if value is not None:
                object.__setattr__(self, name, _identifier(value, name))
        if self.actor_type is ActorType.OWNER:
            if self.customer_id != OWNER_IDENTITY or self.user_tier is not UserTier.OWNER:
                raise ValueError("OWNER requests require the stable OWNER identity and tier")
        elif self.customer_id == OWNER_IDENTITY or self.user_tier is UserTier.OWNER:
            raise ValueError("CUSTOMER requests cannot use OWNER identity or tier")

        for name in ("created_at", "started_at", "completed_at", "updated_at"):
            _aware(getattr(self, name), name)
            value = getattr(self, name)
            if value is not None:
                object.__setattr__(self, name, _utc(value))
        if self.updated_at < self.created_at:
            raise ValueError("updated_at cannot precede created_at")
        if self.started_at is not None and self.started_at < self.created_at:
            raise ValueError("started_at cannot precede created_at")
        if self.completed_at is not None and self.completed_at < self.created_at:
            raise ValueError("completed_at cannot precede created_at")
        if self.status is CustomerRequestStatus.RUNNING and self.started_at is None:
            raise ValueError("RUNNING requires started_at")
        if self.status in _TERMINAL and self.completed_at is None:
            raise ValueError("terminal request status requires completed_at")
        if self.status not in _TERMINAL and self.completed_at is not None:
            raise ValueError("non-terminal request status cannot have completed_at")

        object.__setattr__(self, "input_summary", _optional_text(self.input_summary, "input_summary", 512))
        for name in ("input_ref", "result_ref", "markdown_ref", "knowledge_destination_ref"):
            value = getattr(self, name)
            if value is not None:
                object.__setattr__(self, name, _logical_ref(value, name))
        object.__setattr__(self, "source_url", _safe_url(self.source_url))
        object.__setattr__(self, "result_summary", _optional_text(self.result_summary, "result_summary", 512))
        artifacts = tuple(sorted(_logical_ref(item, "artifact_ref") for item in self.artifact_refs))
        if len(set(artifacts)) != len(artifacts):
            raise ValueError("artifact_refs must be unique")
        object.__setattr__(self, "artifact_refs", artifacts)
        if (
            self.knowledge_review_state is not KnowledgeReviewState.ACCEPTED
            and self.knowledge_destination_ref is not None
        ):
            raise ValueError("knowledge destination requires ACCEPTED review state")

        retention_values = tuple(self.retention)
        if not all(isinstance(item, DataRetentionRecord) for item in retention_values):
            raise TypeError("retention must contain DataRetentionRecord values")
        retention = tuple(
            sorted(
                retention_values,
                key=lambda item: list(RetentionDataClass).index(item.data_class),
            )
        )
        if {item.data_class for item in retention} != set(RetentionDataClass):
            raise ValueError("retention must contain exactly one policy per data class")
        object.__setattr__(self, "retention", retention)

    def transition(self, status: CustomerRequestStatus, *, at: datetime) -> "CustomerRequestRecord":
        if status not in _TRANSITIONS.get(self.status, set()):
            raise ValueError(f"invalid request transition: {self.status}->{status}")
        _aware(at, "at")
        moment = _utc(at)
        return replace(
            self,
            status=status,
            started_at=moment if status is CustomerRequestStatus.RUNNING and self.started_at is None else self.started_at,
            completed_at=moment if status in _TERMINAL else None,
            updated_at=moment,
        )

    def with_result(
        self,
        *,
        result_status: RequestResultStatus,
        result_summary: str | None,
        result_ref: str | None,
        artifact_refs: tuple[str, ...] = (),
        markdown_ref: str | None = None,
        at: datetime,
    ) -> "CustomerRequestRecord":
        _aware(at, "at")
        return replace(
            self,
            result_status=result_status,
            result_summary=result_summary,
            result_ref=result_ref,
            artifact_refs=artifact_refs,
            markdown_ref=markdown_ref,
            updated_at=_utc(at),
        )

    def with_review_state(
        self,
        state: KnowledgeReviewState,
        *,
        at: datetime,
        destination_ref: str | None = None,
    ) -> "CustomerRequestRecord":
        _aware(at, "at")
        classification = (
            DataClassification.REVIEW_CANDIDATE
            if state in {KnowledgeReviewState.NOT_REVIEWED, KnowledgeReviewState.PENDING_REVIEW}
            else self.data_classification
        )
        return replace(
            self,
            knowledge_review_state=state,
            knowledge_destination_ref=destination_ref,
            data_classification=classification,
            updated_at=_utc(at),
        )

    def with_retention(self, value: DataRetentionRecord, *, at: datetime) -> "CustomerRequestRecord":
        _aware(at, "at")
        items = tuple(value if item.data_class is value.data_class else item for item in self.retention)
        return replace(self, retention=items, updated_at=_utc(at))


@dataclass(frozen=True, slots=True)
class InvocationLedgerLink:
    invocation_id: str
    request_id: str
    invocation_ref: str
    model_profile: str
    resolved_provider: str
    resolved_model: str
    invocation_status: InvocationStatus
    cost_amount: float | None
    cost_currency: str | None
    cost_source: CostSource
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    latency_ms: int | None
    safe_error: str | None
    created_at: datetime

    def __post_init__(self) -> None:
        for name in ("invocation_id", "request_id"):
            object.__setattr__(self, name, _identifier(getattr(self, name), name))
        object.__setattr__(self, "invocation_ref", _logical_ref(self.invocation_ref, "invocation_ref"))
        for name in ("model_profile", "resolved_provider", "resolved_model"):
            value = _optional_text(getattr(self, name), name, 256)
            if value is None:
                raise ValueError(f"{name} is required")
            object.__setattr__(self, name, value)
        for name in ("input_tokens", "output_tokens", "total_tokens", "latency_ms"):
            value = getattr(self, name)
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, int) or value < 0
            ):
                raise ValueError(f"{name} must be a non-negative integer or null")
        object.__setattr__(self, "safe_error", _optional_text(self.safe_error, "safe_error", 512))
        _aware(self.created_at, "created_at")
        object.__setattr__(self, "created_at", _utc(self.created_at))

    @classmethod
    def from_record(cls, value: ModelInvocationRecord) -> "InvocationLedgerLink":
        identity = json.dumps(
            {
                "request_id": value.request_id,
                "started_at": value.started_at.isoformat(),
                "alias": value.requested_alias,
                "provider_request_id": value.provider_request_id,
                "provider_response_id": value.provider_response_id,
                "model": value.resolved_model,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        invocation_id = "nexa-inv-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]
        return cls(
            invocation_id=invocation_id,
            request_id=value.request_id,
            invocation_ref=f"model-invocation:{invocation_id}",
            model_profile=value.model_profile,
            resolved_provider=value.resolved_provider,
            resolved_model=value.resolved_model,
            invocation_status=value.status,
            cost_amount=value.cost_amount,
            cost_currency=value.cost_currency,
            cost_source=value.cost_source,
            input_tokens=value.input_tokens,
            output_tokens=value.output_tokens,
            total_tokens=value.total_tokens,
            latency_ms=value.latency_ms,
            safe_error=value.safe_message,
            created_at=_utc(value.completed_at),
        )


@dataclass(frozen=True, slots=True)
class AIUsageOutboxEvent:
    event_id: str
    idempotency_key: str
    request_id: str
    invocation_id: str
    created_at: datetime
    event_type: str
    payload: Mapping[str, Any]
    delivery_state: OutboxDeliveryState

    def __post_init__(self) -> None:
        _identifier(self.event_id, "event_id")
        _identifier(self.idempotency_key, "idempotency_key")
        _identifier(self.request_id, "request_id")
        _identifier(self.invocation_id, "invocation_id")
        if self.event_type != "AI_USAGE_EVENT":
            raise ValueError("outbox supports AI_USAGE_EVENT only")
        _aware(self.created_at, "created_at")
        encoded = json.dumps(dict(self.payload), ensure_ascii=False, sort_keys=True)
        if len(encoded.encode("utf-8")) > 16_384:
            raise ValueError("outbox payload exceeds the bounded 16 KiB contract")
        if contains_secret(encoded):
            raise ValueError("outbox payload contains secret-like content")
        object.__setattr__(self, "payload", MappingProxyType(dict(self.payload)))


@dataclass(frozen=True, slots=True)
class RequestCostSummary:
    status: RequestCostSummaryStatus
    invocation_count: int
    known_cost_count: int
    unknown_cost_count: int
    currency: str | None
    total_amount: float | None
    known_subtotal_amount: float | None


@dataclass(frozen=True, slots=True)
class CustomerRequestSummary:
    request: CustomerRequestRecord
    invocation_ids: tuple[str, ...]
    result_refs: tuple[str, ...]
    cost_summary: RequestCostSummary
    knowledge_review_state: KnowledgeReviewState


def summarize_costs(links: tuple[InvocationLedgerLink, ...]) -> RequestCostSummary:
    known = tuple(item for item in links if item.cost_amount is not None)
    unknown_count = len(links) - len(known)
    currencies = {item.cost_currency for item in known}
    if not known:
        return RequestCostSummary(
            RequestCostSummaryStatus.UNAVAILABLE, len(links), 0, unknown_count, None, None, None
        )
    if len(currencies) != 1:
        return RequestCostSummary(
            RequestCostSummaryStatus.MIXED_CURRENCY,
            len(links),
            len(known),
            unknown_count,
            None,
            None,
            None,
        )
    currency = next(iter(currencies))
    subtotal = math.fsum(float(item.cost_amount) for item in known if item.cost_amount is not None)
    if unknown_count:
        return RequestCostSummary(
            RequestCostSummaryStatus.PARTIAL,
            len(links),
            len(known),
            unknown_count,
            currency,
            None,
            subtotal,
        )
    return RequestCostSummary(
        RequestCostSummaryStatus.COMPLETE,
        len(links),
        len(known),
        0,
        currency,
        subtotal,
        subtotal,
    )


def _aware(value: datetime | None, name: str) -> None:
    if value is None:
        return
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime or null")


def _utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc)


def _identifier(value: Any, name: str) -> str:
    if not isinstance(value, str) or not _SAFE_ID.fullmatch(value) or contains_secret(value):
        raise ValueError(f"{name} must be a safe stable identifier")
    return value


def _logical_ref(value: Any, name: str) -> str:
    if not isinstance(value, str) or not _LOGICAL_REF.fullmatch(value) or contains_secret(value):
        raise ValueError(f"{name} must be a safe logical reference")
    if value.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", value):
        raise ValueError(f"{name} must not be an absolute path")
    return value


def _optional_text(value: Any, name: str, maximum: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError(f"{name} must be text or null")
    normalized = value.strip()
    if not normalized or len(normalized) > maximum or any(ord(char) < 32 for char in normalized):
        raise ValueError(f"{name} must be bounded safe text")
    if contains_secret(normalized):
        raise ValueError(f"{name} contains secret-like content")
    return normalized


def _safe_url(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 2048 or contains_secret(value):
        raise ValueError("source_url must be a safe bounded URL")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("source_url must be an HTTP(S) URL without userinfo")
    if any(_SENSITIVE_QUERY.search(key) for key, _ in parse_qsl(parsed.query, keep_blank_values=True)):
        raise ValueError("source_url contains a credential-like query field")
    return value
