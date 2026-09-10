"""Acceptance contract for NEXA-CREATOR-OPS-CORE-HANDOFF-001."""

from __future__ import annotations

import hashlib
import json
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from creator_ops import (  # noqa: E402
    UIHostLifecycleState,
    create_creator_ops_application,
    create_creator_ops_ui_host,
)


class CoreHandoffContractTests(unittest.TestCase):
    def test_manifest_freezes_identity_lifecycle_and_boundary(self) -> None:
        manifest = json.loads((MODULE_ROOT / "creator-ops.integration.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["contractVersion"], 1)
        self.assertEqual(manifest["publicApiVersion"], "0.2")
        self.assertEqual(manifest["moduleId"], "creator-ops")
        self.assertEqual(manifest["routeId"], "creator-ops")
        self.assertEqual(manifest["authoritativeEntrypoint"], "src/index.mjs")
        self.assertEqual(manifest["applicationFactory"], "creator_ops.create_creator_ops_application")
        self.assertEqual(manifest["uiHostFactory"], "createCreatorOpsUIHost")
        self.assertEqual(manifest["lifecycle"], {
            "states": ["CREATED", "STARTING", "READY", "STOPPING", "STOPPED", "ERROR"],
            "create": "createCreatorOpsUIHost",
            "start": "start",
            "readiness": "getReadiness",
            "stop": "stop",
        })
        self.assertEqual(manifest["ownership"], {
            "contractVersion": "0.1",
            "model": "CREATOR_OPS_UI_HOST_OWNERSHIP_V0_1",
            "readiness": "AUTHENTICATED_OWNER_TOKEN_GENERATION_ENDPOINT",
            "shutdown": "OWNED_CHILD_ONLY",
            "portPolicy": "EXCLUSIVE_FIXED_LOOPBACK",
        })
        self.assertTrue(manifest["readiness"]["machineReadable"])
        self.assertEqual(manifest["endpoint"]["policy"], "FACTORY_RETURNED_LOOPBACK")
        self.assertEqual(manifest["endpoint"]["defaultPort"], 8765)
        boundary = manifest["securityBoundary"]
        self.assertTrue(boundary["loopbackOnly"])
        self.assertEqual(boundary["externalNetwork"], "NONE")
        self.assertEqual(boundary["automaticPublishing"], "NONE")
        self.assertEqual(boundary["coreDatabaseAccess"], "NONE")
        self.assertEqual(boundary["coreRepositoryAccess"], "NONE")
        self.assertEqual(boundary["stdoutProtocol"], "NONE")

    def test_authoritative_entrypoint_exports_core_loader_descriptor(self) -> None:
        entrypoint = (MODULE_ROOT / "src" / "index.mjs").as_uri()
        script = f"""
            import * as api from {json.dumps(entrypoint)};
            console.log(JSON.stringify({{
              moduleId: api.CREATOR_OPS_MODULE_ID,
              routeId: api.CREATOR_OPS_ROUTE_ID,
              entrypoint: api.CREATOR_OPS_AUTHORITATIVE_PUBLIC_ENTRYPOINT,
              applicationFactory: api.CREATOR_OPS_APPLICATION_FACTORY,
              ownershipContractVersion: api.CREATOR_OPS_UI_HOST_OWNERSHIP_CONTRACT_VERSION,
              descriptor: api.CREATOR_OPS_MODULE_DESCRIPTOR,
              manifest: api.CREATOR_OPS_INTEGRATION_MANIFEST,
              hasHostFactory: typeof api.createCreatorOpsUIHost === 'function',
              hasControllerFactory: typeof api.createCreatorOpsController === 'function'
            }}));
        """
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=MODULE_ROOT,
            capture_output=True, text=True, encoding="utf-8", check=True, timeout=20,
        )
        exported = json.loads(completed.stdout)
        self.assertEqual(exported["moduleId"], "creator-ops")
        self.assertEqual(exported["routeId"], "creator-ops")
        self.assertEqual(exported["entrypoint"], "src/index.mjs")
        self.assertEqual(exported["applicationFactory"], "creator_ops.create_creator_ops_application")
        self.assertEqual(exported["ownershipContractVersion"], "0.1")
        self.assertEqual(exported["descriptor"], {
            "contractVersion": 1,
            "moduleId": "creator-ops",
            "invokeChannels": [],
            "pushChannels": [],
        })
        self.assertEqual(
            exported["manifest"],
            json.loads((MODULE_ROOT / "creator-ops.integration.json").read_text(encoding="utf-8")),
        )
        self.assertTrue(exported["hasHostFactory"])
        self.assertTrue(exported["hasControllerFactory"])

    def test_core_entrypoint_has_no_deep_data_or_stdout_dependency(self) -> None:
        entrypoint = (MODULE_ROOT / "src" / "index.mjs").read_text(encoding="utf-8")
        facade = (MODULE_ROOT / "src" / "core-integration" / "creatorOpsHostFacade.mjs").read_text(encoding="utf-8")
        normalized = facade.lower()
        for forbidden in ("sqlite", "source_import", "repository"):
            self.assertNotIn(forbidden, normalized)
        self.assertIn("stdio: 'ignore'", facade)
        self.assertNotIn("child.stdout", facade)
        self.assertNotIn("child.stderr", facade)
        self.assertNotIn("--database", facade)

    def test_python_factory_readiness_clean_controlled_shutdown_and_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = create_creator_ops_application(Path(directory) / "creator_ops_handoff.sqlite3")
            app.initialize_local_store(confirmation=True)
            host = create_creator_ops_ui_host(
                application=app, port=0, control_token="test-internal-control",
            )
            self.assertIs(host.status().state, UIHostLifecycleState.CREATED)
            self.assertEqual(host.status().runtime_instance_count, 0)
            first = host.start().status()
            self.assertIs(first.state, UIHostLifecycleState.READY)
            self.assertTrue(first.ready)
            self.assertEqual(first.runtime_instance_count, 1)
            self.assertEqual(first.generation, 1)
            self.assertEqual(host.start().status().generation, 1)
            with urlopen(host.url.rstrip("/") + "/api/v1/host-status", timeout=5) as response:
                self.assertEqual(json.load(response), host.status().as_dict())
            request = Request(
                host.url.rstrip("/") + "/api/v1/host-shutdown",
                data=b"", method="POST",
                headers={"X-Creator-Ops-Control": "test-internal-control"},
            )
            with urlopen(request, timeout=5) as response:
                self.assertEqual(response.status, 202)
                self.assertEqual(json.load(response)["state"], "STOPPING")
            self.assertTrue(host.wait_until_stopped(timeout=10))
            self.assertIs(host.status().state, UIHostLifecycleState.STOPPED)
            self.assertEqual(host.status().runtime_instance_count, 0)
            port = first.endpoint.port
            host.start()
            self.assertEqual(host.status().generation, 2)
            host.shutdown()
            self.assertIs(host.shutdown().state, UIHostLifecycleState.STOPPED)
            with socket.socket() as released:
                released.bind(("127.0.0.1", port))
            self.assertFalse(any(
                thread.is_alive() and thread.name.startswith("creator-ops-local-ui")
                for thread in threading.enumerate()
            ))

    def test_node_host_facade_repeated_start_stop_restart_without_production_write(self) -> None:
        database = MODULE_ROOT / "runtime" / "data" / "creator_ops_v0_1.sqlite3"
        if not database.is_file():
            self.skipTest("formal production database is not initialized")
        before = hashlib.sha256(database.read_bytes()).hexdigest()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        entrypoint = (MODULE_ROOT / "src" / "index.mjs").as_uri()
        script = f"""
            import {{ createCreatorOpsUIHost }} from {json.dumps(entrypoint)};
            const host = createCreatorOpsUIHost({{ port: {port}, startupTimeoutMs: 20000 }});
            const created = host.getReadiness();
            const first = await host.start();
            const repeated = await host.start();
            const dashboard = await fetch(`${{first.endpoint.url}}api/v1/dashboard`).then(r => r.json());
            const stopped = await host.stop();
            const repeatedStop = await host.stop();
            const restarted = await host.start();
            const finalStop = await host.stop();
            console.log(JSON.stringify({{created, first, repeated, dashboard, stopped, repeatedStop, restarted, finalStop}}));
        """
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=MODULE_ROOT,
            capture_output=True, text=True, encoding="utf-8", check=True, timeout=60,
        )
        result = json.loads(completed.stdout)
        self.assertEqual(result["created"]["state"], "CREATED")
        self.assertEqual(result["first"]["state"], "READY")
        self.assertEqual(result["first"]["runtimeInstanceCount"], 1)
        self.assertEqual(result["first"]["endpoint"], result["repeated"]["endpoint"])
        self.assertEqual(result["first"]["generation"], result["repeated"]["generation"])
        self.assertIn("dashboard", result["dashboard"])
        self.assertEqual(result["stopped"]["state"], "STOPPED")
        self.assertEqual(result["repeatedStop"]["runtimeInstanceCount"], 0)
        self.assertEqual(result["restarted"]["generation"], 2)
        self.assertEqual(result["finalStop"]["state"], "STOPPED")
        with socket.socket() as released:
            released.bind(("127.0.0.1", port))
        self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), before)

    def test_host_factory_rejects_non_loopback_and_invalid_port_safely(self) -> None:
        entrypoint = (MODULE_ROOT / "src" / "index.mjs").as_uri()
        script = f"""
            import {{ createCreatorOpsUIHost }} from {json.dumps(entrypoint)};
            const errors = [];
            for (const options of [{{host: '0.0.0.0'}}, {{port: 0}}]) {{
              try {{ createCreatorOpsUIHost(options); }} catch (error) {{
                errors.push({{name: error.name, code: error.code, message: error.message}});
              }}
            }}
            console.log(JSON.stringify(errors));
        """
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=MODULE_ROOT,
            capture_output=True, text=True, encoding="utf-8", check=True, timeout=20,
        )
        errors = json.loads(completed.stdout)
        self.assertEqual([item["code"] for item in errors], ["INVALID_HOST", "INVALID_PORT"])
        self.assertTrue(all(item["name"] == "CreatorOpsHostError" for item in errors))
        self.assertFalse(any(str(MODULE_ROOT) in item["message"] for item in errors))


if __name__ == "__main__":
    unittest.main()
