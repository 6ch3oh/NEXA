from __future__ import annotations

from dataclasses import replace
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


JAN_1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
JAN_2 = datetime(2026, 1, 2, tzinfo=timezone.utc)
FEB_1 = datetime(2026, 2, 1, tzinfo=timezone.utc)
PROVIDER_A = "intake-provider-a"
PROVIDER_B = "intake-provider-b"
TOKEN_A = "intake-token-a"
MODEL = "intake-model"
SAFE_FINGERPRINT = f"fp:sha256:{'a' * 64}"


def source(
    reference: str,
    *,
    source_type: SourceType = SourceType.LOCAL_CONFIG,
    captured_at: datetime = JAN_1,
) -> SourceTag:
    return SourceTag(source_type, f"synthetic:intake:{reference}", captured_at)


def provider(provider_id: str = PROVIDER_A, **overrides) -> Provider:
    values = dict(
        id=provider_id,
        key=provider_id,
        display_name=f"Synthetic {provider_id}",
        category=ProviderCategory.LLM,
        status=ProviderStatus.ACTIVE,
        source=source(f"provider:{provider_id}"),
    )
    values.update(overrides)
    return Provider(**values)


def token(token_id: str = TOKEN_A, provider_id: str = PROVIDER_A, **overrides) -> Token:
    values = dict(
        id=token_id,
        provider_id=provider_id,
        label=f"Synthetic {token_id}",
        status=TokenStatus.ACTIVE,
        masked_identifier=SAFE_FINGERPRINT,
        secret_ref=f"vault://synthetic/{token_id}",
        source=source(f"token:{token_id}"),
    )
    values.update(overrides)
    return Token(**values)


def balance(**overrides) -> BalanceSnapshot:
    values = dict(
        provider_id=PROVIDER_A,
        token_id=TOKEN_A,
        value=Decimal("25.00"),
        unit=BalanceUnit.USD,
        observed_at=JAN_2,
        source=source("balance", captured_at=JAN_2),
    )
    values.update(overrides)
    return BalanceSnapshot(**values)


def usage(**overrides) -> UsageRecord:
    values = dict(
        usage_id="intake-usage-1",
        provider_id=PROVIDER_A,
        token_id=TOKEN_A,
        model=MODEL,
        input_tokens=1_000,
        output_tokens=500,
        cache_read_tokens=100,
        cache_write_tokens=0,
        observed_at=JAN_2,
        source=source("usage", source_type=SourceType.REMOTE_PROVIDER_API, captured_at=JAN_2),
    )
    values.update(overrides)
    return UsageRecord(**values)


def pricing(
    dimension: PriceDimension = PriceDimension.INPUT,
    amount: str = "0.40",
    **overrides,
) -> PricingSnapshot:
    values = dict(
        provider_id=PROVIDER_A,
        token_id=None,
        model=MODEL,
        price_per_unit=Decimal(amount),
        unit=PricingUnit.PER_1M_TOKENS,
        currency="USD",
        effective_at=JAN_1,
        price_dimension=dimension,
        source=source(f"pricing:{dimension.value}"),
    )
    values.update(overrides)
    return PricingSnapshot(**values)


def cost(kind: CostKind = CostKind.ACTUAL, **overrides) -> CostRecord:
    values = dict(
        provider_id=PROVIDER_A,
        token_id=TOKEN_A,
        model=MODEL,
        amount=Decimal("0.75" if kind is CostKind.ACTUAL else "0.00081"),
        currency="USD",
        occurred_at=JAN_2,
        cost_basis="synthetic:reported" if kind is CostKind.ACTUAL else "usage_pricing_calculation",
        kind=kind,
        source=source(
            f"cost:{kind.value}",
            source_type=(
                SourceType.REMOTE_PROVIDER_API
                if kind is CostKind.ACTUAL
                else SourceType.DERIVED_CALCULATED
            ),
            captured_at=JAN_2,
        ),
    )
    values.update(overrides)
    return CostRecord(**values)


def conflicting(record, **changes):
    return replace(record, **changes)
