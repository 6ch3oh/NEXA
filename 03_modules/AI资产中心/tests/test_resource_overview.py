from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from src.analytics import Period
from src.application import AIAssetReadService
from src.consumption import to_canonical_json, to_json_safe
from tests.fixtures.analytics_fixtures import FEB_1, MAR_1
from tests.fixtures.application_fixtures import populate_application_database
from tests.fixtures.budget_fixtures import EVALUATED_AT


class ResourceOverviewCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "overview.sqlite3"
        populate_application_database(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def view(self, path=None):
        return AIAssetReadService(path or self.path).get_resource_overview(
            Period(FEB_1, MAR_1), generated_at=EVALUATED_AT, as_of=EVALUATED_AT
        )

    def test_overview_contains_required_resource_consumption_facts(self):
        view = self.view()
        self.assertEqual(view.schema_version, "0.1")
        self.assertGreater(view.data.total_tokens, 0)
        self.assertTrue(view.data.actual_cost_by_currency)
        self.assertTrue(view.data.estimated_cost_by_currency)
        self.assertTrue(view.data.intelligence.model_token_ranking)
        self.assertTrue(view.data.intelligence.model_actual_cost_ranking)
        self.assertTrue(view.data.intelligence.task_token_ranking)
        self.assertTrue(view.data.intelligence.project_token_ranking)
        self.assertTrue(view.data.budgets)
        self.assertTrue(view.data.compact_balance_health)
        self.assertGreaterEqual(view.data.intelligence.coverage.unattributed_ratio, 0)

    def test_balance_is_compact_and_payload_is_json_safe(self):
        payload = to_json_safe(self.view())
        balance = payload["data"]["compact_balance_health"][0]
        self.assertEqual(set(balance), {"provider_id", "health", "observed_at"})
        self.assertNotIn("secret_ref", to_canonical_json(self.view()).lower())

    def test_read_is_deterministic_and_database_unchanged(self):
        before = self.path.read_bytes()
        first = to_canonical_json(self.view())
        second = to_canonical_json(self.view())
        self.assertEqual(first, second)
        self.assertEqual(before, self.path.read_bytes())

    def test_reverse_insertion_has_same_logical_overview(self):
        reverse = Path(self.temp.name) / "reverse.sqlite3"
        populate_application_database(reverse, reverse=True)
        self.assertEqual(to_canonical_json(self.view()), to_canonical_json(self.view(reverse)))

    def test_application_overview_loads_canonical_collections_once(self):
        statements = []
        connection = sqlite3.connect(self.path)
        connection.close()
        # Existing read-service boundary test covers SQL ownership. This asserts
        # the overview method delegates instead of opening a second query path.
        source = (Path(__file__).parents[1] / "src" / "application" / "read_service.py").read_text()
        method = source.split("def get_resource_overview", 1)[1].split("def _load_query", 1)[0]
        self.assertEqual(method.count("self._load_query()"), 1)
        self.assertNotIn("SELECT ", method)


if __name__ == "__main__":
    unittest.main()
