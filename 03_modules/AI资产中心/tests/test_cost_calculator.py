from __future__ import annotations

import unittest
from datetime import datetime, timezone
from decimal import Decimal

from src.adapters import cost_from_legacy
from src.contracts import (
    CostKind,
    PriceDimension,
    PricingSnapshot,
    PricingUnit,
    SourceTag,
    SourceType,
    UsageRecord,
)
from src.domain import ComputationStatus, calculate_derived_cost

OBSERVED_AT = datetime(2026, 8, 9, 10, 0, tzinfo=timezone.utc)
EFFECTIVE_AT = datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)

PROVIDER_ID = "legacy:codex"
MODEL = "gpt-5"


def source(source_type: SourceType = SourceType.MANUAL) -> SourceTag:
    return SourceTag(source_type=source_type, source_reference="test-fixture")


def usage(**overrides) -> UsageRecord:
    base = dict(
        usage_id="usage-0001",
        provider_id=PROVIDER_ID,
        input_tokens=1000,
        output_tokens=500,
        cache_read_tokens=0,
        cache_write_tokens=0,
        observed_at=OBSERVED_AT,
        source=source(),
        model=MODEL,
    )
    base.update(overrides)
    return UsageRecord(**base)


def price(
    dimension: PriceDimension,
    price_per_unit: str,
    *,
    currency: str = "USD",
    model: str = MODEL,
    effective_at: datetime = EFFECTIVE_AT,
    provider_id: str = PROVIDER_ID,
) -> PricingSnapshot:
    return PricingSnapshot(
        provider_id=provider_id,
        model=model,
        price_per_unit=Decimal(price_per_unit),
        unit=PricingUnit.PER_1M_TOKENS,
        currency=currency,
        effective_at=effective_at,
        source=source(SourceType.LOCAL_CONFIG),
        price_dimension=dimension,
    )


class TestCostCalculatorCalculation(unittest.TestCase):
    def test_input_plus_output_calculation(self) -> None:
        result = calculate_derived_cost(
            usage(),
            [
                price(PriceDimension.INPUT, "0.4"),
                price(PriceDimension.OUTPUT, "0.8"),
            ],
        )
        self.assertEqual(result.status, ComputationStatus.COMPLETE)
        self.assertEqual(result.amount, Decimal("0.0008"))
        self.assertEqual(result.currency, "USD")
        self.assertEqual(result.missing_pricing_dimensions, ())

    def test_input_output_cache_read_calculation(self) -> None:
        result = calculate_derived_cost(
            usage(cache_read_tokens=250),
            [
                price(PriceDimension.INPUT, "0.4"),
                price(PriceDimension.OUTPUT, "0.8"),
                price(PriceDimension.CACHE_READ, "0.003"),
            ],
        )
        self.assertEqual(result.status, ComputationStatus.COMPLETE)
        self.assertEqual(result.amount, Decimal("0.00080075"))
        self.assertEqual(result.currency, "USD")

    def test_exact_per_million_formula_and_component_sum(self) -> None:
        result = calculate_derived_cost(
            usage(input_tokens=1_000_000, output_tokens=2_000_000),
            [
                price(PriceDimension.INPUT, "2.5"),
                price(PriceDimension.OUTPUT, "1.25"),
            ],
        )
        self.assertEqual(result.status, ComputationStatus.COMPLETE)
        by_dimension = {component.dimension: component for component in result.components}
        self.assertEqual(by_dimension["input"].amount, Decimal("2.5"))
        self.assertEqual(by_dimension["output"].amount, Decimal("2.5"))
        self.assertEqual(result.amount, Decimal("5.0"))
        component_sum = sum(
            component.amount for component in result.components if component.amount is not None
        )
        self.assertEqual(component_sum, result.amount)

    def test_unused_dimension_without_price_is_not_missing(self) -> None:
        result = calculate_derived_cost(
            usage(output_tokens=0),
            [price(PriceDimension.INPUT, "0.4")],
        )
        self.assertEqual(result.status, ComputationStatus.COMPLETE)
        self.assertEqual(result.missing_pricing_dimensions, ())


class TestCostCalculatorIncomplete(unittest.TestCase):
    def test_missing_input_pricing_is_incomplete(self) -> None:
        result = calculate_derived_cost(
            usage(),
            [price(PriceDimension.OUTPUT, "0.8")],
        )
        self.assertEqual(result.status, ComputationStatus.INCOMPLETE)
        self.assertIsNone(result.amount)
        self.assertIn("input", result.missing_pricing_dimensions)

    def test_nonzero_cache_write_is_never_complete(self) -> None:
        result = calculate_derived_cost(
            usage(cache_write_tokens=100),
            [
                price(PriceDimension.INPUT, "0.4"),
                price(PriceDimension.OUTPUT, "0.8"),
            ],
        )
        self.assertEqual(result.status, ComputationStatus.INCOMPLETE)
        self.assertIsNone(result.amount)
        self.assertIn("cache_write", result.missing_pricing_dimensions)

    def test_ambiguous_prices_are_never_guessed(self) -> None:
        ambiguous = [
            price(PriceDimension.INPUT, "0.4"),
            price(PriceDimension.INPUT, "0.6"),
        ]
        result = calculate_derived_cost(usage(), ambiguous)
        self.assertEqual(result.status, ComputationStatus.INCOMPLETE)
        self.assertIsNone(result.amount)
        self.assertIn("input", result.missing_pricing_dimensions)

    def test_mixed_currencies_have_no_fx_and_are_not_complete(self) -> None:
        result = calculate_derived_cost(
            usage(),
            [
                price(PriceDimension.INPUT, "0.4", currency="USD"),
                price(PriceDimension.OUTPUT, "0.8", currency="CNY"),
            ],
        )
        self.assertEqual(result.status, ComputationStatus.INCOMPLETE)
        self.assertIsNone(result.amount)
        self.assertIsNone(result.currency)

    def test_model_mismatch_leaves_price_unresolved(self) -> None:
        result = calculate_derived_cost(
            usage(),
            [price(PriceDimension.INPUT, "0.4", model="other-model")],
        )
        self.assertEqual(result.status, ComputationStatus.INCOMPLETE)
        self.assertIn("input", result.missing_pricing_dimensions)


class TestDerivedCostRecord(unittest.TestCase):
    def test_complete_result_creates_derived_cost_record(self) -> None:
        result = calculate_derived_cost(
            usage(),
            [
                price(PriceDimension.INPUT, "0.4"),
                price(PriceDimension.OUTPUT, "0.8"),
            ],
        )
        cost = result.to_cost_record()
        self.assertEqual(cost.provider_id, PROVIDER_ID)
        self.assertEqual(cost.amount, Decimal("0.0008"))
        self.assertEqual(cost.currency, "USD")
        self.assertEqual(cost.occurred_at, OBSERVED_AT)
        self.assertEqual(cost.model, MODEL)

    def test_incomplete_result_cannot_create_cost_record(self) -> None:
        result = calculate_derived_cost(
            usage(),
            [price(PriceDimension.OUTPUT, "0.8")],
        )
        self.assertEqual(result.status, ComputationStatus.INCOMPLETE)
        with self.assertRaises(ValueError):
            result.to_cost_record()

    def test_derived_basis_and_source_are_explicit(self) -> None:
        result = calculate_derived_cost(
            usage(),
            [
                price(PriceDimension.INPUT, "0.4"),
                price(PriceDimension.OUTPUT, "0.8"),
            ],
        )
        cost = result.to_cost_record()
        self.assertEqual(cost.source.source_type, SourceType.DERIVED_CALCULATED)
        self.assertEqual(cost.source.source_reference, "usage_pricing_calculation")
        self.assertEqual(cost.cost_basis, "usage_pricing_calculation")
        self.assertEqual(cost.kind, CostKind.ESTIMATED)

    def test_explicit_reported_cost_remains_separate(self) -> None:
        explicit = cost_from_legacy(
            {
                "client": "codex",
                "model": MODEL,
                "totalTokens": 1500,
                "costUsd": 0.12,
                "lastUsedAt": "2026-08-09T10:00:00Z",
            },
            provider_id=PROVIDER_ID,
        )
        self.assertIsNotNone(explicit)
        self.assertEqual(explicit.amount, Decimal("0.12"))
        self.assertEqual(explicit.kind, CostKind.ACTUAL)
        self.assertEqual(explicit.cost_basis, "legacy:costUsd")
        self.assertEqual(explicit.source.source_type, SourceType.LEGACY_IMPORT)

        derived = calculate_derived_cost(
            usage(input_tokens=1000, output_tokens=500),
            [
                price(PriceDimension.INPUT, "0.4"),
                price(PriceDimension.OUTPUT, "0.8"),
            ],
        ).to_cost_record()
        self.assertEqual(derived.amount, Decimal("0.0008"))
        self.assertEqual(derived.kind, CostKind.ESTIMATED)
        self.assertEqual(derived.cost_basis, "usage_pricing_calculation")

        self.assertEqual(explicit.amount, Decimal("0.12"))
        self.assertEqual(explicit.kind, CostKind.ACTUAL)
        self.assertNotEqual(explicit.cost_basis, derived.cost_basis)
        self.assertNotEqual(explicit.source.source_type, derived.source.source_type)


class TestCostCalculatorValidation(unittest.TestCase):
    def test_rejects_non_usage_input(self) -> None:
        with self.assertRaises(ValueError):
            calculate_derived_cost("not-usage", [])  # type: ignore[arg-type]

    def test_rejects_non_pricing_snapshot(self) -> None:
        with self.assertRaises(ValueError):
            calculate_derived_cost(usage(), ["not-pricing"])  # type: ignore[list-item]


if __name__ == "__main__":
    unittest.main()
