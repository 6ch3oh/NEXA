from __future__ import annotations

import unittest
from decimal import Decimal

from src.budget import (
    BudgetCompleteness,
    BudgetCostBasis,
    BudgetReasonCode,
    BudgetScope,
    BudgetStatus,
    BudgetPeriod,
    evaluate_budget_from_query,
)
from src.contracts import SourceType
from src.query import QueryService
from tests.fixtures.analytics_fixtures import PROVIDER_A, analytics_query
from tests.fixtures.budget_fixtures import EVALUATED_AT, cost_query, policy


def evaluate(query: QueryService, **policy_overrides):
    return evaluate_budget_from_query(
        query, policy(**policy_overrides), evaluated_at=EVALUATED_AT
    )


class TestBudgetStatus(unittest.TestCase):
    def test_ok_warning_critical_and_exceeded_boundaries(self) -> None:
        cases = (
            ("79.999", BudgetStatus.OK, ()),
            ("80", BudgetStatus.WARNING, (BudgetReasonCode.THRESHOLD_WARNING,)),
            ("100", BudgetStatus.CRITICAL, (BudgetReasonCode.THRESHOLD_CRITICAL,)),
            ("100.0001", BudgetStatus.EXCEEDED, (BudgetReasonCode.BUDGET_EXCEEDED,)),
        )
        for amount, status, reasons in cases:
            with self.subTest(amount=amount):
                result = evaluate(cost_query(actual=(amount,)))
                self.assertIs(result.status, status)
                self.assertEqual(result.reasons, reasons)

    def test_thresholds_come_from_policy(self) -> None:
        result = evaluate(
            cost_query(actual=("50",)), warning_ratio=Decimal("0.5"),
            critical_ratio=Decimal("0.75")
        )
        self.assertIs(result.status, BudgetStatus.WARNING)


class TestCostBasisAndArithmetic(unittest.TestCase):
    def test_actual_only_and_estimated_only(self) -> None:
        query = cost_query(actual=("30",), estimated=("20",))
        actual = evaluate(query, cost_basis=BudgetCostBasis.ACTUAL_ONLY)
        estimated = evaluate(query, cost_basis=BudgetCostBasis.ESTIMATED_ONLY)
        self.assertEqual((actual.actual_used, actual.estimated_used, actual.evaluated_used),
                         (Decimal("30"), Decimal("20"), Decimal("30")))
        self.assertEqual(estimated.evaluated_used, Decimal("20"))

    def test_actual_plus_estimated_is_explicitly_mixed(self) -> None:
        result = evaluate(cost_query(actual=("30",), estimated=("20",)),
                          cost_basis=BudgetCostBasis.ACTUAL_PLUS_ESTIMATED)
        self.assertEqual(result.evaluated_used, Decimal("50"))
        self.assertIs(result.provenance.cost_basis, BudgetCostBasis.ACTUAL_PLUS_ESTIMATED)
        self.assertTrue(result.provenance.mixed_cost_basis)

    def test_decimal_remaining_utilization_and_overage(self) -> None:
        result = evaluate(cost_query(actual=("0.123456789",)),
                          limit_amount=Decimal("1"), warning_ratio=Decimal("0.8"),
                          critical_ratio=Decimal("1"))
        self.assertEqual(result.evaluated_used, Decimal("0.123456789"))
        self.assertEqual(result.remaining_amount, Decimal("0.876543211"))
        self.assertEqual(result.utilization_ratio, Decimal("0.123456789"))
        self.assertEqual(result.overage_amount, Decimal("0"))
        exceeded = evaluate(cost_query(actual=("1.25",)), limit_amount=Decimal("1"))
        self.assertEqual((exceeded.remaining_amount, exceeded.overage_amount),
                         (Decimal("-0.25"), Decimal("0.25")))


class TestMissingCurrencyAndScope(unittest.TestCase):
    def test_missing_is_unknown_but_observed_zero_is_ok(self) -> None:
        missing = evaluate(QueryService())
        zero = evaluate(cost_query(actual=("0",)))
        self.assertIs(missing.status, BudgetStatus.UNKNOWN)
        self.assertIs(missing.completeness, BudgetCompleteness.UNKNOWN)
        self.assertIn(BudgetReasonCode.COST_DATA_MISSING, missing.reasons)
        self.assertIn(BudgetReasonCode.PERIOD_NO_DATA, missing.reasons)
        self.assertIsNone(missing.evaluated_used)
        self.assertIs(zero.status, BudgetStatus.OK)
        self.assertEqual(zero.evaluated_used, Decimal("0"))

    def test_existing_cost_outside_policy_period_is_no_data(self) -> None:
        march_policy = policy(period=BudgetPeriod.monthly(EVALUATED_AT))
        result = evaluate_budget_from_query(
            cost_query(actual=("10",)), march_policy, evaluated_at=EVALUATED_AT
        )
        self.assertIs(result.status, BudgetStatus.UNKNOWN)
        self.assertIn(BudgetReasonCode.PERIOD_NO_DATA, result.reasons)

    def test_evaluation_before_policy_effective_time_is_invalid(self) -> None:
        result = evaluate_budget_from_query(
            cost_query(actual=("10",)), policy(effective_at=EVALUATED_AT),
            evaluated_at=EVALUATED_AT.replace(day=1),
        )
        self.assertIs(result.status, BudgetStatus.UNKNOWN)
        self.assertIn(BudgetReasonCode.INVALID_POLICY, result.reasons)

    def test_currency_mismatch_is_unknown_and_no_fx_occurs(self) -> None:
        result = evaluate(cost_query(actual=("10",), currency="CNY"))
        self.assertIs(result.status, BudgetStatus.UNKNOWN)
        self.assertIn(BudgetReasonCode.CURRENCY_MISMATCH, result.reasons)
        self.assertIsNone(result.evaluated_used)

    def test_portfolio_policy_uses_matching_currency_only(self) -> None:
        result = evaluate_budget_from_query(
            analytics_query(), policy(BudgetScope.PORTFOLIO, limit_amount=Decimal("20")),
            evaluated_at=EVALUATED_AT,
        )
        self.assertEqual(result.currency, "USD")
        self.assertEqual(result.actual_used, Decimal("10.290000003"))
        self.assertEqual(result.evaluated_used, Decimal("10.290000003"))

    def test_provider_and_token_scopes_use_existing_rollup_filters(self) -> None:
        query = analytics_query()
        provider_result = evaluate_budget_from_query(
            query, policy(BudgetScope.PROVIDER, limit_amount=Decimal("20")),
            evaluated_at=EVALUATED_AT,
        )
        token_result = evaluate_budget_from_query(
            query, policy(BudgetScope.TOKEN, limit_amount=Decimal("20")),
            evaluated_at=EVALUATED_AT,
        )
        self.assertEqual(provider_result.actual_used, Decimal("0.300000003"))
        self.assertEqual(token_result.actual_used, Decimal("0.300000003"))

    def test_disabled_and_ambiguous_input_are_unknown(self) -> None:
        disabled = evaluate(cost_query(actual=("10",)), enabled=False)
        ambiguous = evaluate_budget_from_query(
            cost_query(actual=("10",)), policy(), evaluated_at=EVALUATED_AT,
            cost_data_ambiguous=True,
        )
        self.assertIn(BudgetReasonCode.POLICY_DISABLED, disabled.reasons)
        self.assertIn(BudgetReasonCode.AMBIGUOUS_COST_DATA, ambiguous.reasons)
        self.assertIs(ambiguous.status, BudgetStatus.UNKNOWN)

    def test_provenance_is_derived_and_basis_is_preserved(self) -> None:
        result = evaluate(cost_query(actual=("1",)))
        self.assertIs(result.provenance.source_type, SourceType.DERIVED_CALCULATED)
        self.assertEqual(result.provenance.source_reference, "budget_policy_evaluation")
        self.assertIs(result.provenance.cost_basis, BudgetCostBasis.ACTUAL_ONLY)


if __name__ == "__main__":
    unittest.main()
