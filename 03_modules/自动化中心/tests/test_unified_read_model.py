import ast
import json
import sys
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
WORKFLOW_FIXTURE = MODULE_ROOT / "fixtures" / "n8n" / "workflow.synthetic.json"
RESULT_FIXTURE = MODULE_ROOT / "fixtures" / "result_intake" / "result.synthetic.json"
UNIFIED_PATH = SRC_ROOT / "automation_center" / "application" / "unified.py"
sys.path.insert(0, str(SRC_ROOT))

from automation_center.adapters import (  # noqa: E402
    LegacyExecutionResultAdapter,
    N8nExportAdapter,
    N8nExportContext,
    ResultIntakeContext,
)
from automation_center.application import (  # noqa: E402
    LatestHistoricalResultState,
    ProvenanceCompleteness,
    SnapshotSelectionPolicy,
    StaticWorkflowQueryService,
    StaticWorkflowSnapshot,
    StaticWorkflowSnapshotSelector,
    UnifiedAutomationQueryService,
    UnifiedDiagnosticCode,
    UnifiedReadProjectionError,
    UnifiedWorkflowClassification,
    serialize_unified_read_model,
)
from automation_center.domain import (  # noqa: E402
    AutomationEvidence,
    AutomationProvider,
    AutomationStatus,
    EvidenceAuthority,
    EvidenceKind,
    Provenance,
    ProviderCapability,
    ProviderRef,
    StatusScope,
    StatusValue,
    WorkflowRef,
)


CAPTURED_AT = datetime(2026, 8, 10, 18, 0, tzinfo=timezone.utc)


class UnifiedReadModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.export_adapter = N8nExportAdapter()
        cls.result_adapter = LegacyExecutionResultAdapter()
        cls.workflow_data = json.loads(WORKFLOW_FIXTURE.read_text(encoding="utf-8"))
        cls.result_data = json.loads(RESULT_FIXTURE.read_text(encoding="utf-8"))

    def map_workflow(
        self,
        *,
        workflow_id="synthetic-workflow-001",
        instance="instance-a",
        name="Synthetic Offline Intake",
        active=False,
    ):
        data = json.loads(json.dumps(self.workflow_data))
        data["id"] = workflow_id
        data["name"] = name
        data["active"] = active
        raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return self.export_adapter.map_export(
            raw,
            N8nExportContext(
                "n8n",
                instance,
                f"fixture:{workflow_id}.json",
                CAPTURED_AT,
                synthetic=True,
            ),
        )

    @staticmethod
    def provider_for(mapped):
        return AutomationProvider(
            ref=mapped.workflow.provider,
            display_name=f"Provider {mapped.workflow.provider.provider_instance_id}",
            capabilities=frozenset({ProviderCapability.DEFINITION_READ}),
            provenance=mapped.workflow.provenance,
        )

    def static_service(self, *mapped):
        providers = {}
        for item in mapped:
            providers.setdefault(item.workflow.provider, self.provider_for(item))
        return StaticWorkflowQueryService(
            (item.workflow for item in mapped),
            providers.values(),
            (item.evidence for item in mapped),
        )

    def snapshot_service(self, mapped):
        snapshot = StaticWorkflowSnapshot(mapped.workflow, mapped.evidence)
        selection = StaticWorkflowSnapshotSelector().select(
            (snapshot,), policy=SnapshotSelectionPolicy.STRICT_UNIQUE
        )
        service = StaticWorkflowQueryService.from_snapshot_selection(
            selection, (self.provider_for(mapped),)
        )
        return service, selection

    def result_records(self, *, instance="instance-a"):
        result = json.dumps(
            self.result_data["result_artifact"],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        summary = json.dumps(
            self.result_data["run_summary_artifact"],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return self.result_adapter.read_artifacts(
            result,
            summary,
            ResultIntakeContext(
                provider_kind="n8n",
                provider_instance_context=instance,
                result_artifact_ref="fixture:unified-result.json",
                run_summary_artifact_ref="fixture:unified-summary.json",
                report_ref="fixture:unified-report",
            ),
        )

    @staticmethod
    def identity(workflow_id="synthetic-workflow-001", instance="instance-a"):
        return WorkflowRef(ProviderRef("n8n", instance), workflow_id)

    @staticmethod
    def clone(record, suffix, **changes):
        changes.setdefault("record_id", f"result-unified-{suffix}")
        changes.setdefault("execution_external_id", f"execution-{suffix}")
        return replace(record, **changes)

    def joined_service(self, records=None):
        mapped = self.map_workflow()
        service = self.static_service(mapped)
        return UnifiedAutomationQueryService(
            service,
            tuple(records if records is not None else self.result_records()),
        )

    def test_static_and_matching_result_join(self):
        model = self.joined_service().get_workflow_read_model(self.identity())
        self.assertEqual(4, model.historical_summary.historical_result_count)
        self.assertEqual(
            UnifiedWorkflowClassification.STATIC_WITH_HISTORICAL_RESULTS.value,
            model.workflow_classification,
        )

    def test_join_uses_full_provider_scoped_workflow_identity(self):
        model = self.joined_service().list_workflow_read_models()[0]
        self.assertEqual("n8n", model.identity.provider_kind)
        self.assertEqual("instance-a", model.identity.provider_instance_id)
        self.assertEqual("synthetic-workflow-001", model.identity.external_workflow_id)

    def test_display_name_does_not_join(self):
        mapped = self.map_workflow(workflow_id="different-workflow", name="synthetic-workflow-001")
        service = UnifiedAutomationQueryService(self.static_service(mapped), self.result_records())
        self.assertEqual(0, service.list_workflow_read_models()[0].historical_summary.historical_result_count)
        self.assertEqual(1, len(service.list_orphan_results()))

    def test_external_workflow_id_does_not_cross_provider_instance(self):
        mapped = self.map_workflow(instance="instance-b")
        service = UnifiedAutomationQueryService(self.static_service(mapped), self.result_records(instance="instance-a"))
        self.assertEqual(0, service.list_workflow_read_models()[0].historical_summary.historical_result_count)
        self.assertEqual("instance-a", service.list_orphan_results()[0].identity.provider_instance_id)

    def test_caller_declared_context_provenance_is_preserved(self):
        model = self.joined_service().list_workflow_read_models()[0]
        self.assertTrue(model.caller_declared_result_identity)
        self.assertTrue(all(item.caller_declared_context for item in model.historical_results))
        self.assertTrue(
            any(
                item.code is UnifiedDiagnosticCode.CALLER_DECLARED_RESULT_IDENTITY
                for item in model.diagnostics
            )
        )

    def test_unresolved_provider_instance_is_not_joined(self):
        unresolved = self.result_records(instance=None)
        model = self.joined_service(unresolved).list_workflow_read_models()[0]
        self.assertEqual(0, model.historical_summary.historical_result_count)

    def test_unresolved_result_is_retained(self):
        service = self.joined_service(self.result_records(instance=None))
        self.assertEqual(4, len(service.list_unresolved_results()))
        self.assertEqual("provider_instance_unresolved", service.list_unresolved_results()[0].unresolved_reason)

    def test_unresolved_result_has_no_complete_identity(self):
        result = self.joined_service(self.result_records(instance=None)).list_unresolved_results()[0].result
        self.assertIsNone(result.execution_identity)
        self.assertIsNone(result.workflow_identity)

    def test_orphan_result_workflow_is_retained(self):
        records = tuple(
            self.clone(item, f"orphan-{index}", workflow_external_id="orphan-workflow")
            for index, item in enumerate(self.result_records())
        )
        orphan = self.joined_service(records).list_orphan_results()[0]
        self.assertEqual("result_only_orphan_static_not_observed", orphan.classification)
        self.assertEqual(4, orphan.historical_summary.historical_result_count)

    def test_orphan_does_not_fabricate_static_definition(self):
        record = self.clone(self.result_records()[0], "orphan-one", workflow_external_id="orphan-workflow")
        service = self.joined_service((record,))
        self.assertEqual(1, len(service.list_workflow_read_models()))
        self.assertEqual(1, len(service.list_orphan_results()))

    def test_static_only_workflow_is_projected(self):
        model = self.joined_service(()).list_workflow_read_models()[0]
        self.assertEqual("static_only_no_recorded_results", model.workflow_classification)
        self.assertEqual(0, model.historical_summary.historical_result_count)
        self.assertIsNone(model.latest_historical_result)

    def test_static_only_does_not_claim_never_run(self):
        model = self.joined_service(()).list_workflow_read_models()[0]
        serialized = serialize_unified_read_model(model).lower()
        self.assertNotIn("never run", serialized)
        self.assertNotIn("never_run", serialized)
        self.assertIn("does not prove the workflow never executed", serialized)

    def test_historical_result_count(self):
        self.assertEqual(4, self.joined_service().get_overview().historical_result_count)

    def test_execution_success_count(self):
        summary = self.joined_service().list_workflow_read_models()[0].historical_summary
        self.assertEqual(3, summary.execution_success_count)

    def test_execution_failed_count(self):
        summary = self.joined_service().list_workflow_read_models()[0].historical_summary
        self.assertEqual(1, summary.execution_failed_count)

    def test_business_partial_count(self):
        summary = self.joined_service().list_workflow_read_models()[0].historical_summary
        self.assertEqual(1, summary.business_partial_count)

    def test_sandbox_result_count(self):
        summary = self.joined_service().list_workflow_read_models()[0].historical_summary
        self.assertEqual(4, summary.sandbox_result_count)

    def test_latest_uses_greatest_trusted_timestamp(self):
        model = self.joined_service().list_workflow_read_models()[0]
        self.assertEqual(LatestHistoricalResultState.SELECTED.value, model.latest_result_state)
        self.assertEqual("synthetic-execution-004", model.latest_historical_result.execution_external_id)

    def test_undated_result_does_not_participate_in_latest(self):
        records = self.result_records()
        future_undated = self.clone(records[0], "undated", observed_at=None)
        model = self.joined_service((records[0], future_undated)).list_workflow_read_models()[0]
        self.assertEqual(records[0].execution_external_id, model.latest_historical_result.execution_external_id)
        self.assertEqual(1, model.historical_summary.undated_result_count)

    def test_only_undated_results_have_no_latest(self):
        undated = self.clone(self.result_records()[0], "undated-only", observed_at=None)
        model = self.joined_service((undated,)).list_workflow_read_models()[0]
        self.assertEqual(LatestHistoricalResultState.NONE.value, model.latest_result_state)
        self.assertIsNone(model.latest_historical_result)

    def test_tied_latest_is_ambiguous(self):
        base = self.result_records()[0]
        first = self.clone(base, "tie-a", observed_at=CAPTURED_AT)
        second = self.clone(base, "tie-b", observed_at=CAPTURED_AT)
        model = self.joined_service((first, second)).list_workflow_read_models()[0]
        self.assertEqual(LatestHistoricalResultState.AMBIGUOUS.value, model.latest_result_state)
        self.assertIsNone(model.latest_historical_result)
        self.assertIn(
            UnifiedDiagnosticCode.AMBIGUOUS_LATEST_RESULT,
            {item.code for item in model.diagnostics},
        )

    def test_tie_breaker_sorts_but_does_not_select_latest(self):
        base = self.result_records()[0]
        first = self.clone(base, "tie-z", observed_at=CAPTURED_AT)
        second = self.clone(base, "tie-a", observed_at=CAPTURED_AT)
        model = self.joined_service((first, second)).list_workflow_read_models()[0]
        self.assertEqual(["execution-tie-a", "execution-tie-z"], [item.execution_external_id for item in model.historical_results])
        self.assertIsNone(model.latest_historical_result)

    def test_execution_success_and_business_partial_remain_separate(self):
        partial = next(item for item in self.joined_service().list_historical_results() if item.business_status == "partial")
        self.assertEqual("success", partial.execution_status)
        self.assertEqual("partial", partial.business_status)

    def test_runtime_is_always_not_observed(self):
        model = self.joined_service().list_workflow_read_models()[0]
        self.assertEqual("not_observed", model.runtime_status)
        self.assertFalse(model.runtime_observed)
        self.assertFalse(model.runtime_available)

    def test_historical_success_does_not_make_runtime_active(self):
        success = next(item for item in self.result_records() if item.execution_status.value == "success")
        model = self.joined_service((success,)).list_workflow_read_models()[0]
        self.assertEqual("success", model.latest_execution_status)
        self.assertNotEqual("active", model.runtime_status)

    def test_historical_failure_does_not_make_runtime_failed(self):
        failed = next(item for item in self.result_records() if item.execution_status.value == "failed")
        model = self.joined_service((failed,)).list_workflow_read_models()[0]
        self.assertEqual("failed", model.latest_execution_status)
        self.assertEqual("not_observed", model.runtime_status)

    def test_definition_status_is_not_overwritten_by_history(self):
        model = self.joined_service().list_workflow_read_models()[0]
        self.assertEqual("inactive", model.definition_status)
        self.assertEqual("success", model.latest_execution_status)

    def test_static_and_result_evidence_authority_are_not_upgraded(self):
        model = self.joined_service().list_workflow_read_models()[0]
        self.assertEqual("synthetic_fixture", model.static_evidence[0].source_type)
        self.assertEqual("synthetic", model.static_evidence[0].authority)
        self.assertEqual(
            "sandbox_real_execution_with_synthetic_dependencies",
            model.historical_results[0].evidence.source_classification,
        )

    def test_result_detail_is_ui_safe_and_integrity_bounded(self):
        result = self.joined_service().list_historical_results()[0]
        self.assertEqual(12, len(result.evidence.source_integrity_prefix))
        self.assertEqual(12, len(result.evidence.sanitized_result_integrity_prefix))
        self.assertEqual(2, result.evidence.source_artifact_count)

    def test_raw_payload_fields_do_not_propagate(self):
        serialized = serialize_unified_read_model(self.joined_service().list_historical_results()).lower()
        for forbidden in ("source_url", "web_text", "raw_payload", "execute_log", "full_content"):
            self.assertNotIn(forbidden, serialized)

    def test_fake_secret_does_not_propagate(self):
        service = self.joined_service()
        serialized = serialize_unified_read_model(
            (service.list_workflow_read_models(), service.list_historical_results(), service.get_overview())
        )
        self.assertNotIn("FAKE_SECRET_VALUE", serialized)

    def test_result_sorting_is_deterministic(self):
        service = self.joined_service()
        self.assertEqual(service.list_historical_results(), service.list_historical_results())

    def test_dated_results_descend_and_undated_results_follow(self):
        records = self.result_records()
        undated = self.clone(records[0], "undated-sort", observed_at=None)
        results = self.joined_service((records[0], records[1], undated)).list_historical_results()
        expected = max((records[0], records[1]), key=lambda item: item.observed_at)
        self.assertEqual(expected.execution_external_id, results[0].execution_external_id)
        self.assertFalse(results[-1].dated)

    def test_overview_preserves_static_workflow_count(self):
        first = self.map_workflow(workflow_id="synthetic-workflow-001")
        second = self.map_workflow(workflow_id="static-only-workflow", name="Static Only")
        service = UnifiedAutomationQueryService(self.static_service(first, second), self.result_records())
        overview = service.get_overview()
        self.assertEqual(2, overview.total_workflows)
        self.assertEqual(2, overview.static_overview.total_workflows)

    def test_overview_counts_unresolved_results(self):
        overview = self.joined_service(self.result_records(instance=None)).get_overview()
        self.assertEqual(4, overview.unresolved_result_count)

    def test_overview_counts_historical_statuses(self):
        overview = self.joined_service().get_overview()
        self.assertEqual(3, overview.historical_execution_success_count)
        self.assertEqual(1, overview.historical_execution_failed_count)
        self.assertEqual(1, overview.historical_business_partial_count)
        self.assertEqual(4, overview.sandbox_result_count)

    def test_overview_counts_static_only_and_orphan(self):
        orphan = self.clone(self.result_records()[0], "overview-orphan", workflow_external_id="orphan-workflow")
        overview = self.joined_service((orphan,)).get_overview()
        self.assertEqual(0, overview.workflows_with_historical_results)
        self.assertEqual(1, overview.workflows_without_observed_historical_results)
        self.assertEqual(1, overview.orphan_result_workflow_count)

    def test_overview_runtime_observed_remains_zero(self):
        overview = self.joined_service().get_overview()
        self.assertEqual(0, overview.runtime_observed_count)
        self.assertEqual(1, overview.runtime_not_observed_count)
        self.assertEqual("not_observed", overview.runtime_status)

    def test_v141_safe_projection_contains_only_contract_fields(self):
        results = self.joined_service().list_historical_results()
        self.assertEqual(4, len(results))
        self.assertTrue(all(item.workflow_identity is not None for item in results))
        self.assertTrue(all(item.safe_result_summary.startswith("Historical webpage_read result") for item in results))

    def test_v2_static_candidate_does_not_fabricate_execution(self):
        mapped = self.map_workflow(workflow_id="knowledge-v2-candidate", name="V2 Candidate")
        model = UnifiedAutomationQueryService(self.static_service(mapped), ()).list_workflow_read_models()[0]
        self.assertEqual(0, model.historical_summary.historical_result_count)
        self.assertIsNone(model.latest_historical_result)

    def test_get_result_requires_full_execution_identity(self):
        service = self.joined_service()
        expected = self.result_records()[0]
        projected = service.get_result_by_execution_identity(expected.execution_identity)
        self.assertEqual(expected.execution_external_id, projected.execution_external_id)

    def test_workflow_get_rejects_name_lookup(self):
        with self.assertRaises(TypeError):
            self.joined_service().get_workflow_read_model("Synthetic Offline Intake")

    def test_snapshot_selection_state_is_preserved(self):
        mapped = self.map_workflow()
        static, selection = self.snapshot_service(mapped)
        model = UnifiedAutomationQueryService(
            static, self.result_records(), snapshot_selection=selection
        ).list_workflow_read_models()[0]
        self.assertEqual("strict_unique", model.snapshot_selection.policy)
        self.assertEqual("selected", model.snapshot_selection.selection_state)
        self.assertEqual(mapped.evidence.evidence_id, model.snapshot_selection.selected_evidence_id)

    def test_snapshot_selection_mismatch_fails_closed(self):
        selected_mapped = self.map_workflow(workflow_id="selected")
        static, selection = self.snapshot_service(selected_mapped)
        different = self.map_workflow(workflow_id="different")
        with self.assertRaises(UnifiedReadProjectionError):
            UnifiedAutomationQueryService(
                self.static_service(different), (), snapshot_selection=selection
            )

    def test_runtime_observation_input_is_rejected(self):
        mapped = self.map_workflow()
        runtime_evidence = AutomationEvidence(
            evidence_id="runtime-evidence-001",
            kind=EvidenceKind.RUNTIME_API,
            authority=EvidenceAuthority.RUNTIME,
            source_locator="runtime:observation-001",
            captured_at=CAPTURED_AT,
            sanitized=True,
            synthetic=False,
            source=mapped.workflow.provider,
            content_hash="1" * 64,
        )
        runtime_provenance = Provenance(runtime_evidence.ref, EvidenceAuthority.RUNTIME, CAPTURED_AT)
        workflow = replace(
            mapped.workflow,
            runtime_status=AutomationStatus(StatusScope.RUNTIME, StatusValue.UNKNOWN, runtime_provenance),
            evidence_refs=mapped.workflow.evidence_refs + (runtime_evidence.ref,),
        )
        static = StaticWorkflowQueryService(
            (workflow,),
            (self.provider_for(mapped),),
            (mapped.evidence, runtime_evidence),
        )
        with self.assertRaises(UnifiedReadProjectionError):
            UnifiedAutomationQueryService(static, ())

    def test_unified_serialization_is_deterministic(self):
        model = self.joined_service().list_workflow_read_models()[0]
        self.assertEqual(serialize_unified_read_model(model), serialize_unified_read_model(model))

    def test_provenance_aggregate_is_partial_when_any_record_is_partial(self):
        records = self.result_records()
        partial = self.clone(
            records[0],
            "partial-provenance",
            observed_at=None,
            source_evidence=replace(
                records[0].source_evidence,
                provenance_completeness=ProvenanceCompleteness.PARTIAL,
            ),
        )
        summary = self.joined_service((records[0], partial)).list_workflow_read_models()[0].historical_summary
        self.assertEqual("partial", summary.provenance_completeness)

    def test_orphan_latest_uses_same_time_rules(self):
        records = self.result_records()
        orphan = tuple(
            self.clone(item, f"orphan-latest-{index}", workflow_external_id="orphan-workflow")
            for index, item in enumerate(records[:2])
        )
        projected = self.joined_service(orphan).list_orphan_results()[0]
        self.assertEqual("selected", projected.latest_result_state)
        expected = max(orphan, key=lambda item: item.observed_at)
        self.assertEqual(expected.execution_external_id, projected.latest_historical_result.execution_external_id)

    def test_unified_layer_has_no_network_runtime_or_execution_dependencies(self):
        imported_roots = set()
        tree = ast.parse(UNIFIED_PATH.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".")[0])
        self.assertLessEqual(
            imported_roots,
            {"__future__", "automation_center", "collections", "dataclasses", "enum", "json", "typing", "queries", "results", "snapshots", "viewmodels"},
        )

    def test_unified_query_has_no_mutation_or_runtime_commands(self):
        for command in ("execute", "activate", "invoke", "schedule", "webhook", "read_runtime", "query_runs"):
            self.assertFalse(hasattr(UnifiedAutomationQueryService, command))


if __name__ == "__main__":
    unittest.main()
