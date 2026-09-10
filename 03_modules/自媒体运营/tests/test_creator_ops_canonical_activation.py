from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.api.contracts import CommandStatus
from creator_ops.application.canonical_activation import CanonicalActivationRequest


class CanonicalActivationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "activation.sqlite3"
        self.now = datetime(2026, 8, 13, 13, 30, tzinfo=timezone.utc)
        self.app = create_creator_ops_application(self.db)
        self.app.initialize_local_store(confirmation=True)
        result = self.app.initialize_production_import_metadata(
            source_fingerprints={"confirmed": "synthetic-test-fingerprint"}, now=self.now,
            production_store_confirmation=True,
        )
        self.assertIs(result.status, CommandStatus.SUCCESS)
        imported = self.app.execute_safe_production_import(
            run_id="activation-fixture-import", source_fingerprints={"confirmed": "synthetic-test-fingerprint"},
            production_import_confirmation=True, now=self.now,
        )
        self.assertIs(imported.status, CommandStatus.SUCCESS)

    def tearDown(self) -> None:
        self.app.close()
        self.temp.cleanup()

    @staticmethod
    def request() -> CanonicalActivationRequest:
        return CanonicalActivationRequest(
            "NEXA-CREATOR-CANONICAL-ACTIVATION-001", "creator-main", "主创作者", "ACTIVE",
            {"A1": "UNKNOWN", "A2": "ACTIVE", "B1": "UNKNOWN", "B2": "UNKNOWN", "B3": "ACTIVE"},
            {"A2-20260714-001": "A2", "B3-20260714-001": "B3"},
            {"A2-20260714-001": "ASSET_PREPARATION", "B3-20260714-001": "DRAFT"},
            ("A2-20260714-001", "B3-20260714-001"),
            ("A2-20260714-001", "B3-20260714-001"),
            "docs/audits/CREATOR_PRODUCTION_HUMAN_DECISION_PACKET_V0_1.md",
        )

    def test_activation_requires_explicit_confirmation(self) -> None:
        result = self.app.activate_canonical_baseline(
            self.request(), activation_confirmation=False, now=self.now,
        )
        self.assertIs(result.status, CommandStatus.CONFIRMATION_REQUIRED)
        self.assertEqual(self.app.list_accounts(), ())

    def test_real_adjudicated_entities_resolutions_queries_and_idempotency(self) -> None:
        first = self.app.activate_canonical_baseline(
            self.request(), activation_confirmation=True, now=self.now,
        )
        second = self.app.activate_canonical_baseline(
            self.request(), activation_confirmation=True, now=self.now,
        )
        self.assertIs(first.status, CommandStatus.SUCCESS)
        self.assertIs(second.status, CommandStatus.SUCCESS)
        self.assertFalse(first.data.idempotent)
        self.assertTrue(second.data.idempotent)
        self.assertEqual(first.data.creator_created, 1)
        self.assertEqual(first.data.accounts_created, 5)
        self.assertEqual(first.data.contents_created, 2)
        self.assertEqual(first.data.deferred_resolved, 11)
        self.assertEqual(first.data.invalid_preserved, 1)
        self.assertTrue(first.data.b4_absent)
        self.assertEqual(len(self.app.list_creators()), 1)
        self.assertEqual(self.app.list_creators()[0].creator_id, "creator-main")
        self.assertEqual(len(self.app.list_accounts()), 5)
        self.assertNotIn("B4", {item.account_id for item in self.app.list_accounts()})
        self.assertEqual(
            {item.account_id: item.status for item in self.app.list_accounts()},
            {"A1": "UNKNOWN", "A2": "ACTIVE", "B1": "UNKNOWN", "B2": "UNKNOWN", "B3": "ACTIVE"},
        )
        contents = {item.content_id: item for item in self.app.list_content()}
        self.assertEqual(contents["A2-20260714-001"].target_accounts, ("A2",))
        self.assertEqual(contents["A2-20260714-001"].current_state, "ASSET_PREPARATION")
        self.assertEqual(contents["B3-20260714-001"].target_accounts, ("B3",))
        self.assertEqual(contents["B3-20260714-001"].current_state, "DRAFT")
        self.assertEqual(len(self.app.list_canonical_activation_resolutions()), 12)
        self.assertEqual(self.app.health().deferred_legacy_count, 0)
        self.assertEqual(len(self.app.get_work_queue(now=self.now)), 2)
        self.assertEqual(self.app.get_dashboard(now=self.now).data_classification, "PRODUCTION / LEGACY_DERIVED")

        seal = self.app.seal_canonical_production_baseline(
            activation_id=self.request().activation_id,
            baseline_state="READY_WITH_NON_BLOCKING_DEFERRED_ITEMS",
            seal_confirmation=True, now=self.now,
        )
        repeated_seal = self.app.seal_canonical_production_baseline(
            activation_id=self.request().activation_id,
            baseline_state="READY_WITH_NON_BLOCKING_DEFERRED_ITEMS",
            seal_confirmation=True, now=self.now,
        )
        self.assertIs(seal.status, CommandStatus.SUCCESS)
        self.assertFalse(seal.data["idempotent"])
        self.assertTrue(repeated_seal.data["idempotent"])
        self.assertEqual(
            self.app.get_production_store_metadata()["production_baseline_version"],
            "CREATOR_OPS_PRODUCTION_BASELINE_V0_2",
        )

        backup_path = Path(self.temp.name) / "canonical-backup.sqlite3"
        backup = self.app.create_canonical_activation_baseline_backup(backup_path, now=self.now)
        repeated_backup = self.app.create_canonical_activation_baseline_backup(backup_path, now=self.now)
        self.assertIs(backup.status, CommandStatus.SUCCESS)
        self.assertEqual(backup.data, repeated_backup.data)
        self.assertEqual(backup.data.receipt_id, "CANONICAL_ACTIVATION_BASELINE_BACKUP")
        self.assertTrue(backup_path.is_file())

        self.app.close()
        reopened = create_creator_ops_application(self.db)
        try:
            self.assertEqual(reopened.open().status.value, "SUCCESS")
            self.assertEqual(len(reopened.list_accounts()), 5)
            self.assertEqual(len(reopened.list_content()), 2)
            self.assertEqual(len(reopened.list_canonical_activation_resolutions()), 12)
            self.assertEqual(reopened.health().deferred_legacy_count, 0)
        finally:
            reopened.close()

    def test_transaction_rolls_back_every_entity_and_resolution(self) -> None:
        connection = self.app._root.store.connection
        connection.execute("""
        CREATE TRIGGER fail_activation_resolution BEFORE INSERT ON canonical_activation_resolutions
        BEGIN SELECT RAISE(ABORT, 'synthetic activation failure'); END
        """)
        result = self.app.activate_canonical_baseline(
            self.request(), activation_confirmation=True, now=self.now,
        )
        self.assertIn(result.status, {CommandStatus.CONFLICT, CommandStatus.STORAGE_ERROR})
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM creators").fetchone()[0], 0)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], 0)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM content_items").fetchone()[0], 0)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM canonical_activation_resolutions").fetchone()[0], 0)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM canonical_activation_receipts").fetchone()[0], 0)

    def test_only_known_question_mark_creator_name_corruption_is_repairable(self) -> None:
        corrupted = self.request()
        corrupted = CanonicalActivationRequest(
            corrupted.activation_id, corrupted.creator_id, "????", corrupted.creator_status,
            corrupted.account_statuses, corrupted.content_owners, corrupted.content_states,
            corrupted.no_verified_assets, corrupted.adapt_packages,
            corrupted.decision_reference, corrupted.version,
        )
        first = self.app.activate_canonical_baseline(
            corrupted, activation_confirmation=True, now=self.now,
        )
        repaired = self.app.activate_canonical_baseline(
            self.request(), activation_confirmation=True, now=self.now,
        )
        repeated = self.app.activate_canonical_baseline(
            self.request(), activation_confirmation=True, now=self.now,
        )
        self.assertIs(first.status, CommandStatus.SUCCESS)
        self.assertIs(repaired.status, CommandStatus.SUCCESS)
        self.assertIs(repeated.status, CommandStatus.SUCCESS)
        self.assertEqual(self.app.list_creators()[0].name, "主创作者")
        self.assertTrue(repaired.data.idempotent)
        self.assertTrue(repeated.data.idempotent)


if __name__ == "__main__":
    unittest.main()
