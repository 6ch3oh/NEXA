import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
sys.path.insert(0, str(SRC_ROOT))

from automation_center.adapters.litellm_core import (  # noqa: E402
    LiteLLMCoreClient,
    LiteLLMCoreError,
)
from automation_center.domain.model_gateway import (  # noqa: E402
    ModelGatewayPolicy,
    ModelGatewayPolicyError,
    ModelGatewayRequest,
    UserTier,
)


BEFORE = MODULE_ROOT / "config" / "model_gateway.nonprod.before.json"
TARGETS = MODULE_ROOT / "config" / "litellm_core.nonprod.models.json"


def request(tier: UserTier = UserTier.BASIC) -> ModelGatewayRequest:
    return ModelGatewayRequest(
        request_id="core-unit-001",
        customer_id="synthetic-customer",
        user_tier=tier,
        capability_id="knowledge.collect",
        model_profile=None,
        input="probe",
        metadata={"test": True},
    )


class LiteLLMCoreAdapterTests(unittest.TestCase):
    def test_resolved_alias_enters_injected_core_completion(self):
        observed = []

        def fake_completion(**kwargs):
            observed.append(kwargs)
            return {
                "id": "mock-id",
                "model": "nexa-mock-provider-a",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "total_tokens": 30,
                },
            }

        client = LiteLLMCoreClient.from_path(
            TARGETS, completion_function=fake_completion
        )
        result = client.execute(ModelGatewayPolicy.from_path(BEFORE), request())

        self.assertEqual("openai/nexa-mock-provider-a", observed[0]["model"])
        self.assertEqual("mock-provider-a-ok", observed[0]["mock_response"])
        self.assertEqual("nexa-knowledge-basic-alias-a", result.resolved_alias)
        self.assertEqual("mock-provider-a", result.resolved_provider)
        self.assertEqual(30, result.usage.total_tokens)

    def test_unconfigured_tier_fails_before_core_completion(self):
        calls = []
        client = LiteLLMCoreClient.from_path(
            TARGETS, completion_function=lambda **kwargs: calls.append(kwargs)
        )
        with self.assertRaises(ModelGatewayPolicyError) as raised:
            client.execute(ModelGatewayPolicy.from_path(BEFORE), request(UserTier.FREE))
        self.assertEqual("TIER_CAPABILITY_NOT_CONFIGURED", raised.exception.code)
        self.assertEqual([], calls)
        self.assertEqual([], client.core_calls)

    def test_unknown_alias_fails_before_core_completion(self):
        payload = json.loads(TARGETS.read_text(encoding="utf-8"))
        payload["alias_targets"] = []
        client = LiteLLMCoreClient({}, completion_function=lambda **kwargs: None)
        with self.assertRaises(ModelGatewayPolicyError) as raised:
            client.execute(ModelGatewayPolicy.from_path(BEFORE), request())
        self.assertEqual("LITELLM_ALIAS_NOT_CONFIGURED", raised.exception.code)
        self.assertEqual([], client.core_calls)

    def test_config_rejects_service_architecture_role(self):
        payload = json.loads(TARGETS.read_text(encoding="utf-8"))
        payload["architecture_role"] = "ADOPT_AS_SERVICE"
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", encoding="utf-8", delete=False
        ) as handle:
            json.dump(payload, handle)
            temp = Path(handle.name)
        try:
            with self.assertRaises(LiteLLMCoreError):
                LiteLLMCoreClient.from_path(temp)
        finally:
            temp.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
