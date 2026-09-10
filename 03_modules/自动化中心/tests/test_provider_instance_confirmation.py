import ast
from dataclasses import replace
import json
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
MODULE_PATH = SRC_ROOT / "automation_center" / "application" / "instance_confirmation.py"
sys.path.insert(0, str(SRC_ROOT))

from automation_center import (  # noqa: E402
    PROVIDER_INSTANCE_CONFIRMATION_VERSION,
    ArtifactFilenamePolicy,
    ProviderInstanceConfirmationResolver,
    build_provider_instance_confirmation_resolver,
)
from automation_center.application import (  # noqa: E402
    ArtifactReadiness,
    AuthenticationRequirement,
    BindingProgressState,
    ConfirmationState,
    EndpointScope,
    ProviderRuntimeState,
    StableIdentityState,
    serialize_provider_instance_confirmation,
)


class ProviderInstanceConfirmationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.confirmation = build_provider_instance_confirmation_resolver().resolve_v141()

    def test_public_version_and_resolver(self):
        self.assertEqual(PROVIDER_INSTANCE_CONFIRMATION_VERSION, "0.2")
        self.assertIsInstance(build_provider_instance_confirmation_resolver(), ProviderInstanceConfirmationResolver)

    def test_provider_runtime_is_running(self):
        runtime = self.confirmation.runtime
        self.assertEqual(runtime.state, ProviderRuntimeState.RUNNING)
        self.assertEqual(runtime.container_name, "n8n")
        self.assertEqual(runtime.published_port, 5678)
        self.assertEqual(runtime.health_status_code, 200)
        self.assertEqual(runtime.health_body, '{"status":"ok"}')

    def test_runtime_and_workflow_run_state_are_separate(self):
        self.assertEqual(self.confirmation.runtime.state, ProviderRuntimeState.RUNNING)
        self.assertEqual(self.confirmation.runtime.workflow_run_state, "unknown")

    def test_container_id_is_diagnostic_only(self):
        runtime = self.confirmation.runtime
        instance = self.confirmation.instance
        self.assertEqual(runtime.container_id_diagnostic, "13f658a439b0")
        self.assertFalse(instance.container_id_is_stable_identity)
        self.assertNotEqual(runtime.container_id_diagnostic, instance.stable_provider_instance_id)

    def test_stable_identity_is_user_confirmed_tiangong(self):
        instance = self.confirmation.instance
        self.assertEqual(instance.stable_provider_instance_id, "n8n-tiangong-primary")
        self.assertEqual(instance.state, StableIdentityState.CONFIRMED)
        self.assertEqual(instance.suggested_label, "n8n-tiangong-primary")
        self.assertFalse(instance.user_confirmation_required)

    def test_endpoint_descriptor_is_loopback_and_confirmed(self):
        endpoint = self.confirmation.endpoint
        self.assertEqual(endpoint.base_url, "http://127.0.0.1:5678")
        self.assertEqual(endpoint.scope, EndpointScope.LOCAL_LOOPBACK)
        self.assertEqual(endpoint.confidence, ConfirmationState.CONFIRMED)
        self.assertTrue(endpoint.health_confirmed)

    def test_endpoint_has_no_secret(self):
        endpoint = self.confirmation.endpoint
        self.assertFalse(endpoint.contains_credentials)
        self.assertNotIn("@", endpoint.base_url)
        self.assertEqual(endpoint.authentication, AuthenticationRequirement.NOT_REQUIRED_FOR_HEALTH)

    def test_workflow_membership_is_auth_required(self):
        workflow = self.confirmation.workflow
        self.assertEqual(workflow.external_workflow_id, "ymYh8t76VP3jGPbr")
        self.assertEqual(workflow.membership, ConfirmationState.AUTH_REQUIRED)
        self.assertTrue(workflow.auth_required_for_further_confirmation)

    def test_current_revision_is_not_canonical_revision(self):
        workflow = self.confirmation.workflow
        self.assertEqual(workflow.current_revision, ConfirmationState.AUTH_REQUIRED)
        self.assertIsNone(workflow.current_revision_id)
        self.assertNotEqual(workflow.current_revision_id, "802897a6-0644-4927-9bad-3ecc34d8a28b")

    def test_form_trigger_was_not_visited_or_submitted(self):
        form = self.confirmation.form_trigger
        self.assertEqual(form.state, ConfirmationState.EXECUTION_SIDE_EFFECT_RISK)
        self.assertFalse(form.page_get_performed)
        self.assertFalse(form.form_submit_performed)
        self.assertIsNone(form.form_url)

    def test_sandbox_production_separation_is_preserved(self):
        target = self.confirmation.target_resolution.target
        self.assertTrue(target.sandbox_production_separated)
        self.assertNotEqual(target.external_workflow_id, target.sandbox_external_workflow_id)

    def test_artifact_mount_mapping_is_confirmed(self):
        location = self.confirmation.artifact_location
        self.assertEqual(location.container_root, "/knowledge")
        self.assertEqual(location.host_root, "E:\\个人数字资产中心\\01_知识库")
        self.assertEqual(location.relative_path_template, "00_待审核/AI工具/{ai_name}.md")
        self.assertEqual(location.artifact_type, "MARKDOWN")

    def test_artifact_content_was_not_read(self):
        location = self.confirmation.artifact_location
        self.assertEqual(location.readiness, ArtifactReadiness.CONTENT_READ_NOT_AUTHORIZED)
        self.assertFalse(location.content_read_performed)

    def test_filename_policy_accepts_safe_name(self):
        self.assertEqual(ArtifactFilenamePolicy().validate("Kimi"), "Kimi.md")

    def test_filename_policy_rejects_traversal(self):
        for value in ("..", "../escape", "a..b"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ArtifactFilenamePolicy().validate(value)

    def test_filename_policy_rejects_separators_and_drive_prefix(self):
        for value in ("a/b", "a\\b", "C:\\escape", "/absolute"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ArtifactFilenamePolicy().validate(value)

    def test_filename_policy_rejects_windows_reserved_names(self):
        for value in ("CON", "nul", "COM1", "LPT9", "aux.txt"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ArtifactFilenamePolicy().validate(value)

    def test_filename_policy_rejects_control_characters(self):
        for value in ("bad\nname", "bad\x7fname", " leading", "trailing "):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ArtifactFilenamePolicy().validate(value)

    def test_legacy_filename_safety_gap_remains_visible(self):
        blockers = self.confirmation.target_resolution.result_artifact.blockers
        self.assertIn("ai_name_filename_safety_not_evidenced", blockers)

    def test_capability_binding_progresses_only_to_target_confirmed(self):
        binding = self.confirmation.capability_binding
        self.assertEqual(binding.progress_state, BindingProgressState.TARGET_CONFIRMED)
        self.assertFalse(binding.execution_enabled)

    def test_capability_binding_cannot_enable_execution(self):
        with self.assertRaises(ValueError):
            replace(self.confirmation.capability_binding, execution_enabled=True)

    def test_confirmation_cannot_claim_modification(self):
        with self.assertRaises(ValueError):
            replace(self.confirmation, docker_modification_performed=True)
        with self.assertRaises(ValueError):
            replace(self.confirmation, production_modification_performed=True)

    def test_serialization_is_deterministic_and_safe(self):
        first = serialize_provider_instance_confirmation(self.confirmation)
        self.assertEqual(first, serialize_provider_instance_confirmation(self.confirmation))
        payload = json.loads(first)
        self.assertEqual(payload["runtime"]["state"], "running")
        self.assertEqual(payload["runtime"]["workflow_run_state"], "unknown")
        self.assertEqual(payload["capability_binding"]["progress_state"], "target_confirmed")

    def test_serialization_contains_no_credentials(self):
        text = serialize_provider_instance_confirmation(self.confirmation).lower()
        for value in ("api_key", "password", "bearer ", "cookie", "credential_id", "credential_name"):
            self.assertNotIn(value, text)

    def test_module_has_no_runtime_clients(self):
        tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        forbidden = {"os", "pathlib", "subprocess", "socket", "requests", "httpx", "urllib", "urllib.request", "docker"}
        self.assertFalse(imported & forbidden)

    def test_resolver_has_only_resolve_method(self):
        public = {name for name in dir(ProviderInstanceConfirmationResolver) if not name.startswith("_")}
        self.assertEqual(public, {"resolve_v141"})


if __name__ == "__main__":
    unittest.main()
