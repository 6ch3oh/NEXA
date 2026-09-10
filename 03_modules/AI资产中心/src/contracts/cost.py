from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum

from .source_tag import SourceTag


class CostKind(str, Enum):
    ACTUAL = "actual"
    ESTIMATED = "estimated"


@dataclass(frozen=True)
class CostRecord:
    provider_id: str
    amount: Decimal
    currency: str
    occurred_at: datetime
    cost_basis: str
    source: SourceTag
    token_id: str | None = None
    model: str | None = None
    kind: CostKind = CostKind.ACTUAL
    usage_id: str | None = None

    def __post_init__(self) -> None:
        if not _non_empty(self.provider_id):
            raise ValueError("CostRecord provider_id must not be empty")
        if not isinstance(self.amount, Decimal):
            raise ValueError("CostRecord amount must be a Decimal")
        if not _non_empty(self.currency):
            raise ValueError("CostRecord currency must not be empty")
        if not isinstance(self.occurred_at, datetime):
            raise ValueError("CostRecord occurred_at must be a datetime")
        if not _non_empty(self.cost_basis):
            raise ValueError("CostRecord cost_basis must not be empty")
        if not isinstance(self.source, SourceTag):
            raise ValueError("CostRecord source must be a SourceTag")
        if not isinstance(self.kind, CostKind):
            raise ValueError("CostRecord kind must be a CostKind")
        if self.token_id is not None and not isinstance(self.token_id, str):
            raise ValueError("CostRecord token_id must be a string")
        if self.model is not None and not isinstance(self.model, str):
            raise ValueError("CostRecord model must be a string")
        if self.usage_id is not None and not _non_empty(self.usage_id):
            raise ValueError("CostRecord usage_id must be non-empty when supplied")


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())
