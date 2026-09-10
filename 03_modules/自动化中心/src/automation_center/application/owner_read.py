"""Stable application query facade for future OWNER administration clients."""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from datetime import datetime, timedelta
from enum import StrEnum
import json
from types import MappingProxyType
from typing import Any, Protocol

from automation_center.domain.model_gateway import UserTier
from automation_center.domain.owner_read import (
    DEFAULT_PAGE_SIZE,
    CustomerActivityFilter,
    OwnerCustomerDetail,
    OwnerCustomerFilters,
    OwnerCustomerPage,
    OwnerKnowledgeReviewPage,
    OwnerModelUsageItem,
    OwnerOperationsOverview,
    OwnerRecentActivity,
    OwnerRequestDetail,
    OwnerRequestFilters,
    OwnerRequestPage,
    OwnerRequestSort,
    OwnerTierUsageItem,
    OwnerTimePreset,
    OwnerTimeWindow,
    resolve_owner_time_window,
)


class OwnerReadRepository(Protocol):
    def get_overview(
        self, window: OwnerTimeWindow, *, recent_limit: int
    ) -> OwnerOperationsOverview: ...

    def list_customers(
        self,
        filters: OwnerCustomerFilters,
        *,
        limit: int,
        offset: int,
        active_since: datetime,
    ) -> OwnerCustomerPage: ...

    def get_customer(
        self, customer_id: str, *, request_limit: int, request_offset: int
    ) -> OwnerCustomerDetail: ...

    def list_requests(
        self,
        filters: OwnerRequestFilters,
        *,
        sort: OwnerRequestSort,
        limit: int,
        offset: int,
    ) -> OwnerRequestPage: ...

    def get_request(self, request_id: str) -> OwnerRequestDetail: ...

    def list_knowledge_review_queue(
        self, *, limit: int, offset: int
    ) -> OwnerKnowledgeReviewPage: ...

    def get_model_usage(
        self,
        *,
        window: OwnerTimeWindow | None,
        user_tier: UserTier | None,
        limit: int,
    ) -> tuple[OwnerModelUsageItem, ...]: ...

    def get_tier_usage(
        self, *, window: OwnerTimeWindow | None
    ) -> tuple[OwnerTierUsageItem, ...]: ...

    def list_recent_activity(
        self, *, window: OwnerTimeWindow, limit: int
    ) -> tuple[OwnerRecentActivity, ...]: ...


class OwnerReadQueryService:
    """Read-only contract consumed by a future Refine/Desktop adapter."""

    endpoint_candidates = MappingProxyType({
        "getOverview": "get_overview",
        "listCustomers": "list_customers",
        "getCustomer": "get_customer",
        "listRequests": "list_requests",
        "getRequest": "get_request",
        "listKnowledgeReviewQueue": "list_knowledge_review_queue",
        "getModelUsage": "get_model_usage",
        "getTierUsage": "get_tier_usage",
        "listRecentActivity": "list_recent_activity",
    })

    def __init__(self, repository: OwnerReadRepository) -> None:
        self._repository = repository

    def get_overview(
        self,
        preset: OwnerTimePreset,
        *,
        timezone_name: str,
        now: datetime,
        custom_from: datetime | None = None,
        custom_to: datetime | None = None,
        recent_limit: int = 10,
    ) -> OwnerOperationsOverview:
        window = resolve_owner_time_window(
            preset,
            timezone_name=timezone_name,
            now=now,
            custom_from=custom_from,
            custom_to=custom_to,
        )
        return self._repository.get_overview(window, recent_limit=recent_limit)

    def list_customers(
        self,
        filters: OwnerCustomerFilters = OwnerCustomerFilters(),
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        offset: int = 0,
        now: datetime,
        active_days: int = 30,
    ) -> OwnerCustomerPage:
        if isinstance(active_days, bool) or not isinstance(active_days, int) or active_days < 1:
            raise ValueError("active_days must be a positive integer")
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("now must be timezone-aware")
        return self._repository.list_customers(
            filters,
            limit=limit,
            offset=offset,
            active_since=now - timedelta(days=active_days),
        )

    def get_customer(
        self,
        customer_id: str,
        *,
        request_limit: int = DEFAULT_PAGE_SIZE,
        request_offset: int = 0,
    ) -> OwnerCustomerDetail:
        return self._repository.get_customer(
            customer_id, request_limit=request_limit, request_offset=request_offset
        )

    def list_requests(
        self,
        filters: OwnerRequestFilters = OwnerRequestFilters(),
        *,
        sort: OwnerRequestSort = OwnerRequestSort.NEWEST_FIRST,
        limit: int = DEFAULT_PAGE_SIZE,
        offset: int = 0,
    ) -> OwnerRequestPage:
        return self._repository.list_requests(
            filters, sort=sort, limit=limit, offset=offset
        )

    def get_request(self, request_id: str) -> OwnerRequestDetail:
        return self._repository.get_request(request_id)

    def list_knowledge_review_queue(
        self, *, limit: int = DEFAULT_PAGE_SIZE, offset: int = 0
    ) -> OwnerKnowledgeReviewPage:
        return self._repository.list_knowledge_review_queue(limit=limit, offset=offset)

    def get_model_usage(
        self,
        *,
        window: OwnerTimeWindow | None = None,
        user_tier: UserTier | None = None,
        limit: int = DEFAULT_PAGE_SIZE,
    ) -> tuple[OwnerModelUsageItem, ...]:
        return self._repository.get_model_usage(
            window=window, user_tier=user_tier, limit=limit
        )

    def get_tier_usage(
        self, *, window: OwnerTimeWindow | None = None
    ) -> tuple[OwnerTierUsageItem, ...]:
        return self._repository.get_tier_usage(window=window)

    def list_recent_activity(
        self, *, window: OwnerTimeWindow, limit: int = 20
    ) -> tuple[OwnerRecentActivity, ...]:
        return self._repository.list_recent_activity(window=window, limit=limit)


def owner_read_to_primitive(value: Any) -> Any:
    if is_dataclass(value):
        return {item.name: owner_read_to_primitive(getattr(value, item.name)) for item in fields(value)}
    if isinstance(value, StrEnum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, tuple):
        return [owner_read_to_primitive(item) for item in value]
    if isinstance(value, list):
        return [owner_read_to_primitive(item) for item in value]
    if isinstance(value, dict):
        return {str(key): owner_read_to_primitive(item) for key, item in value.items()}
    return value


def serialize_owner_read(value: Any) -> str:
    return json.dumps(
        owner_read_to_primitive(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
