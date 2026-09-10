from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

from src.analytics import (
    Completeness,
    Period,
    ProvenanceSummary,
    W_ACTUAL_COST_MISSING,
    W_BALANCE_AMBIGUOUS,
    W_BALANCE_MISSING,
    W_BALANCE_STALE,
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
    summarize_provider,
    summarize_token,
)
from src.contracts import SourceTag, SourceType
from src.query import QueryService

from .models import (
    AI_ASSET_CONSUMPTION_SCHEMA_VERSION,
    BalanceConsumptionView,
    ConsumptionCompleteness,
    CurrencyCostView,
    PortfolioConsumptionData,
    PortfolioConsumptionView,
    ProviderConsumptionData,
    ProviderConsumptionView,
    ProviderIdentityView,
    ProvenanceView,
    SourceProvenanceView,
    TokenConsumptionData,
    TokenConsumptionView,
    TokenIdentityView,
    UsageConsumptionView,
    WarningCode,
)

_WARNING_MAP = {
    W_PROVIDER_MISSING: WarningCode.PROVIDER_MISSING,
    W_PROVIDER_AMBIGUOUS: WarningCode.AMBIGUOUS_DATA,
    W_TOKEN_MISSING: WarningCode.TOKEN_MISSING,
    W_TOKEN_AMBIGUOUS: WarningCode.AMBIGUOUS_DATA,
    W_NO_TOKENS: WarningCode.NO_TOKENS,
    W_BALANCE_MISSING: WarningCode.BALANCE_MISSING,
    W_BALANCE_STALE: WarningCode.BALANCE_STALE,
    W_BALANCE_AMBIGUOUS: WarningCode.AMBIGUOUS_DATA,
    W_PRICING_MISSING: WarningCode.PRICING_MISSING,
    W_PRICING_AMBIGUOUS: WarningCode.AMBIGUOUS_DATA,
    W_USAGE_MISSING: WarningCode.USAGE_MISSING,
    W_ACTUAL_COST_MISSING: WarningCode.ACTUAL_COST_MISSING,
    W_ESTIMATED_COST_MISSING: WarningCode.ESTIMATED_COST_MISSING,
    W_MIXED_CURRENCIES: WarningCode.MIXED_CURRENCIES,
}


def build_provider_view(
    query: QueryService,
    provider_id: str,
    period: Period,
    *,
    generated_at: datetime,
    as_of: datetime,
    stale_after: timedelta | None = None,
) -> ProviderConsumptionView:
    _validate_builder_inputs(query, generated_at, as_of)
    summary = summarize_provider(
        query, provider_id, period, as_of=as_of, stale_after=stale_after
    )
    token_views = tuple(
        build_token_view(
            query,
            provider_id,
            token.id,
            period,
            generated_at=generated_at,
            as_of=as_of,
            stale_after=stale_after,
        )
        for token in query.list_tokens(provider_id)
    )
    return ProviderConsumptionView(
        schema_version=AI_ASSET_CONSUMPTION_SCHEMA_VERSION,
        generated_at=generated_at,
        data=ProviderConsumptionData(
            provider=(
                ProviderIdentityView(
                    id=summary.provider.id,
                    key=summary.provider.key,
                    display_name=summary.provider.display_name,
                    category=summary.provider.category,
                    status=summary.provider.status,
                )
                if summary.provider is not None
                else None
            ),
            tokens=token_views,
            latest_balance=_balance_view(summary.latest_balance),
            usage=_usage_view(summary.usage_rollup),
            actual_cost_by_currency=_cost_views(summary.cost_rollups, actual=True),
            estimated_cost_by_currency=_cost_views(summary.cost_rollups, actual=False),
            pricing_available=summary.pricing_available,
            provenance=_provenance_view(summary.provenance),
        ),
        completeness=_completeness(summary.completeness, summary.provider is None, summary.warnings),
        warnings=_warning_codes(summary.warnings),
    )


def build_token_view(
    query: QueryService,
    provider_id: str,
    token_id: str,
    period: Period,
    *,
    generated_at: datetime,
    as_of: datetime,
    stale_after: timedelta | None = None,
) -> TokenConsumptionView:
    _validate_builder_inputs(query, generated_at, as_of)
    summary = summarize_token(
        query, provider_id, token_id, period, as_of=as_of, stale_after=stale_after
    )
    return TokenConsumptionView(
        schema_version=AI_ASSET_CONSUMPTION_SCHEMA_VERSION,
        generated_at=generated_at,
        data=TokenConsumptionData(
            token=(
                TokenIdentityView(
                    id=summary.token.id,
                    provider_id=summary.token.provider_id,
                    label=summary.token.label,
                    status=summary.token.status,
                    masked_identifier=summary.token.masked_identifier,
                )
                if summary.token is not None
                else None
            ),
            provider_id=provider_id,
            latest_balance=_balance_view(summary.latest_balance),
            usage=_usage_view(summary.usage_rollup),
            actual_cost_by_currency=_cost_views(summary.cost_rollups, actual=True),
            estimated_cost_by_currency=_cost_views(summary.cost_rollups, actual=False),
            provenance=_provenance_view(summary.provenance),
        ),
        completeness=_completeness(summary.completeness, summary.token is None, summary.warnings),
        warnings=_warning_codes(summary.warnings),
    )


def build_portfolio_view(
    query: QueryService,
    period: Period,
    *,
    generated_at: datetime,
    as_of: datetime,
    stale_after: timedelta | None = None,
) -> PortfolioConsumptionView:
    _validate_builder_inputs(query, generated_at, as_of)
    provider_ids = sorted({provider.id for provider in query.providers})
    providers = tuple(
        build_provider_view(
            query,
            provider_id,
            period,
            generated_at=generated_at,
            as_of=as_of,
            stale_after=stale_after,
        )
        for provider_id in provider_ids
    )
    actual = _portfolio_costs(providers, actual=True)
    estimated = _portfolio_costs(providers, actual=False)
    currencies = tuple(sorted({item.currency for item in (*actual, *estimated)}))
    warnings = {warning for provider in providers for warning in provider.warnings}
    if len(currencies) > 1:
        warnings.add(WarningCode.MIXED_CURRENCIES)
    if not providers:
        warnings.add(WarningCode.PROVIDER_MISSING)
    completeness = (
        ConsumptionCompleteness.COMPLETE
        if providers and all(item.completeness is ConsumptionCompleteness.COMPLETE for item in providers)
        else ConsumptionCompleteness.INCOMPLETE
    )
    sources = tuple(
        source
        for provider in providers
        for source in provider.data.provenance.underlying_sources
    )
    return PortfolioConsumptionView(
        schema_version=AI_ASSET_CONSUMPTION_SCHEMA_VERSION,
        generated_at=generated_at,
        data=PortfolioConsumptionData(
            providers=providers,
            currencies_observed=currencies,
            actual_cost_by_currency=actual,
            estimated_cost_by_currency=estimated,
            total_usage=_portfolio_usage(providers, period),
            provenance=_provenance_from_views(sources),
        ),
        completeness=completeness,
        warnings=tuple(sorted(warnings, key=lambda item: item.value)),
    )


def _balance_view(summary) -> BalanceConsumptionView:
    balance = summary.balance
    return BalanceConsumptionView(
        health=summary.status,
        value=balance.value if balance is not None else None,
        unit=balance.unit if balance is not None else None,
        observed_at=balance.observed_at if balance is not None else None,
        source=_source_view(balance.source) if balance is not None else None,
    )


def _usage_view(rollup) -> UsageConsumptionView | None:
    if rollup is None:
        return None
    return UsageConsumptionView(
        period_start=rollup.period_start,
        period_end=rollup.period_end,
        input_tokens=rollup.input_tokens,
        output_tokens=rollup.output_tokens,
        cache_read_tokens=rollup.cache_read_tokens,
        cache_write_tokens=rollup.cache_write_tokens,
        total_tokens=rollup.total_tokens,
        record_count=rollup.record_count,
    )


def _cost_views(rollups, *, actual: bool) -> tuple[CurrencyCostView, ...]:
    result = []
    for rollup in rollups:
        amount = rollup.actual_amount if actual else rollup.estimated_amount
        count = rollup.actual_record_count if actual else rollup.estimated_record_count
        if amount is not None:
            result.append(CurrencyCostView(rollup.currency, amount, count))
    return tuple(sorted(result, key=lambda item: item.currency))


def _portfolio_costs(
    providers: tuple[ProviderConsumptionView, ...], *, actual: bool
) -> tuple[CurrencyCostView, ...]:
    amounts: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    counts: dict[str, int] = defaultdict(int)
    for provider in providers:
        records = (
            provider.data.actual_cost_by_currency
            if actual
            else provider.data.estimated_cost_by_currency
        )
        for item in records:
            amounts[item.currency] += item.amount
            counts[item.currency] += item.record_count
    return tuple(
        CurrencyCostView(currency, amounts[currency], counts[currency])
        for currency in sorted(amounts)
    )


def _portfolio_usage(
    providers: tuple[ProviderConsumptionView, ...], period: Period
) -> UsageConsumptionView | None:
    observed = tuple(item.data.usage for item in providers if item.data.usage is not None)
    if not observed:
        return None
    return UsageConsumptionView(
        period_start=period.start,
        period_end=period.end,
        input_tokens=sum(item.input_tokens for item in observed),
        output_tokens=sum(item.output_tokens for item in observed),
        cache_read_tokens=sum(item.cache_read_tokens for item in observed),
        cache_write_tokens=sum(item.cache_write_tokens for item in observed),
        total_tokens=sum(item.total_tokens for item in observed),
        record_count=sum(item.record_count for item in observed),
    )


def _source_view(source: SourceTag) -> SourceProvenanceView:
    if source.captured_at is None:
        raise ValueError("SourceTag captured_at is required for consumption")
    if source.captured_at.tzinfo is None or source.captured_at.utcoffset() is None:
        raise ValueError("SourceTag captured_at must be timezone-aware for consumption")
    return SourceProvenanceView(source.source_type, source.source_reference, source.captured_at)


def _provenance_view(summary: ProvenanceSummary) -> ProvenanceView:
    return _provenance_from_views(tuple(_source_view(item) for item in summary.underlying_sources))


def _provenance_from_views(sources: tuple[SourceProvenanceView, ...]) -> ProvenanceView:
    unique = set(sources)
    ordered = tuple(sorted(unique, key=lambda item: (
        item.source_type.value, item.source_reference or "", item.captured_at.isoformat()
    )))
    return ProvenanceView(SourceType.DERIVED_CALCULATED, ordered)


def _warning_codes(warnings: tuple[str, ...]) -> tuple[WarningCode, ...]:
    try:
        codes = {_WARNING_MAP[item] for item in warnings}
    except KeyError as exc:
        raise ValueError(f"unsupported analytics warning: {exc.args[0]}") from exc
    return tuple(sorted(codes, key=lambda item: item.value))


def _completeness(
    completeness: Completeness, identity_unknown: bool, warnings: tuple[str, ...]
) -> ConsumptionCompleteness:
    if identity_unknown and any("ambiguous" in item for item in warnings):
        return ConsumptionCompleteness.UNKNOWN
    return (
        ConsumptionCompleteness.COMPLETE
        if completeness is Completeness.COMPLETE
        else ConsumptionCompleteness.INCOMPLETE
    )


def _validate_builder_inputs(query: QueryService, generated_at: datetime, as_of: datetime) -> None:
    if not isinstance(query, QueryService):
        raise TypeError("query must be a QueryService")
    for name, value in (("generated_at", generated_at), ("as_of", as_of)):
        if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
            raise ValueError(f"{name} must be timezone-aware")
