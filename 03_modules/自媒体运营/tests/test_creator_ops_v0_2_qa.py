from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.api.contracts import CommandStatus


class CreatorOpsV02QATests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "qa.sqlite3"
        self.packages = Path(self.temp.name) / "packages"
        self.now = datetime(2026, 8, 13, tzinfo=timezone.utc)
        self.app = create_creator_ops_application(self.db)
        self.app.initialize_local_store(confirmation=True)
        self.app.create_creator(creator_id="creator", name="Creator", now=self.now)
        self.app.create_account(
            account_id="B3", creator_id="creator", legacy_account_code="B3",
            platform="xiaohongshu", account_name="b3", display_name="B3",
            content_direction="AI learning", now=self.now,
        )
        self.app.create_idea(
            content_id="content", creator_id="creator", target_accounts=("B3",),
            topic="Synthetic", content_type="IMAGE_POST",
            platform_intent=("xiaohongshu",), now=self.now,
        )
        self.app.start_draft("content", title="Title", body="Body", script_reference=None, now=self.now)
        self.app.attach_asset(
            "content", asset_id="cover", asset_type="COVER", location="reference://cover",
            account_relations=("B3",), creator_id="creator", now=self.now,
        )
        self.app.submit_for_review("content", now=self.now)
        self.app.approve_review("content", now=self.now)

    def tearDown(self) -> None:
        self.app.close(); self.temp.cleanup()

    def test_qa_receipts_persist_across_restart(self) -> None:
        content = self.app.run_content_qa("content", now=self.now)
        assets = self.app.run_asset_qa("content", now=self.now)
        self.assertEqual(content.data.status.value, "PASS")
        self.assertEqual(assets.data.status.value, "PASS")
        self.app.close()
        reopened = create_creator_ops_application(self.db)
        try:
            reopened.open()
            self.assertEqual(len(reopened.list_qa_receipts("content")), 2)
        finally:
            reopened.close()

    def test_package_qa_and_publish_gate_require_full_pass(self) -> None:
        blocked = self.app.mark_ready_to_publish("content", now=self.now)
        self.assertIs(blocked.status, CommandStatus.REJECTED)
        package = self.app.build_local_package(
            "content", account_id="B3", package_id="pkg-content",
            target_root=self.packages, now=self.now,
        )
        self.assertIs(package.status, CommandStatus.SUCCESS)
        self.assertIs(self.app.run_content_qa("content", now=self.now).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.run_asset_qa("content", now=self.now).status, CommandStatus.SUCCESS)
        package_qa = self.app.run_package_qa(
            "content", package_id="pkg-content", manifest_path=package.data.manifest_path,
            now=self.now,
        )
        self.assertEqual(package_qa.data.status.value, "PASS")
        publish_qa = self.app.run_publish_prep_qa(
            "content", package_id="pkg-content", now=self.now,
        )
        self.assertEqual(publish_qa.data.status.value, "PASS")
        ready = self.app.mark_ready_to_publish("content", now=self.now)
        self.assertIs(ready.status, CommandStatus.SUCCESS)

    def test_missing_asset_and_invalid_manifest_fail(self) -> None:
        self.app._root.store.connection.execute(
            "DELETE FROM content_asset_relations WHERE content_id='content'"
        )
        asset_qa = self.app.run_asset_qa("content", now=self.now)
        self.assertEqual(asset_qa.data.status.value, "FAIL")
        bad = Path(self.temp.name) / "bad.json"; bad.write_text("not-json", encoding="utf-8")
        package_qa = self.app.run_package_qa(
            "content", package_id="pkg-bad", manifest_path=bad, now=self.now,
        )
        self.assertEqual(package_qa.data.status.value, "FAIL")

    def test_visual_qa_requires_operator_evidence_and_never_calls_ai(self) -> None:
        pending = self.app.run_visual_qa(
            "content", package_id=None,
            operator_checks=({"check_id": "visual:disclosure", "status": "PENDING"},), now=self.now,
        )
        passed = self.app.run_visual_qa(
            "content", package_id="pkg-visual",
            operator_checks=({"check_id": "visual:disclosure", "status": "PASS",
                              "evidence": ["operator://checked"]},),
            now=self.now.replace(microsecond=1),
        )
        self.assertEqual(pending.data.status.value, "MANUAL_REVIEW")
        self.assertEqual(passed.data.status.value, "PASS")
        self.assertEqual(self.app.health().network_capability, "NONE")


if __name__ == "__main__":
    unittest.main()
