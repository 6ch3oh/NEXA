from __future__ import annotations

import ast
import sqlite3
import tempfile
import unittest
from contextlib import closing
from decimal import Decimal
from pathlib import Path

from src.budget import (
    BudgetCostBasis,
    SQLiteBudgetPolicyStore,
    evaluate_budget_from_query,
)
from src.consumption import build_budget_consumption_view
from src.consumption.models import AI_ASSET_CONSUMPTION_SCHEMA_VERSION
from src.contracts import CostKind
from src.query import QueryService
from src.store import SQLiteCanonicalStore
from tests.fixtures.analytics_fixtures import FEB_2, FEB_15, cost
from tests.fixtures.budget_fixtures import EVALUATED_AT, policy


class TestBudgetStoreEvaluatorIntegration(unittest.TestCase):
    def test_loaded_policy_uses_existing_query_rollup_and_evaluator_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "integration.sqlite3"
            expected_policy = policy(
                policy_id="persisted-policy",
                limit_amount=Decimal("100"),
                cost_basis=BudgetCostBasis.ACTUAL_PLUS_ESTIMATED,
            )
            with SQLiteCanonicalStore(db_path) as canonical_store:
                canonical_store.append_cost(cost("30", FEB_2, CostKind.ACTUAL))
                canonical_store.append_cost(cost("20", FEB_15, CostKind.ESTIMATED))
            with SQLiteBudgetPolicyStore(db_path) as policy_store:
                policy_store.put_budget_policy(expected_policy)
            with SQLiteBudgetPolicyStore(db_path) as policy_store:
                loaded_policy = policy_store.get_budget_policy("persisted-policy")
            with SQLiteCanonicalStore(db_path) as canonical_store:
                query = QueryService(costs=canonical_store.load_costs())

            result = evaluate_budget_from_query(
                query, loaded_policy, evaluated_at=EVALUATED_AT
            )
            self.assertEqual(result.evaluated_used, Decimal("50"))
            self.assertIs(result.provenance.cost_basis, BudgetCostBasis.ACTUAL_PLUS_ESTIMATED)
            view = build_budget_consumption_view(result)
            self.assertEqual(view.schema_version, AI_ASSET_CONSUMPTION_SCHEMA_VERSION)
            self.assertEqual(view.schema_version, "0.1")

            with closing(sqlite3.connect(db_path)) as connection:
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
            self.assertFalse(any("evaluation" in name for name in tables))

    def test_store_adapter_does_not_import_or_call_evaluator(self) -> None:
        source_path = Path(__file__).parents[1] / "src" / "budget" / "store.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        imported_modules = {
            node.module
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module is not None
        }
        called_names = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        self.assertFalse(any("evaluator" in module for module in imported_modules))
        self.assertNotIn("evaluate_budget", called_names)
        self.assertNotIn("evaluate_budget_from_query", called_names)


if __name__ == "__main__":
    unittest.main()
