import ast
import json
import sys
import unittest
from dataclasses import is_dataclass, replace
from datetime import datetime, timezone
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
WORKFLOW_FIXTURE = MODULE_ROOT / "fixtures" / "n8n" / "workflow.synthetic.json"
RESULT_FIXTURE = MODULE_ROOT / "fixtures" / "result_intake" / "result.synthetic.json"
API_FIXTURE = MODULE_ROOT / "fixtures" / "read_api" / "responses.synthetic.json"
PUBLIC_API_PATH = SRC_ROOT / "automation_center" / "public_api.py"
sys.path.insert(0, str(SRC_ROOT))

from automation_center import (  # noqa: E402
    AUTOMATION_READ_API_VERSION,
    AutomationReadAPI,
    ExecutionIdentityInput,
    ReadAPIErrorCode,
    WorkflowIdentityInput,
    build_read_api,
    serialize_read_api_response,
)
from automation_center.adapters import (  # noqa: E402
    LegacyExecutionResultAdapter,
    N8nExportAdapter,
    N8nExportContext,
    ResultIntakeContext,
)
from automation_center.application import StaticWorkflowQueryService, UnifiedAutomationQueryService  # noqa: E402
from automation_center.domain import AutomationProvider, ProviderCapability  # noqa: E402


CAPTURED_AT = datetime(2026, 8, 11, 1, 0, tzinfo=timezone.utc)


class ReadAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.export_adapter = N8nExportAdapter()
        cls.result_adapter = LegacyExecutionResultAdapter()
        cls.workflow_data = json.loads(WORKFLOW_FIXTURE.read_text(encoding="utf-8"))
        cls.result_data = json.loads(RESULT_FIXTURE.read_text(encoding="utf-8"))
        cls.ui_fixture = json.loads(API_FIXTURE.read_text(encoding="utf-8"))

    def map_workflow(self, workflow_id, name):
        data = json.loads(json.dumps(self.workflow_data))
        data["id"] = workflow_id
        data["name"] = name
        raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return self.export_adapter.map_export(
            raw,
            N8nExportContext(
                "n8n",
                "instance-a",
                f"fixture:{workflow_id}.json",
                CAPTURED_AT,
                synthetic=True,
            ),
        )

    @staticmethod
    def provider_for(mapped):
        return AutomationProvider(
            ref=mapped.workflow.provider,
            display_name="Synthetic Provider",
            capabilities=frozenset({ProviderCapability.DEFINITION_READ}),
            provenance=mapped.workflow.provenance,
        )

    def static_query(self):
        matching = self.map_workflow("synthetic-workflow-001", "Zulu Workflow")
        static_only = self.map_workflow("static-only-workflow", "Alpha Workflow")
        providers = {matching.workflow.provider: self.provider_for(matching)}
        return StaticWorkflowQueryService(
            (matching.workflow, static_only.workflow),
            providers.values(),
            (matching.evidence, static_only.evidence),
        )

    def result_records(self, instance="instance-a"):
        result = json.dumps(
            self.result_data["result_artifact"],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        summary = json.dumps(
            self.result_data["run_summary_artifact"],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return self.result_adapter.read_artifacts(
            result,
            summary,
            ResultIntakeContext(
                provider_kind="n8n",
                provider_instance_context=instance,
                result_artifact_ref="fixture:api-result.json",
                run_summary_artifact_ref="fixture:api-summary.json",
                report_ref="fixture:api-report",
            ),
        )

    def prepared_records(self):
        matching = self.result_records()
        orphan = replace(
            matching[0],
            record_id="result-api-orphan-001",
            workflow_external_id="orphan-workflow",
            execution_external_id="orphan-execution-001",
        )
        unresolved = self.result_records(instance=None)[0]
        return matching + (orphan, unresolved)

    def query_service(self, service_type=UnifiedAutomationQueryService):
        return service_type(self.static_query(), self.prepared_records())

    def api(self):
        return build_read_api(self.query_service())

    @staticmethod
    def workflow_identity(workflow_id="synthetic-workflow-001"):
        return {
            "provider_kind": "n8n",
            "provider_instance_id": "instance-a",
            "external_workflow_id": workflow_id,
        }

    def execution_identity(self):
        record = self.result_records()[0]
        return {
            "provider_kind": record.provider_kind,
            "provider_instance_id": record.provider_instance_id,
            "execution_external_id": record.execution_external_id,
        }

    def assert_json_tree(self, value):
        allowed = {dict, list, str, int, float, bool, type(None)}
        self.assertIn(type(value), allowed)
        self.assertFalse(is_dataclass(value))
        if isinstance(value, dict):
            self.assertTrue(all(type(key) is str for key in value))
            for item in value.values():
                self.assert_json_tree(item)
        elif isinstance(value, list):
            for item in value:
                self.assert_json_tree(item)

    def test_api_version_is_0_1(self):
        self.assertEqual("0.1", AUTOMATION_READ_API_VERSION)
        self.assertEqual("0.1", self.api().api_version)

    def test_get_overview_success_envelope(self):
        response = self.api().get_overview()
        self.assertEqual({"api_version", "ok", "data"}, set(response))
        self.assertTrue(response["ok"])
        self.assertEqual("0.1", response["api_version"])
        self.assertEqual(2, response["data"]["total_workflows"])

    def test_list_workflows_success(self):
        response = self.api().list_workflows()
        self.assertTrue(response["ok"])
        self.assertEqual(2, len(response["data"]))

    def test_get_workflow_uses_full_identity(self):
        response = self.api().get_workflow(self.workflow_identity())
        self.assertTrue(response["ok"])
        self.assertEqual("synthetic-workflow-001", response["data"]["identity"]["external_workflow_id"])

    def test_get_workflow_name_is_not_identity(self):
        response = self.api().get_workflow("Zulu Workflow")
        self.assertFalse(response["ok"])
        self.assertEqual("invalid_identity", response["error"]["code"])

    def test_missing_workflow_is_not_found(self):
        response = self.api().get_workflow(self.workflow_identity("missing-workflow"))
        self.assertFalse(response["ok"])
        self.assertEqual("not_found", response["error"]["code"])

    def test_invalid_workflow_identity_is_error_envelope(self):
        response = self.api().get_workflow({"provider_kind": "n8n"})
        self.assertEqual("invalid_identity", response["error"]["code"])

    def test_invalid_workflow_identity_dto_does_not_escape_exception(self):
        dto = WorkflowIdentityInput("INVALID KIND", "", "workflow")
        response = self.api().get_workflow(dto)
        self.assertFalse(response["ok"])
        self.assertEqual("invalid_identity", response["error"]["code"])

    def test_list_results_success(self):
        response = self.api().list_results()
        self.assertTrue(response["ok"])
        self.assertEqual(6, len(response["data"]))

    def test_get_result_success(self):
        response = self.api().get_result(self.execution_identity())
        self.assertTrue(response["ok"])
        self.assertEqual(self.execution_identity()["execution_external_id"], response["data"]["execution_external_id"])

    def test_missing_result_is_not_found(self):
        identity = self.execution_identity() | {"execution_external_id": "missing-execution"}
        response = self.api().get_result(identity)
        self.assertEqual("not_found", response["error"]["code"])

    def test_invalid_result_identity_is_error_envelope(self):
        response = self.api().get_result({"execution_external_id": "only-one-field"})
        self.assertEqual("invalid_identity", response["error"]["code"])

    def test_invalid_execution_identity_dto_does_not_escape_exception(self):
        response = self.api().get_result(ExecutionIdentityInput("INVALID", "", "execution"))
        self.assertEqual("invalid_identity", response["error"]["code"])

    def test_list_unresolved_results(self):
        response = self.api().list_unresolved_results()
        self.assertTrue(response["ok"])
        self.assertEqual(1, len(response["data"]))
        self.assertEqual("provider_instance_unresolved", response["data"][0]["unresolved_reason"])

    def test_orphan_results_are_queryable(self):
        response = self.api().list_orphan_results()
        self.assertTrue(response["ok"])
        self.assertEqual(1, len(response["data"]))
        self.assertEqual("result_only_orphan_static_not_observed", response["data"][0]["classification"])

    def test_execution_business_axes_remain_separate(self):
        response = self.api().list_results(business_status="partial")
        self.assertEqual(1, len(response["data"]))
        self.assertEqual("success", response["data"][0]["execution_status"])
        self.assertEqual("partial", response["data"][0]["business_status"])

    def test_runtime_remains_not_observed(self):
        response = self.api().get_overview()
        self.assertEqual(0, response["data"]["runtime_observed_count"])
        self.assertEqual("not_observed", response["data"]["runtime_status"])

    def test_historical_success_does_not_change_runtime(self):
        workflow = self.api().get_workflow(self.workflow_identity())["data"]
        self.assertGreater(workflow["historical_summary"]["execution_success_count"], 0)
        self.assertEqual("not_observed", workflow["runtime_status"])

    def test_static_definition_is_not_overwritten_by_result(self):
        workflow = self.api().get_workflow(self.workflow_identity())["data"]
        self.assertEqual("inactive", workflow["definition_status"])
        self.assertEqual("success", workflow["latest_execution_status"])

    def test_caller_declared_marker_is_visible(self):
        results = self.api().list_results()["data"]
        resolved = next(item for item in results if item["provider_instance_id"] is not None)
        self.assertTrue(resolved["caller_declared_context"])
        self.assertEqual("caller_declared", resolved["provider_instance_context_source"])

    def test_response_is_json_serializable(self):
        encoded = serialize_read_api_response(self.api().get_overview())
        self.assertEqual(self.api().get_overview(), json.loads(encoded))

    def test_datetime_is_iso_8601_string(self):
        dated = next(item for item in self.api().list_results()["data"] if item["observed_at"] is not None)
        self.assertIsInstance(dated["observed_at"], str)
        self.assertIsNotNone(datetime.fromisoformat(dated["observed_at"]).utcoffset())

    def test_enum_values_are_strings(self):
        result = self.api().list_results()["data"][0]
        self.assertIs(type(result["execution_status"]), str)
        self.assertIs(type(result["business_status"]), str)
        self.assertIs(type(result["evidence"]["source_classification"]), str)

    def test_response_contains_no_dataclass_or_custom_object(self):
        self.assert_json_tree(self.api().get_overview())
        self.assert_json_tree(self.api().list_workflows())
        self.assert_json_tree(self.api().list_results())

    def test_response_contains_no_path(self):
        response = self.api().list_results()
        self.assertFalse(any(isinstance(value, Path) for value in response.values()))
        self.assert_json_tree(response)

    def test_response_contains_no_set_or_tuple(self):
        response = self.api().get_workflow(self.workflow_identity())
        self.assert_json_tree(response)

    def test_mutating_response_does_not_change_internal_state(self):
        api = self.api()
        first = api.list_workflows()
        original = first["data"][0]["display_name"]
        first["data"][0]["display_name"] = "MUTATED"
        first["data"].append({"unexpected": True})
        second = api.list_workflows()
        self.assertEqual(2, len(second["data"]))
        self.assertEqual(original, second["data"][0]["display_name"])

    def test_mutating_nested_result_does_not_affect_second_call(self):
        api = self.api()
        first = api.list_results()
        original = first["data"][0]["safe_result_summary"]
        first["data"][0]["safe_result_summary"] = "MUTATED"
        self.assertEqual(original, api.list_results()["data"][0]["safe_result_summary"])

    def test_raw_payload_does_not_appear(self):
        encoded = serialize_read_api_response(self.api().list_results()).lower()
        for forbidden in ("source_url", "web_text", "raw_payload", "execute_log", "full_content"):
            self.assertNotIn(forbidden, encoded)

    def test_secret_sentinel_does_not_appear(self):
        responses = (
            self.api().get_overview(),
            self.api().list_workflows(),
            self.api().list_results(),
            self.api().list_unresolved_results(),
        )
        self.assertNotIn("FAKE_SECRET_VALUE", serialize_read_api_response({"api_version": "0.1", "ok": True, "data": responses}))

    def test_legacy_absolute_path_does_not_appear(self):
        encoded = serialize_read_api_response(self.api().list_results())
        self.assertNotIn("个人数字资产中心", encoded)
        self.assertNotIn("E:\\", encoded)
        self.assertNotIn("E:/", encoded)

    def test_safe_internal_error_does_not_leak_exception(self):
        class ExplodingService(UnifiedAutomationQueryService):
            def get_overview(self):
                raise RuntimeError("FAKE_SECRET_VALUE E:\\private traceback")

        response = AutomationReadAPI(self.query_service(ExplodingService)).get_overview()
        encoded = json.dumps(response)
        self.assertEqual("internal_invariant_violation", response["error"]["code"])
        self.assertNotIn("FAKE_SECRET_VALUE", encoded)
        self.assertNotIn("traceback", encoded.lower())
        self.assertNotIn("E:\\", encoded)

    def test_workflow_ordering_is_deterministic(self):
        api = self.api()
        first = api.list_workflows()["data"]
        second = api.list_workflows()["data"]
        self.assertEqual(first, second)
        self.assertEqual(["Alpha Workflow", "Zulu Workflow"], [item["display_name"] for item in first])

    def test_result_ordering_is_deterministic(self):
        api = self.api()
        first = api.list_results()["data"]
        self.assertEqual(first, api.list_results()["data"])
        dated = [item["observed_at"] for item in first if item["observed_at"] is not None]
        self.assertEqual(dated, sorted(dated, reverse=True))

    def test_workflow_provider_filters(self):
        api = self.api()
        self.assertEqual(2, len(api.list_workflows(provider_kind="n8n")["data"]))
        self.assertEqual(0, len(api.list_workflows(provider_kind="other")["data"]))
        self.assertEqual(2, len(api.list_workflows(provider_instance_id="instance-a")["data"]))

    def test_workflow_definition_trigger_and_text_filters(self):
        api = self.api()
        self.assertEqual(2, len(api.list_workflows(definition_status="inactive")["data"]))
        self.assertEqual(2, len(api.list_workflows(trigger_type="form")["data"]))
        self.assertEqual(1, len(api.list_workflows(text="alpha")["data"]))

    def test_invalid_workflow_filter_is_invalid_query(self):
        response = self.api().list_workflows(definition_status="currently_healthy")
        self.assertEqual("invalid_query", response["error"]["code"])

    def test_result_execution_filter(self):
        response = self.api().list_results(execution_status="failed")
        self.assertTrue(response["ok"])
        self.assertTrue(all(item["execution_status"] == "failed" for item in response["data"]))

    def test_result_business_and_sandbox_filters(self):
        api = self.api()
        partial = api.list_results(business_status="partial", sandbox=True)["data"]
        self.assertEqual(1, len(partial))
        self.assertEqual(0, len(api.list_results(sandbox=False)["data"]))

    def test_result_workflow_identity_filter(self):
        response = self.api().list_results(workflow_identity=self.workflow_identity())
        self.assertEqual(4, len(response["data"]))
        self.assertTrue(all(item["workflow_external_id"] == "synthetic-workflow-001" for item in response["data"]))

    def test_invalid_result_filters(self):
        api = self.api()
        self.assertEqual("invalid_query", api.list_results(sandbox="yes")["error"]["code"])
        self.assertEqual("invalid_query", api.list_results(execution_status="running")["error"]["code"])
        self.assertEqual("invalid_identity", api.list_results(workflow_identity={})["error"]["code"])

    def test_unresolved_filters(self):
        api = self.api()
        self.assertEqual(1, len(api.list_unresolved_results(provider_kind="n8n")["data"]))
        self.assertEqual(0, len(api.list_unresolved_results(provider_kind="other")["data"]))

    def test_bootstrap_accepts_explicit_query_service(self):
        service = self.query_service()
        api = build_read_api(service)
        self.assertIsInstance(api, AutomationReadAPI)
        self.assertTrue(api.get_overview()["ok"])

    def test_bootstrap_rejects_non_query_input(self):
        with self.assertRaises(TypeError):
            build_read_api({})

    def test_public_api_has_no_filesystem_or_legacy_scanner(self):
        tree = ast.parse(PUBLIC_API_PATH.read_text(encoding="utf-8"))
        imported_roots = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".")[0])
        self.assertNotIn("pathlib", imported_roots)
        self.assertNotIn("os", imported_roots)
        self.assertNotIn("glob", imported_roots)
        self.assertNotIn("adapters", imported_roots)

    def test_public_api_has_no_network_runtime_or_execution_commands(self):
        imported = PUBLIC_API_PATH.read_text(encoding="utf-8").lower()
        for dependency in ("requests", "httpx", "urllib", "socket", "fastapi", "flask"):
            self.assertNotIn(f"import {dependency}", imported)
        for command in ("execute", "activate", "invoke", "schedule", "webhook", "read_runtime", "scan_legacy"):
            self.assertFalse(hasattr(AutomationReadAPI, command))

    def test_ui_compatibility_fixture_is_synthetic_and_complete(self):
        self.assertEqual("synthetic_ui_compatibility_fixture", self.ui_fixture["classification"])
        self.assertFalse(self.ui_fixture["source_data_copied"])
        for endpoint in ("overview", "workflow_list", "workflow_detail", "result_list", "result_detail", "unresolved_result"):
            self.assertIn(endpoint, self.ui_fixture)
            self.assertEqual("0.1", self.ui_fixture[endpoint]["api_version"])
            self.assertTrue(self.ui_fixture[endpoint]["ok"])

    def test_ui_fixture_contains_no_legacy_content(self):
        encoded = json.dumps(self.ui_fixture, ensure_ascii=False)
        self.assertNotIn("个人数字资产中心", encoded)
        self.assertNotIn("FAKE_SECRET_VALUE", encoded)
        self.assertNotIn("source_url", encoded)

    def test_required_error_codes_are_frozen(self):
        values = {item.value for item in ReadAPIErrorCode}
        self.assertTrue({"not_found", "invalid_identity", "invalid_query", "ambiguous", "internal_invariant_violation"}.issubset(values))

    def test_serialization_is_deterministic(self):
        response = self.api().list_workflows()
        self.assertEqual(serialize_read_api_response(response), serialize_read_api_response(response))

    def test_every_top_level_response_has_version(self):
        api = self.api()
        responses = (
            api.get_overview(),
            api.list_workflows(),
            api.get_workflow(self.workflow_identity()),
            api.list_results(),
            api.get_result(self.execution_identity()),
            api.list_unresolved_results(),
            api.list_orphan_results(),
        )
        self.assertTrue(all(item["api_version"] == "0.1" for item in responses))


if __name__ == "__main__":
    unittest.main()
