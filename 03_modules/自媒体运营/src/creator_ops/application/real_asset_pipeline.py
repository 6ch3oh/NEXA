"""Read-only real-asset reconciliation and pre-publish review preparation."""

from __future__ import annotations

import hashlib
import json
import os
import struct
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Mapping, Sequence

from creator_ops.application.qa_runtime import QAType
from creator_ops.compatibility.source_reconciliation import SOURCE_GROUPS, SourceReconciliationCatalog
from creator_ops.domain.models import (
    Asset, AssetStatus, AssetType, ContentState, GenerationMethod,
    LegacyReference, Provenance,
)
from creator_ops.persistence.errors import PersistenceError, PersistenceErrorCode
from creator_ops.services.content_pipeline import ContentPipelineService


class AssetCandidateDecision(str, Enum):
    VERIFIED_MATCH = "VERIFIED_MATCH"
    STRONG_CANDIDATE = "STRONG_CANDIDATE"
    AMBIGUOUS = "AMBIGUOUS"
    UNRELATED = "UNRELATED"
    INVALID = "INVALID"


@dataclass(frozen=True)
class RealAssetCandidate:
    asset_candidate_id: str
    absolute_source_path: str
    file_type: str
    size_bytes: int
    sha256: str
    dimensions: tuple[int, int] | None
    duration_seconds: float | None
    legacy_account_code: str | None
    legacy_content_id: str | None
    relationship_evidence: tuple[str, ...]
    confidence: str
    decision: AssetCandidateDecision
    version: str = "0.1"


@dataclass(frozen=True)
class RealAssetReconciliation:
    source_files_checked: int
    source_bytes_checked: int
    candidates: tuple[RealAssetCandidate, ...]
    unknown_count: int = 0
    version: str = "0.1"

    @property
    def decision_counts(self) -> Mapping[str, int]:
        return {item.value: sum(row.decision is item for row in self.candidates)
                for item in AssetCandidateDecision}


@dataclass(frozen=True)
class RealReviewWorkbench:
    content_id: str
    account_id: str
    content_state: str
    package_id: str
    package_manifest_path: str
    package_digest: str | None
    verified_asset_ids: tuple[str, ...]
    reference_asset_ids: tuple[str, ...]
    prompt_references: tuple[str, ...]
    research_references: tuple[str, ...]
    qa_statuses: Mapping[str, str]
    warnings: tuple[str, ...]
    missing_conditions: tuple[str, ...]
    subjective_review_required: bool
    version: str = "0.1"


class RealAssetCandidateResolver:
    """Inventory the six sealed source groups and fail closed on relationships."""

    MEDIA_EXTENSIONS = frozenset({
        ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff",
        ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mp3", ".wav",
        ".m4a", ".aac", ".flac", ".pdf", ".psd", ".svg",
    })

    def __init__(self, catalog: SourceReconciliationCatalog | None = None) -> None:
        self.catalog = catalog or SourceReconciliationCatalog.current_module()

    def resolve(self, *, content_accounts: Mapping[str, str]) -> RealAssetReconciliation:
        coverage = self.catalog.build()
        content_ids = tuple(content_accounts)
        candidates: list[RealAssetCandidate] = []
        for record in coverage.records:
            path = (self.catalog.root / record.group / record.relative_path).resolve()
            if path.suffix.casefold() not in self.MEDIA_EXTENSIONS:
                continue
            try:
                digest = _sha256(path)
                dimensions, duration = _probe(path)
                decision, content_id, evidence, confidence = self._relationship(
                    path, record.group, record.relative_path, content_ids,
                )
                account = content_accounts.get(content_id) if content_id else None
            except (OSError, ValueError):
                digest, dimensions, duration = "", None, None
                decision, content_id, account = AssetCandidateDecision.INVALID, None, None
                evidence, confidence = ("file could not be read or safely probed",), "HIGH"
            identity = hashlib.sha256(
                f"{path}|{digest}".encode("utf-8")
            ).hexdigest()[:24]
            candidates.append(RealAssetCandidate(
                f"asset-candidate:{identity}", str(path), path.suffix.casefold().lstrip("."),
                record.size_bytes, digest, dimensions, duration, account, content_id,
                evidence, confidence, decision,
            ))
        candidates.sort(key=lambda item: item.absolute_source_path.casefold())
        return RealAssetReconciliation(
            coverage.covered_files, coverage.total_bytes, tuple(candidates), 0,
        )

    def _relationship(
        self, path: Path, group: str, relative_path: str,
        content_ids: Sequence[str],
    ) -> tuple[AssetCandidateDecision, str | None, tuple[str, ...], str]:
        relative = f"{group}/{relative_path}".replace("\\", "/")
        for content_id in content_ids:
            metadata = self._ancestor_metadata(path)
            if metadata.get("content_id") == content_id:
                asset_state = str(metadata.get("assets_status") or "").casefold()
                if asset_state not in {"external_or_missing", "missing", "unverified"}:
                    return (
                        AssetCandidateDecision.VERIFIED_MATCH, content_id,
                        (f"ancestor authoritative metadata declares content_id={content_id}",
                         f"source={relative}"), "MACHINE_VERIFIED",
                    )
            if content_id.casefold() in relative.casefold():
                return (
                    AssetCandidateDecision.STRONG_CANDIDATE, content_id,
                    ("path contains the authoritative content_id but no explicit asset relation",),
                    "MEDIUM",
                )
        if "/案例库/CASE-" in relative or "/case-" in relative.casefold():
            return (
                AssetCandidateDecision.UNRELATED, None,
                ("asset is explicitly owned by a separate CASE identity",
                 "no A2/B3 content_id or manifest relation was found"), "HIGH",
            )
        return (
            AssetCandidateDecision.AMBIGUOUS, None,
            ("media exists in the authorized project but has no machine-verifiable content relation",),
            "LOW",
        )

    def _ancestor_metadata(self, path: Path) -> Mapping[str, Any]:
        group_root = next(
            (self.catalog.root / group for group in SOURCE_GROUPS
             if path.is_relative_to(self.catalog.root / group)),
            self.catalog.root,
        )
        current = path.parent
        while current != group_root.parent and current.is_relative_to(group_root):
            metadata = current / "metadata.json"
            if metadata.is_file() and metadata.stat().st_size <= 2_000_000:
                try:
                    value = json.loads(metadata.read_text(encoding="utf-8-sig"))
                    return value if isinstance(value, Mapping) else {}
                except (OSError, json.JSONDecodeError):
                    return {}
            if current == group_root:
                break
            current = current.parent
        return {}

    @staticmethod
    def write_receipt(reconciliation: RealAssetReconciliation, destination: str | Path) -> Path:
        target = Path(destination).resolve(strict=False)
        module = Path(__file__).resolve().parents[3]
        receipt_root = (module / "runtime" / "receipts").resolve(strict=False)
        temp_root = Path(os.environ.get("TEMP", str(Path.cwd()))).resolve(strict=False)
        if (not target.is_relative_to(receipt_root) and not target.is_relative_to(temp_root)) \
                or target.suffix.casefold() != ".json":
            raise ValueError("asset reconciliation receipt must be JSON under runtime/receipts or TEMP")
        payload = {
            "resolver": "REAL_ASSET_CANDIDATE_RESOLVER_V0_1",
            "version": reconciliation.version,
            "source_files_checked": reconciliation.source_files_checked,
            "source_bytes_checked": reconciliation.source_bytes_checked,
            "candidate_count": len(reconciliation.candidates),
            "decision_counts": dict(reconciliation.decision_counts),
            "unknown_count": reconciliation.unknown_count,
            "candidates": [{
                "asset_candidate_id": row.asset_candidate_id,
                "absolute_source_path": row.absolute_source_path,
                "file_type": row.file_type, "size_bytes": row.size_bytes,
                "sha256": row.sha256, "dimensions": list(row.dimensions) if row.dimensions else None,
                "duration_seconds": row.duration_seconds,
                "legacy_account_code": row.legacy_account_code,
                "legacy_content_id": row.legacy_content_id,
                "relationship_evidence": list(row.relationship_evidence),
                "confidence": row.confidence, "decision": row.decision.value,
            } for row in reconciliation.candidates],
        }
        rendered = (json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
        if target.is_file():
            if target.read_bytes() == rendered:
                return target
            raise ValueError("asset reconciliation receipt already exists with different content")
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = target.with_suffix(target.suffix + ".staging")
        if staging.exists():
            raise ValueError("asset reconciliation receipt staging already exists")
        try:
            with staging.open("xb") as handle:
                handle.write(rendered)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(staging, target)
        finally:
            if staging.exists():
                staging.unlink()
        return target


class RealReviewWorkbenchService:
    def __init__(self, store: Any) -> None:
        self.store = store

    def build(
        self, content_id: str, *, package_id: str, manifest_path: str | Path,
    ) -> RealReviewWorkbench:
        content = self.store.contents.get_by_id(content_id)
        account_id = content.target_accounts[0]
        self.store.accounts.get_by_id(account_id)
        assets = self.store.assets.find_by_content_id(content_id)
        manifest = Path(manifest_path)
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        if payload.get("content_id") != content_id or payload.get("package_id") != package_id:
            raise ValueError("review workbench package identity mismatch")
        receipts = self.store.runtime.list_qa_receipts(content_id=content_id)
        qa_statuses = {}
        for kind in (QAType.CONTENT, QAType.ASSET, QAType.PACKAGE, QAType.PUBLISH_PREP):
            latest = next((item for item in reversed(receipts) if item.qa_type is kind), None)
            qa_statuses[kind.value] = latest.status.value if latest else "MISSING"
        verified = tuple(item.asset_id for item in assets if item.status is AssetStatus.AVAILABLE)
        references = tuple(item.asset_id for item in assets if item.status is AssetStatus.REFERENCE_ONLY)
        extensions = dict(content.extension_fields)
        prompts = tuple(str(item) for item in extensions.get("prompt_references") or ())
        research = tuple(str(item) for item in extensions.get("research_references") or ())
        missing: list[str] = []
        if not verified:
            missing.append("VERIFIED_ASSET_REQUIRED")
        if qa_statuses[QAType.ASSET.value] != "PASS":
            missing.append("ASSET_QA_NOT_PASSED")
        if content.current_state not in {ContentState.REVIEW, ContentState.READY_TO_PUBLISH}:
            missing.append("CONTENT_NOT_SUBMITTED_FOR_REVIEW")
        warnings = tuple(f"{kind}:{status}" for kind, status in qa_statuses.items() if status != "PASS")
        return RealReviewWorkbench(
            content_id, account_id, content.current_state.value, package_id, str(manifest),
            payload.get("package_digest"), verified, references, prompts, research,
            qa_statuses, warnings, tuple(missing), content.current_state is ContentState.REVIEW,
        )


class VerifiedAssetActivationService:
    """Idempotently activate only resolver-proven VERIFIED_MATCH candidates."""

    TYPE_MAP = {
        "jpg": AssetType.IMAGE, "jpeg": AssetType.IMAGE, "png": AssetType.IMAGE,
        "webp": AssetType.IMAGE, "gif": AssetType.IMAGE, "bmp": AssetType.IMAGE,
        "tif": AssetType.IMAGE, "tiff": AssetType.IMAGE,
        "mp4": AssetType.VIDEO, "mov": AssetType.VIDEO, "avi": AssetType.VIDEO,
        "mkv": AssetType.VIDEO, "webm": AssetType.VIDEO, "m4v": AssetType.VIDEO,
    }

    def __init__(
        self, store: Any, resolver: RealAssetCandidateResolver | None = None,
    ) -> None:
        self.store = store
        self.pipeline = ContentPipelineService()
        self.resolver = resolver or RealAssetCandidateResolver()

    def activate(self, candidate: RealAssetCandidate, *, now: Any) -> Asset:
        if candidate.decision is not AssetCandidateDecision.VERIFIED_MATCH:
            raise ValueError("only VERIFIED_MATCH candidates can become canonical Assets")
        if not candidate.legacy_content_id or not candidate.legacy_account_code:
            raise ValueError("verified candidate requires content and account identities")
        content_accounts = {
            item.content_id: item.target_accounts[0]
            for item in self.store.contents.list() if item.target_accounts
        }
        current = self.resolver.resolve(content_accounts=content_accounts)
        authoritative = next(
            (item for item in current.candidates
             if item.asset_candidate_id == candidate.asset_candidate_id), None,
        )
        if authoritative != candidate or authoritative.decision is not AssetCandidateDecision.VERIFIED_MATCH:
            raise ValueError("candidate is not a current machine-verifiable resolver match")
        path = Path(candidate.absolute_source_path).resolve()
        source_root = self.resolver.catalog.root
        if not path.is_file() or not path.is_relative_to(source_root):
            raise ValueError("verified candidate source must be an existing source_import file")
        if _sha256(path) != candidate.sha256:
            raise ValueError("verified candidate source hash changed")
        asset_id = f"asset:{candidate.sha256[:24]}"
        content = self.store.contents.get_by_id(candidate.legacy_content_id)
        if candidate.legacy_account_code not in content.target_accounts:
            raise ValueError("verified candidate account does not own the content")
        expected = Asset(
            asset_id, self.TYPE_MAP.get(candidate.file_type, AssetType.RAW_MATERIAL),
            "legacy_verified_asset", str(path), (candidate.legacy_content_id,),
            Provenance(
                "legacy_creator_ops", str(path), now,
                captured_by="CreatorOpsApplication", confidence="MACHINE_VERIFIED",
                notes="REAL_ASSET_CANDIDATE_RESOLVER_V0_1 VERIFIED_MATCH",
            ),
            GenerationMethod.IMPORTED, content.creator_id, (candidate.legacy_account_code,),
            AssetStatus.AVAILABLE, now, now,
            LegacyReference("legacy_creator_ops", "Asset", candidate.asset_candidate_id, str(path)),
            {"sha256": candidate.sha256, "size_bytes": candidate.size_bytes,
             "dimensions": candidate.dimensions, "duration_seconds": candidate.duration_seconds,
             "relationship_evidence": candidate.relationship_evidence},
        )
        try:
            existing = self.store.assets.get_by_id(asset_id)
        except PersistenceError as exc:
            if exc.code is not PersistenceErrorCode.NOT_FOUND:
                raise
        else:
            if (
                existing.asset_type, existing.location, existing.content_relations,
                existing.account_relations, existing.status,
                existing.extension_fields.get("sha256"),
            ) != (
                expected.asset_type, expected.location, expected.content_relations,
                expected.account_relations, expected.status,
                expected.extension_fields.get("sha256"),
            ):
                raise ValueError("verified Asset identity conflicts with an existing fact")
            return existing
        with self.store.transaction():
            updated = self.pipeline.attach_asset(content, expected, now=now)
            self.store.assets.save(expected)
            self.store.contents.update(updated)
        return expected


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _probe(path: Path) -> tuple[tuple[int, int] | None, float | None]:
    suffix = path.suffix.casefold()
    if suffix in {".jpg", ".jpeg"}:
        return _jpeg_dimensions(path), None
    if suffix == ".png":
        with path.open("rb") as handle:
            header = handle.read(24)
        if header[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", header[16:24]), None
    if suffix == ".mp4":
        return None, _mp4_duration(path)
    return None, None


def _jpeg_dimensions(path: Path) -> tuple[int, int] | None:
    with path.open("rb") as handle:
        if handle.read(2) != b"\xff\xd8":
            return None
        while True:
            byte = handle.read(1)
            if not byte:
                return None
            if byte != b"\xff":
                continue
            marker = handle.read(1)
            while marker == b"\xff":
                marker = handle.read(1)
            if marker in {bytes([value]) for value in range(0xC0, 0xC4)} | {bytes([value]) for value in range(0xC5, 0xC8)} | {bytes([value]) for value in range(0xC9, 0xCC)} | {bytes([value]) for value in range(0xCD, 0xD0)}:
                length = struct.unpack(">H", handle.read(2))[0]
                data = handle.read(length - 2)
                return struct.unpack(">HH", data[1:5])[::-1]
            if marker in {b"\xd8", b"\xd9"}:
                continue
            length_bytes = handle.read(2)
            if len(length_bytes) != 2:
                return None
            handle.seek(struct.unpack(">H", length_bytes)[0] - 2, 1)


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
    elif version == 1 and len(data) >= marker + 36:
        timescale = struct.unpack(">I", data[marker + 28:marker + 32])[0]
        duration = struct.unpack(">Q", data[marker + 32:marker + 40])[0]
    else:
        return None
    return round(duration / timescale, 3) if timescale else None
