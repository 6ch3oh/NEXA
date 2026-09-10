from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.analytics import Period
from src.contracts import CostKind, PriceDimension
from src.query import QueryService
from tests.fixtures.analytics_fixtures import (
    FEB_1,
    FEB_2,
    FEB_15,
    MAR_1,
    PROVIDER_A,
    TOKEN_A1,
    analytics_query,
    balance,
    cost,
    price,
    provider,
    token,
    usage,
)

PERIOD = Period(FEB_1, MAR_1)
GENERATED_AT = datetime(2026, 3, 2, 9, 30, tzinfo=timezone.utc)
AS_OF = MAR_1
STALE_AFTER = timedelta(days=30)


def complete_query(*, reverse: bool = False, zero_cost: bool = False) -> QueryService:
    amount = "0" if zero_cost else "0.100000001"
    estimated = "0" if zero_cost else "0.000000003"
    collections = {
        "providers": [provider()],
        "tokens": [token(TOKEN_A1)],
        "balances": [balance("50.00", FEB_15), balance("20.00", FEB_15, token_id=TOKEN_A1)],
        "usages": [
            usage(
                "consumption-zero" if zero_cost else "consumption-usage",
                FEB_2,
                input_tokens=0 if zero_cost else 12,
                output_tokens=0 if zero_cost else 6,
                cache_read_tokens=0 if zero_cost else 2,
                cache_write_tokens=0,
            )
        ],
        "pricing": [price(PriceDimension.INPUT, "0.10")],
        "costs": [
            cost(amount, FEB_2, CostKind.ACTUAL),
            cost(estimated, FEB_2, CostKind.ESTIMATED),
        ],
    }
    if reverse:
        collections = {name: list(reversed(items)) for name, items in collections.items()}
    return QueryService(**collections)


def portfolio_query(*, reverse: bool = False) -> QueryService:
    return analytics_query(reverse=reverse)
