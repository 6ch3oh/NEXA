from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum

from src.analytics import BalanceHealthStatus
from src.contracts import BalanceUnit, ProviderCategory, ProviderStatus, SourceType, TokenStatus

AI_ASSET_CONSUMPTION_SCHEMA_VERSION = "0.1"


class ConsumptionCompleteness(str, Enum):
    COMPLETE = "COMPLETE"
    INCOMPLETE = "INCOMPLETE"
    UNKNOWN = "UNKNOWN"


class WarningCode(str, Enum):
    PROVIDER_MISSING = "PROVIDER_MISSING"
    TOKEN_MISSING = "TOKEN_MISSING"
    NO_TOKENS = "NO_TOKENS"
    BALANCE_MISSING = "BALANCE_MISSING"
    BALANCE_STALE = "BALANCE_STALE"
    PRICING_MISSING = "PRICING_MISSING"
    USAGE_MISSING = "USAGE_MISSING"
    ACTUAL_COST_MISSING = "ACTUAL_COST_MISSING"
    ESTIMATED_COST_MISSING = "ESTIMATED_COST_MISSING"
    MIXED_CURRENCIES = "MIXED_CURRENCIES"
    AMBIGUOUS_DATA = "AMBIGUOUS_DATA"


@dataclass(frozen=True)
class SourceProvenanceView:
    source_type: SourceType
    source_reference: str | None
    captured_at: datetime

    def __post_init__(self) -> None:
        _require_aware(self.captured_at, "captured_at")


@dataclass(frozen=True)
class ProvenanceView:
    derivation_type: SourceType
    underlying_sources: tuple[SourceProvenanceView, ...]

    def __post_init__(self) -> None:
        if self.derivation_type is not SourceType.DERIVED_CALCULATED:
            raise ValueError("consumption provenance must identify derived analytics")


@dataclass(frozen=True)
class ProviderIdentityView:
    id: str
    key: str
    display_name: str
    category: ProviderCategory
    status: ProviderStatus


@dataclass(frozen=True)
class TokenIdentityView:
    id: str
    provider_id: str
    label: str
    status: TokenStatus
    masked_identifier: str


@dataclass(frozen=True)
class BalanceConsumptionView:
    health: BalanceHealthStatus
    value: Decimal | None
    unit: BalanceUnit | None
    observed_at: datetime | None
    source: SourceProvenanceView | None


@dataclass(frozen=True)
class UsageConsumptionView:
    period_start: datetime
    period_end: datetime
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    total_tokens: int
    record_count: int


@dataclass(frozen=True)
class CurrencyCostView:
    currency: str
    amount: Decimal
    record_count: int

    def __post_init__(self) -> None:
        if not isinstance(self.amount, Decimal) or not self.amount.is_finite():
            raise ValueError("currency amount must be a finite Decimal")
        if self.record_count <= 0:
            raise ValueError("currency cost view must represent observed records")


@dataclass(frozen=True)
class TokenConsumptionData:
    token: TokenIdentityView | None
    provider_id: str
    latest_balance: BalanceConsumptionView
    usage: UsageConsumptionView | None
    actual_cost_by_currency: tuple[CurrencyCostView, ...]
    estimated_cost_by_currency: tuple[CurrencyCostView, ...]
    provenance: ProvenanceView


@dataclass(frozen=True)
class TokenConsumptionView:
    schema_version: str
    generated_at: datetime
    data: TokenConsumptionData
    completeness: ConsumptionCompleteness
    warnings: tuple[WarningCode, ...]

    def __post_init__(self) -> None:
        _validate_envelope(self.schema_version, self.generated_at, self.completeness, self.warnings)


@dataclass(frozen=True)
class ProviderConsumptionData:
    provider: ProviderIdentityView | None
    tokens: tuple[TokenConsumptionView, ...]
    latest_balance: BalanceConsumptionView
    usage: UsageConsumptionView | None
    actual_cost_by_currency: tuple[CurrencyCostView, ...]
    estimated_cost_by_currency: tuple[CurrencyCostView, ...]
    pricing_available: bool
    provenance: ProvenanceView


@dataclass(frozen=True)
class ProviderConsumptionView:
    schema_version: str
    generated_at: datetime
    data: ProviderConsumptionData
    completeness: ConsumptionCompleteness
    warnings: tuple[WarningCode, ...]

    def __post_init__(self) -> None:
        _validate_envelope(self.schema_version, self.generated_at, self.completeness, self.warnings)


@dataclass(frozen=True)
class PortfolioConsumptionData:
    providers: tuple[ProviderConsumptionView, ...]
    currencies_observed: tuple[str, ...]
    actual_cost_by_currency: tuple[CurrencyCostView, ...]
    estimated_cost_by_currency: tuple[CurrencyCostView, ...]
    total_usage: UsageConsumptionView | None
    provenance: ProvenanceView


@dataclass(frozen=True)
class PortfolioConsumptionView:
    schema_version: str
    generated_at: datetime
    data: PortfolioConsumptionData
    completeness: ConsumptionCompleteness
    warnings: tuple[WarningCode, ...]

    def __post_init__(self) -> None:
        _validate_envelope(self.schema_version, self.generated_at, self.completeness, self.warnings)


def _validate_envelope(
    schema_version: str,
    generated_at: datetime,
    completeness: ConsumptionCompleteness,
    warnings: tuple[WarningCode, ...],
) -> None:
    if schema_version != AI_ASSET_CONSUMPTION_SCHEMA_VERSION:
        raise ValueError("unsupported consumption schema version")
    _require_aware(generated_at, "generated_at")
    if not isinstance(completeness, ConsumptionCompleteness):
        raise ValueError("completeness must be a ConsumptionCompleteness")
    if not isinstance(warnings, tuple) or not all(isinstance(item, WarningCode) for item in warnings):
        raise ValueError("warnings must be a tuple of WarningCode values")
    expected = tuple(sorted(set(warnings), key=lambda item: item.value))
    if warnings != expected:
        raise ValueError("warnings must be deterministically ordered and deduplicated")


def _require_aware(value: datetime, name: str) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
