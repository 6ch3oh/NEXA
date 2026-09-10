from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.application.production_workflow import (
    ProductionAssetInput, ProductionStep, ProductionWorkflowRequest,
)


class ProductionWorkflowV02Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(); self.now = datetime(2026, 8, 13, tzinfo=timezone.utc)
        self.db = Path(self.temp.name) / "workflow.sqlite3"; self.packages = Path(self.temp.name) / "packages"
        self.app = create_creator_ops_application(self.db); self.app.initialize_local_store(confirmation=True)
        self.app.create_creator(creator_id="creator", name="Creator", now=self.now)
        self.app.create_account(
            account_id="B3", creator_id="creator", legacy_account_code="B3",
            platform="xiaohongshu", account_name="b3", display_name="B3",
            content_direction="AI learning", now=self.now,
        )

    def tearDown(self) -> None:
        self.app.close(); self.temp.cleanup()

    def request(self, *, asset_location: str = "reference://cover") -> ProductionWorkflowRequest:
        return ProductionWorkflowRequest(
            "workflow-1", "content-1", "creator", "B3", "research-1",
            "Local AI workflow", "educational image post", "source-1", "USER_NOTE",
            "user://note", "Use a deterministic local workflow", ("user://evidence",),
            "Local workflow", "Synthetic body", "IMAGE_POST", ("xiaohongshu",),
            (ProductionAssetInput("cover-1", "COVER", asset_location),),
            "package-1", self.packages, "operator-1",
        )

    def test_end_to_end_stops_at_manual_publish_workbench(self) -> None:
        result = self.app.run_production_workflow(self.request(), now=self.now)
        self.assertIs(result.step, ProductionStep.COMPLETE)
        self.assertTrue(result.manual_workbench_ready)
        self.assertEqual(result.next_action, "MANUAL_PUBLISH")
        self.assertEqual(result.automatic_publishing, "NONE")
        detail = self.app.get_content_detail("content-1")
        self.assertEqual(detail.content.current_state, "READY_TO_PUBLISH")
        self.assertEqual(detail.publish_records, ())
        self.assertGreaterEqual(len(self.app.get_audit_trail(content_id="content-1")), 8)

    def test_repeat_run_is_idempotent(self) -> None:
        first = self.app.run_production_workflow(self.request(), now=self.now)
        second = self.app.run_production_workflow(self.request(), now=self.now)
        self.assertIs(first.step, ProductionStep.COMPLETE)
        self.assertIs(second.step, ProductionStep.COMPLETE)
        self.assertEqual(len(self.app.list_runtime_tasks()), 7)
        self.assertEqual(len(self.app.list_qa_receipts("content-1")), 4)

    def test_interrupted_workflow_can_inspect_and_resume_after_restart(self) -> None:
        request = self.request()
        # Pre-create and finish research task only, simulating a process boundary.
        self.app.create_runtime_task(
            task_id="workflow-1:RESEARCH", content_id="content-1", task_type="RESEARCH",
            idempotency_key="workflow-1:RESEARCH", now=self.now,
        )
        lock = self.app.acquire_runtime_task(
            "workflow-1:RESEARCH", owner="operator-1", now=self.now,
        ).data
        self.app.create_research(
            research_id="research-1", topic=request.topic, account_id="B3",
            content_intent=request.content_intent, now=self.now,
        )
        self.app.add_research_source(
            "research-1", source_id="source-1", source_type="USER_NOTE",
            reference="user://note", summary=request.research_summary,
            evidence=request.research_evidence, now=self.now,
        )
        self.app.synthesize_research("research-1", now=self.now)
        self.app.complete_runtime_task(
            "workflow-1:RESEARCH", owner="operator-1", fencing_token=lock.fencing_token, now=self.now,
        )
        self.app.close(); reopened = create_creator_ops_application(self.db)
        try:
            reopened.open()
            state = reopened.inspect_production_workflow("workflow-1", "content-1")
            self.assertIs(state.step, ProductionStep.DRAFT)
            result = reopened.run_production_workflow(request, now=self.now)
            self.assertIs(result.step, ProductionStep.COMPLETE)
        finally:
            reopened.close()

    def test_missing_asset_reference_does_not_publish(self) -> None:
        request = self.request(asset_location="")
        result = self.app.run_production_workflow(request, now=self.now)
        self.assertIsNot(result.step, ProductionStep.COMPLETE)
        self.assertFalse(result.manual_workbench_ready)
        self.assertEqual(self.app.get_content_detail("content-1").publish_records, ())


if __name__ == "__main__":
    unittest.main()
