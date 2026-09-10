from __future__ import annotations

import ast
import inspect
import tempfile
import unittest
from pathlib import Path

import src.application.intake_service as intake_module
from src.analytics import Period, rollup_costs, rollup_usage, summarize_provider
from src.application import AIAssetReadService, CanonicalIntakeService
from src.consumption import AI_ASSET_CONSUMPTION_SCHEMA_VERSION
from src.contracts import CostKind, PriceDimension
from src.query import LookupStatus, QueryService
from src.store import SCHEMA_VERSION, SQLiteCanonicalStore
from tests.fixtures.intake_fixtures import (
    FEB_1,
    JAN_1,
    JAN_2,
    MODEL,
    PROVIDER_A,
    TOKEN_A,
    balance,
    cost,
    pricing,
    provider,
    token,
    usage,
)


class IntakeEndToEndCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "intake-e2e.sqlite3"
        self.intake = CanonicalIntakeService(self.database_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def populate(self) -> None:
        self.intake.ingest_provider(provider())
        self.intake.ingest_token(token())
        self.intake.ingest_balance(balance(token_id=None))
        self.intake.ingest_usage(usage())
        self.intake.ingest_pricing(pricing(PriceDimension.INPUT, "0.40"))
        self.intake.ingest_pricing(pricing(PriceDimension.OUTPUT, "0.80"))
        self.intake.ingest_pricing(pricing(PriceDimension.CACHE_READ, "0.04"))
        self.intake.ingest_cost(cost(CostKind.ACTUAL))
        self.intake.ingest_cost(cost(CostKind.ESTIMATED))

    def reopened_query(self) -> QueryService:
        with SQLiteCanonicalStore(self.database_path) as store:
            collections = store.load_collections()
        return QueryService(**collections.as_query_kwargs())

    def test_reopen_query_sees_every_intake_record_type(self) -> None:
        self.populate()
        query = self.reopened_query()
        self.assertEqual(query.get_provider(PROVIDER_A).id, PROVIDER_A)
        self.assertEqual(query.list_tokens(PROVIDER_A)[0].id, TOKEN_A)
        self.assertIs(query.latest_balance(PROVIDER_A).status, LookupStatus.FOUND)
        self.assertEqual(query.list_usage(PROVIDER_A)[0].usage_id, "intake-usage-1")
        self.assertIs(
            query.resolve_pricing(PROVIDER_A, MODEL, PriceDimension.INPUT).status,
            LookupStatus.FOUND,
        )
        self.assertEqual(
            {record.kind for record in query.list_costs(PROVIDER_A)},
            {CostKind.ACTUAL, CostKind.ESTIMATED},
        )

    def test_existing_analytics_consumes_intake_data(self) -> None:
        self.populate()
        query = self.reopened_query()
        period = Period(JAN_1, FEB_1)
        usage_rollup = rollup_usage(query, PROVIDER_A, period)
        cost_rollups = rollup_costs(query, PROVIDER_A, period)
        summary = summarize_provider(query, PROVIDER_A, period, as_of=JAN_2)
        self.assertEqual(usage_rollup.total_tokens, 1_600)
        self.assertEqual(cost_rollups[0].actual_record_count, 1)
        self.assertEqual(cost_rollups[0].estimated_record_count, 1)
        self.assertTrue(summary.pricing_available)
        self.assertTrue(summary.actual_cost_available)
        self.assertTrue(summary.estimated_cost_available)

    def test_intake_to_reopen_to_application_consumption_view(self) -> None:
        self.populate()
        view = AIAssetReadService(self.database_path).get_provider_view(
            PROVIDER_A,
            Period(JAN_1, FEB_1),
            generated_at=JAN_2,
            as_of=JAN_2,
        )
        self.assertEqual(view.schema_version, "0.1")
        self.assertEqual(view.schema_version, AI_ASSET_CONSUMPTION_SCHEMA_VERSION)
        self.assertEqual(view.data.provider.id, PROVIDER_A)
        self.assertTrue(view.data.pricing_available)
        self.assertEqual(view.data.usage.total_tokens, 1_600)
        self.assertEqual(view.data.actual_cost_by_currency[0].record_count, 1)
        self.assertEqual(view.data.estimated_cost_by_currency[0].record_count, 1)

    def test_application_write_boundary_has_no_forbidden_capabilities(self) -> None:
        source_text = inspect.getsource(intake_module)
        tree = ast.parse(source_text)
        imported = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imported.update(
            (node.module or "").split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
        )
        self.assertTrue(
            imported.isdisjoint(
                {"sqlite3", "socket", "urllib", "http", "requests", "subprocess"}
            )
        )
        self.assertNotIn("credential", source_text.lower())
        self.assertNotIn("SELECT ", source_text)
        self.assertNotIn("INSERT ", source_text)
        self.assertNotIn("UPDATE ", source_text)
        self.assertNotIn("DELETE ", source_text)

    def test_existing_schema_versions_remain_unchanged(self) -> None:
        self.populate()
        self.assertEqual(SCHEMA_VERSION, 4)
        self.assertEqual(AI_ASSET_CONSUMPTION_SCHEMA_VERSION, "0.1")


if __name__ == "__main__":
    unittest.main()
