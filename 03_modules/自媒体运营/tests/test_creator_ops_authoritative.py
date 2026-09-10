from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.application.automation_contract import (
    AutomationRecoveryPlanner, AutomationResult, AutomationResultStatus,
    AutomationTrigger, AutomationTriggerType, HumanAIHandoff,
    LockStatus,
    RecoveryAction,
    RecoveryCheckpoint,
    RetryPolicy,
    TaskLock,
    TaskLockPlanner,
)
from creator_ops.compatibility import (
    SOURCE_GROUPS, AuthoritativeDecision, LegacyCaseLibraryMapper,
    LegacyCompatibilityMapper,
    SourceReconciliationCatalog,
)
from creator_ops.domain.quality import QACompatibilityMapper, QAScope, QAStatus
from creator_ops.viewmodels.content_package import (
    PackageCompatibility,
    evaluate_package_completeness,
    map_legacy_content_request,
    map_legacy_package_manifest,
)


class AuthoritativeCreatorOpsTests(unittest.TestCase):
    @staticmethod
    def legacy_package() -> dict:
        return {
            "content_id": "B3_SYNTHETIC_001",
            "package_root": "contents/B3/B3_SYNTHETIC_001",
            "contract_version": "2.0.0",
            "directories": {"prompts": "contents/B3/B3_SYNTHETIC_001/04_prompts"},
            "files": {
                "content_request": {
                    "path": "contents/B3/B3_SYNTHETIC_001/content_request.json",
                    "format": "json", "required": True, "managed_by": "legacy-99A",
                },
                "image_prompts": {
                    "path": "contents/B3/B3_SYNTHETIC_001/04_prompts/image_prompts.csv",
                    "format": "csv", "required": True, "managed_by": "legacy-99A",
                },
                "publish_plan": {
                    "path": "contents/B3/B3_SYNTHETIC_001/07_publish/publish_plan.md",
                    "format": "markdown", "required": False, "managed_by": "legacy-99A",
                },
            },
        }

    @staticmethod
    def risk_rows() -> list[dict]:
        return [
            {"risk_id": "risk-001", "category": "版权与肖像", "item": "manual visual review",
             "level": "MEDIUM", "status": "open", "note": "synthetic"},
            {"risk_id": "risk-002", "category": "表述边界", "item": "manual-only statement",
             "level": "LOW", "status": "checked", "note": "synthetic"},
        ]

    @staticmethod
    def content_request() -> dict:
        return {
            "schema_version": "1.0", "content_id": "B3_SYNTHETIC_001", "account": "B3",
            "platform": "xiaohongshu", "content_type": "image_text", "title": "Title",
            "topic": "Topic", "objective": ["teach"], "target_audience": ["student"],
            "content": {
                "positioning": "AI learning", "hook": "Hook", "script_markdown": "Body",
                "storyboard": [{"item_id": "s1", "sequence": 1}],
                "image_prompts": [{"prompt_id": "i1", "prompt": "synthetic"}],
                "video_prompts": [], "publish_plan": {"title": "Title"},
                "risk_checklist": [{"risk_id": "r1", "status": "open"}],
            },
            "source": {"kind": "synthetic"}, "metadata": {"created_at": "synthetic"},
            "extra": {"legacy_field": {"kept": True}},
        }

    def test_legacy_package_manifest_preserves_file_roles(self) -> None:
        manifest = map_legacy_package_manifest(self.legacy_package(), source_reference="synthetic/package.json")
        self.assertEqual(manifest.content_id, "B3_SYNTHETIC_001")
        self.assertEqual(manifest.compatibility, PackageCompatibility.ADAPTER_COMPATIBLE)
        self.assertEqual(len(manifest.files), 3)
        self.assertEqual({item.logical_name for item in manifest.files},
                         {"content_request", "image_prompts", "publish_plan"})

    def test_package_completeness_distinguishes_required_files(self) -> None:
        manifest = map_legacy_package_manifest(self.legacy_package(), source_reference="synthetic/package.json")
        result = evaluate_package_completeness(
            manifest,
            existing_paths=("contents/B3/B3_SYNTHETIC_001/content_request.json",),
        )
        self.assertFalse(result.complete)
        self.assertEqual(result.missing_files,
                         ("contents/B3/B3_SYNTHETIC_001/04_prompts/image_prompts.csv",))
        self.assertNotIn("contents/B3/B3_SYNTHETIC_001/07_publish/publish_plan.md", result.missing_files)

    def test_content_request_preserves_mature_legacy_fields(self) -> None:
        request = map_legacy_content_request(
            self.content_request(), source_reference="synthetic/content_request.json",
        )
        self.assertEqual(request.account, "B3")
        self.assertEqual(request.storyboard[0]["item_id"], "s1")
        self.assertEqual(request.extra["legacy_field"], {"kept": True})

    def test_qa_is_not_review_and_open_check_blocks_package(self) -> None:
        qa = QACompatibilityMapper.from_risk_checklist(
            "B3_SYNTHETIC_001", self.risk_rows(), source_reference="synthetic/request.json",
        )
        self.assertFalse(qa.passed)
        self.assertTrue(qa.requires_manual_review)
        self.assertEqual(qa.checks[0].scope, QAScope.VISUAL)
        self.assertEqual(qa.checks[0].status, QAStatus.OPEN)
        manifest = map_legacy_package_manifest(self.legacy_package(), source_reference="synthetic/package.json")
        all_required = tuple(item.path for item in manifest.files if item.required)
        self.assertFalse(evaluate_package_completeness(
            manifest, existing_paths=all_required, qa_reports=(qa,),
        ).complete)

    def test_legacy_case_is_independent_from_post_publish_review(self) -> None:
        case = LegacyCaseLibraryMapper.map_case({
            "case_id": "CASE-SYNTHETIC", "title": "Synthetic Case", "platform": "抖音",
            "target_accounts": "B2", "original_url": "https://example.invalid/case",
            "video_status": "link_only", "analysis_status": "pending",
            "materials": {"analysis": "legacy/analysis.md"},
            "richer_legacy_field": {"preserved": True},
        }, source_reference="synthetic/case.json")
        self.assertEqual(case.case_id, "CASE-SYNTHETIC")
        self.assertEqual(case.target_accounts, ("B2",))
        self.assertEqual(case.extension_fields["richer_legacy_field"], {"preserved": True})
        self.assertEqual(dict(case.statuses)["analysis_status"], "pending")

    def test_generic_legacy_mapper_cannot_turn_case_into_review(self) -> None:
        case = LegacyCompatibilityMapper().map_case({
            "case_id": "CASE-SYNTHETIC", "title": "Synthetic Case",
            "platform": "synthetic", "source_path": "synthetic/case.json",
        })
        self.assertEqual(case.case_id, "CASE-SYNTHETIC")
        self.assertFalse(hasattr(case, "publish_record_id"))

    def test_lock_new_acquire_and_idempotent_owner(self) -> None:
        planner = TaskLockPlanner()
        first = planner.plan_acquire(None, task_id="task-1", owner_id="operator-1")
        self.assertTrue(first.allowed)
        self.assertEqual(first.next_fencing_token, 1)
        lock = TaskLock("lock-1", "task-1", "operator-1", 7, LockStatus.HELD, None)
        same = planner.plan_acquire(lock, task_id="task-1", owner_id="operator-1")
        self.assertTrue(same.allowed)
        self.assertEqual(same.next_fencing_token, 7)

    def test_lock_conflict_does_not_steal(self) -> None:
        lock = TaskLock("lock-1", "task-1", "operator-1", 7, LockStatus.HELD, None)
        plan = TaskLockPlanner().plan_acquire(lock, task_id="task-1", owner_id="operator-2")
        self.assertFalse(plan.allowed)
        self.assertEqual(plan.status, LockStatus.CONFLICT)
        self.assertEqual(plan.next_fencing_token, 7)

    def test_recovery_marks_matching_targets_committed(self) -> None:
        checkpoint = RecoveryCheckpoint("txn-1", "APPLYING", {"package": "new"}, {"package": "old"},
                                        frozenset({"package"}), 1)
        plan = AutomationRecoveryPlanner.plan(checkpoint, observed_hashes={"package": "new"})
        self.assertEqual(plan.action, RecoveryAction.MARK_COMMITTED)
        self.assertFalse(plan.executable)

    def test_recovery_plans_forward_or_rollback_from_hash_evidence(self) -> None:
        checkpoint = RecoveryCheckpoint(
            "txn-1", "APPLYING", {"package": "new-p", "state": "new-s"},
            {"package": "old-p", "state": "old-s"}, frozenset({"package"}), 1,
        )
        forward = AutomationRecoveryPlanner.plan(
            checkpoint, observed_hashes={"package": "new-p", "state": "old-s"},
        )
        self.assertEqual(forward.action, RecoveryAction.CONTINUE_FORWARD)
        rollback = AutomationRecoveryPlanner.plan(
            checkpoint, observed_hashes={"package": "old-p", "state": "old-s"},
        )
        self.assertEqual(rollback.action, RecoveryAction.ROLLBACK)

    def test_recovery_external_hash_requires_manual_review(self) -> None:
        checkpoint = RecoveryCheckpoint("txn-1", "APPLYING", {"package": "new"}, {"package": "old"},
                                        frozenset({"package"}), 1)
        plan = AutomationRecoveryPlanner.plan(checkpoint, observed_hashes={"package": "external"})
        self.assertEqual(plan.action, RecoveryAction.MANUAL_REVIEW)

    def test_retry_policy_is_bounded(self) -> None:
        policy = RetryPolicy(3, frozenset({"TEMPORARY_IO"}))
        self.assertTrue(policy.allows(attempt_no=1, error_code="TEMPORARY_IO"))
        self.assertFalse(policy.allows(attempt_no=3, error_code="TEMPORARY_IO"))
        self.assertFalse(policy.allows(attempt_no=1, error_code="IDENTITY_CONFLICT"))

    def test_automation_contract_covers_trigger_result_and_manual_handoff(self) -> None:
        trigger = AutomationTrigger(
            "trigger-1", AutomationTriggerType.MANUAL, "content-1", "operator://choice",
            "trigger:content-1", True,
        )
        result = AutomationResult("task-1", 1, AutomationResultStatus.SUCCEEDED,
                                  ("package://content-1",), evidence_hashes={"package": "hash"})
        handoff = HumanAIHandoff(
            "handoff-1", "task-1", "external_ai_image", "prompt://content-1",
            ("asset://reference",), "generated cover",
        )
        self.assertTrue(trigger.manual_confirmation)
        self.assertEqual(result.evidence_hashes["package"], "hash")
        self.assertTrue(handoff.manual_confirmation_required)
        self.assertEqual(handoff.control_mode, "HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF")

    def test_public_api_exposes_planners_without_database(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp) / "absent.sqlite3"
            app = create_creator_ops_application(db)
            manifest, completeness, qa = app.validate_legacy_package(
                self.legacy_package(), source_reference="synthetic/package.json",
                existing_paths=(), risk_checklist=self.risk_rows(),
            )
            self.assertEqual(manifest.content_id, "B3_SYNTHETIC_001")
            self.assertFalse(completeness.complete)
            self.assertIsNotNone(qa)
            self.assertTrue(app.plan_task_lock(None, task_id="task-1", owner_id="operator-1").allowed)
            checkpoint = RecoveryCheckpoint("txn-1", "PREPARING", {"package": "new"},
                                            {"package": "old"}, frozenset(), 1)
            self.assertEqual(app.plan_recovery(
                checkpoint, observed_hashes={"package": "old"},
            ).action, RecoveryAction.ROLLBACK)
            self.assertFalse(db.exists())

    def test_source_reconciliation_covers_every_effective_file(self) -> None:
        coverage = SourceReconciliationCatalog.current_module().build()
        self.assertEqual(coverage.coverage_percent, 100.0)
        self.assertEqual(coverage.uncovered_groups, ())
        self.assertEqual({item.group for item in coverage.records}, set(SOURCE_GROUPS))
        self.assertTrue(all(item.rationale for item in coverage.records))
        self.assertTrue(all(item.decision in set(AuthoritativeDecision) for item in coverage.records))
        self.assertGreaterEqual(coverage.covered_files, 500)
        self.assertEqual(coverage.decision_counts()["DELETE_CANDIDATE"], 0)

    def test_catalog_excludes_environment_and_cache_trees(self) -> None:
        paths = tuple(item.relative_path for item in SourceReconciliationCatalog.current_module().build().records)
        self.assertFalse(any(".venv/" in path or "__pycache__/" in path for path in paths))

    def test_public_case_adapter_remains_read_only_and_distinct(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp) / "absent.sqlite3"
            app = create_creator_ops_application(db)
            case = app.map_legacy_case({
                "case_id": "CASE-SYNTHETIC", "title": "Synthetic Case",
                "platform": "synthetic", "review_status": "pending",
            }, source_reference="synthetic/case.json")
            self.assertEqual(case.case_id, "CASE-SYNTHETIC")
            self.assertEqual(dict(case.statuses)["review_status"], "pending")
            self.assertFalse(db.exists())


if __name__ == "__main__":
    unittest.main()
