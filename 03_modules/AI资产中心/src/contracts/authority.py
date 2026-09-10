from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as datetime_timezone
from enum import Enum

from .pricing import PricingSnapshot
from .source_tag import SourceTag


class BillingMode(str, Enum):
    API_USAGE = "api_usage"
    SUBSCRIPTION = "subscription"
    QUOTA = "quota"
    CREDIT = "credit"
    HYBRID = "hybrid"


class AuthoritySourceType(str, Enum):
    OFFICIAL_PROVIDER = "official_provider"
    LEGACY_REFERENCE = "legacy_reference"
    LOCAL_MANUAL = "local_manual"
    DERIVED = "derived"


class FreshnessStatus(str, Enum):
    FRESH = "fresh"
    STALE = "stale"
    UNKNOWN = "unknown"


class AuthorityCompleteness(str, Enum):
    COMPLETE = "complete"
    INCOMPLETE = "incomplete"
    UNKNOWN = "unknown"


class PricingWindowMode(str, Enum):
    INCLUDE = "include"
    EXCLUDE = "exclude"


@dataclass(frozen=True)
class DailyTimeWindow:
    """A local wall-clock half-open window expressed as minutes after midnight."""

    start_minute: int
    end_minute: int
    weekdays: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 6)

    def __post_init__(self) -> None:
        if (isinstance(self.start_minute, bool)
                or not isinstance(self.start_minute, int)
                or not 0 <= self.start_minute < 1440):
            raise ValueError("start_minute must be an integer from 0 through 1439")
        if (isinstance(self.end_minute, bool)
                or not isinstance(self.end_minute, int)
                or not 1 <= self.end_minute <= 1440):
            raise ValueError("end_minute must be an integer from 1 through 1440")
        if self.start_minute >= self.end_minute:
            raise ValueError("daily time window must have positive duration")
        if (not isinstance(self.weekdays, tuple) or not self.weekdays
                or any(isinstance(day, bool) or not isinstance(day, int)
                       or not 0 <= day <= 6 for day in self.weekdays)
                or len(set(self.weekdays)) != len(self.weekdays)):
            raise ValueError("weekdays must be unique integers from 0 through 6")

    def contains(self, local_at: datetime) -> bool:
        if not isinstance(local_at, datetime):
            raise ValueError("local_at must be a datetime")
        seconds = (
            local_at.hour * 3600
            + local_at.minute * 60
            + local_at.second
            + local_at.microsecond / 1_000_000
        )
        return (
            local_at.weekday() in self.weekdays
            and self.start_minute * 60 <= seconds < self.end_minute * 60
        )


@dataclass(frozen=True)
class PricingTimeRule:
    """Recurring provider pricing rule evaluated in an explicit timezone."""

    timezone: str
    utc_offset_minutes: int
    windows: tuple[DailyTimeWindow, ...]
    mode: PricingWindowMode = PricingWindowMode.INCLUDE

    def __post_init__(self) -> None:
        if not _non_empty(self.timezone):
            raise ValueError("pricing time-rule timezone must not be empty")
        if (isinstance(self.utc_offset_minutes, bool)
                or not isinstance(self.utc_offset_minutes, int)
                or not -1439 <= self.utc_offset_minutes <= 1439):
            raise ValueError("pricing time-rule UTC offset is invalid")
        if not isinstance(self.windows, tuple) or not self.windows:
            raise ValueError("pricing time rule requires at least one daily window")
        if any(not isinstance(window, DailyTimeWindow) for window in self.windows):
            raise ValueError("pricing time-rule windows are invalid")
        if not isinstance(self.mode, PricingWindowMode):
            raise ValueError("pricing time-rule mode is invalid")

    def applies_at(self, at: datetime) -> bool:
        _aware(at, "at")
        local_at = at.astimezone(datetime_timezone(
            timedelta(minutes=self.utc_offset_minutes), self.timezone
        ))
        inside = any(window.contains(local_at) for window in self.windows)
        return inside if self.mode is PricingWindowMode.INCLUDE else not inside


@dataclass(frozen=True)
class FreshnessPolicy:
    valid_for: timedelta | None

    def __post_init__(self) -> None:
        if self.valid_for is not None and (
            not isinstance(self.valid_for, timedelta)
            or self.valid_for <= timedelta(0)
        ):
            raise ValueError("freshness valid_for must be a positive timedelta or None")

    def evaluate(self, last_verified_at: datetime | None, as_of: datetime) -> FreshnessStatus:
        _aware(as_of, "as_of")
        if last_verified_at is None or self.valid_for is None:
            return FreshnessStatus.UNKNOWN
        _aware(last_verified_at, "last_verified_at")
        return (
            FreshnessStatus.FRESH
            if as_of <= last_verified_at + self.valid_for
            else FreshnessStatus.STALE
        )


@dataclass(frozen=True)
class AuthorityMetadata:
    authority_source_type: AuthoritySourceType
    official_source: str | None
    fetched_at: datetime | None
    last_verified_at: datetime | None
    freshness_policy: FreshnessPolicy
    source: SourceTag

    def __post_init__(self) -> None:
        if not isinstance(self.authority_source_type, AuthoritySourceType):
            raise ValueError("authority_source_type is invalid")
        if self.official_source is not None and not _non_empty(self.official_source):
            raise ValueError("official_source must be non-empty when supplied")
        if self.authority_source_type is AuthoritySourceType.OFFICIAL_PROVIDER:
            if not _non_empty(self.official_source):
                raise ValueError("official provider authority requires official_source")
            if self.last_verified_at is None:
                raise ValueError("official provider authority requires last_verified_at")
        for name, value in (
            ("fetched_at", self.fetched_at),
            ("last_verified_at", self.last_verified_at),
        ):
            if value is not None:
                _aware(value, name)
        if not isinstance(self.freshness_policy, FreshnessPolicy):
            raise ValueError("freshness_policy is invalid")
        if not isinstance(self.source, SourceTag):
            raise ValueError("authority metadata source is invalid")


@dataclass(frozen=True)
class PricingAuthorityRecord:
    authority_id: str
    provider_id: str
    model: str
    billing_mode: BillingMode
    effective_from: datetime
    components: tuple[PricingSnapshot, ...]
    metadata: AuthorityMetadata
    effective_to: datetime | None = None
    pricing_tier: str | None = None
    time_rule: PricingTimeRule | None = None

    def __post_init__(self) -> None:
        for name, value in (
            ("authority_id", self.authority_id),
            ("provider_id", self.provider_id),
            ("model", self.model),
        ):
            if not _non_empty(value):
                raise ValueError(f"{name} must not be empty")
        if not isinstance(self.billing_mode, BillingMode):
            raise ValueError("billing_mode is invalid")
        _aware(self.effective_from, "effective_from")
        if self.effective_to is not None:
            _aware(self.effective_to, "effective_to")
            if self.effective_to <= self.effective_from:
                raise ValueError("effective_to must be after effective_from")
        if (self.pricing_tier is None) != (self.time_rule is None):
            raise ValueError("pricing_tier and time_rule must be supplied together")
        if self.pricing_tier is not None and not _non_empty(self.pricing_tier):
            raise ValueError("pricing_tier must be non-empty when supplied")
        if self.time_rule is not None and not isinstance(self.time_rule, PricingTimeRule):
            raise ValueError("time_rule is invalid")
        if not isinstance(self.components, tuple) or not self.components:
            raise ValueError("pricing authority requires at least one component")
        identities = set()
        currencies = set()
        for component in self.components:
            if not isinstance(component, PricingSnapshot):
                raise ValueError("components must contain PricingSnapshot objects")
            if component.provider_id != self.provider_id or component.model != self.model:
                raise ValueError("pricing component identity does not match authority record")
            if component.effective_at != self.effective_from:
                raise ValueError("pricing component effective time does not match authority record")
            key = (component.price_dimension, component.unit, component.token_id)
            if key in identities:
                raise ValueError("pricing authority components must have unique identities")
            identities.add(key)
            currencies.add(component.currency)
        if len(currencies) != 1:
            raise ValueError("pricing authority components must use one currency")
        if not isinstance(self.metadata, AuthorityMetadata):
            raise ValueError("metadata is invalid")

    @property
    def currency(self) -> str:
        return self.components[0].currency

    def applies_at(self, at: datetime) -> bool:
        _aware(at, "at")
        if at < self.effective_from:
            return False
        if self.effective_to is not None and at >= self.effective_to:
            return False
        return self.time_rule is None or self.time_rule.applies_at(at)


def _aware(value: datetime, name: str) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")


def _non_empty(value: str | None) -> bool:
    return isinstance(value, str) and bool(value.strip())
