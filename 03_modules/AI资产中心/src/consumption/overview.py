from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum

from src.analytics import BalanceHealthStatus, ResourceIntelligence
from src.budget import BudgetStatus

from .budget_view import BudgetConsumptionView
from .models import (
    BalanceConsumptionView, ConsumptionCompleteness, CurrencyCostView,
    PortfolioConsumptionView, ProvenanceView, WarningCode,
)


AI_ASSET_RESOURCE_OVERVIEW_SCHEMA_VERSION = "0.1"


class OverviewWarningCode(str, Enum):
    NO_USAGE = "NO_USAGE"
    NO_ACTUAL_COST = "NO_ACTUAL_COST"
    NO_ESTIMATED_COST = "NO_ESTIMATED_COST"
    UNATTRIBUTED_USAGE = "UNATTRIBUTED_USAGE"
    BUDGET_UNKNOWN = "BUDGET_UNKNOWN"
    PROVIDER_DATA_INCOMPLETE = "PROVIDER_DATA_INCOMPLETE"


@dataclass(frozen=True)
class CompactBalanceHealth:
    provider_id: str
    health: BalanceHealthStatus
    observed_at: datetime | None


@dataclass(frozen=True)
class BudgetStatusSummary:
    policy_id: str
    status: BudgetStatus
    utilization_ratio: Decimal | None
    currency: str


@dataclass(frozen=True)
class ResourceOverviewData:
    period_start: datetime
    period_end: datetime
    total_tokens: int
    actual_cost_by_currency: tuple[CurrencyCostView, ...]
    estimated_cost_by_currency: tuple[CurrencyCostView, ...]
    intelligence: ResourceIntelligence
    budgets: tuple[BudgetStatusSummary, ...]
    compact_balance_health: tuple[CompactBalanceHealth, ...]
    provenance: ProvenanceView


@dataclass(frozen=True)
class ResourceOverviewView:
    schema_version: str
    generated_at: datetime
    data: ResourceOverviewData
    completeness: ConsumptionCompleteness
    warnings: tuple[OverviewWarningCode, ...]

    def __post_init__(self):
        if self.schema_version != AI_ASSET_RESOURCE_OVERVIEW_SCHEMA_VERSION:
            raise ValueError("unsupported resource overview version")
        if self.generated_at.tzinfo is None or self.generated_at.utcoffset() is None:
            raise ValueError("generated_at must be timezone-aware")
        if self.warnings != tuple(sorted(set(self.warnings), key=lambda item: item.value)):
            raise ValueError("overview warnings must be stable and deduplicated")


def build_resource_overview(
    portfolio: PortfolioConsumptionView,
    intelligence: ResourceIntelligence,
    budgets: tuple[BudgetConsumptionView, ...],
    *,
    generated_at: datetime,
) -> ResourceOverviewView:
    if not isinstance(portfolio, PortfolioConsumptionView):
        raise TypeError("portfolio must be a PortfolioConsumptionView")
    if not isinstance(intelligence, ResourceIntelligence):
        raise TypeError("intelligence must be ResourceIntelligence")
    if not isinstance(budgets, tuple) or not all(isinstance(item, BudgetConsumptionView) for item in budgets):
        raise TypeError("budgets must contain BudgetConsumptionView values")
    warnings = set()
    if intelligence.coverage.total_records == 0: warnings.add(OverviewWarningCode.NO_USAGE)
    if not portfolio.data.actual_cost_by_currency: warnings.add(OverviewWarningCode.NO_ACTUAL_COST)
    if not portfolio.data.estimated_cost_by_currency: warnings.add(OverviewWarningCode.NO_ESTIMATED_COST)
    if intelligence.coverage.unattributed_tokens: warnings.add(OverviewWarningCode.UNATTRIBUTED_USAGE)
    if any(item.data.status is BudgetStatus.UNKNOWN for item in budgets):
        warnings.add(OverviewWarningCode.BUDGET_UNKNOWN)
    if portfolio.completeness is not ConsumptionCompleteness.COMPLETE:
        warnings.add(OverviewWarningCode.PROVIDER_DATA_INCOMPLETE)
    balance = tuple(sorted((CompactBalanceHealth(
        provider.data.provider.id if provider.data.provider is not None else "UNKNOWN",
        provider.data.latest_balance.health,
        provider.data.latest_balance.observed_at,
    ) for provider in portfolio.data.providers), key=lambda item: item.provider_id))
    budget_summaries = tuple(sorted((BudgetStatusSummary(
        item.data.policy_id, item.data.status, item.data.utilization_ratio, item.data.currency
    ) for item in budgets), key=lambda item: item.policy_id))
    usage = portfolio.data.total_usage
    return ResourceOverviewView(
        AI_ASSET_RESOURCE_OVERVIEW_SCHEMA_VERSION, generated_at,
        ResourceOverviewData(
            intelligence.period.start, intelligence.period.end,
            usage.total_tokens if usage is not None else 0,
            portfolio.data.actual_cost_by_currency,
            portfolio.data.estimated_cost_by_currency,
            intelligence, budget_summaries, balance, portfolio.data.provenance,
        ),
        ConsumptionCompleteness.COMPLETE if not warnings else ConsumptionCompleteness.INCOMPLETE,
        tuple(sorted(warnings, key=lambda item: item.value)),
    )
