"""Stable public contracts for Creator Ops Application API V0.2."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


API_VERSION = "0.2"
MODULE_VERSION = "0.2"
HISTORICAL_ASSET_STATE = "LEGACY_SOURCE_RECONCILED_IMPORT_NOT_AUTHORIZED"


class DatabaseState(str, Enum):
    NOT_INITIALIZED = "NOT_INITIALIZED"
    READY = "READY"
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    UNSUPPORTED_SCHEMA = "UNSUPPORTED_SCHEMA"
    STORAGE_ERROR = "STORAGE_ERROR"


class LifecycleStatus(str, Enum):
    SUCCESS = "SUCCESS"
    INITIALIZATION_REQUIRED = "INITIALIZATION_REQUIRED"
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
    ALREADY_INITIALIZED = "ALREADY_INITIALIZED"
    ALREADY_OPEN = "ALREADY_OPEN"
    UNSUPPORTED_SCHEMA = "UNSUPPORTED_SCHEMA"
    STORAGE_ERROR = "STORAGE_ERROR"


class CommandStatus(str, Enum):
    SUCCESS = "SUCCESS"
    REJECTED = "REJECTED"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
    STORAGE_ERROR = "STORAGE_ERROR"


class HealthStatus(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    UNHEALTHY = "UNHEALTHY"


@dataclass(frozen=True)
class PublicError:
    code: str
    message: str


@dataclass(frozen=True)
class LifecycleResult:
    operation: str
    status: LifecycleStatus
    database_state: DatabaseState
    message: str
    created: bool = False


@dataclass(frozen=True)
class CommandResult:
    command: str
    status: CommandStatus
    entity_id: str | None = None
    content_id: str | None = None
    updated_state: str | None = None
    warnings: tuple[str, ...] = ()
    error: PublicError | None = None
    data: Any | None = None


@dataclass(frozen=True)
class RuntimeInfo:
    module_version: str
    api_version: str
    schema_version: str
    database_state: DatabaseState
    database_location: Path
    historical_asset_state: str
    automatic_publishing: str = "NONE"
    network_capability: str = "NONE"


@dataclass(frozen=True)
class HealthReport:
    status: HealthStatus
    operational: bool
    module_reachable: bool
    database_state: DatabaseState
    schema_compatible: bool
    query_available: bool
    automatic_publishing: str
    network_capability: str
    historical_asset_state: str
    notes: tuple[str, ...] = ()
    task_runtime_status: str = "UNAVAILABLE"
    active_task_count: int = 0
    stale_lock_count: int = 0
    recovery_required_count: int = 0
    incomplete_package_count: int = 0
    qa_failure_count: int = 0
    import_authorization_state: str = "PRODUCTION_IMPORT_NOT_AUTHORIZED"
    production_database_exists: bool = False
    legacy_adapter_status: str = "UNKNOWN"
    deferred_legacy_count: int = 0
    asset_requirements_pending: int = 0
    asset_submissions_pending: int = 0
    visual_reviews_pending: int = 0
    asset_validation_failures: int = 0
    business_state: str = "READY"


@dataclass(frozen=True)
class ProvenanceDTO:
    source_system: str | None
    source_reference: str | None
    captured_at: Any | None
    captured_by: str | None
    confidence: str | None
    notes: str | None
    version: str


@dataclass(frozen=True)
class CreatorDTO:
    creator_id: str
    name: str
    status: str
    source: str
    version: str
    provenance: ProvenanceDTO | None = None
    created_at: Any | None = None
    updated_at: Any | None = None


@dataclass(frozen=True)
class AccountDTO:
    account_id: str
    creator_id: str
    legacy_account_code: str | None
    platform: str
    account_name: str
    display_name: str
    content_direction: str
    status: str
    source: str
    version: str
    provenance: ProvenanceDTO | None = None
    created_at: Any | None = None
    updated_at: Any | None = None


@dataclass(frozen=True)
class ContentDTO:
    content_id: str
    creator_id: str
    target_accounts: tuple[str, ...]
    topic: str
    title: str | None
    body: str | None
    script_reference: str | None
    content_type: str
    platform_intent: tuple[str, ...]
    asset_references: tuple[str, ...]
    current_state: str
    review_state: str
    publish_readiness: str
    source: str
    version: str
    provenance: ProvenanceDTO | None = None
    created_at: Any | None = None
    updated_at: Any | None = None


@dataclass(frozen=True)
class AssetDTO:
    asset_id: str
    asset_type: str
    source: str
    location: str
    content_relations: tuple[str, ...]
    account_relations: tuple[str, ...]
    generation_method: str
    status: str
    version: str
    provenance: ProvenanceDTO | None = None
    created_at: Any | None = None
    updated_at: Any | None = None


@dataclass(frozen=True)
class PublishRecordDTO:
    publish_record_id: str
    platform: str
    account_id: str
    content_id: str
    publish_status: str
    actual_publish_time: Any | None
    external_url: str | None
    external_post_id: str | None
    manual_confirmation: bool
    publication_mode: str
    version: str


@dataclass(frozen=True)
class MetricsDTO:
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
    collected_at: Any
    version: str


@dataclass(frozen=True)
class ReviewDTO:
    review_id: str
    content_id: str
    publish_record_id: str
    strengths: tuple[str, ...]
    weaknesses: tuple[str, ...]
    reusable_patterns: tuple[str, ...]
    failed_patterns: tuple[str, ...]
    next_action: str | None
    evidence: tuple[str, ...]
    status: str
    version: str


@dataclass(frozen=True)
class ContentDetailDTO:
    content: ContentDTO
    accounts: tuple[AccountDTO, ...] = ()
    assets: tuple[AssetDTO, ...] = ()
    publish_records: tuple[PublishRecordDTO, ...] = ()
    metrics: tuple[MetricsDTO, ...] = ()
    reviews: tuple[ReviewDTO, ...] = ()


class CreatorOpsAPIError(RuntimeError):
    """Sanitized read-side API error; never includes SQL or a stack trace."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
