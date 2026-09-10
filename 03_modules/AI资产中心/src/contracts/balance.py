from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum

from .source_tag import SourceTag


class BalanceUnit(str, Enum):
    USD = "usd"
    CNY = "cny"
    EUR = "eur"
    CREDITS = "credits"
    QUOTA = "quota"
    TOKEN_QUOTA = "token_quota"
    POINTS = "points"
    OTHER = "other"


@dataclass(frozen=True)
class BalanceSnapshot:
    provider_id: str
    value: Decimal
    unit: BalanceUnit
    observed_at: datetime
    source: SourceTag
    token_id: str | None = None

    def __post_init__(self) -> None:
        if not _non_empty(self.provider_id):
            raise ValueError("BalanceSnapshot provider_id must not be empty")
        if not isinstance(self.value, Decimal):
            raise ValueError("BalanceSnapshot value must be a Decimal")
        if not isinstance(self.unit, BalanceUnit):
            raise ValueError("BalanceSnapshot unit must be a BalanceUnit")
        if not isinstance(self.observed_at, datetime):
            raise ValueError("BalanceSnapshot observed_at must be a datetime")
        if not isinstance(self.source, SourceTag):
            raise ValueError("BalanceSnapshot source must be a SourceTag")
        if self.token_id is not None and not isinstance(self.token_id, str):
            raise ValueError("BalanceSnapshot token_id must be a string")


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())
