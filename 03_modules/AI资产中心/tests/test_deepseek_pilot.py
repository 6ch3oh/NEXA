from __future__ import annotations

import ast
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.adapters import (
    RAW_OFFICIAL_SCHEMA_STATUS, SANITIZED_DEEPSEEK_ADAPTER_STATUS,
    DeepSeekSanitizedAdapter,
)
from src.analytics import Period
from src.application import AIAssetReadService, CanonicalIntakeService
from src.authority import AuthorityReadService
from src.consumption import to_canonical_json
from src.contracts import AuthoritySourceType, BillingMode
from src.store import SQLiteCanonicalStore


FIXTURE = Path(__file__).parents[1] / ".nexa" / "evidence" / "fixtures" / "deepseek_pilot_synthetic.json"


def payload():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for key in ("captured_at",): data[key] = datetime.fromisoformat(data[key])
    data["entitlement"]["reset_at"] = datetime.fromisoformat(data["entitlement"]["reset_at"])
    return data


class DeepSeekPilotCase(unittest.TestCase):
    def test_adapter_status_and_external_raw_schema_boundary(self):
        self.assertEqual(SANITIZED_DEEPSEEK_ADAPTER_STATUS, "SANITIZED_DEEPSEEK_ADAPTER_READY")
        self.assertEqual(RAW_OFFICIAL_SCHEMA_STATUS, "EXTERNAL_DEPENDENCY")

    def test_whitelist_unknown_and_credential_fields_fail_closed(self):
        for field in ("unexpected", "api_key", "authorization", "cookie"):
            candidate = payload(); candidate[field] = "synthetic-placeholder"
            with self.subTest(field=field), self.assertRaises(ValueError):
                DeepSeekSanitizedAdapter().adapt(candidate)
        candidate = payload(); candidate["synthetic"] = False
        with self.assertRaises(ValueError): DeepSeekSanitizedAdapter().adapt(candidate)

    def test_sanitized_adapter_to_atomic_store_authority_attribution_overview(self):
        batch = DeepSeekSanitizedAdapter().adapt(payload())
        self.assertIs(batch.pricing_authority.metadata.authority_source_type,
                      AuthoritySourceType.LOCAL_MANUAL)
        self.assertIsNone(batch.pricing_authority.metadata.official_source)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "deepseek.sqlite3"
            result = CanonicalIntakeService(path).ingest_batch(batch.records)
            self.assertTrue(result.transaction_committed)
            with SQLiteCanonicalStore(path) as store:
                token = store.load_tokens()[0]
                self.assertEqual(token.id, "deepseek:synthetic-pilot")
                self.assertIsNone(token.secret_ref)
                self.assertEqual(store.load_usage()[0].token_id, token.id)
                self.assertEqual(store.load_costs()[0].token_id, token.id)
                self.assertEqual(store.load_balances()[0].token_id, token.id)
            captured = datetime(2026, 7, 1, tzinfo=timezone.utc)
            pricing = AuthorityReadService(path).pricing(
                "deepseek", "deepseek-chat", BillingMode.API_USAGE, as_of=captured
            )
            self.assertEqual(pricing.record, batch.pricing_authority)
            entitlement = AuthorityReadService(path).entitlement(
                "deepseek", token_id="deepseek:synthetic-pilot",
                plan="synthetic-payg", model="deepseek-chat", as_of=captured
            )
            self.assertEqual(entitlement.record, batch.entitlement)
            overview = AIAssetReadService(path).get_resource_overview(
                Period(captured - timedelta(seconds=1), captured + timedelta(seconds=1)),
                generated_at=captured, as_of=captured,
            )
            self.assertEqual(overview.data.total_tokens, 1300000)
            self.assertEqual(overview.data.intelligence.coverage.attribution_coverage, 1)
            self.assertEqual(overview.data.intelligence.task_token_ranking[0].task_id, "task-pilot")
            self.assertNotIn("secret_ref", to_canonical_json(overview).lower())

    def test_adapter_has_no_network_environment_filesystem_or_client(self):
        path = Path(__file__).parents[1] / "src" / "adapters" / "deepseek.py"
        source = path.read_text(encoding="utf-8"); lowered = source.lower()
        tree = ast.parse(source)
        imports = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import)
                   for alias in node.names}
        self.assertFalse(imports & {"requests", "urllib", "socket", "subprocess", "os"})
        for forbidden in ("http://", "https://", "environ", "getenv(", "open(",
                          "credential_store", "provider client"):
            self.assertNotIn(forbidden, lowered)


if __name__ == "__main__":
    unittest.main()
