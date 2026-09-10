from __future__ import annotations

import inspect
import sys
import unittest
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT / "src"))

import creator_ops
from creator_ops.api.application import CreatorOpsApplication
from creator_ops.compatibility.source_reconciliation import (
    AuthoritativeDecision,
    SOURCE_GROUPS,
    SourceReconciliationCatalog,
)


class FullConsolidationGoal003Tests(unittest.TestCase):
    def test_every_effective_legacy_file_has_an_allowed_owner_decision(self) -> None:
        coverage = SourceReconciliationCatalog.current_module().build()
        self.assertEqual(coverage.coverage_percent, 100.0)
        self.assertEqual(coverage.uncovered_groups, ())
        self.assertEqual(coverage.covered_files, 600)
        self.assertEqual(coverage.total_bytes, 805_312_168)
        self.assertEqual({item.group for item in coverage.records}, set(SOURCE_GROUPS))
        self.assertTrue(all(isinstance(item.decision, AuthoritativeDecision) for item in coverage.records))
        self.assertEqual(coverage.decision_counts()["DELETE_CANDIDATE"], 0)

    def test_ui_ready_read_surface_has_explicit_return_contracts(self) -> None:
        required_methods = {
            "get_dashboard",
            "get_work_queue",
            "get_content_detail",
            "list_content",
            "list_accounts",
            "list_creators",
            "get_account_workload",
            "get_publishing_workbench",
            "get_review_workbench",
            "list_runtime_tasks",
            "list_recovery_evidence",
            "list_qa_receipts",
            "list_research",
            "get_asset_requirements",
            "get_visual_production_packet",
            "get_asset_intake_status",
            "get_visual_review_workbench",
        }
        for name in required_methods:
            signature = inspect.signature(getattr(CreatorOpsApplication, name))
            self.assertIsNot(signature.return_annotation, inspect.Signature.empty, name)

    def test_ui_ready_view_types_are_on_the_controlled_public_surface(self) -> None:
        required_exports = {
            "OperatorDashboard",
            "OperatorSummary",
            "AccountWorkload",
            "WorkItem",
            "NextAction",
            "ManualPublishingWorkbench",
            "ReviewWorkbench",
            "ContentPackageV01",
            "QAReceipt",
            "ProvenanceDTO",
            "AssetRequirement",
            "AssetIntakeSubmission",
            "AssetIntakeStatus",
            "VisualProductionPacket",
            "VisualReviewWorkbench",
        }
        self.assertTrue(required_exports.issubset(set(creator_ops.__all__)))
        self.assertFalse(hasattr(creator_ops, "SQLiteCreatorOpsStore"))
        self.assertFalse(hasattr(creator_ops, "CreatorOpsQueryService"))


if __name__ == "__main__":
    unittest.main()
