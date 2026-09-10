from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.api.contracts import CommandStatus
from creator_ops.persistence.sqlite_adapter import DatabaseLocation


class CreatorOpsProductionImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "production.sqlite3"
        self.now = datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc)
        self.fingerprints = {"06_自媒体运营": "synthetic-boundary-fingerprint"}
        self.app = create_creator_ops_application(self.db)
        self.assertEqual(
            self.app.initialize_local_store(confirmation=True).status.value, "SUCCESS",
        )

    def tearDown(self) -> None:
        self.app.close()
        self.temp.cleanup()

    def initialize_metadata(self) -> None:
        result = self.app.initialize_production_import_metadata(
            source_fingerprints=self.fingerprints, now=self.now,
            production_store_confirmation=True,
        )
        self.assertIs(result.status, CommandStatus.SUCCESS)

    def test_initialization_receipt_and_empty_baseline_are_persistent(self) -> None:
        rejected = self.app.initialize_production_import_metadata(
            source_fingerprints=self.fingerprints, now=self.now,
            production_store_confirmation=False,
        )
        self.assertIs(rejected.status, CommandStatus.CONFIRMATION_REQUIRED)
        self.initialize_metadata()
        metadata = self.app.get_production_store_metadata()
        self.assertEqual(metadata["schema_version"], "creator_ops_schema_v0.2")
        self.assertEqual(metadata["empty_entity_counts"]["content_items"], 0)
        self.assertTrue(metadata["empty_baseline_checksum"])
        self.assertEqual(
            self.app.list_production_import_receipts()[0].batch_id, "EMPTY_BASELINE",
        )

    def test_safe_import_accounts_for_all_without_guessing_domain_identity(self) -> None:
        self.initialize_metadata()
        result = self.app.execute_safe_production_import(
            run_id="production-import-v0.1", source_fingerprints=self.fingerprints,
            production_import_confirmation=True, now=self.now,
        )
        self.assertIs(result.status, CommandStatus.SUCCESS)
        self.assertEqual(result.data.plan_entries, 34)
        self.assertEqual(result.data.unknown, 0)
        self.assertEqual(result.data.final_counts["REFERENCED"], 20)
        self.assertEqual(result.data.final_counts["SKIPPED_WITH_REASON"], 2)
        self.assertEqual(result.data.final_counts["DEFERRED_FOR_USER"], 11)
        self.assertEqual(result.data.final_counts["INVALID_PRESERVED"], 1)
        self.assertEqual(self.app.list_accounts(), ())
        self.assertEqual(self.app.list_content(), ())
        self.assertEqual(len(self.app.list_production_import_ledger()), 34)
        self.assertEqual(self.app.health().deferred_legacy_count, 12)
        self.assertEqual(
            self.app.health().import_authorization_state,
            "SAFE_PRODUCTION_IMPORT_COMPLETE_WITH_DEFERRED",
        )
        self.assertEqual(
            self.app.health().historical_asset_state,
            "LEGACY_SOURCE_RECONCILED_SAFE_IMPORT_COMPLETE_WITH_DEFERRED",
        )

    def test_import_requires_true_confirmation_and_reimport_is_idempotent(self) -> None:
        self.initialize_metadata()
        rejected = self.app.execute_safe_production_import(
            run_id="rejected", source_fingerprints=self.fingerprints,
            production_import_confirmation=False, now=self.now,
        )
        self.assertIs(rejected.status, CommandStatus.CONFIRMATION_REQUIRED)
        first = self.app.execute_safe_production_import(
            run_id="run-1", source_fingerprints=self.fingerprints,
            production_import_confirmation=True, now=self.now,
        )
        second = self.app.execute_safe_production_import(
            run_id="run-2", source_fingerprints=self.fingerprints,
            production_import_confirmation=True, now=self.now,
        )
        self.assertIs(first.status, CommandStatus.SUCCESS)
        self.assertIs(second.status, CommandStatus.SUCCESS)
        self.assertEqual(len(self.app.list_production_import_ledger()), 34)
        batch_receipts = tuple(
            item for item in second.data.receipts
            if item.batch_id != "PRODUCTION_IMPORT_MASTER_RECEIPT"
        )
        master = next(
            item for item in second.data.receipts
            if item.batch_id == "PRODUCTION_IMPORT_MASTER_RECEIPT"
        )
        self.assertEqual(sum(item.idempotent_skips for item in batch_receipts), 34)
        self.assertEqual(master.idempotent_skips, 34)

    def test_batch_transaction_rolls_back_on_mid_batch_failure(self) -> None:
        self.initialize_metadata()
        connection = self.app._root.store.connection
        connection.execute("""
        CREATE TRIGGER fail_asset_batch BEFORE INSERT ON production_import_ledger
        WHEN NEW.batch_id='C_ASSET_REFERENCE' AND NEW.legacy_identity LIKE 'missing-assets:%'
        BEGIN SELECT RAISE(ABORT, 'synthetic batch failure'); END
        """)
        result = self.app.execute_safe_production_import(
            run_id="rollback", source_fingerprints=self.fingerprints,
            production_import_confirmation=True, now=self.now,
        )
        self.assertIn(result.status, {CommandStatus.CONFLICT, CommandStatus.STORAGE_ERROR})
        count = connection.execute(
            "SELECT COUNT(*) FROM production_import_ledger WHERE batch_id='C_ASSET_REFERENCE'"
        ).fetchone()[0]
        receipt = connection.execute(
            "SELECT COUNT(*) FROM production_import_receipts WHERE receipt_id='rollback:C_ASSET_REFERENCE'"
        ).fetchone()[0]
        self.assertEqual(count, 0)
        self.assertEqual(receipt, 0)

    def test_restart_preserves_ledger_receipts_and_health(self) -> None:
        self.initialize_metadata()
        self.app.execute_safe_production_import(
            run_id="restart", source_fingerprints=self.fingerprints,
            production_import_confirmation=True, now=self.now,
        )
        self.app.close()
        reopened = create_creator_ops_application(self.db)
        try:
            self.assertEqual(reopened.open().status.value, "SUCCESS")
            self.assertEqual(len(reopened.list_production_import_ledger()), 34)
            self.assertEqual(reopened.health().deferred_legacy_count, 12)
            self.assertEqual(
                reopened.health().production_database_exists,
                DatabaseLocation.default_path().exists(),
            )
        finally:
            reopened.close()

    def test_first_baseline_backup_is_verified_and_idempotent(self) -> None:
        self.initialize_metadata()
        self.app.execute_safe_production_import(
            run_id="backup", source_fingerprints=self.fingerprints,
            production_import_confirmation=True, now=self.now,
        )
        target = Path(self.temp.name) / "backups" / "first.sqlite3"
        target.parent.mkdir()
        first = self.app.create_first_production_baseline_backup(target, now=self.now)
        second = self.app.create_first_production_baseline_backup(target, now=self.now)
        self.assertIs(first.status, CommandStatus.SUCCESS)
        self.assertIs(second.status, CommandStatus.SUCCESS)
        self.assertEqual(first.data, second.data)
        self.assertEqual(first.data.sqlite_quick_check, "ok")
        self.assertEqual(first.data.schema_version, "creator_ops_schema_v0.2")
        self.assertTrue(target.is_file())


if __name__ == "__main__":
    unittest.main()
