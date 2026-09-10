import dataclasses
import json
import sys
import unittest
from pathlib import Path
from types import MappingProxyType


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
sys.path.insert(0, str(SRC_ROOT))

from automation_center.domain.model_gateway import (  # noqa: E402
    ModelGatewayPolicy,
    ModelGatewayPolicyError,
    ModelGatewayRequest,
    ModelProfile,
    TierModelBinding,
    UserTier,
)


BEFORE = MODULE_ROOT / "config" / "model_gateway.nonprod.before.json"
AFTER = MODULE_ROOT / "config" / "model_gateway.nonprod.after_owner_change.json"
LITELLM_CORE_CONFIG = MODULE_ROOT / "config" / "litellm_core.nonprod.models.json"


def request(tier=UserTier.PRO, model_profile=None):
    return ModelGatewayRequest(
        request_id="test-request-001",
        customer_id="synthetic-customer",
        user_tier=tier,
        capability_id="knowledge.collect",
        model_profile=model_profile,
        input="probe",
        metadata={},
    )


class ModelGatewayContractTests(unittest.TestCase):
    def test_request_contract_contains_all_frozen_fields(self):
        self.assertEqual(
            [
                "request_id",
                "customer_id",
                "user_tier",
                "capability_id",
                "model_profile",
                "input",
                "metadata",
            ],
            [field.name for field in dataclasses.fields(ModelGatewayRequest)],
        )

    def test_before_policy_routes_basic_and_pro_to_explicit_profiles(self):
        policy = ModelGatewayPolicy.from_path(BEFORE)
        basic = policy.resolve(request(UserTier.BASIC))
        pro = policy.resolve(request(UserTier.PRO))
        self.assertEqual("knowledge.basic", basic.profile_id)
        self.assertEqual("nexa-knowledge-basic-alias-a", basic.litellm_alias)
        self.assertEqual("knowledge.pro", pro.profile_id)
        self.assertEqual("nexa-knowledge-pro-alias-b", pro.litellm_alias)

    def test_owner_change_preserves_pro_profile_and_changes_only_alias_route(self):
        before = ModelGatewayPolicy.from_path(BEFORE).resolve(request())
        after = ModelGatewayPolicy.from_path(AFTER).resolve(request())
        self.assertEqual(before.profile_id, after.profile_id)
        self.assertEqual(UserTier.PRO, before.user_tier)
        self.assertEqual(UserTier.PRO, after.user_tier)
        self.assertEqual("nexa-knowledge-pro-alias-b", before.litellm_alias)
        self.assertEqual("nexa-knowledge-pro-alias-c", after.litellm_alias)

    def test_owner_files_differ_in_exactly_one_pro_alias_value(self):
        before = json.loads(BEFORE.read_text(encoding="utf-8"))
        after = json.loads(AFTER.read_text(encoding="utf-8"))
        before_pro = before["profiles"][1]
        after_pro = after["profiles"][1]
        differences = {
            key for key in set(before_pro) | set(after_pro) if before_pro.get(key) != after_pro.get(key)
        }
        self.assertEqual({"litellm_alias"}, differences)
        before["profiles"][1]["litellm_alias"] = after_pro["litellm_alias"]
        self.assertEqual(before, after)

    def test_unconfigured_free_tier_fails_closed(self):
        with self.assertRaises(ModelGatewayPolicyError) as raised:
            ModelGatewayPolicy.from_path(BEFORE).resolve(request(UserTier.FREE))
        self.assertEqual("TIER_CAPABILITY_NOT_CONFIGURED", raised.exception.code)

    def test_caller_cannot_override_owner_profile(self):
        with self.assertRaises(ModelGatewayPolicyError) as raised:
            ModelGatewayPolicy.from_path(BEFORE).resolve(
                request(UserTier.PRO, "knowledge.basic")
            )
        self.assertEqual("CALLER_PROFILE_OVERRIDE_REJECTED", raised.exception.code)

    def test_missing_profile_fails_closed(self):
        policy = ModelGatewayPolicy(
            profiles=MappingProxyType({}),
            bindings=MappingProxyType(
                {
                    (UserTier.PRO, "knowledge.collect"): TierModelBinding(
                        UserTier.PRO, "knowledge.collect", "missing", True
                    )
                }
            ),
        )
        with self.assertRaises(ModelGatewayPolicyError) as raised:
            policy.resolve(request())
        self.assertEqual("PROFILE_NOT_CONFIGURED", raised.exception.code)

    def test_disabled_profile_fails_closed(self):
        profile = ModelProfile(
            "knowledge.pro", "Pro", "alias", False, (UserTier.PRO,)
        )
        policy = ModelGatewayPolicy(
            profiles=MappingProxyType({profile.profile_id: profile}),
            bindings=MappingProxyType(
                {
                    (UserTier.PRO, "knowledge.collect"): TierModelBinding(
                        UserTier.PRO, "knowledge.collect", profile.profile_id, True
                    )
                }
            ),
        )
        with self.assertRaises(ModelGatewayPolicyError) as raised:
            policy.resolve(request())
        self.assertEqual("PROFILE_DISABLED", raised.exception.code)

    def test_all_commercial_tiers_are_reserved(self):
        self.assertEqual(
            {"FREE", "BASIC", "PRO", "PREMIUM", "OWNER"},
            {tier.value for tier in UserTier},
        )

    def test_cost_budget_and_rate_limit_are_placeholders_only(self):
        raw = json.loads(BEFORE.read_text(encoding="utf-8"))
        for profile in raw["profiles"]:
            for key in (
                "max_cost_per_request",
                "daily_budget",
                "monthly_budget",
                "rate_limit",
            ):
                self.assertIn(key, profile)
                self.assertIsNone(profile[key])

    def test_fallback_is_off_in_nexa_and_litellm_core_configs(self):
        raw = json.loads(BEFORE.read_text(encoding="utf-8"))
        core = json.loads(LITELLM_CORE_CONFIG.read_text(encoding="utf-8"))
        self.assertIs(raw["fallback_enabled"], False)
        self.assertIs(core["fallback_enabled"], False)

    def test_litellm_core_config_is_library_only_and_credential_free(self):
        core_text = LITELLM_CORE_CONFIG.read_text(encoding="utf-8")
        core = json.loads(core_text)
        self.assertEqual("ADOPT_AS_LIBRARY / OSS CORE", core["architecture_role"])
        self.assertEqual(3, len(core["alias_targets"]))
        self.assertNotIn("api_base", core_text)
        self.assertNotIn("api_key", core_text.lower())
        self.assertNotIn("proxy", core_text.lower())
        self.assertNotIn("enterprise", core_text.lower())


if __name__ == "__main__":
    unittest.main()
