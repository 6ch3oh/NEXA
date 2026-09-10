from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Generic, TypeVar

from src.contracts import (
    BalanceSnapshot,
    CostRecord,
    PricingSnapshot,
    Provider,
    SourceTag,
    Token,
    UsageRecord,
)

T = TypeVar("T")


class LookupStatus(str, Enum):
    FOUND = "found"
    MISSING = "missing"
    AMBIGUOUS = "ambiguous"


@dataclass(frozen=True)
class UniqueLookupResult(Generic[T]):
    """Read-only unique-lookup outcome.

    Missing and ambiguous are explicit statuses. Nothing is guessed and no
    last-write-wins behavior is applied; conflicting candidates are returned
    verbatim for the caller to inspect.
    """

    status: LookupStatus
    record: T | None = None
    candidates: tuple[T, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.status, LookupStatus):
            raise ValueError("status must be a LookupStatus")
        if not isinstance(self.candidates, tuple):
            raise ValueError("candidates must be a tuple")
        if self.status is LookupStatus.FOUND and self.record is None:
            raise ValueError("FOUND result must carry a record")
        if self.status is not LookupStatus.FOUND and self.record is not None:
            raise ValueError("only a FOUND result may carry a record")


W_PROVIDER_MISSING = "provider_missing"
W_PROVIDER_AMBIGUOUS = "provider_ambiguous"
W_NO_TOKENS = "no_tokens"
W_BALANCE_MISSING = "balance_missing"
W_BALANCE_AMBIGUOUS = "balance_ambiguous"
W_PRICING_MISSING = "pricing_missing"
W_PRICING_AMBIGUOUS = "pricing_ambiguous"
W_USAGE_MISSING = "usage_missing"
W_EXPLICIT_COST_MISSING = "explicit_cost_missing"
W_DERIVED_COST_MISSING = "derived_cost_missing"
W_USAGE_WITHOUT_PRICING = "usage_without_pricing"
W_PRICING_WITHOUT_USAGE = "pricing_without_usage"

SECTION_PROVIDER = "provider"
SECTION_TOKEN = "token"
SECTION_BALANCE = "balance"
SECTION_PRICING = "pricing"
SECTION_USAGE = "usage"
SECTION_EXPLICIT_COST = "explicit_cost"
SECTION_DERIVED_COST = "derived_cost"


@dataclass(frozen=True)
class SnapshotAssembly:
    """Snapshot assembly metadata. Deliberately distinct from the record-level
    SourceTag carried by each aggregated canonical record."""

    assembled_at: datetime


@dataclass(frozen=True)
class AssetSnapshot:
    """Immutable read model of one provider scope.

    Aggregates already-canonical records only: it never invents business facts,
    never recalculates Usage x Pricing cost or Balance deltas, never overwrites
    an existing SourceTag, and never introduces raw-secret fields.
    """

    provider_id: str
    provider: Provider | None
    tokens: tuple[Token, ...]
    balances: tuple[BalanceSnapshot, ...]
    pricing: tuple[PricingSnapshot, ...]
    usage: tuple[UsageRecord, ...]
    explicit_costs: tuple[CostRecord, ...]
    derived_costs: tuple[CostRecord, ...]
    provenance: tuple[SourceTag, ...]
    warnings: tuple[str, ...]
    completeness: tuple[str, ...]
    assembly: SnapshotAssembly | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.provider_id, str) or not self.provider_id.strip():
            raise ValueError("AssetSnapshot provider_id must not be empty")
        for field_name in (
            "tokens",
            "balances",
            "pricing",
            "usage",
            "explicit_costs",
            "derived_costs",
            "provenance",
            "warnings",
            "completeness",
        ):
            if not isinstance(getattr(self, field_name), tuple):
                raise ValueError(f"AssetSnapshot {field_name} must be a tuple")
        if self.assembly is not None and not isinstance(self.assembly, SnapshotAssembly):
            raise ValueError("AssetSnapshot assembly must be a SnapshotAssembly")
