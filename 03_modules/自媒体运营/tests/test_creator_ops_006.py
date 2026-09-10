from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from creator_ops.compatibility import (
    CONFIRMED_LEGACY_ROOT,
    LEGACY_COMMAND_MATRIX,
    CanonicalLegacyRecord,
    ParseStatus,
    RealLegacyAdapter,
    RealLegacyReader,
    StateMappingType,
    legacy_state_mapping_v0_1,
    reconcile_legacy_state,
)
from creator_ops.services import (
    IdentityResolutionStatus,
    ImportAction,
    ImportDryRunPlanner,
    LegacyIdentityResolver,
    TargetIdentity,
)


class CreatorOps006Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "authorized_legacy"
        self.root.mkdir()
        self.reader = RealLegacyReader(self.root)
        self.adapter = RealLegacyAdapter(self.reader)

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def record(**overrides) -> CanonicalLegacyRecord:
        values = {
            "source_path": "legacy/item.json",
            "asset_family": "CONTENT",
            "target_entity": "ContentItem",
            "legacy_identity": "legacy-001",
            "target_identity": "legacy-001",
            "canonical_fields": {"title": "Synthetic title"},
        }
        values.update(overrides)
        return CanonicalLegacyRecord(**values)

    def write_json(self, relative: str, payload) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def test_reader_rejects_parent_escape(self) -> None:
        with self.assertRaises(ValueError):
            self.reader.resolve("../outside.json")

    def test_reader_recognizes_json_object_shape(self) -> None:
        self.write_json("config/accounts.json", {"A1": {"status": None}})
        item = self.reader.inventory()[0]
        self.assertEqual(item.file_format, "JSON")
        self.assertEqual(item.asset_family, "ACCOUNT")
        self.assertEqual(item.parse_status, ParseStatus.PARSED)
        self.assertTrue(item.record_shape.startswith("JSON_OBJECT"))
        self.assertIn("account_code", item.identity_fields)

    def test_reader_distinguishes_json_array_shape(self) -> None:
        self.write_json("registry.json", [{"content_id": "synthetic-1", "status": "planned"}])
        item = self.reader.inventory()[0]
        self.assertEqual(item.record_shape, "JSON_ARRAY:1")
        self.assertIn("content_id", item.identity_fields)
        self.assertIn("status", item.status_fields)

    def test_reader_recognizes_markdown_csv_and_unknown_text(self) -> None:
        (self.root / "note.md").write_text("# Heading\n", encoding="utf-8")
        (self.root / "table.csv").write_text("content_id,status\nsynthetic-1,planned\n", encoding="utf-8")
        (self.root / "unknown.legacy").write_text("opaque", encoding="utf-8")
        inventory = {item.source_path: item for item in self.reader.inventory()}
        self.assertEqual(inventory["note.md"].file_format, "MARKDOWN")
        self.assertEqual(inventory["table.csv"].parse_status, ParseStatus.PARSED)
        self.assertEqual(inventory["unknown.legacy"].parse_status, ParseStatus.UNSTRUCTURED)

    @unittest.skipUnless(CONFIRMED_LEGACY_ROOT.is_dir(), "confirmed legacy root unavailable")
    def test_real_format_inventory_covers_confirmed_96_files(self) -> None:
        inventory = RealLegacyReader.confirmed_creator_ops().inventory()
        self.assertEqual(len(inventory), 96)
        self.assertEqual(sum(item.parse_status is ParseStatus.FAILED for item in inventory), 0)
        self.assertGreaterEqual(len({item.record_shape for item in inventory}), 10)

    @unittest.skipUnless(CONFIRMED_LEGACY_ROOT.is_dir(), "confirmed legacy root unavailable")
    def test_real_adapters_use_only_confirmed_records(self) -> None:
        adapter = RealLegacyAdapter(RealLegacyReader.confirmed_creator_ops())
        self.assertEqual(len(adapter.map_accounts()), 6)
        self.assertEqual(len(adapter.map_contents()), 2)
        self.assertEqual(len(adapter.map_notion_references()), 2)
        self.assertEqual(len(adapter.map_prompts()), 2)
        self.assertEqual(len(adapter.map_content_packages()), 2)

    @unittest.skipUnless(CONFIRMED_LEGACY_ROOT.is_dir(), "confirmed legacy root unavailable")
    def test_real_account_b4_remains_unresolved(self) -> None:
        records = RealLegacyAdapter(RealLegacyReader.confirmed_creator_ops()).map_accounts()
        unresolved = [record for record in records if "LEGACY_ACCOUNT_NOT_FOUND" in record.warnings]
        self.assertEqual(len(unresolved), 1)
        self.assertIsNone(unresolved[0].target_identity)

    @unittest.skipUnless(CONFIRMED_LEGACY_ROOT.is_dir(), "confirmed legacy root unavailable")
    def test_real_publish_metrics_and_review_are_not_inferred(self) -> None:
        adapter = RealLegacyAdapter(RealLegacyReader.confirmed_creator_ops())
        self.assertEqual(adapter.map_real_publish_records(), ())
        self.assertEqual(adapter.map_real_metrics(), ())
        self.assertEqual(adapter.map_real_reviews(), ())

    def test_state_mapping_covers_six_evidenced_states(self) -> None:
        mappings = legacy_state_mapping_v0_1()
        self.assertEqual({item.legacy_state for item in mappings}, {
            "candidate_ready", "planned", "script_ready", "prompt_ready",
            "waiting_for_user_material", "skipped",
        })

    def test_planned_state_is_lossy_and_manual(self) -> None:
        mapped = reconcile_legacy_state("planned")
        self.assertEqual(mapped.mapping_type, StateMappingType.LOSSY)
        self.assertTrue(mapped.requires_manual_review)

    def test_skipped_is_not_content_state(self) -> None:
        mapped = reconcile_legacy_state("skipped")
        self.assertIsNone(mapped.canonical_state)
        self.assertEqual(mapped.mapping_type, StateMappingType.UNMAPPED)

    def test_unknown_state_stays_unmapped(self) -> None:
        mapped = reconcile_legacy_state("unknown-synthetic")
        self.assertIsNone(mapped.canonical_state)
        self.assertTrue(mapped.requires_manual_review)

    def test_metrics_preserves_null_and_zero(self) -> None:
        record = self.adapter.map_metrics_payload({
            "metrics_id": "metric-synthetic", "publish_record_id": "publish-synthetic",
            "views": None, "likes": 0, "collected_at": "2026-08-11T00:00:00Z",
        }, "metrics.json")
        self.assertIsNone(record.canonical_fields["views"])
        self.assertEqual(record.canonical_fields["likes"], 0)

    def test_metrics_marks_invalid_value_without_coercing_to_zero(self) -> None:
        record = self.adapter.map_metrics_payload({
            "metrics_id": "metric-synthetic", "publish_record_id": "publish-synthetic",
            "views": "not-a-number", "collected_at": "2026-08-11T00:00:00Z",
        }, "metrics.json")
        self.assertIsNone(record.canonical_fields["views"])
        self.assertIn("INVALID_METRIC_VALUE:views", record.warnings)
        self.assertFalse(record.valid)

    def test_publish_record_has_legacy_import_provenance(self) -> None:
        record = self.adapter.map_publish_payload({
            "publish_record_id": "publish-synthetic", "account_id": "A1",
            "platform": "synthetic", "content_id": "content-synthetic",
            "status": "PUBLISHED", "actual_publish_time": "2026-08-11T00:00:00Z",
        }, "publish.json")
        self.assertEqual(record.canonical_fields["provenance_kind"], "LEGACY_IMPORTED_RECORD")
        self.assertTrue(record.valid)

    def test_review_preserves_extension_fields(self) -> None:
        record = self.adapter.map_review_payload({
            "review_id": "review-synthetic", "content_id": "content-synthetic",
            "publish_record_id": "publish-synthetic", "reviewed_at": "2026-08-11T00:00:00Z",
            "legacy_rich_field": {"kept": True},
        }, "review.json")
        self.assertEqual(record.canonical_fields["extension_fields"]["legacy_rich_field"], {"kept": True})
        self.assertEqual(record.compatibility, "MERGE_FIELDS")

    def test_manifest_is_parse_only_reference(self) -> None:
        record = self.adapter.parse_manifest_payload({"asset_set_id": "set-synthetic", "entries": []}, "manifest.json")
        self.assertTrue(record.reference_only)
        self.assertEqual(record.target_entity, "LegacyManifest")

    def test_task_lock_is_never_unlocked(self) -> None:
        record = self.adapter.parse_task_lock_payload({"lock_id": "lock-synthetic", "locked": True}, "lock.json")
        self.assertIn("PARSE_ONLY_NO_UNLOCK_OR_WRITEBACK", record.warnings)
        self.assertTrue(record.reference_only)

    @unittest.skipUnless(CONFIRMED_LEGACY_ROOT.is_dir(), "confirmed legacy root unavailable")
    def test_football_visual_is_compatibility_classification_only(self) -> None:
        result = RealLegacyAdapter(RealLegacyReader.confirmed_creator_ops()).classify_football_ai_visual()
        self.assertEqual(result.account_code, "B2")
        self.assertTrue(result.operator_workflow)
        self.assertIn("explicit AI-fantasy disclosure", result.methodology)

    @unittest.skipUnless(CONFIRMED_LEGACY_ROOT.is_dir(), "confirmed legacy root unavailable")
    def test_human_ai_handoff_remains_manual(self) -> None:
        contract = RealLegacyAdapter(RealLegacyReader.confirmed_creator_ops()).build_human_ai_handoff()
        self.assertTrue(contract.manual_checkpoint)
        self.assertEqual(contract.control_mode, "HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF")

    def test_identity_exact_legacy_match(self) -> None:
        resolution = LegacyIdentityResolver().resolve(
            self.record(), (TargetIdentity("ContentItem", "target-1", legacy_identity="legacy-001"),)
        )
        self.assertEqual(resolution.status, IdentityResolutionStatus.MATCHED)

    def test_identity_same_path_match(self) -> None:
        record = self.record(legacy_identity=None)
        target = TargetIdentity("ContentItem", "target-1", source_path=record.source_path)
        self.assertEqual(LegacyIdentityResolver().resolve(record, (target,)).status,
                         IdentityResolutionStatus.MATCHED)

    def test_identity_account_code_match(self) -> None:
        record = self.record(target_entity="Account", legacy_identity=None,
                             canonical_fields={"legacy_account_code": "A1"})
        target = TargetIdentity("Account", "account-1", account_code="A1")
        self.assertEqual(LegacyIdentityResolver().resolve(record, (target,)).status,
                         IdentityResolutionStatus.MATCHED)

    def test_identity_external_post_match(self) -> None:
        record = self.record(target_entity="PublishRecord", legacy_identity=None,
                             canonical_fields={"external_post_id": "external-1"})
        target = TargetIdentity("PublishRecord", "publish-1", external_post_id="external-1")
        self.assertEqual(LegacyIdentityResolver().resolve(record, (target,)).status,
                         IdentityResolutionStatus.MATCHED)

    def test_identity_package_match(self) -> None:
        record = self.record(target_entity="ContentPackage", legacy_identity=None,
                             canonical_fields={"content_id": "content-1"})
        target = TargetIdentity("ContentPackage", "package-1", content_package_identity="content-1")
        self.assertEqual(LegacyIdentityResolver().resolve(record, (target,)).status,
                         IdentityResolutionStatus.MATCHED)

    def test_title_only_is_possible_duplicate(self) -> None:
        target = TargetIdentity("ContentItem", "target-1", title="Synthetic title")
        resolution = LegacyIdentityResolver().resolve(self.record(legacy_identity="other"), (target,))
        self.assertEqual(resolution.status, IdentityResolutionStatus.POSSIBLE_DUPLICATE)

    def test_duplicate_legacy_targets_are_conflict(self) -> None:
        targets = (
            TargetIdentity("ContentItem", "target-1", legacy_identity="legacy-001"),
            TargetIdentity("ContentItem", "target-2", legacy_identity="legacy-001"),
        )
        self.assertEqual(LegacyIdentityResolver().resolve(self.record(), targets).status,
                         IdentityResolutionStatus.CONFLICT)

    def test_identity_new_when_safe_identity_exists(self) -> None:
        self.assertEqual(LegacyIdentityResolver().resolve(self.record(), ()).status,
                         IdentityResolutionStatus.NEW)

    def test_identity_unresolved_without_target_identity(self) -> None:
        record = self.record(legacy_identity=None, target_identity=None, canonical_fields={})
        self.assertEqual(LegacyIdentityResolver().resolve(record, ()).status,
                         IdentityResolutionStatus.UNRESOLVED)

    def test_dry_run_create(self) -> None:
        entry = ImportDryRunPlanner().plan((self.record(),)).entries[0]
        self.assertEqual(entry.action, ImportAction.CREATE)

    def test_dry_run_update(self) -> None:
        target = TargetIdentity("ContentItem", "target-1", legacy_identity="legacy-001")
        entry = ImportDryRunPlanner().plan((self.record(),), (target,)).entries[0]
        self.assertEqual(entry.action, ImportAction.UPDATE)

    def test_dry_run_reference(self) -> None:
        entry = ImportDryRunPlanner().plan((self.record(reference_only=True),)).entries[0]
        self.assertEqual(entry.action, ImportAction.REFERENCE)

    def test_dry_run_skip(self) -> None:
        entry = ImportDryRunPlanner().plan((self.record(compatibility="SKIP"),)).entries[0]
        self.assertEqual(entry.action, ImportAction.SKIP)

    def test_dry_run_conflict(self) -> None:
        targets = (
            TargetIdentity("ContentItem", "target-1", legacy_identity="legacy-001"),
            TargetIdentity("ContentItem", "target-2", legacy_identity="legacy-001"),
        )
        entry = ImportDryRunPlanner().plan((self.record(),), targets).entries[0]
        self.assertEqual(entry.action, ImportAction.CONFLICT)

    def test_dry_run_manual_review(self) -> None:
        entry = ImportDryRunPlanner().plan((self.record(requires_manual_review=True),)).entries[0]
        self.assertEqual(entry.action, ImportAction.MANUAL_REVIEW)

    def test_dry_run_invalid(self) -> None:
        entry = ImportDryRunPlanner().plan((self.record(valid=False),)).entries[0]
        self.assertEqual(entry.action, ImportAction.MANUAL_REVIEW)
        self.assertTrue(entry.invalid)

    def test_dry_run_has_zero_production_writes(self) -> None:
        plan = ImportDryRunPlanner().plan((self.record(), self.record(reference_only=True)))
        self.assertTrue(plan.is_zero_write)
        self.assertEqual(plan.production_writes, ())
        self.assertEqual(plan.action_counts()["CREATE"], 1)
        self.assertEqual(plan.action_counts()["REFERENCE"], 1)

    def test_legacy_command_matrix_is_valid_and_non_destructive(self) -> None:
        allowed = {"KEEP_LEGACY_TOOL", "WRAP_APPLICATION_API", "REPLACE_BY_COMMAND_API", "NO_EQUIVALENT"}
        self.assertTrue(LEGACY_COMMAND_MATRIX)
        self.assertTrue(all(item.disposition in allowed for item in LEGACY_COMMAND_MATRIX))
        self.assertFalse(any(item.disposition == "DELETE" for item in LEGACY_COMMAND_MATRIX))

    @unittest.skipUnless(CONFIRMED_LEGACY_ROOT.is_dir(), "confirmed legacy root unavailable")
    def test_real_dry_run_is_zero_write_and_conservative(self) -> None:
        adapter = RealLegacyAdapter(RealLegacyReader.confirmed_creator_ops())
        plan = ImportDryRunPlanner().plan(adapter.build_reconciliation_records())
        counts = plan.action_counts()
        self.assertEqual(len(plan.entries), 34)
        self.assertEqual(counts["CREATE"], 0)
        self.assertEqual(counts["UPDATE"], 0)
        self.assertEqual(counts["REFERENCE"], 24)
        self.assertEqual(counts["SKIP"], 2)
        self.assertEqual(counts["CONFLICT"], 0)
        self.assertEqual(counts["MANUAL_REVIEW"], 8)
        self.assertEqual(counts["INVALID"], 1)
        self.assertTrue(plan.is_zero_write)


if __name__ == "__main__":
    unittest.main()
