from __future__ import annotations

from datetime import timedelta
import json
import os
from pathlib import Path
import sys
from unittest import TestCase, skipUnless

from nexa_radar.ai_selection import NexaAISelectionAdapter
from nexa_radar.credential_free_consumer import CredentialFreeConsumerExecutionAdapter
from nexa_radar.executionhub_cli_transport import (
    EXECUTIONHUB_CLI_CONTRACT_VERSION,
    ExecutionHubCliConfig,
    ExecutionHubCliTransport,
    ExecutionHubCliTransportError,
)
from nexa_radar.product_api import AISelectionViewState

from tests.test_ai_selection_product import NOW, SelectionProductCase


FIXTURE_ENTRY = Path(__file__).parent / "fixtures" / "credential_free_consumer_cli_fixture.py"
REAL_NODE = os.environ.get("NEXA_RADAR_TEST_NODE_EXECUTABLE")
REAL_FAKE_ENTRY = os.environ.get("NEXA_RADAR_TEST_EXECUTIONHUB_FAKE_CLI_ENTRY")
REAL_PRODUCTION_ENTRY = os.environ.get("NEXA_RADAR_TEST_EXECUTIONHUB_PRODUCTION_CLI_ENTRY")


def request(request_id: str = "fixture-success") -> dict[str, object]:
    return {
        "schema_version": "CREDENTIAL_FREE_CONSUMER_REQUEST_V1",
        "request_id": request_id,
        "correlation_id": request_id,
        "caller_id": "12_INFORMATION_RADAR",
        "capability_id": "RADAR_AI_SELECTION",
        "input": {
            "schema_version": "RADAR_AI_SELECTION_INPUT_V1",
            "request_id": request_id,
            "board_goal": "Exercise one bounded CLI request.",
            "board_rules": [],
            "target_count": 1,
            "current_interests": ["transport safety"],
            "candidates": [{
                "candidate_id": "candidate-01",
                "title": "Bounded candidate",
                "summary": "A deterministic subprocess fixture candidate.",
                "project_relations": ["ExecutionHub"],
                "evidence": ["Cross-runtime fixture."],
                "feedback": "UNSEEN",
            }],
        },
    }


def fixture_transport(**overrides) -> ExecutionHubCliTransport:
    values = {
        "executable": sys.executable,
        "entrypoint": str(FIXTURE_ENTRY),
        "timeout_seconds": 3,
        "stdout_bound": 64 * 1024,
        "stderr_bound": 1024,
    }
    values.update(overrides)
    return ExecutionHubCliTransport(ExecutionHubCliConfig(**values))


class ExecutionHubCliTransportContractTests(TestCase):
    def test_contract_identity_valid_spawn_exact_stdin_and_exit_zero(self):
        transport = fixture_transport()
        response = transport.execute(request())
        self.assertEqual(EXECUTIONHUB_CLI_CONTRACT_VERSION, "CREDENTIAL_FREE_CONSUMER_CLI_V1")
        self.assertEqual(transport.last_exit_code, 0)
        self.assertGreater(transport.last_stdin_bytes, 0)
        self.assertEqual(response["status"], "COMPLETED")
        self.assertEqual(response["request_id"], "fixture-success")
        self.assertEqual(response["caller_id"], "12_INFORMATION_RADAR")
        self.assertEqual(response["capability_id"], "RADAR_AI_SELECTION")

    def test_exit_two_and_three_return_valid_public_terminal_responses(self):
        denied = fixture_transport()
        failed = fixture_transport()
        self.assertEqual(denied.execute(request("fixture-exit-2"))["status"], "DENIED")
        self.assertEqual(denied.last_exit_code, 2)
        self.assertEqual(failed.execute(request("fixture-exit-3"))["status"], "FAILED")
        self.assertEqual(failed.last_exit_code, 3)

    def test_exit_seventy_fails_closed_without_trusting_stdout(self):
        with self.assertRaisesRegex(ExecutionHubCliTransportError, "CLI_INTERNAL_FAIL_CLOSED"):
            fixture_transport().execute(request("fixture-exit-70"))

    def test_timeout_and_launch_failure_are_stable(self):
        with self.assertRaisesRegex(ExecutionHubCliTransportError, "CLI_TIMEOUT"):
            fixture_transport(timeout_seconds=0.05).execute(request("fixture-timeout"))
        missing = fixture_transport(executable=str(FIXTURE_ENTRY.parent / "missing-executable"))
        with self.assertRaisesRegex(ExecutionHubCliTransportError, "CLI_PROCESS_LAUNCH_FAILED"):
            missing.execute(request())

    def test_malformed_oversized_and_version_mismatch_are_rejected(self):
        cases = (
            ("fixture-malformed", {}, "CLI_STDOUT_PROTOCOL_INVALID"),
            ("fixture-oversized-stdout", {"stdout_bound": 128}, "CLI_STDOUT_BOUND_EXCEEDED"),
            ("fixture-oversized-stderr", {"stderr_bound": 128}, "CLI_STDERR_BOUND_EXCEEDED"),
            ("fixture-unexpected-stderr", {}, "CLI_STDERR_UNEXPECTED"),
            ("fixture-unexpected-utf8-stderr", {}, "CLI_STDERR_UNEXPECTED"),
            ("fixture-invalid-utf8-stderr", {}, "CLI_STDERR_PROTOCOL_INVALID"),
            ("fixture-version-mismatch", {}, "CLI_RESPONSE_INVALID"),
        )
        for request_id, options, code in cases:
            with self.subTest(request_id=request_id):
                with self.assertRaisesRegex(ExecutionHubCliTransportError, code):
                    fixture_transport(**options).execute(request(request_id))

    def test_input_bound_and_configuration_are_explicit(self):
        invalid = request()
        invalid["input"]["board_goal"] = "x" * (512 * 1024)
        with self.assertRaisesRegex(ExecutionHubCliTransportError, "CLI_STDIN_BOUND_EXCEEDED"):
            fixture_transport().execute(invalid)
        with self.assertRaises(ValueError):
            ExecutionHubCliConfig("", str(FIXTURE_ENTRY))


class ExecutionHubCliProductIntegrationTests(SelectionProductCase):
    def test_subprocess_fake_downstream_home_and_fallback(self):
        execution = CredentialFreeConsumerExecutionAdapter(fixture_transport(), clock=lambda: NOW + timedelta(seconds=1))
        selected = self.app(execution).request_ai_reselection("home", requested_at=NOW)
        self.assertEqual(selected.mode, "AI")
        self.assertEqual(selected.target_count, 5)
        self.assertEqual(self.read.get_home().item_count, 5)
        self.assertEqual(self.read.get_home().ai_selection_state, AISelectionViewState.COMPLETED)

        failing = CredentialFreeConsumerExecutionAdapter(
            fixture_transport(executable=str(FIXTURE_ENTRY.parent / "missing-executable")),
            clock=lambda: NOW + timedelta(seconds=2),
        )
        fallback = self.app(failing).request_ai_reselection("home", requested_at=NOW + timedelta(seconds=1))
        self.assertEqual(fallback.mode, "DETERMINISTIC_FALLBACK")
        self.assertEqual(self.read.get_home().item_count, 5)


@skipUnless(REAL_NODE and REAL_FAKE_ENTRY, "explicit ExecutionHub fake CLI config not supplied")
class RealExecutionHubFakeBoundaryTests(SelectionProductCase):
    def test_radar_home_crosses_actual_executionhub_cli_with_fake_gate(self):
        transport = ExecutionHubCliTransport(ExecutionHubCliConfig(
            executable=REAL_NODE,
            entrypoint=REAL_FAKE_ENTRY,
            timeout_seconds=30,
        ))
        execution = CredentialFreeConsumerExecutionAdapter(transport, clock=lambda: NOW + timedelta(seconds=1))
        selected = self.app(execution).request_ai_reselection("home", requested_at=NOW)
        self.assertEqual(transport.last_exit_code, 0)
        self.assertEqual(selected.mode, "AI")
        self.assertEqual(selected.target_count, 5)
        self.assertEqual(self.read.get_home().ai_selection_state, AISelectionViewState.COMPLETED)


@skipUnless(REAL_NODE and REAL_PRODUCTION_ENTRY, "explicit ExecutionHub production CLI config not supplied")
class RealExecutionHubProductionBoundaryTests(TestCase):
    def test_production_entry_rejects_before_credential_or_provider_boundary(self):
        transport = ExecutionHubCliTransport(ExecutionHubCliConfig(
            executable=REAL_NODE,
            entrypoint=REAL_PRODUCTION_ENTRY,
            timeout_seconds=30,
        ))
        invalid = request("production-boundary-invalid")
        invalid["schema_version"] = "INVALID_REQUEST_VERSION"
        response = transport.execute(invalid)
        self.assertEqual(transport.last_exit_code, 2)
        self.assertEqual(response["status"], "DENIED")
        self.assertEqual(response["code"], "CONSUMER_REQUEST_INVALID")
        self.assertEqual(response["safe_evidence"]["provider_call_count"], 0)
        self.assertFalse(response["safe_evidence"]["secret_returned"])
        self.assertFalse(response["safe_evidence"]["opencode_used"])
