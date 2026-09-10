import ast
import json
import sys
import unittest
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
FIXTURE_PATH = MODULE_ROOT / "fixtures" / "n8n" / "workflow.synthetic.json"
CASES_PATH = MODULE_ROOT / "fixtures" / "n8n" / "workflow.mapping_cases.json"
QUERIES_PATH = SRC_ROOT / "automation_center" / "application" / "queries.py"
VIEWMODELS_PATH = SRC_ROOT / "automation_center" / "application" / "viewmodels.py"
sys.path.insert(0, str(SRC_ROOT))

from automation_center.adapters import N8nExportAdapter, N8nExportContext  # noqa: E402
from automation_center.application import (  # noqa: E402
    ApplicationProjectionError,
    DuplicateWorkflowIdentityError,
    StaticWorkflowQueryService,
    serialize_viewmodel,
)
from automation_center.domain import (  # noqa: E402
    AutomationEvidence,
    AutomationProvider,
    AutomationStatus,
    EvidenceAuthority,
    EvidenceKind,
    Provenance,
    ProviderCapability,
    StatusScope,
    StatusValue,
    TriggerType,
)


CAPTURED_AT = datetime(2026, 8, 10, 14, 0, tzinfo=timezone.utc)


class ApplicationViewModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = N8nExportAdapter()
        cls.form_raw = FIXTURE_PATH.read_text(encoding="utf-8")
        cls.cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))

    def map_data(self, data, *, instance="instance-a", locator="fixture:case.json", synthetic=False):
        raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return self.adapter.map_export(
            raw,
            N8nExportContext("n8n", instance, locator, CAPTURED_AT, synthetic=synthetic),
        )

    def mapped_set(self):
        active_form = json.loads(self.form_raw)
        active_form["active"] = True
        active_form["name"] = "Repeated Name"
        inactive_error = self.cases["inactive_error"] | {"name": "Repeated Name"}
        unknown = self.cases["missing_active"]
        return (
            self.map_data(active_form, locator="fixture:active-form.json"),
            self.map_data(inactive_error, locator="fixture:inactive-error.json"),
            self.map_data(unknown, instance="instance-b", locator="fixture:unknown.json"),
        )

    def service(self, results=None):
        results = tuple(results or self.mapped_set())
        providers = {}
        for result in results:
            ref = result.workflow.provider
            providers.setdefault(
                ref,
                AutomationProvider(
                    ref=ref,
                    capabilities=frozenset({ProviderCapability.DEFINITION_READ}),
                    provenance=result.workflow.provenance,
                    display_name=f"Provider {ref.provider_instance_id}",
                ),
            )
        return StaticWorkflowQueryService(
            workflows=(result.workflow for result in results),
            providers=providers.values(),
            evidence=(result.evidence for result in results),
        )

    def test_multiple_domain_workflows_project_to_list(self):
        items = self.service().list_workflows()
        self.assertEqual(3, len(items))

    def test_same_display_name_workflows_are_both_retained(self):
        items = self.service().list_workflows(text="Repeated Name")
        self.assertEqual(2, len(items))
        self.assertNotEqual(items[0].identity, items[1].identity)

    def test_duplicate_provider_scoped_identity_fails_closed(self):
        result = self.mapped_set()[0]
        provider = AutomationProvider(
            ref=result.workflow.provider,
            capabilities=frozenset({ProviderCapability.DEFINITION_READ}),
            provenance=result.workflow.provenance,
        )
        with self.assertRaises(DuplicateWorkflowIdentityError):
            StaticWorkflowQueryService(
                (result.workflow, result.workflow),
                (provider,),
                (result.evidence,),
            )

    def test_definition_active_presentation(self):
        item = next(item for item in self.service().list_workflows() if item.definition_status == "active")
        self.assertEqual("active", item.definition_status)

    def test_definition_inactive_presentation(self):
        item = next(item for item in self.service().list_workflows() if item.definition_status == "inactive")
        self.assertEqual("inactive", item.definition_status)

    def test_definition_unknown_presentation(self):
        item = next(item for item in self.service().list_workflows() if item.definition_status == "unknown")
        self.assertEqual("unknown", item.definition_status)

    def test_runtime_none_is_not_inactive(self):
        for item in self.service().list_workflows():
            self.assertEqual("not_observed", item.runtime_status)
            self.assertNotEqual("inactive", item.runtime_status)

    def test_runtime_none_is_not_stopped(self):
        for item in self.service().list_workflows():
            self.assertNotEqual("stopped", item.runtime_status)
            self.assertFalse(item.runtime_observed)
            self.assertFalse(item.runtime_available)

    def test_runtime_observed_count_is_zero_without_observations(self):
        overview = self.service().get_overview()
        self.assertEqual(0, overview.runtime_observed_count)
        self.assertEqual(3, overview.runtime_not_observed_count)

    def test_definition_active_count_is_independent_from_runtime(self):
        overview = self.service().get_overview()
        self.assertEqual(1, overview.definition_active_count)
        self.assertEqual(0, overview.runtime_active_count)

    def test_form_trigger_summary(self):
        items = self.service().list_workflows(trigger_type=TriggerType.FORM)
        summary = items[0].trigger_summary
        self.assertTrue(any(item.trigger_type == "form" and item.count == 1 for item in summary))

    def test_error_trigger_summary(self):
        items = self.service().list_workflows(trigger_type=TriggerType.ERROR)
        self.assertEqual("error", items[0].trigger_summary[0].trigger_type)

    def test_other_trigger_summary(self):
        result = self.map_data(self.cases["unknown_trigger"])
        item = self.service((result,)).list_workflows()[0]
        self.assertEqual("other", item.trigger_summary[0].trigger_type)

    def test_provider_kind_filter(self):
        self.assertEqual(3, len(self.service().list_workflows(provider_kind="n8n")))
        self.assertEqual(0, len(self.service().list_workflows(provider_kind="other")))

    def test_provider_instance_filter(self):
        items = self.service().list_workflows(provider_instance_id="instance-b")
        self.assertEqual(1, len(items))
        self.assertEqual("instance-b", items[0].provider_instance_id)

    def test_definition_status_filter(self):
        items = self.service().list_workflows(definition_status=StatusValue.INACTIVE)
        self.assertEqual(1, len(items))
        self.assertEqual("inactive", items[0].definition_status)

    def test_trigger_filter(self):
        items = self.service().list_workflows(trigger_type=TriggerType.ERROR)
        self.assertEqual(1, len(items))

    def test_text_search_does_not_change_identity(self):
        service = self.service()
        all_items = {item.identity for item in service.list_workflows()}
        searched = service.list_workflows(text="repeated")
        self.assertTrue({item.identity for item in searched}.issubset(all_items))

    def test_default_sort_is_deterministic(self):
        service = self.service()
        first = service.list_workflows()
        second = service.list_workflows()
        self.assertEqual(first, second)
        self.assertEqual(
            list(first),
            sorted(
                first,
                key=lambda item: (
                    item.display_name.casefold(),
                    item.provider_kind,
                    item.provider_instance_id,
                    item.identity.external_workflow_id,
                ),
            ),
        )

    def test_viewmodel_serialization_is_deterministic(self):
        item = self.service().list_workflows()[0]
        self.assertEqual(serialize_viewmodel(item), serialize_viewmodel(item))

    def test_get_workflow_uses_identity(self):
        result = self.mapped_set()[0]
        detail = self.service().get_workflow(result.workflow.ref)
        self.assertEqual(result.workflow.ref.external_workflow_id, detail.summary.identity.external_workflow_id)

    def test_name_is_not_supported_as_detail_lookup(self):
        with self.assertRaises(TypeError):
            self.service().get_workflow("Repeated Name")

    def test_static_export_evidence_preserves_authority(self):
        result = self.map_data(self.cases["inactive_error"])
        detail = self.service((result,)).get_workflow(result.workflow.ref)
        self.assertEqual("static_export", detail.evidence[0].source_type)
        self.assertEqual("static_export", detail.evidence[0].authority)
        self.assertIn("Static export", detail.evidence[0].source_label)

    def test_synthetic_fixture_is_visibly_synthetic(self):
        result = self.adapter.map_export(
            self.form_raw,
            N8nExportContext("n8n", "synthetic-instance", "fixture:synthetic.json", CAPTURED_AT),
        )
        detail = self.service((result,)).get_workflow(result.workflow.ref)
        self.assertTrue(detail.summary.evidence_synthetic)
        self.assertTrue(detail.evidence[0].synthetic)
        self.assertEqual("synthetic_fixture", detail.evidence[0].source_type)

    def test_source_locator_is_not_exposed(self):
        result = self.map_data(self.cases["inactive_error"], locator="safe:logical-locator")
        detail = self.service((result,)).get_workflow(result.workflow.ref)
        serialized = serialize_viewmodel(detail)
        self.assertNotIn("source_locator", serialized)
        self.assertNotIn("safe:logical-locator", serialized)

    def test_provider_metadata_remains_bounded_and_shallow(self):
        result = self.map_data(self.cases["inactive_error"])
        detail = self.service((result,)).get_workflow(result.workflow.ref)
        self.assertLessEqual(len(detail.provider_metadata), 16)
        self.assertTrue(all(isinstance(item.key, str) and isinstance(item.value, str) for item in detail.provider_metadata))

    def test_serialized_viewmodel_contains_no_credentials(self):
        result = self.map_data(self.cases["sensitive_raw"])
        detail = self.service((result,)).get_workflow(result.workflow.ref)
        serialized = serialize_viewmodel(detail).lower()
        self.assertNotIn("credential", serialized)
        self.assertNotIn("fake_test_token", serialized)

    def test_viewmodel_contains_no_node_parameters_or_raw_export(self):
        result = self.map_data(self.cases["sensitive_raw"])
        serialized = serialize_viewmodel(self.service((result,)).get_workflow(result.workflow.ref)).lower()
        self.assertNotIn("parameters", serialized)
        self.assertNotIn("nodes", serialized)
        self.assertNotIn("raw", serialized)

    def test_last_run_is_none_without_run_data(self):
        service = self.service()
        self.assertTrue(all(item.last_run is None for item in service.list_workflows()))
        result = self.mapped_set()[0]
        self.assertIsNone(service.get_workflow(result.workflow.ref).last_run)

    def test_overview_totals_and_provider_count(self):
        overview = self.service().get_overview()
        self.assertEqual(3, overview.total_workflows)
        self.assertEqual(2, overview.provider_count)
        self.assertEqual(1, overview.definition_active_count)
        self.assertEqual(1, overview.definition_inactive_count)
        self.assertEqual(1, overview.definition_unknown_count)

    def test_runtime_observation_can_be_added_without_changing_definition(self):
        result = self.map_data(self.cases["inactive_error"])
        runtime_evidence = AutomationEvidence(
            evidence_id="runtime-observation-001",
            kind=EvidenceKind.RUNTIME_API,
            authority=EvidenceAuthority.RUNTIME,
            source_locator="runtime:observation-001",
            captured_at=CAPTURED_AT,
            sanitized=True,
            synthetic=False,
            source=result.workflow.provider,
            content_hash="1" * 64,
        )
        runtime_provenance = Provenance(runtime_evidence.ref, EvidenceAuthority.RUNTIME, CAPTURED_AT)
        runtime_status = AutomationStatus(StatusScope.RUNTIME, StatusValue.UNKNOWN, runtime_provenance)
        workflow = replace(
            result.workflow,
            runtime_status=runtime_status,
            evidence_refs=result.workflow.evidence_refs + (runtime_evidence.ref,),
        )
        provider = AutomationProvider(
            ref=workflow.provider,
            capabilities=frozenset({ProviderCapability.DEFINITION_READ}),
            provenance=workflow.provenance,
        )
        service = StaticWorkflowQueryService((workflow,), (provider,), (result.evidence, runtime_evidence))
        item = service.list_workflows()[0]
        self.assertTrue(item.runtime_observed)
        self.assertEqual("unknown", item.runtime_status)
        self.assertEqual("inactive", item.definition_status)

    def test_evidence_authority_mismatch_fails_projection(self):
        result = self.map_data(self.cases["inactive_error"])
        mismatched = replace(result.evidence, authority=EvidenceAuthority.MANUAL, kind=EvidenceKind.MANUAL_IMPORT, source=None)
        provider = AutomationProvider(
            ref=result.workflow.provider,
            capabilities=frozenset({ProviderCapability.DEFINITION_READ}),
            provenance=result.workflow.provenance,
        )
        with self.assertRaises(ApplicationProjectionError):
            StaticWorkflowQueryService((result.workflow,), (provider,), (mismatched,))

    def test_application_layer_has_no_network_runtime_or_execution_dependencies(self):
        imported_roots = set()
        for path in (QUERIES_PATH, VIEWMODELS_PATH):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported_roots.update(alias.name.split(".")[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imported_roots.add(node.module.split(".")[0])
        self.assertLessEqual(
            imported_roots,
            {"__future__", "automation_center", "collections", "dataclasses", "json", "typing", "viewmodels"},
        )
        for command in ("execute", "activate", "invoke", "schedule", "webhook", "query_runs"):
            self.assertFalse(hasattr(StaticWorkflowQueryService, command))


if __name__ == "__main__":
    unittest.main()
