"""Ownership and lifecycle acceptance for the single Creator Ops UI Host."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from creator_ops import create_creator_ops_application, create_creator_ops_ui_host  # noqa: E402


def available_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def owner_headers(token: str, owner: str, generation: int) -> dict[str, str]:
    return {
        "X-Creator-Ops-Control": token,
        "X-Creator-Ops-Owner": owner,
        "X-Creator-Ops-Generation": str(generation),
    }


class CreatorOpsUIHostOwnershipTests(unittest.TestCase):
    def test_owner_identity_token_generation_and_works_read_are_bound(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_creator_ops_application(Path(directory) / "owner.sqlite3")
            app.initialize_local_store(confirmation=True)
            host = create_creator_ops_ui_host(
                application=app,
                port=0,
                control_token="owned-token",
                owner_id="owner-a",
                owner_generation=7,
                owner_process_id=os.getpid(),
            ).start()
            base = host.url.rstrip("/")
            try:
                request = Request(
                    base + "/api/v1/host-ownership",
                    headers=owner_headers("owned-token", "owner-a", 7),
                )
                with urlopen(request, timeout=5) as response:
                    ownership = json.load(response)
                self.assertEqual(ownership["contractVersion"], "0.1")
                self.assertEqual(ownership["ownerId"], "owner-a")
                self.assertEqual(ownership["ownerGeneration"], 7)
                self.assertEqual(ownership["ownerProcessId"], os.getpid())
                self.assertEqual(ownership["endpoint"], host.status().endpoint.as_dict())
                self.assertTrue(ownership["controlTokenVerified"])
                self.assertTrue(ownership["ready"])

                wrong_token = Request(
                    base + "/api/v1/host-ownership",
                    headers=owner_headers("wrong", "owner-a", 7),
                )
                with self.assertRaises(HTTPError) as token_error:
                    urlopen(wrong_token, timeout=5)
                self.assertEqual(token_error.exception.code, 403)
                self.assertEqual(json.load(token_error.exception)["error"]["code"], "FORBIDDEN")

                wrong_owner = Request(
                    base + "/api/v1/host-ownership",
                    headers=owner_headers("owned-token", "owner-b", 7),
                )
                with self.assertRaises(HTTPError) as owner_error:
                    urlopen(wrong_owner, timeout=5)
                self.assertEqual(owner_error.exception.code, 409)
                self.assertEqual(json.load(owner_error.exception)["error"]["code"], "OWNER_MISMATCH")

                works = Request(
                    base + "/api/v1/integration/works/query",
                    data=json.dumps({"operation": "list", "view": "recent"}).encode("utf-8"),
                    method="POST",
                    headers={
                        **owner_headers("owned-token", "owner-a", 7),
                        "Content-Type": "application/json",
                    },
                )
                with urlopen(works, timeout=5) as response:
                    result = json.load(response)
                self.assertIn("items", result)
            finally:
                host.shutdown()

    def test_exclusive_port_reports_owner_mismatch_and_does_not_kill_existing_host(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_creator_ops_application(Path(directory) / "existing.sqlite3")
            app.initialize_local_store(confirmation=True)
            existing = create_creator_ops_ui_host(
                application=app,
                port=0,
                control_token="existing-token",
                owner_id="existing-owner",
                owner_generation=1,
                owner_process_id=os.getpid(),
            ).start()
            entrypoint = (MODULE_ROOT / "src" / "index.mjs").as_uri()
            script = f"""
                import {{ createCreatorOpsUIHost }} from {json.dumps(entrypoint)};
                const candidate = createCreatorOpsUIHost({{ port: {existing.port}, startupTimeoutMs: 5000 }});
                try {{
                  await candidate.start();
                  console.log(JSON.stringify({{ code: 'UNEXPECTED_READY' }}));
                }} catch (error) {{
                  console.log(JSON.stringify({{ code: error.code, state: candidate.getReadiness().state }}));
                }}
            """
            try:
                completed = subprocess.run(
                    ["node", "--input-type=module", "-e", script],
                    cwd=MODULE_ROOT,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    check=True,
                    timeout=20,
                )
                result = json.loads(completed.stdout)
                self.assertEqual(result, {"code": "OWNER_MISMATCH", "state": "ERROR"})
                with urlopen(existing.url.rstrip("/") + "/api/v1/host-status", timeout=5) as response:
                    status = json.load(response)
                self.assertTrue(status["ready"], "the pre-existing/unknown owner was terminated")
            finally:
                existing.shutdown()

    def test_owner_process_crash_releases_host_and_next_owner_recovers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            port = available_port()
            ready_file = root / "ready.json"
            entrypoint = (MODULE_ROOT / "src" / "index.mjs").as_uri()
            script = f"""
                import fs from 'node:fs';
                import {{ createCreatorOpsUIHost }} from {json.dumps(entrypoint)};
                const host = createCreatorOpsUIHost({{ port: {port}, startupTimeoutMs: 20000 }});
                const ready = await host.start();
                fs.writeFileSync({json.dumps(str(ready_file))}, JSON.stringify(ready));
                setInterval(() => {{}}, 1000);
            """
            environment = {
                **os.environ,
                "CREATOR_OPS_DATABASE": str(root / "crash.sqlite3"),
                "CREATOR_OPS_WORKS_MANAGED_ROOT": str(root / "managed"),
                "CREATOR_OPS_WORKS_CACHE_ROOT": str(root / "cache"),
            }
            owner = subprocess.Popen(
                ["node", "--input-type=module", "-e", script],
                cwd=MODULE_ROOT,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline and not ready_file.is_file():
                    if owner.poll() is not None:
                        self.fail("owner process exited before readiness")
                    time.sleep(0.05)
                self.assertTrue(ready_file.is_file(), "owner did not become ready")
                self.assertEqual(json.loads(ready_file.read_text(encoding="utf-8"))["state"], "READY")
                owner.kill()
                owner.wait(timeout=10)

                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    try:
                        with socket.socket() as released:
                            released.bind(("127.0.0.1", port))
                        break
                    except OSError:
                        time.sleep(0.1)
                else:
                    self.fail("owner crash left the Creator Ops host listening")

                recovery = f"""
                    import {{ createCreatorOpsUIHost }} from {json.dumps(entrypoint)};
                    const host = createCreatorOpsUIHost({{ port: {port}, startupTimeoutMs: 20000 }});
                    const ready = await host.start();
                    const works = await host.execute({{type: 'WORKS_QUERY', request: {{operation: 'list', view: 'recent'}}}});
                    const stopped = await host.stop();
                    console.log(JSON.stringify({{ready, works, stopped}}));
                """
                completed = subprocess.run(
                    ["node", "--input-type=module", "-e", recovery],
                    cwd=MODULE_ROOT,
                    env=environment,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    check=True,
                    timeout=40,
                )
                result = json.loads(completed.stdout)
                self.assertEqual(result["ready"]["state"], "READY")
                self.assertIn("items", result["works"])
                self.assertEqual(result["stopped"]["state"], "STOPPED")
            finally:
                if owner.poll() is None:
                    owner.kill()
                    owner.wait(timeout=10)

    def test_start_stop_start_stop_start_does_not_accumulate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            port = available_port()
            entrypoint = (MODULE_ROOT / "src" / "index.mjs").as_uri()
            script = f"""
                import {{ createCreatorOpsUIHost }} from {json.dumps(entrypoint)};
                const host = createCreatorOpsUIHost({{ port: {port}, startupTimeoutMs: 20000 }});
                const first = await host.start();
                const stop1 = await host.stop();
                const second = await host.start();
                const stop2 = await host.stop();
                const third = await host.start();
                const works = await host.execute({{type: 'WORKS_QUERY', request: {{operation: 'list', view: 'recent'}}}});
                const stop3 = await host.stop();
                console.log(JSON.stringify({{first, stop1, second, stop2, third, works, stop3}}));
            """
            environment = {
                **os.environ,
                "CREATOR_OPS_DATABASE": str(root / "repeat.sqlite3"),
                "CREATOR_OPS_WORKS_MANAGED_ROOT": str(root / "managed"),
                "CREATOR_OPS_WORKS_CACHE_ROOT": str(root / "cache"),
            }
            completed = subprocess.run(
                ["node", "--input-type=module", "-e", script],
                cwd=MODULE_ROOT,
                env=environment,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=True,
                timeout=60,
            )
            result = json.loads(completed.stdout)
            self.assertEqual(
                [result[name]["generation"] for name in ("first", "second", "third")],
                [1, 2, 3],
            )
            self.assertTrue(all(result[name]["runtimeInstanceCount"] == 1 for name in ("first", "second", "third")))
            self.assertTrue(all(result[name]["runtimeInstanceCount"] == 0 for name in ("stop1", "stop2", "stop3")))
            self.assertIn("items", result["works"])


if __name__ == "__main__":
    unittest.main()
