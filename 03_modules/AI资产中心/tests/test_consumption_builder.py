from __future__ import annotations

import pathlib
import unittest
from decimal import Decimal

from src.consumption import (
    ConsumptionCompleteness,
    WarningCode,
    build_portfolio_view,
    build_provider_view,
    build_token_view,
    to_canonical_json,
    to_json_safe,
)
from src.contracts import PriceDimension, SourceType, Token, TokenStatus
from src.query import QueryService
from tests.fixtures.analytics_fixtures import (
    FEB_1,
    FEB_15,
    MAR_1,
    PROVIDER_A,
    TOKEN_A1,
    analytics_query,
    balance,
    price,
    provider,
    source,
)
from tests.fixtures.consumption_fixtures import (
    AS_OF,
    GENERATED_AT,
    PERIOD,
    STALE_AFTER,
    complete_query,
    portfolio_query,
)


def provider_view(query: QueryService):
    return build_provider_view(
        query, PROVIDER_A, PERIOD, generated_at=GENERATED_AT,
        as_of=AS_OF, stale_after=STALE_AFTER,
    )


class TestProviderAndTokenConsumption(unittest.TestCase):
    def test_complete_provider_contains_safe_consumption_sections(self) -> None:
        view = provider_view(complete_query())
        self.assertIs(view.completeness, ConsumptionCompleteness.COMPLETE)
        self.assertEqual(view.warnings, ())
        self.assertEqual(view.data.provider.id, PROVIDER_A)
        self.assertEqual(len(view.data.tokens), 1)
        self.assertTrue(view.data.pricing_available)
        self.assertEqual(view.data.latest_balance.value, Decimal("50.00"))
        self.assertEqual(view.data.usage.total_tokens, 20)

    def test_incomplete_provider_uses_stable_deduplicated_warning_codes(self) -> None:
        view = provider_view(analytics_query())
        self.assertIs(view.completeness, ConsumptionCompleteness.INCOMPLETE)
        self.assertIn(WarningCode.BALANCE_STALE, view.warnings)
        self.assertIn(WarningCode.MIXED_CURRENCIES, view.warnings)
        self.assertEqual(view.warnings, tuple(sorted(set(view.warnings), key=lambda item: item.value)))

    def test_token_view_excludes_secret_ref_and_raw_secret_fields(self) -> None:
        view = build_token_view(
            complete_query(), PROVIDER_A, TOKEN_A1, PERIOD,
            generated_at=GENERATED_AT, as_of=AS_OF, stale_after=STALE_AFTER,
        )
        payload = to_json_safe(view)
        serialized = to_canonical_json(view)
        self.assertTrue(payload["data"]["token"]["masked_identifier"].startswith("fp:"))
        self.assertNotIn("secret_ref", serialized)
        self.assertNotIn("vault://", serialized)
        self.assertNotIn('"secret"', serialized)
        self.assertEqual(payload["data"]["latest_balance"]["health"], "available")
        self.assertTrue(payload["data"]["actual_cost_by_currency"])
        self.assertTrue(payload["data"]["estimated_cost_by_currency"])

    def test_missing_cost_and_true_zero_are_distinct(self) -> None:
        missing = provider_view(QueryService(providers=[provider()],
                                             balances=[balance("1", FEB_15)],
                                             pricing=[price(PriceDimension.INPUT, "0.1")]))
        zero = provider_view(complete_query(zero_cost=True))
        self.assertEqual(missing.data.actual_cost_by_currency, ())
        self.assertIn(WarningCode.ACTUAL_COST_MISSING, missing.warnings)
        self.assertEqual(zero.data.actual_cost_by_currency[0].amount, Decimal("0"))
        self.assertEqual(zero.data.actual_cost_by_currency[0].record_count, 1)

    def test_ambiguous_data_maps_to_stable_code(self) -> None:
        query = QueryService(
            providers=[provider()],
            balances=[balance("1", FEB_15), balance("2", FEB_15)],
            pricing=[price(PriceDimension.INPUT, "0.1", effective_at=FEB_1),
                     price(PriceDimension.INPUT, "0.2", effective_at=FEB_1)],
        )
        view = provider_view(query)
        self.assertIn(WarningCode.AMBIGUOUS_DATA, view.warnings)
        self.assertEqual(view.data.latest_balance.health.value, "unknown")


class TestPortfolioConsumption(unittest.TestCase):
    def test_multiple_providers_currency_groups_and_usage(self) -> None:
        view = build_portfolio_view(
            portfolio_query(), PERIOD, generated_at=GENERATED_AT,
            as_of=AS_OF, stale_after=STALE_AFTER,
        )
        self.assertEqual([item.data.provider.id for item in view.data.providers],
                         sorted(item.data.provider.id for item in view.data.providers))
        self.assertEqual(view.data.currencies_observed, ("CNY", "USD"))
        self.assertEqual(
            [(item.currency, item.amount) for item in view.data.actual_cost_by_currency],
            [("CNY", Decimal("1.25")), ("USD", Decimal("10.290000003"))],
        )
        self.assertEqual(
            [(item.currency, item.amount) for item in view.data.estimated_cost_by_currency],
            [("USD", Decimal("0.000000003"))],
        )
        self.assertEqual(view.data.total_usage.record_count, 4)
        self.assertIn(WarningCode.MIXED_CURRENCIES, view.warnings)
        self.assertFalse(hasattr(view.data, "total_cost"))

    def test_reversed_input_produces_same_model_and_json(self) -> None:
        first = build_portfolio_view(portfolio_query(), PERIOD, generated_at=GENERATED_AT,
                                     as_of=AS_OF, stale_after=STALE_AFTER)
        second = build_portfolio_view(portfolio_query(reverse=True), PERIOD,
                                      generated_at=GENERATED_AT, as_of=AS_OF,
                                      stale_after=STALE_AFTER)
        self.assertEqual(first, second)
        self.assertEqual(to_canonical_json(first), to_canonical_json(second))


class TestConsumptionSecurityBoundary(unittest.TestCase):
    def test_secret_shaped_canonical_invalid_input_fails_closed(self) -> None:
        synthetic_raw = "sk-" + "z" * 24
        with self.assertRaises(ValueError):
            Token(
                id="unsafe", provider_id=PROVIDER_A, label="unsafe",
                status=TokenStatus.ACTIVE, masked_identifier=synthetic_raw,
                source=source(SourceType.LOCAL_CONFIG, "synthetic:unsafe"),
            )

    def test_consumption_source_has_no_forbidden_capabilities(self) -> None:
        directory = pathlib.Path(__file__).resolve().parents[1] / "src" / "consumption"
        source_text = "\n".join(
            path.read_text(encoding="utf-8") for path in directory.glob("*.py")
        ).lower()
        for fragment in (
            "sqlite", "select ", "insert ", "src.store", "open(", "pathlib",
            "requests", "urllib", "socket", "subprocess", "os.environ", "getenv(",
            "credential_store", "cost_calculator", "calculate_derived_cost",
        ):
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, source_text)


if __name__ == "__main__":
    unittest.main()
