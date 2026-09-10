from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from src.budget import BudgetCostBasis, BudgetPeriod, BudgetPolicy, BudgetScope
from src.contracts import CostKind, SourceTag, SourceType
from src.query import QueryService
from tests.fixtures.analytics_fixtures import (
    FEB_1,
    FEB_2,
    FEB_15,
    MAR_1,
    PROVIDER_A,
    TOKEN_A1,
    cost,
)

EVALUATED_AT = datetime(2026, 3, 2, tzinfo=timezone.utc)
POLICY_SOURCE = SourceTag(SourceType.MANUAL, "synthetic:budget-policy", FEB_1)
MONTHLY_PERIOD = BudgetPeriod.monthly(FEB_15)
DAILY_PERIOD = BudgetPeriod.daily(FEB_2)


def policy(scope: BudgetScope = BudgetScope.PROVIDER, **overrides) -> BudgetPolicy:
    values = dict(
        policy_id=f"policy-{scope.value}",
        scope=scope,
        provider_id=PROVIDER_A if scope in (BudgetScope.PROVIDER, BudgetScope.TOKEN) else None,
        token_id=TOKEN_A1 if scope is BudgetScope.TOKEN else None,
        model=None,
        currency="USD",
        limit_amount=Decimal("100"),
        period=MONTHLY_PERIOD,
        warning_ratio=Decimal("0.80"),
        critical_ratio=Decimal("1.00"),
        enabled=True,
        label=f"Synthetic {scope.value} budget",
        source=POLICY_SOURCE,
        created_at=FEB_1,
        effective_at=FEB_1,
        cost_basis=BudgetCostBasis.ACTUAL_ONLY,
    )
    values.update(overrides)
    return BudgetPolicy(**values)


def cost_query(
    actual: tuple[str, ...] = (),
    estimated: tuple[str, ...] = (),
    *,
    currency: str = "USD",
    provider_id: str = PROVIDER_A,
    token_id: str | None = TOKEN_A1,
) -> QueryService:
    records = [
        cost(amount, FEB_2, CostKind.ACTUAL, provider_id=provider_id,
             token_id=token_id, currency=currency)
        for amount in actual
    ]
    records.extend(
        cost(amount, FEB_15, CostKind.ESTIMATED, provider_id=provider_id,
             token_id=token_id, currency=currency)
        for amount in estimated
    )
    return QueryService(costs=records)
