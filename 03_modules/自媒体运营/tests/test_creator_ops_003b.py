from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT / "src"))

from creator_ops.application.work_queue import (  # noqa: E402
    FieldOwnership, NextActionType, OperatorWorkState, Priority,
    WorkItemStatus, WorkQueueService, WorkType,
)
from creator_ops.application.workbenches import (  # noqa: E402
    ActivityEventType, ActivityViewService, ChecklistStatus,
    ManualPublishingWorkbenchService, MetricsBackfillWorkbenchService,
    ReviewWorkbenchService,
)
from creator_ops.domain.models import ContentState, Metrics, Provenance  # noqa: E402
from creator_ops.fixtures import load_fixture  # noqa: E402
from creator_ops.services import ContentPipelineService, MetricsInputMode, PipelineError  # noqa: E402
from creator_ops.viewmodels.operator_dashboard import build_account_workload, build_operator_dashboard  # noqa: E402
from creator_ops.workbench_fixtures import load_workbench_fixture  # noqa: E402


UTC = timezone.utc


class CreatorOpsWorkbenchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        baseline = load_fixture(MODULE_ROOT / "tests" / "fixtures" / "creator_ops_minimal.json")
        cls.fixture_path = MODULE_ROOT / "tests" / "fixtures" / "creator_ops_workbench.json"
        cls.fixture = load_workbench_fixture(cls.fixture_path, baseline)
        cls.now = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
        cls.provenance = Provenance("workbench_fixture", "commands/003b", cls.now, notes="TEST / SYNTHETIC")

    def setUp(self) -> None:
        self.queue_service = WorkQueueService()
        self.queue = self.derive()
        self.content = {item.content_id: item for item in self.fixture.contents}
        self.accounts = {item.account_id: item for item in self.fixture.accounts}
        self.publishes = {item.content_id: item for item in self.fixture.publish_records}
        self.metrics = {item.publish_record_id: item for item in self.fixture.metrics}

    def derive(self, **overrides):
        args = dict(
            contents=self.fixture.contents, accounts=self.fixture.accounts, assets=self.fixture.assets,
            publish_records=self.fixture.publish_records, metrics=self.fixture.metrics,
            reviews=self.fixture.reviews, now=self.now, due_dates=self.fixture.due_dates,
        )
        args.update(overrides)
        return self.queue_service.derive_work_items(**args)

    def work(self, content_id: str):
        return next(item for item in self.queue if item.content_id == content_id)

    def test_fixture_has_all_15_synthetic_scenarios(self) -> None:
        raw = json.loads(self.fixture_path.read_text(encoding="utf-8"))
        self.assertTrue(raw["synthetic_data_only"])
        self.assertEqual(len(raw["scenarios"]), 15)
        self.assertEqual(len(self.fixture.contents), 15)
        self.assertEqual({item.legacy_account_code for item in self.fixture.accounts}, {"A1", "A2", "B1", "B2", "B3", "B4"})

    def test_work_queue_derives_work_types_and_next_actions(self) -> None:
        expected = {
            "wb-idea": (WorkType.DRAFT, NextActionType.WRITE_DRAFT),
            "wb-draft": (WorkType.ASSET, NextActionType.PREPARE_ASSETS),
            "wb-review": (WorkType.REVIEW, NextActionType.REVIEW_CONTENT),
            "wb-ready-pass": (WorkType.MANUAL_PUBLISH, NextActionType.MANUAL_PUBLISH),
            "wb-published-no-metrics": (WorkType.METRICS_BACKFILL, NextActionType.BACKFILL_METRICS),
            "wb-review-pending": (WorkType.POST_PUBLISH_REVIEW, NextActionType.REVIEW_PERFORMANCE),
        }
        for content_id, (work_type, action) in expected.items():
            item = self.work(content_id)
            self.assertIs(item.work_type, work_type)
            self.assertIs(item.next_action.next_action_type, action)
            self.assertTrue(item.next_action.required_inputs)

    def test_derivation_does_not_mutate_content_lifecycle(self) -> None:
        before = tuple((item.content_id, item.current_state, item.updated_at) for item in self.fixture.contents)
        self.derive()
        after = tuple((item.content_id, item.current_state, item.updated_at) for item in self.fixture.contents)
        self.assertEqual(before, after)

    def test_blocked_done_and_cancelled_items(self) -> None:
        self.assertIs(self.work("wb-asset-missing").status, WorkItemStatus.BLOCKED)
        self.assertIs(self.work("wb-rejected").status, WorkItemStatus.BLOCKED)
        self.assertIs(self.work("wb-blocked").status, WorkItemStatus.BLOCKED)
        self.assertIs(self.work("wb-reviewed").status, WorkItemStatus.DONE)
        self.assertIs(self.work("wb-archived").status, WorkItemStatus.CANCELLED)

    def test_operator_state_boundary_is_explicit(self) -> None:
        item = self.work("wb-idea")
        override = OperatorWorkState(WorkItemStatus.IN_PROGRESS, updated_at=self.now)
        queue = self.derive(operator_states={item.work_item_id: override})
        changed = next(x for x in queue if x.content_id == "wb-idea")
        self.assertIs(changed.status, WorkItemStatus.IN_PROGRESS)
        self.assertIs(changed.field_ownership["status"], FieldOwnership.OPERATOR_STATE)
        self.assertIs(changed.field_ownership["work_type"], FieldOwnership.DERIVED)
        self.assertIs(self.content["wb-idea"].current_state, ContentState.IDEA)

    def test_priority_is_explainable_and_deterministic(self) -> None:
        self.assertIs(self.work("wb-draft").priority, Priority.URGENT)
        self.assertIn("Overdue", self.work("wb-draft").priority_reason)
        self.assertIs(self.work("wb-blocked").priority, Priority.URGENT)
        self.assertIs(self.work("wb-ready-pass").priority, Priority.HIGH)
        self.assertTrue(all(item.priority_reason for item in self.queue))
        self.assertEqual(self.queue, self.derive())

    def test_queue_filters(self) -> None:
        self.assertTrue(self.queue_service.get_blocked_items(self.queue))
        self.assertTrue(self.queue_service.get_ready_to_publish_items(self.queue))
        self.assertTrue(self.queue_service.get_metrics_backfill_items(self.queue))
        self.assertTrue(self.queue_service.get_review_pending_items(self.queue))
        self.assertTrue(self.queue_service.get_next_actions(self.queue))

    def test_ready_workbench_reuses_content_package_and_passes_checklist(self) -> None:
        content = self.content["wb-ready-pass"]
        view = ManualPublishingWorkbenchService().build(
            content, target_account_id="acct-b3", accounts=self.fixture.accounts,
            assets=self.fixture.assets, planned_time=self.now,
        )
        self.assertTrue(view.ready)
        self.assertEqual(view.content_package.content, content)
        self.assertEqual(view.cover_asset.asset_id, "wb-cover")
        self.assertFalse(any(item.status is ChecklistStatus.FAIL for item in view.readiness_checks))

    def test_ready_workbench_exposes_failed_checklist(self) -> None:
        view = ManualPublishingWorkbenchService().build(
            self.content["wb-ready-fail"], target_account_id="acct-b4",
            accounts=self.fixture.accounts, assets=self.fixture.assets,
        )
        self.assertFalse(view.ready)
        failed = {item.check_id for item in view.readiness_checks if item.status is ChecklistStatus.FAIL}
        self.assertTrue({"CONTENT_BODY_READY", "REQUIRED_ASSETS_READY", "REVIEW_PASSED",
                         "ACCOUNT_ACTIVE", "PROVENANCE_ACCEPTABLE", "PUBLISH_PACKAGE_COMPLETE"}.issubset(failed))

    def test_failed_checklist_cannot_record_publish(self) -> None:
        item = self.work("wb-ready-fail")
        with self.assertRaises(PipelineError):
            ManualPublishingWorkbenchService().confirm_manual_publish(
                self.content["wb-ready-fail"], target_account_id="acct-b4",
                accounts=self.fixture.accounts, assets=self.fixture.assets,
                actual_publish_time=self.now, external_url=None, external_post_id=None,
                manual_confirmation=True, provenance=self.provenance, now=self.now,
                current_work_item=item,
            )
        self.assertIs(self.content["wb-ready-fail"].current_state, ContentState.READY_TO_PUBLISH)

    def test_manual_confirmation_false_is_rejected_by_002_pipeline(self) -> None:
        with self.assertRaises(PipelineError):
            ManualPublishingWorkbenchService().confirm_manual_publish(
                self.content["wb-manual-ready"], target_account_id="acct-a1",
                accounts=self.fixture.accounts, assets=self.fixture.assets,
                actual_publish_time=self.now, external_url=None, external_post_id=None,
                manual_confirmation=False, provenance=self.provenance, now=self.now,
                current_work_item=self.work("wb-manual-ready"),
            )

    def test_manual_publish_success_reuses_pipeline_and_updates_work_items(self) -> None:
        pipeline = Mock(wraps=ContentPipelineService())
        service = ManualPublishingWorkbenchService(pipeline=pipeline)
        result = service.confirm_manual_publish(
            self.content["wb-manual-ready"], target_account_id="acct-a1",
            accounts=self.fixture.accounts, assets=self.fixture.assets,
            actual_publish_time=self.now, external_url=None, external_post_id="synthetic-post",
            manual_confirmation=True, provenance=self.provenance, now=self.now,
            current_work_item=self.work("wb-manual-ready"),
        )
        pipeline.record_manual_publish.assert_called_once()
        self.assertIs(result.pipeline_result.content.current_state, ContentState.PUBLISHED)
        self.assertIs(result.completed_work_item.status, WorkItemStatus.DONE)
        self.assertIs(result.next_work_item.work_type, WorkType.METRICS_BACKFILL)
        self.assertFalse(hasattr(service, "automatic_publish"))

    def test_metrics_backfill_missing_and_null_zero(self) -> None:
        missing_content = self.content["wb-published-no-metrics"]
        missing_record = self.publishes[missing_content.content_id]
        missing = MetricsBackfillWorkbenchService.build(missing_content, missing_record, None)
        self.assertEqual(missing.missing_metrics, missing.metric_fields)
        present_content = self.content["wb-metrics-present"]
        present_record = self.publishes[present_content.content_id]
        metrics = self.metrics[present_record.publish_record_id]
        present = MetricsBackfillWorkbenchService.build(present_content, present_record, metrics)
        self.assertIsNone(present.existing_metrics.views)
        self.assertEqual(present.existing_metrics.impressions, 0)
        self.assertIn("views", present.missing_metrics)
        self.assertNotIn("impressions", present.missing_metrics)

    def test_metrics_recording_updates_derived_queue(self) -> None:
        content = self.content["wb-published-no-metrics"]
        record = self.publishes[content.content_id]
        result = ContentPipelineService().record_metrics(
            content, record, metrics_id="wb-new-metrics", views=None, impressions=0,
            likes=0, comments=None, favorites=0, shares=0, followers_delta=None,
            engagement=0.0, collected_at=self.now, input_mode=MetricsInputMode.MANUAL,
            provenance=self.provenance, now=self.now,
        )
        updated = self.queue_service.derive_work_items(
            (result.content,), accounts=self.fixture.accounts, assets=self.fixture.assets,
            publish_records=(record,), metrics=(result.metrics,), reviews=(), now=self.now,
        )[0]
        self.assertIs(updated.work_type, WorkType.POST_PUBLISH_REVIEW)
        self.assertIs(updated.next_action.next_action_type, NextActionType.REVIEW_PERFORMANCE)
        self.assertIsNone(result.metrics.views)
        self.assertEqual(result.metrics.impressions, 0)

    def test_review_workbench_only_suggests_missing_fields(self) -> None:
        content = self.content["wb-review-pending"]
        record = self.publishes[content.content_id]
        view = ReviewWorkbenchService.build(
            content, record, metrics=self.metrics[record.publish_record_id],
            assets=self.fixture.assets, existing_review=None,
        )
        self.assertEqual(view.suggested_fields_to_fill, view.missing_review_sections)
        self.assertIn("strengths", view.suggested_fields_to_fill)
        self.assertFalse(hasattr(view, "ai_assessment"))

    def test_review_completion_removes_pending_item(self) -> None:
        content = self.content["wb-review-pending"]
        record = self.publishes[content.content_id]
        metrics = self.metrics[record.publish_record_id]
        result = ContentPipelineService().complete_review(
            content, record, metrics, review_id="wb-new-review", assets=(),
            strengths=("Synthetic",), weaknesses=(), reusable_patterns=(),
            failed_patterns=(), next_action="Synthetic", evidence=("fixture://review",),
            provenance=self.provenance, now=self.now,
        )
        item = self.queue_service.derive_work_items(
            (result.content,), accounts=self.fixture.accounts, assets=(),
            publish_records=(record,), metrics=(metrics,), reviews=(result.review,), now=self.now,
        )[0]
        self.assertIs(item.status, WorkItemStatus.DONE)
        self.assertFalse(self.queue_service.get_review_pending_items((item,)))

    def test_reviewed_fixture_not_in_review_pending(self) -> None:
        pending_ids = {item.content_id for item in self.queue_service.get_review_pending_items(self.queue)
                       if item.status is not WorkItemStatus.DONE}
        self.assertNotIn("wb-reviewed", pending_ids)
        self.assertIn("wb-review-pending", pending_ids)

    def test_operator_dashboard_contains_required_aggregates(self) -> None:
        dashboard = build_operator_dashboard(
            self.fixture.accounts, self.fixture.contents, self.fixture.assets,
            self.fixture.publish_records, self.fixture.metrics, self.fixture.reviews,
            now=self.now, due_dates=self.fixture.due_dates,
        )
        self.assertEqual(dashboard.data_classification, "TEST / SYNTHETIC")
        self.assertEqual(dashboard.summary.total_active, 13)
        self.assertEqual(dashboard.summary.ready_to_publish, len(dashboard.ready_to_publish))
        self.assertEqual(dashboard.summary.blocked, len(dashboard.blocked_items))
        self.assertTrue(dashboard.metrics_backfill)
        self.assertTrue(dashboard.review_pending)
        self.assertTrue(dashboard.recently_published)
        self.assertTrue(dashboard.next_actions)

    def test_account_workload_covers_a_b_matrix_and_multi_account_content(self) -> None:
        workloads = build_account_workload(
            self.fixture.accounts, self.fixture.contents, self.fixture.publish_records,
            self.fixture.metrics, self.fixture.reviews, now=self.now,
        )
        self.assertEqual({item.legacy_account_code for item in workloads}, {"A1", "A2", "B1", "B2", "B3", "B4"})
        by_id = {item.account_id: item for item in workloads}
        self.assertGreaterEqual(by_id["acct-a1"].active_content_count, 3)
        self.assertGreaterEqual(by_id["acct-b1"].active_content_count, 3)
        self.assertEqual(by_id["acct-a1"].metrics_pending, 1)

    def test_activity_feed_is_deterministic_and_domain_derived(self) -> None:
        first = ActivityViewService.derive(
            self.fixture.contents, self.fixture.assets, self.fixture.publish_records,
            self.fixture.metrics, self.fixture.reviews,
        )
        second = ActivityViewService.derive(
            self.fixture.contents, self.fixture.assets, self.fixture.publish_records,
            self.fixture.metrics, self.fixture.reviews,
        )
        event_types = {item.event_type for item in first}
        self.assertEqual(first, second)
        self.assertTrue({ActivityEventType.CONTENT_CREATED, ActivityEventType.STATE_CHANGED,
                         ActivityEventType.ASSET_ATTACHED, ActivityEventType.READY_TO_PUBLISH,
                         ActivityEventType.MANUAL_PUBLISH_RECORDED, ActivityEventType.METRICS_RECORDED,
                         ActivityEventType.POST_PUBLISH_REVIEW_COMPLETED}.issubset(event_types))
        self.assertTrue(all(item.provenance for item in first))


if __name__ == "__main__":
    unittest.main()
