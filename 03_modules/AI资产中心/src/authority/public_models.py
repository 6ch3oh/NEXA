from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum

from src.contracts import (
    AuthorityCompleteness,
    AuthoritySourceType,
    BillingMode,
    EntitlementLimitKind,
    EntitlementState,
    FreshnessStatus,
    PriceDimension,
    PricingUnit,
    SourceType,
)

NEXA_AI_RESOURCE_AUTHORITY_PUBLIC_CONTRACT_V0_1 = "0.1"
NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION = NEXA_AI_RESOURCE_AUTHORITY_PUBLIC_CONTRACT_V0_1
UNATTRIBUTED = "UNATTRIBUTED"


class PublicAuthorityStatus(str, Enum):
    FOUND_FRESH = "found_fresh"
    STALE = "stale"
    UNKNOWN = "unknown"
    MISSING = "missing"
    AMBIGUOUS = "ambiguous"
    INCOMPLETE = "incomplete"
    NOT_APPLICABLE = "not_applicable"


class PublicLimitAvailability(str, Enum):
    FINITE = "finite"
    UNLIMITED = "unlimited"
    UNKNOWN = "unknown"


class PublicWarningCode(str, Enum):
    PRICING_STALE = "pricing_stale"
    PRICING_UNKNOWN = "pricing_unknown"
    PRICING_MISSING = "pricing_missing"
    PRICING_AMBIGUOUS = "pricing_ambiguous"
    PRICING_COMPONENT_MISSING = "pricing_component_missing"
    PRICING_NOT_APPLICABLE = "pricing_not_applicable"
    ENTITLEMENT_STALE = "entitlement_stale"
    ENTITLEMENT_UNKNOWN = "entitlement_unknown"
    ENTITLEMENT_MISSING = "entitlement_missing"
    ENTITLEMENT_AMBIGUOUS = "entitlement_ambiguous"
    ENTITLEMENT_MULTIPLE_LIMITS = "entitlement_multiple_limits"
    ENTITLEMENT_NOT_AVAILABLE = "entitlement_not_available"


@dataclass(frozen=True)
class PublicCorrelation:
    project_id: str | None = None
    module_id: str | None = None
    task_id: str | None = None
    run_id: str | None = None

    def __post_init__(self) -> None:
        values = (self.project_id, self.module_id, self.task_id, self.run_id)
        if any(value is not None and not _non_empty(value) for value in values):
            raise ValueError("correlation identifiers must be non-empty when supplied")
        for name in ("project_id", "module_id", "task_id", "run_id"):
            if getattr(self, name) is None:
                object.__setattr__(self, name, UNATTRIBUTED)


@dataclass(frozen=True)
class PublicProvenance:
    source_type: SourceType
    source_reference: str | None
    captured_at: datetime

    def __post_init__(self) -> None:
        if not isinstance(self.source_type, SourceType):
            raise ValueError("source_type must be a SourceType")
        _aware(self.captured_at, "captured_at")


@dataclass(frozen=True)
class PublicPricingComponent:
    dimension: PriceDimension
    unit: PricingUnit
    price_per_unit: Decimal
    token_scope_id: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.dimension, PriceDimension):
            raise ValueError("dimension must be a PriceDimension")
        if not isinstance(self.unit, PricingUnit):
            raise ValueError("unit must be a PricingUnit")
        _decimal(self.price_per_unit, "price_per_unit")


@dataclass(frozen=True)
class PublicPricingAuthority:
    schema_version: str
    status: PublicAuthorityStatus
    authority_id: str | None
    provider_id: str
    model: str
    billing_mode: BillingMode
    currency: str | None
    components: tuple[PublicPricingComponent, ...]
    effective_from: datetime | None
    authority_source_type: AuthoritySourceType | None
    official_source: str | None
    fetched_at: datetime | None
    last_verified_at: datetime | None
    freshness: FreshnessStatus
    completeness: AuthorityCompleteness
    warnings: tuple[PublicWarningCode, ...]
    provenance: PublicProvenance | None
    token_monetary_estimate_allowed: bool
    correlation: PublicCorrelation | None = None

    def __post_init__(self) -> None:
        _version(self.schema_version)
        if not isinstance(self.status, PublicAuthorityStatus):
            raise ValueError("status must be a PublicAuthorityStatus")
        if not _non_empty(self.provider_id) or not _non_empty(self.model):
            raise ValueError("provider_id and model must not be empty")
        if self.authority_id is not None and not _non_empty(self.authority_id):
            raise ValueError("authority_id must be non-empty when supplied")
        if not isinstance(self.billing_mode, BillingMode):
            raise ValueError("billing_mode must be a BillingMode")
        _tuples(self.components, self.warnings)
        if self.token_monetary_estimate_allowed and not (
            self.billing_mode is BillingMode.API_USAGE
            and self.status is PublicAuthorityStatus.FOUND_FRESH
            and self.completeness is AuthorityCompleteness.COMPLETE
            and bool(self.components)
        ):
            raise ValueError("token monetary estimate flag is inconsistent")


@dataclass(frozen=True)
class PublicEntitlementLimit:
    kind: EntitlementLimitKind
    unit: str
    used: Decimal | None
    remaining: Decimal | None
    soft_limit: Decimal | None
    hard_limit: Decimal | None
    model: str | None
    availability: PublicLimitAvailability

    def __post_init__(self) -> None:
        if not isinstance(self.kind, EntitlementLimitKind) or not _non_empty(self.unit):
            raise ValueError("entitlement limit identity is invalid")
        for name in ("used", "remaining", "soft_limit", "hard_limit"):
            value = getattr(self, name)
            if value is not None:
                _decimal(value, name)
        if not isinstance(self.availability, PublicLimitAvailability):
            raise ValueError("limit availability is invalid")
        finite_values = (self.remaining, self.soft_limit, self.hard_limit)
        if self.availability is PublicLimitAvailability.UNLIMITED and any(
            value is not None for value in finite_values
        ):
            raise ValueError("unlimited public limit must not carry finite bounds")
        if self.availability is PublicLimitAvailability.FINITE and not any(
            value is not None for value in finite_values
        ):
            raise ValueError("finite public limit requires a finite bound")


@dataclass(frozen=True)
class PublicEntitlementAuthority:
    schema_version: str
    status: PublicAuthorityStatus
    entitlement_id: str | None
    provider_id: str
    token_scope_id: str | None
    plan: str | None
    model: str | None
    billing_mode: BillingMode | None
    used: Decimal | None
    remaining: Decimal | None
    resource_unit: str | None
    limits: tuple[PublicEntitlementLimit, ...]
    reset_at: datetime | None
    state: EntitlementState
    observed_at: datetime | None
    fixed_subscription_fee: Decimal | None
    fee_currency: str | None
    billing_cycle: str | None
    quota_cycle: str | None
    authority_source_type: AuthoritySourceType | None
    official_source: str | None
    fetched_at: datetime | None
    last_verified_at: datetime | None
    freshness: FreshnessStatus
    completeness: AuthorityCompleteness
    warnings: tuple[PublicWarningCode, ...]
    provenance: PublicProvenance | None
    token_monetary_estimate_allowed: bool
    correlation: PublicCorrelation | None = None

    def __post_init__(self) -> None:
        _version(self.schema_version)
        if not isinstance(self.status, PublicAuthorityStatus):
            raise ValueError("status must be a PublicAuthorityStatus")
        if not _non_empty(self.provider_id):
            raise ValueError("provider_id must not be empty")
        _tuples(self.limits, self.warnings)
        if self.token_monetary_estimate_allowed:
            raise ValueError("entitlement must not authorize token monetary estimates")


@dataclass(frozen=True)
class PublicAttributionRow:
    provider_id: str
    model: str
    project_id: str
    module_id: str
    task_id: str
    run_id: str
    attribution_status: str
    token_numerator: int
    token_denominator: int
    token_share: Decimal | None
    cost_numerator: Decimal | None
    cost_denominator: Decimal | None
    cost_share: Decimal | None


@dataclass(frozen=True)
class PublicAttributionAuthority:
    schema_version: str
    direction: str
    billing_mode: BillingMode
    cost_kind: str
    cost_share_status: str
    currency: str | None
    rows: tuple[PublicAttributionRow, ...]

    def __post_init__(self) -> None:
        _version(self.schema_version)
        if self.direction not in ("model_to_attribution", "task_to_models"):
            raise ValueError("public attribution direction is invalid")
        if not isinstance(self.billing_mode, BillingMode):
            raise ValueError("billing_mode must be a BillingMode")
        if not isinstance(self.rows, tuple):
            raise ValueError("public attribution rows must be a tuple")


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _version(value: str) -> None:
    if value != NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION:
        raise ValueError("unsupported public authority schema version")


def _tuples(*values: tuple) -> None:
    if any(not isinstance(value, tuple) for value in values):
        raise ValueError("public contract collections must be tuples")


def _decimal(value: Decimal, name: str) -> None:
    if not isinstance(value, Decimal) or not value.is_finite() or value < 0:
        raise ValueError(f"{name} must be a finite Decimal >= 0")


def _aware(value: datetime, name: str) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
