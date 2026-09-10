from __future__ import annotations

import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from src.application import CanonicalIntakeService
from src.authority import AuthorityReadService
from src.consumption import to_canonical_json, to_json_safe
from src.contracts import FreshnessStatus
from src.store import SQLiteCanonicalStore
from tests.test_authority_goal_a import T1, T2, authority, entitlement
from tests.fixtures.store_fixtures import provider


class AuthorityUpdateReceiptCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "receipt.sqlite3"
        self.intake = CanonicalIntakeService(self.path)
        self.intake.ingest_provider(provider())

    def tearDown(self):
        self.temp.cleanup()

    def seed_pricing_components(self, record):
        for component in record.components:
            self.intake.ingest_pricing(component)

    def test_pricing_stored_then_idempotent_receipt(self):
        record = authority(); self.seed_pricing_components(record)
        stored = self.intake.ingest_pricing_authority_with_receipt(record, accepted_at=T1)
        replay = self.intake.ingest_pricing_authority_with_receipt(record, accepted_at=T1)
        self.assertTrue(stored.persisted)
        self.assertTrue(replay.idempotent)
        self.assertIs(stored.freshness_at_acceptance, FreshnessStatus.FRESH)
        self.assertEqual(stored.source_reference, record.metadata.source.source_reference)
        self.assertTrue(stored.history_preserved)
        self.assertNotIn("secret_ref", to_canonical_json(stored))

    def test_entitlement_receipt_and_stale_acceptance(self):
        record = entitlement()
        self.intake.ingest_token(__import__("tests.fixtures.store_fixtures", fromlist=["token"]).token())
        receipt = self.intake.ingest_entitlement_with_receipt(
            record, accepted_at=T2 + timedelta(days=10)
        )
        self.assertIs(receipt.freshness_at_acceptance, FreshnessStatus.STALE)
        self.assertEqual(receipt.effective_or_observed_at, record.observed_at)
        self.assertIsInstance(to_json_safe(receipt), dict)

    def test_history_is_preserved_and_as_of_read_still_works(self):
        old = authority(); self.seed_pricing_components(old)
        self.intake.ingest_pricing_authority_with_receipt(old, accepted_at=T1)
        with SQLiteCanonicalStore(self.path) as store:
            self.assertEqual(len(store.load_pricing_authorities()), 1)
        view = AuthorityReadService(self.path).pricing(
            old.provider_id, old.model, old.billing_mode, as_of=old.effective_from
        )
        self.assertEqual(view.record, old)


if __name__ == "__main__":
    unittest.main()
