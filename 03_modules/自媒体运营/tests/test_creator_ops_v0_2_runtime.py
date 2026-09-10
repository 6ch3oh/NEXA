from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.api.contracts import API_VERSION, CommandStatus
from creator_ops.application.runtime import DurableTaskStatus, RecoveryDecision
from creator_ops.persistence.sqlite_adapter import SCHEMA_VERSION


class CreatorOpsV02RuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "creator_ops_v02.sqlite3"
        self.now = datetime(2026, 8, 13, tzinfo=timezone.utc)
        self.app = create_creator_ops_application(self.db)
        self.assertEqual(self.app.initialize_local_store(confirmation=True).status.value, "SUCCESS")

    def tearDown(self) -> None:
        self.app.close()
        self.temp.cleanup()

    def test_api_and_schema_are_v0_2(self) -> None:
        self.assertEqual(API_VERSION, "0.2")
        self.assertEqual(self.app.get_runtime_info().schema_version, SCHEMA_VERSION)

    def test_task_create_is_idempotent_and_not_work_item_truth(self) -> None:
        first = self.app.create_runtime_task(
            task_id="task-1", content_id="content-1", task_type="RESEARCH",
            idempotency_key="research:content-1", now=self.now,
        )
        second = self.app.create_runtime_task(
            task_id="task-other", content_id="content-1", task_type="RESEARCH",
            idempotency_key="research:content-1", now=self.now,
        )
        self.assertIs(first.status, CommandStatus.SUCCESS)
        self.assertIs(second.status, CommandStatus.SUCCESS)
        self.assertEqual(second.data.task_id, "task-1")
        self.assertEqual(len(self.app.list_runtime_tasks()), 1)
        self.assertEqual(self.app._root.store.work_item_overlays.list(), ())

    def test_lock_acquire_heartbeat_conflict_and_complete(self) -> None:
        self.app.create_runtime_task(
            task_id="task-1", content_id="content-1", task_type="DRAFT",
            idempotency_key="draft:content-1", now=self.now,
        )
        acquired = self.app.acquire_runtime_task("task-1", owner="worker-1", now=self.now)
        self.assertEqual(acquired.data.fencing_token, 1)
        same = self.app.acquire_runtime_task("task-1", owner="worker-1", now=self.now)
        self.assertEqual(same.data.fencing_token, 1)
        conflict = self.app.acquire_runtime_task("task-1", owner="worker-2", now=self.now)
        self.assertIs(conflict.status, CommandStatus.VALIDATION_ERROR)
        refreshed = self.app.heartbeat_runtime_task(
            "task-1", owner="worker-1", fencing_token=1, now=self.now + timedelta(seconds=30),
        )
        self.assertGreater(refreshed.data.expires_at, acquired.data.expires_at)
        done = self.app.complete_runtime_task(
            "task-1", owner="worker-1", fencing_token=1, now=self.now + timedelta(seconds=40),
        )
        self.assertIs(done.data.status, DurableTaskStatus.SUCCEEDED)
        again = self.app.complete_runtime_task(
            "task-1", owner="worker-1", fencing_token=1, now=self.now + timedelta(seconds=50),
        )
        self.assertIs(again.status, CommandStatus.SUCCESS)

    def test_public_release_runtime_task_is_safe_and_persistent(self) -> None:
        self.app.create_runtime_task(
            task_id="task-release", content_id="SYSTEM_VALIDATION", task_type="RESEARCH",
            idempotency_key="release:SYSTEM_VALIDATION", now=self.now,
        )
        acquired = self.app.acquire_runtime_task("task-release", owner="worker", now=self.now)
        released = self.app.release_runtime_task(
            "task-release", owner="worker", fencing_token=acquired.data.fencing_token,
            now=self.now + timedelta(seconds=1),
        )
        self.assertIs(released.status, CommandStatus.SUCCESS)
        self.assertIsNotNone(released.data.released_at)
        self.app.close()
        reopened = create_creator_ops_application(self.db)
        try:
            reopened.open()
            self.assertEqual(reopened._root.store.runtime.list_active_locks(), ())
        finally:
            reopened.close()

    def test_restart_preserves_running_task_and_stale_lock_recovery(self) -> None:
        self.app.create_runtime_task(
            task_id="task-package", content_id="content-1", task_type="PACKAGE_BUILD",
            idempotency_key="package:content-1", now=self.now,
        )
        self.app.acquire_runtime_task("task-package", owner="worker-1", now=self.now)
        self.app.close()
        reopened = create_creator_ops_application(self.db)
        try:
            self.assertEqual(reopened.open().status.value, "SUCCESS")
            task = reopened.list_runtime_tasks()[0]
            self.assertIs(task.status, DurableTaskStatus.RUNNING)
            recovered = reopened.recover_runtime(now=self.now + timedelta(minutes=10))
            self.assertIs(recovered.status, CommandStatus.SUCCESS)
            self.assertEqual(recovered.data[0].decision, RecoveryDecision.ROLLBACK_STAGING)
            self.assertIs(reopened.list_runtime_tasks()[0].status, DurableTaskStatus.BLOCKED)
            self.assertEqual(len(reopened.list_recovery_evidence("task-package")), 1)
        finally:
            reopened.close()

    def test_v0_1_database_migrates_additively_and_preserves_rows(self) -> None:
        self.app.close()
        self.db.unlink()
        raw = sqlite3.connect(self.db)
        raw.executescript("""
        CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        INSERT INTO metadata VALUES('schema_version','creator_ops_schema_v0.1');
        CREATE TABLE sentinel(id TEXT PRIMARY KEY,value TEXT NOT NULL);
        INSERT INTO sentinel VALUES('keep','untouched');
        """)
        raw.commit(); raw.close()
        app = create_creator_ops_application(self.db)
        try:
            self.assertEqual(app.open().status.value, "SUCCESS")
            self.assertEqual(app.get_runtime_info().schema_version, SCHEMA_VERSION)
            self.assertEqual(app._root.store.connection.execute(
                "SELECT value FROM sentinel WHERE id='keep'"
            ).fetchone()[0], "untouched")
        finally:
            app.close()

    def test_health_reports_runtime_and_no_network(self) -> None:
        health = self.app.health()
        self.assertEqual(health.task_runtime_status, "READY")
        self.assertEqual(health.network_capability, "NONE")
        self.assertEqual(health.automatic_publishing, "NONE")
        self.assertEqual(health.import_authorization_state, "PRODUCTION_IMPORT_NOT_AUTHORIZED")


if __name__ == "__main__":
    unittest.main()
