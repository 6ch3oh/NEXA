from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from src.store import (
    SCHEMA_VERSION,
    SQLiteCanonicalStore,
    StoreDataError,
    UnsupportedSchemaVersion,
    WriteResult,
)
from tests.fixtures.store_fixtures import complete_fixture
from tests.test_public_authority_contract import authority


class MigrationCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "migration.sqlite3"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _create_v1_with_data(self) -> None:
        fixture = complete_fixture()
        with SQLiteCanonicalStore(self.db_path) as store:
            for item in fixture.providers:
                store.put_provider(item)
            for item in fixture.tokens:
                store.put_token(item)
            for item in fixture.balances:
                store.append_balance(item)
            for item in fixture.usages:
                store.append_usage(item)
            for item in fixture.pricing:
                store.append_pricing(item)
            for item in fixture.costs:
                store.append_cost(item)
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute("DROP TABLE budget_policies")
            connection.execute("DROP TABLE pricing_authorities")
            connection.execute("DROP TABLE entitlements")
            connection.execute("ALTER TABLE usages RENAME TO usages_v3")
            connection.execute(
                "CREATE TABLE usages (record_fingerprint TEXT PRIMARY KEY, "
                "usage_id TEXT NOT NULL, provider_id TEXT NOT NULL, token_id TEXT, model TEXT, "
                "input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, "
                "cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, "
                "total_tokens INTEGER NOT NULL, observed_at TEXT NOT NULL, source_type TEXT NOT NULL, "
                "source_reference TEXT, source_captured_at TEXT NOT NULL)"
            )
            connection.execute(
                "INSERT INTO usages SELECT record_fingerprint, usage_id, provider_id, token_id, model, "
                "input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, "
                "observed_at, source_type, source_reference, source_captured_at FROM usages_v3"
            )
            connection.execute("DROP TABLE usages_v3")
            connection.execute("ALTER TABLE costs RENAME TO costs_v3")
            connection.execute(
                "CREATE TABLE costs (record_fingerprint TEXT PRIMARY KEY, provider_id TEXT NOT NULL, "
                "token_id TEXT, model TEXT, amount_text TEXT NOT NULL, currency TEXT NOT NULL, "
                "occurred_at TEXT NOT NULL, cost_basis TEXT NOT NULL, kind TEXT NOT NULL, "
                "source_type TEXT NOT NULL, source_reference TEXT, source_captured_at TEXT NOT NULL)"
            )
            connection.execute(
                "INSERT INTO costs SELECT record_fingerprint, provider_id, token_id, model, amount_text, "
                "currency, occurred_at, cost_basis, kind, source_type, source_reference, "
                "source_captured_at FROM costs_v3"
            )
            connection.execute("DROP TABLE costs_v3")
            connection.execute(
                "UPDATE schema_metadata SET value='1' WHERE key='schema_version'"
            )

    def _schema_version(self) -> str:
        with closing(sqlite3.connect(self.db_path)) as connection:
            return connection.execute(
                "SELECT value FROM schema_metadata WHERE key='schema_version'"
            ).fetchone()[0]

    def _create_v2_with_data(self) -> None:
        self._create_v1_with_data()
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute("CREATE TABLE budget_policies (policy_id TEXT PRIMARY KEY)")
            connection.execute(
                "UPDATE schema_metadata SET value='2' WHERE key='schema_version'"
            )

    def _create_v3_with_authority(self):
        record = authority()
        with SQLiteCanonicalStore(self.db_path) as store:
            for component in record.components:
                store.append_pricing(component)
            store.append_pricing_authority(record)
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute("ALTER TABLE pricing_authorities RENAME TO pricing_authorities_v4")
            connection.execute(
                "CREATE TABLE pricing_authorities ("
                "record_fingerprint TEXT PRIMARY KEY, authority_id TEXT NOT NULL, "
                "provider_id TEXT NOT NULL, model TEXT NOT NULL, billing_mode TEXT NOT NULL, "
                "effective_from TEXT NOT NULL, component_fingerprints_json TEXT NOT NULL, "
                "authority_source_type TEXT NOT NULL, official_source TEXT, fetched_at TEXT, "
                "last_verified_at TEXT, freshness_valid_seconds INTEGER, source_type TEXT NOT NULL, "
                "source_reference TEXT, source_captured_at TEXT NOT NULL)"
            )
            connection.execute(
                "INSERT INTO pricing_authorities SELECT record_fingerprint, authority_id, "
                "provider_id, model, billing_mode, effective_from, component_fingerprints_json, "
                "authority_source_type, official_source, fetched_at, last_verified_at, "
                "freshness_valid_seconds, source_type, source_reference, source_captured_at "
                "FROM pricing_authorities_v4"
            )
            connection.execute("DROP TABLE pricing_authorities_v4")
            connection.execute(
                "UPDATE schema_metadata SET value='3' WHERE key='schema_version'"
            )
        return record

    def test_fresh_database_is_created_directly_as_v4(self) -> None:
        with SQLiteCanonicalStore(self.db_path):
            pass
        self.assertEqual(SCHEMA_VERSION, 4)
        self.assertEqual(self._schema_version(), "4")
        with closing(sqlite3.connect(self.db_path)) as connection:
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
        self.assertIn("budget_policies", tables)
        self.assertIn("pricing_authorities", tables)
        self.assertIn("entitlements", tables)

    def test_v1_migrates_once_and_preserves_all_canonical_data(self) -> None:
        self._create_v1_with_data()
        expected = complete_fixture()
        with SQLiteCanonicalStore(self.db_path) as store:
            actual = store.load_collections()
        self.assertEqual(self._schema_version(), "4")

    def test_v2_migrates_to_v4_and_preserves_canonical_data(self) -> None:
        self._create_v2_with_data()
        expected = complete_fixture()
        with SQLiteCanonicalStore(self.db_path) as store:
            actual = store.load_collections()
            self.assertEqual(store.append_usage(expected.usages[0]), WriteResult.IDEMPOTENT)
        self.assertEqual(self._schema_version(), "4")
        self.assertEqual(actual.usages, expected.usages)
        self.assertEqual(actual.costs, expected.costs)
        self.assertEqual(actual.providers, expected.providers)
        self.assertEqual(actual.tokens, expected.tokens)
        self.assertEqual(actual.balances, expected.balances)
        self.assertEqual(actual.usages, expected.usages)
        self.assertCountEqual(actual.pricing, expected.pricing)
        self.assertEqual(actual.costs, expected.costs)
        with SQLiteCanonicalStore(self.db_path) as store:
            self.assertEqual(store.append_usage(expected.usages[0]), WriteResult.IDEMPOTENT)
            self.assertEqual(store.append_cost(expected.costs[0]), WriteResult.IDEMPOTENT)
        with SQLiteCanonicalStore(self.db_path):
            pass
        self.assertEqual(self._schema_version(), "4")

    def test_v3_migrates_to_v4_and_preserves_flat_authority(self) -> None:
        expected = self._create_v3_with_authority()
        with SQLiteCanonicalStore(self.db_path) as store:
            actual = store.load_pricing_authorities()
        self.assertEqual(self._schema_version(), "4")
        self.assertEqual(actual, (expected,))
        with closing(sqlite3.connect(self.db_path)) as connection:
            columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(pricing_authorities)")
            }
        self.assertTrue({"effective_to", "pricing_tier", "time_rule_json"} <= columns)

    def test_migration_failure_rolls_back_version_and_preserves_v1_data(self) -> None:
        self._create_v1_with_data()
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(
                "CREATE VIEW budget_policies AS SELECT 'collision' AS policy_id"
            )
        with self.assertRaises(StoreDataError):
            SQLiteCanonicalStore(self.db_path)
        self.assertEqual(self._schema_version(), "1")
        with closing(sqlite3.connect(self.db_path)) as connection:
            count = connection.execute("SELECT COUNT(*) FROM providers").fetchone()[0]
            object_type = connection.execute(
                "SELECT type FROM sqlite_master WHERE name='budget_policies'"
            ).fetchone()[0]
        self.assertEqual(count, len(complete_fixture().providers))
        self.assertEqual(object_type, "view")

    def test_v3_stage_failure_rolls_back_entire_v1_to_v4_transaction(self) -> None:
        self._create_v1_with_data()
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(
                "CREATE VIEW pricing_authorities AS SELECT 'collision' AS authority_id"
            )
        with self.assertRaises(StoreDataError):
            SQLiteCanonicalStore(self.db_path)
        self.assertEqual(self._schema_version(), "1")
        with closing(sqlite3.connect(self.db_path)) as connection:
            budget = connection.execute(
                "SELECT type FROM sqlite_master WHERE name='budget_policies'"
            ).fetchone()
            count = connection.execute("SELECT COUNT(*) FROM usages").fetchone()[0]
        self.assertIsNone(budget)
        self.assertEqual(count, len(complete_fixture().usages))

    def test_v2_to_v4_failure_rolls_back_schema_and_version(self) -> None:
        self._create_v2_with_data()
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(
                "CREATE VIEW pricing_authorities AS SELECT 'collision' AS authority_id"
            )
        with self.assertRaises(StoreDataError):
            SQLiteCanonicalStore(self.db_path)
        self.assertEqual(self._schema_version(), "2")
        with closing(sqlite3.connect(self.db_path)) as connection:
            usage_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(usages)")
            }
        self.assertNotIn("attribution_status", usage_columns)

    def test_unknown_v5_fails_closed(self) -> None:
        with SQLiteCanonicalStore(self.db_path):
            pass
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(
                "UPDATE schema_metadata SET value='5' WHERE key='schema_version'"
            )
        with self.assertRaises(UnsupportedSchemaVersion):
            SQLiteCanonicalStore(self.db_path)

    def test_invalid_metadata_and_incomplete_v1_fail_closed(self) -> None:
        with SQLiteCanonicalStore(self.db_path):
            pass
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(
                "UPDATE schema_metadata SET value='not-an-integer' "
                "WHERE key='schema_version'"
            )
        with self.assertRaises(StoreDataError):
            SQLiteCanonicalStore(self.db_path)

    def test_missing_schema_metadata_fails_closed(self) -> None:
        with SQLiteCanonicalStore(self.db_path):
            pass
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(
                "DELETE FROM schema_metadata WHERE key='schema_version'"
            )
        with self.assertRaises(StoreDataError):
            SQLiteCanonicalStore(self.db_path)

    def test_incomplete_v1_fails_closed_without_attempting_migration(self) -> None:
        self._create_v1_with_data()
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute("DROP TABLE tokens")
        with self.assertRaises(StoreDataError):
            SQLiteCanonicalStore(self.db_path)
        self.assertEqual(self._schema_version(), "1")


if __name__ == "__main__":
    unittest.main()
