import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
import importlib.util


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from automation_center import ArtifactFilenamePolicy, build_automation_read_context, build_control_api  # noqa: E402
from automation_center.application import build_control_service  # noqa: E402
from automation_center.auth_metadata import CANONICAL_WORKFLOW_SHA256  # noqa: E402
from automation_center.metadata_reconcile import (  # noqa: E402
    PRODUCTION_DEFINITION_SHA256, PRODUCTION_WORKFLOW_UPDATED_AT, PRODUCTION_WORKFLOW_VERSION_ID,
)
from automation_center.production_update import (  # noqa: E402
    BACKUP_ID, BACKUP_RELATIVE_PATH, BACKUP_SHA256, CANDIDATE_ID, CANDIDATE_SHA256,
    CANDIDATE_VERSION_ID, OLD_CANDIDATE_SHA256, ROLLBACK_ID,
    build_activation_strategy, build_candidate_diffs, build_candidate_validation,
    build_first_run_gate, build_post_publish_verification, build_production_revision_lock,
    build_production_update_request, build_production_update_status, build_publish_approval_payload,
    build_restore_payload, build_result_artifact_validation, build_sandbox_validation,
    verify_revision_lock,
)


FIXTURES = MODULE_ROOT / "fixtures" / "tiangong_run_prep"
CANDIDATE = FIXTURES / "knowledge_collect_v141_hardened.api_compatible.candidate.json"
BACKUP = FIXTURES / "ymYh8t76VP3jGPbr_0fd6b9b7-ee0d-44b3-a494-7469be49bf96_20260803T041422460Z.production.backup.json"
AUTHENTICATED_BACKUP = MODULE_ROOT / BACKUP_RELATIVE_PATH
LATEST_RECHECK = FIXTURES / "latest_revision_recheck.json"
MANIFEST = FIXTURES / "api_compatible_candidate.manifest.json"
RECONCILIATION = FIXTURES / "candidate_api_compat.diff.json"
RESTORE_DRY_RUN = FIXTURES / "restore_dry_run.summary.json"
SANDBOX = FIXTURES / "candidate_api_compat_sandbox_evidence" / "summary.json"


class TiangongProductionUpdateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = json.loads(CANDIDATE.read_text(encoding="utf-8"))
        cls.backup = json.loads(BACKUP.read_text(encoding="utf-8"))
        cls.authenticated_backup = json.loads(AUTHENTICATED_BACKUP.read_text(encoding="utf-8"))
        cls.latest_recheck = json.loads(LATEST_RECHECK.read_text(encoding="utf-8"))
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.reconciliation = json.loads(RECONCILIATION.read_text(encoding="utf-8"))
        cls.restore_dry_run = json.loads(RESTORE_DRY_RUN.read_text(encoding="utf-8"))
        cls.sandbox = json.loads(SANDBOX.read_text(encoding="utf-8"))

    def test_revision_lock_matches_frozen_production_and_rejects_concurrent_change(self):
        lock = build_production_revision_lock()
        self.assertEqual(PRODUCTION_WORKFLOW_VERSION_ID, lock.expected_revision)
        self.assertEqual(PRODUCTION_WORKFLOW_UPDATED_AT, lock.expected_updated_at)
        self.assertEqual(BACKUP_SHA256, lock.expected_definition_sha256)
        self.assertEqual("MATCHED", lock.latest_authenticated_recheck)
        matched = verify_revision_lock(
            lock, observed_revision=PRODUCTION_WORKFLOW_VERSION_ID, observed_updated_at=PRODUCTION_WORKFLOW_UPDATED_AT
        )
        self.assertEqual("MATCHED", matched["state"])
        self.assertTrue(matched["publish_eligible"])
        changed = verify_revision_lock(lock, observed_revision="different", observed_updated_at=PRODUCTION_WORKFLOW_UPDATED_AT)
        self.assertEqual("CONCURRENT_MODIFICATION_DETECTED", changed["state"])
        self.assertFalse(changed["publish_eligible"])
        self.assertFalse(changed["production_write_performed"])

    def test_immutable_backup_is_exact_historical_production_export(self):
        source = next((MODULE_ROOT / "source_import").rglob("current_ui_export.json"))
        self.assertEqual(source.read_bytes(), BACKUP.read_bytes())
        self.assertEqual(PRODUCTION_DEFINITION_SHA256, hashlib.sha256(BACKUP.read_bytes()).hexdigest().upper())
        item = self.backup[0]
        self.assertEqual("ymYh8t76VP3jGPbr", item["id"])
        self.assertEqual(PRODUCTION_WORKFLOW_VERSION_ID, item["versionId"])
        self.assertEqual(False, item["active"])
        self.assertEqual(BACKUP_SHA256, hashlib.sha256(AUTHENTICATED_BACKUP.read_bytes()).hexdigest().upper())
        self.assertEqual(BACKUP_RELATIVE_PATH, self.latest_recheck["backup_relative_path"])
        self.assertTrue(self.latest_recheck["semantic_definition_match"])
        self.assertTrue(self.manifest["old_candidate"]["approval_invalidated"])

    def test_candidate_is_created_from_canonical_without_overwriting_it(self):
        canonical = next(path for path in (MODULE_ROOT / "source_import").rglob("*V1.4.1*.json") if "output" in path.parts)
        self.assertEqual(CANONICAL_WORKFLOW_SHA256, hashlib.sha256(canonical.read_bytes()).hexdigest().upper())
        self.assertEqual(CANDIDATE_SHA256, hashlib.sha256(CANDIDATE.read_bytes()).hexdigest().upper())
        self.assertEqual("knowledge-collect-v141-hardened-api-compatible-002", CANDIDATE_ID)
        self.assertEqual("candidate-package-002", CANDIDATE_VERSION_ID)
        self.assertEqual({"name", "nodes", "connections", "settings"}, set(self.candidate))
        self.assertNotIn("active", self.candidate)
        self.assertNotIn("versionId", self.candidate)
        self.assertEqual(22, len(self.candidate["nodes"]))

    def test_filename_hardening_node_and_safe_output_expression_are_in_workflow(self):
        safety = next(node for node in self.candidate["nodes"] if node["name"] == "输入与路径安全校验")
        code = safety["parameters"]["jsCode"]
        for token in ("INVALID_AI_NAME_TRAVERSAL", "INVALID_AI_NAME_RESERVED", "INVALID_AI_NAME_TOO_LONG", "safe_ai_name"):
            self.assertIn(token, code)
        write = next(node for node in self.candidate["nodes"] if node["name"] == "Read/Write Files from Disk")
        self.assertEqual("=/knowledge/00_待审核/AI工具/{{ $('输入与路径安全校验').item.json.safe_ai_name }}.md", write["parameters"]["fileName"])
        self.assertNotIn("Edit Fields').item.json.ai_name", write["parameters"]["fileName"])
        self.assertEqual("输入与路径安全校验", self.candidate["connections"]["On form submission"]["main"][0][0]["node"])

    def test_candidate_safety_js_harness_covers_filename_and_url_cases(self):
        result = subprocess.run(
            ["node", str(MODULE_ROOT / "scripts" / "validate_tiangong_candidate_safety.js")],
            text=True, encoding="utf-8", capture_output=True, check=True,
        )
        values = json.loads(result.stdout)["results"]
        for name in ("normal", "chinese", "spaces_inside", "public_url"):
            self.assertTrue(values[name]["accepted"], name)
        for name in (
            "dotdot", "slash_traversal", "backslash_traversal", "absolute_windows", "reserved",
            "illegal_chars", "trailing_dot", "trailing_spaces", "overlong", "localhost_url",
            "loopback_url", "private_url", "metadata_url", "file_url",
        ):
            self.assertFalse(values[name]["accepted"], name)

    def test_workflow_filename_policy_is_semantically_compatible_with_nexa_policy(self):
        result = subprocess.run(
            ["node", str(MODULE_ROOT / "scripts" / "validate_tiangong_candidate_safety.js")],
            text=True, encoding="utf-8", capture_output=True, check=True,
        )
        values = json.loads(result.stdout)["results"]
        policy = ArtifactFilenamePolicy()
        accepted = {"normal": "Claude Code", "chinese": "通义千问", "spaces_inside": "Claude Code Pro"}
        rejected = {
            "dotdot": "..", "slash_traversal": "../evil", "backslash_traversal": "..\\evil",
            "absolute_windows": "C:\\evil", "reserved": "CON", "illegal_chars": "bad:name",
            "trailing_dot": "name.", "trailing_spaces": "name ", "overlong": "a" * 121,
        }
        for case, stem in accepted.items():
            self.assertTrue(values[case]["accepted"], case)
            self.assertEqual(f"{stem}.md", policy.validate(stem))
        for case, stem in rejected.items():
            self.assertFalse(values[case]["accepted"], case)
            with self.subTest(case=case), self.assertRaises(ValueError):
                policy.validate(stem)
        for stem in (" leading", "trailing ", "bad\nname", "bad\x7fname"):
            with self.subTest(stem=stem), self.assertRaises(ValueError):
                policy.validate(stem)

    def test_ssrf_guard_is_minimal_and_residual_dns_risk_is_not_hidden(self):
        validation = build_candidate_validation()
        self.assertIn("DNS_REBINDING_RESIDUAL", validation["ssrf_safety"])
        code = next(node for node in self.candidate["nodes"] if node["name"] == "输入与路径安全校验")["parameters"]["jsCode"]
        for target in ("localhost", "127\\.", "169\\.254", "192\\.168", "172\\.", "::1"):
            self.assertIn(target, code)

    def test_candidate_graph_is_structurally_valid_and_deterministic(self):
        names = [node["name"] for node in self.candidate["nodes"]]
        ids = [node["id"] for node in self.candidate["nodes"]]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(len(ids), len(set(ids)))
        for source, groups in self.candidate["connections"].items():
            self.assertIn(source, names)
            for branches in groups.values():
                for branch in branches:
                    for edge in branch:
                        self.assertIn(edge["node"], names)
        edges = sum(len(branch) for groups in self.candidate["connections"].values() for branches in groups.values() for branch in branches)
        self.assertEqual(26, edges)
        self.assertEqual(1, sum(node["type"] == "n8n-nodes-base.formTrigger" for node in self.candidate["nodes"]))
        self.assertEqual(1, sum(node["type"] == "n8n-nodes-base.errorTrigger" for node in self.candidate["nodes"]))
        self.assertNotIn("onError", self.candidate["settings"])
        self.assertNotIn("binaryMode", self.candidate["settings"])
        self.assertEqual(
            {"读取来源网页": "continueErrorOutput", "提取网页正文": "continueErrorOutput"},
            {node["name"]: node["onError"] for node in self.candidate["nodes"] if "onError" in node},
        )
        self.assertEqual("PASS", build_candidate_validation()["state"])

    def test_canonical_and_production_diffs_are_precise(self):
        diffs = build_candidate_diffs()
        canonical = diffs["canonical_to_candidate"]
        self.assertEqual(["输入与路径安全校验"], canonical["nodes_added"])
        self.assertEqual(["Read/Write Files from Disk"], canonical["nodes_modified"])
        self.assertFalse(canonical["input_schema_changed"])
        self.assertFalse(canonical["llm_call_changed"])
        self.assertFalse(canonical["knowledge_root_changed"])
        production = diffs["production_to_candidate"]
        self.assertEqual(11, production["production_nodes"])
        self.assertEqual(22, production["candidate_nodes"])
        self.assertIn("读取网页失败", production["nodes_added"])
        self.assertIn("输入与路径安全校验", production["nodes_added"])

    def test_machine_reconciliation_completely_accounts_for_nodes_edges_and_paths(self):
        value = self.reconciliation
        self.assertEqual("PASS_MINIMAL_API_REQUEST_PROJECTION", value["state"])
        self.assertEqual(OLD_CANDIDATE_SHA256, value["old_candidate_sha256"])
        self.assertEqual(CANDIDATE_SHA256, value["new_candidate_sha256"])
        self.assertEqual(["binaryMode", "onError"], value["api_compatibility_diff"]["settings_omitted"])
        self.assertFalse(value["api_compatibility_diff"]["nodes_changed"])
        self.assertFalse(value["api_compatibility_diff"]["connections_changed"])
        self.assertEqual("14/14 PASS", value["failure_handling_equivalence"]["sandbox_revalidation"])
        self.assertFalse(value["invariants"]["canonical_written"])
        self.assertFalse(value["invariants"]["production_written"])
        manifest_item = self.manifest["diff"]
        self.assertEqual(hashlib.sha256(RECONCILIATION.read_bytes()).hexdigest().upper(), manifest_item["sha256"])

    def test_isolated_sandbox_14_cases_and_six_state_regression_pass(self):
        self.assertEqual("PASS", self.sandbox["state"])
        self.assertEqual(CANDIDATE_SHA256, self.sandbox["candidate_sha256"])
        self.assertEqual(14, len(self.sandbox["cases"]))
        self.assertTrue(all(item["passed"] for item in self.sandbox["cases"]))
        self.assertEqual("DOCKER_INTERNAL_ONLY", self.sandbox["network"])
        self.assertFalse(self.sandbox["production_credentials"])
        self.assertFalse(self.sandbox["production_docker_modified"])
        six = build_sandbox_validation()["six_state_regression"]
        self.assertEqual("PASS_REUSED_UNCHANGED_BUSINESS_SUBGRAPH", six["state"])
        self.assertEqual(["42", "43", "44", "45", "46", "47"], six["execution_ids"])
        for item in six["evidence"]:
            evidence = MODULE_ROOT / item["locator"]
            self.assertTrue(evidence.is_file())
            self.assertEqual(item["sha256"], hashlib.sha256(evidence.read_bytes()).hexdigest().upper())
        baseline_text = (MODULE_ROOT / six["evidence"][0]["locator"]).read_text(encoding="utf-8")
        for execution_id in six["execution_ids"]:
            self.assertIn(f"execution {execution_id}", baseline_text)

    def test_sandbox_artifacts_are_safe_markdown_and_failures_write_none(self):
        success = [item for item in self.sandbox["cases"] if item["expected"] == "SUCCESS"]
        failures = [item for item in self.sandbox["cases"] if item["expected"] != "SUCCESS"]
        self.assertTrue(all(item["artifact_count"] == 1 and item["artifact_sha256"] for item in success))
        self.assertTrue(all(item["artifact_count"] == 0 for item in failures))
        artifact = build_result_artifact_validation()
        self.assertEqual("PASS", artifact["state"])
        self.assertEqual("/knowledge/00_待审核/AI工具/{safe_ai_name}.md", artifact["path_template"])
        self.assertFalse(artifact["raw_execution_payload_exposed"])
        self.assertFalse(artifact["production_content_read"])
        retained = [path.relative_to(SANDBOX.parent).as_posix() for path in SANDBOX.parent.rglob("*") if path.is_file()]
        self.assertEqual(["summary.json"], retained)

    def test_rollback_payload_is_exact_and_dry_run_only(self):
        rollback = build_restore_payload()
        self.assertEqual(ROLLBACK_ID, rollback["rollback_id"])
        self.assertEqual(BACKUP_ID, rollback["backup_id"])
        self.assertEqual(PRODUCTION_WORKFLOW_VERSION_ID, rollback["backup_revision"])
        self.assertEqual(BACKUP_SHA256, rollback["backup_sha256"])
        self.assertEqual(BACKUP_RELATIVE_PATH, rollback["backup_relative_path"])
        self.assertEqual("RESTORE_ROUTE_READY_SEMANTIC_EQUIVALENCE_VALIDATED", rollback["state"])
        self.assertFalse(rollback["restore_performed"])
        self.assertFalse(rollback["production_write_performed"])
        self.assertEqual("PASS_SEMANTIC_EQUIVALENCE_REUSE", self.restore_dry_run["state"])
        self.assertEqual(BACKUP_SHA256, self.restore_dry_run["backup_sha256"])
        self.assertFalse(self.restore_dry_run["content_addressed_evidence_reused"])
        self.assertTrue(self.restore_dry_run["fresh_definition_semantically_matches_validated_production"])
        self.assertTrue(self.restore_dry_run["restored_identity_match"])
        self.assertTrue(self.restore_dry_run["semantic_structure_match"])
        self.assertEqual("NONE", self.restore_dry_run["network"])
        self.assertTrue(self.restore_dry_run["transient_store_deleted"])
        self.assertFalse(self.restore_dry_run["production_endpoint_used"])
        self.assertFalse(self.restore_dry_run["production_write_performed"])
        self.assertFalse(self.restore_dry_run["restore_performed"])

    def test_publish_request_is_ready_but_requires_definition_update_approval(self):
        request = build_production_update_request()
        self.assertEqual("READY_FOR_DEFINITION_UPDATE_REAPPROVAL", request["state"])
        self.assertEqual("DEFINITION_UPDATE_REAPPROVAL_REQUIRED", request["publish_state"])
        self.assertTrue(request["user_approval_required"])
        self.assertEqual(CANDIDATE_SHA256, request["candidate_sha256"])
        self.assertEqual(OLD_CANDIDATE_SHA256, request["old_candidate_sha256"])
        self.assertTrue(request["old_approval_invalidated"])
        self.assertEqual(BACKUP_SHA256, request["backup_sha256"])
        self.assertFalse(request["production_action_performed"])
        approval = build_publish_approval_payload()
        self.assertEqual(["APPROVE_DEFINITION_UPDATE", "VIEW_DIFF", "CANCEL"], approval["actions"])
        self.assertEqual("READY_FOR_DEFINITION_UPDATE_REAPPROVAL", approval["state"])
        self.assertEqual("DEFINITION_UPDATE_ONLY", approval["approval_scope"])
        self.assertTrue(approval["old_approval_invalidated"])
        self.assertFalse(approval["approval_granted"])
        self.assertFalse(approval["production_action_performed"])

    def test_update_publish_and_activate_are_separate(self):
        strategy = build_activation_strategy()
        self.assertFalse(strategy["update_implies_publish"])
        self.assertFalse(strategy["update_implies_activate"])
        self.assertFalse(strategy["automatic_activation"])
        self.assertEqual("UPDATE_DEFINITION", strategy["steps"][0]["action"])
        self.assertEqual("VERIFY_NEW_REVISION_AND_STRUCTURE", strategy["steps"][1]["action"])
        self.assertEqual("PUBLISH_OR_ACTIVATE", strategy["steps"][2]["action"])

    def test_post_publish_verification_and_first_run_gate_are_closed(self):
        verify = build_post_publish_verification()
        self.assertEqual("PUBLISH_VERIFICATION_FAILED", verify["mismatch_state"])
        self.assertFalse(verify["first_run_allowed_on_mismatch"])
        self.assertFalse(verify["performed"])
        gate = build_first_run_gate()
        self.assertEqual("BLOCKED_UNTIL_PRODUCTION_UPDATE_VERIFIED", gate["state"])
        self.assertFalse(gate["workflow_execution_performed"])

    def test_read_and_control_api_show_reapproval_required(self):
        direct = build_production_update_status()
        read = build_automation_read_context().get_tiangong_production_update()
        control = build_control_api(build_control_service()).get_tiangong_production_update()
        self.assertTrue(read["ok"])
        self.assertTrue(control["ok"])
        self.assertEqual(direct["state"], read["data"]["state"])
        self.assertEqual("READY_FOR_DEFINITION_UPDATE_REAPPROVAL", read["data"]["publish_state"])
        self.assertEqual("REQUIRED", control["data"]["user_approval"])
        self.assertFalse(read["data"]["ready_to_publish"])
        self.assertEqual("INACTIVE_UNPUBLISHED_LEGACY_DEFINITION", read["data"]["current_production"]["state"])
        self.assertTrue(read["data"]["update_required"])
        self.assertEqual("BLOCKED_UNTIL_VERIFIED_PRODUCTION_UPDATE", control["data"]["run_state"])
        self.assertEqual("READY", control["data"]["repair_diagnosis_state"])
        self.assertFalse(read["data"]["workflow_ready"])

    def test_recheck_backup_script_is_hidden_get_only_and_has_no_production_write(self):
        path = MODULE_ROOT / "scripts" / "tiangong_revision_recheck_backup.py"
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        self.assertIn("getpass.getpass", source)
        self.assertIn("AuthenticatedLoopbackTransport", source)
        self.assertIn("PRODUCTION_REVISION_CHANGED", source)
        self.assertIn("semantic_definition_match", source)
        self.assertIn("evaluate_revision_lock(payload, historical)", source)
        self.assertIn("TemporaryDirectory", (MODULE_ROOT / "scripts" / "run_tiangong_candidate_sandbox.py").read_text(encoding="utf-8"))
        calls = {
            node.func.attr.lower()
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }
        self.assertIn("get_json", calls)
        self.assertTrue({"post", "put", "patch", "delete", "publish", "activate"}.isdisjoint(calls))

    def test_recheck_lock_accepts_equivalent_utc_format_and_rejects_revision_or_definition_change(self):
        path = MODULE_ROOT / "scripts" / "tiangong_revision_recheck_backup.py"
        spec = importlib.util.spec_from_file_location("tiangong_revision_recheck_backup_test", path)
        self.assertIsNotNone(spec)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        historical_value = json.loads(BACKUP.read_text(encoding="utf-8"))
        historical = historical_value[0]
        payload = dict(historical)
        payload["updatedAt"] = "2026-08-03T04:14:22.460Z"
        matched = module.evaluate_revision_lock(payload, historical)
        self.assertTrue(matched["matched"])
        self.assertTrue(matched["updated_at_match"])
        changed_revision = dict(payload, versionId="concurrent-change")
        self.assertFalse(module.evaluate_revision_lock(changed_revision, historical)["matched"])
        changed_definition = json.loads(json.dumps(payload))
        changed_definition["settings"]["executionOrder"] = "different"
        changed = module.evaluate_revision_lock(changed_definition, historical)
        self.assertFalse(changed["matched"])
        self.assertFalse(changed["semantic_definition_match"])

    def test_no_secret_or_production_side_effect_is_claimed(self):
        status = build_production_update_status()
        encoded = json.dumps(status, ensure_ascii=False).lower()
        for token in ("fake_n8n_secret_value", "authorization: bearer", "api_key_value"):
            self.assertNotIn(token, encoded)
        effects = status["side_effects"]
        self.assertFalse(effects["credential_persisted"])
        self.assertFalse(effects["secret_exposed"])
        self.assertFalse(effects["production_workflow_write"])
        self.assertFalse(effects["production_execution"])
        self.assertFalse(effects["production_form_submit"])
        self.assertFalse(effects["docker_modification"])


if __name__ == "__main__":
    unittest.main()
