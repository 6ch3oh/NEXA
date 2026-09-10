from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Iterable

from src.contracts.authority import BillingMode, PricingAuthorityRecord
from src.contracts.cost import CostKind, CostRecord
from src.contracts.pricing import PriceDimension, PricingSnapshot, PricingUnit
from src.contracts.source_tag import SourceTag, SourceType
from src.contracts.usage import UsageRecord

PER_MILLION = Decimal("1000000")
DERIVED_BASIS = "usage_pricing_calculation"
CACHE_WRITE_MISSING = "cache_write"

_DIMENSION_TOKEN_FIELD = {
    PriceDimension.INPUT: "input_tokens",
    PriceDimension.OUTPUT: "output_tokens",
    PriceDimension.CACHE_READ: "cache_read_tokens",
}

_SUPPORTED_UNIT = PricingUnit.PER_1M_TOKENS


class ComputationStatus(str, Enum):
    COMPLETE = "complete"
    INCOMPLETE = "incomplete"


@dataclass(frozen=True)
class CostComponent:
    dimension: str
    token_count: int
    price_per_unit: Decimal | None
    amount: Decimal | None


@dataclass(frozen=True)
class CostComputationResult:
    """Deterministic usage x pricing computation result.

    Only a ``COMPLETE`` result may create a derived ``CostRecord``. Missing
    required pricing, ambiguous pricing, incompatible currencies, or non-zero
    cache-write usage fail closed as ``INCOMPLETE``.
    """

    status: ComputationStatus
    usage_id: str
    provider_id: str
    amount: Decimal | None
    currency: str | None
    components: tuple[CostComponent, ...]
    missing_pricing_dimensions: tuple[str, ...]
    observed_at: datetime | None
    token_id: str | None = None
    model: str | None = None
    basis: str = DERIVED_BASIS

    def __post_init__(self) -> None:
        if not isinstance(self.status, ComputationStatus):
            raise ValueError("CostComputationResult status must be a ComputationStatus")
        if not isinstance(self.usage_id, str) or not self.usage_id.strip():
            raise ValueError("CostComputationResult usage_id must not be empty")
        if not isinstance(self.provider_id, str) or not self.provider_id.strip():
            raise ValueError("CostComputationResult provider_id must not be empty")
        if self.amount is not None and not isinstance(self.amount, Decimal):
            raise ValueError("CostComputationResult amount must be a Decimal")
        if self.currency is not None and not isinstance(self.currency, str):
            raise ValueError("CostComputationResult currency must be a string")
        if not isinstance(self.components, tuple):
            raise ValueError("CostComputationResult components must be a tuple")
        if not isinstance(self.missing_pricing_dimensions, tuple):
            raise ValueError("CostComputationResult missing_pricing_dimensions must be a tuple")
        if self.observed_at is not None and not isinstance(self.observed_at, datetime):
            raise ValueError("CostComputationResult observed_at must be a datetime")
        if self.token_id is not None and not isinstance(self.token_id, str):
            raise ValueError("CostComputationResult token_id must be a string")
        if self.model is not None and not isinstance(self.model, str):
            raise ValueError("CostComputationResult model must be a string")
        if not isinstance(self.basis, str) or not self.basis.strip():
            raise ValueError("CostComputationResult basis must not be empty")
        if self.status is ComputationStatus.COMPLETE:
            if self.amount is None or self.currency is None or self.observed_at is None:
                raise ValueError("COMPLETE computation must carry amount, currency, and observed_at")

    def to_cost_record(self) -> CostRecord:
        """Create the canonical derived CostRecord, or fail closed when
        INCOMPLETE. Provenance is DERIVED_CALCULATED and must not be confused
        with provider-reported API cost."""
        if self.status is not ComputationStatus.COMPLETE:
            raise ValueError("INCOMPLETE computation cannot create a derived CostRecord")
        if self.amount is None or self.currency is None or self.observed_at is None:
            raise ValueError("COMPLETE computation must carry amount, currency, and observed_at")
        source = SourceTag(
            source_type=SourceType.DERIVED_CALCULATED,
            source_reference=self.basis,
        )
        return CostRecord(
            provider_id=self.provider_id,
            amount=self.amount,
            currency=self.currency,
            occurred_at=self.observed_at,
            cost_basis=self.basis,
            source=source,
            token_id=self.token_id,
            model=self.model,
            kind=CostKind.ESTIMATED,
            usage_id=self.usage_id,
        )


def calculate_derived_cost(
    usage: UsageRecord,
    pricing: Iterable[PricingSnapshot],
) -> CostComputationResult:
    """Match deterministic pricing and compute the Usage x Pricing cost.

    Pure local computation over explicit pricing snapshots: no FX conversion,
    no guessing, and no CACHE_WRITE pricing. Currencies must be consistent and
    are never treated as 1:1.
    """
    if not isinstance(usage, UsageRecord):
        raise ValueError("usage must be a UsageRecord")
    snapshots = tuple(pricing)
    for snapshot in snapshots:
        if not isinstance(snapshot, PricingSnapshot):
            raise ValueError("pricing must contain only PricingSnapshot objects")

    matched: dict[PriceDimension, PricingSnapshot] = {}
    unresolved: set[str] = set()
    for dimension in _DIMENSION_TOKEN_FIELD:
        snapshot, ambiguous = _match_snapshot(usage, snapshots, dimension)
        if ambiguous:
            unresolved.add(dimension.value)
        elif snapshot is None:
            if _token_count(usage, dimension) > 0:
                unresolved.add(dimension.value)
        else:
            matched[dimension] = snapshot

    if usage.cache_write_tokens > 0:
        unresolved.add(CACHE_WRITE_MISSING)

    currencies = {snapshot.currency for snapshot in matched.values()}
    incompatible_currencies = len(currencies) > 1

    components = [
        _component(usage, dimension, matched.get(dimension))
        for dimension in _DIMENSION_TOKEN_FIELD
    ]
    components.append(
        CostComponent(
            dimension=CACHE_WRITE_MISSING,
            token_count=usage.cache_write_tokens,
            price_per_unit=None,
            amount=None,
        )
    )

    complete = (
        not unresolved
        and not incompatible_currencies
        and len(currencies) == 1
    )
    if complete:
        total = sum(
            component.amount for component in components if component.amount is not None
        )
        currency = next(iter(currencies))
    else:
        total = None
        currency = None

    return CostComputationResult(
        status=ComputationStatus.COMPLETE if complete else ComputationStatus.INCOMPLETE,
        usage_id=usage.usage_id,
        provider_id=usage.provider_id,
        amount=total,
        currency=currency,
        components=tuple(components),
        missing_pricing_dimensions=tuple(sorted(unresolved)),
        observed_at=usage.observed_at,
        token_id=usage.token_id,
        model=usage.model,
    )


def calculate_authoritative_cost(
    usage: UsageRecord, authority: PricingAuthorityRecord
) -> CostComputationResult:
    if not isinstance(authority, PricingAuthorityRecord):
        raise ValueError("authority must be a PricingAuthorityRecord")
    if authority.billing_mode is not BillingMode.API_USAGE:
        raise ValueError("only API_USAGE authority can derive token-based monetary cost")
    if not authority.applies_at(usage.observed_at):
        raise ValueError("pricing authority is not effective for the usage timestamp")
    return calculate_derived_cost(usage, authority.components)


def _match_snapshot(
    usage: UsageRecord,
    snapshots: tuple[PricingSnapshot, ...],
    dimension: PriceDimension,
) -> tuple[PricingSnapshot | None, bool]:
    """Deterministic single-snapshot match.

    Filters by provider, dimension, PER_1M_TOKENS unit, effective time, and
    model (when the Usage specifies one). Multiple unresolved candidates at the
    most recent effective time are ambiguous and must not be guessed.
    """
    candidates = [
        snapshot
        for snapshot in snapshots
        if snapshot.provider_id == usage.provider_id
        and snapshot.price_dimension is dimension
        and snapshot.unit is _SUPPORTED_UNIT
        and snapshot.effective_at <= usage.observed_at
        and (usage.model is None or snapshot.model == usage.model)
    ]
    if not candidates:
        return None, False
    latest = max(snapshot.effective_at for snapshot in candidates)
    at_latest = [snapshot for snapshot in candidates if snapshot.effective_at == latest]
    distinct = {(snapshot.price_per_unit, snapshot.currency) for snapshot in at_latest}
    if len(distinct) > 1:
        return None, True
    return at_latest[0], False


def _token_count(usage: UsageRecord, dimension: PriceDimension) -> int:
    return int(getattr(usage, _DIMENSION_TOKEN_FIELD[dimension]))


def _component(
    usage: UsageRecord,
    dimension: PriceDimension,
    snapshot: PricingSnapshot | None,
) -> CostComponent:
    count = _token_count(usage, dimension)
    if snapshot is None:
        return CostComponent(
            dimension=dimension.value,
            token_count=count,
            price_per_unit=None,
            amount=None,
        )
    return CostComponent(
        dimension=dimension.value,
        token_count=count,
        price_per_unit=snapshot.price_per_unit,
        amount=_component_amount(count, snapshot.price_per_unit),
    )


def _component_amount(token_count: int, price_per_unit: Decimal) -> Decimal:
    """token_count / 1_000_000 * price_per_unit, always in Decimal."""
    return (Decimal(token_count) / PER_MILLION) * price_per_unit
