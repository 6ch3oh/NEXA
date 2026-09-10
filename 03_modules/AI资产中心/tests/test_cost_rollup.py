from __future__ import annotations

import unittest
from decimal import Decimal

from src.analytics import (Period, W_ACTUAL_COST_MISSING, W_ESTIMATED_COST_MISSING,
                           W_MIXED_CURRENCIES, rollup_costs)
from src.contracts import CostKind
from src.query import QueryService
from tests.fixtures.analytics_fixtures import (
    FEB_1, FEB_2, FEB_15, MAR_1, PROVIDER_A, TOKEN_A1, analytics_query, cost,
)


class TestCostRollup(unittest.TestCase):
    def test_actual_and_estimated_are_strictly_separate(self) -> None:
        result = rollup_costs(analytics_query(), PROVIDER_A, Period(FEB_1, MAR_1),
                              token_id=TOKEN_A1)[0]
        self.assertEqual((result.actual_amount, result.estimated_amount),
                         (Decimal("0.300000003"), Decimal("0.000000003")))
        self.assertEqual((result.actual_record_count, result.estimated_record_count), (2, 1))
        self.assertFalse(hasattr(result, "total_amount"))

    def test_decimal_accumulation_never_uses_float(self) -> None:
        records = [cost("0.000000001", FEB_1, CostKind.ACTUAL),
                   cost("0.000000002", FEB_2, CostKind.ACTUAL)]
        result = rollup_costs(QueryService(costs=records), PROVIDER_A,
                              Period(FEB_1, MAR_1))[0]
        self.assertIsInstance(result.actual_amount, Decimal)
        self.assertEqual(result.actual_amount, Decimal("0.000000003"))
        self.assertIsNone(result.estimated_amount)
        self.assertIn(W_ESTIMATED_COST_MISSING, result.warnings)

    def test_multiple_currencies_are_grouped_and_never_added(self) -> None:
        result = rollup_costs(analytics_query(), PROVIDER_A, Period(FEB_1, MAR_1))
        self.assertEqual([item.currency for item in result], ["CNY", "USD"])
        self.assertEqual([item.actual_amount for item in result],
                         [Decimal("1.25"), Decimal("0.300000003")])
        self.assertTrue(all(W_MIXED_CURRENCIES in item.warnings for item in result))

    def test_missing_kind_is_none_not_fake_zero(self) -> None:
        actual = rollup_costs(QueryService(costs=[cost("0", FEB_1, CostKind.ACTUAL)]),
                              PROVIDER_A, Period(FEB_1, MAR_1))[0]
        self.assertEqual((actual.actual_amount, actual.actual_record_count), (Decimal("0"), 1))
        self.assertIsNone(actual.estimated_amount)
        estimated = rollup_costs(QueryService(costs=[cost("0", FEB_1, CostKind.ESTIMATED)]),
                                 PROVIDER_A, Period(FEB_1, MAR_1))[0]
        self.assertIsNone(estimated.actual_amount)
        self.assertIn(W_ACTUAL_COST_MISSING, estimated.warnings)

    def test_end_is_exclusive_and_empty_is_explicit(self) -> None:
        query = QueryService(costs=[cost("1", FEB_15, CostKind.ACTUAL),
                                    cost("2", MAR_1, CostKind.ACTUAL)])
        self.assertEqual(rollup_costs(query, PROVIDER_A, Period(FEB_1, MAR_1))[0].actual_amount,
                         Decimal("1"))
        self.assertEqual(rollup_costs(QueryService(), PROVIDER_A, Period(FEB_1, MAR_1)), ())

    def test_reverse_input_order_is_deterministic(self) -> None:
        period = Period(FEB_1, MAR_1)
        self.assertEqual(rollup_costs(analytics_query(), PROVIDER_A, period),
                         rollup_costs(analytics_query(reverse=True), PROVIDER_A, period))


if __name__ == "__main__":
    unittest.main()
