import ast
import hashlib
import json
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
COMPOSITION_PATH = SRC_ROOT / "automation_center" / "composition.py"
PACKAGE_PATH = SRC_ROOT / "automation_center" / "__init__.py"
PUBLIC_API_PATH = SRC_ROOT / "automation_center" / "public_api.py"
CONTROL_API_PATH = SRC_ROOT / "automation_center" / "control_api.py"
FIXTURE_PATH = MODULE_ROOT / "fixtures" / "ui_integration" / "v141.sample.json"
CANONICAL = MODULE_ROOT / "source_import" / "n8n_工作流开发" / "output" / "中国AI知识库采集器_V1.4.1_网页失败兜底版.json"
sys.path.insert(0, str(SRC_ROOT))

import automation_center  # noqa: E402
from automation_center import (  # noqa: E402
    AUTOMATION_UI_INTEGRATION_VERSION,
    AutomationControlAPI,
    AutomationReadAPI,
    build_automation_read_context,
)


class UIIntegrationTests(unittest.TestCase):
    CONFIRMED_PROVIDER_INSTANCE_ID = "confirmed-local-test-instance"

    @classmethod
    def setUpClass(cls):
        cls.api = build_automation_read_context(
            confirmed_provider_instance_id=cls.CONFIRMED_PROVIDER_INSTANCE_ID
        )
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.identity = {
            "provider_kind": "n8n",
            "provider_instance_id": cls.CONFIRMED_PROVIDER_INSTANCE_ID,
            "external_workflow_id": "ymYh8t76VP3jGPbr",
        }

    def test_version_is_v01(self):
        self.assertEqual(AUTOMATION_UI_INTEGRATION_VERSION, "0.1")

    def test_bootstrap_returns_the_public_read_facade(self):
        self.assertIsInstance(self.api, AutomationReadAPI)
        self.assertNotIsInstance(self.api, AutomationControlAPI)

    def test_bootstrap_is_deterministic_with_explicit_confirmed_identity(self):
        second = build_automation_read_context(
            confirmed_provider_instance_id=self.CONFIRMED_PROVIDER_INSTANCE_ID
        )
        self.assertEqual(self.api.get_ui_overview(), second.get_ui_overview())

    def test_bootstrap_without_override_uses_formal_tiangong_identity(self):
        api = build_automation_read_context()
        self.assertIsInstance(api, AutomationReadAPI)
        self.assertTrue(api.get_product_backend()["ok"])
        self.assertTrue(api.get_overview()["ok"])
        provider = api.get_product_backend()["data"]["provider"]
        self.assertEqual("n8n-tiangong-primary", provider["provider_instance_id"])
        self.assertEqual("USER_CONFIRMED", provider["config_source"])

    def test_bootstrap_rejects_unsafe_identity(self):
        for value in ("", "   ", "bad\nidentity", "E:\\instance", "https://instance"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                build_automation_read_context(confirmed_provider_instance_id=value)

    def test_public_package_has_one_read_facade(self):
        read_facades = [name for name in automation_center.__all__ if name.endswith("ReadAPI")]
        self.assertEqual(read_facades, ["AutomationReadAPI"])

    def test_internal_read_services_are_not_top_level_exports(self):
        for name in ("UnifiedAutomationQueryService", "StaticWorkflowQueryService", "N8nExportAdapter"):
            self.assertNotIn(name, automation_center.__all__)

    def test_overview_is_ui_ready(self):
        response = self.api.get_ui_overview()
        self.assertTrue(response["ok"])
        self.assertEqual("ready", response["data"]["ui_integration"]["state"])
        self.assertEqual(1, response["data"]["total_workflows"])

    def test_authority_map_is_explicit(self):
        authority = self.api.get_ui_overview()["data"]["ui_integration"]["authority"]
        self.assertEqual("legacy_n8n_workflow_json", authority["workflow_definition"])
        self.assertEqual("n8n_runtime", authority["workflow_execution"])
        self.assertEqual("legacy_n8n_assets", authority["original_result_and_evidence"])
        self.assertEqual("nexa_automation_read_api", authority["normalized_read_view"])

    def test_provider_runtime_does_not_become_workflow_runtime(self):
        overview = self.api.get_ui_overview()["data"]
        integration = overview["ui_integration"]
        self.assertEqual("not_observed", integration["current_provider_runtime_state"])
        historical = integration["historical_provider_runtime_observation"]
        self.assertEqual("running", historical["state"])
        self.assertEqual("2026-08-12", historical["observed_on"])
        self.assertEqual("historical_not_current", historical["freshness"])
        self.assertEqual("not_observed", overview["runtime_status"])
        self.assertEqual(0, overview["runtime_observed_count"])

    def test_workflow_list_has_ui_summary(self):
        item = self.api.list_ui_workflows()["data"][0]
        self.assertEqual("knowledge.collect", item["ui"]["capability_id"])
        self.assertEqual("configuration_required", item["ui"]["current_availability"])
        self.assertTrue(item["ui"]["health"]["needs_attention"])

    def test_workflow_identity_is_provider_scoped_and_caller_confirmed(self):
        item = self.api.list_ui_workflows()["data"][0]
        self.assertEqual(self.identity, item["identity"])
        self.assertEqual("caller_confirmed", item["ui"]["provider_instance_identity_state"])
        self.assertEqual(self.CONFIRMED_PROVIDER_INSTANCE_ID, item["ui"]["provider_instance_id"])
        self.assertNotEqual(
            item["ui"]["provider_instance_candidate_label"],
            item["identity"]["provider_instance_id"],
        )

    def test_workflow_detail_exposes_capability_input_schema(self):
        detail = self.api.get_ui_workflow(self.identity)["data"]["ui"]
        fields = {item["field_name"]: item for item in detail["input_schema"]}
        self.assertEqual({"ai_name", "source_text", "source_url"}, set(fields))
        self.assertTrue(fields["ai_name"]["required"])
        self.assertFalse(fields["source_text"]["required"])

    def test_workflow_detail_exposes_result_type(self):
        schema = self.api.get_ui_workflow(self.identity)["data"]["ui"]["result_schema"]
        self.assertEqual("knowledge_markdown_document", schema["result_type"])
        self.assertEqual("text/markdown", schema["media_type"])

    def test_primary_action_is_copy_markdown_but_not_ready(self):
        action = self.api.get_ui_workflow(self.identity)["data"]["ui"]["primary_result_action"]
        self.assertEqual("copy_markdown", action["type"])
        self.assertEqual("not_ready", action["readiness"])
        self.assertFalse(action["copy_ready"])
        self.assertFalse(action["open_ready"])

    def test_control_readiness_is_non_executable(self):
        readiness = self.api.get_ui_workflow(self.identity)["data"]["ui"]["control_readiness"]
        self.assertEqual("target_confirmed_execution_disabled", readiness["state"])
        self.assertFalse(readiness["execution_enabled"])
        self.assertEqual("auth_required", readiness["production_revision"])
        self.assertEqual("unresolved", readiness["form_url"])

    def test_sandbox_evidence_is_separate_from_production(self):
        sandbox = self.api.get_ui_workflow(self.identity)["data"]["ui"]["sandbox_validation"]
        self.assertFalse(sandbox["production_target"])
        self.assertEqual("V141Final403429", sandbox["workflow_external_id"])
        self.assertEqual(["42", "43", "44", "45", "46", "47"], sandbox["execution_ids"])

    def test_historical_summary_does_not_merge_sandbox_into_production(self):
        response = self.api.get_ui_workflow(self.identity)["data"]
        self.assertEqual(0, response["historical_summary"]["historical_result_count"])
        summary = response["ui"]["historical_result_summary"]
        self.assertEqual(0, summary["production_linked_result_count"])
        self.assertEqual(6, summary["sandbox_historical_result_count"])
        self.assertTrue(summary["no_production_result_does_not_mean_never_executed"])

    def test_sandbox_results_remain_queryable(self):
        results = self.api.list_ui_results()["data"]
        self.assertEqual(6, len(results))
        self.assertTrue(all(item["evidence"]["environment_class"] == "sandbox_isolated" for item in results))

    def test_result_projection_preserves_two_axes(self):
        results = self.api.list_ui_results()["data"]
        partial = next(item for item in results if item["business_status"] == "partial")
        self.assertEqual("success", partial["execution_status"])
        self.assertEqual("partial", partial["business_status"])

    def test_result_actions_are_not_ready(self):
        for result in self.api.list_ui_results()["data"]:
            action = result["result_action"]
            self.assertEqual("copy_markdown", action["type"])
            self.assertEqual("not_ready", action["readiness"])
            self.assertFalse(action["copy_ready"])

    def test_diagnosis_contract_is_visible_but_not_dispatched(self):
        diagnosis = self.api.get_ui_workflow(self.identity)["data"]["ui"]["diagnosis"]
        self.assertTrue(diagnosis["contract_available"])
        self.assertFalse(diagnosis["dispatch_connected"])

    def test_no_raw_n8n_payload_leaks(self):
        encoded = json.dumps(
            (self.api.get_ui_overview(), self.api.list_ui_workflows(), self.api.list_ui_results()),
            ensure_ascii=False,
        ).lower()
        for token in ("source_url", "web_text", "node_path", "execute_log", "raw_payload", "credentials"):
            self.assertNotIn(token, encoded)

    def test_no_secret_or_host_artifact_path_leaks(self):
        encoded = json.dumps(self.api.get_ui_workflow(self.identity), ensure_ascii=False)
        self.assertNotIn("FAKE_SECRET_VALUE", encoded)
        self.assertNotIn("个人数字资产中心", encoded)
        self.assertNotIn("E:\\", encoded)

    def test_ui_response_mutation_is_isolated(self):
        first = self.api.get_ui_workflow(self.identity)
        first["data"]["ui"]["capability_name"] = "MUTATED"
        self.assertEqual("AI 知识库采集", self.api.get_ui_workflow(self.identity)["data"]["ui"]["capability_name"])

    def test_ui_methods_are_additive_to_existing_read_api(self):
        self.assertTrue(self.api.get_overview()["ok"])
        self.assertTrue(self.api.list_workflows()["ok"])
        self.assertTrue(self.api.list_results()["ok"])

    def test_public_factory_does_not_accept_caller_ui_profile(self):
        with self.assertRaises(TypeError):
            automation_center.build_read_api({}, ui_profile={})

    def test_public_facade_constructor_rejects_arbitrary_ui_mapping(self):
        with self.assertRaises(TypeError):
            AutomationReadAPI(self.api._query_service, _ui_profile={})

    def test_read_and_control_modules_remain_separate(self):
        self.assertNotIn("control_api", PUBLIC_API_PATH.read_text(encoding="utf-8"))
        self.assertNotIn("public_api", CONTROL_API_PATH.read_text(encoding="utf-8"))

    def test_composition_has_no_network_process_or_docker_imports(self):
        tree = ast.parse(COMPOSITION_PATH.read_text(encoding="utf-8"))
        imports = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.add(node.module.split(".")[0])
        self.assertFalse(imports & {"requests", "httpx", "urllib", "socket", "subprocess", "docker"})

    def test_composition_has_no_execute_publish_or_runtime_probe(self):
        source = COMPOSITION_PATH.read_text(encoding="utf-8").lower()
        for token in ("execute --id", "import:workflow", "docker exec", "invoke-webrequest", "requests.get", "publish("):
            self.assertNotIn(token, source)

    def test_canonical_hash_is_preserved(self):
        digest = hashlib.sha256(CANONICAL.read_bytes()).hexdigest().upper()
        self.assertEqual("B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514", digest)

    def test_fixture_matches_contract_shape(self):
        self.assertEqual("0.1", self.fixture["ui_integration_version"])
        self.assertEqual("AUTOMATION_READ_UI_INTEGRATION_READY", self.fixture["state"])
        self.assertEqual("knowledge.collect", self.fixture["workflow_sample"]["capability_id"])
        self.assertFalse(self.fixture["workflow_sample"]["execution_enabled"])
        self.assertEqual("NOT_READY", self.fixture["workflow_sample"]["copy_markdown"])

    def test_fixture_has_no_raw_or_secret_content(self):
        encoded = json.dumps(self.fixture, ensure_ascii=False).lower()
        for token in ("source_url", "web_text", "credential", "password", "api_key", "execute_log"):
            self.assertNotIn(token, encoded)


if __name__ == "__main__":
    unittest.main()
