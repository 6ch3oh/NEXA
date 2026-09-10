import ast
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
TARGET_MODULE = SRC_ROOT / "automation_center" / "application" / "target_resolution.py"
LEGACY_ROOT = MODULE_ROOT / "source_import" / "n8n_工作流开发"
sys.path.insert(0, str(SRC_ROOT))

from automation_center import PROVIDER_TARGET_VERSION, ProviderTargetResolver, build_provider_target_resolver  # noqa: E402
from automation_center.application import (  # noqa: E402
    ArtifactActionReadiness,
    BackupRestoreReadiness,
    ResolutionState,
    SurfaceClassification,
    build_v141_provider_target_resolution,
    serialize_provider_target,
)


CANONICAL = LEGACY_ROOT / "output" / "中国AI知识库采集器_V1.4.1_网页失败兜底版.json"
SANDBOX = LEGACY_ROOT / "_system" / "n8n_runtime_test" / "中国AI知识库采集器_V1.4.1_隔离测试版.json"


class ProviderTargetResolutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resolution = build_v141_provider_target_resolution()

    def test_version_and_public_resolver(self):
        self.assertEqual(PROVIDER_TARGET_VERSION, "0.1")
        self.assertIsInstance(build_provider_target_resolver(), ProviderTargetResolver)

    def test_provider_instance_stays_unresolved(self):
        provider = self.resolution.provider
        self.assertIsNone(provider.provider_instance_id)
        self.assertEqual(provider.state, ResolutionState.UNRESOLVED)
        self.assertIsNone(provider.stable_endpoint)
        self.assertFalse(provider.runtime_probe_performed)

    def test_historical_container_name_is_not_provider_identity(self):
        provider = self.resolution.provider
        self.assertEqual(provider.observed_container_name, "n8n")
        self.assertNotEqual(provider.observed_container_name, provider.provider_instance_id)

    def test_target_is_only_partially_resolved(self):
        target = self.resolution.target
        self.assertEqual(target.external_workflow_id, "ymYh8t76VP3jGPbr")
        self.assertIsNone(target.provider_instance_id)
        self.assertEqual(target.state, ResolutionState.PARTIALLY_RESOLVED)

    def test_canonical_identity_and_version(self):
        target = self.resolution.target
        self.assertEqual(target.capability_id, "knowledge.collect")
        self.assertEqual(target.canonical_version_id, "802897a6-0644-4927-9bad-3ecc34d8a28b")

    def test_canonical_hash_matches_disk(self):
        self.assertEqual(hashlib.sha256(CANONICAL.read_bytes()).hexdigest().upper(), self.resolution.target.canonical_source_sha256)

    def test_sandbox_hash_matches_disk(self):
        self.assertEqual(hashlib.sha256(SANDBOX.read_bytes()).hexdigest().upper(), self.resolution.target.sandbox_source_sha256)

    def test_sandbox_and_production_are_separated(self):
        target = self.resolution.target
        self.assertTrue(target.sandbox_production_separated)
        self.assertEqual(target.sandbox_external_workflow_id, "V141Final403429")
        self.assertNotEqual(target.external_workflow_id, target.sandbox_external_workflow_id)

    def test_execution_surface_inventory_has_all_classifications_needed(self):
        values = {surface.classification for surface in self.resolution.execution_surfaces}
        self.assertIn(SurfaceClassification.SUPPORTED_EXISTING, values)
        self.assertIn(SurfaceClassification.TEST_ONLY, values)
        self.assertIn(SurfaceClassification.UNRESOLVED, values)

    def test_form_is_recommended_manual_but_not_ai_ready(self):
        surface = next(item for item in self.resolution.execution_surfaces if item.surface_id == "v141-form-trigger")
        self.assertTrue(surface.suitable_for_manual_run)
        self.assertFalse(surface.suitable_for_ai_call)
        self.assertEqual(surface.execution_id_return, ResolutionState.UNRESOLVED)
        self.assertFalse(surface.invocation_performed)

    def test_cli_execution_is_test_only(self):
        surface = next(item for item in self.resolution.execution_surfaces if item.surface_id == "sandbox-cli-execute")
        self.assertEqual(surface.classification, SurfaceClassification.TEST_ONLY)
        self.assertEqual(surface.target_scope, "isolated_sandbox")

    def test_no_surface_claims_invocation(self):
        self.assertTrue(all(not surface.invocation_performed for surface in self.resolution.execution_surfaces))

    def test_publish_inventory_does_not_claim_production_publisher(self):
        production = [item for item in self.resolution.publish_surfaces if item.target_identity == "production_unresolved"]
        self.assertTrue(production)
        self.assertTrue(all(not item.publish_implemented for item in production))

    def test_isolated_import_is_test_only(self):
        surface = next(item for item in self.resolution.publish_surfaces if item.surface_id == "isolated-cli-import")
        self.assertEqual(surface.classification, SurfaceClassification.TEST_ONLY)
        self.assertTrue(surface.publish_implemented)

    def test_backup_restore_is_not_ready(self):
        plan = self.resolution.backup_restore
        self.assertEqual(plan.readiness, BackupRestoreReadiness.NOT_READY)
        self.assertFalse(plan.production_backup_performed)
        self.assertFalse(plan.production_restore_performed)
        self.assertIn("export_current_production_workflow", plan.required_backup_steps)
        self.assertIn("restore_exact_backup_on_failure", plan.required_restore_steps)

    def test_artifact_is_real_markdown_chain(self):
        artifact = self.resolution.result_artifact
        self.assertEqual(artifact.media_type, "text/markdown")
        self.assertEqual(artifact.source_result_field, "text")
        self.assertEqual(artifact.provider_logical_path_template, "/knowledge/00_待审核/AI工具/{ai_name}.md")
        self.assertEqual(artifact.producer_nodes, ("Basic LLM Chain", "Convert to File", "Read/Write Files from Disk"))

    def test_artifact_actions_fail_closed(self):
        artifact = self.resolution.result_artifact
        self.assertEqual(artifact.execution_correlation, ResolutionState.UNRESOLVED)
        self.assertEqual(artifact.copy_markdown, ArtifactActionReadiness.NOT_READY)
        self.assertEqual(artifact.open_file, ArtifactActionReadiness.NOT_READY)
        self.assertEqual(artifact.copy_file_path, ArtifactActionReadiness.NOT_READY)
        self.assertFalse(artifact.content_read_performed)

    def test_artifact_cannot_be_marked_ready_without_correlation(self):
        with self.assertRaises(ValueError):
            replace(self.resolution.result_artifact, copy_markdown=ArtifactActionReadiness.READY)

    def test_invocation_binding_is_not_ready(self):
        binding = self.resolution.invocation_binding
        self.assertEqual(binding.state, ResolutionState.NOT_READY)
        self.assertFalse(binding.execution_enabled)
        self.assertEqual(dict(binding.input_mapping), {"ai_name": "ai_name", "source_text": "source_text", "source_url": "source_url"})

    def test_invocation_binding_cannot_enable_execution(self):
        with self.assertRaises(ValueError):
            replace(self.resolution.invocation_binding, execution_enabled=True)

    def test_runtime_state_remains_unknown(self):
        self.assertEqual(self.resolution.current_run_state, "unknown")
        with self.assertRaises(ValueError):
            replace(self.resolution, current_run_state="running")

    def test_serialization_is_json_safe_and_deterministic(self):
        first = serialize_provider_target(self.resolution)
        self.assertEqual(first, serialize_provider_target(self.resolution))
        data = json.loads(first)
        self.assertEqual(data["provider"]["state"], "unresolved")
        self.assertEqual(data["invocation_binding"]["state"], "not_ready")

    def test_serialization_contains_no_secret_or_credential_value(self):
        text = serialize_provider_target(self.resolution).lower()
        for token in ("api_key", "password", "bearer ", "cookie", "credential_id"):
            self.assertNotIn(token, text)

    def test_target_module_has_no_network_process_or_filesystem_imports(self):
        tree = ast.parse(TARGET_MODULE.read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        forbidden = {"os", "pathlib", "subprocess", "socket", "requests", "httpx", "urllib", "urllib.request"}
        self.assertFalse(imported & forbidden)

    def test_resolver_has_no_probe_execute_publish_or_backup_method(self):
        public = {name for name in dir(ProviderTargetResolver) if not name.startswith("_")}
        self.assertEqual(public, {"resolve_v141"})

    def test_source_has_no_legacy_absolute_path(self):
        text = TARGET_MODULE.read_text(encoding="utf-8")
        self.assertNotIn("E:\\个人数字资产中心", text)
        self.assertNotIn("C:\\Users", text)


if __name__ == "__main__":
    unittest.main()
