import ast
import hashlib
import json
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
LEGACY_ROOT = MODULE_ROOT / "source_import" / "n8n_工作流开发"
CANONICAL = LEGACY_ROOT / "output" / "中国AI知识库采集器_V1.4.1_网页失败兜底版.json"
SANDBOX = LEGACY_ROOT / "_system" / "n8n_runtime_test" / "中国AI知识库采集器_V1.4.1_隔离测试版.json"
PARSED = LEGACY_ROOT / "_system" / "n8n_runtime_test" / "evidence" / "authbridge5_parsed_results.json"
SUMMARY = LEGACY_ROOT / "_system" / "n8n_runtime_test" / "evidence" / "authbridge5_run_summary.json"
DEPLOY_VALIDATOR = LEGACY_ROOT / "_system" / "n8n_deployment" / "deploy_validate.py"
RUNTIME_RUNNER = LEGACY_ROOT / "_system" / "n8n_runtime_test" / "run_isolated_tests.ps1"
sys.path.insert(0, str(SRC_ROOT))

import automation_center  # noqa: E402
from automation_center import build_automation_read_context  # noqa: E402


class SourceReconciliationEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.canonical = json.loads(CANONICAL.read_text(encoding="utf-8-sig"))
        cls.sandbox = json.loads(SANDBOX.read_text(encoding="utf-8-sig"))
        cls.parsed = json.loads(PARSED.read_text(encoding="utf-8-sig"))
        cls.summary = json.loads(SUMMARY.read_text(encoding="utf-8-sig"))
        cls.api = build_automation_read_context(
            confirmed_provider_instance_id="reconciliation-test-instance"
        )

    def test_legacy_inventory_baseline_is_present(self):
        files = tuple(path for path in LEGACY_ROOT.rglob("*") if path.is_file())
        self.assertEqual(294, len(files))
        self.assertEqual(15_680_304, sum(path.stat().st_size for path in files))

    def test_canonical_workflow_identity_and_hash_are_frozen(self):
        self.assertEqual("ymYh8t76VP3jGPbr", self.canonical["id"])
        self.assertFalse(self.canonical["active"])
        self.assertEqual(21, len(self.canonical["nodes"]))
        self.assertEqual(
            "B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514",
            hashlib.sha256(CANONICAL.read_bytes()).hexdigest().upper(),
        )

    def test_sandbox_identity_is_not_production_identity(self):
        self.assertEqual("V141Final403429", self.sandbox["id"])
        self.assertNotEqual(self.canonical["id"], self.sandbox["id"])
        self.assertEqual(self.sandbox["id"], self.parsed["workflow_id"])

    def test_canonical_triggers_are_projected_without_node_payloads(self):
        canonical_trigger_types = {
            node["type"]
            for node in self.canonical["nodes"]
            if node["type"].endswith("Trigger")
        }
        self.assertEqual(
            {"n8n-nodes-base.formTrigger", "n8n-nodes-base.errorTrigger"},
            canonical_trigger_types,
        )
        workflow = self.api.list_ui_workflows()["data"][0]
        self.assertEqual(
            {"form", "error"},
            {item["trigger_type"] for item in workflow["trigger_summary"]},
        )
        self.assertNotIn("parameters", json.dumps(workflow, ensure_ascii=False).lower())

    def test_six_business_outcomes_and_execution_ids_are_preserved(self):
        cases = self.parsed["cases"]
        self.assertEqual(
            {"success", "empty", "forbidden", "rate_limited", "failed", "not_provided"},
            set(cases),
        )
        self.assertEqual(
            ["42", "43", "44", "45", "46", "47"],
            sorted((item["execution_id"] for item in cases.values()), key=int),
        )
        for name, item in cases.items():
            with self.subTest(name=name):
                self.assertTrue(item["test_output_reached"])
                self.assertEqual(name, item["fields"]["webpage_read_status"])

    def test_engine_success_is_independent_from_business_outcome(self):
        self.assertTrue(all(item["execute_exit_code"] == 0 for item in self.summary))
        results = self.api.list_ui_results()["data"]
        self.assertTrue(all(item["execution_status"] == "success" for item in results))
        self.assertEqual(
            {"success", "partial", "failed"},
            {item["business_status"] for item in results},
        )

    def test_result_intake_does_not_expose_raw_legacy_fields(self):
        encoded = json.dumps(self.api.list_ui_results(), ensure_ascii=False).lower()
        for token in ("source_url", "web_text", "web_error_message", "node_path", "execute_log"):
            self.assertNotIn(token, encoded)

    def test_static_and_sandbox_evidence_authority_remain_distinct(self):
        workflow = self.api.list_ui_workflows()["data"][0]
        self.assertEqual("static_export", workflow["static_evidence"][0]["authority"])
        for result in self.api.list_ui_results()["data"]:
            evidence = result["evidence"]
            self.assertEqual("real_n8n_engine", evidence["execution_engine_reality"])
            self.assertEqual("sandbox_isolated", evidence["environment_class"])
            self.assertEqual("synthetic_or_stubbed", evidence["dependency_class"])
            self.assertTrue(result["historical_result_only"])

    def test_legacy_deploy_and_runtime_tools_remain_reference_only(self):
        self.assertTrue(DEPLOY_VALIDATOR.is_file())
        self.assertTrue(RUNTIME_RUNNER.is_file())
        production_sources = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (SRC_ROOT / "automation_center").rglob("*.py")
        ).lower()
        self.assertNotIn("deploy_validate", production_sources)
        self.assertNotIn("run_isolated_tests", production_sources)

    def test_nexa_has_no_second_workflow_engine_or_deployment_client(self):
        forbidden_imports = {"docker", "requests", "httpx", "subprocess"}
        imported = set()
        sqlite_importers = set()
        for path in (SRC_ROOT / "automation_center").rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names = {alias.name.split(".")[0] for alias in node.names}
                    imported.update(names)
                    if "sqlite3" in names:
                        sqlite_importers.add(path.relative_to(SRC_ROOT).as_posix())
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imported.add(node.module.split(".")[0])
        self.assertFalse(imported & forbidden_imports)
        self.assertEqual(
            {
                "automation_center/adapters/request_ledger.py",
                "automation_center/adapters/owner_read.py",
            },
            sqlite_importers,
            "stdlib SQLite is allowed only for the ledger and its read-only OWNER projection",
        )

    def test_only_one_top_level_read_facade_is_exported(self):
        self.assertEqual(
            ["AutomationReadAPI"],
            [name for name in automation_center.__all__ if name.endswith("ReadAPI")],
        )

    def test_runtime_and_control_remain_fail_closed(self):
        overview = self.api.get_ui_overview()["data"]
        self.assertEqual("not_observed", overview["runtime_status"])
        workflow = self.api.list_ui_workflows()["data"][0]
        self.assertFalse(workflow["ui"]["control_readiness"]["execution_enabled"])


if __name__ == "__main__":
    unittest.main()
