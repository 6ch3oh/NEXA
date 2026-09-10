import json
import unittest
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = (
    MODULE_ROOT
    / "fixtures"
    / "model_gateway"
    / "litellm_core_normalization.evidence.json"
)


class ModelInvocationEvidenceTests(unittest.TestCase):
    def test_offline_core_normalization_evidence_passes(self):
        self.assertTrue(EVIDENCE.is_file(), "run the Core normalization POC first")
        data = json.loads(EVIDENCE.read_text(encoding="utf-8"))
        self.assertEqual("LITELLM_CORE_NORMALIZATION_VALIDATED", data["status"])
        self.assertEqual("1.98.0", data["litellm_core_version"])
        self.assertEqual(13, len(data["records"]))
        self.assertEqual(13, data["core_entries"])
        self.assertTrue(all(item["passed"] for item in data["case_results"]))
        self.assertEqual(
            ["LITELLM_CALCULATED", "NEXA_ESTIMATED", "PROVIDER_REPORTED", "UNAVAILABLE"],
            data["cost_sources_observed"],
        )
        self.assertEqual(
            [
                "AUTHENTICATION_FAILED", "CONTEXT_LIMIT_EXCEEDED",
                "PROVIDER_UNAVAILABLE", "RATE_LIMITED", "TIMEOUT",
                "UNKNOWN_PROVIDER_ERROR",
            ],
            data["error_categories_observed"],
        )
        self.assertTrue(data["secret_redaction"]["passed"])
        self.assertFalse(data["secret_redaction"]["raw_exception_persisted"])
        self.assertEqual(0, data["real_provider_calls"])
        self.assertEqual(0, data["real_api_cost"])
        self.assertEqual([], data["network_attempts"])
        self.assertFalse(any(data["production"].values()))
        self.assertEqual(
            "CANDIDATE_ONLY / NO_WRITE",
            data["cross_module_handoff_candidate"]["status"],
        )
        event = data["cross_module_handoff_candidate"]["event"]
        self.assertEqual("AI_USAGE_EVENT", event["event_type"])
        self.assertIn("provider", event)
        self.assertIn("model", event)
        self.assertNotIn("resolved_provider", event)
        self.assertNotIn("resolved_model", event)
        self.assertTrue(all(data["invariants"].values()))

    def test_evidence_contains_no_secret_marker_or_content_bodies(self):
        text = EVIDENCE.read_text(encoding="utf-8")
        self.assertNotIn("sk-test-secret", text)
        self.assertNotIn("private offline prompt", text)
        self.assertNotIn("private mock output", text)
        data = json.loads(text)
        for record in data["records"]:
            self.assertEqual("synthetic-customer-001", record["customer_id"])
            self.assertEqual("BASIC", record["user_tier"])
            self.assertEqual("knowledge.basic", record["model_profile"])
            self.assertNotIn("input", record)
            self.assertNotIn("output", record)
            if record["safe_message"]:
                self.assertNotIn("litellm.", record["safe_message"].lower())


if __name__ == "__main__":
    unittest.main()
