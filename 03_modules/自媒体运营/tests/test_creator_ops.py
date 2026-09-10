from __future__ import annotations

import json
import sys
import unittest
from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timezone
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT / "src"))

from creator_ops.compatibility import LegacyCompatibilityMapper  # noqa: E402
from creator_ops.domain.models import (  # noqa: E402
    Account, AccountStatus, ContractError, ContentState, LEGACY_ACCOUNT_CODES,
    PublishStatus,
)
from creator_ops.fixtures import load_fixture  # noqa: E402
from creator_ops.state import InvalidTransition, map_legacy_state, transition  # noqa: E402
from creator_ops.viewmodels import build_overview  # noqa: E402


class CreatorOpsBaselineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture_path = MODULE_ROOT / "tests" / "fixtures" / "creator_ops_minimal.json"
        cls.fixture = load_fixture(cls.fixture_path)

    def test_domain_contracts_are_versioned_and_immutable(self) -> None:
        self.assertEqual(self.fixture.creator.version, "0.1")
        self.assertTrue(all(x.version == "0.1" for x in self.fixture.accounts))
        with self.assertRaises(FrozenInstanceError):
            self.fixture.creator.name = "mutation"  # type: ignore[misc]

    def test_account_legacy_code_compatibility(self) -> None:
        codes = {x.legacy_account_code for x in self.fixture.accounts}
        self.assertEqual(codes, LEGACY_ACCOUNT_CODES)
        self.assertTrue(all(x.is_known_legacy_account for x in self.fixture.accounts))

    def test_state_machine_main_chain(self) -> None:
        chain = [
            ContentState.IDEA, ContentState.DRAFT, ContentState.ASSET_PREPARATION,
            ContentState.REVIEW, ContentState.READY_TO_PUBLISH, ContentState.PUBLISHED,
            ContentState.METRICS_PENDING, ContentState.REVIEWED,
        ]
        for current, target in zip(chain, chain[1:]):
            self.assertIs(transition(current, target), target)

    def test_invalid_transition_rejected(self) -> None:
        with self.assertRaises(InvalidTransition):
            transition(ContentState.IDEA, ContentState.PUBLISHED)
        with self.assertRaises(InvalidTransition):
            transition(ContentState.REVIEWED, ContentState.DRAFT)

    def test_legacy_state_mapping_preserves_original_label(self) -> None:
        mapper = LegacyCompatibilityMapper("synthetic_legacy")
        raw = {
            "id": "legacy-content-1", "creator_id": "creator-demo-001",
            "accounts": ["acct-a1"], "topic": "兼容示例", "state": "待发布",
            "created_at": "2026-08-01T00:00:00Z",
        }
        mapped = mapper.map_content(raw)
        self.assertIs(mapped.current_state, ContentState.READY_TO_PUBLISH)
        self.assertEqual(mapped.extension_fields["legacy_state"], "待发布")
        self.assertEqual(map_legacy_state("已复盘"), ContentState.REVIEWED)

    def test_legacy_account_mapping_keeps_unknown_fields(self) -> None:
        mapper = LegacyCompatibilityMapper("synthetic_legacy")
        mapped = mapper.map_account(self.fixture.legacy_examples[0])
        self.assertIsInstance(mapped, Account)
        self.assertEqual(mapped.legacy_account_code, "A1")
        self.assertIs(mapped.status, AccountStatus.ACTIVE)
        self.assertEqual(mapped.extension_fields["unmapped_note"], "must survive in extensions")

    def test_fixture_has_required_coverage_and_is_synthetic(self) -> None:
        raw = json.loads(self.fixture_path.read_text(encoding="utf-8"))
        states = {x.current_state for x in self.fixture.contents}
        self.assertTrue(raw["synthetic_data_only"])
        self.assertTrue({ContentState.IDEA, ContentState.DRAFT, ContentState.ASSET_PREPARATION,
                         ContentState.READY_TO_PUBLISH, ContentState.PUBLISHED,
                         ContentState.METRICS_PENDING, ContentState.REVIEWED}.issubset(states))
        self.assertTrue(self.fixture.assets)
        self.assertTrue(self.fixture.metrics)
        self.assertTrue(self.fixture.reviews)
        self.assertTrue(self.fixture.legacy_examples)

    def test_provenance_incomplete_is_preserved_not_fabricated(self) -> None:
        content = next(x for x in self.fixture.contents if x.content_id == "content-incomplete-prov")
        self.assertFalse(content.provenance.is_complete)
        self.assertIsNone(content.provenance.source_reference)
        self.assertIsNone(content.provenance.captured_at)

    def test_metrics_distinguish_null_from_zero(self) -> None:
        item = next(x for x in self.fixture.metrics if x.metrics_id == "metrics-002")
        self.assertIsNone(item.views)
        self.assertEqual(item.likes, 0)
        self.assertIsNone(item.comments)

    def test_publish_record_enforces_manual_confirmation(self) -> None:
        published = self.fixture.publish_records[0]
        self.assertIs(published.publish_status, PublishStatus.PUBLISHED)
        self.assertTrue(published.manual_confirmation)
        with self.assertRaises(ContractError):
            replace(published, manual_confirmation=False)
        with self.assertRaises(ContractError):
            replace(published, actual_publish_time=None)

    def test_content_asset_and_publish_are_separate_contracts(self) -> None:
        content = next(x for x in self.fixture.contents if x.content_id == "content-assets")
        asset = self.fixture.assets[0]
        self.assertIn(asset.asset_id, content.asset_references)
        self.assertIn(content.content_id, asset.content_relations)
        self.assertFalse(hasattr(content, "external_post_id"))

    def test_overview_viewmodel_is_read_only_and_complete(self) -> None:
        overview = build_overview(
            self.fixture.accounts, self.fixture.contents, self.fixture.assets,
            self.fixture.publish_records, self.fixture.metrics, self.fixture.reviews,
            now=datetime(2026, 8, 10, tzinfo=timezone.utc),
        )
        self.assertEqual(overview.account_summary.total, 6)
        self.assertEqual(overview.ready_to_publish_count, 1)
        self.assertEqual(overview.metrics_pending, 1)
        self.assertEqual(overview.reviews_pending, 2)
        self.assertEqual(len(overview.published_recently), 3)
        self.assertTrue(any(x.startswith("INCOMPLETE_PROVENANCE") for x in overview.warnings))
        with self.assertRaises(TypeError):
            overview.content_pipeline_counts["IDEA"] = 99  # type: ignore[index]


if __name__ == "__main__":
    unittest.main()
