import importlib.util
import json
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = MODULE_ROOT / "scripts" / "tiangong_workflow_scope_discovery.py"
SPEC = importlib.util.spec_from_file_location("tiangong_workflow_scope_discovery", SCRIPT)
assert SPEC and SPEC.loader
discovery = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = discovery
SPEC.loader.exec_module(discovery)


class TiangongWorkflowScopeDiscoveryTests(unittest.TestCase):
    def test_missing_update_scope_is_identified(self):
        result = discovery.project_capabilities({
            "data": {
                "scopes": ["workflow:read"],
                "resources": {
                    "workflow": {
                        "operations": ["read"],
                        "endpoints": [{"method": "GET", "path": "/workflows/{id}", "operationId": "getWorkflow"}],
                    }
                },
            }
        })
        self.assertTrue(result["workflow_read_scope"])
        self.assertFalse(result["workflow_update_scope"])
        self.assertEqual(result["diagnosis"], "WORKFLOW_UPDATE_SCOPE_OR_EFFECTIVE_CAPABILITY_MISSING")

    def test_present_update_scope_routes_to_role_or_resource_review(self):
        result = discovery.project_capabilities({
            "data": {
                "scopes": ["workflow:update", "workflow:read"],
                "resources": {
                    "workflow": {
                        "operations": ["update", "read"],
                        "endpoints": [{"method": "PUT", "path": "/workflows/{id}", "operationId": "updateWorkflow"}],
                    }
                },
            }
        })
        self.assertTrue(result["workflow_update_scope"])
        self.assertTrue(result["workflow_update_endpoint_visible"])
        self.assertIn("PROJECT_ROLE", result["diagnosis"])

    def test_projection_is_sanitized_and_side_effect_free(self):
        result = discovery.project_capabilities({"data": {"scopes": [], "resources": {}}})
        self.assertFalse(any(result[key] for key in (
            "production_write", "publish", "activate", "workflow_execution",
            "credential_persisted", "secret_exposed",
        )))
        self.assertNotIn("credential", json.dumps(result, ensure_ascii=False).lower().replace("credential_persisted", ""))

    def test_script_is_exact_get_only_hidden_key_transport(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('method="GET"', source)
        self.assertNotIn('method="PUT"', source)
        self.assertNotIn("/activate", source)
        self.assertNotIn("/execute", source)
        self.assertIn("getpass.getpass", source)
        self.assertIn("RuntimeOnlyCredentialProvider", source)
        self.assertEqual(discovery.ENDPOINT, "http://127.0.0.1:5678/api/v1/discover?resource=workflow")


if __name__ == "__main__":
    unittest.main()
