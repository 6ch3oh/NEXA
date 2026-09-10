"""Aggregation/transport view over existing Creator Ops domain contracts."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Mapping, Sequence

from creator_ops.domain.models import Account, Asset, ContentItem, Provenance, PublishReadiness, ReviewState
from creator_ops.domain.quality import QAReport


class PackageCompatibility(str, Enum):
    EXACT = "EXACT"
    ADAPTER_COMPATIBLE = "ADAPTER_COMPATIBLE"
    PARTIAL = "PARTIAL"
    INCOMPATIBLE = "INCOMPATIBLE"
    MANUAL_REVIEW_REQUIRED = "MANUAL_REVIEW_REQUIRED"


@dataclass(frozen=True)
class PackageFileSpec:
    logical_name: str
    path: str
    file_format: str
    required: bool
    managed_by: str | None = None
    note: str | None = None


@dataclass(frozen=True)
class ContentPackageRequest:
    """Lossless compatibility view of the mature legacy content request."""

    content_id: str
    account: str
    platform: str
    content_type: str
    title: str
    topic: str
    objective: Any
    target_audience: tuple[str, ...]
    positioning: str
    hook: str
    script_markdown: str
    storyboard: tuple[Mapping[str, Any], ...]
    image_prompts: tuple[Mapping[str, Any], ...]
    video_prompts: tuple[Mapping[str, Any], ...]
    publish_plan: Mapping[str, Any]
    risk_checklist: tuple[Mapping[str, Any], ...]
    source: Mapping[str, Any]
    metadata: Mapping[str, Any]
    extra: Mapping[str, Any]
    source_reference: str
    source_schema_version: str | None = None
    version: str = "0.1"


@dataclass(frozen=True)
class ContentPackageManifest:
    package_identity: str
    content_id: str
    package_root: str
    files: tuple[PackageFileSpec, ...]
    directory_roles: tuple[tuple[str, str], ...]
    source_contract_version: str | None
    compatibility: PackageCompatibility
    source_reference: str
    version: str = "0.1"


@dataclass(frozen=True)
class PackageCompleteness:
    complete: bool
    required_files: tuple[str, ...]
    present_files: tuple[str, ...]
    missing_files: tuple[str, ...]
    qa_passed: bool
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class ContentPackageV01:
    content: ContentItem
    target_accounts: tuple[Account, ...]
    assets: tuple[Asset, ...]
    review_readiness: ReviewState
    publish_readiness: PublishReadiness
    provenance: tuple[Provenance, ...]
    warnings: tuple[str, ...]
    manifest: ContentPackageManifest | None = None
    qa_reports: tuple[QAReport, ...] = ()
    version: str = "0.1"


def map_legacy_package_manifest(data: Mapping[str, Any], *, source_reference: str) -> ContentPackageManifest:
    content_id = str(data.get("content_id") or "").strip()
    package_root = str(data.get("package_root") or "").strip()
    if not content_id or not package_root:
        raise ValueError("legacy package identity is incomplete")
    raw_files = data.get("files")
    if not isinstance(raw_files, dict):
        raise ValueError("legacy package files must be an object")
    files = []
    for logical_name, raw in sorted(raw_files.items()):
        if not isinstance(raw, dict) or not isinstance(raw.get("path"), str) or not raw["path"]:
            raise ValueError(f"legacy package file is invalid: {logical_name}")
        files.append(PackageFileSpec(
            logical_name=str(logical_name), path=raw["path"],
            file_format=str(raw.get("format") or "unknown"), required=bool(raw.get("required", False)),
            managed_by=str(raw["managed_by"]) if raw.get("managed_by") is not None else None,
            note=str(raw["note"]) if raw.get("note") is not None else None,
        ))
    raw_dirs = data.get("directories") or {}
    directory_roles = tuple(sorted((str(key), str(value)) for key, value in raw_dirs.items())) if isinstance(raw_dirs, dict) else ()
    return ContentPackageManifest(
        package_identity=f"legacy-package:{content_id}:{package_root}", content_id=content_id,
        package_root=package_root, files=tuple(files), directory_roles=directory_roles,
        source_contract_version=str(data.get("contract_version")) if data.get("contract_version") else None,
        compatibility=PackageCompatibility.ADAPTER_COMPATIBLE,
        source_reference=source_reference,
    )


def map_legacy_content_request(
    data: Mapping[str, Any], *, source_reference: str,
) -> ContentPackageRequest:
    content_id = str(data.get("content_id") or "").strip()
    account = str(data.get("account") or "").strip()
    platform = str(data.get("platform") or "").strip()
    content_type = str(data.get("content_type") or "").strip()
    title = str(data.get("title") or "").strip()
    topic = str(data.get("topic") or "").strip()
    content = data.get("content")
    if not all((content_id, account, platform, content_type, title, topic)) or not isinstance(content, Mapping):
        raise ValueError("legacy content request is incomplete")
    required_content = ("positioning", "hook", "script_markdown", "storyboard",
                        "image_prompts", "video_prompts", "publish_plan", "risk_checklist")
    if any(name not in content for name in required_content):
        raise ValueError("legacy content request payload is incomplete")
    def rows(name: str) -> tuple[Mapping[str, Any], ...]:
        value = content[name]
        if not isinstance(value, (list, tuple)) or not all(isinstance(item, Mapping) for item in value):
            raise ValueError(f"legacy content request {name} must be an array of objects")
        return tuple(dict(item) for item in value)
    publish_plan = content["publish_plan"]
    if not isinstance(publish_plan, Mapping):
        raise ValueError("legacy content request publish_plan must be an object")
    return ContentPackageRequest(
        content_id=content_id, account=account, platform=platform, content_type=content_type,
        title=title, topic=topic, objective=data.get("objective"),
        target_audience=tuple(str(item) for item in (data.get("target_audience") or ())),
        positioning=str(content["positioning"]), hook=str(content["hook"]),
        script_markdown=str(content["script_markdown"]), storyboard=rows("storyboard"),
        image_prompts=rows("image_prompts"), video_prompts=rows("video_prompts"),
        publish_plan=dict(publish_plan), risk_checklist=rows("risk_checklist"),
        source=dict(data.get("source") or {}), metadata=dict(data.get("metadata") or {}),
        extra=dict(data.get("extra") or {}), source_reference=source_reference,
        source_schema_version=str(data.get("schema_version")) if data.get("schema_version") else None,
    )


def evaluate_package_completeness(
    manifest: ContentPackageManifest, *, existing_paths: Sequence[str], qa_reports: Sequence[QAReport] = (),
) -> PackageCompleteness:
    existing = frozenset(str(path).replace("\\", "/") for path in existing_paths)
    required = tuple(item.path for item in manifest.files if item.required)
    present = tuple(path for path in required if path.replace("\\", "/") in existing)
    missing = tuple(path for path in required if path.replace("\\", "/") not in existing)
    qa_passed = all(report.passed for report in qa_reports) if qa_reports else True
    warnings = tuple([f"PACKAGE_FILE_MISSING:{path}" for path in missing]
                     + ([] if qa_passed else ["PACKAGE_QA_NOT_PASSED"]))
    return PackageCompleteness(
        complete=not missing and qa_passed, required_files=required,
        present_files=present, missing_files=missing, qa_passed=qa_passed, warnings=warnings,
    )


def build_content_package(
    content: ContentItem, *, accounts: Sequence[Account], assets: Sequence[Asset],
) -> ContentPackageV01:
    account_by_id = {item.account_id: item for item in accounts}
    asset_by_id = {item.asset_id: item for item in assets}
    target_accounts = tuple(account_by_id[x] for x in content.target_accounts if x in account_by_id)
    linked_assets = tuple(asset_by_id[x] for x in content.asset_references if x in asset_by_id)
    warnings = tuple(
        [f"TARGET_ACCOUNT_MISSING:{x}" for x in content.target_accounts if x not in account_by_id]
        + [f"ASSET_MISSING:{x}" for x in content.asset_references if x not in asset_by_id]
    )
    provenance = (content.provenance, *(item.provenance for item in target_accounts), *(item.provenance for item in linked_assets))
    return ContentPackageV01(
        content=content, target_accounts=target_accounts, assets=linked_assets,
        review_readiness=content.review_state, publish_readiness=content.publish_readiness,
        provenance=tuple(provenance), warnings=warnings,
    )
