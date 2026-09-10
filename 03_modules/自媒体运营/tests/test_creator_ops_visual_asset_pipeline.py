from __future__ import annotations

import binascii
import os
import struct
import tempfile
import unittest
import zlib
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.application.visual_asset_pipeline import (
    AssetRequirementStatus, AssetSubmissionStatus, MediaValidator,
    VisualAssetPipelineService, VisualReviewDecision,
    build_authoritative_visual_packets,
)
from creator_ops.domain.models import (
    Account, AccountStatus, ContentItem, ContentState, ContentType, Creator,
    CreatorStatus, Provenance, PublishReadiness, ReviewState,
)
from creator_ops.persistence.sqlite_adapter import SQLiteCreatorOpsStore


NOW = datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc)


def png(path: Path, width: int, height: int) -> Path:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(
            ">I", binascii.crc32(kind + payload) & 0xFFFFFFFF,
        )
    raw = b"".join(b"\x00" + b"\x20\x40\x80" * width for _ in range(height))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 1)) + chunk(b"IEND", b"")
    )
    return path


class VisualAssetPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = SQLiteCreatorOpsStore(self.root / "creator.sqlite3")
        provenance = Provenance("test", "visual-test", NOW)
        with self.store.transaction():
            self.store.creators.save(Creator(
                "creator-main", "主创作者", CreatorStatus.ACTIVE, "test", provenance, NOW, NOW,
            ))
            for account in ("A2", "B3"):
                self.store.accounts.save(Account(
                    account, "creator-main", account, "test", account, account,
                    "test direction", AccountStatus.ACTIVE, "test", provenance, NOW, NOW,
                ))
            self.store.contents.save(ContentItem(
                "A2-20260714-001", "creator-main", ("A2",), "校园独白", "下课后的校园独白",
                "script", None, ContentType.SHORT_VIDEO, ("DOUYIN",), (),
                ContentState.ASSET_PREPARATION, ReviewState.PENDING, PublishReadiness.NOT_READY,
                "test", provenance, NOW, NOW,
            ))
            self.store.contents.save(ContentItem(
                "B3-20260714-001", "creator-main", ("B3",), "ChatGPT 入门",
                "大学生第一次用ChatGPT先记住这3点", "body", None, ContentType.IMAGE_POST,
                ("XIAOHONGSHU",), (), ContentState.ASSET_PREPARATION, ReviewState.PENDING,
                PublishReadiness.NOT_READY, "test", provenance, NOW, NOW,
            ))
        packets = build_authoritative_visual_packets(now=NOW, workspace_root=self.root / "intake")
        self.a2_packet, self.b3_packet = packets
        self.service = VisualAssetPipelineService(self.store, self.root / "intake")
        self.service.freeze_requirements(tuple(r for p in packets for r in p.requirements))

    def tearDown(self) -> None:
        self.store.close()
        self.temp.cleanup()

    def test_frozen_requirement_and_handoff_contracts_are_exact(self) -> None:
        self.assertEqual(len(self.a2_packet.requirements), 4)
        self.assertEqual(len(self.b3_packet.requirements), 6)
        self.assertTrue(all(r.status is AssetRequirementStatus.READY_FOR_GENERATION for r in self.a2_packet.requirements))
        self.assertTrue(all("NO_TEXT_IN_IMAGE" == r.text_overlay_requirement for r in self.a2_packet.requirements))
        self.assertTrue(all(r.text_overlay_requirement.startswith("EXACT_TEXT:\n") for r in self.b3_packet.requirements))
        self.assertTrue(all(h.control_mode == "HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF" for h in (*self.a2_packet.handoffs, *self.b3_packet.handoffs)))
        self.assertEqual(self.a2_packet.specification.football_accuracy.split("：")[0], "NOT_APPLICABLE")

    def test_validator_valid_wrong_type_small_ratio_missing_corrupt_and_source_reference(self) -> None:
        requirement = self.a2_packet.requirements[0]
        valid = MediaValidator().validate(png(self.root / "valid.png", 1080, 1920), requirement)
        self.assertTrue(valid.valid_for_intake)
        wrong = self.root / "wrong.png"; wrong.write_text("not an image", encoding="utf-8")
        self.assertIn("UNSUPPORTED_OR_CORRUPT_MEDIA", MediaValidator().validate(wrong, requirement).errors)
        small = MediaValidator().validate(png(self.root / "small.png", 90, 160), requirement)
        self.assertIn("DIMENSIONS_BELOW_MINIMUM", small.errors)
        ratio = MediaValidator().validate(png(self.root / "ratio.png", 1080, 1080), requirement)
        self.assertIn("ASPECT_RATIO_MISMATCH", ratio.errors)
        missing = MediaValidator().validate(self.root / "missing.png", requirement)
        self.assertIn("FILE_NOT_FOUND", missing.errors)
        corrupt = self.root / "corrupt.png"; corrupt.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 50)
        self.assertIn("CORRUPT_OR_UNREADABLE_MEDIA", MediaValidator().validate(corrupt, requirement).errors)
        source_file = Path(__file__).resolve().parents[1] / "source_import" / "visual-validator-test.png"
        source_result = MediaValidator().validate(source_file, requirement)
        self.assertTrue(source_result.source_import_reference_only)
        self.assertIn("FILE_NOT_FOUND", source_result.errors)

    def test_video_probe_allows_partial_duration_without_guessing(self) -> None:
        requirement = replace(
            self.a2_packet.requirements[0], asset_type="VIDEO", expected_filename="clip.mp4",
        )
        partial = self.root / "partial.mp4"
        partial.write_bytes(struct.pack(">I", 20) + b"ftyp" + b"isom" + b"\x00" * 8)
        result = MediaValidator().validate(partial, requirement)
        self.assertEqual(result.status.value, "METADATA_PARTIAL")
        self.assertEqual(result.detected_type, "video/mp4")
        self.assertIsNone(result.duration_seconds)
        self.assertIn("VIDEO_DURATION_METADATA_PARTIAL", result.warnings)

    def test_submit_duplicate_managed_copy_and_restart(self) -> None:
        source = png(self.root / "source.png", 1080, 1920)
        req = self.a2_packet.requirements[0]
        submitted = self.service.submit_asset(req.requirement_id, source, now=NOW)
        self.assertIs(submitted.status, AssetSubmissionStatus.PENDING_HUMAN_VISUAL_REVIEW)
        self.assertTrue(Path(submitted.managed_path).is_file())
        self.assertTrue(source.is_file())
        duplicate = self.service.submit_asset(req.requirement_id, source, now=NOW)
        self.assertEqual(duplicate.submission_id, submitted.submission_id)
        self.assertEqual(duplicate.duplicate_of, submitted.submission_id)
        self.store.close()
        self.store = SQLiteCreatorOpsStore(self.root / "creator.sqlite3")
        self.service = VisualAssetPipelineService(self.store, self.root / "intake")
        recovered = self.store.visual_assets.get_submission(submitted.submission_id)
        self.assertEqual(recovered.source_sha256, submitted.source_sha256)
        self.assertEqual(self.service.get_intake_status(req.content_id).next_action, "VISUAL_REVIEW")

    def test_same_hash_different_requirement_creates_separate_submission(self) -> None:
        source = png(self.root / "same.png", 1080, 1920)
        first = self.service.submit_asset(self.a2_packet.requirements[0].requirement_id, source, now=NOW)
        second = self.service.submit_asset(self.a2_packet.requirements[1].requirement_id, source, now=NOW)
        self.assertNotEqual(first.submission_id, second.submission_id)
        self.assertNotEqual(first.managed_path, second.managed_path)

    def test_managed_copy_rollback_after_injected_failure_and_recovery(self) -> None:
        source = png(self.root / "rollback.png", 1080, 1920)
        req = self.a2_packet.requirements[0]
        with self.assertRaises(RuntimeError):
            self.service.submit_asset(
                req.requirement_id, source, now=NOW,
                failure_point="AFTER_MANAGED_COPY_BEFORE_DB",
            )
        self.assertEqual(self.store.visual_assets.list_submissions(), ())
        self.assertEqual(tuple((self.root / "intake").glob("*/managed/**/*.*")), ())
        staging = self.root / "intake" / req.content_id / ".staging" / "interrupted.staging"
        staging.write_bytes(b"partial")
        report = self.service.recover(now=NOW)
        self.assertEqual(report.removed_staging_files, 1)
        self.assertFalse(staging.exists())

    def test_db_transaction_failure_rolls_back_row_and_managed_copy(self) -> None:
        source = png(self.root / "db-rollback.png", 1080, 1920)
        req = self.a2_packet.requirements[0]
        with self.assertRaises(Exception):
            self.service.submit_asset(
                req.requirement_id, source, now=NOW, failure_point="DURING_DB_TRANSACTION",
            )
        self.assertEqual(self.store.visual_assets.list_submissions(), ())
        self.assertIs(
            self.store.visual_assets.get_requirement(req.requirement_id).status,
            AssetRequirementStatus.READY_FOR_GENERATION,
        )
        self.assertEqual(tuple((self.root / "intake").glob("*/managed/**/*.*")), ())

    def test_human_gate_blocks_implicit_approval_and_activates_only_approved_asset(self) -> None:
        source = png(self.root / "review.png", 1080, 1920)
        req = self.a2_packet.requirements[0]
        submitted = self.service.submit_asset(req.requirement_id, source, now=NOW)
        workbench = self.service.get_review_workbench(submitted.submission_id)
        self.assertEqual(workbench.gate_status, "PENDING_HUMAN_REVIEW")
        with self.assertRaises(ValueError):
            self.service.review_submission(
                submitted.submission_id, decision=VisualReviewDecision.APPROVE,
                operator_checks={}, notes=None, human_confirmation=True, now=NOW,
            )
        checks = {key: "PASS" for key in self.service.HUMAN_CHECKS}
        updated, asset = self.service.review_submission(
            submitted.submission_id, decision=VisualReviewDecision.APPROVE,
            operator_checks=checks, notes="synthetic smoke", human_confirmation=True, now=NOW,
        )
        self.assertIs(updated.status, AssetSubmissionStatus.ACTIVATED_PACKAGE_PENDING)
        self.assertIsNotNone(asset)
        self.assertEqual(len(self.store.assets.list()), 1)
        self.assertIs(self.store.visual_assets.get_requirement(req.requirement_id).status, AssetRequirementStatus.VERIFIED)
        visual = self.store.runtime.list_qa_receipts(content_id=req.content_id)[-1]
        self.assertEqual(visual.status.value, "MANUAL_REVIEW")  # other A2 requirements remain missing

    def test_missing_managed_copy_is_detected_on_recovery(self) -> None:
        req = self.a2_packet.requirements[0]
        source = png(self.root / "missing-managed.png", 1080, 1920)
        submission = self.service.submit_asset(req.requirement_id, source, now=NOW)
        Path(submission.managed_path).unlink()
        report = self.service.recover(now=NOW)
        self.assertEqual(report.missing_managed_files, 1)
        self.assertIs(
            self.store.visual_assets.get_submission(submission.submission_id).status,
            AssetSubmissionStatus.RECOVERY_REQUIRED,
        )

    def test_reject_and_request_change_never_create_canonical_asset(self) -> None:
        for index, decision in enumerate((VisualReviewDecision.REJECT, VisualReviewDecision.REQUEST_CHANGE)):
            req = self.a2_packet.requirements[index]
            source = png(self.root / f"reject-{index}.png", 1080, 1920)
            submission = self.service.submit_asset(req.requirement_id, source, now=NOW)
            checks = {key: ("FAIL" if key == "artifact_quality" else "PASS") for key in self.service.HUMAN_CHECKS}
            updated, asset = self.service.review_submission(
                submission.submission_id, decision=decision, operator_checks=checks,
                notes="needs work", human_confirmation=True, now=NOW,
            )
            self.assertIsNone(asset)
            self.assertIn(updated.status, {AssetSubmissionStatus.REJECTED, AssetSubmissionStatus.REQUEST_CHANGES})
        self.assertEqual(self.store.assets.list(), ())

    def test_public_api_contract_health_and_work_queue(self) -> None:
        self.store.close()
        db = self.root / "creator.sqlite3"
        app = create_creator_ops_application(db)
        self.assertEqual(app.open().status.value, "SUCCESS")
        try:
            self.assertEqual(len(app.get_asset_requirements("A2-20260714-001")), 4)
            self.assertEqual(app.get_visual_production_packet("B3-20260714-001").status, "READY")
            health = app.health()
            self.assertEqual(health.asset_requirements_pending, 10)
            self.assertEqual(health.business_state, "BUSINESS_BLOCKED")
            queue = {item.content_id: item for item in app.get_work_queue(now=NOW)}
            self.assertEqual(queue["A2-20260714-001"].next_action.next_action_type.value, "GENERATE_ASSET")
            self.assertEqual(queue["B3-20260714-001"].next_action.next_action_type.value, "GENERATE_ASSET")
            dashboard = app.get_dashboard(now=NOW)
            dashboard_queue = {item.content_id: item for item in dashboard.work_queue}
            self.assertEqual(
                dashboard_queue["A2-20260714-001"].next_action.next_action_type.value,
                "GENERATE_ASSET",
            )
            self.assertEqual(
                dashboard_queue["B3-20260714-001"].next_action.next_action_type.value,
                "GENERATE_ASSET",
            )
            workload = {item.account_id: item for item in dashboard.account_workload}
            self.assertEqual(workload["A2"].blocked_count, 1)
            self.assertEqual(workload["B3"].blocked_count, 1)
            self.assertEqual(app.get_account_workload("A2", now=NOW).blocked_count, 1)
        finally:
            app.close()
        self.store = SQLiteCreatorOpsStore(db)

    def test_full_synthetic_activation_package_and_qa_path(self) -> None:
        submission_ids = []
        checks = {key: "PASS" for key in self.service.HUMAN_CHECKS}
        for index, req in enumerate(self.a2_packet.requirements):
            source = png(self.root / f"full-{index}.png", 1080, 1920)
            # Preserve a distinct identity without altering valid PNG structure.
            source.write_bytes(source.read_bytes() + bytes([index]))
            submission = self.service.submit_asset(req.requirement_id, source, now=NOW)
            reviewed, asset = self.service.review_submission(
                submission.submission_id, decision=VisualReviewDecision.APPROVE,
                operator_checks=checks, notes="synthetic full-chain", human_confirmation=True, now=NOW,
            )
            self.assertIsNotNone(asset)
            submission_ids.append(reviewed.submission_id)
        self.store.close()
        db = self.root / "creator.sqlite3"
        app = create_creator_ops_application(db)
        self.assertEqual(app.open().status.value, "SUCCESS")
        try:
            result = app.continue_visual_asset_pipeline(
                submission_ids[-1], package_id="synthetic-a2-visual-v0-1",
                target_root=self.root / "packages", now=NOW,
            )
            self.assertEqual(result.status.value, "SUCCESS")
            self.assertEqual(result.data["next_gate"], "EDITORIAL_REVIEW")
            self.assertEqual(result.data["qa"]["asset_qa"].data.status.value, "PASS")
            self.assertEqual(result.data["qa"]["package_qa"].data.status.value, "PASS")
            self.assertEqual(result.data["qa"]["publish_prep_qa"].data.status.value, "FAIL")
            self.assertEqual(
                app.get_asset_intake_status("A2-20260714-001").verified_requirements, 4,
            )
        finally:
            app.close()
        self.store = SQLiteCreatorOpsStore(db)


if __name__ == "__main__":
    unittest.main()
