from __future__ import annotations

import pathlib
import tempfile
import unittest
from pathlib import Path

from src.contracts import CostKind, PriceDimension
from src.query import LookupStatus, QueryService
from src.store import SQLiteCanonicalStore

from tests.fixtures.store_fixtures import PROVIDER_ID, T1, T2, complete_fixture


class TestStoreQueryIntegration(unittest.TestCase):
    def test_reopen_load_and_query_canonical_collections(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "integration.sqlite3"
            fixture = complete_fixture()
            with SQLiteCanonicalStore(db_path) as store:
                for record in fixture.providers:
                    store.put_provider(record)
                for record in fixture.tokens:
                    store.put_token(record)
                for record in fixture.balances:
                    store.append_balance(record)
                for record in fixture.usages:
                    store.append_usage(record)
                for record in fixture.pricing:
                    store.append_pricing(record)
                for record in fixture.costs:
                    store.append_cost(record)

            with SQLiteCanonicalStore(db_path) as reopened:
                collections = reopened.load_collections()
                query = QueryService(**collections.as_query_kwargs())

                latest = query.latest_balance(PROVIDER_ID)
                self.assertEqual(latest.status, LookupStatus.FOUND)
                self.assertEqual(latest.record.observed_at, T2)

                pricing = query.resolve_pricing(
                    PROVIDER_ID,
                    fixture.pricing[0].model,
                    PriceDimension.INPUT,
                    effective_at=T2,
                )
                self.assertEqual(pricing.status, LookupStatus.FOUND)

                actual = query.list_costs(provider_id=PROVIDER_ID, kind=CostKind.ACTUAL)
                estimated = query.list_costs(provider_id=PROVIDER_ID, kind=CostKind.ESTIMATED)
                self.assertEqual(len(actual), 1)
                self.assertEqual(len(estimated), 1)
                self.assertNotEqual(actual[0].kind, estimated[0].kind)

                snapshot = query.get_asset_snapshot(PROVIDER_ID)
                self.assertEqual(snapshot.provider.id, PROVIDER_ID)
                self.assertTrue(snapshot.tokens)
                self.assertTrue(snapshot.balances)
                self.assertTrue(snapshot.pricing)
                self.assertTrue(snapshot.usage)
                self.assertEqual(len(snapshot.explicit_costs), 1)
                self.assertEqual(len(snapshot.derived_costs), 1)

            self.assertTrue(db_path.exists())
        self.assertFalse(db_path.exists())

    def test_query_service_remains_sql_unaware(self) -> None:
        root = pathlib.Path(__file__).resolve().parents[1]
        query_text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (root / "src" / "query").glob("*.py")
        ).lower()
        self.assertNotIn("sqlite", query_text)
        self.assertNotIn("select ", query_text)
        self.assertNotIn("insert ", query_text)
        self.assertNotIn("src.store", query_text)


if __name__ == "__main__":
    unittest.main()
