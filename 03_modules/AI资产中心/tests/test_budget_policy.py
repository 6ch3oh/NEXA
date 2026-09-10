from __future__ import annotations

import unittest
from datetime import datetime
from decimal import Decimal

from src.budget import BudgetPeriod, BudgetPeriodKind, BudgetScope
from tests.fixtures.analytics_fixtures import FEB_1, FEB_2, MAR_1, PROVIDER_A, TOKEN_A1
from tests.fixtures.budget_fixtures import DAILY_PERIOD, MONTHLY_PERIOD, policy


class TestBudgetPolicy(unittest.TestCase):
    def test_valid_portfolio_provider_and_token_policies(self) -> None:
        portfolio = policy(BudgetScope.PORTFOLIO)
        provider = policy(BudgetScope.PROVIDER)
        token = policy(BudgetScope.TOKEN)
        self.assertIsNone(portfolio.provider_id)
        self.assertEqual(provider.provider_id, PROVIDER_A)
        self.assertEqual((token.provider_id, token.token_id), (PROVIDER_A, TOKEN_A1))

    def test_daily_and_monthly_periods_are_half_open_and_deterministic(self) -> None:
        self.assertIs(DAILY_PERIOD.kind, BudgetPeriodKind.DAILY)
        self.assertEqual((DAILY_PERIOD.start, DAILY_PERIOD.end), (FEB_2, FEB_2.replace(day=3)))
        self.assertIs(MONTHLY_PERIOD.kind, BudgetPeriodKind.MONTHLY)
        self.assertEqual((MONTHLY_PERIOD.start, MONTHLY_PERIOD.end), (FEB_1, MAR_1))

    def test_invalid_scope_field_combinations_fail_closed(self) -> None:
        with self.assertRaises(ValueError):
            policy(BudgetScope.PORTFOLIO, provider_id=PROVIDER_A)
        with self.assertRaises(ValueError):
            policy(BudgetScope.PROVIDER, provider_id=None)
        with self.assertRaises(ValueError):
            policy(BudgetScope.TOKEN, token_id=None)

    def test_non_positive_or_non_finite_limit_rejected(self) -> None:
        for value in (Decimal("0"), Decimal("-1"), Decimal("NaN")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                policy(limit_amount=value)

    def test_invalid_thresholds_rejected(self) -> None:
        cases = (("0", "1"), ("0.9", "0.8"), ("0.8", "1.1"))
        for warning, critical in cases:
            with self.subTest(warning=warning, critical=critical), self.assertRaises(ValueError):
                policy(warning_ratio=Decimal(warning), critical_ratio=Decimal(critical))

    def test_naive_period_and_misaligned_period_rejected(self) -> None:
        with self.assertRaises(ValueError):
            BudgetPeriod.daily(datetime(2026, 2, 1))
        with self.assertRaises(ValueError):
            BudgetPeriod(BudgetPeriodKind.MONTHLY, FEB_2, MAR_1)


if __name__ == "__main__":
    unittest.main()
