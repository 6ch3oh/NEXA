from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT / "src"))

from creator_ops.application.persistent_service import PersistentCreatorOpsService  # noqa: E402
from creator_ops.application.work_queue import WorkItemStatus, WorkType  # noqa: E402
from creator_ops.application.workbenches import ActivityEventType  # noqa: E402
from creator_ops.domain.models import (  # noqa: E402
    ContentState, LegacyReference, Metrics, Provenance, PublicationMode,
    PublishRecord, PublishStatus,
)
from creator_ops.fixtures import load_fixture  # noqa: E402
from creator_ops.persistence import (  # noqa: E402
    DatabaseLocation, SCHEMA_VERSION, CreatorOpsQueryService, SQLiteCreatorOpsStore,
)
from creator_ops.persistence.contracts import WorkItemOverlay  # noqa: E402
from creator_ops.persistence.errors import PersistenceError, PersistenceErrorCode  # noqa: E402
from creator_ops.services import ContentPipelineService, MetricsInputMode  # noqa: E402
from creator_ops.workbench_fixtures import load_workbench_fixture  # noqa: E402


UTC = timezone.utc


class CreatorOpsPersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.baseline = load_fixture(MODULE_ROOT / "tests" / "fixtures" / "creator_ops_minimal.json")
        cls.workbench = load_workbench_fixture(
            MODULE_ROOT / "tests" / "fixtures" / "creator_ops_workbench.json", cls.baseline,
        )
        cls.fixture_path = MODULE_ROOT / "tests" / "fixtures" / "creator_ops_persistence.json"
        cls.now = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
        cls.provenance = Provenance("persistence_fixture", "commands/004", cls.now, notes="TEST / SYNTHETIC")

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "creator_ops_test.sqlite3"
        self.store = SQLiteCreatorOpsStore(self.db_path)

    def tearDown(self) -> None:
        try:
            self.store.close()
        except Exception:
            pass
        self.temp.cleanup()

    def seed_identity(self) -> None:
        self.store.creators.save(self.baseline.creator)
        for account in self.workbench.accounts:
            self.store.accounts.save(account)

    def seed_workbench(self) -> None:
        self.seed_identity()
        for content in self.workbench.contents:
            self.store.contents.save(content)
        for asset in self.workbench.assets:
            self.store.assets.save(asset)
        for publish in self.workbench.publish_records:
            self.store.publish_records.save(publish)
        for metric in self.workbench.metrics:
            self.store.metrics.save(metric)
        for review in self.workbench.reviews:
            self.store.reviews.save(review)

    def content(self, content_id: str):
        return next(item for item in self.workbench.contents if item.content_id == content_id)

    def test_persistence_fixture_is_synthetic_and_complete(self) -> None:
        raw = json.loads(self.fixture_path.read_text(encoding="utf-8"))
        self.assertTrue(raw["synthetic_data_only"])
        self.assertEqual(raw["database_kind"], "TEMPORARY_SQLITE")
        self.assertEqual(len(raw["coverage"]), 13)

    def test_current_schema_version_and_structured_tables(self) -> None:
        self.assertEqual(self.store.schema_version, SCHEMA_VERSION)
        self.assertTrue(DatabaseLocation.default_path().is_relative_to(MODULE_ROOT))
        with self.assertRaises(PersistenceError):
            SQLiteCreatorOpsStore("relative.sqlite3")
        tables = {row[0] for row in self.store.connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"creators", "accounts", "content_items", "assets", "content_asset_relations",
                         "publish_records", "metrics", "reviews", "work_item_overlays", "metadata"}.issubset(tables))
        self.assertNotIn("work_queue", tables)

    def test_creator_and_account_repository_round_trip_identity_and_conflict(self) -> None:
        self.seed_identity()
        creator = self.store.creators.get_by_id(self.baseline.creator.creator_id)
        a1 = self.store.accounts.get_by_id("acct-a1")
        self.assertEqual(creator.creator_id, self.baseline.creator.creator_id)
        self.assertEqual(a1.account_id, "acct-a1")
        self.assertEqual(a1.legacy_account_code, "A1")
        self.assertEqual(len(self.store.accounts.find_by_creator_id(creator.creator_id)), 6)
        with self.assertRaises(PersistenceError) as caught:
            self.store.creators.save(self.baseline.creator)
        self.assertIs(caught.exception.code, PersistenceErrorCode.CONFLICT)

    def test_content_serialization_hydration_preserves_semantics(self) -> None:
        self.seed_identity()
        original = replace(
            self.content("wb-idea"),
            legacy_reference=LegacyReference("synthetic_legacy", "Content", "legacy-004"),
            extension_fields={"operator_hint": "synthetic", "nullable": None},
        )
        self.store.contents.save(original)
        loaded = self.store.contents.get_by_id(original.content_id)
        self.assertEqual(loaded.content_id, original.content_id)
        self.assertIs(loaded.current_state, ContentState.IDEA)
        self.assertEqual(loaded.created_at, original.created_at)
        self.assertEqual(loaded.provenance, original.provenance)
        self.assertEqual(loaded.legacy_reference, original.legacy_reference)
        self.assertEqual(loaded.extension_fields, original.extension_fields)
        self.assertIsNone(loaded.title)

    def test_asset_relation_round_trip(self) -> None:
        self.seed_identity()
        content = self.content("wb-ready-pass")
        asset = self.workbench.assets[0]
        self.store.contents.save(content)
        self.store.assets.save(asset)
        loaded_content = self.store.contents.get_by_id(content.content_id)
        loaded_asset = self.store.assets.get_by_id(asset.asset_id)
        self.assertEqual(loaded_content.asset_references, (asset.asset_id,))
        self.assertEqual(loaded_asset.content_relations, (content.content_id,))
        self.assertEqual(self.store.assets.find_by_content_id(content.content_id), (loaded_asset,))

    def test_publish_metrics_review_repository_round_trip(self) -> None:
        self.seed_workbench()
        publish = self.store.publish_records.get_by_id("wb-publish-reviewed")
        metrics = self.store.metrics.get_by_id("wb-metrics-3")
        review = self.store.reviews.get_by_id("wb-review-complete")
        self.assertEqual(publish.content_id, "wb-reviewed")
        self.assertEqual(metrics.publish_record_id, publish.publish_record_id)
        self.assertEqual(review.metric_snapshot, metrics)
        self.assertEqual(self.store.reviews.find_by_content_id("wb-reviewed"), (review,))

    def test_not_found_error_is_stable_and_sanitized(self) -> None:
        with self.assertRaises(PersistenceError) as caught:
            self.store.contents.get_by_id("missing")
        self.assertIs(caught.exception.code, PersistenceErrorCode.NOT_FOUND)
        self.assertNotIn("SELECT", str(caught.exception))
        self.assertNotIn(str(self.db_path), str(caught.exception))

    def test_work_item_overlay_only_persists_operator_state(self) -> None:
        self.seed_workbench()
        queue = CreatorOpsQueryService(self.store).derive_work_queue(now=self.now)
        item = next(x for x in queue if x.content_id == "wb-idea")
        overlay = WorkItemOverlay(
            work_item_id=item.work_item_id, content_id=item.content_id,
            status=WorkItemStatus.IN_PROGRESS, due_at=self.now + timedelta(days=1),
            blocked_reason=None, operator_notes="Synthetic operator note", updated_at=self.now,
        )
        self.store.work_item_overlays.save(overlay)
        columns = {row[1] for row in self.store.connection.execute("PRAGMA table_info(work_item_overlays)")}
        self.assertEqual(columns, {"work_item_id", "content_id", "status", "due_at", "blocked_reason", "operator_notes", "updated_at", "version"})
        recovered = CreatorOpsQueryService(self.store).derive_work_queue(now=self.now)
        recovered_item = next(x for x in recovered if x.content_id == "wb-idea")
        self.assertIs(recovered_item.status, WorkItemStatus.IN_PROGRESS)
        self.assertIs(recovered_item.work_type, WorkType.DRAFT)
        self.assertIs(self.store.contents.get_by_id("wb-idea").current_state, ContentState.IDEA)

    def test_restart_recovery_rehydrates_domain_then_rederives_queue(self) -> None:
        self.seed_identity()
        pipeline = ContentPipelineService()
        idea = self.content("wb-idea")
        self.store.contents.save(idea)
        draft = pipeline.start_draft(idea, title="Restart synthetic", body="Synthetic body", script_reference=None, now=self.now)
        self.store.contents.update(draft)
        asset = replace(
            self.workbench.assets[0], asset_id="restart-asset", content_relations=(draft.content_id,),
            account_relations=("acct-a1",),
        )
        self.store.assets.save(asset)
        preparing = pipeline.attach_asset(draft, asset, now=self.now)
        self.store.contents.update(preparing)
        review = pipeline.submit_for_review(preparing, now=self.now)
        approved = pipeline.approve_review(review, now=self.now)
        ready = pipeline.mark_ready_to_publish(
            approved, accounts=self.store.accounts.list(), assets=(asset,), now=self.now,
        )
        self.store.contents.update(ready)
        queue_before = CreatorOpsQueryService(self.store).derive_work_queue(now=self.now)
        self.store.close()
        self.store = SQLiteCreatorOpsStore(self.db_path)
        loaded = self.store.contents.get_by_id(ready.content_id)
        queue_after = CreatorOpsQueryService(self.store).derive_work_queue(now=self.now)
        self.assertIs(loaded.current_state, ContentState.READY_TO_PUBLISH)
        self.assertEqual(loaded.provenance, idea.provenance)
        self.assertEqual([(x.content_id, x.work_type, x.status) for x in queue_before],
                         [(x.content_id, x.work_type, x.status) for x in queue_after])

    def test_manual_publish_transaction_reopen_and_queue_recovery(self) -> None:
        self.seed_identity()
        ready = self.content("wb-manual-ready")
        self.store.contents.save(ready)
        result = PersistentCreatorOpsService(self.store).record_manual_publish(
            content_id=ready.content_id, account_id="acct-a1", actual_publish_time=self.now,
            external_url=None, external_post_id="synthetic-004", manual_confirmation=True,
            provenance=self.provenance, now=self.now,
        )
        publish_id = result.pipeline_result.publish_record.publish_record_id
        self.store.close()
        self.store = SQLiteCreatorOpsStore(self.db_path)
        loaded = self.store.contents.get_by_id(ready.content_id)
        self.assertIs(loaded.current_state, ContentState.PUBLISHED)
        self.assertEqual(self.store.publish_records.get_by_id(publish_id).content_id, ready.content_id)
        queue = CreatorOpsQueryService(self.store).derive_work_queue(now=self.now)
        self.assertFalse(any(x.work_type is WorkType.MANUAL_PUBLISH and x.status is not WorkItemStatus.DONE for x in queue))
        self.assertTrue(any(x.work_type is WorkType.METRICS_BACKFILL for x in queue))
        events = CreatorOpsQueryService(self.store).operator_dashboard(now=self.now).activity_feed
        self.assertIn(ActivityEventType.MANUAL_PUBLISH_RECORDED, {x.event_type for x in events})

    def test_failed_manual_publish_transaction_rolls_back_content(self) -> None:
        self.seed_identity()
        ready = self.content("wb-manual-ready")
        self.store.contents.save(ready)
        duplicate_id = f"publish:{ready.content_id}:acct-a1:{int(self.now.timestamp())}"
        duplicate = PublishRecord(
            publish_record_id=duplicate_id, platform="demo-platform", account_id="acct-a1",
            content_id=ready.content_id, publish_status=PublishStatus.PUBLISHED,
            planned_time=None, actual_publish_time=self.now, external_url=None,
            external_post_id="preexisting", manual_confirmation=True, source="fixture",
            provenance=self.provenance, created_at=self.now, updated_at=self.now,
            publication_mode=PublicationMode.MANUAL,
        )
        self.store.publish_records.save(duplicate)
        with self.assertRaises(PersistenceError) as caught:
            PersistentCreatorOpsService(self.store).record_manual_publish(
                content_id=ready.content_id, account_id="acct-a1", actual_publish_time=self.now,
                external_url=None, external_post_id="duplicate", manual_confirmation=True,
                provenance=self.provenance, now=self.now,
            )
        self.assertIs(caught.exception.code, PersistenceErrorCode.TRANSACTION_FAILED)
        self.assertIs(self.store.contents.get_by_id(ready.content_id).current_state, ContentState.READY_TO_PUBLISH)
        self.assertFalse(self.store.work_item_overlays.list())

    def test_manual_confirmation_false_rolls_back(self) -> None:
        self.seed_identity()
        ready = self.content("wb-manual-ready")
        self.store.contents.save(ready)
        with self.assertRaises(PersistenceError):
            PersistentCreatorOpsService(self.store).record_manual_publish(
                content_id=ready.content_id, account_id="acct-a1", actual_publish_time=self.now,
                external_url=None, external_post_id=None, manual_confirmation=False,
                provenance=self.provenance, now=self.now,
            )
        self.assertIs(self.store.contents.get_by_id(ready.content_id).current_state, ContentState.READY_TO_PUBLISH)
        self.assertFalse(self.store.publish_records.list())

    def test_metrics_null_then_zero_survive_separate_reopens(self) -> None:
        self.seed_identity()
        content = self.content("wb-published-no-metrics")
        publish = next(x for x in self.workbench.publish_records if x.content_id == content.content_id)
        self.store.contents.save(content)
        self.store.publish_records.save(publish)
        result = PersistentCreatorOpsService(self.store).record_metrics(
            content_id=content.content_id, publish_record_id=publish.publish_record_id,
            metrics_id="persist-metrics", views=None, impressions=None, likes=None,
            comments=None, favorites=None, shares=None, followers_delta=None, engagement=None,
            collected_at=self.now, input_mode=MetricsInputMode.MANUAL,
            provenance=self.provenance, now=self.now,
        )
        self.store.close(); self.store = SQLiteCreatorOpsStore(self.db_path)
        self.assertIsNone(self.store.metrics.get_by_id(result.metrics.metrics_id).views)
        PersistentCreatorOpsService(self.store).update_metrics(
            result.metrics.metrics_id, collected_at=self.now, now=self.now,
            views=0, impressions=0, likes=0, comments=0, favorites=0, shares=0,
            followers_delta=0, engagement=0.0,
        )
        self.store.close(); self.store = SQLiteCreatorOpsStore(self.db_path)
        loaded = self.store.metrics.get_by_id(result.metrics.metrics_id)
        self.assertEqual(loaded.views, 0)
        self.assertEqual(loaded.engagement, 0.0)

    def test_query_service_filters_and_detail(self) -> None:
        self.seed_workbench()
        query = CreatorOpsQueryService(self.store)
        self.assertTrue(query.list_active_content())
        self.assertEqual(query.list_content_by_state(ContentState.IDEA)[0].content_id, "wb-idea")
        detail = query.get_content_detail("wb-reviewed")
        self.assertTrue(detail.publish_records and detail.metrics and detail.reviews)
        self.assertEqual(len(query.list_accounts()), 6)
        self.assertTrue(query.recently_published(now=self.now))
        self.assertIn("wb-publish-no-metrics", {x.publish_record_id for x in query.missing_metrics()})
        self.assertEqual(query.latest_metric_snapshot("wb-publish-reviewed").metrics_id, "wb-metrics-3")
        self.assertIn("wb-review-pending", {x.content_id for x in query.review_pending()})

    def test_dashboard_is_built_from_reopened_persisted_data(self) -> None:
        self.seed_workbench()
        self.store.close(); self.store = SQLiteCreatorOpsStore(self.db_path)
        dashboard = CreatorOpsQueryService(self.store).operator_dashboard(now=self.now)
        self.assertEqual(dashboard.data_classification, "TEST / SYNTHETIC")
        self.assertEqual(len(dashboard.account_workload), 6)
        self.assertTrue(dashboard.work_queue)
        self.assertTrue(dashboard.blocked_items)
        self.assertTrue(dashboard.ready_to_publish)
        self.assertTrue(dashboard.activity_feed)

    def test_review_persistence_reopen_removes_pending_and_keeps_activity(self) -> None:
        self.seed_identity()
        content = self.content("wb-review-pending")
        publish = next(x for x in self.workbench.publish_records if x.content_id == content.content_id)
        metrics = next(x for x in self.workbench.metrics if x.publish_record_id == publish.publish_record_id)
        self.store.contents.save(content); self.store.publish_records.save(publish); self.store.metrics.save(metrics)
        result = PersistentCreatorOpsService(self.store).complete_review(
            content_id=content.content_id, publish_record_id=publish.publish_record_id,
            metrics_id=metrics.metrics_id, review_id="persist-review",
            strengths=("Synthetic",), weaknesses=(), reusable_patterns=(), failed_patterns=(),
            next_action="Synthetic", evidence=("fixture://004",), provenance=self.provenance, now=self.now,
        )
        self.store.close(); self.store = SQLiteCreatorOpsStore(self.db_path)
        self.assertIs(self.store.contents.get_by_id(content.content_id).current_state, ContentState.REVIEWED)
        self.assertEqual(self.store.reviews.get_by_id(result.review.review_id).metric_snapshot, metrics)
        query = CreatorOpsQueryService(self.store)
        self.assertNotIn(content.content_id, {x.content_id for x in query.review_pending()})
        events = query.operator_dashboard(now=self.now).activity_feed
        self.assertIn(ActivityEventType.POST_PUBLISH_REVIEW_COMPLETED, {x.event_type for x in events})

    def test_unsupported_future_schema_version_fails_closed(self) -> None:
        self.store.close()
        raw = sqlite3.connect(self.db_path)
        raw.execute("UPDATE metadata SET value=? WHERE key='schema_version'", ("creator_ops_schema_v99.0",))
        raw.commit(); raw.close()
        with self.assertRaises(PersistenceError) as caught:
            SQLiteCreatorOpsStore(self.db_path)
        self.assertIs(caught.exception.code, PersistenceErrorCode.SCHEMA_VERSION_UNSUPPORTED)
        self.store = SQLiteCreatorOpsStore(":memory:")

    def test_local_backup_is_explicit_reopenable_and_fail_closed_while_busy(self) -> None:
        self.store.creators.save(self.baseline.creator)
        backup = Path(self.temp.name) / "creator_ops_backup.sqlite3"
        with self.store.transaction():
            with self.assertRaises(PersistenceError) as caught:
                self.store.create_local_backup(backup)
            self.assertIs(caught.exception.code, PersistenceErrorCode.VALIDATION_ERROR)
        created = self.store.create_local_backup(backup)
        self.assertEqual(created, backup)
        with SQLiteCreatorOpsStore(backup) as recovered:
            self.assertEqual(recovered.creators.get_by_id(self.baseline.creator.creator_id), self.baseline.creator)
        with self.assertRaises(PersistenceError):
            self.store.create_local_backup(backup)


if __name__ == "__main__":
    unittest.main()
