from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from nexa_market.fixtures import SAME_SYMBOL_XNAS, US_SHARE  # noqa: E402
from nexa_market.recovery import (  # noqa: E402
    CandidateStatus,
    RecoveryDiagnosticCode,
    RecoveryEligibility,
    RecoveryError,
    RecoveryErrorCode,
    RecoveryService,
    RecoveryStoreStatus,
    ReplacementStatus,
)
from nexa_market.repositories import (  # noqa: E402
    FORMAT_VERSION,
    SCHEMA_VERSION,
    LocalObservationRepository,
    LocalPositionRepository,
    LocalStateStore,
    LocalWatchlistRepository,
    RepositoryError,
    RepositoryLoadStatus,
)
from nexa_market.repositories.serialization import (  # noqa: E402
    serialize_observation,
    serialize_position,
    serialize_watchlist,
)
from nexa_market.services.observations import ObservationService  # noqa: E402
from nexa_market.services.positions import PositionService  # noqa: E402
from nexa_market.services.watchlist import WatchlistService  # noqa: E402
from nexa_market.state_fixtures import (  # noqa: E402
    CNY_POSITION,
    KNOWN_INSTRUMENTS,
    OBSERVATION_HISTORY,
    PROFIT_POSITION,
    WATCHLIST_NORMAL,
)


FIXED_NOW = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)


def empty_payload() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "format_version": FORMAT_VERSION,
        "watchlist": [],
        "positions": [],
        "observations": [],
    }


def clone(value):
    return json.loads(json.dumps(value, ensure_ascii=False))


class RecoveryWorkflowTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "market-state.corrupt.json"
        self.target = self.root / "market-state.recovered.json"
        self.candidate = self.root / "market-state.candidate.json"
        self.report = self.root / "market-state.diagnostics.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def service(self, **kwargs) -> RecoveryService:
        return RecoveryService(self.source, clock=lambda: FIXED_NOW, **kwargs)

    def write(self, payload: dict) -> None:
        self.source.write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )

    def partial_payload(self) -> dict:
        invalid_watch = serialize_watchlist(replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS))
        invalid_watch["priority"] = "INVALID"
        invalid_position = serialize_position(CNY_POSITION)
        invalid_position["origin"] = "BROKER"
        invalid_observation = serialize_observation(OBSERVATION_HISTORY[1])
        invalid_observation["author_type"] = "SYSTEM"
        payload = empty_payload()
        payload["watchlist"] = [serialize_watchlist(WATCHLIST_NORMAL), invalid_watch]
        payload["positions"] = [serialize_position(PROFIT_POSITION), invalid_position]
        payload["observations"] = [serialize_observation(OBSERVATION_HISTORY[0]), invalid_observation]
        return payload


class ReviewTests(RecoveryWorkflowTestCase):
    def test_valid_store_review_is_not_recovery_eligible(self) -> None:
        self.write(empty_payload())
        review = self.service().inspect()
        self.assertEqual(RecoveryStoreStatus.LOADED, review.store_status)
        self.assertEqual(RecoveryEligibility.NOT_REQUIRED, review.recoverability)
        self.assertFalse(review.recovery_eligible)

    def test_partial_watchlist_review_is_read_only_and_diagnostics_are_stable(self) -> None:
        payload = empty_payload()
        valid = serialize_watchlist(WATCHLIST_NORMAL)
        invalid = serialize_watchlist(replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS))
        invalid["priority"] = "BAD"
        payload["watchlist"] = [valid, invalid]
        self.write(payload)
        before = self.source.read_bytes()
        first = self.service().inspect()
        second = self.service().inspect()
        self.assertEqual(before, self.source.read_bytes())
        self.assertEqual(RecoveryStoreStatus.PARTIALLY_INVALID, first.store_status)
        self.assertEqual(1, first.loaded_record_count)
        self.assertEqual(1, first.rejected_record_count)
        self.assertEqual(first.diagnostics, second.diagnostics)
        self.assertEqual((US_SHARE.instrument_id,), first.section_summaries[0].preserved_identities)

    def test_invalid_position_value_is_not_normalized(self) -> None:
        record = serialize_position(PROFIT_POSITION)
        record["quantity"] = "-1"
        payload = empty_payload()
        payload["positions"] = [record]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(0, review.loaded_record_count)
        self.assertEqual(RecoveryDiagnosticCode.INVALID_VALUE, review.diagnostics[0].code)

    def test_invalid_position_origin_has_specific_code_and_is_not_rewritten(self) -> None:
        record = serialize_position(PROFIT_POSITION)
        record["origin"] = "BROKER"
        payload = empty_payload()
        payload["positions"] = [record]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(RecoveryDiagnosticCode.INVALID_POSITION_ORIGIN, review.diagnostics[0].code)
        exported = self.service().export_candidate(review, self.candidate)
        raw = json.loads(Path(exported.path).read_text(encoding="utf-8"))
        self.assertEqual([], raw["state"]["positions"])

    def test_invalid_observation_is_rejected_without_history_rewrite(self) -> None:
        record = serialize_observation(OBSERVATION_HISTORY[0])
        record["author_type"] = "SYSTEM"
        payload = empty_payload()
        payload["observations"] = [record]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(0, len(review.preserved_state.observations))
        self.assertEqual(RecoveryDiagnosticCode.INVALID_ENUM, review.diagnostics[0].code)

    def test_unknown_field_is_reported_and_entire_record_is_dropped(self) -> None:
        record = serialize_position(PROFIT_POSITION)
        record["unexpected_field"] = "secret-value-not-for-report"
        payload = empty_payload()
        payload["positions"] = [record]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(RecoveryDiagnosticCode.UNKNOWN_FIELD, review.diagnostics[0].code)
        self.service().export_candidate(review, self.candidate)
        self.service().export_diagnostics(review, self.report)
        self.assertEqual([], json.loads(self.candidate.read_text(encoding="utf-8"))["state"]["positions"])
        self.assertNotIn("secret-value-not-for-report", self.report.read_text(encoding="utf-8"))

    def test_missing_required_field_has_stable_code(self) -> None:
        record = serialize_position(PROFIT_POSITION)
        del record["currency"]
        payload = empty_payload()
        payload["positions"] = [record]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(RecoveryDiagnosticCode.MISSING_REQUIRED_FIELD, review.diagnostics[0].code)

    def test_unsupported_record_shape_has_stable_code(self) -> None:
        payload = empty_payload()
        payload["watchlist"] = ["not-an-object"]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(RecoveryDiagnosticCode.UNSUPPORTED_RECORD_SHAPE, review.diagnostics[0].code)


class IdentitySafetyTests(RecoveryWorkflowTestCase):
    def test_duplicate_watchlist_identity_rejects_the_whole_group(self) -> None:
        first = serialize_watchlist(WATCHLIST_NORMAL)
        second = clone(first)
        second["note"] = "conflicting note"
        payload = empty_payload()
        payload["watchlist"] = [first, second]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual((), review.preserved_state.watchlist)
        self.assertEqual(2, review.conflict_count)
        self.assertTrue(all(item.code is RecoveryDiagnosticCode.IDENTITY_CONFLICT for item in review.diagnostics))

    def test_duplicate_position_identity_rejects_the_whole_group(self) -> None:
        first = serialize_position(PROFIT_POSITION)
        second = clone(first)
        second["note"] = "conflicting note"
        payload = empty_payload()
        payload["positions"] = [first, second]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual((), review.preserved_state.positions)
        self.assertEqual(2, review.rejected_record_count)

    def test_duplicate_observation_content_is_never_merged(self) -> None:
        first = serialize_observation(OBSERVATION_HISTORY[0])
        second = clone(first)
        second["content"] = "A mutually conflicting historical claim"
        payload = empty_payload()
        payload["observations"] = [first, second]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual((), review.preserved_state.observations)
        self.service().export_candidate(review, self.candidate)
        text = self.candidate.read_text(encoding="utf-8")
        self.assertNotIn(first["content"], text)
        self.assertNotIn(second["content"], text)

    def test_multiple_conflicting_groups_are_all_rejected(self) -> None:
        watch = serialize_watchlist(WATCHLIST_NORMAL)
        observation = serialize_observation(OBSERVATION_HISTORY[0])
        payload = empty_payload()
        payload["watchlist"] = [watch, clone(watch)]
        payload["observations"] = [observation, clone(observation)]
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(4, review.rejected_record_count)
        self.assertEqual(4, review.conflict_count)
        self.assertEqual(0, review.loaded_record_count)


class FailClosedTests(RecoveryWorkflowTestCase):
    def test_malformed_json_can_export_report_but_not_candidate(self) -> None:
        self.source.write_text('{"schema_version": 1,', encoding="utf-8")
        review = self.service().inspect()
        self.assertEqual(RecoveryStoreStatus.MALFORMED_STORE, review.store_status)
        self.assertEqual(RecoveryDiagnosticCode.MALFORMED_STORE, review.diagnostics[0].code)
        self.service().export_diagnostics(review, self.report)
        self.assertTrue(self.report.exists())
        with self.assertRaises(RecoveryError) as context:
            self.service().export_candidate(review, self.candidate)
        self.assertEqual(RecoveryErrorCode.RECOVERY_NOT_ELIGIBLE, context.exception.failure.code)

    def test_duplicate_top_level_key_does_not_claim_a_reliable_header(self) -> None:
        self.source.write_text(
            '{"schema_version":1,"schema_version":1,"format_version":"nexa-market-state-json-v1",'
            '"watchlist":[],"positions":[],"observations":[]}',
            encoding="utf-8",
        )
        review = self.service().inspect()
        self.assertEqual(RecoveryStoreStatus.MALFORMED_STORE, review.store_status)
        self.assertIsNone(review.schema_version)
        self.assertIsNone(review.format_version)
        self.assertFalse(review.counts_reliable)

    def test_future_schema_is_fail_closed(self) -> None:
        payload = empty_payload()
        payload["schema_version"] = 999
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(RecoveryStoreStatus.UNSUPPORTED_VERSION, review.store_status)
        self.assertEqual(999, review.schema_version)
        self.assertFalse(review.recovery_eligible)
        with self.assertRaises(RecoveryError):
            self.service().preview(review, self.target)

    def test_format_mismatch_is_fail_closed_with_specific_code(self) -> None:
        payload = empty_payload()
        payload["format_version"] = "future-format"
        self.write(payload)
        review = self.service().inspect()
        self.assertEqual(RecoveryStoreStatus.FORMAT_MISMATCH, review.store_status)
        self.assertEqual(RecoveryDiagnosticCode.FORMAT_MISMATCH, review.diagnostics[0].code)


class ExportAndPreviewTests(RecoveryWorkflowTestCase):
    def test_preview_is_pure_and_reports_required_counts(self) -> None:
        self.write(self.partial_payload())
        before = self.source.read_bytes()
        preview = self.service().preview(self.service().inspect(), self.target)
        self.assertEqual(before, self.source.read_bytes())
        self.assertFalse(self.target.exists())
        self.assertFalse(Path(preview.manifest_reference).exists())
        self.assertEqual(6, preview.source_record_count)
        self.assertEqual(3, preview.preserved_count)
        self.assertEqual(3, preview.rejected_count)
        self.assertTrue(preview.original_remains_preserved)

    def test_diagnostic_json_export_contains_review_not_valid_record_bodies(self) -> None:
        self.write(self.partial_payload())
        result = self.service().export_diagnostics(self.service().inspect(), self.report)
        raw = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertTrue(result.diagnostics_reference.startswith("sha256:"))
        self.assertEqual("PARTIALLY_INVALID", raw["store_status"])
        self.assertEqual(3, raw["valid_records_count"])
        self.assertEqual(3, raw["rejected_records_summary"]["count"])
        self.assertNotIn("state", raw)

    def test_candidate_export_is_explicit_and_contains_only_valid_records(self) -> None:
        self.write(self.partial_payload())
        result = self.service().export_candidate(self.service().inspect(), self.candidate)
        raw = json.loads(self.candidate.read_text(encoding="utf-8"))
        self.assertEqual(CandidateStatus.RECOVERED_CANDIDATE, result.status)
        self.assertEqual("RECOVERED_CANDIDATE", raw["candidate_status"])
        self.assertEqual(1, len(raw["state"]["watchlist"]))
        self.assertEqual(1, len(raw["state"]["positions"]))
        self.assertEqual(1, len(raw["state"]["observations"]))
        self.assertEqual(3, raw["provenance"]["rejected_records_omitted"])

    def test_unicode_survives_candidate_and_recovered_store(self) -> None:
        valid = serialize_watchlist(replace(WATCHLIST_NORMAL, note="中文复盘：保留证据", tags=("长期",)))
        invalid = serialize_watchlist(replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS))
        invalid["priority"] = "坏值"
        payload = empty_payload()
        payload["watchlist"] = [valid, invalid]
        self.write(payload)
        service = self.service()
        review = service.inspect()
        service.export_candidate(review, self.candidate)
        preview = service.preview(review, self.target)
        service.commit_recovery(preview, explicit_confirmation=True)
        self.assertIn("中文复盘：保留证据", self.candidate.read_text(encoding="utf-8"))
        self.assertIn("中文复盘：保留证据", self.target.read_text(encoding="utf-8"))

    def test_candidate_cannot_be_mistaken_for_active_store(self) -> None:
        self.write(self.partial_payload())
        self.service().export_candidate(self.service().inspect(), self.candidate)
        with self.assertRaises(RepositoryError):
            LocalStateStore(self.candidate).load()
        self.assertFalse(self.target.exists())

    def test_export_refuses_to_overwrite_existing_artifact(self) -> None:
        self.write(self.partial_payload())
        self.report.write_text("operator-owned", encoding="utf-8")
        with self.assertRaises(RecoveryError) as context:
            self.service().export_diagnostics(self.service().inspect(), self.report)
        self.assertEqual(RecoveryErrorCode.TARGET_CONFLICT, context.exception.failure.code)
        self.assertEqual("operator-owned", self.report.read_text(encoding="utf-8"))


class CommitTests(RecoveryWorkflowTestCase):
    def test_missing_confirmation_performs_zero_replacement(self) -> None:
        self.write(self.partial_payload())
        before = self.source.read_bytes()
        service = self.service()
        preview = service.preview(service.inspect(), self.target)
        with self.assertRaises(RecoveryError) as context:
            service.commit_recovery(preview, explicit_confirmation=False)
        self.assertEqual(RecoveryErrorCode.CONFIRMATION_REQUIRED, context.exception.failure.code)
        self.assertEqual(before, self.source.read_bytes())
        self.assertFalse(self.target.exists())
        self.assertFalse(Path(preview.manifest_reference).exists())

    def test_confirmation_must_be_literal_true(self) -> None:
        self.write(self.partial_payload())
        service = self.service()
        preview = service.preview(service.inspect(), self.target)
        with self.assertRaises(RecoveryError):
            service.commit_recovery(preview, explicit_confirmation=1)  # type: ignore[arg-type]
        self.assertFalse(self.target.exists())

    def test_confirmed_recovery_creates_new_active_store_and_manifest(self) -> None:
        self.write(self.partial_payload())
        service = self.service()
        preview = service.preview(service.inspect(), self.target)
        result = service.commit_recovery(preview, explicit_confirmation=True)
        self.assertEqual(ReplacementStatus.ACTIVE_REPLACEMENT, result.status)
        self.assertTrue(self.target.exists())
        self.assertTrue(Path(result.manifest_reference).exists())
        self.assertEqual(RepositoryLoadStatus.LOADED, LocalStateStore(self.target).load().status)
        manifest = json.loads(Path(result.manifest_reference).read_text(encoding="utf-8"))
        self.assertEqual("ACTIVE_REPLACEMENT", manifest["replacement_status"])
        self.assertTrue(manifest["provenance"]["original_store_preserved"])

    def test_original_corrupt_store_is_preserved_byte_for_byte(self) -> None:
        self.write(self.partial_payload())
        before = self.source.read_bytes()
        service = self.service()
        service.commit_recovery(service.preview(service.inspect(), self.target), explicit_confirmation=True)
        self.assertEqual(before, self.source.read_bytes())
        self.assertEqual(RecoveryStoreStatus.PARTIALLY_INVALID, service.inspect().store_status)

    def test_atomic_failure_leaves_source_intact_and_no_replacement(self) -> None:
        self.write(self.partial_payload())
        before = self.source.read_bytes()

        def fail_replace(source, destination):
            raise OSError("simulated atomic replace failure")

        service = self.service(replace_function=fail_replace)
        preview = service.preview(service.inspect(), self.target)
        with self.assertRaises(RecoveryError) as context:
            service.commit_recovery(preview, explicit_confirmation=True)
        self.assertEqual(RecoveryErrorCode.ATOMIC_COMMIT_FAILED, context.exception.failure.code)
        self.assertEqual(before, self.source.read_bytes())
        self.assertFalse(self.target.exists())
        self.assertFalse(Path(preview.manifest_reference).exists())
        self.assertEqual([], list(self.root.glob(".*.tmp")))

    def test_active_store_failure_rolls_back_new_manifest(self) -> None:
        self.write(self.partial_payload())
        before = self.source.read_bytes()
        calls = 0

        def fail_second_replace(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated active-store replace failure")
            return os.replace(source, destination)

        service = self.service(replace_function=fail_second_replace)
        preview = service.preview(service.inspect(), self.target)
        with self.assertRaises(RecoveryError) as context:
            service.commit_recovery(preview, explicit_confirmation=True)
        self.assertEqual(RecoveryErrorCode.ATOMIC_COMMIT_FAILED, context.exception.failure.code)
        self.assertEqual(before, self.source.read_bytes())
        self.assertFalse(self.target.exists())
        self.assertFalse(Path(preview.manifest_reference).exists())

    def test_source_change_after_preview_blocks_commit(self) -> None:
        self.write(self.partial_payload())
        service = self.service()
        preview = service.preview(service.inspect(), self.target)
        changed = self.partial_payload()
        changed["positions"].append(serialize_position(CNY_POSITION))
        self.write(changed)
        with self.assertRaises(RecoveryError) as context:
            service.commit_recovery(preview, explicit_confirmation=True)
        self.assertEqual(RecoveryErrorCode.SOURCE_CHANGED, context.exception.failure.code)
        self.assertFalse(self.target.exists())

    def test_existing_target_is_never_replaced(self) -> None:
        self.write(self.partial_payload())
        self.target.write_text("operator-owned", encoding="utf-8")
        with self.assertRaises(RecoveryError) as context:
            self.service().preview(self.service().inspect(), self.target)
        self.assertEqual(RecoveryErrorCode.TARGET_CONFLICT, context.exception.failure.code)
        self.assertEqual("operator-owned", self.target.read_text(encoding="utf-8"))

    def test_source_path_cannot_be_recovery_target(self) -> None:
        self.write(self.partial_payload())
        with self.assertRaises(RecoveryError):
            self.service().preview(self.service().inspect(), self.source)

    def test_recovered_store_is_consumed_by_existing_services(self) -> None:
        self.write(self.partial_payload())
        service = self.service()
        service.commit_recovery(service.preview(service.inspect(), self.target), explicit_confirmation=True)
        watch = WatchlistService(LocalWatchlistRepository(self.target))
        positions = PositionService(LocalPositionRepository(self.target), KNOWN_INSTRUMENTS)
        observations = ObservationService(LocalObservationRepository(self.target), KNOWN_INSTRUMENTS)
        self.assertEqual((WATCHLIST_NORMAL,), watch.list_items())
        self.assertEqual((PROFIT_POSITION,), positions.list_positions())
        self.assertEqual(
            (OBSERVATION_HISTORY[0],),
            observations.list_by_instrument(OBSERVATION_HISTORY[0].instrument_id),
        )


if __name__ == "__main__":
    unittest.main()
