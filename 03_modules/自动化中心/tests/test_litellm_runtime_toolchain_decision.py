import json
import unittest
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
DECISION_PATH = MODULE_ROOT / "config" / "litellm.runtime_toolchain.v2.json"
EVIDENCE_PATH = (
    MODULE_ROOT
    / "fixtures"
    / "model_gateway"
    / "litellm_runtime_toolchain_decision.evidence.json"
)


class LiteLLMRuntimeToolchainDecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.decision = json.loads(DECISION_PATH.read_text(encoding="utf-8"))
        cls.evidence = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))

    def test_route_b_is_frozen_without_runtime_claim(self):
        self.assertEqual("TOOLCHAIN_DECISION_PASS", self.decision["decision"])
        self.assertEqual("RUNTIME_NOT_YET_STARTED", self.decision["runtime_status"])
        self.assertFalse(self.evidence["install_attempted"])
        self.assertEqual("NOT_RUN", self.evidence["gateway_start"])

    def test_commit_version_and_python_range_are_exact(self):
        self.assertEqual(
            "b9bff0998c9c89034314a81000ff8f9ff9158a01",
            self.decision["pinned_commit"],
        )
        self.assertEqual("1.99.0", self.decision["pinned_version"])
        self.assertEqual(">=3.10,<3.15", self.decision["python"]["supported_range"])
        self.assertTrue(self.decision["python"]["python_3_13_supported"])

    def test_native_source_build_requirements_are_explicit(self):
        build = self.decision["source_build"]
        self.assertEqual("maturin==1.9.4", build["backend"])
        self.assertEqual("litellm.rust_bridge._native", build["native_module"])
        self.assertEqual("pyo3", build["bindings"])
        self.assertTrue(build["rust_compilation_required"])
        self.assertFalse(build["source_build_authorized_in_this_task"])

    def test_nearest_windows_wheel_is_rejected_for_identity_mismatch(self):
        artifact = self.decision["prebuilt_artifact"]
        candidate = artifact["rejected_nearest_candidate"]
        self.assertFalse(artifact["exact_commit_artifact_found"])
        self.assertEqual("1.99.0rc1", candidate["version"])
        self.assertEqual(
            "24f3a4e0e2b84dcb985408a3d9008ee883a0f3c529b6811086ce48b0fb253ae7",
            candidate["sha256"],
        )
        self.assertNotEqual(
            self.decision["pinned_commit"], candidate["tag_commit"]
        )

    def test_enterprise_hard_gate_remains_closed(self):
        gate = self.decision["license_gate"]
        self.assertEqual("MIT", gate["litellm_core"])
        self.assertEqual("LicenseRef-Proprietary", gate["litellm_enterprise"])
        self.assertTrue(gate["proxy_extra_unconditionally_declares_enterprise"])
        self.assertFalse(gate["official_oss_only_gateway_extra_found"])
        self.assertFalse(gate["enterprise_package_install_allowed_by_this_decision"])

    def test_no_provider_or_production_effect_is_claimed(self):
        self.assertEqual(0, self.evidence["real_provider_calls"])
        self.assertEqual(0, self.evidence["real_api_cost"])
        self.assertFalse(self.evidence["provider_credentials_accessed"])
        self.assertFalse(self.evidence["production_n8n_contacted"])
        self.assertFalse(self.evidence["upstream_source_modified"])


if __name__ == "__main__":
    unittest.main()
