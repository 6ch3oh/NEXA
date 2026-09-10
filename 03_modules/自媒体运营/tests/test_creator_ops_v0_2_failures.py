from __future__ import annotations

import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from creator_ops.api.application import create_creator_ops_application
from creator_ops.api.contracts import CommandStatus
from creator_ops.application.package_writer import LocalPackageWriter, PackageWriteStatus
from creator_ops.application.production_workflow import (
    ProductionAssetInput, ProductionWorkflowRequest,
)
from creator_ops.persistence.sqlite_adapter import DatabaseLocation


class FailureRestartIdempotencyV02Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(); self.now = datetime(2026, 8, 13, tzinfo=timezone.utc)
        self.db = Path(self.temp.name) / "failure.sqlite3"; self.packages = Path(self.temp.name) / "packages"
        self.app = create_creator_ops_application(self.db); self.app.initialize_local_store(confirmation=True)

    def tearDown(self) -> None:
        self.app.close(); self.temp.cleanup()

    def seed_identity(self) -> None:
        self.app.create_creator(creator_id="creator", name="Creator", now=self.now)
        self.app.create_account(
            account_id="B3", creator_id="creator", platform="xiaohongshu",
            account_name="b3", display_name="B3", content_direction="AI learning",
            legacy_account_code="B3", now=self.now,
        )

    def request(self) -> ProductionWorkflowRequest:
        return ProductionWorkflowRequest(
            "workflow", "content", "creator", "B3", "research", "Local workflow", "education",
            "source", "USER_NOTE", "user://note", "Local evidence", ("user://evidence",),
            "Title", "Body", "IMAGE_POST", ("xiaohongshu",),
            (ProductionAssetInput("cover", "COVER", "reference://cover"),),
            "package", self.packages, "operator",
        )

    def test_db_failure_rolls_back_task_and_audit_atomically(self) -> None:
        connection = self.app._root.store.connection
        connection.execute("""
        CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_events
        BEGIN SELECT RAISE(ABORT, 'synthetic'); END
        """)
        result = self.app.create_runtime_task(
            task_id="task", content_id="content", task_type="RESEARCH",
            idempotency_key="task", now=self.now,
        )
        self.assertIn(result.status, {CommandStatus.CONFLICT, CommandStatus.STORAGE_ERROR})
        self.assertEqual(self.app.list_runtime_tasks(), ())
        self.assertEqual(self.app.get_audit_trail(), ())

    def test_two_connections_cannot_acquire_same_fresh_lock(self) -> None:
        self.app.create_runtime_task(
            task_id="task", content_id="content", task_type="RESEARCH",
            idempotency_key="task", now=self.now,
        )
        other = create_creator_ops_application(self.db)
        try:
            other.open()
            first = self.app.acquire_runtime_task("task", owner="worker-1", now=self.now)
            second = other.acquire_runtime_task("task", owner="worker-2", now=self.now)
            self.assertIs(first.status, CommandStatus.SUCCESS)
            self.assertIs(second.status, CommandStatus.VALIDATION_ERROR)
            self.assertEqual(self.app._root.store.runtime.get_lock("task").owner, "worker-1")
        finally:
            other.close()

    def test_bad_recovery_state_is_reported_not_swallowed(self) -> None:
        self.app.create_runtime_task(
            task_id="task", content_id="content", task_type="QA",
            idempotency_key="task", now=self.now,
        )
        self.app.acquire_runtime_task("task", owner="worker", now=self.now)
        self.app._root.store.connection.execute(
            "UPDATE durable_tasks SET status='CORRUPT' WHERE task_id='task'"
        )
        result = self.app.recover_runtime(now=self.now + timedelta(minutes=10))
        self.assertIs(result.status, CommandStatus.VALIDATION_ERROR)
        self.assertIsNotNone(result.error)

    def test_two_package_builders_never_both_create(self) -> None:
        from tests.test_creator_ops_v0_2_package_writer import PackageWriterV02Tests
        helper = PackageWriterV02Tests(); helper.temp = self.temp; helper.root = self.packages
        helper.writer = LocalPackageWriter(self.packages); helper.now = self.now
        request = helper.request()
        barrier = threading.Barrier(2); results = []
        def run() -> None:
            barrier.wait(); results.append(LocalPackageWriter(self.packages).write(request))
        threads = [threading.Thread(target=run), threading.Thread(target=run)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(sum(item.status is PackageWriteStatus.CREATED for item in results), 1)
        self.assertTrue(all(item.status in {
            PackageWriteStatus.CREATED, PackageWriteStatus.IDEMPOTENT,
            PackageWriteStatus.FAILED, PackageWriteStatus.CONFLICT,
        } for item in results))
        self.assertTrue((self.packages / "B3" / "content-001" / LocalPackageWriter.MANIFEST).is_file())

    def test_publish_metrics_review_same_payload_idempotent_different_payload_conflicts(self) -> None:
        self.seed_identity(); result = self.app.run_production_workflow(self.request(), now=self.now)
        self.assertTrue(result.manual_workbench_ready)
        published = self.app.confirm_manual_publish(
            "content", "B3", actual_publish_time=self.now, manual_confirmation=True, now=self.now,
        )
        repeat_publish = self.app.confirm_manual_publish(
            "content", "B3", actual_publish_time=self.now, manual_confirmation=True, now=self.now,
        )
        self.assertIs(repeat_publish.status, CommandStatus.SUCCESS)
        self.assertEqual(len(self.app.get_content_detail("content").publish_records), 1)
        publish_id = published.entity_id
        metrics = dict(
            content_id="content", publish_record_id=publish_id, metrics_id="metrics",
            views=0, likes=0, collected_at=self.now, now=self.now,
        )
        self.assertIs(self.app.record_metrics(**metrics).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.record_metrics(**metrics).status, CommandStatus.SUCCESS)
        conflict_metrics = dict(metrics); conflict_metrics["views"] = 1
        self.assertIs(self.app.record_metrics(**conflict_metrics).status, CommandStatus.CONFLICT)
        review = dict(
            content_id="content", publish_record_id=publish_id, metrics_id="metrics", review_id="review",
            strengths=("clear",), weaknesses=(), reusable_patterns=(), failed_patterns=(),
            next_action="repeat", evidence=("local://evidence",), now=self.now,
        )
        self.assertIs(self.app.complete_review(**review).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.complete_review(**review).status, CommandStatus.SUCCESS)
        conflict_review = dict(review); conflict_review["strengths"] = ("different",)
        self.assertIs(self.app.complete_review(**conflict_review).status, CommandStatus.CONFLICT)
        detail = self.app.get_content_detail("content")
        self.assertEqual(len(detail.metrics), 1); self.assertEqual(len(detail.reviews), 1)

    def test_staging_rollback_requires_confirmation_and_is_audited(self) -> None:
        staging = self.packages / ".staging" / "package.staging"
        staging.mkdir(parents=True)
        (staging / "partial.txt").write_text("partial", encoding="utf-8")
        rejected = self.app.rollback_package_staging(
            package_id="package", target_root=self.packages, content_id="content",
            operator_confirmation=False, now=self.now,
        )
        self.assertIs(rejected.status, CommandStatus.CONFIRMATION_REQUIRED)
        self.assertTrue(staging.exists())
        self.assertEqual(self.app.get_audit_trail(content_id="content"), ())
        removed = self.app.rollback_package_staging(
            package_id="package", target_root=self.packages, content_id="content",
            operator_confirmation=True, now=self.now,
        )
        self.assertIs(removed.status, CommandStatus.SUCCESS)
        self.assertFalse(staging.exists())
        self.assertEqual(self.app.get_audit_trail(content_id="content")[-1].result, "REMOVED")

    def test_health_checks_formal_database_not_injected_test_database(self) -> None:
        formal = Path(self.temp.name) / "formal.sqlite3"
        with patch.object(DatabaseLocation, "default_path", return_value=formal):
            self.assertFalse(self.app.health().production_database_exists)
            formal.touch()
            self.assertTrue(self.app.health().production_database_exists)


if __name__ == "__main__":
    unittest.main()
