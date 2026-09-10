from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum

from src.contracts import AttributionStatus, BillingMode, CostKind, CostRecord, UsageRecord


class CostShareStatus(str, Enum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class AttributionRow:
    provider_id: str
    model: str | None
    project_id: str | None
    module_id: str | None
    task_id: str | None
    run_id: str | None
    attribution_status: AttributionStatus
    token_total: int
    token_denominator: int
    token_share: Decimal | None
    cost_total: Decimal | None
    cost_denominator: Decimal | None
    cost_share: Decimal | None
    share_direction: str

    @property
    def task_share_of_model_token(self) -> Decimal | None:
        return self.token_share if self.share_direction == "task_share_of_model" else None

    @property
    def task_share_of_model_cost(self) -> Decimal | None:
        return self.cost_share if self.share_direction == "task_share_of_model" else None

    @property
    def model_share_of_task_token(self) -> Decimal | None:
        return self.token_share if self.share_direction == "model_share_of_task" else None

    @property
    def model_share_of_task_cost(self) -> Decimal | None:
        return self.cost_share if self.share_direction == "model_share_of_task" else None


@dataclass(frozen=True)
class AttributionSummary:
    direction: str
    billing_mode: BillingMode
    cost_kind: CostKind
    cost_share_status: CostShareStatus
    currency: str | None
    rows: tuple[AttributionRow, ...]


def model_to_attribution(usages, costs, *, provider_id, model, start, end,
                         billing_mode, cost_kind=CostKind.ACTUAL):
    selected = tuple(u for u in usages if u.provider_id == provider_id and u.model == model
                     and start <= u.observed_at < end)
    groups = {}
    for usage in selected:
        a = usage.attribution
        groups.setdefault((a.project_id, a.module_id, a.task_id, a.run_id, a.status), []).append(usage)
    return _summary("model_to_attribution", billing_mode, cost_kind, groups, selected, tuple(costs),
                    lambda key: (provider_id, model, *key))


def task_to_models(usages, costs, *, project_id, task_id, start, end,
                   billing_mode, cost_kind=CostKind.ACTUAL):
    selected = tuple(u for u in usages if u.attribution.project_id == project_id
                     and u.attribution.task_id == task_id and start <= u.observed_at < end)
    groups = {}
    for usage in selected:
        a = usage.attribution
        groups.setdefault((usage.provider_id, usage.model, a.module_id, a.run_id, a.status), []).append(usage)
    return _summary("task_to_models", billing_mode, cost_kind, groups, selected, tuple(costs),
                    lambda key: (key[0], key[1], project_id, key[2], task_id, key[3], key[4]))


def _summary(direction, billing_mode, cost_kind, groups, selected, costs, identity):
    token_denominator = sum(u.total_tokens for u in selected)
    by_usage = {}
    for usage in selected:
        key = (usage.provider_id, usage.usage_id)
        prior = by_usage.get(key)
        if prior is not None and prior != usage:
            raise ValueError(f"ambiguous usage identity: {usage.usage_id}")
        by_usage[key] = usage
    usage_keys = set(by_usage)
    relevant = tuple(c for c in costs if c.kind is cost_kind
                     and (c.provider_id, c.usage_id) in usage_keys
                     and c.token_id == by_usage[(c.provider_id, c.usage_id)].token_id
                     and c.model == by_usage[(c.provider_id, c.usage_id)].model)
    currencies = {c.currency for c in relevant}
    covered_usage_ids = {(c.provider_id, c.usage_id) for c in relevant}
    available = (billing_mode is BillingMode.API_USAGE and bool(relevant)
                 and covered_usage_ids == usage_keys and len(currencies) == 1)
    cost_denominator = sum((c.amount for c in relevant), Decimal(0)) if available else None
    costs_by_usage = {}
    if available:
        for cost in relevant:
            key = (cost.provider_id, cost.usage_id)
            costs_by_usage[key] = costs_by_usage.get(key, Decimal(0)) + cost.amount
    rows = []
    for key, items in sorted(groups.items(), key=lambda item: tuple("" if v is None else str(v) for v in item[0])):
        token_total = sum(u.total_tokens for u in items)
        cost_total = sum((costs_by_usage.get((u.provider_id, u.usage_id), Decimal(0)) for u in items), Decimal(0)) if available else None
        relation = ("task_share_of_model" if direction == "model_to_attribution"
                    else "model_share_of_task")
        rows.append(AttributionRow(
            *identity(key), token_total, token_denominator,
            Decimal(token_total) / Decimal(token_denominator) if token_denominator else None,
            cost_total, cost_denominator,
            cost_total / cost_denominator if available and cost_denominator else None,
            relation,
        ))
    return AttributionSummary(
        direction, billing_mode, cost_kind,
        CostShareStatus.AVAILABLE if available else CostShareStatus.UNAVAILABLE,
        next(iter(currencies)) if available else None, tuple(rows),
    )
