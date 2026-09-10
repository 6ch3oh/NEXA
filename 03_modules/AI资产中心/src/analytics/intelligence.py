from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

from src.contracts import AttributionStatus, CostKind, CostRecord, UsageRecord
from src.query import QueryService

from .models import Period, ProvenanceSummary
from .provenance import summarize_provenance


UNATTRIBUTED = "UNATTRIBUTED"


class RankingScope(str, Enum):
    MODEL = "model"
    TASK = "task"
    PROJECT = "project"


@dataclass(frozen=True)
class TokenRankingRow:
    rank: int
    scope: RankingScope
    key: str
    provider_id: str | None
    project_id: str | None
    task_id: str | None
    model: str | None
    attribution_status: AttributionStatus
    token_numerator: int
    token_denominator: int
    token_share: Decimal | None


@dataclass(frozen=True)
class CostRankingRow:
    rank: int
    scope: RankingScope
    key: str
    provider_id: str | None
    project_id: str | None
    task_id: str | None
    model: str | None
    attribution_status: AttributionStatus
    kind: CostKind
    currency: str
    cost_numerator: Decimal
    cost_denominator: Decimal
    cost_share: Decimal | None


@dataclass(frozen=True)
class AttributionCoverage:
    total_records: int
    attributed_records: int
    unattributed_records: int
    total_tokens: int
    attributed_tokens: int
    unattributed_tokens: int
    attribution_coverage: Decimal | None
    unattributed_ratio: Decimal | None


@dataclass(frozen=True)
class ResourceIntelligence:
    period: Period
    coverage: AttributionCoverage
    model_token_ranking: tuple[TokenRankingRow, ...]
    task_token_ranking: tuple[TokenRankingRow, ...]
    project_token_ranking: tuple[TokenRankingRow, ...]
    model_actual_cost_ranking: tuple[CostRankingRow, ...]
    model_estimated_cost_ranking: tuple[CostRankingRow, ...]
    task_actual_cost_ranking: tuple[CostRankingRow, ...]
    task_estimated_cost_ranking: tuple[CostRankingRow, ...]
    project_actual_cost_ranking: tuple[CostRankingRow, ...]
    project_estimated_cost_ranking: tuple[CostRankingRow, ...]
    provenance: ProvenanceSummary


def build_resource_intelligence(query: QueryService, period: Period) -> ResourceIntelligence:
    if not isinstance(query, QueryService):
        raise TypeError("query must be a QueryService")
    usages = tuple(item for item in query.usages if period.start <= item.observed_at < period.end)
    costs = tuple(item for item in query.costs if period.start <= item.occurred_at < period.end)
    by_usage = _usage_index(usages)
    linked_costs = tuple(
        (cost, by_usage[(cost.provider_id, cost.usage_id)])
        for cost in costs
        if cost.usage_id is not None and (cost.provider_id, cost.usage_id) in by_usage
        and _cost_matches_usage(cost, by_usage[(cost.provider_id, cost.usage_id)])
    )
    sources = [item.source for item in usages]
    sources.extend(item.source for item in costs)
    return ResourceIntelligence(
        period=period,
        coverage=_coverage(usages),
        model_token_ranking=_token_ranking(usages, RankingScope.MODEL),
        task_token_ranking=_token_ranking(usages, RankingScope.TASK),
        project_token_ranking=_token_ranking(usages, RankingScope.PROJECT),
        model_actual_cost_ranking=_model_cost_ranking(costs, by_usage, CostKind.ACTUAL),
        model_estimated_cost_ranking=_model_cost_ranking(costs, by_usage, CostKind.ESTIMATED),
        task_actual_cost_ranking=_cost_ranking(linked_costs, RankingScope.TASK, CostKind.ACTUAL),
        task_estimated_cost_ranking=_cost_ranking(linked_costs, RankingScope.TASK, CostKind.ESTIMATED),
        project_actual_cost_ranking=_cost_ranking(linked_costs, RankingScope.PROJECT, CostKind.ACTUAL),
        project_estimated_cost_ranking=_cost_ranking(linked_costs, RankingScope.PROJECT, CostKind.ESTIMATED),
        provenance=summarize_provenance(sources),
    )


def _usage_index(usages: tuple[UsageRecord, ...]) -> dict[tuple[str, str], UsageRecord]:
    result = {}
    for usage in usages:
        key = (usage.provider_id, usage.usage_id)
        if key in result and result[key] != usage:
            raise ValueError(f"ambiguous usage identity: {usage.usage_id}")
        result[key] = usage
    return result


def _cost_matches_usage(cost: CostRecord, usage: UsageRecord) -> bool:
    return cost.token_id == usage.token_id and cost.model == usage.model


def _coverage(usages: tuple[UsageRecord, ...]) -> AttributionCoverage:
    attributed = tuple(item for item in usages if item.attribution.status is AttributionStatus.ATTRIBUTED)
    total_tokens = sum(item.total_tokens for item in usages)
    attributed_tokens = sum(item.total_tokens for item in attributed)
    unattributed_tokens = total_tokens - attributed_tokens
    return AttributionCoverage(
        total_records=len(usages), attributed_records=len(attributed),
        unattributed_records=len(usages) - len(attributed), total_tokens=total_tokens,
        attributed_tokens=attributed_tokens, unattributed_tokens=unattributed_tokens,
        attribution_coverage=(Decimal(attributed_tokens) / Decimal(total_tokens) if total_tokens else None),
        unattributed_ratio=(Decimal(unattributed_tokens) / Decimal(total_tokens) if total_tokens else None),
    )


def _identity(usage: UsageRecord, scope: RankingScope):
    a = usage.attribution
    if scope is RankingScope.MODEL:
        key = f"{usage.provider_id}:{usage.model or UNATTRIBUTED}"
        return key, usage.provider_id, None, None, usage.model, a.status
    if scope is RankingScope.TASK:
        task = a.task_id or UNATTRIBUTED
        project = a.project_id if a.task_id is not None else None
        return f"{project or UNATTRIBUTED}:{task}", None, project, a.task_id, None, a.status
    project = a.project_id or UNATTRIBUTED
    return project, None, a.project_id, None, None, a.status


def _token_ranking(usages: tuple[UsageRecord, ...], scope: RankingScope):
    grouped = defaultdict(int)
    details = {}
    for usage in usages:
        identity = _identity(usage, scope)
        grouped[identity[0]] += usage.total_tokens
        details[identity[0]] = _merge_identity(details.get(identity[0]), identity)
    denominator = sum(grouped.values())
    ordered = sorted(grouped, key=lambda key: (-grouped[key], key))
    return tuple(TokenRankingRow(
        rank=index, scope=scope, key=key, provider_id=details[key][1],
        project_id=details[key][2], task_id=details[key][3], model=details[key][4],
        attribution_status=details[key][5], token_numerator=grouped[key],
        token_denominator=denominator,
        token_share=Decimal(grouped[key]) / Decimal(denominator) if denominator else None,
    ) for index, key in enumerate(ordered, 1))


def _cost_ranking(linked, scope: RankingScope, kind: CostKind):
    selected = tuple((cost, usage) for cost, usage in linked if cost.kind is kind)
    grouped = defaultdict(lambda: Decimal(0))
    details = {}
    for cost, usage in selected:
        identity = _identity(usage, scope)
        key = (cost.currency, identity[0])
        grouped[key] += cost.amount
        details[key] = _merge_identity(details.get(key), identity)
    denominators = defaultdict(lambda: Decimal(0))
    for (currency, _), amount in grouped.items(): denominators[currency] += amount
    ordered = sorted(grouped, key=lambda key: (key[0], -grouped[key], key[1]))
    ranks = defaultdict(int)
    result = []
    for key in ordered:
        currency, identity_key = key; ranks[currency] += 1; identity = details[key]
        denominator = denominators[currency]
        result.append(CostRankingRow(
            ranks[currency], scope, identity_key, identity[1], identity[2], identity[3],
            identity[4], identity[5], kind, currency, grouped[key], denominator,
            grouped[key] / denominator if denominator else None,
        ))
    return tuple(result)


def _model_cost_ranking(costs, usages, kind: CostKind):
    grouped = defaultdict(lambda: Decimal(0))
    details = {}
    for cost in costs:
        if cost.kind is not kind:
            continue
        linked = usages.get((cost.provider_id, cost.usage_id)) if cost.usage_id is not None else None
        if linked is not None and not _cost_matches_usage(cost, linked):
            continue
        identity_key = f"{cost.provider_id}:{cost.model or UNATTRIBUTED}"
        key = (cost.currency, identity_key)
        grouped[key] += cost.amount
        status = (linked.attribution.status if linked is not None and _cost_matches_usage(cost, linked)
                  else AttributionStatus.UNATTRIBUTED)
        identity = (identity_key, cost.provider_id, None, None, cost.model, status)
        details[key] = _merge_identity(details.get(key), identity)
    denominators = defaultdict(lambda: Decimal(0))
    for (currency, _), amount in grouped.items(): denominators[currency] += amount
    ordered = sorted(grouped, key=lambda key: (key[0], -grouped[key], key[1]))
    ranks = defaultdict(int); result = []
    for key in ordered:
        currency, identity_key = key; ranks[currency] += 1; identity = details[key]
        denominator = denominators[currency]
        result.append(CostRankingRow(
            ranks[currency], RankingScope.MODEL, identity_key, identity[1], None, None,
            identity[4], identity[5], kind, currency, grouped[key], denominator,
            grouped[key] / denominator if denominator else None,
        ))
    return tuple(result)


def _merge_identity(prior, current):
    if prior is None:
        return current
    if prior[:5] != current[:5]:
        raise ValueError("ranking identity details are inconsistent")
    status = (prior[5] if prior[5] is current[5] else AttributionStatus.UNATTRIBUTED)
    return (*prior[:5], status)
