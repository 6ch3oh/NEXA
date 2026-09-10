from __future__ import annotations

import unittest

from src.contracts import CostKind, PriceDimension
from src.query import (
    SECTION_BALANCE,
    SECTION_DERIVED_COST,
    SECTION_EXPLICIT_COST,
    SECTION_PRICING,
    SECTION_PROVIDER,
    SECTION_TOKEN,
    SECTION_USAGE,
    W_BALANCE_AMBIGUOUS,
    W_BALANCE_MISSING,
    W_DERIVED_COST_MISSING,
    W_EXPLICIT_COST_MISSING,
    W_NO_TOKENS,
    W_PRICING_AMBIGUOUS,
    W_PRICING_MISSING,
    W_PROVIDER_AMBIGUOUS,
    W_PROVIDER_MISSING,
    W_USAGE_MISSING,
    W_USAGE_WITHOUT_PRICING,
    QueryService,
)

from tests.fixtures.query_fixtures import (
    MODEL_A,
    PROVIDER_ID,
    T0,
    T1,
    T2,
    T3,
    balance,
    cost,
    price,
    provider,
    token,
    usage,
)


def complete_records() -> dict[str, list]:
    providers = [provider()]
    tokens = [token("tok-b"), token("tok-a")]
    balances = [
        balance(PROVIDER_ID, "10.00", observed_at=T1),
        balance(PROVIDER_ID, "8.00", observed_at=T2),
        balance(PROVIDER_ID, "4.00", token_id="tok-a", observed_at=T2),
        balance(PROVIDER_ID, "6.00", token_id="tok-b", observed_at=T1),
    ]
    usages = [
        usage("usage-old", observed_at=T1),
        usage("usage-latest", observed_at=T3),
    ]
    pricing = [
        price(PROVIDER_ID, MODEL_A, PriceDimension.INPUT, "0.4", effective_at=T0),
        price(PROVIDER_ID, MODEL_A, PriceDimension.OUTPUT, "0.8", effective_at=T0),
        price(PROVIDER_ID, MODEL_A, PriceDimension.CACHE_READ, "0.1", effective_at=T0),
    ]
    costs = [
        cost(PROVIDER_ID, "0.12", occurred_at=T1, kind=CostKind.ACTUAL),
        cost(
            PROVIDER_ID,
            "0.0008",
            occurred_at=T2,
            kind=CostKind.ESTIMATED,
            cost_basis="usage_pricing_calculation",
        ),
    ]
    return {
        "providers": providers,
        "tokens": tokens,
        "balances": balances,
        "usages": usages,
        "pricing": pricing,
        "costs": costs,
    }


class TestCompleteAssetSnapshot(unittest.TestCase):
    def test_complete_provider_snapshot(self) -> None:
        snapshot = QueryService(**complete_records()).get_asset_snapshot(PROVIDER_ID)
        self.assertEqual(snapshot.provider.id, PROVIDER_ID)
        self.assertEqual([item.id for item in snapshot.tokens], ["tok-a", "tok-b"])
        self.assertEqual(len(snapshot.balances), 3)
        self.assertEqual(len(snapshot.pricing), 3)
        self.assertEqual([item.usage_id for item in snapshot.usage], ["usage-latest"])
        self.assertEqual(len(snapshot.explicit_costs), 1)
        self.assertEqual(len(snapshot.derived_costs), 1)
        self.assertEqual(snapshot.warnings, ())
        self.assertEqual(
            set(snapshot.completeness),
            {
                SECTION_PROVIDER,
                SECTION_TOKEN,
                SECTION_BALANCE,
                SECTION_PRICING,
                SECTION_USAGE,
                SECTION_EXPLICIT_COST,
                SECTION_DERIVED_COST,
            },
        )

    def test_explicit_and_derived_costs_remain_separate(self) -> None:
        snapshot = QueryService(**complete_records()).get_asset_snapshot(PROVIDER_ID)
        self.assertTrue(all(item.kind is CostKind.ACTUAL for item in snapshot.explicit_costs))
        self.assertTrue(all(item.kind is CostKind.ESTIMATED for item in snapshot.derived_costs))

    def test_provenance_is_preserved(self) -> None:
        records = complete_records()
        snapshot = QueryService(**records).get_asset_snapshot(PROVIDER_ID)
        self.assertIn(records["providers"][0].source, snapshot.provenance)
        self.assertIn(records["usages"][-1].source, snapshot.provenance)
        self.assertIn(records["costs"][0].source, snapshot.provenance)

    def test_snapshot_is_deterministic_for_permuted_inputs(self) -> None:
        records = complete_records()
        first = QueryService(**records).get_asset_snapshot(PROVIDER_ID)
        reversed_records = {name: list(reversed(items)) for name, items in records.items()}
        second = QueryService(**reversed_records).get_asset_snapshot(PROVIDER_ID)
        self.assertEqual(first, second)


class TestIncompleteAssetSnapshot(unittest.TestCase):
    def test_missing_provider_has_no_fake_values(self) -> None:
        snapshot = QueryService().get_asset_snapshot("provider-missing")
        self.assertIsNone(snapshot.provider)
        self.assertEqual(snapshot.tokens, ())
        self.assertEqual(snapshot.balances, ())
        self.assertEqual(snapshot.pricing, ())
        self.assertEqual(snapshot.usage, ())
        self.assertEqual(snapshot.explicit_costs, ())
        self.assertEqual(snapshot.derived_costs, ())
        self.assertIn(W_PROVIDER_MISSING, snapshot.warnings)

    def test_duplicate_provider_is_explicitly_ambiguous(self) -> None:
        snapshot = QueryService(
            providers=[provider(), provider(display_name="Duplicate")]
        ).get_asset_snapshot(PROVIDER_ID)
        self.assertIsNone(snapshot.provider)
        self.assertIn(W_PROVIDER_AMBIGUOUS, snapshot.warnings)
        self.assertNotIn(W_PROVIDER_MISSING, snapshot.warnings)

    def test_provider_without_tokens_warns(self) -> None:
        snapshot = QueryService(providers=[provider()]).get_asset_snapshot(PROVIDER_ID)
        self.assertEqual(snapshot.tokens, ())
        self.assertIn(W_NO_TOKENS, snapshot.warnings)

    def test_missing_balance_warning_does_not_create_zero_balance(self) -> None:
        snapshot = QueryService(
            providers=[provider()], tokens=[token("tok-a")]
        ).get_asset_snapshot(PROVIDER_ID)
        self.assertEqual(snapshot.balances, ())
        self.assertIn(W_BALANCE_MISSING, snapshot.warnings)
        self.assertIn(f"{W_BALANCE_MISSING}:tok-a", snapshot.warnings)

    def test_ambiguous_balance_warning_has_no_selected_balance(self) -> None:
        snapshot = QueryService(
            providers=[provider()],
            balances=[
                balance(PROVIDER_ID, "1.00", observed_at=T2),
                balance(PROVIDER_ID, "2.00", observed_at=T2),
            ],
        ).get_asset_snapshot(PROVIDER_ID)
        self.assertEqual(snapshot.balances, ())
        self.assertIn(W_BALANCE_AMBIGUOUS, snapshot.warnings)

    def test_usage_without_pricing_is_explicit(self) -> None:
        snapshot = QueryService(
            providers=[provider()], usages=[usage("usage-1", observed_at=T1)]
        ).get_asset_snapshot(PROVIDER_ID)
        self.assertEqual(snapshot.pricing, ())
        self.assertIn(W_PRICING_MISSING, snapshot.warnings)
        self.assertIn(W_USAGE_WITHOUT_PRICING, snapshot.warnings)

    def test_ambiguous_pricing_warning_has_no_selected_price(self) -> None:
        snapshot = QueryService(
            providers=[provider()],
            pricing=[
                price(PROVIDER_ID, MODEL_A, PriceDimension.INPUT, "0.4", effective_at=T2),
                price(PROVIDER_ID, MODEL_A, PriceDimension.INPUT, "0.6", effective_at=T2),
            ],
        ).get_asset_snapshot(PROVIDER_ID)
        self.assertEqual(snapshot.pricing, ())
        self.assertIn(f"{W_PRICING_AMBIGUOUS}:{MODEL_A}:input", snapshot.warnings)

    def test_missing_usage_and_cost_sections_are_explicit(self) -> None:
        snapshot = QueryService(providers=[provider()]).get_asset_snapshot(PROVIDER_ID)
        self.assertIn(W_USAGE_MISSING, snapshot.warnings)
        self.assertIn(W_EXPLICIT_COST_MISSING, snapshot.warnings)
        self.assertIn(W_DERIVED_COST_MISSING, snapshot.warnings)


if __name__ == "__main__":
    unittest.main()
