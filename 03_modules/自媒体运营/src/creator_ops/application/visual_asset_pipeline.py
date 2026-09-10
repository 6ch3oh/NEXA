"""Production-ready visual asset requirements, intake and human review pipeline.

This module is deliberately local-only.  It prepares deterministic human/AI
handoffs and accepts files that an operator has already generated; it contains
no model client, browser automation, platform login or publishing capability.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import struct
import tempfile
import zlib
from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Mapping, Sequence

from creator_ops.application.qa_runtime import FormalQARunner
from creator_ops.domain.models import (
    Asset, AssetStatus, AssetType, GenerationMethod, Provenance,
)
from creator_ops.persistence.errors import PersistenceError, PersistenceErrorCode
from creator_ops.services.content_pipeline import ContentPipelineService


PIPELINE_VERSION = "0.1"
HUMAN_AI_CONTROL_MODE = "HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF"


class AssetRequirementStatus(str, Enum):
    NEEDED = "NEEDED"
    READY_FOR_GENERATION = "READY_FOR_GENERATION"
    WAITING_FOR_ASSET = "WAITING_FOR_ASSET"
    SUBMITTED = "SUBMITTED"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"


class MediaValidationStatus(str, Enum):
    VALID = "VALID"
    METADATA_PARTIAL = "METADATA_PARTIAL"
    INVALID = "INVALID"


class AssetSubmissionStatus(str, Enum):
    VALIDATION_FAILED = "VALIDATION_FAILED"
    PENDING_HUMAN_VISUAL_REVIEW = "PENDING_HUMAN_VISUAL_REVIEW"
    REJECTED = "REJECTED"
    REQUEST_CHANGES = "REQUEST_CHANGES"
    ACTIVATED_PACKAGE_PENDING = "ACTIVATED_PACKAGE_PENDING"
    ACTIVATED = "ACTIVATED"
    RECOVERY_REQUIRED = "RECOVERY_REQUIRED"


class VisualReviewDecision(str, Enum):
    PENDING = "PENDING"
    APPROVE = "APPROVE"
    REJECT = "REJECT"
    REQUEST_CHANGE = "REQUEST_CHANGE"


@dataclass(frozen=True)
class AssetRequirement:
    requirement_id: str
    content_id: str
    account_id: str
    asset_role: str
    asset_type: str
    required: bool
    purpose: str
    platform_context: str
    visual_subject: str
    composition: str
    visual_hierarchy: str
    text_overlay_requirement: str
    aspect_ratio: str
    minimum_dimensions: tuple[int, int]
    preferred_dimensions: tuple[int, int]
    reference_policy: str
    style_requirements: tuple[str, ...]
    must_include: tuple[str, ...]
    must_not_include: tuple[str, ...]
    brand_account_constraints: tuple[str, ...]
    qa_rules: tuple[str, ...]
    provenance: Mapping[str, Any]
    status: AssetRequirementStatus
    expected_filename: str
    created_at: datetime
    updated_at: datetime
    version: str = PIPELINE_VERSION

    @property
    def aspect_ratio_value(self) -> float:
        left, right = self.aspect_ratio.split(":", 1)
        return float(left) / float(right)


@dataclass(frozen=True)
class VisualProductionSpec:
    content_id: str
    content_goal: str
    audience: str
    core_message: str
    asset_requirement_ids: tuple[str, ...]
    exact_text_policy: str
    realism_requirements: tuple[str, ...]
    football_accuracy: str
    failure_criteria: tuple[str, ...]
    acceptance_criteria: tuple[str, ...]
    provenance: tuple[str, ...]
    version: str = PIPELINE_VERSION


@dataclass(frozen=True)
class HumanAIImageHandoff:
    handoff_id: str
    content_id: str
    account: str
    asset_requirement_id: str
    generation_goal: str
    image_prompt: str
    reference_asset_instructions: tuple[str, ...]
    aspect_ratio: str
    output_count: int
    selection_criteria: tuple[str, ...]
    negative_constraints: tuple[str, ...]
    expected_filename: str
    output_destination: str
    operator_steps: tuple[str, ...]
    chatgpt_steps: tuple[str, ...]
    human_confirmation: str
    return_contract: str
    provenance: tuple[str, ...]
    control_mode: str = HUMAN_AI_CONTROL_MODE
    version: str = "0.2"


@dataclass(frozen=True)
class VisualProductionPacket:
    content_id: str
    account_id: str
    summary: str
    requirements: tuple[AssetRequirement, ...]
    specification: VisualProductionSpec
    handoffs: tuple[HumanAIImageHandoff, ...]
    intake_directory: str
    status: str = "READY"
    version: str = PIPELINE_VERSION


@dataclass(frozen=True)
class MediaValidationResult:
    status: MediaValidationStatus
    absolute_path: str
    detected_type: str | None
    extension: str | None
    size_bytes: int | None
    sha256: str | None
    dimensions: tuple[int, int] | None
    duration_seconds: float | None
    errors: tuple[str, ...]
    warnings: tuple[str, ...]
    source_import_reference_only: bool
    version: str = PIPELINE_VERSION

    @property
    def valid_for_intake(self) -> bool:
        return self.status in {MediaValidationStatus.VALID, MediaValidationStatus.METADATA_PARTIAL}


@dataclass(frozen=True)
class AssetIntakeSubmission:
    submission_id: str
    requirement_id: str
    content_id: str
    source_path: str
    source_sha256: str | None
    managed_path: str | None
    media: MediaValidationResult
    status: AssetSubmissionStatus
    duplicate_of: str | None
    canonical_asset_id: str | None
    created_at: datetime
    updated_at: datetime
    version: str = PIPELINE_VERSION


@dataclass(frozen=True)
class VisualReviewRecord:
    review_id: str
    submission_id: str
    content_id: str
    decision: VisualReviewDecision
    operator_checks: Mapping[str, str]
    notes: str | None
    reviewed_at: datetime
    version: str = PIPELINE_VERSION


@dataclass(frozen=True)
class VisualReviewWorkbench:
    review_id: str
    submission_id: str
    requirement_id: str
    content_id: str
    managed_path: str
    machine_checks: Mapping[str, str]
    human_checks: Mapping[str, str | None]
    allowed_decisions: tuple[str, ...]
    gate_status: str
    version: str = PIPELINE_VERSION


@dataclass(frozen=True)
class AssetIntakeStatus:
    content_id: str
    total_requirements: int
    verified_requirements: int
    waiting_requirements: int
    pending_submissions: int
    validation_failures: int
    visual_reviews_pending: int
    next_action: str
    version: str = PIPELINE_VERSION


@dataclass(frozen=True)
class RecoveryReport:
    removed_staging_files: int
    quarantined_orphans: int
    missing_managed_files: int
    affected_submission_ids: tuple[str, ...]
    version: str = PIPELINE_VERSION


class MediaValidator:
    """Small magic-byte validator for the image formats used by A2/B3."""

    IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    VIDEO_EXTENSIONS = {".mp4"}
    MAX_SIZE = 100 * 1024 * 1024

    def __init__(self, module_root: str | Path | None = None) -> None:
        self.module_root = Path(module_root or Path(__file__).resolve().parents[3]).resolve()
        self.source_import = (self.module_root / "source_import").resolve()

    def validate(self, path: str | Path, requirement: AssetRequirement) -> MediaValidationResult:
        raw = Path(path)
        absolute = raw.resolve(strict=False)
        errors: list[str] = []
        warnings: list[str] = []
        extension = absolute.suffix.casefold() or None
        source_reference = absolute == self.source_import or absolute.is_relative_to(self.source_import)
        if not raw.is_absolute():
            errors.append("PATH_MUST_BE_ABSOLUTE")
        if str(absolute).startswith(("\\\\", "//")):
            errors.append("NETWORK_PATH_NOT_ALLOWED")
        if not absolute.is_file():
            errors.append("FILE_NOT_FOUND")
            return self._result(absolute, extension, None, None, None, None, errors, warnings, source_reference)
        try:
            size = absolute.stat().st_size
            if size <= 0:
                errors.append("EMPTY_FILE")
            if size > self.MAX_SIZE:
                errors.append("FILE_TOO_LARGE")
            digest = _sha256(absolute)
            detected, dimensions, duration = self._probe(absolute)
        except (OSError, ValueError, struct.error, zlib.error):
            return self._result(
                absolute, extension, None, None, None, None,
                (*errors, "CORRUPT_OR_UNREADABLE_MEDIA"), warnings, source_reference,
            )
        if detected is None:
            errors.append("UNSUPPORTED_OR_CORRUPT_MEDIA")
        if extension not in self.IMAGE_EXTENSIONS | self.VIDEO_EXTENSIONS:
            errors.append("UNSUPPORTED_EXTENSION")
        expected_extensions = {
            "image/png": {".png"}, "image/jpeg": {".jpg", ".jpeg"},
            "image/webp": {".webp"}, "image/gif": {".gif"},
            "video/mp4": {".mp4"},
        }
        if detected and extension not in expected_extensions.get(detected, set()):
            errors.append("EXTENSION_MAGIC_MISMATCH")
        if requirement.asset_type in {"IMAGE", "GENERATED_VISUAL", "COVER"}:
            if not detected or not detected.startswith("image/") or dimensions is None:
                errors.append("IMAGE_DIMENSIONS_UNAVAILABLE")
            else:
                width, height = dimensions
                min_width, min_height = requirement.minimum_dimensions
                if width < min_width or height < min_height:
                    errors.append("DIMENSIONS_BELOW_MINIMUM")
                actual_ratio = width / height
                if abs(actual_ratio - requirement.aspect_ratio_value) / requirement.aspect_ratio_value > 0.03:
                    errors.append("ASPECT_RATIO_MISMATCH")
        elif requirement.asset_type == "VIDEO":
            if detected != "video/mp4":
                errors.append("VIDEO_TYPE_MISMATCH")
            if duration is None:
                warnings.append("VIDEO_DURATION_METADATA_PARTIAL")
        if source_reference:
            errors.append("SOURCE_IMPORT_REFERENCE_ONLY")
        return self._result(
            absolute, extension, detected, size, digest, dimensions, errors, warnings,
            source_reference, duration,
        )

    @staticmethod
    def _result(
        path: Path, extension: str | None, detected: str | None, size: int | None,
        digest: str | None, dimensions: tuple[int, int] | None,
        errors: Sequence[str], warnings: Sequence[str], source_reference: bool,
        duration: float | None = None,
    ) -> MediaValidationResult:
        status = MediaValidationStatus.INVALID if errors else (
            MediaValidationStatus.METADATA_PARTIAL if warnings else MediaValidationStatus.VALID
        )
        return MediaValidationResult(
            status, str(path), detected, extension, size, digest, dimensions, duration,
            tuple(dict.fromkeys(errors)), tuple(dict.fromkeys(warnings)), source_reference,
        )

    @staticmethod
    def _probe(path: Path) -> tuple[str | None, tuple[int, int] | None, float | None]:
        with path.open("rb") as handle:
            head = handle.read(32)
        if head.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png", _png_dimensions(path), None
        if head.startswith(b"\xff\xd8"):
            return "image/jpeg", _jpeg_dimensions(path), None
        if head.startswith((b"GIF87a", b"GIF89a")):
            if len(head) < 10:
                raise ValueError("truncated GIF")
            width, height = struct.unpack("<HH", head[6:10])
            return "image/gif", (width, height), None
        if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            return "image/webp", _webp_dimensions(path), None
        if len(head) >= 12 and head[4:8] == b"ftyp":
            return "video/mp4", None, _mp4_duration(path)
        return None, None, None


class VisualAssetPipelineService:
    """Persistent requirement, managed-copy and human visual gate coordinator."""

    HUMAN_CHECKS = (
        "subject_matches_intent", "composition", "legibility", "text_accuracy",
        "visual_hierarchy", "platform_fit", "football_accuracy_if_applicable",
        "forbidden_elements", "brand_account_fit", "artifact_quality",
        "operator_approval",
    )

    def __init__(self, store: Any, workspace_root: str | Path | None = None) -> None:
        self.store = store
        self.pipeline = ContentPipelineService()
        module = Path(__file__).resolve().parents[3]
        self.module_root = module.resolve()
        self.workspace_root = Path(workspace_root or module / "runtime" / "asset-intake").resolve()
        temp_root = Path(tempfile.gettempdir()).resolve()
        if not (
            self.workspace_root.is_relative_to(self.module_root / "runtime")
            or self.workspace_root.is_relative_to(temp_root)
        ):
            raise ValueError("asset intake workspace must be inside Creator Ops runtime")
        if self.workspace_root == self.module_root / "source_import" or self.workspace_root.is_relative_to(self.module_root / "source_import"):
            raise ValueError("source_import is immutable")
        self.validator = MediaValidator(module)

    def freeze_requirements(self, requirements: Sequence[AssetRequirement]) -> tuple[AssetRequirement, ...]:
        with self.store.transaction():
            for item in requirements:
                content = self.store.contents.get_by_id(item.content_id)
                if item.account_id not in content.target_accounts:
                    raise ValueError("requirement account does not own content")
                existing = self.store.visual_assets.find_requirement(item.requirement_id)
                if existing is None:
                    self.store.visual_assets.save_requirement(item)
                elif not _same_requirement_contract(existing, item):
                    raise ValueError("frozen Asset Requirement identity conflict")
        for content_id in sorted({item.content_id for item in requirements}):
            self._ensure_workspace(content_id)
        return tuple(requirements)

    def get_requirements(self, content_id: str) -> tuple[AssetRequirement, ...]:
        self.store.contents.get_by_id(content_id)
        return self.store.visual_assets.list_requirements(content_id)

    def get_intake_status(self, content_id: str) -> AssetIntakeStatus:
        requirements = self.get_requirements(content_id)
        submissions = self.store.visual_assets.list_submissions(content_id=content_id)
        verified = sum(item.status is AssetRequirementStatus.VERIFIED for item in requirements)
        failures = sum(item.status is AssetSubmissionStatus.VALIDATION_FAILED for item in submissions)
        pending = sum(item.status is AssetSubmissionStatus.PENDING_HUMAN_VISUAL_REVIEW for item in submissions)
        if any(item.status in {
            AssetSubmissionStatus.ACTIVATED_PACKAGE_PENDING,
            AssetSubmissionStatus.RECOVERY_REQUIRED,
        } for item in submissions):
            next_action = "VERIFY_ASSET"
        elif not requirements:
            next_action = "DEFINE_ASSET_REQUIREMENTS"
        elif pending:
            next_action = "VISUAL_REVIEW"
        elif verified == len(requirements):
            next_action = "NONE"
        elif any(item.status is AssetRequirementStatus.SUBMITTED for item in requirements):
            next_action = "VERIFY_ASSET"
        elif any(item.status is AssetRequirementStatus.REJECTED for item in requirements):
            next_action = "GENERATE_ASSET"
        else:
            next_action = "GENERATE_ASSET"
        return AssetIntakeStatus(
            content_id, len(requirements), verified, len(requirements) - verified,
            pending, failures, pending, next_action,
        )

    def submit_asset(
        self, requirement_id: str, asset_path: str | Path, *, now: datetime,
        failure_point: str | None = None,
    ) -> AssetIntakeSubmission:
        requirement = self.store.visual_assets.get_requirement(requirement_id)
        media = self.validator.validate(asset_path, requirement)
        identity_material = media.sha256 or f"{media.absolute_path}|{'|'.join(media.errors)}"
        submission_id = f"submission:{requirement_id}:{hashlib.sha256(identity_material.encode('utf-8')).hexdigest()[:24]}"
        existing = self.store.visual_assets.find_submission(submission_id)
        if existing is not None:
            return replace(existing, duplicate_of=existing.submission_id)
        if not media.valid_for_intake:
            failed = AssetIntakeSubmission(
                submission_id, requirement_id, requirement.content_id, media.absolute_path,
                media.sha256, None, media, AssetSubmissionStatus.VALIDATION_FAILED,
                None, None, now, now,
            )
            with self.store.transaction():
                self.store.visual_assets.save_submission(failed)
            return failed

        assert media.sha256 and media.extension
        directories = self._ensure_workspace(requirement.content_id)
        managed_dir = directories["managed"] / requirement.requirement_id
        managed_dir.mkdir(parents=True, exist_ok=True)
        target = managed_dir / f"{media.sha256[:24]}{media.extension}"
        staging = directories["staging"] / f"{submission_id.replace(':', '_')}.staging"
        target_created = False
        try:
            if target.exists():
                if _sha256(target) != media.sha256:
                    raise ValueError("managed copy identity conflicts with existing file")
            else:
                with Path(media.absolute_path).open("rb") as source, staging.open("xb") as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                    output.flush()
                    os.fsync(output.fileno())
                if _sha256(staging) != media.sha256:
                    raise ValueError("managed copy hash verification failed")
                os.replace(staging, target)
                target_created = True
            if failure_point == "AFTER_MANAGED_COPY_BEFORE_DB":
                raise RuntimeError("injected intake failure after managed copy")
            submission = AssetIntakeSubmission(
                submission_id, requirement_id, requirement.content_id, media.absolute_path,
                media.sha256, str(target), media,
                AssetSubmissionStatus.PENDING_HUMAN_VISUAL_REVIEW, None, None, now, now,
            )
            updated_requirement = replace(
                requirement, status=AssetRequirementStatus.SUBMITTED, updated_at=now,
            )
            with self.store.transaction():
                self.store.visual_assets.save_submission(submission)
                self.store.visual_assets.update_requirement(updated_requirement)
                if failure_point == "DURING_DB_TRANSACTION":
                    raise RuntimeError("injected intake DB transaction failure")
            return submission
        except Exception:
            if target_created and target.is_file():
                target.unlink()
            raise
        finally:
            if staging.exists():
                staging.unlink()

    def get_review_workbench(self, submission_id: str) -> VisualReviewWorkbench:
        submission = self.store.visual_assets.get_submission(submission_id)
        if submission.status is not AssetSubmissionStatus.PENDING_HUMAN_VISUAL_REVIEW:
            raise ValueError("submission is not pending human visual review")
        if not submission.managed_path or not Path(submission.managed_path).is_file():
            raise ValueError("managed media is missing")
        requirement = self.store.visual_assets.get_requirement(submission.requirement_id)
        machine = {
            "file_exists": "PASS", "file_type": "PASS", "hash": "PASS",
            "dimensions": "PASS", "minimum_dimensions": "PASS", "aspect_ratio": "PASS",
            "requirement_match": "PASS",
        }
        human = {item: None for item in self.HUMAN_CHECKS}
        if requirement.text_overlay_requirement == "NO_TEXT_IN_IMAGE":
            human["text_accuracy"] = None
        return VisualReviewWorkbench(
            f"VISUAL-HUMAN-REVIEW-{hashlib.sha256(submission.submission_id.encode('utf-8')).hexdigest()[:24]}",
            submission.submission_id, requirement.requirement_id, requirement.content_id,
            submission.managed_path, machine, human,
            ("APPROVE", "REJECT", "REQUEST_CHANGE"), "PENDING_HUMAN_REVIEW",
        )

    def review_submission(
        self, submission_id: str, *, decision: VisualReviewDecision,
        operator_checks: Mapping[str, str], notes: str | None,
        human_confirmation: bool, now: datetime,
    ) -> tuple[AssetIntakeSubmission, Asset | None]:
        if decision is VisualReviewDecision.PENDING:
            raise ValueError("a terminal human decision is required")
        if not human_confirmation:
            raise ValueError("human visual review confirmation is required")
        workbench = self.get_review_workbench(submission_id)
        submission = self.store.visual_assets.get_submission(submission_id)
        requirement = self.store.visual_assets.get_requirement(submission.requirement_id)
        normalized = {key: str(value).upper() for key, value in operator_checks.items()}
        unknown = set(normalized) - set(self.HUMAN_CHECKS)
        if unknown:
            raise ValueError("unknown visual review check")
        if decision is VisualReviewDecision.APPROVE and any(
            normalized.get(key) != "PASS" for key in self.HUMAN_CHECKS
        ):
            raise ValueError("APPROVE requires every human visual check to PASS")
        review = VisualReviewRecord(
            workbench.review_id, submission_id, submission.content_id, decision,
            normalized, notes, now,
        )
        if decision is not VisualReviewDecision.APPROVE:
            status = AssetSubmissionStatus.REJECTED if decision is VisualReviewDecision.REJECT else AssetSubmissionStatus.REQUEST_CHANGES
            updated_submission = replace(submission, status=status, updated_at=now)
            updated_requirement = replace(requirement, status=AssetRequirementStatus.REJECTED, updated_at=now)
            qa = FormalQARunner.visual(
                submission.content_id, package_id=review.review_id,
                operator_checks=_visual_checks(normalized, decision), now=now,
            )
            with self.store.transaction():
                self.store.visual_assets.save_review(review)
                self.store.visual_assets.update_submission(updated_submission)
                self.store.visual_assets.update_requirement(updated_requirement)
                self.store.runtime.save_qa_receipt(qa)
            return updated_submission, None

        assert submission.managed_path and submission.source_sha256
        managed = Path(submission.managed_path)
        if not managed.is_file() or _sha256(managed) != submission.source_sha256:
            raise ValueError("managed media changed before activation")
        content = self.store.contents.get_by_id(submission.content_id)
        asset_id = f"asset:visual:{requirement.requirement_id}:{submission.source_sha256[:16]}"
        asset = Asset(
            asset_id, AssetType(requirement.asset_type), "visual_asset_intake",
            str(managed), (content.content_id,),
            Provenance(
                "human_controlled_external_ai_handoff", submission.source_path, now,
                captured_by="CreatorOpsApplication", confidence="HUMAN_APPROVED",
                notes=f"requirement={requirement.requirement_id}; review={review.review_id}",
            ),
            GenerationMethod.AI_ASSISTED, content.creator_id, (requirement.account_id,),
            AssetStatus.AVAILABLE, now, now, None,
            {"sha256": submission.source_sha256, "requirement_id": requirement.requirement_id,
             "submission_id": submission.submission_id, "visual_review_id": review.review_id,
             "media_dimensions": submission.media.dimensions},
        )
        updated_content = self.pipeline.attach_asset(content, asset, now=now)
        updated_requirement = replace(requirement, status=AssetRequirementStatus.VERIFIED, updated_at=now)
        updated_submission = replace(
            submission, status=AssetSubmissionStatus.ACTIVATED_PACKAGE_PENDING,
            canonical_asset_id=asset_id, updated_at=now,
        )
        future_statuses = {
            item.requirement_id: (AssetRequirementStatus.VERIFIED if item.requirement_id == requirement.requirement_id else item.status)
            for item in self.store.visual_assets.list_requirements(content.content_id)
        }
        checks = _visual_checks(normalized, decision)
        checks.append({
            "check_id": "visual:all_requirements_verified",
            "status": "PASS" if all(value is AssetRequirementStatus.VERIFIED for value in future_statuses.values()) else "PENDING",
            "message": "all required visual assets are human-approved",
        })
        qa = FormalQARunner.visual(
            content.content_id, package_id=review.review_id, operator_checks=checks, now=now,
        )
        with self.store.transaction():
            self.store.visual_assets.save_review(review)
            self.store.assets.save(asset)
            self.store.contents.update(updated_content)
            self.store.visual_assets.update_requirement(updated_requirement)
            self.store.visual_assets.update_submission(updated_submission)
            self.store.runtime.save_qa_receipt(qa)
        return updated_submission, asset

    def mark_package_complete(self, submission_id: str, *, now: datetime) -> AssetIntakeSubmission:
        submission = self.store.visual_assets.get_submission(submission_id)
        if submission.status not in {AssetSubmissionStatus.ACTIVATED_PACKAGE_PENDING, AssetSubmissionStatus.ACTIVATED}:
            raise ValueError("submission has not been canonically activated")
        if not submission.managed_path or not Path(submission.managed_path).is_file():
            raise ValueError("managed media is missing")
        updated = replace(submission, status=AssetSubmissionStatus.ACTIVATED, updated_at=now)
        if updated != submission:
            with self.store.transaction():
                self.store.visual_assets.update_submission(updated)
        return updated

    def recover(self, *, now: datetime) -> RecoveryReport:
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        removed = 0
        for path in self.workspace_root.glob("*/.staging/*.staging"):
            if path.is_file():
                path.unlink()
                removed += 1
        submissions = self.store.visual_assets.list_submissions()
        managed_by_path = {
            Path(item.managed_path).resolve(): item for item in submissions if item.managed_path
        }
        quarantine = self.workspace_root / ".quarantine"
        quarantined = 0
        for path in self.workspace_root.glob("*/managed/**/*"):
            if path.is_file() and path.resolve() not in managed_by_path:
                quarantine.mkdir(parents=True, exist_ok=True)
                target = quarantine / f"{_sha256(path)[:24]}{path.suffix.casefold()}"
                if target.exists() and _sha256(target) == _sha256(path):
                    path.unlink()
                else:
                    os.replace(path, target)
                quarantined += 1
        missing: list[str] = []
        for path, item in managed_by_path.items():
            if not path.is_file() and item.status not in {
                AssetSubmissionStatus.VALIDATION_FAILED,
                AssetSubmissionStatus.REJECTED,
                AssetSubmissionStatus.REQUEST_CHANGES,
            }:
                missing.append(item.submission_id)
                updated = replace(item, status=AssetSubmissionStatus.RECOVERY_REQUIRED, updated_at=now)
                with self.store.transaction():
                    self.store.visual_assets.update_submission(updated)
        return RecoveryReport(removed, quarantined, len(missing), tuple(sorted(missing)))

    def _ensure_workspace(self, content_id: str) -> Mapping[str, Path]:
        root = (self.workspace_root / content_id).resolve()
        if not root.is_relative_to(self.workspace_root):
            raise ValueError("unsafe content identity for asset intake workspace")
        directories = {
            "root": root, "incoming": root / "incoming", "staging": root / ".staging",
            "managed": root / "managed", "receipts": root / "receipts",
        }
        for path in directories.values():
            path.mkdir(parents=True, exist_ok=True)
        return directories


def _visual_checks(checks: Mapping[str, str], decision: VisualReviewDecision) -> list[dict[str, str]]:
    result = [{
        "check_id": f"visual:{key}", "status": value,
        "message": "human visual review check",
    } for key, value in checks.items()]
    result.append({
        "check_id": "visual:review_decision",
        "status": "PASS" if decision is VisualReviewDecision.APPROVE else "FAIL",
        "message": f"human decision={decision.value}",
    })
    return result


def build_authoritative_visual_packets(
    *, now: datetime, workspace_root: str | Path,
) -> tuple[VisualProductionPacket, VisualProductionPacket]:
    """Return the frozen A2/B3 contracts derived from reconciled production evidence."""

    workspace = Path(workspace_root).resolve()
    a2_source = (
        "source_import/06_自媒体运营/A2_抖音颜值/2026-07/"
        "A2-20260714-001_下课后的校园独白/content_package.md"
    )
    a2_prompt_source = (
        "source_import/06_自媒体运营/A2_抖音颜值/2026-07/"
        "A2-20260714-001_下课后的校园独白/prompts/ai_visual_prompts.md"
    )
    b3_source = (
        "source_import/06_自媒体运营/B3_小红书AI学习/2026-07/"
        "B3-20260714-001_大学生第一次用ChatGPT先记住这3点/content_package.md"
    )
    b3_prompt_source = (
        "source_import/06_自媒体运营/B3_小红书AI学习/2026-07/"
        "B3-20260714-001_大学生第一次用ChatGPT先记住这3点/prompts/guizang_render_request.md"
    )
    shared_provenance = {
        "reconciliation": "FULL_SOURCE_RECONCILIATION_V0.2",
        "legacy_handoff": "RealLegacyAdapter.build_human_ai_handoff",
        "football_methodology": "NOT_APPLICABLE_B2_ONLY",
        "control_mode": HUMAN_AI_CONTROL_MODE,
    }

    def requirement(
        requirement_id: str, content_id: str, account: str, role: str, purpose: str,
        subject: str, composition: str, hierarchy: str, text_rule: str,
        style: Sequence[str], include: Sequence[str], exclude: Sequence[str], filename: str,
        source: str, *, dimensions: tuple[int, int], ratio: str,
    ) -> AssetRequirement:
        return AssetRequirement(
            requirement_id, content_id, account, role, "GENERATED_VISUAL", True,
            purpose, "抖音竖屏短视频" if account == "A2" else "小红书 3:4 图文轮播",
            subject, composition, hierarchy, text_rule, ratio,
            dimensions, dimensions, "REFERENCE_ONLY_NO_LEGACY_ASSET_ATTACHMENT",
            tuple(style), tuple(include), tuple(exclude),
            ("保持账号方向", "人工审图后才可成为 AVAILABLE Asset", "禁止 CASE-0004/CASE-0009 冒充正式素材"),
            ("magic-byte file validation", "minimum dimensions", "aspect ratio tolerance <= 3%",
             "exact text checked by human", "artifact quality checked by human",
             "platform and account fit checked by human"),
            {**shared_provenance, "source_content_package": source},
            AssetRequirementStatus.READY_FOR_GENERATION, filename, now, now,
        )

    a2_requirements = (
        requirement(
            "A2-20260714-001-VIDEO-COVER", "A2-20260714-001", "A2", "VIDEO_COVER",
            "作为 30 秒校园独白短视频的首帧与抖音封面底图",
            "傍晚放学后的大学校园走廊，远处暖光，画面中没有人",
            "低机位纵深透视，走廊引导线通向晚霞；上方与中部保留字幕安全区",
            "先看到暖光尽头，再看到安静走廊与地面反光",
            "NO_TEXT_IN_IMAGE",
            ("写实电影感", "克制青春感", "蓝金暮色", "自然光影", "9:16"),
            ("校园走廊", "下课后的空旷感", "真实建筑尺度", "可作封面的清晰视觉焦点"),
            ("真人或人脸", "校徽与品牌标志", "可识别文字", "水印", "赛博霓虹", "过度梦幻"),
            "A2-20260714-001_video-cover.png", a2_source,
            dimensions=(1080, 1920), ratio="9:16",
        ),
        requirement(
            "A2-20260714-001-SCENE-01", "A2-20260714-001", "A2", "PRIMARY_CARD",
            "承载 0–10 秒开场和校园空间移动段落",
            "下课后空无一人的大学教学楼走廊，门窗透入金色夕阳",
            "竖屏广角，中心消失点，轻微前进感；下三分之一避免复杂细节",
            "夕阳光束为第一层，走廊空间为第二层，细微尘埃与反光为第三层",
            "NO_TEXT_IN_IMAGE",
            ("photorealistic", "cinematic still", "subtle motion cue", "natural campus", "9:16"),
            ("走廊", "夕阳光束", "空镜", "真实材质", "字幕安全区"),
            ("人物", "乱码文字", "水印", "logo", "豪华虚假校园", "强 HDR"),
            "A2-20260714-001_scene-01-corridor.png", a2_prompt_source,
            dimensions=(1080, 1920), ratio="9:16",
        ),
        requirement(
            "A2-20260714-001-SCENE-02", "A2-20260714-001", "A2", "PRIMARY_CARD",
            "承载 10–20 秒“风、脚步、远处的晚霞”的细节段落",
            "傍晚大学操场跑道、被风轻推的树影与远处晚霞，不出现人物",
            "贴近跑道的低视角，弯道从前景延伸到天际；树影形成轻微方向感",
            "跑道纹理与光影细节优先，晚霞作为远景情绪锚点",
            "NO_TEXT_IN_IMAGE",
            ("写实体育场空镜", "温柔风感", "自然暮色", "电影镜头", "9:16"),
            ("标准跑道", "风吹树影", "远处晚霞", "空旷感", "真实透视"),
            ("运动员", "足球元素", "赛事标志", "文字", "水印", "不可能的跑道结构"),
            "A2-20260714-001_scene-02-track.png", a2_prompt_source,
            dimensions=(1080, 1920), ratio="9:16",
        ),
        requirement(
            "A2-20260714-001-SCENE-03", "A2-20260714-001", "A2", "PRIMARY_CARD",
            "承载 20–30 秒“今天也算认真活过”的情绪收束",
            "蓝调时刻的大学校园出口与天边最后一抹晚霞，路灯刚亮，无人",
            "竖屏中远景，出口位于下方三分之一，天空留出大面积呼吸感和字幕区",
            "天空余晖为情绪主角，路灯和出口提供安稳落点",
            "NO_TEXT_IN_IMAGE",
            ("quiet cinematic realism", "blue hour", "soft amber practical lights", "9:16"),
            ("校园出口", "刚亮的路灯", "晚霞余光", "宁静收束", "真实夜色过渡"),
            ("人物", "车辆特写", "文字", "水印", "阴森恐怖", "夸张星空"),
            "A2-20260714-001_scene-03-closing.png", a2_prompt_source,
            dimensions=(1080, 1920), ratio="9:16",
        ),
    )

    b3_text = (
        (
            "B3-20260714-001-CARD-01", "COVER", "建立第一眼主题与收藏动机",
            "大学生第一次用 ChatGPT 的 3 点入门原则",
            "强网格封面，大标题左对齐，右侧或下方使用 IKB 蓝几何锚点",
            "标题 > 3点 > 副标题 > 小型页码",
            "大学生第一次用ChatGPT\n先记住这3点\n不神化AI，也不盲目复制答案",
            "B3-20260714-001_card-01-cover.png",
        ),
        (
            "B3-20260714-001-CARD-02", "PRIMARY_CARD", "指出大学生最常见的三类误用",
            "三个常见错误，以编号清单形成问题识别页",
            "左对齐三段编号，蓝色数字块与黑色正文形成节奏",
            "页标题 > 01/02/03 > 错误描述",
            "大学生常见错误\n01 把模糊问题直接丢给AI\n02 不核验重要信息\n03 把答案当成自己的思考",
            "B3-20260714-001_card-02-problems.png",
        ),
        (
            "B3-20260714-001-CARD-03", "PRIMARY_CARD", "说明方法一：把任务说具体",
            "六个提示词要素的结构化方法卡",
            "大号“01”作蓝色锚点，正文采用模块化网格，留白充足",
            "方法一 > 把任务说具体 > 六要素",
            "方法一\n把任务说具体\n说清角色、任务、用途、受众、格式和限制",
            "B3-20260714-001_card-03-method-01.png",
        ),
        (
            "B3-20260714-001-CARD-04", "PRIMARY_CARD", "说明方法二：重要信息要核验",
            "核验清单方法卡，以勾选框和信息来源符号辅助理解",
            "大号“02”与短清单，蓝色只用于编号、分割线和核验标记",
            "方法二 > 重要信息要核验 > 核验范围",
            "方法二\n重要信息要核验\n事实、数据、引用和时效信息，都要回到可靠来源确认",
            "B3-20260714-001_card-04-method-02.png",
        ),
        (
            "B3-20260714-001-CARD-05", "PRIMARY_CARD", "说明方法三：让 AI 辅助思考",
            "人类判断居中、AI 从旁辅助的思考流程卡",
            "大号“03”，三步箭头：给框架—提问题/找盲点—自己判断表达",
            "方法三 > 让AI辅助思考 > 三步流程",
            "方法三\n让AI辅助思考\n先让AI给框架、提问题、找盲点，再由你判断和表达",
            "B3-20260714-001_card-05-method-03.png",
        ),
        (
            "B3-20260714-001-CARD-06", "INFOGRAPHIC", "提供可收藏、可抄写的完整提示词模板",
            "四行可复制提示词模板与“需要核验”提醒",
            "标题在上，模板置于细线框内，每行独立；底部用 IKB 蓝做收藏提示",
            "收藏页标题 > 四行模板 > 核验提醒",
            "可复制提示词模板\n请扮演[角色]，帮我完成[任务]。\n用途是[用途]，受众是[受众]。\n请输出为[格式]，限制是[限制]。\n如果信息不确定，请标注“需要核验”。",
            "B3-20260714-001_card-06-template.png",
        ),
    )
    b3_requirements = tuple(requirement(
        req_id, "B3-20260714-001", "B3", role, purpose, subject, composition,
        hierarchy, f"EXACT_TEXT:\n{exact_text}",
        ("Swiss International Style", "white background", "black typography", "IKB blue #002FA7 anchor", "strict grid", "3:4"),
        ("exact Chinese text", "clear typographic hierarchy", "large margins", "consistent six-page system"),
        ("additional words", "text paraphrase", "typos", "English substitution", "decorative gradients", "3D mockups", "watermark", "photorealistic people"),
        filename, b3_source, dimensions=(1080, 1440), ratio="3:4",
    ) for req_id, role, purpose, subject, composition, hierarchy, exact_text, filename in b3_text)

    a2_spec = VisualProductionSpec(
        "A2-20260714-001", "用四张一致的竖屏空镜组成 30 秒校园独白视觉序列",
        "正在经历学业疲惫、需要轻度情绪共鸣的大学生",
        "下课不是一天的结束，而是疲惫之后重新感到生活发光",
        tuple(item.requirement_id for item in a2_requirements), "NO_TEXT_IN_IMAGE；字幕在剪辑阶段添加",
        ("真实大学校园尺度", "自然光线与材质", "四张图的时段、色调和镜头语言连续"),
        "NOT_APPLICABLE：该内容与足球无关；B2 Football AI Visual Methodology 不得套用",
        ("出现真人/可识别人脸", "出现乱码、校徽、品牌或水印", "四张画面风格断裂", "不真实建筑/跑道结构", "过度赛博或奇幻"),
        ("四张均为 1080×1920", "主体与分镜一致", "保留字幕安全区", "无图中文字", "人工视觉审查 11 项全部 PASS"),
        (a2_source, a2_prompt_source, "RealLegacyAdapter.classify_football_ai_visual(B2 only)"),
    )
    b3_spec = VisualProductionSpec(
        "B3-20260714-001", "用六张结构一致的信息卡讲清大学生使用 ChatGPT 的三项原则",
        "初次或浅度使用生成式 AI 的大学生",
        "不神化、不照抄：任务具体、信息核验、AI 辅助思考",
        tuple(item.requirement_id for item in b3_requirements), "每页只允许 requirement 中的 EXACT_TEXT，逐字人工核对",
        ("严格 Swiss 网格", "白底黑字", "IKB 蓝 #002FA7 仅作锚点", "六页字号与边距体系一致"),
        "NOT_APPLICABLE：该内容与足球无关；B2 Football AI Visual Methodology 不得套用",
        ("任何错字、漏字、增字或改写", "字体不可读", "六页体系不一致", "渐变/3D/照片喧宾夺主", "水印或平台 UI"),
        ("六张均为 1080×1440", "所有 EXACT_TEXT 逐字正确", "层级清晰", "手机缩略图可读", "人工视觉审查 11 项全部 PASS"),
        (b3_source, b3_prompt_source, "RealLegacyAdapter.build_human_ai_handoff"),
    )

    a2_handoffs = tuple(_handoff(
        item, goal=f"生成 A2 校园独白素材：{item.purpose}",
        prompt=(
            f"为抖音竖屏短视频《下课后的校园独白》生成一张生产级写实电影感画面。\n"
            f"画面主体：{item.visual_subject}\n构图：{item.composition}\n视觉层级：{item.visual_hierarchy}\n"
            f"风格：{'；'.join(item.style_requirements)}。\n必须包含：{'；'.join(item.must_include)}。\n"
            f"禁止：{'；'.join(item.must_not_include)}。\n"
            "画面必须像真实大学校园的自然摄影，不出现任何人物、文字、字母、数字、logo 或水印。"
            "保留干净字幕安全区；不要自行添加标题或字幕。输出单张 9:16 竖图，1080×1920。"
        ), workspace=workspace, source=(a2_source, a2_prompt_source),
    ) for item in a2_requirements)
    b3_handoffs = tuple(_handoff(
        item, goal=f"生成 B3 六页轮播中的 {item.asset_role}：{item.purpose}",
        prompt=(
            "请生成一张生产级小红书信息卡，Swiss International Style，严格 3:4 竖版 1080×1440。"
            "使用纯白背景、黑色现代无衬线中文字体、IKB 蓝 #002FA7 作为唯一锚点色；严格网格、充足留白、"
            f"清晰层级。主题：{item.visual_subject}。构图：{item.composition}。层级：{item.visual_hierarchy}。\n"
            "图中只允许出现以下文字，必须逐字逐符号准确，不得概括、增删、改写或翻译：\n---\n"
            f"{item.text_overlay_requirement[len('EXACT_TEXT:') + 1:]}\n---\n"
            "不要生成照片人物、插画吉祥物、渐变、3D 效果、水印、平台 UI、额外英文或装饰性乱码。"
            "请先核对每个汉字、数字、方括号和标点，再输出一张完整平面卡片，不要展示在手机或海报 mockup 中。"
        ), workspace=workspace, source=(b3_source, b3_prompt_source),
    ) for item in b3_requirements)
    return (
        VisualProductionPacket(
            "A2-20260714-001", "A2", "4 张 9:16 无真人校园氛围图，供 30 秒短视频封面与三段分镜使用",
            a2_requirements, a2_spec, a2_handoffs, str(workspace / "A2-20260714-001" / "incoming"),
        ),
        VisualProductionPacket(
            "B3-20260714-001", "B3", "6 张 3:4 Swiss 信息卡，逐页 EXACT_TEXT",
            b3_requirements, b3_spec, b3_handoffs, str(workspace / "B3-20260714-001" / "incoming"),
        ),
    )


def _handoff(
    requirement: AssetRequirement, *, goal: str, prompt: str,
    workspace: Path, source: tuple[str, ...],
) -> HumanAIImageHandoff:
    return HumanAIImageHandoff(
        f"handoff:{requirement.requirement_id}:v0.2", requirement.content_id,
        requirement.account_id, requirement.requirement_id, goal, prompt,
        ("Legacy CASE-0004/CASE-0009 仅作方法参考，不上传、不混用", "没有可信的 A2/B3 旧正式素材引用"),
        requirement.aspect_ratio, 1,
        ("符合 requirement 主体与构图", "无禁用元素", "尺寸/比例正确", "人工审图通过"),
        requirement.must_not_include, requirement.expected_filename,
        str(workspace / requirement.content_id / "incoming" / requirement.expected_filename),
        ("在 ChatGPT 中新建人工生图对话", "复制完整 prompt，不让模型自行改写文字",
         "下载原图并按 expected_filename 命名", "人工检查后通过 CreatorOpsApplication.submit_asset 提交"),
        ("根据 prompt 生成 1 个候选", "保持指定比例和尺寸", "B3 必须逐字核对 exact_text", "等待人类选择，不执行发布"),
        "用户必须检查主体、构图、文字、品牌适配和伪影，并通过 Visual Review Gate 明确 APPROVE",
        "返回一个本地绝对路径；系统复制到 managed storage，不覆盖原文件",
        source,
    )


def _same_requirement_contract(left: AssetRequirement, right: AssetRequirement) -> bool:
    ignored = {"status", "created_at", "updated_at"}
    return all(
        getattr(left, name) == getattr(right, name)
        for name in left.__dataclass_fields__ if name not in ignored
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 45 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("truncated PNG")
    offset = 8
    width = height = None
    saw_iend = False
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        chunk_type = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError("truncated PNG chunk")
        payload = data[offset + 8:offset + 8 + length]
        expected_crc = struct.unpack(">I", data[offset + 8 + length:end])[0]
        if zlib.crc32(chunk_type + payload) & 0xFFFFFFFF != expected_crc:
            raise ValueError("PNG CRC mismatch")
        if chunk_type == b"IHDR":
            if length != 13:
                raise ValueError("invalid PNG IHDR")
            width, height = struct.unpack(">II", payload[:8])
        if chunk_type == b"IEND":
            saw_iend = True
            break
        offset = end
    if not width or not height or not saw_iend:
        raise ValueError("incomplete PNG")
    return width, height


def _jpeg_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        if handle.read(2) != b"\xff\xd8":
            raise ValueError("invalid JPEG")
        while True:
            byte = handle.read(1)
            if not byte:
                raise ValueError("JPEG dimensions unavailable")
            if byte != b"\xff":
                continue
            marker = handle.read(1)
            while marker == b"\xff":
                marker = handle.read(1)
            if marker in {bytes([value]) for value in range(0xC0, 0xD0)} - {b"\xc4", b"\xc8", b"\xcc"}:
                length = struct.unpack(">H", handle.read(2))[0]
                data = handle.read(length - 2)
                if len(data) < 5:
                    raise ValueError("truncated JPEG SOF")
                height, width = struct.unpack(">HH", data[1:5])
                return width, height
            if marker in {b"\xd8", b"\xd9", b"\x01"}:
                continue
            length_bytes = handle.read(2)
            if len(length_bytes) != 2:
                raise ValueError("truncated JPEG marker")
            handle.seek(struct.unpack(">H", length_bytes)[0] - 2, 1)


def _webp_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("truncated WebP")
    declared = struct.unpack("<I", data[4:8])[0] + 8
    if declared > len(data):
        raise ValueError("truncated WebP RIFF")
    chunk = data[12:16]
    if chunk == b"VP8X":
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if chunk == b"VP8L" and data[20] == 0x2F:
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
        width, height = struct.unpack("<HH", data[26:30])
        return width & 0x3FFF, height & 0x3FFF
    raise ValueError("unsupported WebP bitstream")


def _mp4_duration(path: Path) -> float | None:
    with path.open("rb") as handle:
        data = handle.read(min(path.stat().st_size, 16 * 1024 * 1024))
    marker = data.find(b"mvhd")
    if marker < 0 or len(data) < marker + 24:
        return None
    version = data[marker + 4]
    if version == 0:
        timescale = struct.unpack(">I", data[marker + 16:marker + 20])[0]
        duration = struct.unpack(">I", data[marker + 20:marker + 24])[0]
    elif version == 1 and len(data) >= marker + 40:
        timescale = struct.unpack(">I", data[marker + 28:marker + 32])[0]
        duration = struct.unpack(">Q", data[marker + 32:marker + 40])[0]
    else:
        return None
    return round(duration / timescale, 3) if timescale else None
