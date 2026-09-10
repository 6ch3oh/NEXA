from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum

from .authority import AuthorityMetadata, BillingMode, FreshnessStatus
from .source_tag import SourceTag


class EntitlementState(str, Enum):
    AVAILABLE = "available"
    LOW = "low"
    EXHAUSTED = "exhausted"
    STALE = "stale"
    UNKNOWN = "unknown"
    NOT_AVAILABLE = "not_available"


class EntitlementLimitKind(str, Enum):
    RESOURCE = "resource"
    REQUEST = "request"
    TASK = "task"
    MODEL = "model"
    TOKEN = "token"
    CONTEXT = "context"
    CALL = "call"


@dataclass(frozen=True)
class EntitlementLimit:
    kind: EntitlementLimitKind
    unit: str
    used: Decimal | None = None
    remaining: Decimal | None = None
    soft_limit: Decimal | None = None
    hard_limit: Decimal | None = None
    model: str | None = None
    unlimited: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.kind, EntitlementLimitKind):
            raise ValueError("entitlement limit kind is invalid")
        if not _non_empty(self.unit):
            raise ValueError("entitlement limit unit must not be empty")
        if self.model is not None and not _non_empty(self.model):
            raise ValueError("entitlement limit model must be non-empty")
        for name in ("used", "remaining", "soft_limit", "hard_limit"):
            value = getattr(self, name)
            if value is not None and (
                not isinstance(value, Decimal) or not value.is_finite() or value < 0
            ):
                raise ValueError(f"{name} must be a finite Decimal >= 0 or None")
        if not isinstance(self.unlimited, bool):
            raise ValueError("unlimited must be a bool")
        if self.unlimited and any(
            value is not None
            for value in (self.remaining, self.soft_limit, self.hard_limit)
        ):
            raise ValueError("unlimited limit must not carry finite bounds")
        if self.soft_limit is not None and self.hard_limit is not None:
            if self.soft_limit > self.hard_limit:
                raise ValueError("soft_limit must not exceed hard_limit")


@dataclass(frozen=True)
class EntitlementSnapshot:
    entitlement_id: str
    provider_id: str
    billing_mode: BillingMode
    observed_at: datetime
    state: EntitlementState
    limits: tuple[EntitlementLimit, ...]
    metadata: AuthorityMetadata
    source: SourceTag
    token_id: str | None = None
    plan: str | None = None
    model: str | None = None
    fixed_fee: Decimal | None = None
    fee_currency: str | None = None
    billing_cycle: str | None = None
    quota_cycle: str | None = None
    reset_at: datetime | None = None

    def __post_init__(self) -> None:
        for name, value in (
            ("entitlement_id", self.entitlement_id),
            ("provider_id", self.provider_id),
        ):
            if not _non_empty(value):
                raise ValueError(f"{name} must not be empty")
        if not isinstance(self.billing_mode, BillingMode):
            raise ValueError("billing_mode is invalid")
        _aware(self.observed_at, "observed_at")
        if self.reset_at is not None:
            _aware(self.reset_at, "reset_at")
        if not isinstance(self.state, EntitlementState):
            raise ValueError("entitlement state is invalid")
        if not isinstance(self.limits, tuple) or not all(
            isinstance(item, EntitlementLimit) for item in self.limits
        ):
            raise ValueError("limits must contain EntitlementLimit objects")
        identities = {(item.kind, item.unit, item.model) for item in self.limits}
        if len(identities) != len(self.limits):
            raise ValueError("entitlement limit identities must be unique")
        if not isinstance(self.metadata, AuthorityMetadata):
            raise ValueError("metadata is invalid")
        if not isinstance(self.source, SourceTag):
            raise ValueError("source is invalid")
        if self.source != self.metadata.source:
            raise ValueError("source must match authority metadata source")
        for name in ("token_id", "plan", "model", "billing_cycle", "quota_cycle"):
            value = getattr(self, name)
            if value is not None and not _non_empty(value):
                raise ValueError(f"{name} must be non-empty when supplied")
        if self.fixed_fee is not None:
            if not isinstance(self.fixed_fee, Decimal) or not self.fixed_fee.is_finite() or self.fixed_fee < 0:
                raise ValueError("fixed_fee must be a finite Decimal >= 0")
            if not _non_empty(self.fee_currency):
                raise ValueError("fixed_fee requires fee_currency")
        elif self.fee_currency is not None:
            raise ValueError("fee_currency requires fixed_fee")

    def freshness(self, as_of: datetime) -> FreshnessStatus:
        return self.metadata.freshness_policy.evaluate(
            self.metadata.last_verified_at, as_of
        )


def _aware(value: datetime, name: str) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")


def _non_empty(value: str | None) -> bool:
    return isinstance(value, str) and bool(value.strip())
