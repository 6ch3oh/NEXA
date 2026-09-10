"""Versioned Creator Ops contracts with legacy references and provenance.

The contracts intentionally contain no platform login, network collection, or
publishing behavior.  They describe records exchanged by offline adapters.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Mapping


CONTRACT_VERSION = "0.1"
LEGACY_ACCOUNT_CODES = frozenset({"A1", "A2", "B1", "B2", "B3", "B4"})


class ContractError(ValueError):
    """Raised when a domain invariant is violated."""


class CreatorStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    ARCHIVED = "ARCHIVED"


class AccountStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    ARCHIVED = "ARCHIVED"
    UNKNOWN = "UNKNOWN"


class ContentState(str, Enum):
    IDEA = "IDEA"
    DRAFT = "DRAFT"
    ASSET_PREPARATION = "ASSET_PREPARATION"
    REVIEW = "REVIEW"
    READY_TO_PUBLISH = "READY_TO_PUBLISH"
    PUBLISHED = "PUBLISHED"
    METRICS_PENDING = "METRICS_PENDING"
    REVIEWED = "REVIEWED"
    BLOCKED = "BLOCKED"
    ARCHIVED = "ARCHIVED"
    REJECTED = "REJECTED"


class ReviewState(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    NOT_REQUIRED = "NOT_REQUIRED"


class PublishReadiness(str, Enum):
    NOT_READY = "NOT_READY"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    READY = "READY"


class ContentType(str, Enum):
    ARTICLE = "ARTICLE"
    SHORT_VIDEO = "SHORT_VIDEO"
    IMAGE_POST = "IMAGE_POST"
    LONG_VIDEO = "LONG_VIDEO"
    OTHER = "OTHER"


class AssetType(str, Enum):
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"
    COVER = "COVER"
    SCREENSHOT = "SCREENSHOT"
    RAW_MATERIAL = "RAW_MATERIAL"
    GENERATED_VISUAL = "GENERATED_VISUAL"
    REFERENCE_MATERIAL = "REFERENCE_MATERIAL"
    PROMPT_ARTIFACT = "PROMPT_ARTIFACT"


class AssetStatus(str, Enum):
    PLANNED = "PLANNED"
    AVAILABLE = "AVAILABLE"
    REFERENCE_ONLY = "REFERENCE_ONLY"
    ARCHIVED = "ARCHIVED"
    UNKNOWN = "UNKNOWN"


class GenerationMethod(str, Enum):
    HUMAN_CREATED = "HUMAN_CREATED"
    AI_ASSISTED = "AI_ASSISTED"
    IMPORTED = "IMPORTED"
    CAPTURED = "CAPTURED"
    UNKNOWN = "UNKNOWN"


class PublishStatus(str, Enum):
    PLANNED = "PLANNED"
    READY = "READY"
    PUBLISHED = "PUBLISHED"
    FAILED_MANUAL = "FAILED_MANUAL"
    CANCELLED = "CANCELLED"


class PublicationMode(str, Enum):
    MANUAL = "MANUAL"


class ReviewStatus(str, Enum):
    COMPLETE = "COMPLETE"
    DRAFT = "DRAFT"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _require_text(name: str, value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} must be non-empty text")


def _require_aware(name: str, value: datetime | None) -> None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ContractError(f"{name} must be timezone-aware")


@dataclass(frozen=True)
class Provenance:
    source_system: str | None
    source_reference: str | None
    captured_at: datetime | None
    captured_by: str | None = None
    confidence: str | None = None
    notes: str | None = None
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        _require_aware("provenance.captured_at", self.captured_at)

    @property
    def is_complete(self) -> bool:
        return bool(self.source_system and self.source_reference and self.captured_at)


@dataclass(frozen=True)
class LegacyReference:
    system: str
    entity_type: str
    legacy_id: str
    location: str | None = None
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for name in ("system", "entity_type", "legacy_id"):
            _require_text(name, getattr(self, name))


@dataclass(frozen=True)
class Creator:
    creator_id: str
    name: str
    status: CreatorStatus
    source: str
    provenance: Provenance
    created_at: datetime
    updated_at: datetime
    legacy_reference: LegacyReference | None = None
    extension_fields: Mapping[str, Any] = field(default_factory=dict)
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for name in ("creator_id", "name", "source"):
            _require_text(name, getattr(self, name))
        _require_aware("created_at", self.created_at)
        _require_aware("updated_at", self.updated_at)


@dataclass(frozen=True)
class Account:
    account_id: str
    creator_id: str
    legacy_account_code: str | None
    platform: str
    account_name: str
    display_name: str
    content_direction: str
    status: AccountStatus
    source: str
    provenance: Provenance
    created_at: datetime
    updated_at: datetime
    legacy_reference: LegacyReference | None = None
    extension_fields: Mapping[str, Any] = field(default_factory=dict)
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for name in (
            "account_id", "creator_id", "platform", "account_name",
            "display_name", "content_direction", "source",
        ):
            _require_text(name, getattr(self, name))
        if self.legacy_account_code is not None:
            _require_text("legacy_account_code", self.legacy_account_code)
        _require_aware("created_at", self.created_at)
        _require_aware("updated_at", self.updated_at)

    @property
    def is_known_legacy_account(self) -> bool:
        return self.legacy_account_code in LEGACY_ACCOUNT_CODES


@dataclass(frozen=True)
class ContentItem:
    content_id: str
    creator_id: str
    target_accounts: tuple[str, ...]
    topic: str
    title: str | None
    body: str | None
    script_reference: str | None
    content_type: ContentType
    platform_intent: tuple[str, ...]
    asset_references: tuple[str, ...]
    current_state: ContentState
    review_state: ReviewState
    publish_readiness: PublishReadiness
    source: str
    provenance: Provenance
    created_at: datetime
    updated_at: datetime
    legacy_reference: LegacyReference | None = None
    extension_fields: Mapping[str, Any] = field(default_factory=dict)
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for name in ("content_id", "creator_id", "topic", "source"):
            _require_text(name, getattr(self, name))
        if not self.target_accounts:
            raise ContractError("target_accounts must contain at least one account")
        _require_aware("created_at", self.created_at)
        _require_aware("updated_at", self.updated_at)


@dataclass(frozen=True)
class Asset:
    asset_id: str
    asset_type: AssetType
    source: str
    location: str
    content_relations: tuple[str, ...]
    provenance: Provenance
    generation_method: GenerationMethod
    creator_id: str | None
    account_relations: tuple[str, ...]
    status: AssetStatus
    created_at: datetime
    updated_at: datetime
    legacy_reference: LegacyReference | None = None
    extension_fields: Mapping[str, Any] = field(default_factory=dict)
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for name in ("asset_id", "source", "location"):
            _require_text(name, getattr(self, name))
        _require_aware("created_at", self.created_at)
        _require_aware("updated_at", self.updated_at)


@dataclass(frozen=True)
class PublishRecord:
    publish_record_id: str
    platform: str
    account_id: str
    content_id: str
    publish_status: PublishStatus
    planned_time: datetime | None
    actual_publish_time: datetime | None
    external_url: str | None
    external_post_id: str | None
    manual_confirmation: bool
    source: str
    provenance: Provenance
    created_at: datetime
    updated_at: datetime
    publication_mode: PublicationMode = PublicationMode.MANUAL
    legacy_reference: LegacyReference | None = None
    extension_fields: Mapping[str, Any] = field(default_factory=dict)
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for name in ("publish_record_id", "platform", "account_id", "content_id", "source"):
            _require_text(name, getattr(self, name))
        for name in ("planned_time", "actual_publish_time", "created_at", "updated_at"):
            _require_aware(name, getattr(self, name))
        if self.publication_mode is not PublicationMode.MANUAL:
            raise ContractError("Phase 1 supports manual publication only")
        if self.publish_status is PublishStatus.PUBLISHED:
            if not self.manual_confirmation:
                raise ContractError("published records require manual_confirmation")
            if self.actual_publish_time is None:
                raise ContractError("published records require actual_publish_time")


@dataclass(frozen=True)
class Metrics:
    metrics_id: str
    publish_record_id: str
    views: int | None
    impressions: int | None
    likes: int | None
    comments: int | None
    favorites: int | None
    shares: int | None
    followers_delta: int | None
    engagement: float | None
    collected_at: datetime
    source: str
    provenance: Provenance
    created_at: datetime
    updated_at: datetime
    legacy_reference: LegacyReference | None = None
    extension_fields: Mapping[str, Any] = field(default_factory=dict)
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for name in ("metrics_id", "publish_record_id", "source"):
            _require_text(name, getattr(self, name))
        for name in ("views", "impressions", "likes", "comments", "favorites", "shares"):
            value = getattr(self, name)
            if value is not None and value < 0:
                raise ContractError(f"{name} cannot be negative")
        if self.engagement is not None and self.engagement < 0:
            raise ContractError("engagement cannot be negative")
        for name in ("collected_at", "created_at", "updated_at"):
            _require_aware(name, getattr(self, name))


@dataclass(frozen=True)
class Review:
    review_id: str
    content_id: str
    publish_record_id: str
    metric_snapshot: Metrics | None
    strengths: tuple[str, ...]
    weaknesses: tuple[str, ...]
    reusable_patterns: tuple[str, ...]
    failed_patterns: tuple[str, ...]
    next_action: str | None
    evidence: tuple[str, ...]
    reviewed_at: datetime
    status: ReviewStatus
    source: str
    provenance: Provenance
    created_at: datetime
    updated_at: datetime
    legacy_reference: LegacyReference | None = None
    extension_fields: Mapping[str, Any] = field(default_factory=dict)
    version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        for name in ("review_id", "content_id", "publish_record_id", "source"):
            _require_text(name, getattr(self, name))
        for name in ("reviewed_at", "created_at", "updated_at"):
            _require_aware(name, getattr(self, name))
