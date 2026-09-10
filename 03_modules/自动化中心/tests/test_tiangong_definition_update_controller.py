import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


MODULE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = MODULE_ROOT / "scripts" / "tiangong_definition_update.py"
SPEC = importlib.util.spec_from_file_location("tiangong_definition_update", SCRIPT)
assert SPEC and SPEC.loader
controller = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = controller
SPEC.loader.exec_module(controller)


class FakeRequester:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, secret, body, timeout_seconds):
        self.calls.append({"method": method, "url": url, "secret": secret, "body": body, "timeout": timeout_seconds})
        return self.responses.pop(0)


class TiangongDefinitionUpdateControllerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate, cls.backup, cls.approval = controller.prepare_local_inputs()

    def _response(self, payload, status=200):
        return controller.HttpResult(status, controller.ENDPOINT, payload)

    def _post(self, *, revision="new-revision-001", active=False, active_version_id=None):
        value = copy.deepcopy(self.candidate)
        value.update({
            "id": controller.TIANGONG_WORKFLOW_EXTERNAL_ID,
            "versionId": revision,
            "updatedAt": "2026-08-22T12:00:00.000Z",
            "active": active,
            "activeVersionId": active_version_id,
            "activeVersion": None,
        })
        # n8n GET responses may add a response-derived setting that was not
        # legal in, and was not submitted with, the PUT request body.
        value["settings"]["binaryMode"] = "default"
        return value

    def test_local_inputs_are_exactly_approved_and_api_compatible(self):
        self.assertEqual(self.approval["scope"], "DEFINITION_UPDATE_ONLY")
        self.assertEqual(self.approval["candidate_sha256"], controller.CANDIDATE_SHA256)
        self.assertEqual(set(self.candidate), controller.REQUEST_KEYS)
        self.assertEqual(set(self.candidate["settings"]), controller.REQUEST_SETTINGS_KEYS)
        self.assertNotIn("binaryMode", self.candidate["settings"])
        self.assertNotIn("onError", self.candidate["settings"])

    def test_happy_path_is_exact_get_put_get_and_writes_verified_evidence(self):
        fake = FakeRequester([
            self._response(copy.deepcopy(self.backup)),
            self._response({"id": controller.TIANGONG_WORKFLOW_EXTERNAL_ID, "versionId": "new-revision-001"}),
            self._response(self._post()),
        ])
        with tempfile.TemporaryDirectory() as directory:
            result = controller.perform_definition_update_transaction(
                "process-only-test-key",
                candidate=self.candidate,
                backup=self.backup,
                requester=fake,
                output_root=Path(directory),
            )
            evidence = Path(directory) / Path(result["post_update_readback_relative_path"]).name
            self.assertTrue(evidence.is_file())
            readback = json.loads(evidence.read_text(encoding="utf-8"))
        self.assertEqual([call["method"] for call in fake.calls], ["GET", "PUT", "GET"])
        self.assertTrue(all(call["url"] == controller.ENDPOINT for call in fake.calls))
        self.assertIs(fake.calls[1]["body"], self.candidate)
        self.assertEqual(result["state"], "DEFINITION_UPDATED_POST_UPDATE_VERIFIED_PUBLISH_APPROVAL_REQUIRED")
        self.assertEqual(result["post_update_production_revision"], "new-revision-001")
        self.assertEqual(result["publish"], False)
        self.assertEqual(result["activate"], False)
        self.assertEqual(result["workflow_execution"], False)
        self.assertEqual(result["credential_persisted"], False)
        self.assertEqual(result["secret_exposed"], False)
        self.assertNotIn("process-only-test-key", json.dumps(result, ensure_ascii=False))
        self.assertNotIn("process-only-test-key", json.dumps(readback, ensure_ascii=False))
        self.assertTrue(result["api_compatible_definition_verified"]["response_derived_binary_mode_present"])
        self.assertFalse(result["api_compatible_definition_verified"]["binary_mode_submitted"])

    def test_revision_drift_stops_before_put(self):
        drifted = copy.deepcopy(self.backup)
        drifted["versionId"] = "concurrent-revision"
        fake = FakeRequester([self._response(drifted)])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(controller.DefinitionUpdateStopped) as caught:
                controller.perform_definition_update_transaction(
                    "test-key", candidate=self.candidate, backup=self.backup,
                    requester=fake, output_root=Path(directory),
                )
        self.assertEqual(caught.exception.state, "REVISION_LOCK_LOST")
        self.assertEqual([call["method"] for call in fake.calls], ["GET"])

    def test_active_or_published_precondition_stops_before_put(self):
        active = copy.deepcopy(self.backup)
        active["active"] = True
        active["activeVersionId"] = "published-version"
        active["activeVersion"] = {"id": "published-version"}
        fake = FakeRequester([self._response(active)])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(controller.DefinitionUpdateStopped) as caught:
                controller.perform_definition_update_transaction(
                    "test-key", candidate=self.candidate, backup=active,
                    requester=fake, output_root=Path(directory),
                )
        self.assertEqual(caught.exception.state, "ACTIVE_OR_PUBLISHED_PRECONDITION_FAILED")
        self.assertEqual([call["method"] for call in fake.calls], ["GET"])

    def test_put_rejection_reads_back_and_reports_no_change(self):
        fake = FakeRequester([
            self._response(copy.deepcopy(self.backup)),
            self._response({}, status=400),
            self._response(copy.deepcopy(self.backup)),
        ])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(controller.DefinitionUpdateStopped) as caught:
                controller.perform_definition_update_transaction(
                    "test-key", candidate=self.candidate, backup=self.backup,
                    requester=fake, output_root=Path(directory),
                )
        self.assertEqual(caught.exception.state, "DEFINITION_UPDATE_REJECTED_NO_CHANGE")
        self.assertEqual([call["method"] for call in fake.calls], ["GET", "PUT", "GET"])

    def test_post_update_semantic_mismatch_requires_review(self):
        wrong = self._post()
        wrong["nodes"] = wrong["nodes"][:-1]
        fake = FakeRequester([
            self._response(copy.deepcopy(self.backup)),
            self._response({"id": controller.TIANGONG_WORKFLOW_EXTERNAL_ID}),
            self._response(wrong),
        ])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(controller.DefinitionUpdateStopped) as caught:
                controller.perform_definition_update_transaction(
                    "test-key", candidate=self.candidate, backup=self.backup,
                    requester=fake, output_root=Path(directory),
                )
        self.assertEqual(caught.exception.state, "PARTIAL_OR_UNVERIFIED_UPDATE_REQUIRES_REVIEW")

    def test_wrong_effective_target_is_rejected(self):
        fake = FakeRequester([
            controller.HttpResult(200, "http://127.0.0.1:5678/api/v1/workflows/other", self.backup),
        ])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(controller.DefinitionUpdateStopped) as caught:
                controller.perform_definition_update_transaction(
                    "test-key", candidate=self.candidate, backup=self.backup,
                    requester=fake, output_root=Path(directory),
                )
        self.assertEqual(caught.exception.state, "TARGET_ALLOWLIST_REJECTED")

    def test_script_has_no_publish_activate_or_execution_request_path(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('method not in {"GET", "PUT"}', source)
        self.assertNotIn("/activate", source)
        self.assertNotIn("/execute", source)
        self.assertNotIn("publishIfActive=true", source)
        self.assertIn("getpass.getpass", source)
        self.assertIn("RuntimeOnlyCredentialProvider", source)

    def test_secret_consumer_preserves_sanitized_stop_as_a_value(self):
        stopped = controller.DefinitionUpdateStopped("REVISION_LOCK_LOST", "safe detail")
        with mock.patch.object(controller, "perform_definition_update_transaction", side_effect=stopped):
            outcome = controller._consume_transaction("process-only-test-key", self.candidate, self.backup)
        self.assertTrue(outcome["stopped"])
        self.assertEqual(outcome["state"], "REVISION_LOCK_LOST")
        self.assertEqual(outcome["detail"], "safe detail")
        self.assertNotIn("process-only-test-key", json.dumps(outcome, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
