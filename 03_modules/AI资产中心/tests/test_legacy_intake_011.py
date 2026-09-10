from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from src.evidence import Evidence, EvidenceCategory

PROJECT_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_ROOT = PROJECT_ROOT / ".nexa" / "evidence"
BASELINE_ROOT = EVIDENCE_ROOT / "legacy-token-monitor"
COMMIT = "7d4e3830ddf5e786d85499571e10086a9cc518f4"

NEW_EVIDENCE = {
    "pricing_cache": {
        "relative": (
            "legacy-token-monitor/pricing_cache/"
            "token-monitor-src_shared_tokscalePricingCacheFallback.js-"
            "pricing_cache-66e4bd65c11a.json"
        ),
        "source_path": "src/shared/tokscalePricingCacheFallback.js",
        "blob_oid": "6a276347c777b2a4db03aaaa89545d282195121b",
        "source_sha256": "66e4bd65c11a482e57550c46827aa75af2cc170cdfacb9904f4cc64908ad14ce",
    },
    "preload_surface": {
        "relative": (
            "legacy-token-monitor/preload_surface/"
            "token-monitor-src_electron_preload.js-preload_surface-"
            "a14973c8d41f.json"
        ),
        "source_path": "src/electron/preload.js",
        "blob_oid": "ba11e4699c39c61b38920439f3263f91083ca7e1",
        "source_sha256": "a14973c8d41f1ca3fdadf7b8f3c907153034452c82695a146a51ae0ecee5428a",
    },
}

ORIGINAL_EVIDENCE_HASHES = {
    "legacy-token-monitor/balance/token-monitor-src_shared_deepseekBalanceHistory.js-balance-ffe4a4242d28.json": "96d74335e226c8773b3b71df2f8694db2580d85d518bd3b02866e45acdaa8bae",
    "legacy-token-monitor/balance/token-monitor-src_shared_limits.js-balance-f243375d3f9f.json": "01e92650eb4e41165f95afd1e7e22d76d3da9daa2a0c37f2a43b8d896b124c0e",
    "legacy-token-monitor/cost/token-monitor-src_shared_deepseekBalanceHistory.js-cost-ffe4a4242d28.json": "c61aba21966383ed60a888bd86fefad9bd2833851f0d458c5094d4e7ee4d9904",
    "legacy-token-monitor/cost/token-monitor-src_shared_usage.js-cost-cc43baa0cd45.json": "e238104a4872353b76d8a3f8cfe31a2a1bf4d51c4403ca8ca57d6ec6f175ee3d",
    "legacy-token-monitor/credential_metadata/token-monitor-src_shared_credentialStore.js-credential_metadata-5caf436ff8ed.json": "68d099f28d8616b100f9880e95174a2bc91aa1b42d832577a994e5aa307de26b",
    "legacy-token-monitor/credential_metadata/token-monitor-src_shared_hashKey.js-credential_metadata-e9f27306d14b.json": "29aceb3e467090381d87aaec26e447af82a0fc5047cf6f00ec64302164652203",
    "legacy-token-monitor/pricing/token-monitor-src_shared_tokscaleCustomPricing.js-pricing-50d9d699d9db.json": "b4f5bc370e2b44b3d6f49c21fbf90b962802351b9722e69e2c5cde8db0accc35",
    "legacy-token-monitor/provenance/token-monitor-src_shared_limitCollector.js-provenance-a73158e8ea8b.json": "f0bf8752a762db56d4d1eb06ad74dcb32f8d86e74f60a81c4408260724a67b1b",
    "legacy-token-monitor/provenance/token-monitor-src_shared_limits.js-provenance-f243375d3f9f.json": "1b335ecc9cb3c6c92a9f24c4bf1fd3bde46fa431d4f7927b0cc490f30a0471ea",
    "legacy-token-monitor/provider/token-monitor-src_shared_limitCollector.js-provider-a73158e8ea8b.json": "fed61da471a0c1b37fa4dd4a7ce0cbf22fba769bafd7c7226d505dd01613339e",
    "legacy-token-monitor/provider/token-monitor-src_shared_limits.js-provider-f243375d3f9f.json": "8ac49b5052a73ab59044b5df304959b45037ace84f2b52711153b17c1a22c53f",
    "legacy-token-monitor/token_metadata/token-monitor-src_shared_limits.js-token_metadata-f243375d3f9f.json": "72ab782d1676e40b7292cb6526ce84785d411de13982ec20cb425ba7144f313d",
    "legacy-token-monitor/usage/token-monitor-src_shared_usage.js-usage-cc43baa0cd45.json": "4b224b42edccbeb8607833b200bc991fafbbaa196174dbf96747db83453e2d7b",
}


class TestLegacyIntake011(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = json.loads(
            (BASELINE_ROOT / "manifest.json").read_text(encoding="utf-8")
        )

    def test_new_evidence_is_commit_locked_traceable_and_secret_screened(self) -> None:
        self.assertEqual(self.manifest["legacy_source_commit"], COMMIT)
        self.assertEqual(self.manifest["legacy_source_type"], "git_commit")
        self.assertIs(self.manifest["working_tree_used"], False)
        for category, expected in NEW_EVIDENCE.items():
            with self.subTest(category=category):
                path = EVIDENCE_ROOT / expected["relative"]
                evidence = Evidence.from_dict(json.loads(path.read_text(encoding="utf-8")))
                self.assertEqual(evidence.category.value, category)
                self.assertEqual(evidence.source_relative_path, expected["source_path"])
                self.assertEqual(evidence.source_sha256, expected["source_sha256"])
                self.assertEqual(evidence.facts["git_blob_oid"], expected["blob_oid"])
                self.assertEqual(evidence.facts["legacy_source_commit"], COMMIT)
                self.assertEqual(evidence.facts["source"], "committed_baseline")
                self.assertIs(evidence.facts["working_tree_used"], False)
                self.assertIs(evidence.facts["raw_source_included"], False)
                self.assertIs(evidence.synthetic, False)

    def test_original_evidence_bytes_are_unchanged(self) -> None:
        for relative, expected_hash in ORIGINAL_EVIDENCE_HASHES.items():
            with self.subTest(relative=relative):
                actual = hashlib.sha256((EVIDENCE_ROOT / relative).read_bytes()).hexdigest()
                self.assertEqual(actual, expected_hash)

    def test_manifest_adds_only_the_two_intake_categories(self) -> None:
        self.assertEqual(
            self.manifest["categories"]["pricing_cache"]["evidence_files"],
            [NEW_EVIDENCE["pricing_cache"]["relative"]],
        )
        self.assertEqual(
            self.manifest["categories"]["preload_surface"]["evidence_files"],
            [NEW_EVIDENCE["preload_surface"]["relative"]],
        )
        self.assertEqual(EvidenceCategory.PRICING_CACHE.value, "pricing_cache")
        self.assertEqual(EvidenceCategory.PRELOAD_SURFACE.value, "preload_surface")

    def test_mapping_is_complete_and_keeps_transport_out_of_domain_core(self) -> None:
        mapping = (PROJECT_ROOT / "docs" / "LEGACY_AI_ASSET_MAPPING.md").read_text(
            encoding="utf-8"
        )
        for required in (
            "## Offline Pricing Cache (NEXA-AI-011 intake)",
            "## Preload API (NEXA-AI-011 intake)",
            "A `DIRECT_REUSE`: none",
            "B `ADAPTER`",
            "C `MISSING`",
            "D `DO_NOT_REUSE`",
            "transport surface, not a domain contract",
            "No new Provider, Token, Pricing, or Credential core is required",
            "working tree was not",
        ):
            with self.subTest(required=required):
                self.assertIn(required, mapping)
        self.assertIn("## Permanent historical boundary", mapping)
        self.assertIn("accident_preimage_status: UNKNOWN", mapping)


if __name__ == "__main__":
    unittest.main()
