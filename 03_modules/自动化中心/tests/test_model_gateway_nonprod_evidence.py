import json
import unittest
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = (
    MODULE_ROOT
    / "fixtures"
    / "model_gateway"
    / "litellm_core_nonprod_poc.evidence.json"
)


class ModelGatewayNonprodEvidenceTests(unittest.TestCase):
    def test_real_litellm_core_poc_evidence_is_validated(self):
        self.assertTrue(EVIDENCE.is_file(), "run the isolated LiteLLM Core POC first")
        data = json.loads(EVIDENCE.read_text(encoding="utf-8"))
        self.assertEqual(
            "LITELLM_STABLE_OSS_CORE_NONPROD_POC_VALIDATED", data["status"]
        )
        self.assertEqual(
            "ADOPT_AS_LIBRARY / OSS CORE", data["architecture_role"]
        )
        self.assertTrue(data["architecture_decision_changed"]["recorded"])
        self.assertEqual("ADOPT_AS_SERVICE", data["architecture_decision_changed"]["from"])
        self.assertEqual(
            "ADOPT_AS_LIBRARY / OSS CORE", data["architecture_decision_changed"]["to"]
        )
        self.assertEqual("1.98.0", data["artifact"]["stable_version"])
        self.assertEqual(
            "1daac9a9a9d052fdbe58ee711c9924dc81d349d4621286cbd96d77baa12158c4",
            data["artifact"]["wheel_sha256"],
        )
        self.assertFalse(data["artifact"]["source_build_required"])
        self.assertFalse(data["dependency_gate"]["enterprise_installed"])
        self.assertFalse(data["dependency_gate"]["proxy_extra_installed"])
        self.assertEqual(0, data["real_provider_calls"])
        self.assertEqual(0, data["real_api_cost"])
        self.assertEqual("OFF", data["fallback_default"])
        self.assertFalse(data["credential_access"])
        self.assertEqual(
            [
                "nexa-knowledge-basic-alias-a",
                "nexa-knowledge-pro-alias-b",
                "nexa-knowledge-pro-alias-c",
            ],
            [event["alias"] for event in data["core_calls"]],
        )
        self.assertEqual(
            data["fail_closed"]["core_call_count_before"],
            data["fail_closed"]["core_call_count_after"],
        )
        self.assertEqual([], data["network_attempts"])
        self.assertFalse(any(data["production"].values()))
        self.assertTrue(all(data["invariants"].values()))


if __name__ == "__main__":
    unittest.main()
