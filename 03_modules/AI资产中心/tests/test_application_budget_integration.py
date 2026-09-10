from __future__ import annotations

import ast
import hashlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from src.application import AIAssetReadService
from src.budget import SQLiteBudgetPolicyStore
from src.consumption import to_json_safe
from src.store import SQLiteCanonicalStore
from tests.fixtures.application_fixtures import (
    DISABLED_POLICY_ID,
    ENABLED_POLICY_ID,
    populate_application_database,
)
from tests.fixtures.budget_fixtures import EVALUATED_AT


class TestApplicationBudgetIntegration(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "budget-application.sqlite3"
        populate_application_database(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_only_enabled_policy_is_evaluated_into_existing_budget_view(self) -> None:
        results = AIAssetReadService(self.db_path).evaluate_budgets(
            evaluated_at=EVALUATED_AT
        )
        self.assertEqual(tuple(item.data.policy_id for item in results), (ENABLED_POLICY_ID,))
        self.assertNotIn(DISABLED_POLICY_ID, {item.data.policy_id for item in results})
        payload = to_json_safe(results[0])
        self.assertEqual(payload["schema_version"], "0.1")
        self.assertIsInstance(payload["data"]["evaluated_used"], str)
        self.assertIn("T", payload["data"]["period_start"])
        self.assertIn("+00:00", payload["data"]["period_start"])

    def test_budget_read_single_loads_assets_and_enabled_policies(self) -> None:
        canonical_original = SQLiteCanonicalStore.load_collections
        policy_original = SQLiteBudgetPolicyStore.list_enabled_budget_policies
        with patch.object(
            SQLiteCanonicalStore,
            "load_collections",
            autospec=True,
            side_effect=lambda store: canonical_original(store),
        ) as canonical_load, patch.object(
            SQLiteBudgetPolicyStore,
            "list_enabled_budget_policies",
            autospec=True,
            side_effect=lambda store, scope=None: policy_original(store, scope),
        ) as policy_load:
            AIAssetReadService(self.db_path).evaluate_budgets(evaluated_at=EVALUATED_AT)
        self.assertEqual(canonical_load.call_count, 1)
        self.assertEqual(policy_load.call_count, 1)

    def test_evaluation_is_not_persisted_and_database_is_unchanged(self) -> None:
        before = hashlib.sha256(self.db_path.read_bytes()).hexdigest()
        AIAssetReadService(self.db_path).evaluate_budgets(evaluated_at=EVALUATED_AT)
        after = hashlib.sha256(self.db_path.read_bytes()).hexdigest()
        self.assertEqual(after, before)
        with closing(sqlite3.connect(self.db_path)) as connection:
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
        self.assertFalse(any("evaluation" in table for table in tables))

    def test_application_source_has_no_sql_network_credentials_or_business_duplication(self) -> None:
        path = Path(__file__).parents[1] / "src" / "application" / "read_service.py"
        source = path.read_text(encoding="utf-8")
        lowered = source.lower()
        tree = ast.parse(source)
        imported = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        self.assertNotIn("sqlite3", imported)
        for forbidden in (
            "select ", "insert ", "update ", "delete ", "create table",
            "requests", "urllib", "socket", "subprocess", "os.environ", "getenv(",
            "credential_store", "provider_api", "calculate_derived_cost",
            "warning_ratio", "critical_ratio", "to_json_safe", "to_canonical_json",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, lowered)
        arithmetic_ops = (
            ast.Add,
            ast.Sub,
            ast.Mult,
            ast.Div,
            ast.FloorDiv,
            ast.Mod,
            ast.Pow,
        )
        self.assertFalse(
            any(
                isinstance(node, ast.BinOp) and isinstance(node.op, arithmetic_ops)
                for node in ast.walk(tree)
            )
        )


if __name__ == "__main__":
    unittest.main()
