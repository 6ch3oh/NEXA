import ast
import json
import sys
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
CASES_PATH = MODULE_ROOT / "fixtures" / "n8n" / "workflow.mapping_cases.json"
SNAPSHOTS_PATH = SRC_ROOT / "automation_center" / "application" / "snapshots.py"
sys.path.insert(0, str(SRC_ROOT))

from automation_center.adapters import N8nExportAdapter, N8nExportContext  # noqa: E402
from automation_center.application import (  # noqa: E402
    SnapshotDiagnosticCode,
    SnapshotSelectionPolicy,
    SnapshotSelectionState,
    SnapshotTimeKind,
    StaticWorkflowQueryService,
    StaticWorkflowSnapshot,
    StaticWorkflowSnapshotSelector,
    group_static_workflow_snapshots,
)
from automation_center.domain import (  # noqa: E402
    AutomationProvider,
    EvidenceAuthority,
    ProviderCapability,
    StatusValue,
    TriggerType,
)


BASE_TIME = datetime(2026, 8, 10, 15, 0, tzinfo=timezone.utc)


class StaticWorkflowSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = N8nExportAdapter()
        cls.cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))
        cls.selector = StaticWorkflowSnapshotSelector()

    def snapshot(
        self,
        case_name,
        *,
        external_id="shared-workflow",
        instance="instance-a",
        locator=None,
        captured_at=BASE_TIME,
        time_kind=SnapshotTimeKind.EVIDENCE_CAPTURED_AT,
        name=None,
    ):
        data = dict(self.cases[case_name])
        data["id"] = external_id
        if name is not None:
            data["name"] = name
        locator = locator or f"fixture:{case_name}.json"
        raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        mapped = self.adapter.map_export(
            raw,
            N8nExportContext("n8n", instance, locator, captured_at),
        )
        return StaticWorkflowSnapshot(mapped.workflow, mapped.evidence, time_kind)

    def two_versions(self):
        older = self.snapshot(
            "inactive_error",
            locator="fixture:older.json",
            captured_at=BASE_TIME,
        )
        newer = self.snapshot(
            "unknown_trigger",
            locator="fixture:newer.json",
            captured_at=BASE_TIME + timedelta(minutes=1),
        )
        return older, newer

    def provider_for(self, snapshot):
        return AutomationProvider(
            ref=snapshot.workflow.provider,
            capabilities=frozenset({ProviderCapability.DEFINITION_READ}),
            provenance=snapshot.workflow.provenance,
        )

    def test_strict_unique_selects_single_snapshot(self):
        snapshot = self.snapshot("inactive_error")
        result = self.selector.select((snapshot,))
        self.assertIs(SnapshotSelectionPolicy.STRICT_UNIQUE, result.policy)
        self.assertIs(snapshot, result.selected_snapshots[0])
        self.assertIs(SnapshotSelectionState.SELECTED, result.groups[0].selection_state)

    def test_strict_unique_marks_duplicates_ambiguous(self):
        result = self.selector.select(self.two_versions())
        self.assertEqual(0, len(result.selected_snapshots))
        self.assertEqual(1, result.overview.ambiguous_workflows)
        self.assertIs(SnapshotDiagnosticCode.DUPLICATE_SNAPSHOTS, result.groups[0].diagnostics[0].code)

    def test_grouping_uses_provider_scoped_identity(self):
        first, second = self.two_versions()
        groups = group_static_workflow_snapshots((second, first))
        self.assertEqual(1, len(groups))
        self.assertEqual(2, groups[0].snapshot_count)

    def test_same_external_id_in_different_instances_is_not_grouped(self):
        first = self.snapshot("inactive_error", instance="instance-a")
        second = self.snapshot("inactive_error", instance="instance-b")
        self.assertEqual(2, len(group_static_workflow_snapshots((first, second))))

    def test_explicit_selects_exact_evidence_id(self):
        first, second = self.two_versions()
        result = self.selector.select(
            (first, second),
            policy=SnapshotSelectionPolicy.EXPLICIT,
            explicit_evidence_ids={first.identity: first.evidence_id},
        )
        self.assertIs(first, result.selected_snapshots[0])
        self.assertIs(SnapshotDiagnosticCode.SELECTED_EXPLICIT, result.groups[0].diagnostics[0].code)

    def test_explicit_unmatched_evidence_is_unresolved(self):
        first, second = self.two_versions()
        result = self.selector.select(
            (first, second),
            policy=SnapshotSelectionPolicy.EXPLICIT,
            explicit_evidence_ids={first.identity: "missing-evidence"},
        )
        self.assertEqual(1, result.overview.unresolved_workflows)
        self.assertEqual(0, result.overview.selected_workflows)

    def test_explicit_missing_identity_choice_is_unresolved(self):
        first, second = self.two_versions()
        result = self.selector.select((first, second), policy=SnapshotSelectionPolicy.EXPLICIT)
        self.assertIs(SnapshotSelectionState.UNRESOLVED, result.groups[0].selection_state)

    def test_explicit_duplicate_evidence_id_is_ambiguous(self):
        snapshot = self.snapshot("inactive_error")
        result = self.selector.select(
            (snapshot, snapshot),
            policy=SnapshotSelectionPolicy.EXPLICIT,
            explicit_evidence_ids={snapshot.identity: snapshot.evidence_id},
        )
        self.assertIs(SnapshotSelectionState.AMBIGUOUS, result.groups[0].selection_state)

    def test_latest_observed_selects_newer_time(self):
        older, newer = self.two_versions()
        result = self.selector.select((newer, older), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(newer, result.selected_snapshots[0])

    def test_latest_observed_with_missing_time_is_unresolved(self):
        older, newer = self.two_versions()
        missing = replace(older, time_kind=SnapshotTimeKind.UNAVAILABLE)
        result = self.selector.select((missing, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(SnapshotDiagnosticCode.MISSING_OBSERVED_AT, result.groups[0].diagnostics[0].code)
        self.assertEqual(1, result.overview.unresolved_workflows)

    def test_latest_observed_with_incompatible_time_semantics_is_unresolved(self):
        older, newer = self.two_versions()
        incompatible = replace(newer, time_kind=SnapshotTimeKind.WORKFLOW_OBSERVED_AT)
        result = self.selector.select((older, incompatible), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(SnapshotDiagnosticCode.INCOMPATIBLE_TIME_SEMANTICS, result.groups[0].diagnostics[0].code)

    def test_latest_time_tie_with_different_content_is_ambiguous(self):
        first = self.snapshot("inactive_error", locator="fixture:a.json")
        second = self.snapshot("unknown_trigger", locator="fixture:b.json")
        result = self.selector.select((first, second), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(SnapshotSelectionState.AMBIGUOUS, result.groups[0].selection_state)
        self.assertIs(SnapshotDiagnosticCode.AMBIGUOUS_LATEST, result.groups[0].diagnostics[0].code)

    def test_content_hash_does_not_define_latest(self):
        first = self.snapshot("inactive_error")
        second = self.snapshot("unknown_trigger")
        older_case, newer_case = (
            ("inactive_error", "unknown_trigger")
            if first.content_hash > second.content_hash
            else ("unknown_trigger", "inactive_error")
        )
        older = self.snapshot(older_case, captured_at=BASE_TIME)
        newer = self.snapshot(newer_case, captured_at=BASE_TIME + timedelta(minutes=1))
        self.assertGreater(older.content_hash, newer.content_hash)
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(newer, result.selected_snapshots[0])

    def test_filename_does_not_define_latest(self):
        older = self.snapshot("inactive_error", locator="fixture:zzz-latest.json", captured_at=BASE_TIME)
        newer = self.snapshot("unknown_trigger", locator="fixture:aaa-older.json", captured_at=BASE_TIME + timedelta(seconds=1))
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(newer, result.selected_snapshots[0])

    def test_source_locator_does_not_define_latest(self):
        older = self.snapshot("inactive_error", locator="fixture:zzz.json", captured_at=BASE_TIME)
        newer = self.snapshot("unknown_trigger", locator="fixture:aaa.json", captured_at=BASE_TIME + timedelta(seconds=1))
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(newer, result.selected_snapshots[0])

    def test_display_name_does_not_define_selection(self):
        older = self.snapshot("inactive_error", name="ZZZ", captured_at=BASE_TIME)
        newer = self.snapshot("unknown_trigger", name="AAA", captured_at=BASE_TIME + timedelta(seconds=1))
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertEqual("AAA", result.selected_workflows[0].display_name)

    def test_equivalent_latest_content_uses_deterministic_representative(self):
        first = self.snapshot("inactive_error", locator="fixture:b.json")
        second = self.snapshot("inactive_error", locator="fixture:a.json")
        result = self.selector.select((first, second), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertEqual(min(first.evidence_id, second.evidence_id), result.selected_snapshots[0].evidence_id)
        self.assertIs(SnapshotDiagnosticCode.EQUIVALENT_CONTENT_DEDUPLICATED, result.groups[0].diagnostics[0].code)

    def test_equivalent_deduplication_preserves_all_evidence(self):
        first = self.snapshot("inactive_error", locator="fixture:a.json")
        second = self.snapshot("inactive_error", locator="fixture:b.json")
        result = self.selector.select((first, second), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertEqual({first.evidence_id, second.evidence_id}, {item.evidence_id for item in result.groups[0].snapshots})

    def test_selection_returns_whole_snapshot_without_field_merge(self):
        older, newer = self.two_versions()
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        selected = result.selected_snapshots[0]
        self.assertIs(newer.workflow, selected.workflow)
        self.assertIs(newer.evidence, selected.evidence)

    def test_definition_status_comes_from_one_selected_snapshot(self):
        older, newer = self.two_versions()
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(StatusValue.ACTIVE, result.selected_workflows[0].definition_status.value)
        self.assertIsNot(StatusValue.INACTIVE, result.selected_workflows[0].definition_status.value)

    def test_triggers_come_from_one_selected_snapshot(self):
        older, newer = self.two_versions()
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        trigger_types = {item.trigger_type for item in result.selected_workflows[0].triggers}
        self.assertEqual({TriggerType.OTHER}, trigger_types)
        self.assertNotIn(TriggerType.ERROR, trigger_types)

    def test_static_evidence_authority_is_not_upgraded(self):
        older, newer = self.two_versions()
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIs(EvidenceAuthority.STATIC_EXPORT, result.selected_evidence[0].authority)
        self.assertIs(EvidenceAuthority.STATIC_EXPORT, result.selected_workflows[0].provenance.authority)

    def test_selection_does_not_create_runtime_status(self):
        older, newer = self.two_versions()
        result = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertIsNone(result.selected_workflows[0].runtime_status)

    def test_overview_counts_unique_selected_identities(self):
        older, newer = self.two_versions()
        other = self.snapshot("missing_active", external_id="other-workflow")
        result = self.selector.select((older, newer, other), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertEqual(2, result.overview.snapshot_groups)
        self.assertEqual(2, result.overview.selected_workflows)

    def test_duplicate_exports_do_not_inflate_query_overview(self):
        first, second = self.two_versions()
        selection = self.selector.select((first, second), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        service = StaticWorkflowQueryService.from_snapshot_selection(selection, (self.provider_for(second),))
        self.assertEqual(1, service.get_overview().total_workflows)
        detail = service.get_snapshot_selection(second.identity)
        self.assertEqual(second.evidence_id, detail.selected_evidence_id)
        self.assertIs(SnapshotSelectionPolicy.LATEST_OBSERVED, detail.policy)
        self.assertEqual(2, detail.snapshot_count)
        self.assertTrue(detail.has_other_snapshots)

    def test_ambiguous_groups_are_explicit_and_excluded_from_queries(self):
        first, second = self.two_versions()
        selection = self.selector.select((first, second))
        service = StaticWorkflowQueryService.from_snapshot_selection(selection, ())
        self.assertEqual(1, selection.overview.ambiguous_workflows)
        self.assertEqual(0, service.get_overview().total_workflows)

    def test_selection_is_deterministic_when_input_order_changes(self):
        older, newer = self.two_versions()
        first = self.selector.select((older, newer), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        second = self.selector.select((newer, older), policy=SnapshotSelectionPolicy.LATEST_OBSERVED)
        self.assertEqual(first, second)

    def test_snapshot_layer_has_no_network_runtime_or_execution_dependencies(self):
        imported_roots = set()
        tree = ast.parse(SNAPSHOTS_PATH.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".")[0])
        self.assertLessEqual(
            imported_roots,
            {"__future__", "automation_center", "collections", "dataclasses", "datetime", "enum"},
        )
        for command in ("execute", "activate", "invoke", "schedule", "webhook", "query_runs"):
            self.assertFalse(hasattr(StaticWorkflowSnapshotSelector, command))


if __name__ == "__main__":
    unittest.main()
