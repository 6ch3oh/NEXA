from __future__ import annotations

import ast
from dataclasses import replace
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import socket
from unittest import TestCase, mock

from nexa_radar.audit import RecommendationAuditBuilder
from nexa_radar.audit_reader import AuditReadStatus, RecommendationAuditReader
from nexa_radar.candidate_preparation import (
    CandidatePreparationContext,
    CandidatePreparationPolicy,
    ProjectMatchingRule,
    SourceTrust,
)
from nexa_radar.domain import ContentType, RadarItem, SourceKind
from nexa_radar.legacy_adapter import (
    LEGACY_EVIDENCE_METADATA_SCHEMA,
    LEGACY_RADAR_ADAPTER_ID,
    LEGACY_RADAR_ADAPTER_VERSION,
    LEGACY_SUMMARY_MAX_LENGTH,
    LegacyAdapterIssueCode,
    LegacyAdapterStatus,
    LegacyRadarAdapter,
)
from nexa_radar.legacy_result import (
    LEGACY_RESULT_SCHEMA_VERSION,
    LegacyCollectorVersion,
    LegacyExecutionStatus,
    LegacyResultContext,
    LegacyResultValidator,
    LegacyValidationStatus,
    NormalizedAcquisitionStatus,
    RawLegacyWebpageStatus,
)
from nexa_radar.recommendation import RecommendationContext, RecommendationOrchestrator


NOW = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
FIXTURES = Path(__file__).parent / "fixtures"
MODULE = Path(__file__).parents[1] / "nexa_radar" / "legacy_adapter.py"
STATUS_FIXTURES = (
    ("legacy_v1_4_success.json", LegacyCollectorVersion.V1_4),
    ("legacy_v1_4_not_provided.json", LegacyCollectorVersion.V1_4),
    ("legacy_v1_4_1_empty.json", LegacyCollectorVersion.V1_4_1),
    ("legacy_v1_4_1_forbidden.json", LegacyCollectorVersion.V1_4_1),
    ("legacy_v1_4_1_rate_limited.json", LegacyCollectorVersion.V1_4_1),
    ("legacy_v1_4_1_failed.json", LegacyCollectorVersion.V1_4_1),
)


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def context_for(version: LegacyCollectorVersion, name: str = "sample") -> LegacyResultContext:
    return LegacyResultContext(
        collector_version=version,
        workflow_identity=f"workflow-{version.value.replace('.', '-')}",
        execution_identity=f"execution-{name}",
        engine_status=LegacyExecutionStatus.OBSERVED_SUCCESS,
    )


def validated_fixture(name: str, version: LegacyCollectorVersion):
    return LegacyResultValidator().validate(load_fixture(name), context=context_for(version, name))


def success_payload(**changes: object) -> dict[str, object]:
    text = "A deterministic body describing a useful AI tool and its supported workflow capabilities."
    payload: dict[str, object] = {
        "ai_name": "Deterministic AI Tool",
        "source_text": "User submitted source evidence.",
        "source_url": "https://example.com/tools/deterministic",
        "submittedAt": "2026-08-10T10:00:00+08:00",
        "web_text": text,
        "web_text_length": len(text),
        "webpage_read_status": "success",
        "http_status_code": 200,
        "web_checked_at": "2026-08-10T02:00:03Z",
    }
    payload.update(changes)
    return payload


def validated_success(**changes: object):
    return LegacyResultValidator().validate(
        success_payload(**changes),
        context=context_for(LegacyCollectorVersion.V1_4_1),
    )


def mapped_success(**changes: object):
    return LegacyRadarAdapter().convert(validated_success(**changes), reference_time=NOW)


def rejection_code(result: object) -> LegacyAdapterIssueCode | None:
    return result.rejection.code if result.rejection else None


class LegacyRadarAdapterContractTests(TestCase):
    def setUp(self) -> None:
        self.adapter = LegacyRadarAdapter()

    def test_01_valid_safe_envelope_maps_to_radar_item(self) -> None:
        validation = validated_success()
        result = self.adapter.convert(validation.envelope)
        self.assertTrue(result.mapped)
        self.assertIsInstance(result.item, RadarItem)

    def test_02_successful_validation_result_is_accepted(self) -> None:
        result = self.adapter.convert(validated_success())
        self.assertEqual(result.status, LegacyAdapterStatus.MAPPED)

    def test_03_invalid_validation_result_is_structurally_rejected(self) -> None:
        invalid = LegacyResultValidator().validate({"ai_name": "x"})
        result = self.adapter.convert(invalid, reference_time=NOW)
        self.assertEqual(rejection_code(result), LegacyAdapterIssueCode.INVALID_VALIDATION_RESULT)

    def test_04_raw_dict_is_never_accepted(self) -> None:
        result = self.adapter.convert(success_payload(), reference_time=NOW)
        self.assertEqual(rejection_code(result), LegacyAdapterIssueCode.INVALID_INPUT_TYPE)

    def test_05_unknown_contract_schema_is_rejected(self) -> None:
        envelope = validated_success().envelope
        altered = replace(envelope, identity=replace(envelope.identity, schema_version="radar-legacy-result-v0.2"))
        result = self.adapter.convert(altered)
        self.assertEqual(rejection_code(result), LegacyAdapterIssueCode.UNSUPPORTED_CONTRACT_VERSION)

    def test_06_source_kind_is_n8n(self) -> None:
        self.assertEqual(mapped_success().item.source.kind, SourceKind.N8N)

    def test_07_source_identity_is_deterministic(self) -> None:
        first = mapped_success().item.source.instance_id
        second = mapped_success().item.source.instance_id
        self.assertEqual(first, second)

    def test_08_workflow_identity_partitions_source_identity(self) -> None:
        first = validated_success()
        second_context = replace(context_for(LegacyCollectorVersion.V1_4_1), workflow_identity="workflow-other")
        second = LegacyResultValidator().validate(success_payload(), context=second_context)
        self.assertNotEqual(
            self.adapter.convert(first).item.source.instance_id,
            self.adapter.convert(second).item.source.instance_id,
        )

    def test_09_absent_workflow_uses_stable_collector_level_identity(self) -> None:
        context = LegacyResultContext(collector_version=LegacyCollectorVersion.V1_4_1)
        validation = LegacyResultValidator().validate(success_payload(), context=context)
        first = self.adapter.convert(validation).item.source.instance_id
        second = self.adapter.convert(validation).item.source.instance_id
        self.assertEqual(first, second)

    def test_10_ai_name_maps_to_title(self) -> None:
        self.assertEqual(mapped_success(ai_name="  Mapped AI  ").item.title, "Mapped AI")

    def test_11_collector_family_maps_to_ai_tool_content_type(self) -> None:
        self.assertEqual(mapped_success().item.content_type, ContentType.AI_TOOL)

    def test_12_safe_source_url_maps_to_target_reference(self) -> None:
        self.assertEqual(mapped_success().item.target_ref, "https://example.com/tools/deterministic")

    def test_13_removed_url_query_is_not_recovered(self) -> None:
        result = mapped_success(source_url="https://example.com/tool?token=removed#fragment")
        self.assertEqual(result.item.target_ref, "https://example.com/tool")
        self.assertNotIn("token", result.item.target_ref)

    def test_14_absent_url_uses_namespaced_internal_reference(self) -> None:
        validation = validated_fixture("legacy_v1_4_not_provided.json", LegacyCollectorVersion.V1_4)
        result = self.adapter.convert(validation, reference_time=NOW)
        self.assertTrue(result.item.target_ref.startswith("nexa-legacy:"))

    def test_15_internal_reference_is_deterministic(self) -> None:
        validation = validated_fixture("legacy_v1_4_not_provided.json", LegacyCollectorVersion.V1_4)
        self.assertEqual(
            self.adapter.convert(validation, reference_time=NOW).item.target_ref,
            self.adapter.convert(validation, reference_time=NOW).item.target_ref,
        )

    def test_16_item_identity_is_deterministic(self) -> None:
        self.assertEqual(mapped_success().item.item_id, mapped_success().item.item_id)

    def test_17_execution_identity_partitions_item_but_not_source(self) -> None:
        first_context = context_for(LegacyCollectorVersion.V1_4_1, "one")
        second_context = context_for(LegacyCollectorVersion.V1_4_1, "two")
        first = self.adapter.convert(LegacyResultValidator().validate(success_payload(), context=first_context)).item
        second = self.adapter.convert(LegacyResultValidator().validate(success_payload(), context=second_context)).item
        self.assertEqual(first.source.instance_id, second.source.instance_id)
        self.assertNotEqual(first.item_id, second.item_id)

    def test_18_success_summary_comes_from_web_text(self) -> None:
        result = mapped_success(source_text="submitted fallback", web_text="web evidence", web_text_length=12)
        self.assertEqual(result.item.summary, "web evidence")

    def test_19_non_success_summary_falls_back_to_source_text(self) -> None:
        validation = validated_fixture("legacy_v1_4_1_forbidden.json", LegacyCollectorVersion.V1_4_1)
        envelope = validation.envelope
        envelope = replace(envelope, submitted=replace(envelope.submitted, source_text="submitted fallback evidence"))
        result = self.adapter.convert(envelope, reference_time=NOW)
        self.assertEqual(result.item.summary, "submitted fallback evidence")

    def test_20_missing_texts_receive_safe_minimum_summary(self) -> None:
        validation = validated_fixture("legacy_v1_4_1_empty.json", LegacyCollectorVersion.V1_4_1)
        result = self.adapter.convert(validation, reference_time=NOW)
        self.assertIn("EMPTY_CONTENT", result.item.summary)

    def test_21_summary_is_bounded_without_copying_full_body(self) -> None:
        body = "a" * 30_000
        result = mapped_success(web_text=body, web_text_length=len(body))
        self.assertEqual(len(result.item.summary), LEGACY_SUMMARY_MAX_LENGTH)
        self.assertNotEqual(result.item.summary, body)

    def test_22_raw_status_is_preserved(self) -> None:
        result = mapped_success()
        self.assertEqual(result.normalized_source_evidence.raw_acquisition_status, RawLegacyWebpageStatus.SUCCESS)
        self.assertEqual(result.item.metadata.values["raw_acquisition_status"], "success")

    def test_23_normalized_status_is_preserved(self) -> None:
        result = mapped_success()
        self.assertEqual(result.normalized_source_evidence.normalized_acquisition_status, NormalizedAcquisitionStatus.SUCCESS)
        self.assertEqual(result.item.metadata.values["normalized_acquisition_status"], "SUCCESS")

    def test_24_adapter_uses_contract_mapping_without_a_duplicate_table(self) -> None:
        source = MODULE.read_text(encoding="utf-8")
        tree = ast.parse(source)
        self.assertIn("RAW_TO_NORMALIZED_ACQUISITION_STATUS", source)
        status_key_dicts = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Dict)
            and any(isinstance(key, ast.Constant) and key.value in {"success", "failed"} for key in node.keys)
        ]
        self.assertEqual(status_key_dicts, [])

    def test_25_engine_and_acquisition_status_remain_independent(self) -> None:
        validation = validated_fixture("legacy_v1_4_1_failed.json", LegacyCollectorVersion.V1_4_1)
        result = self.adapter.convert(validation, reference_time=NOW)
        self.assertEqual(result.normalized_source_evidence.engine_status, LegacyExecutionStatus.OBSERVED_SUCCESS)
        self.assertEqual(result.normalized_source_evidence.normalized_acquisition_status, NormalizedAcquisitionStatus.FETCH_FAILURE)

    def test_26_submitted_at_never_becomes_published_at(self) -> None:
        self.assertIsNone(mapped_success().item.published_at)

    def test_27_parsed_submitted_at_has_discovery_priority(self) -> None:
        injected = NOW + timedelta(days=10)
        result = self.adapter.convert(validated_success(), reference_time=injected)
        self.assertEqual(result.item.discovered_at, datetime(2026, 8, 10, 2, 0, tzinfo=UTC))

    def test_28_unparsed_submitted_at_uses_injected_time(self) -> None:
        validation = validated_success(submittedAt="legacy-time-without-zone")
        result = self.adapter.convert(validation, reference_time=NOW)
        self.assertEqual(result.item.discovered_at, NOW)

    def test_29_missing_discovery_evidence_is_rejected(self) -> None:
        validation = validated_fixture("legacy_v1_4_1_failed.json", LegacyCollectorVersion.V1_4_1)
        result = self.adapter.convert(validation)
        self.assertEqual(rejection_code(result), LegacyAdapterIssueCode.MISSING_DISCOVERED_AT)

    def test_30_naive_injected_time_is_rejected(self) -> None:
        validation = validated_fixture("legacy_v1_4_1_failed.json", LegacyCollectorVersion.V1_4_1)
        result = self.adapter.convert(validation, reference_time=datetime(2026, 8, 10, 12, 0))
        self.assertEqual(rejection_code(result), LegacyAdapterIssueCode.INVALID_REFERENCE_TIME)

    def test_31_checked_at_is_separate_evidence(self) -> None:
        result = mapped_success()
        self.assertNotEqual(
            result.normalized_source_evidence.submitted_at.parsed,
            result.normalized_source_evidence.checked_at.parsed,
        )

    def test_32_provenance_uses_stable_adapter_identity(self) -> None:
        result = mapped_success()
        self.assertEqual(result.item.provenance.adapter_id, LEGACY_RADAR_ADAPTER_ID)
        self.assertEqual(self.adapter.adapter_version, LEGACY_RADAR_ADAPTER_VERSION)

    def test_33_provenance_is_marked_normalized(self) -> None:
        self.assertTrue(mapped_success().item.provenance.normalized)

    def test_34_provenance_uses_logical_safe_references(self) -> None:
        provenance = mapped_success().item.provenance
        self.assertTrue(provenance.provider_item_id.startswith("legacy-record:"))
        self.assertTrue(provenance.evidence_ref.startswith("legacy-evidence:"))
        self.assertNotIn("\\", provenance.evidence_ref)

    def test_35_workflow_identity_is_preserved_as_bounded_evidence(self) -> None:
        result = mapped_success()
        self.assertEqual(result.item.metadata.values["workflow_identity"], "workflow-V1-4-1")

    def test_36_execution_identity_is_preserved_as_bounded_evidence(self) -> None:
        result = mapped_success()
        self.assertEqual(result.item.metadata.values["execution_identity"], "execution-sample")

    def test_37_http_status_is_safe_evidence(self) -> None:
        result = mapped_success()
        self.assertEqual(result.item.metadata.values["http_status_code"], 200)

    def test_38_safe_error_evidence_is_preserved(self) -> None:
        validation = validated_fixture("legacy_v1_4_1_forbidden.json", LegacyCollectorVersion.V1_4_1)
        result = self.adapter.convert(validation, reference_time=NOW)
        self.assertEqual(result.item.metadata.values["error_code"], "HTTP_403")
        self.assertEqual(result.item.metadata.values["error_summary"], "Remote server denied access.")

    def test_39_full_web_text_is_not_metadata(self) -> None:
        body = "unique-web-body-" * 100
        result = mapped_success(web_text=body, web_text_length=len(body))
        self.assertNotIn(body, tuple(result.item.metadata.values.values()))

    def test_40_full_source_text_is_not_metadata(self) -> None:
        source_text = "unique-source-body-" * 100
        result = mapped_success(source_text=source_text)
        self.assertNotIn(source_text, tuple(result.item.metadata.values.values()))

    def test_41_envelope_is_not_dumped_into_metadata(self) -> None:
        result = mapped_success()
        self.assertEqual(result.item.metadata.schema, LEGACY_EVIDENCE_METADATA_SCHEMA)
        self.assertNotIn("envelope", result.item.metadata.values)
        self.assertNotIn("web_text", result.item.metadata.values)
        self.assertNotIn("source_text", result.item.metadata.values)

    def test_42_v14_string_zero_is_normalized_before_adapter(self) -> None:
        validation = validated_fixture("legacy_v1_4_not_provided.json", LegacyCollectorVersion.V1_4)
        self.assertEqual(validation.envelope.acquisition.web_text_length, 0)
        result = self.adapter.convert(validation, reference_time=NOW)
        self.assertEqual(result.item.metadata.values["web_text_length"], 0)

    def test_43_adapter_does_not_accept_raw_string_zero_payload(self) -> None:
        payload = load_fixture("legacy_v1_4_not_provided.json")
        self.assertEqual(payload["web_text_length"], "0")
        result = self.adapter.convert(payload, reference_time=NOW)
        self.assertEqual(rejection_code(result), LegacyAdapterIssueCode.INVALID_INPUT_TYPE)

    def test_44_success_fixture_maps(self) -> None:
        result = self.adapter.convert(validated_fixture(*STATUS_FIXTURES[0]), reference_time=NOW)
        self.assertTrue(result.mapped)

    def test_45_not_provided_fixture_maps(self) -> None:
        result = self.adapter.convert(validated_fixture(*STATUS_FIXTURES[1]), reference_time=NOW)
        self.assertTrue(result.mapped)

    def test_46_empty_fixture_maps(self) -> None:
        result = self.adapter.convert(validated_fixture(*STATUS_FIXTURES[2]), reference_time=NOW)
        self.assertTrue(result.mapped)

    def test_47_forbidden_fixture_maps(self) -> None:
        result = self.adapter.convert(validated_fixture(*STATUS_FIXTURES[3]), reference_time=NOW)
        self.assertTrue(result.mapped)

    def test_48_rate_limited_fixture_maps(self) -> None:
        result = self.adapter.convert(validated_fixture(*STATUS_FIXTURES[4]), reference_time=NOW)
        self.assertTrue(result.mapped)

    def test_49_failed_fixture_maps(self) -> None:
        result = self.adapter.convert(validated_fixture(*STATUS_FIXTURES[5]), reference_time=NOW)
        self.assertTrue(result.mapped)

    def test_50_all_six_statuses_retain_authoritative_semantics(self) -> None:
        results = [
            self.adapter.convert(validated_fixture(name, version), reference_time=NOW)
            for name, version in STATUS_FIXTURES
        ]
        self.assertEqual(
            {result.normalized_source_evidence.raw_acquisition_status for result in results},
            set(RawLegacyWebpageStatus),
        )
        self.assertEqual(
            {result.normalized_source_evidence.normalized_acquisition_status for result in results},
            set(NormalizedAcquisitionStatus),
        )

    def test_51_inconsistent_manual_normalized_status_is_rejected(self) -> None:
        envelope = validated_success().envelope
        altered = replace(
            envelope,
            acquisition=replace(envelope.acquisition, normalized_status=NormalizedAcquisitionStatus.FETCH_FAILURE),
        )
        result = self.adapter.convert(altered)
        self.assertEqual(rejection_code(result), LegacyAdapterIssueCode.INCONSISTENT_NORMALIZED_STATUS)

    def test_52_validation_warnings_are_propagated(self) -> None:
        validation = validated_fixture("legacy_v1_4_not_provided.json", LegacyCollectorVersion.V1_4)
        result = self.adapter.convert(validation, reference_time=NOW)
        self.assertEqual(result.warnings, validation.warnings)

    def test_53_unknown_collector_version_remains_explicit(self) -> None:
        context = LegacyResultContext()
        validation = LegacyResultValidator().validate(success_payload(), context=context)
        result = self.adapter.convert(validation)
        self.assertEqual(result.normalized_source_evidence.collector_version, LegacyCollectorVersion.UNSPECIFIED)

    def test_54_metadata_is_bounded_and_scalar_only(self) -> None:
        values = mapped_success().item.metadata.values
        self.assertLessEqual(len(values), 24)
        self.assertTrue(all(isinstance(value, (str, int, float, bool, tuple)) for value in values.values()))

    def test_55_contract_version_is_the_only_supported_version(self) -> None:
        self.assertEqual(validated_success().envelope.schema_version, LEGACY_RESULT_SCHEMA_VERSION)

    def test_56_source_identity_contains_no_local_path(self) -> None:
        source = mapped_success().item.source
        self.assertNotIn("\\", source.instance_id)
        self.assertNotIn("E:", source.instance_id)

    def test_57_internal_target_does_not_fabricate_https(self) -> None:
        validation = validated_fixture("legacy_v1_4_not_provided.json", LegacyCollectorVersion.V1_4)
        target = self.adapter.convert(validation, reference_time=NOW).item.target_ref
        self.assertFalse(target.startswith("http"))
        self.assertTrue(target.startswith("nexa-legacy:"))


class LegacyAdapterIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.adapter = LegacyRadarAdapter()
        cls.validations = tuple(validated_fixture(name, version) for name, version in STATUS_FIXTURES)
        cls.adapter_results = tuple(cls.adapter.convert(value, reference_time=NOW) for value in cls.validations)
        cls.items = tuple(result.item for result in cls.adapter_results)
        source_ids = {item.source.instance_id for item in cls.items}
        cls.preparation_context = CandidatePreparationContext(
            active_project_ids=frozenset({"legacy-project"}),
            current_interests=(),
            project_matching_rules={
                "legacy-project": ProjectMatchingRule(source_kinds=frozenset({SourceKind.N8N}))
            },
            adjacent_topic_rules={},
            source_trust={source_id: SourceTrust.VERIFIED for source_id in source_ids},
            reference_time=NOW,
        )
        cls.preparation = CandidatePreparationPolicy().prepare_many(cls.items, cls.preparation_context)
        cls.recommendation = RecommendationOrchestrator().recommend(
            cls.preparation.prepared_candidates,
            RecommendationContext(target_count=3, active_project_ids=frozenset({"legacy-project"})),
        )
        cls.snapshot = RecommendationAuditBuilder().build(
            cls.recommendation,
            snapshot_id="legacy-adapter-003-smoke",
            created_at=NOW,
        )
        cls.audit_json = cls.snapshot.to_json()
        cls.read_result = RecommendationAuditReader().read_json(cls.audit_json)

    def test_58_candidate_preparation_consumes_all_adapter_items(self) -> None:
        self.assertEqual(self.preparation.prepared_count, 6)
        self.assertTrue(all(entry.item.source.kind is SourceKind.N8N for entry in self.preparation.prepared_candidates))

    def test_59_adapter_does_not_construct_quality_score(self) -> None:
        names = {node.id for node in ast.walk(ast.parse(MODULE.read_text(encoding="utf-8"))) if isinstance(node, ast.Name)}
        self.assertNotIn("QualityScore", names)

    def test_60_adapter_does_not_construct_recommendation_reason(self) -> None:
        names = {node.id for node in ast.walk(ast.parse(MODULE.read_text(encoding="utf-8"))) if isinstance(node, ast.Name)}
        self.assertNotIn("RecommendationReason", names)

    def test_61_adapter_does_not_construct_project_relation(self) -> None:
        names = {node.id for node in ast.walk(ast.parse(MODULE.read_text(encoding="utf-8"))) if isinstance(node, ast.Name)}
        self.assertNotIn("ProjectRelation", names)

    def test_62_recommendation_smoke_selects_requested_count(self) -> None:
        self.assertEqual(len(self.recommendation.selections), 3)

    def test_63_audit_smoke_contains_legacy_derived_selection(self) -> None:
        self.assertEqual(len(self.snapshot.final_selections), 3)
        self.assertTrue(all(value.item_id.startswith("legacy:") for value in self.snapshot.final_selections))

    def test_64_audit_reader_accepts_snapshot(self) -> None:
        self.assertEqual(self.read_result.status, AuditReadStatus.VALID)

    def test_65_raw_legacy_json_does_not_leak_to_audit(self) -> None:
        lowered = self.audit_json.casefold()
        self.assertNotIn("webpage_read_status", lowered)
        self.assertNotIn("web_text", lowered)
        self.assertNotIn("source_text", lowered)

    def test_66_raw_html_cannot_cross_validation_boundary(self) -> None:
        payload = success_payload(web_text="<html><body>unsafe</body></html>", web_text_length=32)
        validation = LegacyResultValidator().validate(payload, context=context_for(LegacyCollectorVersion.V1_4_1))
        self.assertEqual(validation.status, LegacyValidationStatus.INVALID)
        self.assertFalse(self.adapter.convert(validation, reference_time=NOW).mapped)

    def test_67_secret_like_payload_cannot_cross_validation_boundary(self) -> None:
        payload = success_payload() | {"authorization": "Bearer redacted"}
        validation = LegacyResultValidator().validate(payload, context=context_for(LegacyCollectorVersion.V1_4_1))
        result = self.adapter.convert(validation, reference_time=NOW)
        self.assertFalse(result.mapped)
        self.assertNotIn("redacted", repr(result))

    def test_68_repeated_full_chain_is_deterministic(self) -> None:
        second_results = tuple(self.adapter.convert(value, reference_time=NOW) for value in self.validations)
        second_preparation = CandidatePreparationPolicy().prepare_many(
            tuple(result.item for result in second_results),
            self.preparation_context,
        )
        second_recommendation = RecommendationOrchestrator().recommend(
            second_preparation.prepared_candidates,
            RecommendationContext(target_count=3, active_project_ids=frozenset({"legacy-project"})),
        )
        second_snapshot = RecommendationAuditBuilder().build(
            second_recommendation,
            snapshot_id="legacy-adapter-003-smoke",
            created_at=NOW,
        )
        self.assertEqual(second_snapshot.to_json(), self.audit_json)

    def test_69_adapter_has_no_legacy_runtime_import(self) -> None:
        tree = ast.parse(MODULE.read_text(encoding="utf-8"))
        roots = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        self.assertTrue({"subprocess", "requests", "httpx", "n8n"}.isdisjoint(roots))

    def test_70_adapter_conversion_opens_no_network(self) -> None:
        with mock.patch.object(socket, "create_connection", side_effect=AssertionError("network forbidden")), mock.patch.object(
            socket, "socket", side_effect=AssertionError("network forbidden")
        ):
            result = self.adapter.convert(self.validations[0], reference_time=NOW)
        self.assertTrue(result.mapped)

    def test_71_adapter_adds_no_external_dependency(self) -> None:
        tree = ast.parse(MODULE.read_text(encoding="utf-8"))
        allowed = {
            "__future__",
            "dataclasses",
            "datetime",
            "enum",
            "hashlib",
            "json",
            "domain",
            "legacy_result",
        }
        imported = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imported |= {
            node.module.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        }
        self.assertEqual(imported - allowed, set())
