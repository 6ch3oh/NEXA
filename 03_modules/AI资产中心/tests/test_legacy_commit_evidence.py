from __future__ import annotations

import json
import unittest
from pathlib import Path

from src.evidence.contract import Evidence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_ROOT = PROJECT_ROOT / ".nexa" / "evidence"
BASELINE_ROOT = EVIDENCE_ROOT / "legacy-token-monitor"
MANIFEST_PATH = BASELINE_ROOT / "manifest.json"
COMMIT = "7d4e3830ddf5e786d85499571e10086a9cc518f4"
EXPECTED_CATEGORIES = {
    "provider", "token_metadata", "credential_metadata", "usage",
    "balance", "pricing", "cost", "provenance", "pricing_cache",
    "preload_surface",
}


class TestLegacyCommitEvidence(unittest.TestCase):
    def test_manifest_locks_commit_and_disclaims_accident_preimage(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.assertEqual(manifest["legacy_source_type"], "git_commit")
        self.assertEqual(manifest["legacy_source_repository"], "token-monitor")
        self.assertEqual(manifest["legacy_source_commit"], COMMIT)
        self.assertEqual(manifest["accident_preimage_status"], "unknown")
        self.assertIs(manifest["working_tree_used"], False)
        self.assertNotIn("recovered", manifest)
        self.assertEqual(set(manifest["categories"]), EXPECTED_CATEGORIES)

    def test_all_evidence_is_real_commit_traceable_and_secret_screened(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        evidence_files = [
            EVIDENCE_ROOT / relative
            for category in manifest["categories"].values()
            for relative in category["evidence_files"]
        ]
        self.assertGreater(len(evidence_files), 0)
        for path in evidence_files:
            with self.subTest(path=path.name):
                evidence = Evidence.from_dict(json.loads(path.read_text(encoding="utf-8")))
                self.assertIs(evidence.synthetic, False)
                self.assertEqual(evidence.source_repository, "token-monitor")
                self.assertEqual(evidence.facts["legacy_source_commit"], COMMIT)
                self.assertEqual(evidence.facts["source"], "committed_baseline")
                self.assertEqual(evidence.facts["accident_preimage_status"], "unknown")
                self.assertIs(evidence.facts["raw_source_included"], False)

    def test_missing_categories_are_explicit_not_invented(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        for category, result in manifest["categories"].items():
            with self.subTest(category=category):
                self.assertIn(result["status"], {"present", "missing"})
                if result["status"] == "missing":
                    self.assertEqual(result["evidence_files"], [])
