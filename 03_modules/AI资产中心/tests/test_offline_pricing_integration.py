from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from src.adapters import adapt_offline_pricing
from src.analytics import Period
from src.application import AIAssetReadService
from src.contracts import (
    PriceDimension,
    Provider,
    ProviderCategory,
    ProviderStatus,
    SourceTag,
    SourceType,
    UsageRecord,
)
from src.domain import ComputationStatus, calculate_derived_cost
from src.query import LookupStatus, QueryService
from src.store import SQLiteCanonicalStore, WriteResult
from tests.fixtures.offline_pricing_fixtures import (
    EFFECTIVE_AT,
    MODEL_ID,
    OBSERVED_AT,
    PROVIDER_ID,
    offline_row,
)


def source(reference: str, captured_at: datetime = EFFECTIVE_AT) -> SourceTag:
    return SourceTag(SourceType.LOCAL_CONFIG, f"synthetic:{reference}", captured_at)


def provider() -> Provider:
    return Provider(
        id=PROVIDER_ID,
        key="offline-synthetic",
        display_name="Synthetic Offline Provider",
        category=ProviderCategory.LLM,
        status=ProviderStatus.ACTIVE,
        source=source("provider"),
    )


def usage() -> UsageRecord:
    return UsageRecord(
        usage_id="offline-usage-1",
        provider_id=PROVIDER_ID,
        model=MODEL_ID,
        input_tokens=1_000_000,
        output_tokens=2_000_000,
        cache_read_tokens=500_000,
        cache_write_tokens=0,
        observed_at=OBSERVED_AT,
        source=source("usage", OBSERVED_AT),
    )


class OfflinePricingIntegrationCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "offline-pricing.sqlite3"
        self.snapshots = adapt_offline_pricing([offline_row()])

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_adapter_store_reopen_and_query_all_dimensions(self) -> None:
        with SQLiteCanonicalStore(self.database_path) as store:
            for snapshot in self.snapshots:
                self.assertIs(store.append_pricing(snapshot), WriteResult.INSERTED)

        with SQLiteCanonicalStore(self.database_path) as reopened:
            loaded = reopened.load_collections()
        self.assertEqual(set(loaded.pricing), set(self.snapshots))

        query = QueryService(**loaded.as_query_kwargs())
        expected = {
            PriceDimension.INPUT: Decimal("0.40"),
            PriceDimension.OUTPUT: Decimal("0.80"),
            PriceDimension.CACHE_READ: Decimal("0.04"),
        }
        for dimension, price in expected.items():
            with self.subTest(dimension=dimension):
                result = query.resolve_pricing(PROVIDER_ID, MODEL_ID, dimension)
                self.assertIs(result.status, LookupStatus.FOUND)
                self.assertEqual(result.record.price_per_unit, price)

    def test_adapter_output_is_consumed_by_existing_cost_calculator(self) -> None:
        result = calculate_derived_cost(usage(), self.snapshots)
        self.assertIs(result.status, ComputationStatus.COMPLETE)
        self.assertEqual(result.amount, Decimal("2.020"))
        self.assertEqual(result.currency, "USD")

    def test_existing_application_read_service_reads_adapter_pricing(self) -> None:
        derived_cost = calculate_derived_cost(usage(), self.snapshots).to_cost_record()
        with SQLiteCanonicalStore(self.database_path) as store:
            store.put_provider(provider())
            store.append_usage(usage())
            for snapshot in self.snapshots:
                store.append_pricing(snapshot)
            store.append_cost(derived_cost)

        view = AIAssetReadService(self.database_path).get_provider_view(
            PROVIDER_ID,
            Period(EFFECTIVE_AT, datetime(2026, 9, 1, tzinfo=timezone.utc)),
            generated_at=OBSERVED_AT,
            as_of=OBSERVED_AT,
        )
        self.assertEqual(view.data.provider.id, PROVIDER_ID)
        self.assertTrue(view.data.pricing_available)
        self.assertEqual(view.data.estimated_cost_by_currency[0].amount, Decimal("2.020"))


if __name__ == "__main__":
    unittest.main()
