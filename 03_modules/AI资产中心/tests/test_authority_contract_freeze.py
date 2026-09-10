from __future__ import annotations

import unittest
from dataclasses import replace
from decimal import Decimal

from src.authority import (
    NEXA_AI_RESOURCE_AUTHORITY_PUBLIC_CONTRACT_V0_1,
    PublicAuthorityReadService,
    PublicAuthorityStatus,
    PublicCorrelation,
    PublicLimitAvailability,
    get_public_contract_hash,
    get_public_contract_manifest,
    public_to_canonical_json,
    to_public_attribution,
    PricingAuthorityView,
)
from src.contracts import (
    AuthorityCompleteness,
    BillingMode,
    EntitlementLimit,
    EntitlementLimitKind,
    EntitlementState,
    FreshnessStatus,
    PriceDimension,
)
from tests.test_public_authority_contract import (
    MODEL, PROVIDER_ID, T2, StaticReader, authority, entitlement,
    entitlement_view, pricing_view,
)
from tests.test_resource_intelligence import ResourceIntelligenceCase
from src.authority import model_to_attribution
from src.store.sqlite_store import _limits_from_json


EXPECTED_CONTRACT_HASH = "9de54e55f4ebc68240fcfb9e097c3e515edbb2df7b15b53421b5425ed91134b6"


class ContractFreezeCase(unittest.TestCase):
    def test_manifest_and_hash_are_frozen_and_deterministic(self):
        self.assertEqual(NEXA_AI_RESOURCE_AUTHORITY_PUBLIC_CONTRACT_V0_1, "0.1")
        self.assertEqual(get_public_contract_hash(), EXPECTED_CONTRACT_HASH)
        self.assertEqual(get_public_contract_hash(), get_public_contract_hash())
        manifest = get_public_contract_manifest()
        self.assertEqual(manifest["version"], "0.1")
        self.assertIn("module_id", manifest["dto_fields"]["PublicCorrelation"])

    def test_pricing_identity_and_incomplete_status_are_public(self):
        record = authority()
        view = replace(pricing_view(record), completeness=AuthorityCompleteness.INCOMPLETE)
        result = PublicAuthorityReadService(StaticReader(view)).get_pricing_authority(
            PROVIDER_ID, MODEL, BillingMode.API_USAGE, as_of=T2,
        )
        self.assertEqual(result.authority_id, record.authority_id)
        self.assertIs(result.status, PublicAuthorityStatus.INCOMPLETE)
        self.assertFalse(result.token_monetary_estimate_allowed)

    def test_not_available_and_explicit_unlimited_are_distinct_from_unknown(self):
        base = entitlement()
        unlimited = EntitlementLimit(
            EntitlementLimitKind.REQUEST, "requests", unlimited=True,
        )
        record = replace(base, state=EntitlementState.NOT_AVAILABLE,
                         limits=(unlimited,))
        result = PublicAuthorityReadService(StaticReader(
            entitlement_view=entitlement_view(record, state=EntitlementState.NOT_AVAILABLE)
        )).get_entitlement_authority(PROVIDER_ID, as_of=T2, plan=record.plan)
        self.assertIs(result.status, PublicAuthorityStatus.NOT_APPLICABLE)
        self.assertIs(result.state, EntitlementState.NOT_AVAILABLE)
        self.assertIs(result.limits[0].availability, PublicLimitAvailability.UNLIMITED)
        unknown = replace(unlimited, unlimited=False)
        unknown_result = PublicAuthorityReadService(StaticReader(
            entitlement_view=entitlement_view(replace(base, limits=(unknown,)))
        )).get_entitlement_authority(PROVIDER_ID, as_of=T2, plan=base.plan)
        self.assertIs(unknown_result.limits[0].availability, PublicLimitAvailability.UNKNOWN)

    def test_four_level_correlation_defaults_to_unattributed(self):
        correlation = PublicCorrelation()
        self.assertEqual(
            (correlation.project_id, correlation.module_id,
             correlation.task_id, correlation.run_id),
            ("UNATTRIBUTED",) * 4,
        )

    def test_legacy_v3_limit_json_defaults_unlimited_to_false(self):
        restored = _limits_from_json(
            '[{"hard_limit":"10","kind":"task","model":null,'
            '"remaining":"8","soft_limit":null,"unit":"tasks","used":"2"}]'
        )
        self.assertFalse(restored[0].unlimited)

    def test_public_attribution_has_explicit_numerators_and_unattributed(self):
        fixture = ResourceIntelligenceCase()
        fixture.setUp()
        summary = model_to_attribution(
            (fixture.a, fixture.b, fixture.u),
            fixture.costs,
            provider_id="deepseek", model="v4",
            start=fixture.a.observed_at,
            end=fixture.c.observed_at.replace(month=2),
            billing_mode=BillingMode.API_USAGE,
        )
        public = to_public_attribution(summary)
        payload = public_to_canonical_json(public)
        self.assertIn("token_numerator", payload)
        self.assertIn("token_denominator", payload)
        self.assertIn("UNATTRIBUTED", payload)


if __name__ == "__main__":
    unittest.main()
