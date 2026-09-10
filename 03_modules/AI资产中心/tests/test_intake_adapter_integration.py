from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.adapters import (
    adapt_offline_pricing,
    balance_from_legacy,
    provider_from_legacy,
    token_from_legacy,
)
from src.application import CanonicalIntakeService, IntakeStatus
from src.contracts import PriceDimension, SourceType
from src.query import LookupStatus, QueryService
from src.store import SQLiteCanonicalStore
from tests.fixtures.intake_fixtures import MODEL, PROVIDER_A, provider
from tests.fixtures.legacy_token_monitor_fixtures import deepseek_provider_ok
from tests.fixtures.offline_pricing_fixtures import offline_row


class IntakeAdapterIntegrationCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "adapter-intake.sqlite3"
        self.intake = CanonicalIntakeService(self.database_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_offline_pricing_adapter_to_intake_store_and_query(self) -> None:
        self.intake.ingest_provider(provider())
        snapshots = adapt_offline_pricing([
            offline_row(provider_id=PROVIDER_A, model_id=MODEL),
        ])
        results = tuple(self.intake.ingest_pricing(snapshot) for snapshot in snapshots)
        self.assertTrue(all(result.status is IntakeStatus.STORED for result in results))

        with SQLiteCanonicalStore(self.database_path) as reopened:
            collections = reopened.load_collections()
        query = QueryService(**collections.as_query_kwargs())
        for dimension in (
            PriceDimension.INPUT,
            PriceDimension.OUTPUT,
            PriceDimension.CACHE_READ,
        ):
            with self.subTest(dimension=dimension):
                resolved = query.resolve_pricing(PROVIDER_A, MODEL, dimension)
                self.assertIs(resolved.status, LookupStatus.FOUND)
                self.assertIs(resolved.record.source.source_type, SourceType.LEGACY_IMPORT)

    def test_synthetic_legacy_adapter_to_intake_store(self) -> None:
        raw_fixture = deepseek_provider_ok()
        canonical_provider = provider_from_legacy(raw_fixture)
        canonical_token = token_from_legacy(raw_fixture)
        canonical_balance = balance_from_legacy(raw_fixture)
        self.assertIsNotNone(canonical_token)
        self.assertIsNotNone(canonical_balance)

        self.intake.ingest_provider(canonical_provider)
        self.intake.ingest_token(canonical_token)
        self.intake.ingest_balance(canonical_balance)

        with SQLiteCanonicalStore(self.database_path) as reopened:
            collections = reopened.load_collections()
        self.assertEqual(collections.providers, (canonical_provider,))
        self.assertEqual(collections.tokens, (canonical_token,))
        self.assertEqual(collections.balances, (canonical_balance,))
        self.assertTrue(
            all(
                record.source.source_type is SourceType.LEGACY_IMPORT
                for record in (
                    *collections.providers,
                    *collections.tokens,
                    *collections.balances,
                )
            )
        )


if __name__ == "__main__":
    unittest.main()
