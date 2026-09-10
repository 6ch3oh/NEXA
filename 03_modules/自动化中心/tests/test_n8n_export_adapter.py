import ast
import json
import sys
import unittest
from dataclasses import fields
from datetime import datetime, timezone
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
FIXTURE_PATH = MODULE_ROOT / "fixtures" / "n8n" / "workflow.synthetic.json"
CASES_PATH = MODULE_ROOT / "fixtures" / "n8n" / "workflow.mapping_cases.json"
ADAPTER_PATH = SRC_ROOT / "automation_center" / "adapters" / "n8n_export.py"
DOMAIN_PATH = SRC_ROOT / "automation_center" / "domain" / "models.py"
sys.path.insert(0, str(SRC_ROOT))

from automation_center.adapters import (  # noqa: E402
    MappingDiagnosticCode,
    N8nExportAdapter,
    N8nExportContext,
    N8nExportMappingError,
)
from automation_center.domain import (  # noqa: E402
    AutomationWorkflow,
    EvidenceAuthority,
    EvidenceKind,
    ProviderMetadata,
    StatusScope,
    StatusValue,
    TriggerType,
    serialize_contract,
)


CAPTURED_AT = datetime(2026, 8, 10, 13, 0, tzinfo=timezone.utc)


class N8nExportAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = N8nExportAdapter()
        cls.form_raw = FIXTURE_PATH.read_text(encoding="utf-8")
        cls.cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))

    def context(self, instance="synthetic-n8n-instance", locator="fixture:workflow.json", synthetic=False):
        return N8nExportContext("n8n", instance, locator, CAPTURED_AT, synthetic=synthetic)

    def raw_case(self, name):
        return json.dumps(self.cases[name], ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    def test_valid_export_maps_to_automation_workflow(self):
        result = self.adapter.map_export(self.form_raw, self.context())
        self.assertIsInstance(result.workflow, AutomationWorkflow)
        self.assertEqual("synthetic-workflow-001", result.workflow.ref.external_workflow_id)

    def test_external_id_is_provider_scoped_identity(self):
        result = self.adapter.map_export(self.form_raw, self.context(instance="n8n-a"))
        self.assertEqual("n8n", result.workflow.provider.provider_kind)
        self.assertEqual("n8n-a", result.workflow.provider.provider_instance_id)
        self.assertEqual("synthetic-workflow-001", result.workflow.ref.external_workflow_id)

    def test_duplicate_names_do_not_conflict(self):
        first = self.cases["inactive_error"] | {"id": "workflow-a"}
        second = self.cases["inactive_error"] | {"id": "workflow-b"}
        mapped_first = self.adapter.map_export(json.dumps(first), self.context()).workflow
        mapped_second = self.adapter.map_export(json.dumps(second), self.context()).workflow
        self.assertEqual(mapped_first.display_name, mapped_second.display_name)
        self.assertNotEqual(mapped_first.ref, mapped_second.ref)

    def test_same_external_id_differs_by_provider_instance(self):
        raw = self.raw_case("inactive_error")
        first = self.adapter.map_export(raw, self.context(instance="n8n-a")).workflow
        second = self.adapter.map_export(raw, self.context(instance="n8n-b")).workflow
        self.assertNotEqual(first.ref, second.ref)

    def test_active_true_maps_only_definition_active(self):
        result = self.adapter.map_export(self.raw_case("unknown_trigger"), self.context())
        self.assertEqual(StatusScope.DEFINITION, result.workflow.definition_status.scope)
        self.assertEqual(StatusValue.ACTIVE, result.workflow.definition_status.value)
        self.assertIsNone(result.workflow.runtime_status)

    def test_active_false_maps_only_definition_inactive(self):
        result = self.adapter.map_export(self.raw_case("inactive_error"), self.context())
        self.assertEqual(StatusScope.DEFINITION, result.workflow.definition_status.scope)
        self.assertEqual(StatusValue.INACTIVE, result.workflow.definition_status.value)
        self.assertIsNone(result.workflow.runtime_status)

    def test_missing_active_maps_to_definition_unknown(self):
        result = self.adapter.map_export(self.raw_case("missing_active"), self.context())
        self.assertEqual(StatusValue.UNKNOWN, result.workflow.definition_status.value)
        self.assertIsNone(result.workflow.runtime_status)

    def test_adapter_never_constructs_runtime_active(self):
        active = self.adapter.map_export(self.raw_case("unknown_trigger"), self.context()).workflow
        inactive = self.adapter.map_export(self.raw_case("inactive_error"), self.context()).workflow
        self.assertIsNone(active.runtime_status)
        self.assertIsNone(inactive.runtime_status)

    def test_form_trigger_maps_by_node_type(self):
        result = self.adapter.map_export(self.form_raw, self.context())
        self.assertEqual((TriggerType.FORM,), tuple(trigger.trigger_type for trigger in result.workflow.triggers))
        self.assertEqual("Form trigger", result.workflow.triggers[0].display_label)

    def test_error_trigger_maps_by_node_type(self):
        result = self.adapter.map_export(self.raw_case("inactive_error"), self.context())
        self.assertEqual((TriggerType.ERROR,), tuple(trigger.trigger_type for trigger in result.workflow.triggers))

    def test_unknown_trigger_degrades_to_other_with_diagnostic(self):
        result = self.adapter.map_export(self.raw_case("unknown_trigger"), self.context())
        self.assertEqual(TriggerType.OTHER, result.workflow.triggers[0].trigger_type)
        self.assertIn(MappingDiagnosticCode.UNKNOWN_TRIGGER, {item.code for item in result.diagnostics})

    def test_missing_external_id_fails_closed(self):
        with self.assertRaises(N8nExportMappingError) as raised:
            self.adapter.map_export(self.raw_case("missing_id"), self.context())
        self.assertEqual(MappingDiagnosticCode.MISSING_WORKFLOW_IDENTITY, raised.exception.code)

    def test_name_is_not_identity_fallback(self):
        with self.assertRaises(N8nExportMappingError):
            self.adapter.map_export(self.raw_case("missing_id"), self.context())

    def test_filename_or_path_is_not_identity_fallback(self):
        with self.assertRaises(N8nExportMappingError):
            self.adapter.map_export(
                self.raw_case("missing_id"),
                self.context(locator="fixture:name-must-not-be-identity.json"),
            )

    def test_static_export_creates_static_export_evidence(self):
        result = self.adapter.map_export(self.raw_case("inactive_error"), self.context())
        self.assertEqual(EvidenceKind.STATIC_EXPORT, result.evidence.kind)
        self.assertEqual(EvidenceAuthority.STATIC_EXPORT, result.evidence.authority)
        self.assertFalse(result.evidence.synthetic)
        self.assertEqual(result.workflow.provenance.evidence_ref, result.evidence.ref)

    def test_same_raw_content_has_same_integrity_hash(self):
        raw = self.raw_case("inactive_error")
        first = self.adapter.map_export(raw, self.context())
        second = self.adapter.map_export(raw, self.context())
        self.assertEqual(first.evidence.content_hash, second.evidence.content_hash)

    def test_fixed_input_and_context_map_deterministically(self):
        raw = self.raw_case("inactive_error")
        first = self.adapter.map_export(raw, self.context())
        second = self.adapter.map_export(raw, self.context())
        self.assertEqual(serialize_contract(first.workflow), serialize_contract(second.workflow))
        self.assertEqual(serialize_contract(first.evidence), serialize_contract(second.evidence))
        self.assertEqual(first.diagnostics, second.diagnostics)

    def test_synthetic_fixture_remains_synthetic_evidence(self):
        result = self.adapter.map_export(self.form_raw, self.context(synthetic=False))
        self.assertEqual(EvidenceKind.SYNTHETIC_FIXTURE, result.evidence.kind)
        self.assertEqual(EvidenceAuthority.SYNTHETIC, result.evidence.authority)
        self.assertTrue(result.evidence.synthetic)
        self.assertIsNone(result.evidence.source)

    def test_fake_credential_marker_never_enters_domain_output(self):
        raw = self.raw_case("sensitive_raw")
        result = self.adapter.map_export(raw, self.context())
        combined = " ".join(
            (
                serialize_contract(result.workflow),
                serialize_contract(result.evidence),
                repr(result.diagnostics),
            )
        )
        self.assertNotIn("FAKE_TEST_TOKEN", combined)
        self.assertNotIn("FAKE_TEST_COOKIE", combined)
        self.assertIn(MappingDiagnosticCode.SENSITIVE_FIELD_SANITIZED, {item.code for item in result.diagnostics})

    def test_node_parameters_do_not_propagate(self):
        result = self.adapter.map_export(self.raw_case("sensitive_raw"), self.context())
        serialized = serialize_contract(result.workflow).lower()
        self.assertNotIn("parameters", serialized)
        self.assertNotIn("authorization", serialized)
        self.assertNotIn("cookie", serialized)

    def test_raw_payload_is_not_stored_on_workflow_or_result(self):
        result = self.adapter.map_export(self.raw_case("sensitive_raw"), self.context())
        workflow_fields = {item.name for item in fields(result.workflow)}
        result_fields = {item.name for item in fields(result)}
        self.assertNotIn("raw", workflow_fields)
        self.assertNotIn("nodes", workflow_fields)
        self.assertNotIn("payload", workflow_fields)
        self.assertNotIn("raw", result_fields)
        self.assertNotIn("payload", result_fields)

    def test_provider_metadata_is_shallow_whitelisted_and_bounded(self):
        result = self.adapter.map_export(self.raw_case("unknown_trigger"), self.context())
        metadata = result.workflow.provider_metadata
        self.assertIsInstance(metadata, ProviderMetadata)
        self.assertLessEqual(len(metadata.entries), 16)
        self.assertEqual(
            {"export_format", "node_count", "trigger_count"},
            {key for key, _ in metadata.entries},
        )
        self.assertTrue(all(isinstance(value, str) for _, value in metadata.entries))

    def test_malformed_json_fails_with_explicit_diagnostic(self):
        with self.assertRaises(N8nExportMappingError) as raised:
            self.adapter.map_export("{not-json", self.context())
        self.assertEqual(MappingDiagnosticCode.MALFORMED_EXPORT, raised.exception.code)
        self.assertEqual(MappingDiagnosticCode.MALFORMED_EXPORT, raised.exception.diagnostics[0].code)

    def test_malformed_schema_fails_closed(self):
        with self.assertRaises(N8nExportMappingError) as raised:
            self.adapter.map_export(json.dumps({"id": "workflow-1", "nodes": {}}), self.context())
        self.assertEqual(MappingDiagnosticCode.MALFORMED_EXPORT, raised.exception.code)

    def test_mapping_success_diagnostic_is_present(self):
        result = self.adapter.map_export(self.raw_case("inactive_error"), self.context())
        self.assertEqual(MappingDiagnosticCode.MAPPING_SUCCESS, result.diagnostics[-1].code)

    def test_adapter_has_only_standard_library_and_domain_dependencies(self):
        tree = ast.parse(ADAPTER_PATH.read_text(encoding="utf-8"))
        imported_roots = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".")[0])
        self.assertLessEqual(
            imported_roots,
            {
                "__future__",
                "automation_center",
                "dataclasses",
                "datetime",
                "enum",
                "hashlib",
                "json",
                "pathlib",
                "re",
                "typing",
            },
        )
        for command in ("execute", "activate", "deactivate", "invoke", "schedule", "webhook"):
            self.assertFalse(hasattr(N8nExportAdapter, command))

    def test_domain_does_not_import_adapter(self):
        source = DOMAIN_PATH.read_text(encoding="utf-8")
        self.assertNotIn("automation_center.adapters", source)
        self.assertNotIn("n8n_export", source)


if __name__ == "__main__":
    unittest.main()
