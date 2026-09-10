from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.contracts import (
    AuthorityMetadata,
    AuthoritySourceType,
    BillingMode,
    DailyTimeWindow,
    FreshnessPolicy,
    PriceDimension,
    PricingAuthorityRecord,
    PricingSnapshot,
    PricingTimeRule,
    PricingUnit,
    PricingWindowMode,
    SourceTag,
    SourceType,
)


PROVIDER_ID = "deepseek"
MODEL = "deepseek-v4-flash"
MODEL_VERSION = "DeepSeek-V4-Flash-0731"
CURRENCY = "CNY"
UNIT = PricingUnit.PER_1M_TOKENS
PRICING_TIMEZONE = "Asia/Shanghai"
PRICING_UTC_OFFSET_MINUTES = 8 * 60
PRICING_EFFECTIVE_FROM = datetime(2026, 8, 17, tzinfo=timezone(timedelta(hours=8)))
SOURCE_RETRIEVED_AT = datetime(2026, 8, 21, 12, 11, 45, 52468, tzinfo=timezone.utc)
OFFICIAL_PRICING_SOURCE = (
    "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"
)
OFFICIAL_EFFECTIVE_DATE_SOURCE = "https://api-docs.deepseek.com/zh-cn/updates/"
EVIDENCE_REFERENCE = (
    ".nexa/evidence/pricing/"
    "NEXA-AI-ASSET-DEEPSEEK-V4-FLASH-PRICING-AUTHORITY-001.json"
)

PEAK_WINDOWS = (
    DailyTimeWindow(9 * 60, 12 * 60),
    DailyTimeWindow(14 * 60, 18 * 60),
)

_PRICES = {
    "peak": {
        PriceDimension.CACHE_READ: Decimal("0.10"),
        PriceDimension.INPUT: Decimal("3.0"),
        PriceDimension.OUTPUT: Decimal("9.0"),
    },
    "offpeak": {
        PriceDimension.CACHE_READ: Decimal("0.05"),
        PriceDimension.INPUT: Decimal("1.5"),
        PriceDimension.OUTPUT: Decimal("4.5"),
    },
}


def deepseek_v4_flash_pricing_authorities() -> tuple[PricingAuthorityRecord, ...]:
    """Return the frozen official peak/off-peak authority records.

    The two records reuse the canonical Pricing Authority and differ only by
    their explicit recurring wall-clock selection rule and official prices.
    No network access or provider call occurs here.
    """

    source = SourceTag(
        SourceType.MANUAL,
        EVIDENCE_REFERENCE,
        SOURCE_RETRIEVED_AT,
    )
    metadata = AuthorityMetadata(
        authority_source_type=AuthoritySourceType.OFFICIAL_PROVIDER,
        official_source=OFFICIAL_PRICING_SOURCE,
        fetched_at=SOURCE_RETRIEVED_AT,
        last_verified_at=SOURCE_RETRIEVED_AT,
        freshness_policy=FreshnessPolicy(timedelta(days=1)),
        source=source,
    )
    records = []
    for tier, mode in (
        ("peak", PricingWindowMode.INCLUDE),
        ("offpeak", PricingWindowMode.EXCLUDE),
    ):
        components = tuple(
            PricingSnapshot(
                provider_id=PROVIDER_ID,
                model=MODEL,
                price_per_unit=_PRICES[tier][dimension],
                unit=UNIT,
                currency=CURRENCY,
                effective_at=PRICING_EFFECTIVE_FROM,
                source=source,
                price_dimension=dimension,
            )
            for dimension in (
                PriceDimension.INPUT,
                PriceDimension.CACHE_READ,
                PriceDimension.OUTPUT,
            )
        )
        records.append(PricingAuthorityRecord(
            authority_id=f"deepseek-v4-flash-official-2026-08-17:{tier}",
            provider_id=PROVIDER_ID,
            model=MODEL,
            billing_mode=BillingMode.API_USAGE,
            effective_from=PRICING_EFFECTIVE_FROM,
            components=components,
            metadata=metadata,
            pricing_tier=tier,
            time_rule=PricingTimeRule(
                PRICING_TIMEZONE, PRICING_UTC_OFFSET_MINUTES, PEAK_WINDOWS, mode
            ),
        ))
    return tuple(records)
