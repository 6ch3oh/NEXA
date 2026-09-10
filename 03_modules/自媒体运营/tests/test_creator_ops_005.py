"""Acceptance tests for NEXA-CREATOR-005 public API and composition root."""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from dataclasses import fields
from datetime import datetime, timezone
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

import creator_ops  # noqa: E402
from creator_ops import (  # noqa: E402
    API_VERSION, CommandResult, CommandStatus, ContentDTO, CreatorOpsAPIError,
    DatabaseState, HealthStatus, LifecycleStatus, create_creator_ops_application,
)
from creator_ops.api.application import CreatorOpsApplication  # noqa: E402
from creator_ops.api.composition import create_composition_root  # noqa: E402
from creator_ops.persistence.sqlite_adapter import DatabaseLocation, SCHEMA_VERSION  # noqa: E402


UTC = timezone.utc


class CreatorOpsApplicationAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.now = datetime(2026, 8, 10, 16, 0, tzinfo=UTC)
        cls.default_path = DatabaseLocation.default_path()
        cls.default_existed_before = cls.default_path.exists()

    @classmethod
    def tearDownClass(cls) -> None:
        if not cls.default_existed_before:
            assert not cls.default_path.exists(), "005 tests must not create the formal default database"

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "creator_ops_api_test.sqlite3"
        self.app = create_creator_ops_application(self.db_path)

    def tearDown(self) -> None:
        self.app.close()
        self.temp.cleanup()

    def initialize(self) -> None:
        result = self.app.initialize_local_store(confirmation=True)
        self.assertIn(result.status, {LifecycleStatus.SUCCESS, LifecycleStatus.ALREADY_INITIALIZED})

    def seed_identity(self) -> None:
        self.assertIs(self.app.create_creator(
            creator_id="creator-api", name="API Creator", now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.create_account(
            account_id="account-api", creator_id="creator-api", platform="fixture-platform",
            account_name="api-account", display_name="API Account",
            content_direction="Synthetic tests", legacy_account_code="A1", now=self.now,
        ).status, CommandStatus.SUCCESS)

    def seed_ready_content(self, content_id: str = "content-api") -> None:
        self.seed_identity()
        self.assertIs(self.app.create_idea(
            content_id=content_id, creator_id="creator-api", target_accounts=("account-api",),
            topic="Synthetic API flow", content_type="IMAGE_POST",
            platform_intent=("fixture-platform",), now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.start_draft(
            content_id, title="Synthetic title", body="Synthetic body",
            script_reference=None, now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.attach_asset(
            content_id, asset_id=f"asset-{content_id}", asset_type="COVER",
            location="fixture://cover", account_relations=("account-api",),
            creator_id="creator-api", now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.submit_for_review(content_id, now=self.now).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.approve_review(content_id, now=self.now).status, CommandStatus.SUCCESS)
        package = self.app.build_local_package(
            content_id, account_id="account-api", package_id=f"package-{content_id}",
            target_root=Path(self.temp.name) / "packages", now=self.now,
        )
        self.assertIs(package.status, CommandStatus.SUCCESS)
        self.assertIs(self.app.run_content_qa(content_id, now=self.now).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.run_asset_qa(content_id, now=self.now).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.run_package_qa(
            content_id, package_id=f"package-{content_id}",
            manifest_path=package.data.manifest_path, now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.run_publish_prep_qa(
            content_id, package_id=f"package-{content_id}", now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.mark_ready_to_publish(content_id, now=self.now).status, CommandStatus.SUCCESS)

    def test_public_api_version_and_controlled_exports(self) -> None:
        self.assertEqual(API_VERSION, "0.2")
        self.assertEqual(set(creator_ops.__all__), {
            "API_VERSION", "MODULE_VERSION", "CreatorOpsApplication",
            "create_creator_ops_application", "CreatorOpsAPIError", "DatabaseState",
            "LifecycleStatus", "CommandStatus", "HealthStatus", "LifecycleResult",
            "CommandResult", "PublicError", "RuntimeInfo", "HealthReport", "CreatorDTO",
            "AccountDTO", "ContentDTO", "AssetDTO", "PublishRecordDTO", "MetricsDTO",
            "ReviewDTO", "ProvenanceDTO", "ContentDetailDTO",
            "AutomationTask", "AutomationTaskStatus", "RetryPolicy", "TaskLock", "LockStatus",
            "AutomationTrigger", "AutomationTriggerType", "AutomationResult", "AutomationResultStatus",
            "HumanAIHandoff",
            "LockPlan", "RecoveryCheckpoint", "RecoveryAction", "RecoveryPlan",
            "QACheck", "QALevel", "QAReport", "QAScope", "QAStatus",
            "ContentPackageManifest", "ContentPackageRequest", "PackageCompleteness",
            "PackageCompatibility", "PackageFileSpec",
            "LegacyCase",
            "DurableTask", "DurableTaskType", "DurableTaskStatus", "DurableTaskLock",
            "RecoveryDecision", "RecoveryEvidence", "AuditEvent",
            "PackageBuildRequest", "PackageFileInput", "PackageWriteResult", "PackageWriteStatus",
            "QAReceipt", "QAReceiptStatus", "QAType", "RuntimeQACheck",
            "ResearchSession", "ResearchSource", "ResearchSourceType", "ResearchStatus", "TopicCandidate",
            "ProductionAssetInput", "ProductionStep", "ProductionWorkflowRequest", "ProductionWorkflowResult",
            "FinalImportPlanV02",
            "ProductionImportDisposition", "ProductionImportLedgerEntry",
            "ProductionImportReceipt", "ProductionImportResult",
            "ProductionBackupReceipt",
            "ActivationResolutionStatus", "CanonicalActivationRequest",
            "CanonicalActivationResolution", "CanonicalActivationReceipt",
            "Blocker", "BlockerCode", "FieldOwnership", "NextAction", "NextActionType",
            "OperatorWorkState", "Priority", "WorkItem", "WorkItemStatus", "WorkType",
            "ActivityEvent", "ActivityEventType", "ChecklistStatus",
            "ManualPublishingWorkbench", "MetricsBackfillWorkbench", "ReadinessCheck",
            "ReviewWorkbench", "RealReviewWorkbench",
            "AssetIntakeStatus", "AssetIntakeSubmission", "AssetRequirement", "AssetRequirementStatus",
            "AssetSubmissionStatus", "HumanAIImageHandoff", "MediaValidationResult",
            "MediaValidationStatus", "VisualProductionPacket", "VisualProductionSpec",
            "VisualReviewDecision", "VisualReviewRecord", "VisualReviewWorkbench",
            "ContentPackageV01", "AccountWorkload", "OperatorDashboard", "OperatorSummary",
            "CreatorOpsUIHost", "UIEndpoint", "UIHostLifecycleState", "UIHostReadiness",
            "create_creator_ops_ui_host",
        })
        self.assertFalse(hasattr(creator_ops, "SQLiteCreatorOpsStore"))
        self.assertFalse(hasattr(creator_ops, "CreatorOpsQueryService"))

    def test_missing_open_requires_initialization_and_creates_nothing(self) -> None:
        result = self.app.open()
        self.assertIs(result.status, LifecycleStatus.INITIALIZATION_REQUIRED)
        self.assertIs(result.database_state, DatabaseState.NOT_INITIALIZED)
        self.assertFalse(self.db_path.exists())
        self.assertFalse(self.db_path.parent.joinpath("creator_ops_api_test.sqlite3-journal").exists())

    def test_initialization_requires_explicit_confirmation(self) -> None:
        result = self.app.initialize_local_store(confirmation=False)
        self.assertIs(result.status, LifecycleStatus.CONFIRMATION_REQUIRED)
        self.assertFalse(self.db_path.exists())

    def test_explicit_initialization_is_idempotent_and_preserves_data(self) -> None:
        first = self.app.initialize_local_store(confirmation=True)
        self.assertTrue(first.created)
        self.seed_identity()
        second = self.app.initialize_local_store(confirmation=True)
        self.assertIs(second.status, LifecycleStatus.ALREADY_INITIALIZED)
        self.assertFalse(second.created)
        self.assertEqual(self.app.list_accounts()[0].account_id, "account-api")

    def test_close_is_idempotent_and_open_recovers_existing_store(self) -> None:
        self.initialize()
        first = self.app.close()
        second = self.app.close()
        self.assertIs(first.database_state, DatabaseState.CLOSED)
        self.assertIs(second.database_state, DatabaseState.CLOSED)
        self.assertIs(self.app.open().status, LifecycleStatus.SUCCESS)
        self.assertIs(self.app.get_runtime_info().database_state, DatabaseState.OPEN)

    def test_composition_root_releases_sqlite_connection(self) -> None:
        root = create_composition_root(self.db_path)
        app = CreatorOpsApplication(root)
        app.initialize_local_store(confirmation=True)
        connection = root.store.connection
        app.close()
        with self.assertRaises(sqlite3.ProgrammingError):
            connection.execute("SELECT 1")

    def test_unknown_existing_file_fails_closed_without_overwrite(self) -> None:
        original = b"not-a-creator-ops-database"
        self.db_path.write_bytes(original)
        opened = self.app.open()
        initialized = self.app.initialize_local_store(confirmation=True)
        self.assertIn(opened.status, {LifecycleStatus.STORAGE_ERROR, LifecycleStatus.UNSUPPORTED_SCHEMA})
        self.assertIn(initialized.status, {LifecycleStatus.STORAGE_ERROR, LifecycleStatus.UNSUPPORTED_SCHEMA})
        self.assertEqual(self.db_path.read_bytes(), original)

    def test_future_schema_fails_closed(self) -> None:
        self.initialize()
        self.app.close()
        raw = sqlite3.connect(self.db_path)
        raw.execute("UPDATE metadata SET value=? WHERE key='schema_version'", ("creator_ops_schema_v99.0",))
        raw.commit()
        raw.close()
        app = create_creator_ops_application(self.db_path)
        try:
            self.assertIs(app.open().status, LifecycleStatus.UNSUPPORTED_SCHEMA)
            self.assertIs(app.initialize_local_store(confirmation=True).status, LifecycleStatus.UNSUPPORTED_SCHEMA)
        finally:
            app.close()

    def test_runtime_and_health_are_truthful_and_offline(self) -> None:
        before = self.app.get_runtime_info()
        self.assertEqual(before.schema_version, SCHEMA_VERSION)
        self.assertIs(before.database_state, DatabaseState.NOT_INITIALIZED)
        self.assertEqual(before.automatic_publishing, "NONE")
        self.assertEqual(before.network_capability, "NONE")
        self.initialize()
        health = self.app.health()
        self.assertIs(health.status, HealthStatus.HEALTHY)
        self.assertTrue(health.operational)
        self.assertTrue(health.query_available)
        self.assertEqual(health.historical_asset_state, "LEGACY_SOURCE_RECONCILED_IMPORT_NOT_AUTHORIZED")

    def test_read_and_command_guard_when_database_not_open(self) -> None:
        with self.assertRaises(CreatorOpsAPIError):
            self.app.get_dashboard(now=self.now)
        result = self.app.create_creator(creator_id="x", name="X", now=self.now)
        self.assertIs(result.status, CommandStatus.STORAGE_ERROR)
        self.assertIsNotNone(result.error)

    def test_command_result_has_stable_required_fields(self) -> None:
        expected = {"command", "status", "entity_id", "content_id", "updated_state", "warnings", "error", "data"}
        self.assertEqual({field.name for field in fields(CommandResult)}, expected)

    def test_command_validation_not_found_conflict_and_rejection_are_stable(self) -> None:
        self.initialize()
        missing = self.app.start_draft("missing", title="x", body="x", script_reference=None, now=self.now)
        self.assertIs(missing.status, CommandStatus.NOT_FOUND)
        self.seed_identity()
        duplicate = self.app.create_creator(creator_id="creator-api", name="Again", now=self.now)
        self.assertIs(duplicate.status, CommandStatus.CONFLICT)
        invalid = self.app.create_idea(
            content_id="bad", creator_id="creator-api", target_accounts=("account-api",),
            topic="bad", content_type="NO_SUCH_TYPE", platform_intent=(), now=self.now,
        )
        self.assertIs(invalid.status, CommandStatus.VALIDATION_ERROR)

    def test_public_reads_return_dtos_not_database_rows(self) -> None:
        self.initialize()
        self.seed_ready_content()
        items = self.app.list_content(state="READY_TO_PUBLISH")
        self.assertIsInstance(items[0], ContentDTO)
        self.assertFalse(isinstance(items[0], sqlite3.Row))
        detail = self.app.get_content_detail("content-api")
        self.assertIsInstance(detail.content, ContentDTO)
        self.assertEqual(detail.assets[0].location, "fixture://cover")
        self.assertEqual(self.app.list_accounts()[0].legacy_account_code, "A1")
        with self.assertRaises(CreatorOpsAPIError) as caught:
            self.app.get_content_detail("missing")
        self.assertEqual(caught.exception.code, "NOT_FOUND")

    def test_dashboard_queue_workbenches_workload_and_activity(self) -> None:
        self.initialize()
        self.seed_ready_content()
        dashboard = self.app.get_dashboard(now=self.now)
        queue = self.app.get_work_queue(now=self.now)
        workbench = self.app.get_publishing_workbench("content-api", "account-api")
        workload = self.app.get_account_workload("account-api", now=self.now)
        activity = self.app.get_activity()
        self.assertEqual(dashboard.summary.ready_to_publish, 1)
        self.assertTrue(queue)
        self.assertTrue(workbench.ready)
        self.assertEqual(workload.ready_to_publish_count, 1)
        self.assertTrue(activity)

    def test_manual_confirmation_is_required_and_uses_single_publish_result(self) -> None:
        self.initialize()
        self.seed_ready_content()
        rejected = self.app.confirm_manual_publish(
            "content-api", "account-api", actual_publish_time=self.now,
            manual_confirmation=False, now=self.now,
        )
        self.assertIs(rejected.status, CommandStatus.CONFIRMATION_REQUIRED)
        accepted = self.app.confirm_manual_publish(
            "content-api", "account-api", actual_publish_time=self.now,
            manual_confirmation=True, external_post_id="fixture-post", now=self.now,
        )
        self.assertIs(accepted.status, CommandStatus.SUCCESS)
        self.assertEqual(accepted.updated_state, "PUBLISHED")
        self.assertEqual(len(self.app.get_content_detail("content-api").publish_records), 1)

    def test_full_chain_smoke_through_public_api(self) -> None:
        self.initialize()
        self.seed_ready_content("full-chain")
        publishing = self.app.get_publishing_workbench("full-chain", "account-api")
        self.assertTrue(publishing.ready)
        published = self.app.confirm_manual_publish(
            "full-chain", "account-api", actual_publish_time=self.now,
            manual_confirmation=True, external_url="https://fixture.invalid/post", now=self.now,
        )
        self.assertIs(published.status, CommandStatus.SUCCESS)
        publish_id = published.entity_id
        metrics = self.app.record_metrics(
            "full-chain", publish_id, metrics_id="metrics-full", views=0,
            impressions=None, likes=0, collected_at=self.now, now=self.now,
        )
        self.assertIs(metrics.status, CommandStatus.SUCCESS)
        metrics_view = self.app.get_metrics_workbench("full-chain", publish_id)
        self.assertEqual(metrics_view.existing_metrics.metrics_id, "metrics-full")
        review_view = self.app.get_review_workbench("full-chain", publish_id)
        self.assertIn("strengths", review_view.missing_review_sections)
        review = self.app.complete_review(
            "full-chain", publish_id, "metrics-full", review_id="review-full",
            strengths=("Synthetic strength",), weaknesses=(), reusable_patterns=(),
            failed_patterns=(), next_action="Repeat", evidence=("fixture://evidence",), now=self.now,
        )
        self.assertIs(review.status, CommandStatus.SUCCESS)
        self.assertEqual(review.updated_state, "REVIEWED")
        detail = self.app.get_content_detail("full-chain")
        self.assertEqual(detail.metrics[0].views, 0)
        self.assertIsNone(detail.metrics[0].impressions)
        self.assertEqual(detail.reviews[0].review_id, "review-full")

    def test_work_item_overlay_persists_only_operator_fields(self) -> None:
        self.initialize()
        self.seed_ready_content()
        item = self.app.get_work_queue(now=self.now)[0]
        result = self.app.update_work_item_overlay(
            work_item_id=item.work_item_id, content_id=item.content_id,
            status="IN_PROGRESS", due_at=self.now, blocked_reason=None,
            operator_notes="Synthetic note", now=self.now,
        )
        self.assertIs(result.status, CommandStatus.SUCCESS)
        tables = {row[0] for row in self.app._root.store.connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        self.assertNotIn("work_queue", tables)
        recovered = next(x for x in self.app.get_work_queue(now=self.now) if x.work_item_id == item.work_item_id)
        self.assertEqual(recovered.status.value, "IN_PROGRESS")

    def test_explicit_backup_is_public_and_reopenable(self) -> None:
        self.initialize()
        self.seed_identity()
        backup = Path(self.temp.name) / "backup.sqlite3"
        result = self.app.create_local_backup(backup)
        self.assertIs(result.status, CommandStatus.SUCCESS)
        recovered = create_creator_ops_application(backup)
        try:
            self.assertIs(recovered.open().status, LifecycleStatus.SUCCESS)
            self.assertEqual(recovered.list_accounts()[0].account_id, "account-api")
        finally:
            recovered.close()
        second = self.app.create_local_backup(backup)
        self.assertIs(second.status, CommandStatus.VALIDATION_ERROR)

    def test_backup_of_uninitialized_store_is_rejected_without_creation(self) -> None:
        backup = Path(self.temp.name) / "uninitialized-backup.sqlite3"
        result = self.app.create_local_backup(backup)
        self.assertIs(result.status, CommandStatus.STORAGE_ERROR)
        self.assertEqual(result.error.code, "NOT_INITIALIZED")
        self.assertFalse(self.db_path.exists())
        self.assertFalse(backup.exists())

    def test_default_formal_database_state_is_observed_without_mutation(self) -> None:
        app = create_creator_ops_application()
        try:
            result = app.open()
            expected = (
                LifecycleStatus.SUCCESS if self.default_existed_before
                else LifecycleStatus.INITIALIZATION_REQUIRED
            )
            self.assertIs(result.status, expected)
            self.assertEqual(self.default_path.exists(), self.default_existed_before)
        finally:
            app.close()


if __name__ == "__main__":
    unittest.main()
