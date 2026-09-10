from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from src.budget import (
    BudgetCompleteness,
    BudgetCostBasis,
    BudgetEvaluationResult,
    BudgetReasonCode,
    BudgetScope,
    BudgetStatus,
)
from src.contracts import SourceType

from .models import AI_ASSET_CONSUMPTION_SCHEMA_VERSION


@dataclass(frozen=True)
class BudgetConsumptionProvenance:
    source_type: SourceType
    source_reference: str
    cost_basis: BudgetCostBasis
    mixed_cost_basis: bool


@dataclass(frozen=True)
class BudgetConsumptionData:
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
    provenance: BudgetConsumptionProvenance


@dataclass(frozen=True)
class BudgetConsumptionView:
    schema_version: str
    generated_at: datetime
    data: BudgetConsumptionData
    completeness: BudgetCompleteness
    warnings: tuple[BudgetReasonCode, ...]

    def __post_init__(self) -> None:
        if self.schema_version != AI_ASSET_CONSUMPTION_SCHEMA_VERSION:
            raise ValueError("unsupported consumption schema version")
        if self.generated_at.tzinfo is None or self.generated_at.utcoffset() is None:
            raise ValueError("generated_at must be timezone-aware")
        if self.warnings != tuple(sorted(set(self.warnings), key=lambda item: item.value)):
            raise ValueError("budget warnings must be ordered and deduplicated")


def build_budget_consumption_view(result: BudgetEvaluationResult) -> BudgetConsumptionView:
    if not isinstance(result, BudgetEvaluationResult):
        raise TypeError("result must be a BudgetEvaluationResult")
    provenance = result.provenance
    return BudgetConsumptionView(
        schema_version=AI_ASSET_CONSUMPTION_SCHEMA_VERSION,
        generated_at=result.evaluated_at,
        data=BudgetConsumptionData(
            policy_id=result.policy_id,
            scope=result.scope,
            period_start=result.period_start,
            period_end=result.period_end,
            currency=result.currency,
            limit_amount=result.limit_amount,
            actual_used=result.actual_used,
            estimated_used=result.estimated_used,
            evaluated_used=result.evaluated_used,
            remaining_amount=result.remaining_amount,
            utilization_ratio=result.utilization_ratio,
            overage_amount=result.overage_amount,
            status=result.status,
            reasons=result.reasons,
            provenance=BudgetConsumptionProvenance(
                provenance.source_type,
                provenance.source_reference,
                provenance.cost_basis,
                provenance.mixed_cost_basis,
            ),
        ),
        completeness=result.completeness,
        warnings=result.reasons,
    )
