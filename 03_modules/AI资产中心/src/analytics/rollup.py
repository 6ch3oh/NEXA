from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

from src.contracts import CostKind, CostRecord, PriceDimension, SourceTag, UsageRecord
from src.query import LookupStatus, QueryService

from .health import summarize_balance_health
from .models import (
    BalanceHealthStatus,
    Completeness,
    CostRollup,
    Period,
    ProviderAssetSummary,
    TokenAssetSummary,
    UsageRollup,
    W_ACTUAL_COST_MISSING,
    W_ESTIMATED_COST_MISSING,
    W_MIXED_CURRENCIES,
    W_NO_TOKENS,
    W_PRICING_AMBIGUOUS,
    W_PRICING_MISSING,
    W_PROVIDER_AMBIGUOUS,
    W_PROVIDER_MISSING,
    W_TOKEN_AMBIGUOUS,
    W_TOKEN_MISSING,
    W_USAGE_MISSING,
    _require_aware,
)
from .provenance import summarize_provenance


def daily_period(moment: datetime) -> Period:
    _require_aware(moment, "moment")
    start = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    return Period(start=start, end=start + timedelta(days=1))


def monthly_period(moment: datetime) -> Period:
    _require_aware(moment, "moment")
    start = moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return Period(start=start, end=end)


def rollup_usage(
    query: QueryService,
    provider_id: str,
    period: Period,
    *,
    token_id: str | None = None,
    model: str | None = None,
) -> UsageRollup | None:
    """Aggregate existing UsageRecords over a half-open period.

    ``None`` means no observations. A zero-valued UsageRecord produces a
    rollup with ``record_count > 0`` and zero counters, preserving the semantic
    difference between missing and observed zero.
    """

    records = tuple(
        item
        for item in query.list_usage(
            provider_id=provider_id,
            token_id=token_id,
            model=model,
            start=period.start,
        )
        if item.observed_at < period.end
    )
    if not records:
        return None
    return UsageRollup(
        provider_id=provider_id,
        token_id=token_id,
        model=model,
        period_start=period.start,
        period_end=period.end,
        input_tokens=sum(item.input_tokens for item in records),
        output_tokens=sum(item.output_tokens for item in records),
        cache_read_tokens=sum(item.cache_read_tokens for item in records),
        cache_write_tokens=sum(item.cache_write_tokens for item in records),
        total_tokens=sum(item.total_tokens for item in records),
        record_count=len(records),
        completeness=Completeness.COMPLETE,
        warnings=(),
        provenance=summarize_provenance(item.source for item in records),
    )


def rollup_costs(
    query: QueryService,
    provider_id: str,
    period: Period,
    *,
    token_id: str | None = None,
    model: str | None = None,
) -> tuple[CostRollup, ...]:
    """Aggregate existing CostRecords by currency without FX conversion."""

    records = tuple(
        item
        for item in query.list_costs(
            provider_id=provider_id,
            token_id=token_id,
            model=model,
            start=period.start,
        )
        if item.occurred_at < period.end
    )
    if not records:
        return ()

    grouped: dict[str, list[CostRecord]] = defaultdict(list)
    for record in records:
        grouped[record.currency].append(record)
    mixed = len(grouped) > 1
    rollups: list[CostRollup] = []
    for currency in sorted(grouped):
        currency_records = grouped[currency]
        actual = [item for item in currency_records if item.kind is CostKind.ACTUAL]
        estimated = [item for item in currency_records if item.kind is CostKind.ESTIMATED]
        warnings: list[str] = []
        if not actual:
            warnings.append(W_ACTUAL_COST_MISSING)
        if not estimated:
            warnings.append(W_ESTIMATED_COST_MISSING)
        if mixed:
            warnings.append(W_MIXED_CURRENCIES)
        rollups.append(
            CostRollup(
                provider_id=provider_id,
                token_id=token_id,
                model=model,
                currency=currency,
                period_start=period.start,
                period_end=period.end,
                actual_amount=sum((item.amount for item in actual), Decimal(0)) if actual else None,
                estimated_amount=(
                    sum((item.amount for item in estimated), Decimal(0)) if estimated else None
                ),
                actual_record_count=len(actual),
                estimated_record_count=len(estimated),
                completeness=(
                    Completeness.COMPLETE
                    if actual and estimated and not mixed
                    else Completeness.INCOMPLETE
                ),
                warnings=tuple(warnings),
                provenance=summarize_provenance(item.source for item in currency_records),
            )
        )
    return tuple(rollups)


def summarize_provider(
    query: QueryService,
    provider_id: str,
    period: Period,
    *,
    as_of: datetime,
    stale_after: timedelta | None = None,
) -> ProviderAssetSummary:
    provider_result = query.lookup_provider(provider_id)
    provider = provider_result.record if provider_result.status is LookupStatus.FOUND else None
    warnings: list[str] = []
    if provider_result.status is LookupStatus.MISSING:
        warnings.append(W_PROVIDER_MISSING)
    elif provider_result.status is LookupStatus.AMBIGUOUS:
        warnings.append(W_PROVIDER_AMBIGUOUS)

    tokens = query.list_tokens(provider_id)
    if not tokens:
        warnings.append(W_NO_TOKENS)
    balance = summarize_balance_health(
        query,
        provider_id,
        as_of=as_of,
        stale_after=stale_after,
    )
    warnings.extend(balance.warnings)
    usage = rollup_usage(query, provider_id, period)
    if usage is None:
        warnings.append(W_USAGE_MISSING)
    costs = rollup_costs(query, provider_id, period)
    actual_available = any(item.actual_record_count for item in costs)
    estimated_available = any(item.estimated_record_count for item in costs)
    if not actual_available:
        warnings.append(W_ACTUAL_COST_MISSING)
    if not estimated_available:
        warnings.append(W_ESTIMATED_COST_MISSING)
    if len(costs) > 1:
        warnings.append(W_MIXED_CURRENCIES)

    pricing_available, pricing_ambiguous = _pricing_state(query, provider_id)
    if pricing_ambiguous:
        warnings.append(W_PRICING_AMBIGUOUS)
    elif not pricing_available:
        warnings.append(W_PRICING_MISSING)

    sources: list[SourceTag] = []
    if provider is not None:
        sources.append(provider.source)
    sources.extend(item.source for item in tokens)
    sources.extend(balance.provenance.underlying_sources)
    if usage is not None:
        sources.extend(usage.provenance.underlying_sources)
    for item in costs:
        sources.extend(item.provenance.underlying_sources)
    sources.extend(item.source for item in query.pricing if item.provider_id == provider_id)
    normalized_warnings = tuple(sorted(set(warnings)))
    return ProviderAssetSummary(
        provider_id=provider_id,
        provider=provider,
        token_count=len(tokens),
        latest_balance=balance,
        usage_rollup=usage,
        cost_rollups=costs,
        pricing_available=pricing_available,
        actual_cost_available=actual_available,
        estimated_cost_available=estimated_available,
        completeness=(
            Completeness.COMPLETE if not normalized_warnings else Completeness.INCOMPLETE
        ),
        warnings=normalized_warnings,
        provenance=summarize_provenance(sources),
    )


def summarize_token(
    query: QueryService,
    provider_id: str,
    token_id: str,
    period: Period,
    *,
    as_of: datetime,
    stale_after: timedelta | None = None,
) -> TokenAssetSummary:
    matches = tuple(item for item in query.list_tokens(provider_id) if item.id == token_id)
    token = matches[0] if len(matches) == 1 else None
    warnings: list[str] = []
    if not matches:
        warnings.append(W_TOKEN_MISSING)
    elif len(matches) > 1:
        warnings.append(W_TOKEN_AMBIGUOUS)

    balance = summarize_balance_health(
        query,
        provider_id,
        token_id=token_id,
        as_of=as_of,
        stale_after=stale_after,
    )
    warnings.extend(balance.warnings)
    usage = rollup_usage(query, provider_id, period, token_id=token_id)
    if usage is None:
        warnings.append(W_USAGE_MISSING)
    costs = rollup_costs(query, provider_id, period, token_id=token_id)
    actual_available = any(item.actual_record_count for item in costs)
    estimated_available = any(item.estimated_record_count for item in costs)
    if not actual_available:
        warnings.append(W_ACTUAL_COST_MISSING)
    if not estimated_available:
        warnings.append(W_ESTIMATED_COST_MISSING)
    if len(costs) > 1:
        warnings.append(W_MIXED_CURRENCIES)

    pricing_available, pricing_ambiguous = _pricing_state(query, provider_id)
    if pricing_ambiguous:
        warnings.append(W_PRICING_AMBIGUOUS)
    elif not pricing_available:
        warnings.append(W_PRICING_MISSING)

    sources: list[SourceTag] = []
    if token is not None:
        sources.append(token.source)
    sources.extend(balance.provenance.underlying_sources)
    if usage is not None:
        sources.extend(usage.provenance.underlying_sources)
    for item in costs:
        sources.extend(item.provenance.underlying_sources)
    normalized_warnings = tuple(sorted(set(warnings)))
    return TokenAssetSummary(
        token_id=token_id,
        token=token,
        provider_id=provider_id,
        latest_balance=balance,
        usage_rollup=usage,
        cost_rollups=costs,
        actual_cost_available=actual_available,
        estimated_cost_available=estimated_available,
        completeness=(
            Completeness.COMPLETE if not normalized_warnings else Completeness.INCOMPLETE
        ),
        warnings=normalized_warnings,
        provenance=summarize_provenance(sources),
    )


def _pricing_state(query: QueryService, provider_id: str) -> tuple[bool, bool]:
    records = tuple(item for item in query.pricing if item.provider_id == provider_id)
    if not records:
        return False, False
    found = False
    ambiguous = False
    identities = sorted({(item.model, item.price_dimension) for item in records})
    for model, dimension in identities:
        result = query.resolve_pricing(provider_id, model, dimension)
        if result.status is LookupStatus.FOUND:
            found = True
        elif result.status is LookupStatus.AMBIGUOUS:
            ambiguous = True
    return found, ambiguous
