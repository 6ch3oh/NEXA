from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum

from src.contracts import SourceTag, SourceType


class BudgetScope(str, Enum):
    PORTFOLIO = "portfolio"
    PROVIDER = "provider"
    TOKEN = "token"


class BudgetPeriodKind(str, Enum):
    DAILY = "daily"
    MONTHLY = "monthly"


class BudgetCostBasis(str, Enum):
    ACTUAL_ONLY = "actual_only"
    ESTIMATED_ONLY = "estimated_only"
    ACTUAL_PLUS_ESTIMATED = "actual_plus_estimated"


class BudgetStatus(str, Enum):
    UNKNOWN = "unknown"
    OK = "ok"
    WARNING = "warning"
    CRITICAL = "critical"
    EXCEEDED = "exceeded"


class BudgetCompleteness(str, Enum):
    COMPLETE = "complete"
    INCOMPLETE = "incomplete"
    UNKNOWN = "unknown"


class BudgetReasonCode(str, Enum):
    COST_DATA_MISSING = "COST_DATA_MISSING"
    CURRENCY_MISMATCH = "CURRENCY_MISMATCH"
    INVALID_POLICY = "INVALID_POLICY"
    POLICY_DISABLED = "POLICY_DISABLED"
    AMBIGUOUS_COST_DATA = "AMBIGUOUS_COST_DATA"
    PERIOD_NO_DATA = "PERIOD_NO_DATA"
    THRESHOLD_WARNING = "THRESHOLD_WARNING"
    THRESHOLD_CRITICAL = "THRESHOLD_CRITICAL"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"


@dataclass(frozen=True)
class BudgetPeriod:
    kind: BudgetPeriodKind
    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if not isinstance(self.kind, BudgetPeriodKind):
            raise ValueError("budget period kind is invalid")
        _require_aware(self.start, "period start")
        _require_aware(self.end, "period end")
        if self.start >= self.end:
            raise ValueError("budget period start must be before end")
        if self.start != self.start.replace(hour=0, minute=0, second=0, microsecond=0):
            raise ValueError("budget period must start at local midnight")
        expected_end = _expected_period_end(self.kind, self.start)
        if self.end != expected_end:
            raise ValueError("budget period end does not match its declared kind")

    @classmethod
    def daily(cls, moment: datetime) -> BudgetPeriod:
        _require_aware(moment, "moment")
        start = moment.replace(hour=0, minute=0, second=0, microsecond=0)
        return cls(BudgetPeriodKind.DAILY, start, start + timedelta(days=1))

    @classmethod
    def monthly(cls, moment: datetime) -> BudgetPeriod:
        _require_aware(moment, "moment")
        start = moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return cls(BudgetPeriodKind.MONTHLY, start, _expected_period_end(BudgetPeriodKind.MONTHLY, start))


@dataclass(frozen=True)
class BudgetPolicy:
    policy_id: str
    scope: BudgetScope
    currency: str
    limit_amount: Decimal
    period: BudgetPeriod
    warning_ratio: Decimal
    critical_ratio: Decimal
    enabled: bool
    source: SourceTag
    created_at: datetime
    effective_at: datetime
    cost_basis: BudgetCostBasis = BudgetCostBasis.ACTUAL_ONLY
    provider_id: str | None = None
    token_id: str | None = None
    model: str | None = None
    label: str | None = None

    def __post_init__(self) -> None:
        if not _non_empty(self.policy_id):
            raise ValueError("policy_id must not be empty")
        if not isinstance(self.scope, BudgetScope):
            raise ValueError("scope must be a BudgetScope")
        if not _non_empty(self.currency) or self.currency != self.currency.strip().upper():
            raise ValueError("currency must be a normalized uppercase code")
        _require_finite_decimal(self.limit_amount, "limit_amount")
        if self.limit_amount <= 0:
            raise ValueError("limit_amount must be greater than zero")
        _require_finite_decimal(self.warning_ratio, "warning_ratio")
        _require_finite_decimal(self.critical_ratio, "critical_ratio")
        if not (Decimal(0) < self.warning_ratio <= self.critical_ratio <= Decimal(1)):
            raise ValueError("thresholds must satisfy 0 < warning <= critical <= 1")
        if not isinstance(self.period, BudgetPeriod):
            raise ValueError("period must be a BudgetPeriod")
        if not isinstance(self.cost_basis, BudgetCostBasis):
            raise ValueError("cost_basis must be a BudgetCostBasis")
        if not isinstance(self.enabled, bool):
            raise ValueError("enabled must be bool")
        if not isinstance(self.source, SourceTag):
            raise ValueError("source must be a SourceTag")
        if self.source.captured_at is None:
            raise ValueError("policy source captured_at is required")
        _require_aware(self.source.captured_at, "policy source captured_at")
        _require_aware(self.created_at, "created_at")
        _require_aware(self.effective_at, "effective_at")
        if self.effective_at < self.created_at:
            raise ValueError("effective_at must not precede created_at")
        if self.label is not None and not _non_empty(self.label):
            raise ValueError("label must be non-empty when supplied")
        _validate_scope(self)


@dataclass(frozen=True)
class BudgetEvaluationProvenance:
    source_type: SourceType
    source_reference: str
    cost_basis: BudgetCostBasis
    mixed_cost_basis: bool
    policy_source: SourceTag

    def __post_init__(self) -> None:
        if self.source_type is not SourceType.DERIVED_CALCULATED:
            raise ValueError("budget evaluation must be derived/calculated")
        if self.source_reference != "budget_policy_evaluation":
            raise ValueError("budget evaluation source reference is invalid")
        if self.mixed_cost_basis != (self.cost_basis is BudgetCostBasis.ACTUAL_PLUS_ESTIMATED):
            raise ValueError("mixed_cost_basis must match the selected cost basis")


@dataclass(frozen=True)
class BudgetEvaluationResult:
    policy_id: str
    scope: BudgetScope
    period_start: datetime
    period_end: datetime
    currency: str
    limit_amount: Decimal
    actual_used: Decimal | None
    estimated_used: Decimal | None
    evaluated_used: Decimal | None
    remaining_amount: Decimal | None
    utilization_ratio: Decimal | None
    overage_amount: Decimal | None
    status: BudgetStatus
    reasons: tuple[BudgetReasonCode, ...]
    completeness: BudgetCompleteness
    evaluated_at: datetime
    provenance: BudgetEvaluationProvenance

    def __post_init__(self) -> None:
        _require_aware(self.period_start, "period_start")
        _require_aware(self.period_end, "period_end")
        _require_aware(self.evaluated_at, "evaluated_at")
        if self.reasons != tuple(sorted(set(self.reasons), key=lambda item: item.value)):
            raise ValueError("reasons must be deterministically ordered and deduplicated")
        for value in (
            self.limit_amount, self.actual_used, self.estimated_used, self.evaluated_used,
            self.remaining_amount, self.utilization_ratio, self.overage_amount,
        ):
            if value is not None:
                _require_finite_decimal(value, "evaluation amount")
        if self.status is BudgetStatus.UNKNOWN:
            if self.evaluated_used is not None or self.completeness is not BudgetCompleteness.UNKNOWN:
                raise ValueError("UNKNOWN evaluation cannot claim evaluated spend")
        elif self.evaluated_used is None or self.completeness is not BudgetCompleteness.COMPLETE:
            raise ValueError("known evaluation must be complete and carry evaluated spend")


def _validate_scope(policy: BudgetPolicy) -> None:
    if policy.scope is BudgetScope.PORTFOLIO:
        if policy.provider_id is not None or policy.token_id is not None or policy.model is not None:
            raise ValueError("portfolio policy cannot carry provider/token/model scope")
    elif policy.scope is BudgetScope.PROVIDER:
        if not _non_empty(policy.provider_id) or policy.token_id is not None:
            raise ValueError("provider policy requires provider_id and forbids token_id")
    elif policy.scope is BudgetScope.TOKEN:
        if not _non_empty(policy.provider_id) or not _non_empty(policy.token_id):
            raise ValueError("token policy requires provider_id and token_id")


def _expected_period_end(kind: BudgetPeriodKind, start: datetime) -> datetime:
    if kind is BudgetPeriodKind.DAILY:
        return start + timedelta(days=1)
    if start.day != 1:
        raise ValueError("monthly period must start on day one")
    if start.month == 12:
        return start.replace(year=start.year + 1, month=1)
    return start.replace(month=start.month + 1)


def _require_finite_decimal(value: Decimal, name: str) -> None:
    if not isinstance(value, Decimal) or not value.is_finite():
        raise ValueError(f"{name} must be a finite Decimal")


def _require_aware(value: datetime, name: str) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")


def _non_empty(value: str | None) -> bool:
    return isinstance(value, str) and bool(value.strip())
