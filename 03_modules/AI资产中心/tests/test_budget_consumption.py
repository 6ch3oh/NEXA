from __future__ import annotations

import pathlib
import unittest

from src.budget import (
    BudgetCostBasis,
    BudgetReasonCode,
    evaluate_budget_from_query,
)
from src.consumption import (
    AI_ASSET_CONSUMPTION_SCHEMA_VERSION,
    build_budget_consumption_view,
    to_canonical_json,
    to_json_safe,
)
from src.query import QueryService
from tests.fixtures.budget_fixtures import EVALUATED_AT, cost_query, policy


class TestBudgetConsumptionView(unittest.TestCase):
    def test_view_is_schema_01_json_safe_and_preserves_basis(self) -> None:
        result = evaluate_budget_from_query(
            cost_query(actual=("30.123456789",), estimated=("20.000000001",)),
            policy(cost_basis=BudgetCostBasis.ACTUAL_PLUS_ESTIMATED),
            evaluated_at=EVALUATED_AT,
        )
        view = build_budget_consumption_view(result)
        payload = to_json_safe(view)
        self.assertEqual(view.schema_version, AI_ASSET_CONSUMPTION_SCHEMA_VERSION)
        self.assertEqual(payload["schema_version"], "0.1")
        self.assertEqual(payload["data"]["actual_used"], "30.123456789")
        self.assertEqual(payload["data"]["estimated_used"], "20.000000001")
        self.assertEqual(payload["data"]["evaluated_used"], "50.123456790")
        self.assertEqual(payload["data"]["provenance"]["source_type"], "derived_calculated")
        self.assertEqual(payload["data"]["provenance"]["cost_basis"],
                         "actual_plus_estimated")
        self.assertTrue(payload["data"]["provenance"]["mixed_cost_basis"])

    def test_missing_is_null_and_observed_zero_is_string_zero(self) -> None:
        missing = build_budget_consumption_view(
            evaluate_budget_from_query(QueryService(), policy(), evaluated_at=EVALUATED_AT)
        )
        zero = build_budget_consumption_view(
            evaluate_budget_from_query(cost_query(actual=("0",)), policy(),
                                       evaluated_at=EVALUATED_AT)
        )
        missing_payload, zero_payload = to_json_safe(missing), to_json_safe(zero)
        self.assertIsNone(missing_payload["data"]["evaluated_used"])
        self.assertEqual(zero_payload["data"]["evaluated_used"], "0")

    def test_reasons_are_deterministic_and_secret_safe(self) -> None:
        view = build_budget_consumption_view(
            evaluate_budget_from_query(QueryService(), policy(), evaluated_at=EVALUATED_AT)
        )
        self.assertEqual(view.warnings, tuple(sorted(view.warnings, key=lambda item: item.value)))
        self.assertIn(BudgetReasonCode.COST_DATA_MISSING, view.warnings)
        serialized = to_canonical_json(view)
        for fragment in ("secret_ref", "vault://", "authorization", "cookie", "api_key"):
            self.assertNotIn(fragment, serialized.lower())
        self.assertEqual(serialized, to_canonical_json(view))

    def test_budget_and_consumption_sources_have_no_forbidden_capabilities(self) -> None:
        root = pathlib.Path(__file__).resolve().parents[1] / "src"
        paths = [
            root / "budget" / "models.py",
            root / "budget" / "evaluator.py",
            root / "consumption" / "budget_view.py",
        ]
        source_text = "\n".join(path.read_text(encoding="utf-8") for path in paths).lower()
        for fragment in (
            "sqlite", "select ", "insert ", "src.store", "open(", "requests",
            "urllib", "socket", "subprocess", "os.environ", "getenv(",
            "credential_store", "send_email", "slack", "telegram", "scheduler",
            "disable_provider", "disable_token", "calculate_derived_cost",
        ):
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, source_text)


if __name__ == "__main__":
    unittest.main()
