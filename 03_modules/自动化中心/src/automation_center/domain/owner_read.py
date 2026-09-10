"""Stable read-only OWNER operations projection contracts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone, tzinfo
from enum import StrEnum
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .customer_request import (
    ActorType,
    CustomerRequestStatus,
    KnowledgeReviewState,
    RequestInputType,
    RequestResultStatus,
)
from .model_gateway import UserTier
from .model_invocation import CostSource, InvocationStatus


OWNER_READ_VERSION = "0.1"
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 500


class OwnerTimePreset(StrEnum):
    TODAY = "TODAY"
    YESTERDAY = "YESTERDAY"
    LAST_7_DAYS = "LAST_7_DAYS"
    LAST_30_DAYS = "LAST_30_DAYS"
    CUSTOM = "CUSTOM"


class OwnerRequestSort(StrEnum):
    NEWEST_FIRST = "NEWEST_FIRST"
    OLDEST_FIRST = "OLDEST_FIRST"


class CustomerActivityFilter(StrEnum):
    ALL = "ALL"
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class CostCompleteness(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    UNAVAILABLE = "UNAVAILABLE"
    MIXED_CURRENCY = "MIXED_CURRENCY"


class OwnerActivityKind(StrEnum):
    REQUEST_SUCCEEDED = "REQUEST_SUCCEEDED"
    REQUEST_FAILED = "REQUEST_FAILED"
    INVOCATION_FAILED = "INVOCATION_FAILED"
    KNOWLEDGE_REVIEW_CANDIDATE = "KNOWLEDGE_REVIEW_CANDIDATE"
    OWNER_REQUEST = "OWNER_REQUEST"
    CUSTOMER_REQUEST = "CUSTOMER_REQUEST"


@dataclass(frozen=True, slots=True)
class OwnerTimeWindow:
    from_at: datetime
    to_at: datetime
    timezone_name: str
    preset: OwnerTimePreset

    def __post_init__(self) -> None:
        _aware(self.from_at, "from_at")
        _aware(self.to_at, "to_at")
        if self.to_at <= self.from_at:
            raise ValueError("time window must be increasing")
        if not isinstance(self.timezone_name, str) or not self.timezone_name.strip():
            raise ValueError("timezone_name is required")
        object.__setattr__(self, "from_at", self.from_at.astimezone(timezone.utc))
        object.__setattr__(self, "to_at", self.to_at.astimezone(timezone.utc))


@dataclass(frozen=True, slots=True)
class CurrencySubtotal:
    currency: str
    amount: float
    invocation_count: int


@dataclass(frozen=True, slots=True)
class OwnerCostSummary:
    known_cost_subtotal: float | None
    cost_currency: str | None
    cost_completeness: CostCompleteness
    unknown_cost_invocation_count: int
    mixed_currency: bool
    currency_subtotals: tuple[CurrencySubtotal, ...]


@dataclass(frozen=True, slots=True)
class OwnerTokenSummary:
    input_tokens_known: int
    output_tokens_known: int
    total_tokens_known: int
    token_unknown_count: int


@dataclass(frozen=True, slots=True)
class OwnerRequestCounts:
    total_requests: int
    succeeded: int
    partial_success: int
    failed: int
    rejected: int
    running: int


@dataclass(frozen=True, slots=True)
class OwnerKnowledgeReviewCounts:
    not_reviewed: int
    pending_review: int
    accepted: int
    rejected: int


@dataclass(frozen=True, slots=True)
class OffsetPageInfo:
    limit: int
    offset: int
    has_more: bool
    next_offset: int | None


@dataclass(frozen=True, slots=True)
class OwnerRequestListItem:
    request_id: str
    actor_type: ActorType
    customer_id: str
    user_tier: UserTier
    capability_id: str
    status: CustomerRequestStatus
    created_at: datetime
    completed_at: datetime | None
    invocation_count: int
    token_summary: OwnerTokenSummary
    resolved_models_summary: tuple[str, ...]
    resolved_providers_summary: tuple[str, ...]
    cost_summary: OwnerCostSummary
    result_status: RequestResultStatus
    result_summary: str | None
    result_ref: str | None
    markdown_ref: str | None
    knowledge_review_state: KnowledgeReviewState


@dataclass(frozen=True, slots=True)
class OwnerRequestPage:
    items: tuple[OwnerRequestListItem, ...]
    page: OffsetPageInfo


@dataclass(frozen=True, slots=True)
class OwnerInvocationReadItem:
    invocation_id: str
    model_profile: str
    provider: str
    model: str
    status: InvocationStatus
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    cost_amount: float | None
    cost_currency: str | None
    cost_source: CostSource
    latency_ms: int | None
    safe_error: str | None
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class OwnerKnowledgeReviewProjection:
    state: KnowledgeReviewState
    destination_ref: str | None
    future_allowed_actions: tuple[str, ...]
    write_enabled: bool = False


@dataclass(frozen=True, slots=True)
class OwnerRequestDetail:
    request_id: str
    actor_type: ActorType
    customer_id: str
    user_tier: UserTier
    capability_id: str
    status: CustomerRequestStatus
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    updated_at: datetime
    input_type: RequestInputType
    input_summary: str | None
    source_url: str | None
    input_ref: str | None
    invocations: tuple[OwnerInvocationReadItem, ...]
    invocation_count: int
    invocations_truncated: bool
    cost_summary: OwnerCostSummary
    result_status: RequestResultStatus
    result_summary: str | None
    result_ref: str | None
    markdown_ref: str | None
    artifact_refs: tuple[str, ...]
    artifact_refs_truncated: bool
    knowledge_review: OwnerKnowledgeReviewProjection


@dataclass(frozen=True, slots=True)
class OwnerCustomerListItem:
    customer_id: str
    user_tier: UserTier
    first_seen_at: datetime
    last_seen_at: datetime
    request_count: int
    success_count: int
    failed_count: int
    invocation_count: int
    known_token_total: int
    cost_summary: OwnerCostSummary
    pending_review_count: int
    is_active: bool


@dataclass(frozen=True, slots=True)
class OwnerCustomerPage:
    items: tuple[OwnerCustomerListItem, ...]
    page: OffsetPageInfo
    active_since: datetime


@dataclass(frozen=True, slots=True)
class OwnerCustomerDetail:
    customer_id: str
    current_observed_tier: UserTier
    first_seen_at: datetime
    last_seen_at: datetime
    total_requests: int
    succeeded: int
    failed: int
    invocation_count: int
    token_summary: OwnerTokenSummary
    cost_summary: OwnerCostSummary
    pending_review_count: int
    recent_requests: OwnerRequestPage


@dataclass(frozen=True, slots=True)
class OwnerModelUsageItem:
    provider: str
    model: str
    request_count: int
    invocation_count: int
    known_tokens: int
    cost_summary: OwnerCostSummary
    failure_count: int
    average_latency_ms: float | None
    latency_sample_count: int
    last_used_at: datetime


@dataclass(frozen=True, slots=True)
class OwnerTierUsageItem:
    user_tier: UserTier
    unique_users: int
    requests: int
    invocations: int
    known_tokens: int
    cost_summary: OwnerCostSummary
    success_rate: float | None
    pending_review: int


@dataclass(frozen=True, slots=True)
class OwnerKnowledgeReviewQueueItem:
    request_id: str
    customer_id: str
    user_tier: UserTier
    input_summary: str | None
    result_summary: str | None
    resolved_models: tuple[str, ...]
    created_at: datetime
    result_ref: str | None
    markdown_ref: str | None
    review_state: KnowledgeReviewState


@dataclass(frozen=True, slots=True)
class OwnerKnowledgeReviewPage:
    items: tuple[OwnerKnowledgeReviewQueueItem, ...]
    page: OffsetPageInfo


@dataclass(frozen=True, slots=True)
class OwnerRecentActivity:
    kind: OwnerActivityKind
    occurred_at: datetime
    request_id: str
    actor_type: ActorType
    customer_id: str
    user_tier: UserTier
    status: str
    summary: str


@dataclass(frozen=True, slots=True)
class OwnerOperationsOverview:
    window: OwnerTimeWindow
    unique_customer_count: int
    owner_request_count: int
    customer_request_count: int
    request_counts: OwnerRequestCounts
    invocation_count: int
    token_summary: OwnerTokenSummary
    cost_summary: OwnerCostSummary
    knowledge_review: OwnerKnowledgeReviewCounts
    recent_requests: tuple[OwnerRequestListItem, ...]


@dataclass(frozen=True, slots=True)
class OwnerRequestFilters:
    actor_type: ActorType | None = None
    customer_id: str | None = None
    user_tier: UserTier | None = None
    request_status: CustomerRequestStatus | None = None
    capability_id: str | None = None
    resolved_provider: str | None = None
    resolved_model: str | None = None
    knowledge_review_state: KnowledgeReviewState | None = None
    window: OwnerTimeWindow | None = None


@dataclass(frozen=True, slots=True)
class OwnerCustomerFilters:
    customer_id_search: str | None = None
    user_tier: UserTier | None = None
    activity: CustomerActivityFilter = CustomerActivityFilter.ALL


def resolve_owner_time_window(
    preset: OwnerTimePreset,
    *,
    timezone_name: str,
    now: datetime,
    custom_from: datetime | None = None,
    custom_to: datetime | None = None,
) -> OwnerTimeWindow:
    """Resolve a half-open [from, to) interval without assuming UTC+8."""

    _aware(now, "now")
    local_zone = _resolve_timezone(timezone_name)
    local_now = now.astimezone(local_zone)
    midnight = datetime.combine(local_now.date(), time.min, tzinfo=local_zone)
    if preset is OwnerTimePreset.CUSTOM:
        _aware(custom_from, "custom_from")
        _aware(custom_to, "custom_to")
        if custom_from is None or custom_to is None or custom_to <= custom_from:
            raise ValueError("CUSTOM requires an increasing aware from/to interval")
        start, end = custom_from, custom_to
    elif custom_from is not None or custom_to is not None:
        raise ValueError("custom bounds are valid only for CUSTOM")
    elif preset is OwnerTimePreset.TODAY:
        start, end = midnight, local_now
    elif preset is OwnerTimePreset.YESTERDAY:
        start, end = midnight - timedelta(days=1), midnight
    elif preset is OwnerTimePreset.LAST_7_DAYS:
        start, end = midnight - timedelta(days=6), local_now
    elif preset is OwnerTimePreset.LAST_30_DAYS:
        start, end = midnight - timedelta(days=29), local_now
    else:
        raise ValueError("unsupported time preset")
    return OwnerTimeWindow(
        start.astimezone(timezone.utc),
        end.astimezone(timezone.utc),
        timezone_name,
        preset,
    )


def validate_page(limit: int = DEFAULT_PAGE_SIZE, offset: int = 0) -> tuple[int, int]:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_PAGE_SIZE:
        raise ValueError(f"limit must be between 1 and {MAX_PAGE_SIZE}")
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError("offset must be a non-negative integer")
    return limit, offset


def page_info(limit: int, offset: int, returned_with_probe: int) -> OffsetPageInfo:
    has_more = returned_with_probe > limit
    return OffsetPageInfo(limit, offset, has_more, offset + limit if has_more else None)


def _aware(value: datetime | None, name: str) -> None:
    if value is None or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime")


def _resolve_timezone(name: str) -> tzinfo:
    """Use IANA data when present, with service-free fixed-offset compatibility."""

    if name in {"UTC", "Etc/UTC"}:
        return timezone.utc
    if name == "Asia/Shanghai":
        # China has used UTC+8 without DST since 1991; this supports the current
        # product environment when Windows has no system IANA tz database.
        return timezone(timedelta(hours=8), name)
    offset = re.fullmatch(r"UTC([+-])(\d{2}):(\d{2})", name)
    if offset:
        hours, minutes = int(offset.group(2)), int(offset.group(3))
        if hours > 14 or minutes > 59:
            raise ValueError("fixed timezone offset is out of range")
        delta = timedelta(hours=hours, minutes=minutes)
        return timezone(delta if offset.group(1) == "+" else -delta, name)
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as error:
        raise ValueError(
            "timezone_name requires installed IANA data or an explicit UTC±HH:MM offset"
        ) from error
