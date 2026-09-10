from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from decimal import Decimal
from pathlib import Path

from src.contracts import CostKind, PriceDimension, Token
from src.store import (
    SCHEMA_VERSION,
    SQLiteCanonicalStore,
    StoreConflictError,
    StoreDataError,
    UnsupportedSchemaVersion,
    WriteResult,
)

from tests.fixtures.store_fixtures import (
    PROVIDER_ID,
    T1,
    T2,
    balance,
    cost,
    price,
    provider,
    token,
    usage,
)


class TemporaryStoreCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "canonical.sqlite3"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def open_store(self) -> SQLiteCanonicalStore:
        return SQLiteCanonicalStore(self.db_path)


class TestSchemaLifecycle(TemporaryStoreCase):
    def test_create_and_reopen_v1_database(self) -> None:
        with self.open_store() as store:
            store.put_provider(provider())
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            version = connection.execute(
                "SELECT value FROM schema_metadata WHERE key='schema_version'"
            ).fetchone()[0]
        self.assertEqual(version, str(SCHEMA_VERSION))
        with self.open_store() as reopened:
            self.assertEqual(reopened.load_providers(), (provider(),))

    def test_unsupported_schema_version_fails_closed(self) -> None:
        with self.open_store():
            pass
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(
                "UPDATE schema_metadata SET value='99' WHERE key='schema_version'"
            )
        with self.assertRaises(UnsupportedSchemaVersion):
            self.open_store()


class TestStableIdentityPersistence(TemporaryStoreCase):
    def test_provider_round_trip_duplicate_and_conflict(self) -> None:
        record = provider()
        with self.open_store() as store:
            self.assertEqual(store.put_provider(record), WriteResult.INSERTED)
            self.assertEqual(store.put_provider(record), WriteResult.IDEMPOTENT)
            with self.assertRaises(StoreConflictError):
                store.put_provider(provider(display_name="Conflicting Provider"))
            self.assertEqual(store.load_providers(), (record,))

    def test_token_round_trip_duplicate_and_conflict(self) -> None:
        record = token()
        with self.open_store() as store:
            self.assertEqual(store.put_token(record), WriteResult.INSERTED)
            self.assertEqual(store.put_token(record), WriteResult.IDEMPOTENT)
            with self.assertRaises(StoreConflictError):
                store.put_token(token(label="Conflicting Token"))
            self.assertEqual(store.load_tokens(), (record,))
            self.assertEqual(store.load_tokens()[0].secret_ref, record.secret_ref)
            self.assertEqual(store.load_tokens()[0].masked_identifier, record.masked_identifier)

    def test_raw_secret_shaped_token_never_reaches_sqlite(self) -> None:
        synthetic_raw = "sk-" + "a" * 24
        with self.assertRaises(ValueError):
            Token(
                id="unsafe-token",
                provider_id=PROVIDER_ID,
                label="unsafe",
                status=token().status,
                masked_identifier=synthetic_raw,
                source=token().source,
            )
        safe = token()
        with self.open_store() as store:
            store.put_token(safe)
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            serialized = "|".join(
                "" if value is None else str(value)
                for value in connection.execute("SELECT * FROM tokens").fetchone()
            )
        self.assertNotIn(synthetic_raw, serialized)
        self.assertIn(safe.masked_identifier, serialized)
        self.assertIn(safe.secret_ref, serialized)


class TestEventPersistence(TemporaryStoreCase):
    def test_balance_history_duplicate_and_same_time_conflict(self) -> None:
        old = balance("10.00", T1)
        latest = balance("8.50", T2)
        conflict = balance("9.50", T2)
        with self.open_store() as store:
            self.assertEqual(store.append_balance(old), WriteResult.INSERTED)
            self.assertEqual(store.append_balance(latest), WriteResult.INSERTED)
            self.assertEqual(store.append_balance(latest), WriteResult.IDEMPOTENT)
            self.assertEqual(store.append_balance(conflict), WriteResult.INSERTED)
            loaded = store.load_balances()
        self.assertEqual(len(loaded), 3)
        self.assertIn(old, loaded)
        self.assertIn(latest, loaded)
        self.assertIn(conflict, loaded)

    def test_usage_round_trip_preserves_all_token_counts(self) -> None:
        record = usage()
        with self.open_store() as store:
            store.append_usage(record)
            self.assertEqual(store.append_usage(record), WriteResult.IDEMPOTENT)
            loaded = store.load_usage()
        self.assertEqual(loaded, (record,))
        self.assertEqual(loaded[0].total_tokens, 1750)

    def test_pricing_dimensions_decimal_and_conflict_round_trip(self) -> None:
        records = (
            price(PriceDimension.INPUT, "0.123456789"),
            price(PriceDimension.OUTPUT, "0.987654321"),
            price(PriceDimension.CACHE_READ, "0.000000123"),
        )
        conflict = price(PriceDimension.INPUT, "0.222222222")
        with self.open_store() as store:
            for record in records:
                store.append_pricing(record)
            self.assertEqual(store.append_pricing(records[0]), WriteResult.IDEMPOTENT)
            store.append_pricing(conflict)
            loaded = store.load_pricing()
        self.assertEqual(len(loaded), 4)
        self.assertEqual(
            {item.price_dimension for item in loaded},
            {PriceDimension.INPUT, PriceDimension.OUTPUT, PriceDimension.CACHE_READ},
        )
        self.assertIn(Decimal("0.123456789"), {item.price_per_unit for item in loaded})
        self.assertIn(conflict, loaded)

    def test_actual_and_estimated_cost_decimal_round_trip(self) -> None:
        actual = cost(CostKind.ACTUAL, "0.123456789")
        estimated = cost(CostKind.ESTIMATED, "0.000987654321")
        with self.open_store() as store:
            store.append_cost(actual)
            store.append_cost(estimated)
            self.assertEqual(store.append_cost(actual), WriteResult.IDEMPOTENT)
            loaded = store.load_costs()
        self.assertEqual(loaded, (actual, estimated))
        self.assertEqual({item.kind for item in loaded}, {CostKind.ACTUAL, CostKind.ESTIMATED})
        self.assertEqual(loaded[0].amount, Decimal("0.123456789"))

    def test_source_tag_round_trip_preserves_reference_and_time(self) -> None:
        record = balance("1.25", T1)
        with self.open_store() as store:
            store.append_balance(record)
            loaded = store.load_balances()[0]
        self.assertEqual(loaded.source, record.source)
        self.assertEqual(loaded.source.source_reference, record.source.source_reference)
        self.assertEqual(loaded.source.captured_at, record.source.captured_at)


class TestInvalidPersistedRows(TemporaryStoreCase):
    def _mutate_and_load(self, sql: str, loader: str) -> None:
        with closing(sqlite3.connect(self.db_path)) as connection, connection:
            connection.execute(sql)
        with self.open_store() as store:
            with self.assertRaises(StoreDataError):
                getattr(store, loader)()

    def test_invalid_enum_fails_closed(self) -> None:
        with self.open_store() as store:
            store.put_provider(provider())
        self._mutate_and_load(
            "UPDATE providers SET category='not-a-category'",
            "load_providers",
        )

    def test_invalid_decimal_fails_closed(self) -> None:
        with self.open_store() as store:
            store.append_balance(balance("1.00", T1))
        self._mutate_and_load(
            "UPDATE balances SET value_text='not-a-decimal'",
            "load_balances",
        )

    def test_invalid_datetime_fails_closed(self) -> None:
        with self.open_store() as store:
            store.append_usage(usage())
        self._mutate_and_load(
            "UPDATE usages SET observed_at='not-a-datetime'",
            "load_usage",
        )

    def test_invalid_source_tag_fails_closed(self) -> None:
        with self.open_store() as store:
            store.append_cost(cost(CostKind.ACTUAL, "1.00"))
        self._mutate_and_load(
            "UPDATE costs SET source_type='not-a-source-type'",
            "load_costs",
        )


if __name__ == "__main__":
    unittest.main()
