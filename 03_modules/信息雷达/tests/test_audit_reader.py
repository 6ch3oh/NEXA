from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from unittest import TestCase, mock

from nexa_radar.audit import AUDIT_SCHEMA_VERSION, RecommendationAuditSnapshot, compare_audit_snapshots
from nexa_radar.audit_fixtures import build_audit_fixture_snapshots
from nexa_radar.audit_reader import (
    AuditCompatibility,
    AuditIssueCode,
    AuditReadStatus,
    RecommendationAuditReader,
    RecommendationAuditValidator,
    SnapshotMigrator,
)
from nexa_radar.audit_reader_fixtures import build_audit_reader_fixtures


GOLDEN_PATH = Path(__file__).parent / "golden" / "normal_audit_v0.1.json"


class AuditReaderContractTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reader = RecommendationAuditReader()
        cls.fixtures = build_audit_reader_fixtures()

    def test_valid_golden_json_succeeds(self) -> None:
        result = self.reader.read_file(GOLDEN_PATH)
        self.assertEqual(result.status, AuditReadStatus.VALID)
        self.assertEqual(result.compatibility, AuditCompatibility.SUPPORTED)
        self.assertIsInstance(result.snapshot, RecommendationAuditSnapshot)

    def test_read_dict(self) -> None:
        result = self.reader.read_dict(self.fixtures.valid)
        self.assertTrue(result.is_valid)
        self.assertEqual(result.source_schema_version, AUDIT_SCHEMA_VERSION)

    def test_read_json(self) -> None:
        text = build_audit_fixture_snapshots()["normal"].to_json()
        result = self.reader.read_json(text)
        self.assertTrue(result.is_valid)

    def test_malformed_json(self) -> None:
        result = self.reader.read_json(self.fixtures.malformed_json)
        self.assertEqual(result.status, AuditReadStatus.MALFORMED_JSON)
        self.assertEqual(result.issues[0].code, AuditIssueCode.MALFORMED_JSON)
        self.assertIsNone(result.snapshot)

    def test_duplicate_json_key_is_malformed(self) -> None:
        result = self.reader.read_json('{"schema_version":"radar-audit-v0.1","schema_version":"radar-audit-v0.1"}')
        self.assertEqual(result.status, AuditReadStatus.MALFORMED_JSON)
        self.assertEqual(result.issues[0].code, AuditIssueCode.DUPLICATE_KEY)

    def test_missing_schema(self) -> None:
        result = self.reader.read_dict(self.fixtures.missing_schema)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertEqual(result.compatibility, AuditCompatibility.MISSING_SCHEMA)
        self.assertEqual(result.issues[0].path, "$.schema_version")

    def test_supported_schema(self) -> None:
        result = self.reader.read_dict(self.fixtures.valid)
        self.assertEqual(result.compatibility, AuditCompatibility.SUPPORTED)
        self.assertEqual(result.source_schema_version, "radar-audit-v0.1")

    def test_unsupported_newer_schema(self) -> None:
        result = self.reader.read_dict(self.fixtures.unsupported_schema)
        self.assertEqual(result.status, AuditReadStatus.UNSUPPORTED_SCHEMA)
        self.assertEqual(result.compatibility, AuditCompatibility.UNSUPPORTED_NEWER)
        self.assertIsNone(result.snapshot)

    def test_unsupported_legacy_schema(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["schema_version"] = "radar-audit-v0.0"
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.UNSUPPORTED_SCHEMA)
        self.assertEqual(result.compatibility, AuditCompatibility.UNSUPPORTED_LEGACY)

    def test_unsupported_unknown_schema(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["schema_version"] = "custom-audit"
        result = self.reader.read_dict(payload)
        self.assertEqual(result.compatibility, AuditCompatibility.UNSUPPORTED_UNKNOWN)
        self.assertIsNone(result.snapshot)

    def test_unknown_top_level_field_is_rejected(self) -> None:
        result = self.reader.read_dict(self.fixtures.unknown_top_level)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.code is AuditIssueCode.UNKNOWN_FIELD for issue in result.issues))
        self.assertTrue(any(issue.path == "$.future_extension" for issue in result.issues))

    def test_wrong_string_type(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["snapshot_id"] = 42
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.path == "$.snapshot_id" and issue.code is AuditIssueCode.WRONG_TYPE for issue in result.issues))

    def test_wrong_integer_type_is_not_coerced(self) -> None:
        result = self.reader.read_dict(self.fixtures.wrong_rank_type)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.path.endswith(".rank") and issue.code is AuditIssueCode.WRONG_TYPE for issue in result.issues))

    def test_wrong_boolean_type_is_not_coerced(self) -> None:
        result = self.reader.read_dict(self.fixtures.wrong_boolean_type)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.path == "$.request.exploration_enabled" for issue in result.issues))

    def test_negative_candidate_count(self) -> None:
        result = self.reader.read_dict(self.fixtures.negative_count)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.code is AuditIssueCode.INVALID_RANGE for issue in result.issues))

    def test_invalid_rank(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["final_selections"][0]["rank"] = 0
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.path.endswith(".rank") for issue in result.issues))

    def test_invalid_quality(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["final_selections"][0]["quality_score"] = 101
        payload["final_selections"][0]["ranking_evidence"]["quality_score"] = 101
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.code is AuditIssueCode.INVALID_RANGE for issue in result.issues))

    def test_quality_string_is_not_coerced(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["final_selections"][0]["quality_score"] = "86"
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.path.endswith(".quality_score") and issue.code is AuditIssueCode.WRONG_TYPE for issue in result.issues))

    def test_negative_quota_is_rejected(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["quotas"][0]["requested"] = -1
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.path == "$.quotas[0].requested" and issue.code is AuditIssueCode.INVALID_RANGE for issue in result.issues))

    def test_selected_cannot_exceed_admitted(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["quotas"][0]["selected"] = payload["quotas"][0]["admitted"] + 1
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.code is AuditIssueCode.INCONSISTENT_COUNTS for issue in result.issues))

    def test_invalid_bucket_enum(self) -> None:
        result = self.reader.read_dict(self.fixtures.invalid_bucket)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.code is AuditIssueCode.INVALID_ENUM and issue.path.endswith(".bucket") for issue in result.issues))

    def test_invalid_content_type_enum(self) -> None:
        result = self.reader.read_dict(self.fixtures.invalid_content_type)
        self.assertTrue(any(issue.path.endswith(".content_type") and issue.code is AuditIssueCode.INVALID_ENUM for issue in result.issues))

    def test_invalid_source_kind_enum(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["final_selections"][0]["source"]["kind"] = "UNKNOWN_SOURCE"
        result = self.reader.read_dict(payload)
        self.assertTrue(any(issue.path.endswith(".source.kind") and issue.code is AuditIssueCode.INVALID_ENUM for issue in result.issues))

    def test_invalid_exclusion_code_enum(self) -> None:
        result = self.reader.read_dict(self.fixtures.invalid_exclusion_code)
        self.assertTrue(any(issue.path.endswith(".code") and issue.code is AuditIssueCode.INVALID_ENUM for issue in result.issues))

    def test_invalid_recommendation_reason_enum(self) -> None:
        result = self.reader.read_dict(self.fixtures.invalid_reason_code)
        self.assertTrue(any("recommendation_reasons" in issue.path and issue.code is AuditIssueCode.INVALID_ENUM for issue in result.issues))

    def test_invalid_datetime(self) -> None:
        result = self.reader.read_dict(self.fixtures.invalid_datetime)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.code is AuditIssueCode.INVALID_DATETIME for issue in result.issues))

    def test_invalid_sha256_length(self) -> None:
        result = self.reader.read_dict(self.fixtures.invalid_hash_length)
        self.assertTrue(any(issue.code is AuditIssueCode.INVALID_HASH for issue in result.issues))

    def test_invalid_sha256_hex(self) -> None:
        result = self.reader.read_dict(self.fixtures.invalid_hash_hex)
        self.assertTrue(any(issue.code is AuditIssueCode.INVALID_HASH for issue in result.issues))

    def test_valid_snapshot_reconstructs_domain_object(self) -> None:
        result = self.reader.read_dict(self.fixtures.valid)
        self.assertIsInstance(result.snapshot, RecommendationAuditSnapshot)
        self.assertEqual(result.snapshot.snapshot_id, "audit-normal-v0.1")
        self.assertEqual(result.snapshot.final_selections[0].rank, 1)

    def test_snapshot_json_reader_json_round_trip_is_exact(self) -> None:
        original = build_audit_fixture_snapshots()["normal"].to_json()
        result = self.reader.read_json(original)
        self.assertTrue(result.is_valid)
        self.assertEqual(result.snapshot.to_json(), original)

    def test_deterministic_read(self) -> None:
        first = self.reader.read_dict(self.fixtures.valid)
        second = self.reader.read_dict(self.fixtures.valid)
        self.assertEqual(first, second)
        self.assertEqual(first.snapshot.to_json(), second.snapshot.to_json())

    def test_read_file_valid_utf8(self) -> None:
        result = self.reader.read_file(GOLDEN_PATH)
        self.assertTrue(result.is_valid)
        self.assertEqual(result.snapshot.to_json(), GOLDEN_PATH.read_text(encoding="utf-8").strip())

    def test_file_missing_returns_structured_error(self) -> None:
        result = self.reader.read_file(GOLDEN_PATH.parent / "missing.json")
        self.assertEqual(result.status, AuditReadStatus.FILE_ERROR)
        self.assertEqual(result.issues[0].code, AuditIssueCode.FILE_NOT_FOUND)

    def test_directory_path_is_rejected(self) -> None:
        result = self.reader.read_file(GOLDEN_PATH.parent)
        self.assertEqual(result.status, AuditReadStatus.FILE_ERROR)
        self.assertEqual(result.issues[0].code, AuditIssueCode.NOT_A_FILE)

    def test_unsupported_schema_never_reconstructs(self) -> None:
        result = self.reader.read_dict(self.fixtures.unsupported_schema)
        self.assertIsNone(result.snapshot)
        self.assertFalse(result.is_valid)

    def test_non_string_object_key_is_reported_without_crashing(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload[7] = "invalid-key"
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.code is AuditIssueCode.WRONG_TYPE for issue in result.issues))

    def test_unhashable_wrong_item_id_type_is_reported_without_crashing(self) -> None:
        payload = deepcopy(self.fixtures.valid)
        payload["final_selections"][0]["item_id"] = {"invalid": True}
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.INVALID)
        self.assertTrue(any(issue.path.endswith(".item_id") and issue.code is AuditIssueCode.WRONG_TYPE for issue in result.issues))

    def test_warnings_are_structured_and_empty_for_v0_1(self) -> None:
        result = self.reader.read_dict(self.fixtures.valid)
        self.assertEqual(result.warnings, ())

    def test_migration_boundary_exists_without_implementation(self) -> None:
        self.assertTrue(getattr(SnapshotMigrator, "_is_protocol", False))


class AuditReaderSafetyTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reader = RecommendationAuditReader()
        cls.valid = build_audit_reader_fixtures().valid

    def _with_selection_field(self, key: str, value: object):
        payload = deepcopy(self.valid)
        payload["final_selections"][0][key] = value
        return self.reader.read_dict(payload)

    def test_raw_payload_is_safety_violation(self) -> None:
        result = self.reader.read_dict(build_audit_reader_fixtures().safety_raw_payload)
        self.assertEqual(result.status, AuditReadStatus.SAFETY_VIOLATION)
        self.assertTrue(any(issue.code is AuditIssueCode.SAFETY_FORBIDDEN_FIELD for issue in result.issues))

    def test_metadata_is_safety_violation(self) -> None:
        result = self._with_selection_field("MeTa_Data", {"safe": False})
        self.assertEqual(result.status, AuditReadStatus.SAFETY_VIOLATION)

    def test_token_field_is_safety_violation(self) -> None:
        result = self._with_selection_field("access_token", "fixture-value")
        self.assertEqual(result.status, AuditReadStatus.SAFETY_VIOLATION)

    def test_authorization_case_variant_is_safety_violation(self) -> None:
        result = self._with_selection_field("AuThOrIzAtIoN", "Bearer fixture")
        self.assertEqual(result.status, AuditReadStatus.SAFETY_VIOLATION)

    def test_cookie_field_is_safety_violation(self) -> None:
        result = self._with_selection_field("COOKIE", "session=fixture")
        self.assertEqual(result.status, AuditReadStatus.SAFETY_VIOLATION)

    def test_plaintext_url_path_or_query_is_safety_violation(self) -> None:
        payload = deepcopy(self.valid)
        payload["final_selections"][0]["selection_explanation"] = "See https://example.invalid/private?tokenless=value"
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.SAFETY_VIOLATION)

    def test_local_absolute_path_is_safety_violation(self) -> None:
        payload = deepcopy(self.valid)
        payload["final_selections"][0]["selection_explanation"] = r"Loaded from C:\private\audit.json"
        result = self.reader.read_dict(payload)
        self.assertEqual(result.status, AuditReadStatus.SAFETY_VIOLATION)


class AuditReaderComparisonBoundaryTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reader = RecommendationAuditReader()
        snapshots = build_audit_fixture_snapshots()
        cls.normal = cls.reader.read_dict(snapshots["normal"].to_dict()).snapshot
        cls.exclusions = cls.reader.read_dict(snapshots["exclusions"].to_dict()).snapshot

    def test_invalid_snapshot_cannot_enter_comparison(self) -> None:
        invalid = self.reader.read_dict(build_audit_reader_fixtures().invalid_bucket)
        self.assertIsNone(invalid.snapshot)
        with self.assertRaises(ValueError):
            compare_audit_snapshots(invalid.snapshot, self.normal)

    def test_valid_reader_snapshots_compare_normally(self) -> None:
        comparison = compare_audit_snapshots(self.normal, self.exclusions)
        self.assertTrue(comparison.added_selections or comparison.removed_selections)

    def test_policy_changed_comparison_remains_supported(self) -> None:
        changed = replace(self.normal, recommendation_policy_version="radar-recommendation-v0.2")
        self.assertTrue(compare_audit_snapshots(self.normal, changed).policy_changed)

    def test_incompatible_schema_is_rejected_by_comparison(self) -> None:
        incompatible = replace(self.normal, schema_version="radar-audit-v9.9")
        with self.assertRaises(ValueError):
            compare_audit_snapshots(self.normal, incompatible)

    def test_unvalidated_manual_snapshot_is_rejected_by_comparison(self) -> None:
        unvalidated = replace(self.normal, _validation_origin="UNVALIDATED")
        with self.assertRaises(ValueError):
            compare_audit_snapshots(self.normal, unvalidated)


class AuditReaderRegressionBoundaryTests(TestCase):
    def test_radar_003_golden_remains_byte_stable(self) -> None:
        generated = build_audit_fixture_snapshots()["normal"].to_json()
        self.assertEqual(generated, GOLDEN_PATH.read_text(encoding="utf-8").strip())

    def test_reader_and_validator_perform_no_network_calls(self) -> None:
        with mock.patch("socket.create_connection", side_effect=AssertionError("network call attempted")):
            result = RecommendationAuditReader(RecommendationAuditValidator()).read_file(GOLDEN_PATH)
        self.assertTrue(result.is_valid)


if __name__ == "__main__":
    import unittest

    unittest.main()
