"""Stable NEXA model invocation ledger contract.

The record intentionally contains identity, usage, cost provenance, status, and
safe diagnostics only. Prompt and response bodies belong to Request/Result/Trace
storage and must not be copied into this ledger object.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from datetime import datetime
from enum import StrEnum
import math
import re
from typing import Any

from .model_gateway import UserTier


INVOCATION_RECORD_VERSION = "0.1"


class InvocationStatus(StrEnum):
    SUCCESS = "SUCCESS"
    ERROR = "ERROR"


class UsageAvailability(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    UNAVAILABLE = "UNAVAILABLE"


class CostSource(StrEnum):
    PROVIDER_REPORTED = "PROVIDER_REPORTED"
    LITELLM_CALCULATED = "LITELLM_CALCULATED"
    NEXA_ESTIMATED = "NEXA_ESTIMATED"
    UNAVAILABLE = "UNAVAILABLE"


class ModelErrorCategory(StrEnum):
    INVALID_REQUEST = "INVALID_REQUEST"
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    RATE_LIMITED = "RATE_LIMITED"
    TIMEOUT = "TIMEOUT"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    CONTENT_POLICY_BLOCKED = "CONTENT_POLICY_BLOCKED"
    CONTEXT_LIMIT_EXCEEDED = "CONTEXT_LIMIT_EXCEEDED"
    NETWORK_ERROR = "NETWORK_ERROR"
    INTERNAL_GATEWAY_ERROR = "INTERNAL_GATEWAY_ERROR"
    UNKNOWN_PROVIDER_ERROR = "UNKNOWN_PROVIDER_ERROR"


_SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{4,}\b", re.IGNORECASE),
    re.compile(r"\bBearer\s+\S+", re.IGNORECASE),
    re.compile(r"\bAuthorization\s*[:=]", re.IGNORECASE),
    re.compile(r"\b(?:api[_-]?key|secret)\s*[:=]", re.IGNORECASE),
)
_CURRENCY = re.compile(r"^[A-Z]{3}$")


@dataclass(frozen=True, slots=True)
class ModelInvocationRecord:
    request_id: str
    customer_id: str
    user_tier: UserTier
    capability_id: str
    workflow_id: str | None
    execution_id: str | None
    model_profile: str
    requested_alias: str
    resolved_provider: str
    resolved_model: str
    status: InvocationStatus
    started_at: datetime
    completed_at: datetime
    latency_ms: int
    usage_availability: UsageAvailability
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    cost_amount: float | None
    cost_currency: str | None
    cost_source: CostSource
    provider_request_id: str | None
    provider_response_id: str | None
    result_type: str
    result_summary: str
    artifact_ref: str | None
    error_category: ModelErrorCategory | None
    error_code: str | None
    retryable: bool | None
    safe_message: str | None
    provider_status_code: int | None
    provider_error_id: str | None

    def __post_init__(self) -> None:
        for name in (
            "request_id",
            "customer_id",
            "capability_id",
            "model_profile",
            "requested_alias",
            "resolved_provider",
            "resolved_model",
            "result_type",
            "result_summary",
        ):
            _required_safe_text(getattr(self, name), name)
        for name in (
            "workflow_id",
            "execution_id",
            "provider_request_id",
            "provider_response_id",
            "artifact_ref",
            "error_code",
            "safe_message",
            "provider_error_id",
        ):
            _optional_safe_text(getattr(self, name), name)

        if self.started_at.tzinfo is None or self.completed_at.tzinfo is None:
            raise ValueError("invocation timestamps must be timezone-aware")
        if self.completed_at < self.started_at:
            raise ValueError("completed_at cannot precede started_at")
        if isinstance(self.latency_ms, bool) or self.latency_ms < 0:
            raise ValueError("latency_ms must be a non-negative integer")

        tokens = (self.input_tokens, self.output_tokens, self.total_tokens)
        for value in tokens:
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, int) or value < 0
            ):
                raise ValueError("token counts must be non-negative integers or null")
        expected_availability = _usage_availability(tokens)
        if self.usage_availability is not expected_availability:
            raise ValueError("usage_availability does not match token presence")

        if self.cost_amount is None:
            if self.cost_source is not CostSource.UNAVAILABLE or self.cost_currency is not None:
                raise ValueError("unknown cost must use UNAVAILABLE with null currency")
        else:
            if (
                isinstance(self.cost_amount, bool)
                or not isinstance(self.cost_amount, (int, float))
                or not math.isfinite(float(self.cost_amount))
                or self.cost_amount < 0
            ):
                raise ValueError("cost_amount must be finite and non-negative")
            if self.cost_source is CostSource.UNAVAILABLE:
                raise ValueError("known cost requires a non-UNAVAILABLE source")
            if not isinstance(self.cost_currency, str) or not _CURRENCY.fullmatch(
                self.cost_currency
            ):
                raise ValueError("known cost requires an ISO 4217 currency code")

        if self.status is InvocationStatus.SUCCESS:
            if any(
                value is not None
                for value in (
                    self.error_category,
                    self.error_code,
                    self.retryable,
                    self.safe_message,
                    self.provider_status_code,
                    self.provider_error_id,
                )
            ):
                raise ValueError("successful invocation cannot contain error fields")
        else:
            if (
                self.error_category is None
                or self.error_code is None
                or self.retryable is None
                or self.safe_message is None
            ):
                raise ValueError("failed invocation requires normalized error fields")
        if self.provider_status_code is not None and not (
            100 <= self.provider_status_code <= 599
        ):
            raise ValueError("provider_status_code must be an HTTP status or null")

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"schema_version": INVOCATION_RECORD_VERSION}
        for item in fields(self):
            value = getattr(self, item.name)
            if isinstance(value, StrEnum):
                payload[item.name] = value.value
            elif isinstance(value, datetime):
                payload[item.name] = value.isoformat()
            else:
                payload[item.name] = value
        return payload

    def to_ai_usage_event_candidate(self) -> dict[str, Any]:
        """Return the module-local handoff candidate; this performs no write."""

        return {
            "schema_version": INVOCATION_RECORD_VERSION,
            "event_type": "AI_USAGE_EVENT",
            "request_id": self.request_id,
            "customer_id": self.customer_id,
            "user_tier": self.user_tier.value,
            "capability_id": self.capability_id,
            "workflow_id": self.workflow_id,
            "execution_id": self.execution_id,
            "model_profile": self.model_profile,
            "provider": self.resolved_provider,
            "model": self.resolved_model,
            "status": self.status.value,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "cost_amount": self.cost_amount,
            "cost_currency": self.cost_currency,
            "cost_source": self.cost_source.value,
            "latency_ms": self.latency_ms,
            "occurred_at": self.completed_at.isoformat(),
        }


def contains_secret(value: str) -> bool:
    return any(pattern.search(value) for pattern in _SECRET_PATTERNS)


def usage_availability(
    input_tokens: int | None,
    output_tokens: int | None,
    total_tokens: int | None,
) -> UsageAvailability:
    return _usage_availability((input_tokens, output_tokens, total_tokens))


def _usage_availability(values: tuple[int | None, int | None, int | None]) -> UsageAvailability:
    present = sum(value is not None for value in values)
    if present == 0:
        return UsageAvailability.UNAVAILABLE
    if present == len(values):
        return UsageAvailability.COMPLETE
    return UsageAvailability.PARTIAL


def _required_safe_text(value: Any, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be non-empty text")
    if contains_secret(value):
        raise ValueError(f"{name} contains secret-like content")


def _optional_safe_text(value: Any, name: str) -> None:
    if value is None:
        return
    _required_safe_text(value, name)
