from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum

from .source_tag import SourceTag


class PricingUnit(str, Enum):
    PER_TOKEN = "per_token"
    PER_1K_TOKENS = "per_1k_tokens"
    PER_1M_TOKENS = "per_1m_tokens"
    PER_REQUEST = "per_request"
    PER_HOUR = "per_hour"
    PER_UNIT = "per_unit"


class PriceDimension(str, Enum):
    UNSPECIFIED = "unspecified"
    INPUT = "input"
    OUTPUT = "output"
    CACHE_READ = "cache_read"


@dataclass(frozen=True)
class PricingSnapshot:
    provider_id: str
    model: str
    price_per_unit: Decimal
    unit: PricingUnit
    currency: str
    effective_at: datetime
    source: SourceTag
    token_id: str | None = None
    price_dimension: PriceDimension = PriceDimension.UNSPECIFIED

    def __post_init__(self) -> None:
        if not _non_empty(self.provider_id):
            raise ValueError("PricingSnapshot provider_id must not be empty")
        if not _non_empty(self.model):
            raise ValueError("PricingSnapshot model must not be empty")
        if not isinstance(self.price_per_unit, Decimal):
            raise ValueError("PricingSnapshot price_per_unit must be a Decimal")
        if not isinstance(self.unit, PricingUnit):
            raise ValueError("PricingSnapshot unit must be a PricingUnit")
        if not _non_empty(self.currency):
            raise ValueError("PricingSnapshot currency must not be empty")
        if not isinstance(self.effective_at, datetime):
            raise ValueError("PricingSnapshot effective_at must be a datetime")
        if not isinstance(self.source, SourceTag):
            raise ValueError("PricingSnapshot source must be a SourceTag")
        if self.token_id is not None and not isinstance(self.token_id, str):
            raise ValueError("PricingSnapshot token_id must be a string")
        if not isinstance(self.price_dimension, PriceDimension):
            raise ValueError("PricingSnapshot price_dimension must be a PriceDimension")


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())
