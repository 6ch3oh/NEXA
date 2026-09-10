from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum

from src.contracts import BalanceSnapshot, Provider, SourceTag, SourceType, Token


class Completeness(str, Enum):
    COMPLETE = "complete"
    INCOMPLETE = "incomplete"


class BalanceHealthStatus(str, Enum):
    AVAILABLE = "available"
    MISSING = "missing"
    STALE = "stale"
    UNKNOWN = "unknown"


W_PROVIDER_MISSING = "provider_missing"
W_PROVIDER_AMBIGUOUS = "provider_ambiguous"
W_TOKEN_MISSING = "token_missing"
W_TOKEN_AMBIGUOUS = "token_ambiguous"
W_NO_TOKENS = "no_tokens"
W_USAGE_MISSING = "usage_missing"
W_ACTUAL_COST_MISSING = "actual_cost_missing"
W_ESTIMATED_COST_MISSING = "estimated_cost_missing"
W_BALANCE_MISSING = "balance_missing"
W_BALANCE_STALE = "balance_stale"
W_BALANCE_AMBIGUOUS = "balance_ambiguous"
W_PRICING_MISSING = "pricing_missing"
W_PRICING_AMBIGUOUS = "pricing_ambiguous"
W_MIXED_CURRENCIES = "mixed_currencies"


@dataclass(frozen=True)
class Period:
    """Timezone-aware half-open interval: start <= timestamp < end."""

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        _require_aware(self.start, "start")
        _require_aware(self.end, "end")
        if self.start >= self.end:
            raise ValueError("period start must be before end")


@dataclass(frozen=True)
class ProvenanceSummary:
    """Marks the view as derived while retaining its fact-level sources."""

    underlying_sources: tuple[SourceTag, ...]
    derivation_type: SourceType = SourceType.DERIVED_CALCULATED

    def __post_init__(self) -> None:
        if self.derivation_type is not SourceType.DERIVED_CALCULATED:
            raise ValueError("analytics provenance must be derived/calculated")
        if not isinstance(self.underlying_sources, tuple):
            raise ValueError("underlying_sources must be a tuple")
        if not all(isinstance(item, SourceTag) for item in self.underlying_sources):
            raise ValueError("underlying_sources must contain SourceTag objects")


@dataclass(frozen=True)
class UsageRollup:
    provider_id: str
    token_id: str | None
    model: str | None
    period_start: datetime
    period_end: datetime
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    total_tokens: int
    record_count: int
    completeness: Completeness
    warnings: tuple[str, ...]
    provenance: ProvenanceSummary


@dataclass(frozen=True)
class CostRollup:
    provider_id: str
    token_id: str | None
    model: str | None
    currency: str
    period_start: datetime
    period_end: datetime
    actual_amount: Decimal | None
    estimated_amount: Decimal | None
    actual_record_count: int
    estimated_record_count: int
    completeness: Completeness
    warnings: tuple[str, ...]
    provenance: ProvenanceSummary

    def __post_init__(self) -> None:
        if (self.actual_amount is None) != (self.actual_record_count == 0):
            raise ValueError("actual amount must be absent exactly when its record count is zero")
        if (self.estimated_amount is None) != (self.estimated_record_count == 0):
            raise ValueError("estimated amount must be absent exactly when its record count is zero")
        for value in (self.actual_amount, self.estimated_amount):
            if value is not None and not isinstance(value, Decimal):
                raise ValueError("cost amounts must be Decimal")


@dataclass(frozen=True)
class BalanceHealthSummary:
    provider_id: str
    token_id: str | None
    status: BalanceHealthStatus
    balance: BalanceSnapshot | None
    as_of: datetime
    stale_after: timedelta | None
    warnings: tuple[str, ...]
    provenance: ProvenanceSummary


@dataclass(frozen=True)
class ProviderAssetSummary:
    provider_id: str
    provider: Provider | None
    token_count: int
    latest_balance: BalanceHealthSummary
    usage_rollup: UsageRollup | None
    cost_rollups: tuple[CostRollup, ...]
    pricing_available: bool
    actual_cost_available: bool
    estimated_cost_available: bool
    completeness: Completeness
    warnings: tuple[str, ...]
    provenance: ProvenanceSummary


@dataclass(frozen=True)
class TokenAssetSummary:
    token_id: str
    token: Token | None
    provider_id: str
    latest_balance: BalanceHealthSummary
    usage_rollup: UsageRollup | None
    cost_rollups: tuple[CostRollup, ...]
    actual_cost_available: bool
    estimated_cost_available: bool
    completeness: Completeness
    warnings: tuple[str, ...]
    provenance: ProvenanceSummary


def _require_aware(value: datetime, name: str) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime")
