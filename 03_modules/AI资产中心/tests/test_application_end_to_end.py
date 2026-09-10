from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from src.application import AIAssetReadService
from src.analytics import Period
from src.consumption import to_canonical_json, to_json_safe
from tests.fixtures.analytics_fixtures import FEB_1, MAR_1, PROVIDER_A, PROVIDER_B, TOKEN_A1
from tests.fixtures.application_fixtures import populate_application_database
from tests.fixtures.budget_fixtures import EVALUATED_AT


def application_payload(database_path: Path) -> dict:
    service = AIAssetReadService(database_path)
    period = Period(FEB_1, MAR_1)
    return {
        "provider": service.get_provider_view(
            PROVIDER_A, period, generated_at=EVALUATED_AT, as_of=EVALUATED_AT
        ),
        "token": service.get_token_view(
            TOKEN_A1, period, generated_at=EVALUATED_AT, as_of=EVALUATED_AT
        ),
        "portfolio": service.get_portfolio_view(
            period, generated_at=EVALUATED_AT, as_of=EVALUATED_AT
        ),
        "budgets": service.evaluate_budgets(evaluated_at=EVALUATED_AT),
    }


class TestApplicationEndToEnd(unittest.TestCase):
    def test_reopened_v4_runs_store_query_analytics_consumption_and_budget(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "e2e.sqlite3"
            populate_application_database(db_path)
            payload = application_payload(db_path)
            json_safe = to_json_safe(payload)

            self.assertEqual(
                tuple(item.data.provider.id for item in payload["portfolio"].data.providers),
                (PROVIDER_A, PROVIDER_B),
            )
            self.assertEqual(
                tuple(item.currency for item in payload["portfolio"].data.actual_cost_by_currency),
                ("CNY", "USD"),
            )
            self.assertEqual(
                tuple(
                    item.currency
                    for item in payload["portfolio"].data.estimated_cost_by_currency
                ),
                ("USD",),
            )
            amount = json_safe["portfolio"]["data"]["actual_cost_by_currency"][0]["amount"]
            self.assertIsInstance(amount, str)
            self.assertTrue(json_safe["portfolio"]["warnings"])
            self.assertEqual(json_safe["portfolio"]["schema_version"], "0.1")
            with closing(sqlite3.connect(db_path)) as connection:
                version = connection.execute(
                    "SELECT value FROM schema_metadata WHERE key='schema_version'"
                ).fetchone()[0]
        self.assertEqual(version, "4")

    def test_reverse_insertion_produces_same_logical_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            first = Path(temp_dir) / "forward.sqlite3"
            second = Path(temp_dir) / "reverse.sqlite3"
            populate_application_database(first)
            populate_application_database(second, reverse=True)
            self.assertEqual(
                to_canonical_json(application_payload(first)),
                to_canonical_json(application_payload(second)),
            )

    def test_missing_balance_is_distinct_from_observed_zero(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "missing-zero.sqlite3"
            populate_application_database(db_path)
            service = AIAssetReadService(db_path)
            period = Period(FEB_1, MAR_1)
            zero = service.get_provider_view(
                PROVIDER_B, period, generated_at=EVALUATED_AT, as_of=EVALUATED_AT
            )
            missing = service.get_provider_view(
                "missing-provider",
                period,
                generated_at=EVALUATED_AT,
                as_of=EVALUATED_AT,
            )
            self.assertEqual(zero.data.latest_balance.value, 0)
            self.assertIsNone(missing.data.latest_balance.value)


if __name__ == "__main__":
    unittest.main()
