from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT / "src"))

from creator_ops.compatibility import (  # noqa: E402
    AssetFamily, HistoricalAssetManifest, HistoricalAssetManifestEntry,
    ManifestValidationError, ReadMode, SourceType,
)
from creator_ops.domain.models import (  # noqa: E402
    Asset, AssetStatus, AssetType, ContentState, ContentType, GenerationMethod,
    Provenance, ReviewState,
)
from creator_ops.fixtures import load_fixture  # noqa: E402
from creator_ops.services import (  # noqa: E402
    ContentPipelineService, HistoricalAssetIntakeService, MetricsInputMode,
    PipelineError, ReuseClassification,
)
from creator_ops.state import InvalidTransition  # noqa: E402
from creator_ops.viewmodels import build_content_package, build_overview  # noqa: E402


UTC = timezone.utc


class ManifestAndIntakeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture_root = MODULE_ROOT / "tests" / "fixtures" / "historical_asset_intake"
        cls.provenance = Provenance(
            source_system="fixture-manifest", source_reference="manifest/002",
            captured_at=datetime(2026, 8, 10, tzinfo=UTC),
        )

    def entry(
        self, filename: str, family: AssetFamily = AssetFamily.CONTENT,
        expected: str = "JSON",
    ) -> HistoricalAssetManifestEntry:
        return HistoricalAssetManifestEntry(
            manifest_version="0.1", asset_set_id="creator-002-fixture",
            asset_family=family, source_type=SourceType.FILE,
            absolute_path=str((self.fixture_root / filename).resolve()),
            read_mode=ReadMode.READ_ONLY, expected_format=expected,
            legacy_system="synthetic_legacy", account_codes=(), content_scope="fixture",
            provenance=self.provenance, notes="synthetic only", enabled=True,
        )

    def fixture_entries(self) -> tuple[HistoricalAssetManifestEntry, ...]:
        return (
            self.entry("accounts.json", AssetFamily.ACCOUNT),
            self.entry("content.json", AssetFamily.CONTENT),
            self.entry("content_package.json", AssetFamily.CONTENT),
            self.entry("legacy_manifest.json", AssetFamily.MANIFEST, "NEXA_MANIFEST_V0.1"),
            self.entry("publish.json", AssetFamily.PUBLISH),
            self.entry("metrics.json", AssetFamily.METRICS),
            self.entry("review.json", AssetFamily.REVIEW),
            self.entry("prompt_asset.json", AssetFamily.PROMPT),
            self.entry("media_reference.txt", AssetFamily.MEDIA, "TEXT"),
            self.entry("workflow.csv", AssetFamily.WORKFLOW, "CSV"),
            self.entry("unknown.legacy", AssetFamily.CONTENT, "LEGACY"),
        )

    def test_valid_manifest(self) -> None:
        entries = (self.entry("content.json"),)
        manifest = HistoricalAssetManifest("0.1", "creator-002-fixture", entries)
        self.assertEqual(len(manifest.entries), 1)
        self.assertIs(manifest.entries[0].read_mode, ReadMode.READ_ONLY)

    def test_relative_path_rejected(self) -> None:
        with self.assertRaises(ManifestValidationError):
            replace(self.entry("content.json"), absolute_path="tests/fixtures/content.json")
        with self.assertRaises(ManifestValidationError):
            HistoricalAssetManifest.from_json("relative-manifest.json")

    def test_disk_root_rejected(self) -> None:
        with self.assertRaises(ManifestValidationError):
            replace(self.entry("content.json"), absolute_path=str(Path(self.fixture_root.anchor)))

    def test_read_write_rejected(self) -> None:
        with self.assertRaises(ManifestValidationError):
            replace(self.entry("content.json"), read_mode="READ_WRITE")  # type: ignore[arg-type]

    def test_missing_provenance_rejected(self) -> None:
        with self.assertRaises(ManifestValidationError):
            replace(self.entry("content.json"), provenance=None)

    def test_overbroad_path_rejected(self) -> None:
        with self.assertRaises(ManifestValidationError):
            replace(self.entry("content.json"), absolute_path=str(MODULE_ROOT))

    def test_fixture_asset_discovery_and_compatibility_classification(self) -> None:
        plan = HistoricalAssetIntakeService().dry_run(self.fixture_entries())
        self.assertTrue(plan.is_read_only)
        self.assertEqual(len(plan.results), 11)
        self.assertTrue(all(item.existence and item.readability for item in plan.results))
        counts = {classification: 0 for classification in ReuseClassification}
        for result in plan.results:
            counts[result.reuse_classification] += 1
        self.assertEqual(counts[ReuseClassification.REUSE_AS_IS], 1)
        self.assertEqual(counts[ReuseClassification.REUSE_WITH_ADAPTER], 7)
        self.assertEqual(counts[ReuseClassification.MIGRATION_REQUIRED], 1)
        self.assertEqual(counts[ReuseClassification.REFERENCE_ONLY], 1)
        self.assertEqual(counts[ReuseClassification.UNKNOWN], 1)
        account = plan.results[0]
        self.assertEqual(account.mapped_count, 6)

    def test_missing_fixture_remains_unknown(self) -> None:
        result = HistoricalAssetIntakeService().dry_run((self.entry("missing.json"),)).results[0]
        self.assertFalse(result.existence)
        self.assertIs(result.reuse_classification, ReuseClassification.UNKNOWN)
        self.assertIn("SOURCE_NOT_FOUND", result.warnings)

    def test_dry_run_has_no_write_operations_and_preserves_files(self) -> None:
        entries = self.fixture_entries()
        before = {item.path: (item.path.stat().st_size, item.path.stat().st_mtime_ns) for item in entries}
        plan = HistoricalAssetIntakeService().dry_run(entries)
        after = {item.path: (item.path.stat().st_size, item.path.stat().st_mtime_ns) for item in entries}
        self.assertEqual(plan.write_operations, ())
        self.assertEqual(before, after)


class ContentPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = load_fixture(MODULE_ROOT / "tests" / "fixtures" / "creator_ops_minimal.json")
        cls.provenance = Provenance(
            source_system="fixture", source_reference="pipeline/002",
            captured_at=datetime(2026, 8, 10, tzinfo=UTC),
        )

    def setUp(self) -> None:
        self.service = ContentPipelineService()
        self.now = datetime(2026, 8, 10, 8, 0, tzinfo=UTC)
        self.account = next(x for x in self.fixture.accounts if x.account_id == "acct-a1")

    def idea(self):
        return self.service.create_idea(
            content_id="pipeline-content-001", creator_id="creator-demo-001",
            target_accounts=(self.account.account_id,), topic="pipeline fixture",
            content_type=ContentType.ARTICLE, platform_intent=("fixture-platform",),
            provenance=self.provenance, source="fixture", now=self.now,
        )

    def review_content(self):
        draft = self.service.start_draft(
            self.idea(), title="Pipeline", body="Synthetic content body.",
            script_reference=None, now=self.now,
        )
        asset = Asset(
            asset_id="pipeline-asset-001", asset_type=AssetType.IMAGE, source="fixture",
            location="fixture://pipeline/asset.png", content_relations=(draft.content_id,),
            provenance=self.provenance, generation_method=GenerationMethod.HUMAN_CREATED,
            creator_id=draft.creator_id, account_relations=(self.account.account_id,),
            status=AssetStatus.AVAILABLE, created_at=self.now, updated_at=self.now,
        )
        preparing = self.service.attach_asset(draft, asset, now=self.now)
        return self.service.submit_for_review(preparing, now=self.now), asset

    def ready_content(self):
        review, asset = self.review_content()
        approved = self.service.approve_review(review, now=self.now)
        ready = self.service.mark_ready_to_publish(
            approved, accounts=self.fixture.accounts, assets=(asset,), now=self.now,
        )
        return ready, asset

    def test_idea_to_draft_to_asset_preparation(self) -> None:
        review, asset = self.review_content()
        self.assertIs(review.current_state, ContentState.REVIEW)
        self.assertIn(asset.asset_id, review.asset_references)

    def test_review_approval_and_ready_gate(self) -> None:
        ready, _ = self.ready_content()
        self.assertIs(ready.current_state, ContentState.READY_TO_PUBLISH)
        self.assertIs(ready.review_state, ReviewState.APPROVED)

    def test_review_rejection(self) -> None:
        review, _ = self.review_content()
        rejected = self.service.reject_review(review, now=self.now)
        self.assertIs(rejected.current_state, ContentState.REJECTED)
        self.assertIs(rejected.review_state, ReviewState.CHANGES_REQUESTED)

    def test_ready_gate_rejects_missing_body_review_and_provenance(self) -> None:
        idea = self.idea()
        incomplete = replace(idea, provenance=Provenance("fixture", None, None))
        gate = self.service.ready_to_publish_gate(incomplete, accounts=self.fixture.accounts, assets=())
        self.assertFalse(gate.passed)
        self.assertIn("CONTENT_BODY_OR_SCRIPT_REQUIRED", gate.failures)
        self.assertIn("REVIEW_NOT_APPROVED", gate.failures)
        self.assertIn("PROVENANCE_INCOMPLETE", gate.failures)

    def test_pipeline_invalid_transition_rejected_by_001_machine(self) -> None:
        asset = Asset(
            asset_id="bad-sequence-asset", asset_type=AssetType.IMAGE, source="fixture",
            location="fixture://bad.png", content_relations=(self.idea().content_id,),
            provenance=self.provenance, generation_method=GenerationMethod.HUMAN_CREATED,
            creator_id="creator-demo-001", account_relations=(self.account.account_id,),
            status=AssetStatus.AVAILABLE, created_at=self.now, updated_at=self.now,
        )
        with self.assertRaises(InvalidTransition):
            self.service.attach_asset(self.idea(), asset, now=self.now)

    def test_blocked_and_archived_handling(self) -> None:
        blocked = self.service.block_content(self.idea(), reason="fixture dependency", now=self.now)
        self.assertIs(blocked.current_state, ContentState.BLOCKED)
        archived = self.service.archive_content(blocked, now=self.now)
        self.assertIs(archived.current_state, ContentState.ARCHIVED)
        with self.assertRaises(InvalidTransition):
            self.service.start_draft(archived, title="x", body="x", script_reference=None, now=self.now)

    def test_manual_confirmation_required_and_record_created(self) -> None:
        ready, _ = self.ready_content()
        with self.assertRaises(PipelineError):
            self.service.record_manual_publish(
                ready, account=self.account, platform="fixture-platform",
                actual_publish_time=self.now, external_url=None, external_post_id=None,
                manual_confirmation=False, provenance=self.provenance, now=self.now,
            )
        result = self.service.record_manual_publish(
            ready, account=self.account, platform="fixture-platform",
            actual_publish_time=self.now, external_url=None, external_post_id="fixture-001",
            manual_confirmation=True, provenance=self.provenance, now=self.now,
        )
        self.assertIs(result.content.current_state, ContentState.PUBLISHED)
        self.assertTrue(result.publish_record.manual_confirmation)
        self.assertFalse(hasattr(self.service, "automatic_publish"))

    def test_metrics_and_review_loop_preserve_null_zero(self) -> None:
        ready, asset = self.ready_content()
        published = self.service.record_manual_publish(
            ready, account=self.account, platform="fixture-platform",
            actual_publish_time=self.now, external_url=None, external_post_id="fixture-001",
            manual_confirmation=True, provenance=self.provenance, now=self.now,
        )
        metric_result = self.service.record_metrics(
            published.content, published.publish_record, metrics_id="pipeline-metrics-001",
            views=None, impressions=0, likes=0, comments=None, favorites=0, shares=0,
            followers_delta=None, engagement=0.0, collected_at=self.now,
            input_mode=MetricsInputMode.MANUAL, provenance=self.provenance, now=self.now,
        )
        self.assertIs(metric_result.content.current_state, ContentState.METRICS_PENDING)
        self.assertIsNone(metric_result.metrics.views)
        self.assertEqual(metric_result.metrics.impressions, 0)
        reviewed = self.service.complete_review(
            metric_result.content, published.publish_record, metric_result.metrics,
            review_id="pipeline-review-001", assets=(asset,), strengths=("clear",),
            weaknesses=(), reusable_patterns=("short title",), failed_patterns=(),
            next_action="repeat", evidence=("fixture://evidence",),
            provenance=self.provenance, now=self.now,
        )
        self.assertIs(reviewed.content.current_state, ContentState.REVIEWED)
        self.assertIs(reviewed.review.metric_snapshot, metric_result.metrics)
        self.assertEqual(reviewed.review.extension_fields["asset_ids"], (asset.asset_id,))

    def test_content_package_is_aggregation_not_second_domain(self) -> None:
        ready, asset = self.ready_content()
        package = build_content_package(ready, accounts=self.fixture.accounts, assets=(asset,))
        self.assertIs(package.content, ready)
        self.assertEqual(package.target_accounts, (self.account,))
        self.assertEqual(package.assets, (asset,))
        self.assertEqual(package.warnings, ())

    def test_overview_exposes_derived_pipeline_fields(self) -> None:
        blocked = self.service.block_content(self.idea(), reason="fixture", now=self.now)
        overview = build_overview(
            self.fixture.accounts, (*self.fixture.contents, blocked), self.fixture.assets,
            self.fixture.publish_records, self.fixture.metrics, self.fixture.reviews,
            now=self.now,
        )
        self.assertEqual(overview.ideas, 2)
        self.assertEqual(overview.drafts, 1)
        self.assertEqual(overview.asset_preparation, 1)
        self.assertEqual(overview.ready_to_publish, 1)
        self.assertEqual(overview.blocked, 1)
        self.assertEqual(overview.review_pending, overview.reviews_pending)
        self.assertEqual(overview.recent_activity, overview.recent_content)


if __name__ == "__main__":
    unittest.main()
