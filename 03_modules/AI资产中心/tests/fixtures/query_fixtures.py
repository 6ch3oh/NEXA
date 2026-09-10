from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from src.contracts import (
    BalanceSnapshot,
    BalanceUnit,
    CostKind,
    CostRecord,
    PriceDimension,
    PricingSnapshot,
    PricingUnit,
    Provider,
    ProviderCategory,
    ProviderStatus,
    SourceTag,
    SourceType,
    Token,
    TokenStatus,
    UsageRecord,
)

T0 = datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)
T1 = datetime(2026, 8, 5, 0, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 8, 8, 0, 0, tzinfo=timezone.utc)
T3 = datetime(2026, 8, 9, 0, 0, tzinfo=timezone.utc)

PROVIDER_ID = "prov-0001"
OTHER_PROVIDER_ID = "prov-0002"
MODEL_A = "model-a"
MODEL_B = "model-b"


def source(source_type: SourceType = SourceType.MANUAL, reference: str = "test-fixture") -> SourceTag:
    return SourceTag(source_type=source_type, source_reference=reference)


def provider(provider_id: str = PROVIDER_ID, **overrides) -> Provider:
    base = dict(
        id=provider_id,
        key="openai",
        display_name="OpenAI",
        category=ProviderCategory.LLM,
        status=ProviderStatus.ACTIVE,
        source=source(SourceType.LOCAL_CONFIG, f"fixture:provider:{provider_id}"),
    )
    base.update(overrides)
    return Provider(**base)


def token(token_id: str, provider_id: str = PROVIDER_ID, **overrides) -> Token:
    base = dict(
        id=token_id,
        provider_id=provider_id,
        label=f"token-{token_id}",
        status=TokenStatus.ACTIVE,
        masked_identifier=f"fp:test-{token_id}-masked",
        source=source(SourceType.LOCAL_CONFIG, f"fixture:token:{token_id}"),
    )
    base.update(overrides)
    return Token(**base)


def balance(
    provider_id: str,
    value: str,
    *,
    token_id: str | None = None,
    observed_at: datetime,
    unit: BalanceUnit = BalanceUnit.USD,
    **overrides,
) -> BalanceSnapshot:
    base = dict(
        provider_id=provider_id,
        value=Decimal(value),
        unit=unit,
        observed_at=observed_at,
        token_id=token_id,
        source=source(
            SourceType.REMOTE_PROVIDER_API,
            f"fixture:balance:{token_id if token_id is not None else 'provider'}",
        ),
    )
    base.update(overrides)
    return BalanceSnapshot(**base)


def usage(
    usage_id: str,
    provider_id: str = PROVIDER_ID,
    *,
    observed_at: datetime,
    token_id: str | None = None,
    model: str = MODEL_A,
    input_tokens: int = 1000,
    output_tokens: int = 500,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    **overrides,
) -> UsageRecord:
    base = dict(
        usage_id=usage_id,
        provider_id=provider_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        observed_at=observed_at,
        token_id=token_id,
        model=model,
        source=source(SourceType.REMOTE_PROVIDER_API, f"fixture:usage:{usage_id}"),
    )
    base.update(overrides)
    return UsageRecord(**base)


def price(
    provider_id: str,
    model: str,
    dimension: PriceDimension,
    price_per_unit: str,
    *,
    effective_at: datetime,
    token_id: str | None = None,
    currency: str = "USD",
    unit: PricingUnit = PricingUnit.PER_1M_TOKENS,
    **overrides,
) -> PricingSnapshot:
    base = dict(
        provider_id=provider_id,
        model=model,
        price_per_unit=Decimal(price_per_unit),
        unit=unit,
        currency=currency,
        effective_at=effective_at,
        token_id=token_id,
        price_dimension=dimension,
        source=source(SourceType.LOCAL_CONFIG, f"fixture:price:{model}:{dimension.value}"),
    )
    base.update(overrides)
    return PricingSnapshot(**base)


def cost(
    provider_id: str,
    amount: str,
    *,
    occurred_at: datetime,
    kind: CostKind = CostKind.ACTUAL,
    cost_basis: str = "fixture:cost",
    token_id: str | None = None,
    model: str = MODEL_A,
    currency: str = "USD",
    **overrides,
) -> CostRecord:
    base = dict(
        provider_id=provider_id,
        amount=Decimal(amount),
        currency=currency,
        occurred_at=occurred_at,
        cost_basis=cost_basis,
        token_id=token_id,
        model=model,
        kind=kind,
        source=source(SourceType.REMOTE_PROVIDER_API, f"fixture:cost:{kind.value}"),
    )
    base.update(overrides)
    return CostRecord(**base)
