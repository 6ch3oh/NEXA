from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

from src.contracts import (
    PriceDimension,
    PricingSnapshot,
    PricingUnit,
    SourceTag,
    SourceType,
)
from src.domain.security import contains_plaintext_secret


class OfflinePricingSource(str, Enum):
    """Evidence-backed catalog identities accepted by the offline adapter."""

    MODELS_DEV = "models-dev"
    LITELLM = "litellm"


class OfflinePricingConflictError(ValueError):
    """The same pricing identity carries conflicting content in one batch."""


@dataclass(frozen=True)
class SanitizedOfflinePricingRow:
    """Caller-supplied local pricing data; never a Legacy cache object/path."""

    provider_id: str
    model_id: str
    currency: str
    effective_at: datetime
    source_id: OfflinePricingSource | str
    input_per_m: Decimal | int | float | str | None = None
    output_per_m: Decimal | int | float | str | None = None
    cache_read_per_m: Decimal | int | float | str | None = None
    token_id: str | None = None


_ALLOWED_FIELDS = frozenset({
    "provider_id",
    "model_id",
    "currency",
    "effective_at",
    "source_id",
    "input_per_m",
    "output_per_m",
    "cache_read_per_m",
    "token_id",
})

_DIMENSIONS = (
    ("input_per_m", PriceDimension.INPUT),
    ("output_per_m", PriceDimension.OUTPUT),
    ("cache_read_per_m", PriceDimension.CACHE_READ),
)


class OfflinePricingAdapter:
    """Convert sanitized local rows into canonical PricingSnapshot records.

    This component has no path/file API and performs no environment lookup,
    network access, cache lifecycle, TTL processing, refresh, or writes.
    """

    def adapt(
        self,
        rows: Iterable[SanitizedOfflinePricingRow | Mapping[str, Any]],
    ) -> tuple[PricingSnapshot, ...]:
        if isinstance(rows, (str, bytes, Mapping)) or not isinstance(rows, Iterable):
            raise ValueError("rows must be an iterable of sanitized pricing rows")

        snapshots: dict[tuple[Any, ...], PricingSnapshot] = {}
        for supplied in rows:
            row = _coerce_row(supplied)
            provider_id = _identity(row.provider_id, "provider_id")
            model_id = _identity(row.model_id, "model_id")
            currency = _identity(row.currency, "currency").upper()
            token_id = _optional_identity(row.token_id, "token_id")
            effective_at = _aware_datetime(row.effective_at)
            source_id = _source(row.source_id)
            _reject_secret_text(provider_id, model_id, currency, token_id)

            source = SourceTag(
                source_type=SourceType.LEGACY_IMPORT,
                source_reference=f"offline_pricing_cache:{source_id.value}",
                captured_at=effective_at,
            )
            observed_dimension = False
            for field_name, dimension in _DIMENSIONS:
                supplied_price = getattr(row, field_name)
                if supplied_price is None:
                    continue
                observed_dimension = True
                price = _decimal_price(supplied_price, field_name)
                snapshot = PricingSnapshot(
                    provider_id=provider_id,
                    token_id=token_id,
                    model=model_id,
                    price_per_unit=price,
                    unit=PricingUnit.PER_1M_TOKENS,
                    currency=currency,
                    effective_at=effective_at,
                    price_dimension=dimension,
                    source=source,
                )
                identity = (
                    source_id.value,
                    provider_id,
                    model_id,
                    dimension.value,
                    effective_at,
                    currency,
                )
                prior = snapshots.get(identity)
                if prior is None:
                    snapshots[identity] = snapshot
                elif (
                    prior.price_per_unit != snapshot.price_per_unit
                    or prior.token_id != snapshot.token_id
                ):
                    raise OfflinePricingConflictError(
                        "conflicting offline pricing for the same "
                        "source/provider/model/dimension/effective_at/currency"
                    )
            if not observed_dimension:
                raise ValueError("offline pricing row must contain at least one price dimension")

        return tuple(sorted(snapshots.values(), key=_snapshot_sort_key))


def adapt_offline_pricing(
    rows: Iterable[SanitizedOfflinePricingRow | Mapping[str, Any]],
) -> tuple[PricingSnapshot, ...]:
    """Convenience entry point for the stateless OfflinePricingAdapter."""

    return OfflinePricingAdapter().adapt(rows)


def _coerce_row(
    supplied: SanitizedOfflinePricingRow | Mapping[str, Any],
) -> SanitizedOfflinePricingRow:
    if isinstance(supplied, SanitizedOfflinePricingRow):
        return supplied
    if not isinstance(supplied, Mapping):
        raise ValueError("each offline pricing row must be a mapping or typed row")
    unknown = set(supplied) - _ALLOWED_FIELDS
    if unknown:
        shown = ", ".join(sorted(str(name) for name in unknown))
        raise ValueError(f"offline pricing row contains unsupported field(s): {shown}")
    try:
        return SanitizedOfflinePricingRow(**dict(supplied))
    except TypeError as exc:
        raise ValueError("offline pricing row is missing a required field") from exc


def _identity(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be explicitly provided")
    return value.strip()


def _optional_identity(value: Any, field_name: str) -> str | None:
    if value is None:
        return None
    return _identity(value, field_name)


def _aware_datetime(value: Any) -> datetime:
    if (
        not isinstance(value, datetime)
        or value.tzinfo is None
        or value.utcoffset() is None
    ):
        raise ValueError("effective_at must be an explicitly supplied timezone-aware datetime")
    return value


def _source(value: Any) -> OfflinePricingSource:
    try:
        return value if isinstance(value, OfflinePricingSource) else OfflinePricingSource(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("source_id must be one of: models-dev, litellm") from exc


def _decimal_price(value: Any, field_name: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (Decimal, int, float, str)):
        raise ValueError(f"{field_name} must be Decimal-compatible")
    if isinstance(value, str) and not value.strip():
        raise ValueError(f"{field_name} must be Decimal-compatible")
    try:
        number = value if isinstance(value, Decimal) else Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{field_name} must be Decimal-compatible") from exc
    if not number.is_finite():
        raise ValueError(f"{field_name} must be finite")
    if number < 0:
        raise ValueError(f"{field_name} must be >= 0")
    return number


def _reject_secret_text(*values: str | None) -> None:
    if any(value is not None and contains_plaintext_secret(value) for value in values):
        raise ValueError("offline pricing rows must not contain plaintext secrets")


def _snapshot_sort_key(snapshot: PricingSnapshot) -> tuple[Any, ...]:
    return (
        snapshot.provider_id,
        snapshot.model,
        snapshot.price_dimension.value,
        snapshot.effective_at,
        snapshot.currency,
        snapshot.source.source_reference or "",
        snapshot.token_id or "",
        snapshot.price_per_unit,
    )
