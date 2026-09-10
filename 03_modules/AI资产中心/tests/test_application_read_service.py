from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.application import AIAssetReadService, ApplicationReadError
from src.analytics import Period
from src.consumption import ConsumptionCompleteness, WarningCode, to_canonical_json
from src.store import SQLiteCanonicalStore
from tests.fixtures.analytics_fixtures import FEB_1, MAR_1, PROVIDER_A, TOKEN_A1
from tests.fixtures.budget_fixtures import EVALUATED_AT
from tests.fixtures.application_fixtures import populate_application_database


class ApplicationReadServiceCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "application.sqlite3"
        populate_application_database(self.db_path)
        self.period = Period(FEB_1, MAR_1)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def service(self) -> AIAssetReadService:
        return AIAssetReadService(self.db_path)

    def test_existing_v3_path_is_explicit_and_missing_schema_fails_closed(self) -> None:
        self.assertEqual(self.service().database_path, self.db_path)
        with self.assertRaises(ValueError):
            AIAssetReadService("")
        with self.assertRaises(FileNotFoundError):
            AIAssetReadService(Path(self.temp_dir.name) / "missing.sqlite3")
        empty_path = Path(self.temp_dir.name) / "empty.sqlite3"
        empty_path.touch()
        with self.assertRaises(ApplicationReadError):
            AIAssetReadService(empty_path)
        self.assertEqual(empty_path.stat().st_size, 0)

    def test_provider_view_and_explicit_missing_preserve_consumption_semantics(self) -> None:
        found = self.service().get_provider_view(
            PROVIDER_A,
            self.period,
            generated_at=EVALUATED_AT,
            as_of=EVALUATED_AT,
        )
        missing = self.service().get_provider_view(
            "missing-provider",
            self.period,
            generated_at=EVALUATED_AT,
            as_of=EVALUATED_AT,
        )
        self.assertEqual(found.data.provider.id, PROVIDER_A)
        self.assertTrue(found.data.provenance.underlying_sources)
        self.assertIsNone(missing.data.provider)
        self.assertIs(missing.completeness, ConsumptionCompleteness.INCOMPLETE)
        self.assertIn(WarningCode.PROVIDER_MISSING, missing.warnings)

    def test_token_view_is_safe_and_missing_is_none(self) -> None:
        found = self.service().get_token_view(
            TOKEN_A1,
            self.period,
            generated_at=EVALUATED_AT,
            as_of=EVALUATED_AT,
        )
        missing = self.service().get_token_view(
            "missing-token",
            self.period,
            generated_at=EVALUATED_AT,
            as_of=EVALUATED_AT,
        )
        self.assertEqual(found.data.token.id, TOKEN_A1)
        self.assertIsNone(missing)
        serialized = to_canonical_json(found).lower()
        for forbidden in ("secret_ref", "vault://", "authorization", "cookie", "api_key"):
            self.assertNotIn(forbidden, serialized)

    def test_each_read_uses_one_canonical_collection_load(self) -> None:
        original = SQLiteCanonicalStore.load_collections
        with patch.object(
            SQLiteCanonicalStore,
            "load_collections",
            autospec=True,
            side_effect=lambda store: original(store),
        ) as load:
            self.service().get_portfolio_view(
                self.period,
                generated_at=EVALUATED_AT,
                as_of=EVALUATED_AT,
            )
        self.assertEqual(load.call_count, 1)

    def test_reads_do_not_modify_database_bytes(self) -> None:
        before = hashlib.sha256(self.db_path.read_bytes()).hexdigest()
        service = self.service()
        service.get_provider_view(
            PROVIDER_A, self.period, generated_at=EVALUATED_AT, as_of=EVALUATED_AT
        )
        service.get_portfolio_view(
            self.period, generated_at=EVALUATED_AT, as_of=EVALUATED_AT
        )
        after = hashlib.sha256(self.db_path.read_bytes()).hexdigest()
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
