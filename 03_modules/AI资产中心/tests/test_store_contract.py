from __future__ import annotations

import unittest

from src.store import CanonicalCollections, CanonicalStore, SQLiteCanonicalStore, WriteResult

from tests.fixtures.store_fixtures import complete_fixture


class TestCanonicalStoreContract(unittest.TestCase):
    def test_sqlite_store_implements_contract(self) -> None:
        self.assertTrue(issubclass(SQLiteCanonicalStore, CanonicalStore))

    def test_write_result_has_explicit_idempotency(self) -> None:
        self.assertEqual(WriteResult.INSERTED.value, "inserted")
        self.assertEqual(WriteResult.IDEMPOTENT.value, "idempotent")

    def test_collections_bridge_is_query_service_shaped(self) -> None:
        fixture = complete_fixture()
        collections = CanonicalCollections(
            providers=fixture.providers,
            tokens=fixture.tokens,
            balances=fixture.balances,
            usages=fixture.usages,
            pricing=fixture.pricing,
            costs=fixture.costs,
        )
        kwargs = collections.as_query_kwargs()
        self.assertEqual(
            set(kwargs),
            {"providers", "tokens", "balances", "usages", "pricing", "costs",
             "pricing_authorities", "entitlements"},
        )
        self.assertIs(kwargs["providers"], collections.providers)


if __name__ == "__main__":
    unittest.main()
