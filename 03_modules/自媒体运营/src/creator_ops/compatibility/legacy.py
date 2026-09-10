"""Legacy Creator Ops Compatibility Layer V0.1.

Adapters accept detached dictionaries only. They never read or rewrite the
legacy system and keep unknown fields under ``extension_fields``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from creator_ops.domain.models import (
    Account,
    AccountStatus,
    Asset,
    AssetStatus,
    AssetType,
    ContentItem,
    ContentType,
    GenerationMethod,
    LegacyReference,
    Metrics,
    Provenance,
    PublicationMode,
    PublishReadiness,
    PublishRecord,
    PublishStatus,
    Review,
    ReviewState,
    ReviewStatus,
)
from creator_ops.compatibility.case_library import LegacyCase, LegacyCaseLibraryMapper
from creator_ops.state.machine import map_legacy_state


class LegacyMappingError(ValueError):
    pass


def _required(data: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        value = data.get(name)
        if value is not None and value != "":
            return value
    raise LegacyMappingError(f"missing required legacy field; expected one of {names}")


def _dt(value: Any, *, required: bool = True) -> datetime | None:
    if value is None:
        if required:
            raise LegacyMappingError("missing required timestamp")
        return None
    if isinstance(value, datetime):
        result = value
    else:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result


def _enum(enum_type: type, value: Any, default: Any) -> Any:
    if value is None:
        return default
    try:
        return enum_type(str(value).strip().upper())
    except ValueError:
        return default


def _provenance(data: Mapping[str, Any], source_system: str) -> Provenance:
    raw = data.get("provenance") or {}
    captured = raw.get("captured_at")
    return Provenance(
        source_system=raw.get("source_system", source_system),
        source_reference=raw.get("source_reference") or data.get("source_reference"),
        captured_at=_dt(captured, required=False),
        captured_by=raw.get("captured_by"),
        confidence=raw.get("confidence"),
        notes=raw.get("notes"),
    )


def _legacy_ref(data: Mapping[str, Any], source_system: str, entity_type: str, *ids: str) -> LegacyReference:
    return LegacyReference(
        system=source_system,
        entity_type=entity_type,
        legacy_id=str(_required(data, *ids)),
        location=data.get("legacy_location"),
    )


def _extras(data: Mapping[str, Any], consumed: set[str]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if key not in consumed}


@dataclass(frozen=True)
class LegacyContentPackage:
    content: ContentItem
    assets: tuple[Asset, ...]
    original_manifest: Mapping[str, Any] | None


class LegacyCompatibilityMapper:
    """Explicit mapper boundary for Notion exports, JSON, or directory indexes."""

    def __init__(self, source_system: str = "legacy_creator_ops") -> None:
        self.source_system = source_system

    def map_account(self, data: Mapping[str, Any]) -> Account:
        now = _dt(data.get("updated_at") or data.get("created_at"))
        code = data.get("legacy_account_code") or data.get("code")
        consumed = {
            "account_id", "id", "creator_id", "legacy_account_code", "code", "platform",
            "account_name", "name", "display_name", "content_direction", "direction",
            "status", "source", "provenance", "source_reference", "created_at", "updated_at",
            "legacy_location",
        }
        return Account(
            account_id=str(_required(data, "account_id", "id")),
            creator_id=str(_required(data, "creator_id")),
            legacy_account_code=str(code) if code is not None else None,
            platform=str(_required(data, "platform")),
            account_name=str(_required(data, "account_name", "name")),
            display_name=str(data.get("display_name") or _required(data, "account_name", "name")),
            content_direction=str(data.get("content_direction") or data.get("direction") or "UNKNOWN"),
            status=_enum(AccountStatus, data.get("status"), AccountStatus.UNKNOWN),
            source=str(data.get("source") or self.source_system),
            provenance=_provenance(data, self.source_system),
            created_at=_dt(data.get("created_at") or now),
            updated_at=now,
            legacy_reference=_legacy_ref(data, self.source_system, "Account", "account_id", "id"),
            extension_fields=_extras(data, consumed),
        )

    def map_content(self, data: Mapping[str, Any]) -> ContentItem:
        now = _dt(data.get("updated_at") or data.get("created_at"))
        legacy_state = str(data.get("state") or data.get("current_state") or "选题")
        content_id = str(_required(data, "content_id", "id"))
        targets = data.get("target_accounts") or data.get("accounts") or []
        consumed = {
            "content_id", "id", "creator_id", "target_accounts", "accounts", "topic", "title",
            "body", "script_reference", "content_type", "platform_intent", "asset_references",
            "state", "current_state", "review_state", "publish_readiness", "source", "provenance",
            "source_reference", "created_at", "updated_at", "legacy_location",
        }
        extras = _extras(data, consumed)
        extras["legacy_state"] = legacy_state
        return ContentItem(
            content_id=content_id,
            creator_id=str(_required(data, "creator_id")),
            target_accounts=tuple(str(x) for x in targets),
            topic=str(_required(data, "topic")),
            title=data.get("title"),
            body=data.get("body"),
            script_reference=data.get("script_reference"),
            content_type=_enum(ContentType, data.get("content_type"), ContentType.OTHER),
            platform_intent=tuple(str(x) for x in (data.get("platform_intent") or [])),
            asset_references=tuple(str(x) for x in (data.get("asset_references") or [])),
            current_state=map_legacy_state(legacy_state),
            review_state=_enum(ReviewState, data.get("review_state"), ReviewState.PENDING),
            publish_readiness=_enum(PublishReadiness, data.get("publish_readiness"), PublishReadiness.NOT_READY),
            source=str(data.get("source") or self.source_system),
            provenance=_provenance(data, self.source_system),
            created_at=_dt(data.get("created_at") or now),
            updated_at=now,
            legacy_reference=_legacy_ref(data, self.source_system, "Content", "content_id", "id"),
            extension_fields=extras,
        )

    def map_asset(self, data: Mapping[str, Any], content_id: str | None = None) -> Asset:
        now = _dt(data.get("updated_at") or data.get("created_at"))
        relations = data.get("content_relations") or ([content_id] if content_id else [])
        return Asset(
            asset_id=str(_required(data, "asset_id", "id")),
            asset_type=_enum(AssetType, data.get("asset_type") or data.get("type"), AssetType.REFERENCE_MATERIAL),
            source=str(data.get("source") or self.source_system),
            location=str(_required(data, "location", "path", "url")),
            content_relations=tuple(str(x) for x in relations),
            provenance=_provenance(data, self.source_system),
            generation_method=_enum(GenerationMethod, data.get("generation_method"), GenerationMethod.UNKNOWN),
            creator_id=data.get("creator_id"),
            account_relations=tuple(str(x) for x in (data.get("account_relations") or [])),
            status=_enum(AssetStatus, data.get("status"), AssetStatus.UNKNOWN),
            created_at=_dt(data.get("created_at") or now),
            updated_at=now,
            legacy_reference=_legacy_ref(data, self.source_system, "Asset", "asset_id", "id"),
            extension_fields=dict(data.get("extension_fields") or {}),
        )

    def map_content_package(self, data: Mapping[str, Any]) -> LegacyContentPackage:
        raw_content = data.get("content") or data
        content = self.map_content(raw_content)
        assets = tuple(self.map_asset(item, content.content_id) for item in (data.get("assets") or []))
        return LegacyContentPackage(content=content, assets=assets, original_manifest=data.get("manifest"))

    def map_manifest(self, data: Mapping[str, Any]) -> LegacyContentPackage:
        """A manifest is treated as an envelope, never as a domain dependency."""
        return self.map_content_package(data)

    def map_publish_record(self, data: Mapping[str, Any]) -> PublishRecord:
        now = _dt(data.get("updated_at") or data.get("created_at"))
        status = _enum(PublishStatus, data.get("publish_status") or data.get("status"), PublishStatus.PLANNED)
        return PublishRecord(
            publish_record_id=str(_required(data, "publish_record_id", "id")),
            platform=str(_required(data, "platform")),
            account_id=str(_required(data, "account_id")),
            content_id=str(_required(data, "content_id")),
            publish_status=status,
            planned_time=_dt(data.get("planned_time"), required=False),
            actual_publish_time=_dt(data.get("actual_publish_time"), required=False),
            external_url=data.get("external_url"),
            external_post_id=data.get("external_post_id"),
            manual_confirmation=bool(data.get("manual_confirmation", status is PublishStatus.PUBLISHED)),
            source=str(data.get("source") or self.source_system),
            provenance=_provenance(data, self.source_system),
            created_at=_dt(data.get("created_at") or now),
            updated_at=now,
            publication_mode=PublicationMode.MANUAL,
            legacy_reference=_legacy_ref(data, self.source_system, "PublishRecord", "publish_record_id", "id"),
            extension_fields=dict(data.get("extension_fields") or {}),
        )

    def map_metrics(self, data: Mapping[str, Any]) -> Metrics:
        now = _dt(data.get("updated_at") or data.get("created_at") or data.get("collected_at"))
        return Metrics(
            metrics_id=str(_required(data, "metrics_id", "id")),
            publish_record_id=str(_required(data, "publish_record_id")),
            views=data.get("views"), impressions=data.get("impressions"), likes=data.get("likes"),
            comments=data.get("comments"), favorites=data.get("favorites"), shares=data.get("shares"),
            followers_delta=data.get("followers_delta"), engagement=data.get("engagement"),
            collected_at=_dt(data.get("collected_at")),
            source=str(data.get("source") or self.source_system),
            provenance=_provenance(data, self.source_system),
            created_at=_dt(data.get("created_at") or now), updated_at=now,
            legacy_reference=_legacy_ref(data, self.source_system, "Metrics", "metrics_id", "id"),
            extension_fields=dict(data.get("extension_fields") or {}),
        )

    def map_review(self, data: Mapping[str, Any], metric_snapshot: Metrics | None = None) -> Review:
        now = _dt(data.get("updated_at") or data.get("reviewed_at"))
        return Review(
            review_id=str(_required(data, "review_id", "id")),
            content_id=str(_required(data, "content_id")),
            publish_record_id=str(_required(data, "publish_record_id")),
            metric_snapshot=metric_snapshot,
            strengths=tuple(data.get("strengths") or []), weaknesses=tuple(data.get("weaknesses") or []),
            reusable_patterns=tuple(data.get("reusable_patterns") or []),
            failed_patterns=tuple(data.get("failed_patterns") or []), next_action=data.get("next_action"),
            evidence=tuple(data.get("evidence") or []), reviewed_at=_dt(data.get("reviewed_at")),
            status=_enum(ReviewStatus, data.get("status"), ReviewStatus.COMPLETE),
            source=str(data.get("source") or self.source_system), provenance=_provenance(data, self.source_system),
            created_at=_dt(data.get("created_at") or now), updated_at=now,
            legacy_reference=_legacy_ref(data, self.source_system, "Review", "review_id", "id"),
            extension_fields=dict(data.get("extension_fields") or {}),
        )

    def map_case(self, data: Mapping[str, Any]) -> LegacyCase:
        """Map a Case Library item without conflating it with post-publish Review."""
        source_reference = str(
            data.get("source_reference") or data.get("source_path") or "legacy_case"
        )
        return LegacyCaseLibraryMapper.map_case(data, source_reference=source_reference)

    def map_prompt_asset(self, data: Mapping[str, Any]) -> Asset:
        normalized = dict(data)
        normalized["asset_type"] = AssetType.PROMPT_ARTIFACT.value
        normalized.setdefault("status", AssetStatus.REFERENCE_ONLY.value)
        return self.map_asset(normalized)
