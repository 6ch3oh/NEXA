from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from src.contracts import (
    BalanceSnapshot, BalanceUnit, CostKind, CostRecord, PriceDimension,
    PricingSnapshot, PricingUnit, Provider, ProviderCategory, ProviderStatus,
    SourceTag, SourceType, Token, TokenStatus, UsageRecord,
)
from src.query import QueryService

JAN_1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
JAN_31 = datetime(2026, 1, 31, 12, tzinfo=timezone.utc)
FEB_1 = datetime(2026, 2, 1, tzinfo=timezone.utc)
FEB_2 = datetime(2026, 2, 2, tzinfo=timezone.utc)
FEB_15 = datetime(2026, 2, 15, tzinfo=timezone.utc)
MAR_1 = datetime(2026, 3, 1, tzinfo=timezone.utc)
PROVIDER_A = "provider-analytics-a"
PROVIDER_B = "provider-analytics-b"
TOKEN_A1 = "token-analytics-a1"
TOKEN_A2 = "token-analytics-a2"
TOKEN_A3 = "token-analytics-a3"
TOKEN_B1 = "token-analytics-b1"
MODEL_A = "analytics-model-a"


def source(source_type: SourceType, reference: str, captured_at: datetime = FEB_1) -> SourceTag:
    return SourceTag(source_type, f"synthetic:{reference}", captured_at)


def provider(provider_id: str = PROVIDER_A, **overrides) -> Provider:
    values = dict(id=provider_id, key=provider_id, display_name=f"Synthetic {provider_id}",
                  category=ProviderCategory.LLM, status=ProviderStatus.ACTIVE,
                  source=source(SourceType.LOCAL_CONFIG, f"provider:{provider_id}"))
    values.update(overrides)
    return Provider(**values)


def token(token_id: str, provider_id: str = PROVIDER_A, **overrides) -> Token:
    values = dict(id=token_id, provider_id=provider_id, label=f"Synthetic {token_id}",
                  status=TokenStatus.ACTIVE,
                  masked_identifier=f"fp:sha256:{'a' * 64}:{token_id}",
                  secret_ref=f"vault://synthetic/{token_id}",
                  source=source(SourceType.LOCAL_CONFIG, f"token:{token_id}"))
    values.update(overrides)
    return Token(**values)


def balance(value: str, observed_at: datetime, *, provider_id: str = PROVIDER_A,
            token_id: str | None = None, unit: BalanceUnit = BalanceUnit.USD,
            **overrides) -> BalanceSnapshot:
    values = dict(provider_id=provider_id, token_id=token_id, value=Decimal(value),
                  unit=unit, observed_at=observed_at,
                  source=source(SourceType.REMOTE_PROVIDER_API,
                                f"balance:{token_id or provider_id}:{observed_at.isoformat()}",
                                observed_at))
    values.update(overrides)
    return BalanceSnapshot(**values)


def usage(usage_id: str, observed_at: datetime, *, provider_id: str = PROVIDER_A,
          token_id: str | None = TOKEN_A1, model: str = MODEL_A,
          input_tokens: int = 10, output_tokens: int = 5,
          cache_read_tokens: int = 2, cache_write_tokens: int = 1,
          **overrides) -> UsageRecord:
    values = dict(usage_id=usage_id, provider_id=provider_id, token_id=token_id,
                  model=model, input_tokens=input_tokens, output_tokens=output_tokens,
                  cache_read_tokens=cache_read_tokens, cache_write_tokens=cache_write_tokens,
                  observed_at=observed_at,
                  source=source(SourceType.REMOTE_PROVIDER_API, f"usage:{usage_id}", observed_at))
    values.update(overrides)
    return UsageRecord(**values)


def cost(amount: str, occurred_at: datetime, kind: CostKind, *,
         provider_id: str = PROVIDER_A, token_id: str | None = TOKEN_A1,
         model: str | None = MODEL_A, currency: str = "USD", **overrides) -> CostRecord:
    values = dict(provider_id=provider_id, token_id=token_id, model=model,
                  amount=Decimal(amount), currency=currency, occurred_at=occurred_at,
                  cost_basis=f"synthetic:{kind.value}", kind=kind,
                  source=source(SourceType.DERIVED_CALCULATED, f"cost:{kind.value}", occurred_at))
    values.update(overrides)
    return CostRecord(**values)


def price(dimension: PriceDimension, amount: str, *, provider_id: str = PROVIDER_A,
          model: str = MODEL_A, effective_at: datetime = JAN_1,
          **overrides) -> PricingSnapshot:
    values = dict(provider_id=provider_id, token_id=None, model=model,
                  price_per_unit=Decimal(amount), unit=PricingUnit.PER_1M_TOKENS,
                  currency="USD", effective_at=effective_at, price_dimension=dimension,
                  source=source(SourceType.LOCAL_CONFIG, f"price:{dimension.value}", effective_at))
    values.update(overrides)
    return PricingSnapshot(**values)


def analytics_collections() -> dict[str, list]:
    return {
        "providers": [provider(PROVIDER_A), provider(PROVIDER_B)],
        "tokens": [token(TOKEN_A1), token(TOKEN_A2), token(TOKEN_A3), token(TOKEN_B1, PROVIDER_B)],
        "balances": [balance("100.00", JAN_1), balance("20.00", FEB_15, token_id=TOKEN_A1),
                     balance("5.00", FEB_1, token_id=TOKEN_A2, unit=BalanceUnit.CREDITS)],
        "usages": [usage("usage-jan", JAN_31),
                   usage("usage-feb-start", FEB_1, input_tokens=20, output_tokens=10),
                   usage("usage-feb-mid", FEB_15, cache_read_tokens=7, cache_write_tokens=3),
                   usage("usage-zero", FEB_2, token_id=TOKEN_A2, input_tokens=0,
                         output_tokens=0, cache_read_tokens=0, cache_write_tokens=0),
                   usage("usage-provider-b", FEB_2, provider_id=PROVIDER_B, token_id=TOKEN_B1)],
        "pricing": [price(PriceDimension.INPUT, "0.10"), price(PriceDimension.OUTPUT, "0.20"),
                    price(PriceDimension.CACHE_READ, "0.01")],
        "costs": [cost("0.100000001", FEB_1, CostKind.ACTUAL),
                  cost("0.200000002", FEB_2, CostKind.ACTUAL),
                  cost("0.000000003", FEB_15, CostKind.ESTIMATED),
                  cost("1.25", FEB_2, CostKind.ACTUAL, token_id=TOKEN_A2, currency="CNY"),
                  cost("9.99", FEB_2, CostKind.ACTUAL, provider_id=PROVIDER_B, token_id=TOKEN_B1)],
    }


def analytics_query(*, reverse: bool = False) -> QueryService:
    collections = analytics_collections()
    if reverse:
        collections = {name: list(reversed(items)) for name, items in collections.items()}
    return QueryService(**collections)
