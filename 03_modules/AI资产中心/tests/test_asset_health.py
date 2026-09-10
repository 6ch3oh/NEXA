from __future__ import annotations

import pathlib
import unittest
from datetime import timedelta

from src.analytics import (
    BalanceHealthStatus, Completeness, Period, W_BALANCE_AMBIGUOUS,
    W_BALANCE_MISSING, W_BALANCE_STALE, W_PRICING_AMBIGUOUS,
    W_PRICING_MISSING, W_USAGE_MISSING, summarize_balance_health,
    summarize_provider, summarize_token,
)
from src.contracts import PriceDimension, SourceType
from src.query import QueryService
from tests.fixtures.analytics_fixtures import (
    FEB_1, FEB_15, MAR_1, PROVIDER_A, TOKEN_A1, TOKEN_A3, analytics_query,
    balance, price, provider,
)


class TestBalanceHealth(unittest.TestCase):
    def test_available(self) -> None:
        result = summarize_balance_health(analytics_query(), PROVIDER_A, token_id=TOKEN_A1,
                                          as_of=MAR_1, stale_after=timedelta(days=30))
        self.assertIs(result.status, BalanceHealthStatus.AVAILABLE)
        self.assertEqual(result.balance.observed_at, FEB_15)

    def test_missing(self) -> None:
        result = summarize_balance_health(analytics_query(), PROVIDER_A,
                                          token_id=TOKEN_A3, as_of=MAR_1)
        self.assertIs(result.status, BalanceHealthStatus.MISSING)
        self.assertIsNone(result.balance)
        self.assertIn(W_BALANCE_MISSING, result.warnings)

    def test_stale_requires_explicit_threshold(self) -> None:
        stale = summarize_balance_health(analytics_query(), PROVIDER_A, as_of=MAR_1,
                                         stale_after=timedelta(days=30))
        without_rule = summarize_balance_health(analytics_query(), PROVIDER_A, as_of=MAR_1)
        self.assertIs(stale.status, BalanceHealthStatus.STALE)
        self.assertIn(W_BALANCE_STALE, stale.warnings)
        self.assertIs(without_rule.status, BalanceHealthStatus.AVAILABLE)

    def test_ambiguous_balance_is_unknown(self) -> None:
        result = summarize_balance_health(
            QueryService(balances=[balance("1", FEB_15), balance("2", FEB_15)]),
            PROVIDER_A, as_of=MAR_1)
        self.assertIs(result.status, BalanceHealthStatus.UNKNOWN)
        self.assertIn(W_BALANCE_AMBIGUOUS, result.warnings)


class TestAssetSummaries(unittest.TestCase):
    def setUp(self) -> None:
        self.period = Period(FEB_1, MAR_1)

    def test_provider_summary_contains_required_facts(self) -> None:
        summary = summarize_provider(analytics_query(), PROVIDER_A, self.period,
                                     as_of=MAR_1, stale_after=timedelta(days=30))
        self.assertEqual((summary.provider.id, summary.token_count), (PROVIDER_A, 3))
        self.assertEqual(summary.usage_rollup.record_count, 3)
        self.assertTrue(summary.actual_cost_available and summary.estimated_cost_available)
        self.assertTrue(summary.pricing_available)
        self.assertIs(summary.latest_balance.status, BalanceHealthStatus.STALE)
        self.assertIs(summary.completeness, Completeness.INCOMPLETE)
        self.assertIn(W_BALANCE_STALE, summary.warnings)

    def test_token_summary_is_safe_and_keeps_costs_separate(self) -> None:
        summary = summarize_token(analytics_query(), PROVIDER_A, TOKEN_A1,
                                  self.period, as_of=MAR_1)
        self.assertEqual(summary.token.id, TOKEN_A1)
        self.assertTrue(summary.token.masked_identifier.startswith("fp:"))
        self.assertFalse(hasattr(summary.token, "secret"))
        self.assertTrue(summary.actual_cost_available and summary.estimated_cost_available)
        self.assertEqual(summary.usage_rollup.record_count, 2)

    def test_missing_usage_and_pricing_are_not_fabricated(self) -> None:
        summary = summarize_provider(QueryService(providers=[provider()],
                                                  balances=[balance("1", FEB_15)]),
                                     PROVIDER_A, self.period, as_of=MAR_1)
        self.assertIsNone(summary.usage_rollup)
        self.assertEqual(summary.cost_rollups, ())
        self.assertFalse(summary.pricing_available)
        self.assertIn(W_USAGE_MISSING, summary.warnings)
        self.assertIn(W_PRICING_MISSING, summary.warnings)

    def test_ambiguous_pricing_is_explicit(self) -> None:
        query = QueryService(providers=[provider()], pricing=[
            price(PriceDimension.INPUT, "0.1", effective_at=FEB_1),
            price(PriceDimension.INPUT, "0.2", effective_at=FEB_1)])
        summary = summarize_provider(query, PROVIDER_A, self.period, as_of=MAR_1)
        self.assertFalse(summary.pricing_available)
        self.assertIn(W_PRICING_AMBIGUOUS, summary.warnings)
        self.assertNotIn(W_PRICING_MISSING, summary.warnings)

    def test_reverse_input_order_is_deterministic(self) -> None:
        first = summarize_provider(analytics_query(), PROVIDER_A, self.period, as_of=MAR_1)
        second = summarize_provider(analytics_query(reverse=True), PROVIDER_A,
                                    self.period, as_of=MAR_1)
        self.assertEqual(first, second)

    def test_provenance_is_derived_and_retains_sources(self) -> None:
        summary = summarize_provider(analytics_query(), PROVIDER_A, self.period, as_of=MAR_1)
        self.assertIs(summary.provenance.derivation_type, SourceType.DERIVED_CALCULATED)
        refs = {item.source_reference for item in summary.provenance.underlying_sources}
        self.assertIn(f"synthetic:provider:{PROVIDER_A}", refs)
        self.assertIn("synthetic:usage:usage-feb-start", refs)

    def test_analytics_has_no_sql_filesystem_network_or_cost_calculator(self) -> None:
        analytics_dir = pathlib.Path(__file__).resolve().parents[1] / "src" / "analytics"
        source_text = "\n".join(item.read_text(encoding="utf-8")
                                for item in analytics_dir.glob("*.py")).lower()
        for fragment in ("sqlite", "select ", "insert ", "open(", "pathlib", "requests",
                         "urllib", "socket", "cost_calculator", "calculate_derived_cost",
                         "src.store"):
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, source_text)


if __name__ == "__main__":
    unittest.main()
