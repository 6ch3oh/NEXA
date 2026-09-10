from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from dataclasses import replace
from pathlib import Path

from src.budget import BudgetCostBasis, BudgetScope, SQLiteBudgetPolicyStore
from src.contracts import SourceTag, SourceType
from src.store import StoreConflictError, StoreDataError, WriteResult
from tests.fixtures.budget_fixtures import FEB_1, policy


class BudgetStoreCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "budget.sqlite3"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_round_trip_preserves_every_policy_field_exactly(self) -> None:
        records = (
            policy(
                BudgetScope.PORTFOLIO,
                policy_id="policy-a",
                currency="CNY",
                cost_basis=BudgetCostBasis.ESTIMATED_ONLY,
            ),
            policy(BudgetScope.PROVIDER, policy_id="policy-b", enabled=False),
            policy(
                BudgetScope.TOKEN,
                policy_id="policy-c",
                model="model-a",
                cost_basis=BudgetCostBasis.ACTUAL_PLUS_ESTIMATED,
            ),
        )
        with SQLiteBudgetPolicyStore(self.db_path) as store:
            for record in records:
                self.assertEqual(store.put_budget_policy(record), WriteResult.INSERTED)
            self.assertEqual(store.load_budget_policies(), records)
            self.assertEqual(store.get_budget_policy("policy-c"), records[2])
            self.assertIsNone(store.get_budget_policy("missing"))

    def test_duplicate_is_idempotent_and_same_id_different_content_conflicts(self) -> None:
        record = policy(policy_id="stable-policy")
        with SQLiteBudgetPolicyStore(self.db_path) as store:
            self.assertEqual(store.put_budget_policy(record), WriteResult.INSERTED)
            self.assertEqual(store.put_budget_policy(record), WriteResult.IDEMPOTENT)
            with self.assertRaises(StoreConflictError):
                store.put_budget_policy(replace(record, label="different"))

    def test_missing_policy_id_is_rejected_by_domain_contract(self) -> None:
        with self.assertRaises(ValueError):
            replace(policy(), policy_id="")

    def test_enabled_listing_and_optional_scope_filter_are_deterministic(self) -> None:
        records = (
            policy(BudgetScope.PROVIDER, policy_id="b-enabled"),
            policy(BudgetScope.PORTFOLIO, policy_id="a-enabled"),
            policy(BudgetScope.PROVIDER, policy_id="c-disabled", enabled=False),
        )
        with SQLiteBudgetPolicyStore(self.db_path) as store:
            for record in records:
                store.put_budget_policy(record)
            self.assertEqual(
                tuple(item.policy_id for item in store.list_enabled_budget_policies()),
                ("a-enabled", "b-enabled"),
            )
            self.assertEqual(
                tuple(
                    item.policy_id
                    for item in store.load_budget_policies(BudgetScope.PROVIDER)
                ),
                ("b-enabled", "c-disabled"),
            )
            with self.assertRaises(TypeError):
                store.load_budget_policies("provider")  # type: ignore[arg-type]

    def test_invalid_persisted_enum_decimal_and_datetime_fail_closed(self) -> None:
        mutations = (
            "UPDATE budget_policies SET scope='invalid'",
            "UPDATE budget_policies SET limit_amount_text='NaN'",
            "UPDATE budget_policies SET created_at='not-a-datetime'",
        )
        for index, mutation in enumerate(mutations):
            with self.subTest(mutation=mutation):
                db_path = Path(self.temp_dir.name) / f"invalid-{index}.sqlite3"
                with SQLiteBudgetPolicyStore(db_path) as store:
                    store.put_budget_policy(policy())
                with closing(sqlite3.connect(db_path)) as connection, connection:
                    connection.execute(mutation)
                with SQLiteBudgetPolicyStore(db_path) as store:
                    with self.assertRaises(StoreDataError):
                        store.load_budget_policies()

    def test_credential_shaped_source_reference_never_reaches_sqlite(self) -> None:
        synthetic_raw = "sk-" + "s" * 24
        unsafe = replace(
            policy(),
            source=SourceTag(SourceType.MANUAL, synthetic_raw, FEB_1),
        )
        with SQLiteBudgetPolicyStore(self.db_path) as store:
            with self.assertRaises(StoreDataError):
                store.put_budget_policy(unsafe)
        with closing(sqlite3.connect(self.db_path)) as connection:
            rows = connection.execute(
                "SELECT source_reference FROM budget_policies"
            ).fetchall()
        self.assertEqual(rows, [])

    def test_v2_has_no_budget_evaluation_history_table(self) -> None:
        with SQLiteBudgetPolicyStore(self.db_path):
            pass
        with closing(sqlite3.connect(self.db_path)) as connection:
            names = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
        self.assertFalse(any("evaluation" in name for name in names))


if __name__ == "__main__":
    unittest.main()
