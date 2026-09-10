from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.api.contracts import CommandStatus
from creator_ops.application.real_asset_pipeline import (
    AssetCandidateDecision, RealAssetCandidateResolver, VerifiedAssetActivationService,
)
from creator_ops.application.qa_runtime import FormalQARunner
from creator_ops.application.package_writer import LocalPackageWriter, PackageBuildRequest, PackageFileInput
from creator_ops.compatibility.source_reconciliation import SourceReconciliationCatalog


class RealAssetPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 8, 13, 8, 0, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def source_tree(self) -> Path:
        root = self.root / "source_import"
        from creator_ops.compatibility.source_reconciliation import SOURCE_GROUPS
        for group in SOURCE_GROUPS:
            (root / group).mkdir(parents=True)
        return root

    def test_resolver_verifies_only_explicit_metadata_and_classifies_every_media(self) -> None:
        root = self.source_tree()
        verified = root / "06_自媒体运营" / "content" / "visual.jpg"
        verified.parent.mkdir(parents=True)
        verified.write_bytes(b"not-a-real-jpeg-but-readable")
        (verified.parent / "metadata.json").write_text(json.dumps({
            "content_id": "A2-20260714-001", "assets_status": "verified",
        }), encoding="utf-8")
        case = root / "视频创作" / "抖音" / "案例库" / "CASE-0004" / "cover.jpg"
        case.parent.mkdir(parents=True)
        case.write_bytes(b"case-media")
        result = RealAssetCandidateResolver(SourceReconciliationCatalog(root)).resolve(
            content_accounts={"A2-20260714-001": "A2", "B3-20260714-001": "B3"},
        )
        self.assertEqual(result.unknown_count, 0)
        self.assertEqual(len(result.candidates), 2)
        self.assertEqual(
            {item.decision for item in result.candidates},
            {AssetCandidateDecision.VERIFIED_MATCH, AssetCandidateDecision.UNRELATED},
        )
        receipt = RealAssetCandidateResolver.write_receipt(result, self.root / "receipt.json")
        try:
            self.assertEqual(RealAssetCandidateResolver.write_receipt(result, receipt), receipt)
        finally:
            receipt.unlink()

    def test_external_or_missing_metadata_never_auto_verifies(self) -> None:
        root = self.source_tree()
        media = root / "06_自媒体运营" / "A2-20260714-001" / "visual.jpg"
        media.parent.mkdir(parents=True)
        media.write_bytes(b"candidate")
        (media.parent / "metadata.json").write_text(json.dumps({
            "content_id": "A2-20260714-001", "assets_status": "external_or_missing",
        }), encoding="utf-8")
        result = RealAssetCandidateResolver(SourceReconciliationCatalog(root)).resolve(
            content_accounts={"A2-20260714-001": "A2"},
        )
        self.assertIs(result.candidates[0].decision, AssetCandidateDecision.STRONG_CANDIDATE)

    def test_verified_asset_activation_revalidates_and_is_idempotent(self) -> None:
        root = self.source_tree()
        media = root / "06_自媒体运营" / "content" / "visual.jpg"
        media.parent.mkdir(parents=True)
        media.write_bytes(b"verified-media")
        (media.parent / "metadata.json").write_text(json.dumps({
            "content_id": "content", "assets_status": "verified",
        }), encoding="utf-8")
        resolver = RealAssetCandidateResolver(SourceReconciliationCatalog(root))
        candidate = resolver.resolve(content_accounts={"content": "A2"}).candidates[0]
        app = create_creator_ops_application(self.root / "asset.sqlite3")
        try:
            app.initialize_local_store(confirmation=True)
            app.create_creator(creator_id="creator", name="Creator", now=self.now)
            app.create_account(
                account_id="A2", creator_id="creator", platform="抖音", account_name="A2",
                display_name="A2", content_direction="test", now=self.now,
            )
            app.create_idea(
                content_id="content", creator_id="creator", target_accounts=("A2",), topic="topic",
                content_type="SHORT_VIDEO", platform_intent=("抖音",), now=self.now,
            )
            app.start_draft("content", title="title", body="body", script_reference=None, now=self.now)
            service = VerifiedAssetActivationService(app._root.store, resolver)
            first = service.activate(candidate, now=self.now)
            second = service.activate(candidate, now=self.now)
            self.assertEqual(first.asset_id, second.asset_id)
            self.assertEqual(len(app.get_content_detail("content").assets), 1)
            self.assertEqual(app.list_content()[0].current_state, "ASSET_PREPARATION")
        finally:
            app.close()

    def test_complete_draft_requires_existing_real_text_and_is_idempotency_safe(self) -> None:
        app = create_creator_ops_application(self.root / "db.sqlite3")
        try:
            app.initialize_local_store(confirmation=True)
            app.create_creator(creator_id="creator", name="Creator", now=self.now)
            app.create_account(
                account_id="B3", creator_id="creator", platform="小红书", account_name="B3",
                display_name="B3", content_direction="test", now=self.now,
            )
            app.create_idea(
                content_id="content", creator_id="creator", target_accounts=("B3",), topic="topic",
                content_type="IMAGE_POST", platform_intent=("小红书",), now=self.now,
            )
            app.start_draft("content", title="title", body=None, script_reference="legacy/package.md", now=self.now)
            completed = app.complete_draft("content", now=self.now)
            repeated = app.complete_draft("content", now=self.now)
            self.assertIs(completed.status, CommandStatus.SUCCESS)
            self.assertEqual(completed.updated_state, "ASSET_PREPARATION")
            self.assertIs(repeated.status, CommandStatus.VALIDATION_ERROR)
            self.assertEqual(len(app.get_content_detail("content").assets), 0)
        finally:
            app.close()

    def test_package_manifest_truthfully_separates_missing_and_candidates(self) -> None:
        request = PackageBuildRequest(
            "pkg", "content", "A2",
            (PackageFileInput("script", "script.md", b"real script"),), (),
            {"source": "test"}, self.now,
            asset_inventory={
                "verified_canonical_assets": [], "legacy_reference_only_assets": [],
                "unverified_candidate_counts": {"STRONG_CANDIDATE": 1},
                "missing_required_asset": True,
            },
        )
        result = LocalPackageWriter(self.root / "packages").write(request)
        manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
        self.assertTrue(manifest["asset_inventory"]["missing_required_asset"])
        self.assertEqual(manifest["asset_references"], [])

    def test_real_review_workbench_is_pre_publish_and_never_auto_approves(self) -> None:
        app = create_creator_ops_application(self.root / "review.sqlite3")
        try:
            app.initialize_local_store(confirmation=True)
            app.create_creator(creator_id="creator", name="Creator", now=self.now)
            app.create_account(
                account_id="A2", creator_id="creator", platform="抖音", account_name="A2",
                display_name="A2", content_direction="test", now=self.now,
            )
            app.create_idea(
                content_id="content", creator_id="creator", target_accounts=("A2",), topic="topic",
                content_type="SHORT_VIDEO", platform_intent=("抖音",), now=self.now,
            )
            app.start_draft("content", title="title", body="body", script_reference=None, now=self.now)
            app.complete_draft("content", now=self.now)
            package = app.build_local_package(
                "content", account_id="A2", package_id="pkg", target_root=self.root / "packages2", now=self.now,
            )
            app.run_content_qa("content", now=self.now)
            app.run_asset_qa("content", now=self.now)
            app.run_package_qa("content", package_id="pkg", manifest_path=package.data.manifest_path, now=self.now)
            app.run_publish_prep_qa("content", package_id="pkg", now=self.now)
            workbench = app.get_real_review_workbench(
                "content", package_id="pkg", manifest_path=package.data.manifest_path,
            )
            self.assertIn("VERIFIED_ASSET_REQUIRED", workbench.missing_conditions)
            self.assertFalse(workbench.subjective_review_required)
            self.assertEqual(app.list_content()[0].review_state, "PENDING")
        finally:
            app.close()


if __name__ == "__main__":
    unittest.main()
