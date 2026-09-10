import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = MODULE_ROOT / "fixtures" / "tiangong_run_prep"
OLD = FIXTURES / "knowledge_collect_v141_hardened.candidate.json"
NEW = FIXTURES / "knowledge_collect_v141_hardened.api_compatible.candidate.json"
DIFF = FIXTURES / "candidate_api_compat.diff.json"
SCHEMA = FIXTURES / "api_schema_validation.json"
OLD_SANDBOX = FIXTURES / "candidate_sandbox_evidence" / "summary.json"
NEW_SANDBOX = FIXTURES / "candidate_api_compat_sandbox_evidence" / "summary.json"
APPROVAL = FIXTURES / "publish_approval.api_compatible.ready.json"
MANIFEST = FIXTURES / "api_compatible_candidate.manifest.json"

OLD_SHA256 = "99BF04515925D7488B50E010B146E382F83F37132D1EFA4822F4F34B191B0A62"
NEW_SHA256 = "002C8F5520B803FECE8387B3D2BC60E7055D9505B4A40131F87D76EACBC02FC9"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_script(name: str, relative_path: str):
    spec = importlib.util.spec_from_file_location(name, MODULE_ROOT / relative_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TiangongAPICompatibleCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old = load(OLD)
        cls.new = load(NEW)
        cls.diff = load(DIFF)
        cls.schema = load(SCHEMA)
        cls.old_sandbox = load(OLD_SANDBOX)
        cls.new_sandbox = load(NEW_SANDBOX)
        cls.approval = load(APPROVAL)
        cls.manifest = load(MANIFEST)

    def test_root_cause_is_legacy_builder_not_candidate_builder_or_serializer(self):
        legacy_builder = (
            MODULE_ROOT / "source_import" / "n8n_工作流开发" / "_system" / "build_v141.py"
        ).read_text(encoding="utf-8")
        candidate_builder = (MODULE_ROOT / "scripts" / "build_tiangong_hardened_candidate.py").read_text(encoding="utf-8")
        self.assertIn('data.setdefault("settings", {})["onError"] = "continueRegularOutput"', legacy_builder)
        self.assertNotIn('settings", {})["onError"]', candidate_builder)
        self.assertEqual("continueRegularOutput", self.old["settings"]["onError"])
        self.assertEqual(
            "LEGACY_BUILDER_INSERTED_UNSUPPORTED_WORKFLOW_SETTING",
            self.diff["root_cause"]["classification"],
        )

    def test_new_candidate_is_exact_public_api_request_projection(self):
        self.assertEqual({"name", "nodes", "connections", "settings"}, set(self.new))
        self.assertEqual({"executionOrder", "availableInMCP"}, set(self.new["settings"]))
        self.assertNotIn("onError", self.new["settings"])
        self.assertNotIn("binaryMode", self.new["settings"])
        for field in ("id", "active", "versionId", "meta", "nodeGroups", "pinData", "tags"):
            self.assertNotIn(field, self.new)
        self.assertEqual(NEW_SHA256, hashlib.sha256(NEW.read_bytes()).hexdigest().upper())

    def test_executable_graph_and_node_level_failure_policy_are_byte_semantically_equal(self):
        self.assertEqual(self.old["nodes"], self.new["nodes"])
        self.assertEqual(self.old["connections"], self.new["connections"])
        self.assertEqual(
            {"读取来源网页": "continueErrorOutput", "提取网页正文": "continueErrorOutput"},
            {node["name"]: node["onError"] for node in self.new["nodes"] if "onError" in node},
        )
        self.assertEqual(1, sum(node["type"] == "n8n-nodes-base.errorTrigger" for node in self.new["nodes"]))
        self.assertNotIn("errorWorkflow", self.new["settings"])

    def test_failure_classification_empty_and_result_paths_remain_present(self):
        names = {node["name"] for node in self.new["nodes"]}
        for name in (
            "HTTP其他失败判断", "判断正文是否为空", "是否为禁止访问", "是否为限流失败",
            "标记为禁止访问", "标记为读取失败", "标记为限流", "标记网页为空",
            "Read/Write Files from Disk", "输入与路径安全校验",
        ):
            self.assertIn(name, names)
        http_outputs = self.new["connections"]["读取来源网页"]["main"]
        self.assertEqual("读取来源网页规范化", http_outputs[0][0]["node"])
        self.assertEqual("标记为读取失败", http_outputs[1][0]["node"])
        self.assertEqual(
            "判断正文是否为空",
            self.new["connections"]["提取网页正文"]["main"][0][0]["node"],
        )

    def test_local_public_api_schema_validation_is_strict_and_passes(self):
        self.assertEqual("PASS", self.schema["state"])
        self.assertEqual([], self.schema["errors"])
        self.assertFalse(self.schema["workflow_additional_properties"])
        self.assertFalse(self.schema["settings_additional_properties"])
        self.assertEqual(["connections", "name", "nodes", "settings"], self.schema["workflow_request_fields"])
        self.assertEqual([], self.schema["workflow_response_only_fields_present"])
        self.assertFalse(self.schema["settings_onError_valid"])
        self.assertTrue(self.schema["node_onError_valid"])
        self.assertEqual(NEW_SHA256, self.schema["candidate_sha256"])

    def test_builder_projection_is_deterministic_and_minimal(self):
        module = load_script("build_tiangong_api_compatible_candidate_test", "scripts/build_tiangong_api_compatible_candidate.py")
        projected = module.project_request_body(self.old)
        raw = (json.dumps(projected, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        self.assertEqual(NEW.read_bytes(), raw)
        self.assertEqual(NEW_SHA256, hashlib.sha256(raw).hexdigest().upper())

    def test_complete_14_case_sandbox_is_behaviorally_identical(self):
        self.assertEqual("PASS", self.new_sandbox["state"])
        self.assertEqual(NEW_SHA256, self.new_sandbox["candidate_sha256"])
        self.assertEqual(14, len(self.new_sandbox["cases"]))
        self.assertTrue(all(item["passed"] for item in self.new_sandbox["cases"]))
        old_results = {
            item["case"]: (item["expected"], item["passed"], item["artifact_count"], item["artifact_sha256"])
            for item in self.old_sandbox["cases"]
        }
        new_results = {
            item["case"]: (item["expected"], item["passed"], item["artifact_count"], item["artifact_sha256"])
            for item in self.new_sandbox["cases"]
        }
        self.assertEqual(old_results, new_results)

    def test_old_approval_is_invalidated_and_r2_authorization_is_consumed_after_rejection(self):
        self.assertEqual(OLD_SHA256, self.approval["old_approval"]["candidate_sha256"])
        self.assertTrue(self.approval["old_approval_invalidated"])
        self.assertFalse(self.approval["old_approval"]["authorization_transferable"])
        self.assertEqual(NEW_SHA256, self.approval["candidate"]["sha256"])
        self.assertEqual("DEFINITION_UPDATE_REJECTED_NO_CHANGE", self.approval["state"])
        self.assertTrue(self.approval["user_approval_required"])
        self.assertTrue(self.approval["approval_granted"])
        self.assertTrue(self.approval["authorization_consumed"])
        self.assertEqual("DEFINITION_UPDATE_ONLY", self.approval["approval_scope"])
        self.assertEqual(NEW_SHA256, self.approval["approved_candidate_sha256"])
        self.assertFalse(self.approval["publish_approved"])
        self.assertFalse(self.approval["activate_approved"])
        self.assertFalse(self.approval["workflow_execution_approved"])

    def test_manifest_hashes_and_zero_production_side_effects(self):
        for key in ("diff", "api_schema_validation", "sandbox", "approval", "contract", "audit", "closeout"):
            item = self.manifest[key]
            path = MODULE_ROOT / item["relative_path"]
            self.assertEqual(item["sha256"], hashlib.sha256(path.read_bytes()).hexdigest().upper())
        effects = self.manifest["production_side_effects"]
        self.assertTrue(all(value is False for value in effects.values()))


if __name__ == "__main__":
    unittest.main()
