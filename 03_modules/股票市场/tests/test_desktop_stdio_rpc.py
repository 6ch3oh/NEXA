from __future__ import annotations

from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from nexa_market.desktop import DESKTOP_BRIDGE_VERSION
from nexa_market.transport.stdio_rpc import (
    METHOD_ALLOWLIST,
    TRANSPORT_PROTOCOL_VERSION,
    run_stdio,
)


def request(request_id, method, params=None, protocol=TRANSPORT_PROTOCOL_VERSION):
    return {
        "protocol_version": protocol,
        "id": request_id,
        "method": method,
        "params": {} if params is None else params,
    }


def invoke(values, *, factory=None):
    stdin = io.StringIO("".join(json.dumps(value, ensure_ascii=False) + "\n" for value in values))
    stdout = io.StringIO()
    stderr = io.StringIO()
    kwargs = {} if factory is None else {"factory": factory}
    exit_code = run_stdio(stdin, stdout, stderr, **kwargs)
    responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
    return exit_code, responses, stdout.getvalue(), stderr.getvalue()


class FakeBridge:
    version = DESKTOP_BRIDGE_VERSION

    def __init__(self, *, fail_start=False):
        self.lifecycle = type("Lifecycle", (), {"value": "CREATED"})()
        self.fail_start = fail_start
        self.dispose_count = 0

    def start(self):
        if self.fail_start:
            raise RuntimeError("secret C:/private/token.txt")
        return {"lifecycle": "READY"}

    def dispose(self):
        self.dispose_count += 1
        return {"lifecycle": "STOPPED"}


class DesktopStdioRpcTests(unittest.TestCase):
    def test_protocol_and_method_allowlist_are_exact(self):
        self.assertEqual("nexa.market.desktop-stdio.v0.1", TRANSPORT_PROTOCOL_VERSION)
        self.assertEqual(
            (
                "initialize", "start", "stop", "dispose", "get_module_status",
                "get_desktop_snapshot", "get_route_manifest", "set_navigation_state",
                "get_market_home", "get_watchlist", "get_portfolio",
                "get_instrument_detail", "get_research_center", "get_decision_journal",
                "list_evidence", "explain_term", "refresh_local_projection",
                "execute_action", "shutdown",
            ),
            METHOD_ALLOWLIST,
        )
        self.assertFalse(any(name.startswith("_") for name in METHOD_ALLOWLIST))

    def test_process_module_entry_initialize_start_status_read_and_shutdown(self):
        with tempfile.TemporaryDirectory() as temp:
            values = (
                request("1", "initialize", {"data_root": temp, "timezone": "Asia/Shanghai", "runtime_mode": "EMPTY"}),
                request("2", "start"),
                request("3", "get_module_status"),
                request("4", "get_market_home"),
                request("5", "shutdown"),
            )
            environment = os.environ.copy()
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            environment["PYTHONIOENCODING"] = "utf-8"
            completed = subprocess.run(
                [sys.executable, "-B", "-m", "nexa_market.transport.stdio_rpc"],
                input="".join(json.dumps(value, ensure_ascii=False) + "\n" for value in values),
                text=True,
                encoding="utf-8",
                capture_output=True,
                cwd=ROOT,
                env=environment,
                timeout=30,
                check=False,
            )
        responses = [json.loads(line) for line in completed.stdout.splitlines()]
        self.assertEqual(0, completed.returncode)
        self.assertEqual(["1", "2", "3", "4", "5"], [item["id"] for item in responses])
        self.assertTrue(all(item["ok"] for item in responses))
        self.assertEqual("READY", responses[2]["result"]["lifecycle"])
        self.assertTrue(responses[3]["result"]["ok"])
        self.assertTrue(responses[4]["result"]["disposed"])
        self.assertEqual("", completed.stderr)

    def test_initialize_uses_python_default_clock_and_creates_only_one_bridge(self):
        created = []

        def factory(config):
            created.append(config)
            return FakeBridge()

        with tempfile.TemporaryDirectory() as temp:
            code, responses, _, _ = invoke(
                (
                    request("one", "initialize", {"data_root": temp}),
                    request("two", "initialize", {"data_root": temp}),
                    request("three", "shutdown"),
                ),
                factory=factory,
            )
        self.assertEqual(0, code)
        self.assertTrue(responses[0]["ok"])
        self.assertEqual("ALREADY_INITIALIZED", responses[1]["error"]["code"])
        self.assertEqual(1, len(created))
        self.assertEqual(timezone.utc, created[0].clock().tzinfo)
        self.assertFalse(created[0].network_refresh_enabled)

    def test_request_before_initialize_is_stable_error(self):
        _, responses, _, _ = invoke((request("a", "start"), request("b", "shutdown")))
        self.assertEqual("NOT_INITIALIZED", responses[0]["error"]["code"])
        self.assertTrue(responses[1]["ok"])

    def test_request_id_correlation_and_sequential_processing(self):
        with tempfile.TemporaryDirectory() as temp:
            _, responses, _, _ = invoke(
                (
                    request("req-α", "initialize", {"data_root": temp}),
                    request("req-β", "start"),
                    request("req-γ", "get_route_manifest"),
                    request("req-δ", "get_desktop_snapshot"),
                    request("req-ε", "shutdown"),
                )
            )
        self.assertEqual(["req-α", "req-β", "req-γ", "req-δ", "req-ε"], [x["id"] for x in responses])
        self.assertEqual(6, len(responses[2]["result"]))
        self.assertEqual("SERIAL_REQUEST_PROCESSING", responses[0]["result"]["processing"])

    def test_execute_action_is_forwarded(self):
        with tempfile.TemporaryDirectory() as temp:
            _, responses, _, _ = invoke(
                (
                    request("1", "initialize", {"data_root": temp}),
                    request("2", "start"),
                    request("3", "execute_action", {"action": "ADD_WATCHLIST", "payload": {"instrument_id": "US.XNAS.AAPL"}}),
                    request("4", "shutdown"),
                )
            )
        self.assertTrue(responses[2]["ok"])
        self.assertTrue(responses[2]["result"]["success"])

    def test_market_user_facing_failure_remains_a_successful_rpc_result(self):
        with tempfile.TemporaryDirectory() as temp:
            _, responses, _, _ = invoke(
                (
                    request("1", "initialize", {"data_root": temp}),
                    request("2", "start"),
                    request("3", "get_instrument_detail", {"instrument_id": "UNKNOWN"}),
                    request("4", "shutdown"),
                )
            )
        self.assertTrue(responses[2]["ok"])
        self.assertFalse(responses[2]["result"]["ok"])
        self.assertIn("problem", responses[2]["result"])

    def test_protocol_mismatch_malformed_json_unknown_method_and_invalid_id(self):
        stdout = io.StringIO()
        stderr = io.StringIO()
        lines = io.StringIO(
            "{bad-json\n"
            + json.dumps(request("version", "start", protocol="future")) + "\n"
            + json.dumps(request("method", "_private")) + "\n"
            + json.dumps(request("", "start")) + "\n"
            + json.dumps(request("done", "shutdown")) + "\n"
        )
        self.assertEqual(0, run_stdio(lines, stdout, stderr))
        responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(
            ["MALFORMED_JSON", "UNSUPPORTED_PROTOCOL", "UNKNOWN_METHOD", "INVALID_ID"],
            [item["error"]["code"] for item in responses[:4]],
        )
        self.assertIsNone(responses[0]["id"])
        self.assertEqual("version", responses[1]["id"])

    def test_invalid_envelope_and_method_params_are_rejected(self):
        invalid_envelope = request("envelope", "start")
        invalid_envelope["extra"] = True
        with tempfile.TemporaryDirectory() as temp:
            _, responses, output, _ = invoke(
                (
                    invalid_envelope,
                    request("1", "initialize", {"data_root": temp, "clock": "not-transportable"}),
                    request("2", "initialize", {"data_root": temp}),
                    request("3", "get_watchlist", {"held_only": "yes"}),
                    request("4", "execute_action", {"action": "ADD_WATCHLIST", "payload": []}),
                    request("5", "shutdown"),
                )
            )
        self.assertEqual("INVALID_REQUEST", responses[0]["error"]["code"])
        self.assertEqual("INVALID_PARAMS", responses[1]["error"]["code"])
        self.assertEqual("INVALID_PARAMS", responses[3]["error"]["code"])
        self.assertEqual("INVALID_PARAMS", responses[4]["error"]["code"])
        self.assertEqual(len(responses), len(output.splitlines()))

    def test_network_enable_is_rejected_and_status_stays_disabled(self):
        with tempfile.TemporaryDirectory() as temp:
            _, rejected, _, _ = invoke(
                (request("1", "initialize", {"data_root": temp, "network_refresh_enabled": True}), request("2", "shutdown"))
            )
            _, accepted, _, _ = invoke(
                (
                    request("1", "initialize", {"data_root": temp, "network_refresh_enabled": False}),
                    request("2", "start"),
                    request("3", "get_module_status"),
                    request("4", "shutdown"),
                )
            )
        self.assertEqual("NETWORK_NOT_AUTHORIZED", rejected[0]["error"]["code"])
        self.assertFalse(accepted[2]["result"]["network_capability"]["authorized"])
        self.assertFalse(accepted[2]["result"]["network_capability"]["available"])

    def test_unexpected_exception_is_sanitized_and_logged_only_to_stderr(self):
        bridge = FakeBridge(fail_start=True)
        with tempfile.TemporaryDirectory() as temp:
            _, responses, stdout, stderr = invoke(
                (
                    request("1", "initialize", {"data_root": temp}),
                    request("2", "start"),
                    request("3", "shutdown"),
                ),
                factory=lambda _config: bridge,
            )
        self.assertEqual("INTERNAL_ERROR", responses[1]["error"]["code"])
        self.assertNotIn("secret", stdout)
        self.assertNotIn("private", stdout)
        self.assertNotIn("Traceback", stdout)
        self.assertIn("INTERNAL_ERROR", stderr)
        self.assertNotIn("secret", stderr)

    def test_shutdown_disposes_once_and_exits_without_reading_more_requests(self):
        bridge = FakeBridge()
        with tempfile.TemporaryDirectory() as temp:
            _, responses, _, _ = invoke(
                (
                    request("1", "initialize", {"data_root": temp}),
                    request("2", "shutdown"),
                    request("3", "start"),
                ),
                factory=lambda _config: bridge,
            )
        self.assertEqual(["1", "2"], [item["id"] for item in responses])
        self.assertEqual(1, bridge.dispose_count)

    def test_stdin_eof_performs_best_effort_dispose(self):
        bridge = FakeBridge()
        with tempfile.TemporaryDirectory() as temp:
            code, responses, _, _ = invoke(
                (request("1", "initialize", {"data_root": temp}),),
                factory=lambda _config: bridge,
            )
        self.assertEqual(0, code)
        self.assertEqual(1, len(responses))
        self.assertEqual(1, bridge.dispose_count)

    def test_stdout_contains_only_compact_json_protocol_lines(self):
        with tempfile.TemporaryDirectory() as temp:
            _, responses, stdout, stderr = invoke(
                (
                    request("一", "initialize", {"data_root": temp}),
                    request("二", "start"),
                    request("三", "shutdown"),
                )
            )
        lines = stdout.splitlines()
        self.assertEqual(3, len(lines))
        self.assertEqual(3, len(responses))
        self.assertTrue(all(line.startswith("{") and line.endswith("}") for line in lines))
        self.assertTrue(all(item["protocol_version"] == TRANSPORT_PROTOCOL_VERSION for item in responses))
        self.assertEqual("", stderr)


if __name__ == "__main__":
    unittest.main()
