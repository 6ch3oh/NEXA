from __future__ import annotations

from dataclasses import dataclass
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

PROVIDER_ID = "provider-store-a"
OTHER_PROVIDER_ID = "provider-store-b"
MODEL = "model-store-a"


def source(source_type: SourceType, reference: str, captured_at: datetime = T0) -> SourceTag:
    return SourceTag(
        source_type=source_type,
        source_reference=reference,
        captured_at=captured_at,
    )


def provider(provider_id: str = PROVIDER_ID, **overrides) -> Provider:
    base = dict(
        id=provider_id,
        key="store-provider",
        display_name=f"Store Provider {provider_id}",
        category=ProviderCategory.LLM,
        status=ProviderStatus.ACTIVE,
        source=source(SourceType.LOCAL_CONFIG, f"fixture:provider:{provider_id}"),
    )
    base.update(overrides)
    return Provider(**base)


def token(token_id: str = "token-store-a", provider_id: str = PROVIDER_ID, **overrides) -> Token:
    base = dict(
        id=token_id,
        provider_id=provider_id,
        label=f"Store Token {token_id}",
        status=TokenStatus.ACTIVE,
        masked_identifier="fp:sha256:" + "a" * 64,
        secret_ref=f"vault://nexa/{provider_id}/{token_id}",
        source=source(SourceType.LOCAL_CONFIG, f"fixture:token:{token_id}"),
    )
    base.update(overrides)
    return Token(**base)


def balance(
    value: str,
    observed_at: datetime,
    *,
    provider_id: str = PROVIDER_ID,
    token_id: str | None = None,
    **overrides,
) -> BalanceSnapshot:
    base = dict(
        provider_id=provider_id,
        token_id=token_id,
        value=Decimal(value),
        unit=BalanceUnit.USD,
        observed_at=observed_at,
        source=source(SourceType.REMOTE_PROVIDER_API, "fixture:balance", observed_at),
    )
    base.update(overrides)
    return BalanceSnapshot(**base)


def usage(usage_id: str = "usage-store-a", **overrides) -> UsageRecord:
    base = dict(
        usage_id=usage_id,
        provider_id=PROVIDER_ID,
        token_id="token-store-a",
        model=MODEL,
        input_tokens=1_000,
        output_tokens=500,
        cache_read_tokens=250,
        cache_write_tokens=0,
        observed_at=T2,
        source=source(SourceType.REMOTE_PROVIDER_API, f"fixture:usage:{usage_id}", T2),
    )
    base.update(overrides)
    return UsageRecord(**base)


def price(
    dimension: PriceDimension,
    amount: str,
    *,
    effective_at: datetime = T1,
    **overrides,
) -> PricingSnapshot:
    base = dict(
        provider_id=PROVIDER_ID,
        token_id=None,
        model=MODEL,
        price_per_unit=Decimal(amount),
        unit=PricingUnit.PER_1M_TOKENS,
        currency="USD",
        effective_at=effective_at,
        price_dimension=dimension,
        source=source(
            SourceType.LOCAL_CONFIG,
            f"fixture:pricing:{dimension.value}",
            effective_at,
        ),
    )
    base.update(overrides)
    return PricingSnapshot(**base)


def cost(kind: CostKind, amount: str, **overrides) -> CostRecord:
    base = dict(
        provider_id=PROVIDER_ID,
        token_id="token-store-a",
        model=MODEL,
        amount=Decimal(amount),
        currency="USD",
        occurred_at=T2,
        cost_basis="provider_reported" if kind is CostKind.ACTUAL else "usage_pricing_calculation",
        kind=kind,
        source=source(
            SourceType.REMOTE_PROVIDER_API
            if kind is CostKind.ACTUAL
            else SourceType.DERIVED_CALCULATED,
            f"fixture:cost:{kind.value}",
            T2,
        ),
    )
    base.update(overrides)
    return CostRecord(**base)


@dataclass(frozen=True)
class StoreFixture:
    providers: tuple[Provider, ...]
    tokens: tuple[Token, ...]
    balances: tuple[BalanceSnapshot, ...]
    usages: tuple[UsageRecord, ...]
    pricing: tuple[PricingSnapshot, ...]
    costs: tuple[CostRecord, ...]


def complete_fixture() -> StoreFixture:
    return StoreFixture(
        providers=(provider(), provider(OTHER_PROVIDER_ID)),
        tokens=(token(), token("token-store-b"), token("token-other", OTHER_PROVIDER_ID)),
        balances=(
            balance("10.00", T1),
            balance("8.50", T2),
            balance("4.25", T2, token_id="token-store-a"),
        ),
        usages=(usage(),),
        pricing=(
            price(PriceDimension.INPUT, "0.123456789"),
            price(PriceDimension.OUTPUT, "0.987654321"),
            price(PriceDimension.CACHE_READ, "0.000000123"),
        ),
        costs=(
            cost(CostKind.ACTUAL, "0.123456789"),
            cost(CostKind.ESTIMATED, "0.000987654321"),
        ),
    )
