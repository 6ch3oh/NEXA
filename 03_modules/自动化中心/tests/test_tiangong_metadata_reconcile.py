import json
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from automation_center import build_automation_read_context, build_control_api  # noqa: E402
from automation_center.application import build_control_service  # noqa: E402
from automation_center.auth_metadata import build_auth_metadata_product_status  # noqa: E402
from automation_center.metadata_reconcile import (  # noqa: E402
    AUTHENTICATED_METADATA_OBSERVED_AT,
    PRODUCTION_DEFINITION_SHA256,
    PRODUCTION_WORKFLOW_VERSION_ID,
    REPORTED_CANONICAL_SHA256,
    build_first_run_readiness,
    build_frozen_authenticated_metadata_evidence,
    build_reconciled_auth_metadata_product_status,
    build_structural_reconciliation,
    build_tiangong_metadata_reconciliation_status,
    build_update_preparation,
)
from automation_center.product import AutomationProviderConfig  # noqa: E402
from automation_center.run_prep import (  # noqa: E402
    AuthSessionRequest,
    MetadataReadState,
    N8nWorkflowMetadataReader,
    SafeTransportResponse,
    TIANGONG_PROVIDER_INSTANCE_ID,
    TIANGONG_WORKFLOW_EXTERNAL_ID,
)


class FakeTransport:
    def get_json(self, url, auth_request, timeout_seconds):
        return SafeTransportResponse(200, url, {
            "id": TIANGONG_WORKFLOW_EXTERNAL_ID,
            "name": "knowledge.collect",
            "active": False,
            "versionId": PRODUCTION_WORKFLOW_VERSION_ID,
            "updatedAt": "2026-08-03T04:14:22.460Z",
            "nodes": [{"type": "n8n-nodes-base.formTrigger", "webhookId": "form-001"}],
        })


def inactive_observed_result():
    request = AuthSessionRequest(
        "auth-reconcile-001", TIANGONG_PROVIDER_INSTANCE_ID, "credential-ref-001",
        ("workflow.metadata.read",),
    )
    return N8nWorkflowMetadataReader(FakeTransport()).read(AutomationProviderConfig.tiangong(), request)


class TiangongMetadataReconcileTests(unittest.TestCase):
    def test_frozen_authenticated_observation_is_complete_and_secret_free(self):
        evidence = build_frozen_authenticated_metadata_evidence()
        self.assertEqual("AUTHENTICATED_N8N_METADATA", evidence["source"])
        self.assertEqual("CONFIRMED", evidence["workflow_membership"])
        self.assertEqual(PRODUCTION_WORKFLOW_VERSION_ID, evidence["production_revision"])
        self.assertEqual(AUTHENTICATED_METADATA_OBSERVED_AT, evidence["observed_at"])
        self.assertFalse(evidence["active"])
        self.assertTrue(evidence["credential_runtime_available_at_capture"])
        self.assertFalse(evidence["credential_runtime_available_now"])
        self.assertFalse(evidence["credential_persisted"])
        self.assertFalse(evidence["secret_exposed"])
        encoded = json.dumps(evidence, ensure_ascii=False).lower()
        for token in ("api_key_value", "password=", "bearer ", "cookie="):
            self.assertNotIn(token, encoded)

    def test_metadata_auth_success_is_not_falsely_projected_as_auth_required(self):
        result = inactive_observed_result()
        self.assertEqual(MetadataReadState.OBSERVED, result.state)
        status = build_auth_metadata_product_status(result)
        self.assertEqual("CONFIRMED", status["auth"]["metadata_auth"])
        self.assertEqual("REQUIRED_AT_EXECUTION_TIME", status["auth"]["execution_auth"])
        self.assertEqual("EXECUTION_READINESS_BLOCKED_ACTIVE_STATE", status["run_readiness"])
        self.assertNotEqual("AUTH_REQUIRED", status["run_readiness"])

    def test_process_only_credential_lifecycle_is_explicit(self):
        status = build_reconciled_auth_metadata_product_status()
        self.assertEqual("AVAILABLE", status["auth"]["availability_at_metadata_capture"])
        self.assertEqual("UNAVAILABLE", status["auth"]["availability"])
        self.assertEqual("RELEASED_AFTER_SMOKE", status["auth"]["lifecycle"])
        self.assertEqual("CONFIRMED", status["auth"]["metadata_auth"])
        self.assertEqual("REQUIRED_AT_EXECUTION_TIME", status["auth"]["execution_auth"])
        self.assertFalse(status["auth"]["credential_persisted"])

    def test_revision_divergence_is_definition_level_and_canonical_is_authority(self):
        diff = build_structural_reconciliation()
        self.assertEqual("REVISION_DIVERGENCE", diff["state"])
        self.assertEqual("CANONICAL_UPDATE_REQUIRED", diff["decision"])
        self.assertEqual(11, diff["production"]["node_count"])
        self.assertEqual(21, diff["canonical"]["node_count"])
        self.assertEqual(12, diff["production"]["edge_count"])
        self.assertEqual(25, diff["canonical"]["edge_count"])
        self.assertFalse(diff["production"]["error_trigger"])
        self.assertTrue(diff["canonical"]["error_trigger"])
        self.assertEqual("PASS", diff["canonical"]["sandbox_six_state_result"])
        self.assertEqual("CANONICAL", diff["likely_newer_side"])
        self.assertFalse(diff["production_write_performed"])

    def test_structural_diff_tracks_outputs_error_handling_and_filename_risk(self):
        diff = build_structural_reconciliation()
        self.assertTrue(diff["production"]["markdown_output_chain"])
        self.assertTrue(diff["canonical"]["markdown_output_chain"])
        self.assertTrue(diff["production"]["filename_expression_direct_ai_name"])
        self.assertTrue(diff["canonical"]["filename_expression_direct_ai_name"])
        self.assertIn("读取网页失败", diff["canonical_only_nodes"])
        self.assertIn("Read/Write Files from Disk", diff["same_shared_nodes"])
        self.assertIn("Basic LLM Chain", diff["changed_shared_nodes"])

    def test_production_definition_hash_matches_read_only_export(self):
        export = next((MODULE_ROOT / "source_import").rglob("current_ui_export.json"))
        import hashlib
        actual = hashlib.sha256(export.read_bytes()).hexdigest().upper()
        self.assertEqual(PRODUCTION_DEFINITION_SHA256, actual)

    def test_transcribed_canonical_hash_difference_uses_verified_disk_hash(self):
        diff = build_structural_reconciliation()["canonical_hash_reconciliation"]
        self.assertEqual(REPORTED_CANONICAL_SHA256, diff["reported_in_smoke_transcript"])
        self.assertNotEqual(diff["reported_in_smoke_transcript"], diff["verified_from_disk"])
        self.assertEqual("TRANSCRIPTION_DIFFERENCE_DISK_HASH_VERIFIED", diff["state"])
        self.assertEqual("VERIFIED_DISK_HASH", diff["update_lock_uses"])

    def test_active_published_callable_and_surface_are_distinct(self):
        status = build_reconciled_auth_metadata_product_status()
        self.assertFalse(status["workflow"]["active"])
        self.assertEqual("CONFIRMED_NOT_CALLABLE_WHILE_INACTIVE", status["form_surface"])
        matrix = build_first_run_readiness()["matrix"]
        self.assertEqual("NOT_READY", matrix["Published State"]["status"])
        self.assertEqual("BLOCKED", matrix["Active State"]["status"])
        self.assertEqual("CONFIRMED", matrix["Invocation Surface"]["status"])

    def test_readiness_uses_only_frozen_status_vocabulary_and_exact_blockers(self):
        readiness = build_first_run_readiness()
        allowed = {"READY", "CONFIRMED", "AUTH_REQUIRED_AT_RUNTIME", "USER_DECISION_REQUIRED", "UPDATE_REQUIRED", "NOT_READY", "BLOCKED"}
        self.assertTrue(all(item["status"] in allowed for item in readiness["matrix"].values()))
        self.assertEqual("UPDATE_REQUIRED", readiness["first_run_readiness"])
        self.assertTrue(readiness["update_required"])
        self.assertFalse(readiness["user_decision_required"])
        self.assertEqual("PRODUCTION_RECONCILIATION_AND_UPDATE", readiness["recommended_next_goal"])

    def test_update_preparation_has_backup_lock_candidate_rollback_and_approval(self):
        update = build_update_preparation()
        self.assertEqual("READY_FOR_USER_UPDATE_APPROVAL", update["state"])
        self.assertEqual(PRODUCTION_WORKFLOW_VERSION_ID, update["backup_request"]["expected_current_revision"])
        self.assertFalse(update["backup_request"]["include_credentials"])
        self.assertFalse(update["backup_request"]["performed"])
        self.assertFalse(update["publish_payload"]["performed"])
        self.assertFalse(update["rollback_plan"]["performed"])
        self.assertEqual(["APPROVE_UPDATE", "CANCEL"], update["approval_payload"]["actions"])

    def test_product_read_and_control_facades_expose_same_safe_reconciliation(self):
        direct = build_tiangong_metadata_reconciliation_status()
        read = build_automation_read_context().get_tiangong_metadata_reconciliation()
        control = build_control_api(build_control_service()).get_tiangong_metadata_reconciliation()
        self.assertTrue(read["ok"])
        self.assertTrue(control["ok"])
        self.assertEqual(direct["state"], read["data"]["state"])
        self.assertEqual(direct["state"], control["data"]["state"])
        self.assertEqual("UPDATE_REQUIRED", read["data"]["readiness"]["first_run_readiness"])

    def test_no_execution_form_submit_production_write_or_secret_retention(self):
        encoded = json.dumps(build_tiangong_metadata_reconciliation_status(), ensure_ascii=False).lower()
        self.assertIn('"workflow_execution": false', encoded)
        self.assertIn('"form_submit": false', encoded)
        self.assertIn('"production_write": false', encoded)
        self.assertIn('"credential_persisted": false', encoded)
        for token in ("fake_n8n_secret", "authorization: bearer", "api_key_value"):
            self.assertNotIn(token, encoded)


if __name__ == "__main__":
    unittest.main()
