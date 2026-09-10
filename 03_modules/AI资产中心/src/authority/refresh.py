from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import Enum

from src.contracts import AuthoritySourceType, FreshnessPolicy


class RefreshMode(str, Enum):
    ON_DEMAND = "on_demand"
    PERIODIC = "periodic"


@dataclass(frozen=True)
class OfficialRefreshPolicy:
    """Refresh semantics only; this contract performs no network access."""

    mode: RefreshMode
    freshness_policy: FreshnessPolicy
    interval: timedelta | None = None
    required_source_type: AuthoritySourceType = AuthoritySourceType.OFFICIAL_PROVIDER

    def __post_init__(self) -> None:
        if self.mode is RefreshMode.PERIODIC and (
            not isinstance(self.interval, timedelta) or self.interval <= timedelta(0)
        ):
            raise ValueError("periodic refresh requires a positive interval")
        if self.mode is RefreshMode.ON_DEMAND and self.interval is not None:
            raise ValueError("on-demand refresh must not define an interval")
        if self.required_source_type is not AuthoritySourceType.OFFICIAL_PROVIDER:
            raise ValueError("official refresh must verify an official provider source")
