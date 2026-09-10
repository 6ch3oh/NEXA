import json
import re
import unittest
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = MODULE_ROOT / "fixtures" / "n8n" / "workflow.synthetic.json"

SENSITIVE_KEY = re.compile(
    r"(?:credential|password|secret|api[_-]?key|access[_-]?key|token|cookie|authorization|auth[_-]?header)",
    re.IGNORECASE,
)
SENSITIVE_VALUE = re.compile(
    r"(?:bearer\s+[a-z0-9._~+/=-]{12,}|sk-[a-z0-9_-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)",
    re.IGNORECASE,
)


def walk_json(value, path="$"):
    if isinstance(value, dict):
        for key, child in value.items():
            yield f"{path}.{key}", key, child
            yield from walk_json(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_json(child, f"{path}[{index}]")


class SyntheticWorkflowFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = FIXTURE_PATH.read_text(encoding="utf-8")
        cls.workflow = json.loads(cls.raw)

    def test_fixture_is_locally_readable(self):
        self.assertIsInstance(self.workflow, dict)

    def test_workflow_shape_supports_adapter_parsing(self):
        self.assertTrue({"id", "name", "active", "nodes", "connections"}.issubset(self.workflow))
        self.assertEqual(2, len(self.workflow["nodes"]))
        for node in self.workflow["nodes"]:
            self.assertTrue({"id", "name", "type", "typeVersion", "position", "parameters"}.issubset(node))

    def test_connection_targets_are_known_nodes(self):
        node_names = {node["name"] for node in self.workflow["nodes"]}
        for source_name, outputs in self.workflow["connections"].items():
            self.assertIn(source_name, node_names)
            for output_groups in outputs.values():
                for group in output_groups:
                    for target in group or []:
                        self.assertIn(target["node"], node_names)

    def test_fixture_contains_no_obvious_secret_fields_or_patterns(self):
        for path, key, value in walk_json(self.workflow):
            self.assertIsNone(SENSITIVE_KEY.search(key), f"sensitive key at {path}")
            if isinstance(value, str):
                self.assertIsNone(SENSITIVE_VALUE.search(value), f"sensitive value at {path}")

    def test_fixture_is_synthetic_inactive_and_side_effect_free_by_contract(self):
        fixture = self.workflow["_fixture"]
        self.assertEqual("synthetic", fixture["classification"])
        self.assertFalse(fixture["sourceDataCopied"])
        self.assertFalse(fixture["runtimeRequired"])
        self.assertFalse(fixture["networkAllowed"])
        self.assertFalse(fixture["executionAllowed"])
        self.assertFalse(self.workflow["active"])

    def test_fixture_has_no_network_or_external_path_reference(self):
        lower = self.raw.lower()
        self.assertNotIn("http://", lower)
        self.assertNotIn("https://", lower)
        self.assertNotIn("n8n_工作流开发", lower)
        self.assertNotIn("个人数字资产中心", lower)


if __name__ == "__main__":
    unittest.main()
