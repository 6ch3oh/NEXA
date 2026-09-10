from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from src.authority import (
    AuthorityReadService,
    PublicAuthorityReadService,
    PublicAuthorityStatus,
    deepseek_v4_flash_pricing_authorities,
    get_public_contract_hash,
)
from src.authority.deepseek_v4_flash_pricing import (
    EVIDENCE_REFERENCE,
    MODEL,
    MODEL_VERSION,
    OFFICIAL_EFFECTIVE_DATE_SOURCE,
    OFFICIAL_PRICING_SOURCE,
    PRICING_EFFECTIVE_FROM,
    PRICING_TIMEZONE,
    SOURCE_RETRIEVED_AT,
)
from src.contracts import (
    AuthoritySourceType,
    BillingMode,
    PriceDimension,
    PricingUnit,
)
from src.domain.cost_calculator import (
    ComputationStatus,
    calculate_authoritative_cost,
)
from src.query import LookupStatus, QueryService
from src.store import SQLiteCanonicalStore
from tests.test_authority_contract_freeze import EXPECTED_CONTRACT_HASH
from tests.test_deepseek_real_pilot_002_evidence import (
    canonical_usage,
    load_evidence as load_pilot_evidence,
)


UTC8 = timezone(timedelta(hours=8))
MODULE_ROOT = Path(__file__).resolve().parents[1]
AUTHORITY_EVIDENCE_PATH = MODULE_ROOT / EVIDENCE_REFERENCE


def price(record, dimension):
    return next(
        component.price_per_unit
        for component in record.components
        if component.price_dimension is dimension
    )


class DeepSeekV4FlashOfficialAuthorityCase(unittest.TestCase):
    def setUp(self):
        self.records = deepseek_v4_flash_pricing_authorities()
        self.query = QueryService(pricing_authorities=self.records)

    def resolve(self, local_timestamp):
        return self.query.resolve_pricing_authority(
            "deepseek", MODEL, BillingMode.API_USAGE, as_of=local_timestamp
        )

    def test_official_provenance_identity_effective_time_and_frozen_evidence(self):
        evidence = json.loads(AUTHORITY_EVIDENCE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(evidence["source_url"], OFFICIAL_PRICING_SOURCE)
        self.assertEqual(
            evidence["effective_date_source_url"], OFFICIAL_EFFECTIVE_DATE_SOURCE
        )
        self.assertEqual(evidence["model"], MODEL)
        self.assertEqual(evidence["model_version"], MODEL_VERSION)
        self.assertEqual(
            datetime.fromisoformat(evidence["pricing_effective_from"]),
            PRICING_EFFECTIVE_FROM,
        )
        self.assertEqual(evidence["pricing_timezone"], PRICING_TIMEZONE)
        self.assertEqual(
            datetime.fromisoformat(evidence["source_retrieved_at"].replace("Z", "+00:00")),
            SOURCE_RETRIEVED_AT,
        )
        for record in self.records:
            self.assertEqual(record.provider_id, "deepseek")
            self.assertEqual(record.model, "deepseek-v4-flash")
            self.assertEqual(record.effective_from, PRICING_EFFECTIVE_FROM)
            self.assertEqual(record.time_rule.timezone, "Asia/Shanghai")
            self.assertIs(
                record.metadata.authority_source_type,
                AuthoritySourceType.OFFICIAL_PROVIDER,
            )
            self.assertEqual(record.metadata.official_source, OFFICIAL_PRICING_SOURCE)
            self.assertEqual(record.metadata.source.source_reference, EVIDENCE_REFERENCE)

    def test_peak_offpeak_dimensions_and_prices(self):
        peak = self.resolve(datetime(2026, 8, 21, 9, 0, tzinfo=UTC8)).record
        offpeak = self.resolve(datetime(2026, 8, 21, 19, 0, tzinfo=UTC8)).record
        self.assertEqual(peak.pricing_tier, "peak")
        self.assertEqual(offpeak.pricing_tier, "offpeak")
        self.assertEqual(
            {item.unit for record in self.records for item in record.components},
            {PricingUnit.PER_1M_TOKENS},
        )
        self.assertEqual(
            (price(peak, PriceDimension.CACHE_READ),
             price(peak, PriceDimension.INPUT),
             price(peak, PriceDimension.OUTPUT)),
            (Decimal("0.10"), Decimal("3.0"), Decimal("9.0")),
        )
        self.assertEqual(
            (price(offpeak, PriceDimension.CACHE_READ),
             price(offpeak, PriceDimension.INPUT),
             price(offpeak, PriceDimension.OUTPUT)),
            (Decimal("0.05"), Decimal("1.5"), Decimal("4.5")),
        )

    def test_effective_date_boundaries_and_unknown_timestamp_fail_closed(self):
        before = self.resolve(datetime(2026, 8, 16, 23, 59, 59, tzinfo=UTC8))
        self.assertIs(before.status, LookupStatus.MISSING)
        cases = (
            (datetime(2026, 8, 17, 0, 0, tzinfo=UTC8), "offpeak"),
            (datetime(2026, 8, 22, 8, 59, 59, 999999, tzinfo=UTC8), "offpeak"),
            (datetime(2026, 8, 22, 9, 0, tzinfo=UTC8), "peak"),
            (datetime(2026, 8, 22, 12, 0, tzinfo=UTC8), "offpeak"),
            (datetime(2026, 8, 22, 14, 0, tzinfo=UTC8), "peak"),
            (datetime(2026, 8, 22, 18, 0, tzinfo=UTC8), "offpeak"),
        )
        for timestamp, tier in cases:
            with self.subTest(timestamp=timestamp):
                result = self.resolve(timestamp)
                self.assertIs(result.status, LookupStatus.FOUND)
                self.assertEqual(result.record.pricing_tier, tier)
        unknown = self.query.resolve_pricing_authority(
            "deepseek", MODEL, BillingMode.API_USAGE, as_of=None
        )
        self.assertIs(unknown.status, LookupStatus.AMBIGUOUS)
        self.assertIsNone(unknown.record)

    def test_time_tier_round_trips_through_existing_store(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "deepseek-pricing.sqlite3"
            with SQLiteCanonicalStore(path) as store:
                for record in self.records:
                    for component in record.components:
                        store.append_pricing(component)
                    store.append_pricing_authority(record)
            with SQLiteCanonicalStore(path) as store:
                loaded = store.load_pricing_authorities()
        self.assertEqual(loaded, self.records)

    def test_pilot_002_closes_with_real_timestamp_and_no_reasoning_double_charge(self):
        evidence = load_pilot_evidence()
        usage = canonical_usage(evidence)
        result = self.query.resolve_pricing_authority(
            usage.provider_id, usage.model, BillingMode.API_USAGE, as_of=usage.observed_at
        )
        self.assertIs(result.status, LookupStatus.FOUND)
        self.assertEqual(result.record.pricing_tier, "offpeak")
        self.assertEqual(
            usage.observed_at.astimezone(UTC8),
            datetime(2026, 8, 21, 19, 55, 5, 542000, tzinfo=UTC8),
        )
        cost = calculate_authoritative_cost(usage, result.record)
        self.assertIs(cost.status, ComputationStatus.COMPLETE)
        self.assertEqual(cost.amount, Decimal("0.000387"))
        self.assertEqual(cost.currency, "CNY")
        self.assertEqual(usage.output_tokens, evidence["provider_usage"]["completion_tokens"])
        self.assertEqual(evidence["provider_usage"]["reasoning_tokens"], 39)
        output = next(item for item in cost.components if item.dimension == "output")
        self.assertEqual(output.token_count, 53)
        self.assertEqual(output.amount, Decimal("0.0002385"))

    def test_public_contract_selects_tier_without_contract_change(self):
        pilot = canonical_usage(load_pilot_evidence())
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "public-pricing.sqlite3"
            with SQLiteCanonicalStore(path) as store:
                for record in self.records:
                    for component in record.components:
                        store.append_pricing(component)
                    store.append_pricing_authority(record)
            public = PublicAuthorityReadService(
                AuthorityReadService(path)
            ).get_pricing_authority(
                "deepseek", MODEL, BillingMode.API_USAGE, as_of=pilot.observed_at
            )
        self.assertEqual(get_public_contract_hash(), EXPECTED_CONTRACT_HASH)
        self.assertIs(public.status, PublicAuthorityStatus.FOUND_FRESH)
        self.assertEqual(public.authority_id, self.records[1].authority_id)
        self.assertEqual(public.currency, "CNY")
        self.assertTrue(public.token_monetary_estimate_allowed)


if __name__ == "__main__":
    unittest.main()
