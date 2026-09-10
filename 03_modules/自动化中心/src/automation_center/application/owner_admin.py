"""Read-only application adapter for the OWNER administration UI.

This module deliberately depends on the stable OwnerReadQueryService contract,
not SQLite, LiteLLM, n8n, or HTTP implementation details.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from types import MappingProxyType
from typing import Any

from automation_center.application.owner_read import (
    OwnerReadQueryService,
    owner_read_to_primitive,
)
from automation_center.domain.customer_request import (
    ActorType,
    CustomerRequestStatus,
    KnowledgeReviewState,
)
from automation_center.domain.model_gateway import UserTier
from automation_center.domain.owner_read import (
    CustomerActivityFilter,
    OwnerCustomerFilters,
    OwnerRequestFilters,
    OwnerRequestSort,
    OwnerTimePreset,
    resolve_owner_time_window,
)


OWNER_ADMIN_UI_VERSION = "0.1"
NONPROD_DEMO_DATASET = "NONPROD_DEMO_DATASET"


class OwnerAdminRequestError(ValueError):
    """Safe client error with no reflected parameter value."""


class OwnerAdminReadAdapter:
    """Whitelist-only mapping from UI query parameters to the read service."""

    operations = MappingProxyType({
        "getOverview": frozenset({"preset", "timezone", "from", "to", "recent_limit"}),
        "listCustomers": frozenset({
            "search", "tier", "activity", "limit", "offset", "active_days"
        }),
        "getCustomer": frozenset({"customer_id", "limit", "offset"}),
        "listRequests": frozenset({
            "actor", "customer_id", "tier", "status", "capability", "provider",
            "model", "review", "preset", "timezone", "from", "to", "sort",
            "limit", "offset",
        }),
        "getRequest": frozenset({"request_id"}),
        "listKnowledgeReviewQueue": frozenset({"limit", "offset"}),
        "getModelUsage": frozenset({
            "tier", "preset", "timezone", "from", "to", "limit"
        }),
        "getTierUsage": frozenset({"preset", "timezone", "from", "to"}),
        "listRecentActivity": frozenset({
            "preset", "timezone", "from", "to", "limit"
        }),
    })

    def __init__(
        self,
        service: OwnerReadQueryService,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._service = service
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def dispatch(self, operation: str, params: Mapping[str, str]) -> Any:
        allowed = self.operations.get(operation)
        if allowed is None:
            raise OwnerAdminRequestError("unsupported read operation")
        unexpected = set(params) - allowed
        if unexpected:
            raise OwnerAdminRequestError("unsupported query parameter")
        now = self._clock()
        if now.tzinfo is None or now.utcoffset() is None:
            raise RuntimeError("OWNER admin clock must be timezone-aware")

        if operation == "getOverview":
            value = self._service.get_overview(
                self._preset(params, default=OwnerTimePreset.TODAY),
                timezone_name=params.get("timezone", "Asia/Shanghai"),
                now=now,
                custom_from=self._date(params, "from"),
                custom_to=self._date(params, "to"),
                recent_limit=self._integer(params, "recent_limit", 8, maximum=50),
            )
        elif operation == "listCustomers":
            value = self._service.list_customers(
                OwnerCustomerFilters(
                    customer_id_search=self._optional(params, "search"),
                    user_tier=self._enum(params, "tier", UserTier),
                    activity=self._enum(
                        params, "activity", CustomerActivityFilter
                    ) or CustomerActivityFilter.ALL,
                ),
                limit=self._integer(params, "limit", 50, maximum=500),
                offset=self._integer(params, "offset", 0, minimum=0, maximum=10_000_000),
                now=now,
                active_days=self._integer(params, "active_days", 30, minimum=1, maximum=3650),
            )
        elif operation == "getCustomer":
            value = self._service.get_customer(
                self._required(params, "customer_id"),
                request_limit=self._integer(params, "limit", 50, maximum=500),
                request_offset=self._integer(params, "offset", 0, minimum=0, maximum=10_000_000),
            )
        elif operation == "listRequests":
            value = self._service.list_requests(
                OwnerRequestFilters(
                    actor_type=self._enum(params, "actor", ActorType),
                    customer_id=self._optional(params, "customer_id"),
                    user_tier=self._enum(params, "tier", UserTier),
                    request_status=self._enum(params, "status", CustomerRequestStatus),
                    capability_id=self._optional(params, "capability"),
                    resolved_provider=self._optional(params, "provider"),
                    resolved_model=self._optional(params, "model"),
                    knowledge_review_state=self._enum(
                        params, "review", KnowledgeReviewState
                    ),
                    window=self._window(params, now=now, optional=True),
                ),
                sort=self._enum(params, "sort", OwnerRequestSort)
                or OwnerRequestSort.NEWEST_FIRST,
                limit=self._integer(params, "limit", 50, maximum=500),
                offset=self._integer(params, "offset", 0, minimum=0, maximum=10_000_000),
            )
        elif operation == "getRequest":
            value = self._service.get_request(self._required(params, "request_id"))
        elif operation == "listKnowledgeReviewQueue":
            value = self._service.list_knowledge_review_queue(
                limit=self._integer(params, "limit", 50, maximum=500),
                offset=self._integer(params, "offset", 0, minimum=0, maximum=10_000_000),
            )
        elif operation == "getModelUsage":
            value = self._service.get_model_usage(
                window=self._window(params, now=now, optional=True),
                user_tier=self._enum(params, "tier", UserTier),
                limit=self._integer(params, "limit", 50, maximum=500),
            )
        elif operation == "getTierUsage":
            value = self._service.get_tier_usage(
                window=self._window(params, now=now, optional=True)
            )
        else:
            value = self._service.list_recent_activity(
                window=self._window(params, now=now, optional=False),
                limit=self._integer(params, "limit", 20, maximum=100),
            )
        return owner_read_to_primitive(value)

    def _window(
        self, params: Mapping[str, str], *, now: datetime, optional: bool
    ):
        if optional and not any(key in params for key in ("preset", "from", "to")):
            return None
        preset = self._preset(params, default=OwnerTimePreset.TODAY)
        return resolve_owner_time_window(
            preset,
            timezone_name=params.get("timezone", "Asia/Shanghai"),
            now=now,
            custom_from=self._date(params, "from"),
            custom_to=self._date(params, "to"),
        )

    @staticmethod
    def _optional(params: Mapping[str, str], key: str) -> str | None:
        value = params.get(key)
        if value is None:
            return None
        value = value.strip()
        if not value or len(value) > 512 or any(ord(char) < 32 for char in value):
            raise OwnerAdminRequestError("invalid query parameter")
        return value

    @classmethod
    def _required(cls, params: Mapping[str, str], key: str) -> str:
        value = cls._optional(params, key)
        if value is None:
            raise OwnerAdminRequestError("required query parameter is missing")
        return value

    @classmethod
    def _integer(
        cls,
        params: Mapping[str, str],
        key: str,
        default: int,
        *,
        minimum: int = 1,
        maximum: int,
    ) -> int:
        raw = params.get(key)
        if raw is None:
            return default
        try:
            value = int(raw)
        except (TypeError, ValueError) as error:
            raise OwnerAdminRequestError("invalid integer query parameter") from error
        if not minimum <= value <= maximum:
            raise OwnerAdminRequestError("integer query parameter is out of range")
        return value

    @classmethod
    def _enum(cls, params: Mapping[str, str], key: str, enum_type):
        raw = cls._optional(params, key)
        if raw is None:
            return None
        try:
            return enum_type(raw)
        except ValueError as error:
            raise OwnerAdminRequestError("invalid enum query parameter") from error

    @classmethod
    def _preset(
        cls, params: Mapping[str, str], *, default: OwnerTimePreset
    ) -> OwnerTimePreset:
        return cls._enum(params, "preset", OwnerTimePreset) or default

    @classmethod
    def _date(cls, params: Mapping[str, str], key: str) -> datetime | None:
        raw = cls._optional(params, key)
        if raw is None:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError as error:
            raise OwnerAdminRequestError("invalid datetime query parameter") from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise OwnerAdminRequestError("datetime query parameter must include an offset")
        return parsed
