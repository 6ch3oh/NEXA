import ast
import json
import sys
import unittest
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
FIXTURE_PATH = MODULE_ROOT / "fixtures" / "result_intake" / "result.synthetic.json"
ADAPTER_PATH = SRC_ROOT / "automation_center" / "adapters" / "result_intake.py"
RESULTS_PATH = SRC_ROOT / "automation_center" / "application" / "results.py"
sys.path.insert(0, str(SRC_ROOT))

from automation_center.adapters import (  # noqa: E402
    LegacyExecutionResultAdapter,
    ResultIntakeContext,
    ResultIntakeError,
)
from automation_center.application import (  # noqa: E402
    BusinessResultStatus,
    HistoricalResultQueryService,
    ProviderInstanceContextSource,
    ResultDiagnosticCode,
    ResultExecutionIdentity,
    ResultExecutionStatus,
    ResultNotFoundError,
    ResultSourceClassification,
    serialize_result_record,
)


class ResultIntakeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = LegacyExecutionResultAdapter()
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def artifacts(self, data=None):
        data = data or self.fixture
        return (
            json.dumps(
                data["result_artifact"],
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
            json.dumps(
                data["run_summary_artifact"],
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
        )

    @staticmethod
    def context(instance="legacy-sandbox-instance-001"):
        return ResultIntakeContext(
            provider_kind="n8n",
            provider_instance_context=instance,
            result_artifact_ref="fixture:result.json",
            run_summary_artifact_ref="fixture:summary.json",
            report_ref="fixture:result-report",
        )

    def records(self, *, instance="legacy-sandbox-instance-001", data=None):
        result, summary = self.artifacts(data)
        return self.adapter.read_artifacts(result, summary, self.context(instance))

    def record(self, execution_id, *, instance="legacy-sandbox-instance-001", data=None):
        return next(
            item
            for item in self.records(instance=instance, data=data)
            if item.execution_external_id == execution_id
        )

    def test_existing_machine_result_maps_to_four_records(self):
        self.assertEqual(4, len(self.records()))

    def test_execution_success_maps_from_zero_exit(self):
        item = self.record("synthetic-execution-001")
        self.assertIs(item.execution_status, ResultExecutionStatus.SUCCESS)
        self.assertEqual("cli_exit_0", item.source_execution_status)

    def test_execution_failure_maps_from_nonzero_exit(self):
        item = self.record("synthetic-execution-003")
        self.assertIs(item.execution_status, ResultExecutionStatus.FAILED)
        self.assertEqual("cli_exit_nonzero", item.source_execution_status)

    def test_business_success_is_preserved(self):
        self.assertIs(
            self.record("synthetic-execution-001").business_status,
            BusinessResultStatus.SUCCESS,
        )

    def test_business_partial_normalizes_empty(self):
        item = self.record("synthetic-execution-002")
        self.assertIs(item.business_status, BusinessResultStatus.PARTIAL)
        self.assertEqual("empty", item.source_business_status)

    def test_business_failure_is_preserved(self):
        self.assertIs(
            self.record("synthetic-execution-003").business_status,
            BusinessResultStatus.FAILED,
        )

    def test_execution_and_business_status_are_independent(self):
        item = self.record("synthetic-execution-002")
        self.assertIs(item.execution_status, ResultExecutionStatus.SUCCESS)
        self.assertIs(item.business_status, BusinessResultStatus.PARTIAL)

    def test_missing_workflow_identity_fails_closed(self):
        data = json.loads(json.dumps(self.fixture))
        del data["result_artifact"]["workflow_id"]
        with self.assertRaises(ResultIntakeError) as caught:
            self.records(data=data)
        self.assertIs(caught.exception.code, ResultDiagnosticCode.MISSING_WORKFLOW_ID)

    def test_missing_execution_identity_fails_closed(self):
        data = json.loads(json.dumps(self.fixture))
        del data["result_artifact"]["cases"]["success"]["execution_id"]
        with self.assertRaises(ResultIntakeError) as caught:
            self.records(data=data)
        self.assertIs(caught.exception.code, ResultDiagnosticCode.MISSING_EXECUTION_ID)

    def test_unresolved_provider_instance_remains_explicit(self):
        item = self.record("synthetic-execution-001", instance=None)
        self.assertIsNone(item.provider_instance_id)
        self.assertIs(
            item.provider_instance_context_source,
            ProviderInstanceContextSource.UNRESOLVED,
        )
        self.assertIsNone(item.execution_identity)
        self.assertIn(
            ResultDiagnosticCode.PROVIDER_INSTANCE_UNRESOLVED,
            {diagnostic.code for diagnostic in item.diagnostics},
        )

    def test_caller_declared_instance_builds_scoped_identity(self):
        item = self.record("synthetic-execution-001")
        self.assertIs(
            item.provider_instance_context_source,
            ProviderInstanceContextSource.CALLER_DECLARED,
        )
        self.assertEqual(
            ResultExecutionIdentity("n8n", "legacy-sandbox-instance-001", "synthetic-execution-001"),
            item.execution_identity,
        )

    def test_sandbox_source_classification_is_explicit(self):
        item = self.record("synthetic-execution-001")
        self.assertIs(
            item.source_evidence.source_classification,
            ResultSourceClassification.SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES,
        )
        self.assertEqual("real_n8n_engine", item.source_evidence.execution_engine_reality.value)
        self.assertEqual("sandbox_isolated", item.source_evidence.environment_class.value)
        self.assertEqual("synthetic_or_stubbed", item.source_evidence.dependency_class.value)

    def test_sandbox_result_never_claims_production_execution(self):
        serialized = serialize_result_record(self.records())
        self.assertNotIn("production_execution", serialized)
        self.assertNotIn('"production"', serialized)

    def test_record_is_historical_result_only(self):
        self.assertTrue(self.record("synthetic-execution-001").historical_result_only)

    def test_safe_summary_contains_only_normalized_facts(self):
        summary = self.record("synthetic-execution-001").safe_result_summary
        self.assertIn("execution=success", summary)
        self.assertIn("business=success", summary)
        self.assertNotIn("invalid.example", summary)
        self.assertNotIn("SYNTHETIC_CONTENT", summary)

    def test_secret_sentinel_is_removed_from_every_projection(self):
        records = self.records()
        service = HistoricalResultQueryService(records)
        outputs = (
            serialize_result_record(records),
            repr(records),
            serialize_result_record(service.list_results()),
            serialize_result_record(service.summarize_results()),
        )
        for output in outputs:
            self.assertNotIn("FAKE_SECRET_VALUE", output)

    def test_raw_fields_are_not_serialized(self):
        serialized = serialize_result_record(self.records()).lower()
        for forbidden in (
            "source_url",
            "web_text",
            "raw_payload",
            "credential",
            "authorization",
            "prompt_raw",
            "full_content",
            "binary",
            "execute_log",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_sanitization_is_recorded_as_a_diagnostic(self):
        item = self.record("synthetic-execution-004")
        self.assertIn(
            ResultDiagnosticCode.SANITIZED_FIELD_REMOVED,
            {diagnostic.code for diagnostic in item.diagnostics},
        )

    def test_source_artifact_hash_is_deterministic(self):
        first = self.records()[0].source_evidence
        second = self.records()[0].source_evidence
        self.assertEqual(first.source_artifacts, second.source_artifacts)
        self.assertEqual(first.source_integrity_sha256, second.source_integrity_sha256)

    def test_sanitized_result_hash_is_deterministic(self):
        first = self.record("synthetic-execution-001")
        second = self.record("synthetic-execution-001")
        self.assertEqual(first.sanitized_result_sha256, second.sanitized_result_sha256)

    def test_record_identity_is_deterministic(self):
        first = self.record("synthetic-execution-001")
        second = self.record("synthetic-execution-001")
        self.assertEqual(first.record_id, second.record_id)

    def test_case_input_order_does_not_change_record_order(self):
        data = json.loads(json.dumps(self.fixture))
        data["result_artifact"]["cases"] = dict(
            reversed(list(data["result_artifact"]["cases"].items()))
        )
        data["run_summary_artifact"].reverse()
        self.assertEqual(
            [item.record_id for item in self.records()],
            [item.record_id for item in self.records(data=data)],
        )

    def test_malformed_json_fails_closed(self):
        _, summary = self.artifacts()
        with self.assertRaises(ResultIntakeError) as caught:
            self.adapter.read_artifacts("{", summary, self.context())
        self.assertIs(caught.exception.code, ResultDiagnosticCode.MALFORMED_RESULT)

    def test_unknown_execution_status_has_diagnostic(self):
        data = json.loads(json.dumps(self.fixture))
        data["run_summary_artifact"][0]["execute_exit_code"] = "unexpected"
        item = self.record("synthetic-execution-001", data=data)
        self.assertIs(item.execution_status, ResultExecutionStatus.UNKNOWN)
        self.assertIn(
            ResultDiagnosticCode.EXECUTION_STATUS_UNRECOGNIZED,
            {diagnostic.code for diagnostic in item.diagnostics},
        )

    def test_unknown_business_status_has_diagnostic(self):
        data = json.loads(json.dumps(self.fixture))
        data["result_artifact"]["cases"]["success"]["fields"]["webpage_read_status"] = "novel"
        item = self.record("synthetic-execution-001", data=data)
        self.assertIs(item.business_status, BusinessResultStatus.UNKNOWN)
        self.assertIn(
            ResultDiagnosticCode.BUSINESS_STATUS_UNRECOGNIZED,
            {diagnostic.code for diagnostic in item.diagnostics},
        )

    def test_query_service_lists_and_gets_by_full_execution_identity(self):
        records = self.records()
        service = HistoricalResultQueryService(records)
        self.assertEqual(4, len(service.list_results()))
        item = service.get_result_by_execution_identity(records[0].execution_identity)
        self.assertEqual(records[0].execution_external_id, item.execution_external_id)
        self.assertTrue(item.historical_result_only)
        self.assertFalse(item.current_runtime_inference_allowed)

    def test_query_summary_counts_both_status_axes(self):
        summary = HistoricalResultQueryService(self.records()).summarize_results()
        self.assertEqual(4, summary.result_count)
        self.assertEqual(3, summary.execution_success_count)
        self.assertEqual(1, summary.execution_failure_count)
        self.assertEqual(2, summary.business_success_count)
        self.assertEqual(1, summary.business_partial_count)
        self.assertEqual(1, summary.business_failure_count)
        self.assertEqual(4, summary.sandbox_result_count)
        self.assertFalse(summary.current_runtime_inference_allowed)

    def test_full_identity_prevents_cross_instance_join(self):
        first = self.record("synthetic-execution-001", instance="instance-a")
        second = self.record("synthetic-execution-001", instance="instance-b")
        service = HistoricalResultQueryService((first, second))
        projected = service.get_result_by_execution_identity(
            ResultExecutionIdentity("n8n", "instance-b", "synthetic-execution-001")
        )
        self.assertEqual("instance-b", projected.provider_instance_id)

    def test_unresolved_instance_cannot_be_joined_by_execution_id(self):
        service = HistoricalResultQueryService(self.records(instance=None))
        with self.assertRaises(ResultNotFoundError):
            service.get_result_by_execution_identity(
                ResultExecutionIdentity("n8n", "invented-instance", "synthetic-execution-001")
            )

    def test_result_layers_have_no_network_runtime_or_execution_dependencies(self):
        imported_roots = set()
        for path in (ADAPTER_PATH, RESULTS_PATH):
            tree = ast.parse(path.read_text(encoding="utf-8"))
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
                "collections",
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
        for command in (
            "execute",
            "activate",
            "invoke",
            "schedule",
            "webhook",
            "query_runs",
            "read_runtime",
        ):
            self.assertFalse(hasattr(LegacyExecutionResultAdapter, command))
            self.assertFalse(hasattr(HistoricalResultQueryService, command))


if __name__ == "__main__":
    unittest.main()
