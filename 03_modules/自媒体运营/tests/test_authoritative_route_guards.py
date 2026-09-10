from __future__ import annotations

import ast
import sys
import unittest
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT / "src"))

import creator_ops
from creator_ops.api.application import CreatorOpsApplication
from creator_ops.compatibility import SourceReconciliationCatalog


SRC = MODULE_ROOT / "src" / "creator_ops"


class AuthoritativeRouteGuardTests(unittest.TestCase):
    def test_single_public_facade_and_no_store_export(self) -> None:
        self.assertIs(creator_ops.CreatorOpsApplication, CreatorOpsApplication)
        self.assertFalse(hasattr(creator_ops, "SQLiteCreatorOpsStore"))
        self.assertFalse(hasattr(creator_ops, "CreatorOpsQueryService"))
        self.assertTrue(hasattr(creator_ops, "OperatorDashboard"))
        self.assertTrue(hasattr(creator_ops, "WorkItem"))
        self.assertTrue(hasattr(creator_ops, "VisualProductionPacket"))

    def test_viewmodels_never_import_sqlite_or_persistence(self) -> None:
        for path in (SRC / "viewmodels").glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            imports = [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
            names = [alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names]
            self.assertFalse(any("persistence" in item or "sqlite" in item for item in (*imports, *names)), path)

    def test_source_import_is_not_under_runtime_or_default_database(self) -> None:
        source_root = SourceReconciliationCatalog.current_module().root
        self.assertEqual(source_root.name, "source_import")
        self.assertNotIn("runtime", source_root.parts)

    def test_no_second_publish_service_or_queue_table(self) -> None:
        service_defs = []
        for path in SRC.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            service_defs.extend((path, node.name) for node in ast.walk(tree)
                                if isinstance(node, ast.ClassDef) and "Publish" in node.name)
        self.assertFalse(any(name in {"AutomaticPublisher", "PlatformPublisher"} for _, name in service_defs))
        schema = (SRC / "persistence" / "schema_v0_1.sql").read_text(encoding="utf-8").lower()
        self.assertNotIn("create table if not exists work_queue", schema)

    def test_public_api_does_not_import_legacy_cli_or_source_import(self) -> None:
        text = (SRC / "api" / "application.py").read_text(encoding="utf-8").lower()
        self.assertNotIn("source_import", text)
        self.assertNotIn("automation.orchestrator", text)


if __name__ == "__main__":
    unittest.main()
