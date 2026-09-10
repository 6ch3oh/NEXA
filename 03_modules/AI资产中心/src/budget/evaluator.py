from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from src.analytics import CostRollup, Period, rollup_costs
from src.contracts import SourceType
from src.query import QueryService

from .models import (
    BudgetCompleteness,
    BudgetCostBasis,
    BudgetEvaluationProvenance,
    BudgetEvaluationResult,
    BudgetPolicy,
    BudgetReasonCode,
    BudgetScope,
    BudgetStatus,
)


def evaluate_budget_from_query(
    query: QueryService,
    policy: BudgetPolicy,
    *,
    evaluated_at: datetime,
    cost_data_ambiguous: bool = False,
) -> BudgetEvaluationResult:
    """Obtain existing CostRollups for the policy scope, then evaluate only."""

    if not isinstance(query, QueryService):
        raise TypeError("query must be a QueryService")
    period = Period(policy.period.start, policy.period.end)
    if policy.scope is BudgetScope.PORTFOLIO:
        provider_ids = sorted(
            {item.id for item in query.providers} | {item.provider_id for item in query.costs}
        )
    else:
        provider_ids = [policy.provider_id]
    rollups = tuple(
        rollup
        for provider_id in provider_ids
        for rollup in rollup_costs(
            query,
            provider_id,
            period,
            token_id=policy.token_id if policy.scope is BudgetScope.TOKEN else None,
            model=policy.model,
        )
    )
    return evaluate_budget(
        policy,
        rollups,
        evaluated_at=evaluated_at,
        cost_data_ambiguous=cost_data_ambiguous,
    )


def evaluate_budget(
    policy: BudgetPolicy,
    cost_rollups: tuple[CostRollup, ...],
    *,
    evaluated_at: datetime,
    cost_data_ambiguous: bool = False,
) -> BudgetEvaluationResult:
    if not isinstance(policy, BudgetPolicy):
        raise TypeError("policy must be a BudgetPolicy")
    if not isinstance(cost_rollups, tuple) or not all(
        isinstance(item, CostRollup) for item in cost_rollups
    ):
        raise TypeError("cost_rollups must be a tuple of CostRollup values")
    _require_aware(evaluated_at)
    provenance = BudgetEvaluationProvenance(
        source_type=SourceType.DERIVED_CALCULATED,
        source_reference="budget_policy_evaluation",
        cost_basis=policy.cost_basis,
        mixed_cost_basis=policy.cost_basis is BudgetCostBasis.ACTUAL_PLUS_ESTIMATED,
        policy_source=policy.source,
    )
    period_mismatch = any(
        item.period_start != policy.period.start or item.period_end != policy.period.end
        for item in cost_rollups
    )
    scope_mismatch = any(not _rollup_in_scope(policy, item) for item in cost_rollups)
    matching = tuple(item for item in cost_rollups if item.currency == policy.currency)
    other_currency_present = any(item.currency != policy.currency for item in cost_rollups)
    actual_used = _sum_observed(matching, actual=True)
    estimated_used = _sum_observed(matching, actual=False)

    unknown_reasons: list[BudgetReasonCode] = []
    if not policy.enabled:
        unknown_reasons.append(BudgetReasonCode.POLICY_DISABLED)
    if period_mismatch:
        unknown_reasons.append(BudgetReasonCode.INVALID_POLICY)
    if scope_mismatch or evaluated_at < policy.effective_at:
        unknown_reasons.append(BudgetReasonCode.INVALID_POLICY)
    if cost_data_ambiguous:
        unknown_reasons.append(BudgetReasonCode.AMBIGUOUS_COST_DATA)
    if not cost_rollups:
        unknown_reasons.extend(
            (BudgetReasonCode.COST_DATA_MISSING, BudgetReasonCode.PERIOD_NO_DATA)
        )
    elif not matching and other_currency_present:
        unknown_reasons.append(BudgetReasonCode.CURRENCY_MISMATCH)
    if policy.cost_basis is BudgetCostBasis.ACTUAL_ONLY and actual_used is None:
        unknown_reasons.append(BudgetReasonCode.COST_DATA_MISSING)
    elif policy.cost_basis is BudgetCostBasis.ESTIMATED_ONLY and estimated_used is None:
        unknown_reasons.append(BudgetReasonCode.COST_DATA_MISSING)
    elif policy.cost_basis is BudgetCostBasis.ACTUAL_PLUS_ESTIMATED and (
        actual_used is None or estimated_used is None
    ):
        unknown_reasons.append(BudgetReasonCode.COST_DATA_MISSING)
    if unknown_reasons:
        return _unknown_result(
            policy, evaluated_at, actual_used, estimated_used, provenance, unknown_reasons
        )

    if policy.cost_basis is BudgetCostBasis.ACTUAL_ONLY:
        evaluated_used = actual_used
    elif policy.cost_basis is BudgetCostBasis.ESTIMATED_ONLY:
        evaluated_used = estimated_used
    else:
        evaluated_used = actual_used + estimated_used
    remaining = policy.limit_amount - evaluated_used
    utilization = evaluated_used / policy.limit_amount
    overage = max(evaluated_used - policy.limit_amount, Decimal(0))
    if evaluated_used > policy.limit_amount:
        status = BudgetStatus.EXCEEDED
        reasons = (BudgetReasonCode.BUDGET_EXCEEDED,)
    elif utilization >= policy.critical_ratio:
        status = BudgetStatus.CRITICAL
        reasons = (BudgetReasonCode.THRESHOLD_CRITICAL,)
    elif utilization >= policy.warning_ratio:
        status = BudgetStatus.WARNING
        reasons = (BudgetReasonCode.THRESHOLD_WARNING,)
    else:
        status = BudgetStatus.OK
        reasons = ()
    return BudgetEvaluationResult(
        policy_id=policy.policy_id,
        scope=policy.scope,
        period_start=policy.period.start,
        period_end=policy.period.end,
        currency=policy.currency,
        limit_amount=policy.limit_amount,
        actual_used=actual_used,
        estimated_used=estimated_used,
        evaluated_used=evaluated_used,
        remaining_amount=remaining,
        utilization_ratio=utilization,
        overage_amount=overage,
        status=status,
        reasons=reasons,
        completeness=BudgetCompleteness.COMPLETE,
        evaluated_at=evaluated_at,
        provenance=provenance,
    )


def _sum_observed(rollups: tuple[CostRollup, ...], *, actual: bool) -> Decimal | None:
    values = tuple(
        item.actual_amount if actual else item.estimated_amount
        for item in rollups
        if (item.actual_record_count if actual else item.estimated_record_count) > 0
    )
    return sum(values, Decimal(0)) if values else None


def _rollup_in_scope(policy: BudgetPolicy, rollup: CostRollup) -> bool:
    if policy.scope is BudgetScope.PROVIDER and rollup.provider_id != policy.provider_id:
        return False
    if policy.scope is BudgetScope.TOKEN and (
        rollup.provider_id != policy.provider_id or rollup.token_id != policy.token_id
    ):
        return False
    if policy.model is not None and rollup.model != policy.model:
        return False
    return True


def _unknown_result(
    policy: BudgetPolicy,
    evaluated_at: datetime,
    actual_used: Decimal | None,
    estimated_used: Decimal | None,
    provenance: BudgetEvaluationProvenance,
    reasons: list[BudgetReasonCode],
) -> BudgetEvaluationResult:
    return BudgetEvaluationResult(
        policy_id=policy.policy_id,
        scope=policy.scope,
        period_start=policy.period.start,
        period_end=policy.period.end,
        currency=policy.currency,
        limit_amount=policy.limit_amount,
        actual_used=actual_used,
        estimated_used=estimated_used,
        evaluated_used=None,
        remaining_amount=None,
        utilization_ratio=None,
        overage_amount=None,
        status=BudgetStatus.UNKNOWN,
        reasons=tuple(sorted(set(reasons), key=lambda item: item.value)),
        completeness=BudgetCompleteness.UNKNOWN,
        evaluated_at=evaluated_at,
        provenance=provenance,
    )


def _require_aware(value: datetime) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("evaluated_at must be timezone-aware")
