from __future__ import annotations

import ast
from dataclasses import replace
from datetime import UTC, datetime
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
from nexa_radar.dedup import DuplicateBasis, DuplicateKind
from nexa_radar.domain import (
    ContentType,
    Provenance,
    RadarItem,
    RecommendationCategory,
    Source,
    SourceKind,
    UserFeedback,
    UserState,
)
from nexa_radar.ingestion import (
    INGESTION_CONTRACT_VERSION,
    IngestionContext,
    IngestionIssueCode,
    IngestionStatus,
    ItemIngestionStatus,
    MultiSourceIngestion,
    MultiSourceIngestionResult,
    SourceBatchWarning,
    SourceIngestionBatch,
    SourceIngestionPolicy,
    derive_batch_id,
)
from nexa_radar.legacy_adapter import LegacyRadarAdapter
from nexa_radar.legacy_result import (
    LegacyCollectorVersion,
    LegacyExecutionStatus,
    LegacyResultContext,
    LegacyResultValidator,
)
from nexa_radar.recommendation import RecommendationContext, RecommendationOrchestrator
from nexa_radar.rss_adapter import OfflineRssAdapter


NOW = datetime(2026, 8, 11, 8, 0, tzinfo=UTC)
PUBLISHED = datetime(2026, 8, 10, 8, 0, tzinfo=UTC)
FIXTURES = Path(__file__).parent / "fixtures"
MODULE = Path(__file__).parents[1] / "nexa_radar" / "ingestion.py"

RSS_SOURCE = Source(SourceKind.RSS, "rss:multi-source", "RSS Fixture", "https://rss.invalid")
N8N_SOURCE = Source(SourceKind.N8N, "n8n:multi-source", "Legacy Fixture", "nexa-legacy:collector")
MANUAL_SOURCE = Source(SourceKind.MANUAL, "manual:multi-source", "Manual Fixture", "manual:fixture")


def _item(
    item_id: str,
    source: Source,
    *,
    title: str = "Reliable workflow architecture for deterministic automation",
    summary: str = "A bounded and complete evidence summary about deterministic automation, workflow architecture, and operational reliability.",
    target_ref: str | None = None,
    published_at: datetime | None = PUBLISHED,
    content_type: ContentType = ContentType.ARTICLE,
    normalized: bool = True,
    evidence: bool = True,
) -> RadarItem:
    target = target_ref or f"https://content.invalid/{item_id}"
    provenance = Provenance(
        source_instance_id=source.instance_id,
        adapter_id=f"fixture:{source.kind.value.casefold()}:v0.1",
        original_ref=target,
        discovered_at=NOW,
        provider_item_id=f"provider-{item_id}",
        normalized=normalized,
        evidence_ref=f"evidence:{item_id}" if evidence else None,
    )
    return RadarItem(
        item_id=item_id,
        title=title,
        summary=summary,
        target_ref=target,
        source=source,
        content_type=content_type,
        discovered_at=NOW,
        provenance=provenance,
        published_at=published_at,
    )


def _preparation_context() -> CandidatePreparationContext:
    return CandidatePreparationContext(
        active_project_ids=frozenset({"project-current"}),
        current_interests=("automation",),
        project_matching_rules={"project-current": ProjectMatchingRule(keywords=("workflow",))},
        adjacent_topic_rules={"automation": ("observability",)},
        source_trust={
            RSS_SOURCE.instance_id: SourceTrust.NORMAL,
            N8N_SOURCE.instance_id: SourceTrust.NORMAL,
            MANUAL_SOURCE.instance_id: SourceTrust.NORMAL,
        },
        reference_time=NOW,
    )


def _context(**changes: object) -> IngestionContext:
    values: dict[str, object] = {
        "reference_time": NOW,
        "candidate_preparation_context": _preparation_context(),
    }
    values.update(changes)
    return IngestionContext(**values)  # type: ignore[arg-type]


def _batch(source: Source, items: tuple[RadarItem, ...], batch_id: str) -> SourceIngestionBatch:
    return SourceIngestionBatch(source, items, NOW, batch_id=batch_id)


def _mixed_batches() -> tuple[SourceIngestionBatch, ...]:
    exact_target = "https://content.invalid/shared-contract?utm_source=rss"
    rss_items = (
        _item("rss-exact", RSS_SOURCE, target_ref=exact_target, published_at=None),
        _item(
            "rss-possible",
            RSS_SOURCE,
            title="Deterministic observability field guide",
            target_ref="https://content.invalid/possible-rss",
        ),
        _item(
            "rss-cross",
            RSS_SOURCE,
            title="Creative typography systems",
            summary="A complete exploration of visual typography, creative systems, editorial rhythm, and design composition for small screens.",
        ),
    )
    legacy_items = (
        _item("legacy-exact", N8N_SOURCE, target_ref="https://content.invalid/shared-contract"),
        _item(
            "legacy-possible",
            N8N_SOURCE,
            title="Deterministic observability field guide",
            target_ref="https://content.invalid/possible-legacy",
        ),
        _item("legacy-current", N8N_SOURCE),
    )
    manual_items = (
        _item(
            "manual-adjacent",
            MANUAL_SOURCE,
            title="Observability patterns for resilient systems",
            summary="A complete field note about observability patterns, telemetry boundaries, resilient systems, and operational feedback loops.",
        ),
        _item(
            "manual-cross",
            MANUAL_SOURCE,
            title="Urban gardening field notes",
            summary="A complete practical guide to balcony planting, soil health, seasonal gardening, and sustainable community food systems.",
        ),
    )
    return (
        _batch(RSS_SOURCE, rss_items, "batch-rss-mixed"),
        _batch(N8N_SOURCE, legacy_items, "batch-legacy-mixed"),
        _batch(MANUAL_SOURCE, manual_items, "batch-manual-mixed"),
    )


def _mixed_context(**changes: object) -> IngestionContext:
    feedback = UserFeedback("manual-adjacent", UserState.SAVED, NOW)
    return _context(feedback_by_item_id={feedback.item_id: feedback}, **changes)


def _mixed_result(**context_changes: object) -> MultiSourceIngestionResult:
    return MultiSourceIngestion().ingest(_mixed_batches(), _mixed_context(**context_changes))


def _rss_batch() -> SourceIngestionBatch:
    xml = (FIXTURES / "rss_normal.xml").read_bytes()
    adapter_result = OfflineRssAdapter(
        feed_ref="fixture:ingestion-rss",
        source_display_name="Ingestion RSS Fixture",
    ).ingest(
        xml,
        discovered_at=NOW,
    )
    return SourceIngestionBatch(
        adapter_result.source,
        tuple(adapter_result.items[:3]),
        NOW,
        batch_id="batch-offline-rss",
    )


def _legacy_items(count: int = 3, *, long_body: bool = False) -> tuple[RadarItem, ...]:
    base = json.loads((FIXTURES / "legacy_v1_4_success.json").read_text(encoding="utf-8"))
    items: list[RadarItem] = []
    for index in range(count):
        payload = dict(base)
        payload["ai_name"] = f"Legacy Ingestion Tool {index}"
        payload["source_url"] = f"https://legacy.invalid/tools/{index}"
        if long_body:
            payload["web_text"] = "bounded-start " + ("body-fragment " * 160) + "UNSAFE_TAIL_MARKER"
            payload["web_text_length"] = len(payload["web_text"])
        validation = LegacyResultValidator().validate(
            payload,
            context=LegacyResultContext(
                LegacyCollectorVersion.V1_4,
                workflow_identity="workflow-ingestion-fixture",
                execution_identity=f"execution-ingestion-{index}",
                engine_status=LegacyExecutionStatus.OBSERVED_SUCCESS,
            ),
        )
        mapped = LegacyRadarAdapter().convert(validation, reference_time=NOW)
        if mapped.item is None:
            raise AssertionError(mapped.rejection)
        items.append(mapped.item)
    return tuple(items)


def _legacy_batch() -> SourceIngestionBatch:
    items = _legacy_items()
    return SourceIngestionBatch(items[0].source, items, NOW, batch_id="batch-offline-legacy")


class _SelectiveRejectingPolicy(CandidatePreparationPolicy):
    def __init__(self, rejected_item_ids: frozenset[str]) -> None:
        self._rejected_item_ids = rejected_item_ids

    def prepare(self, item: object, context: object, user_feedback: UserFeedback | None = None):
        if isinstance(item, RadarItem) and item.item_id in self._rejected_item_ids:
            return super().prepare(item, object(), user_feedback)
        return super().prepare(item, context, user_feedback)


class IngestionContractTests(TestCase):
    def test_01_context_accepts_explicit_reference_time(self) -> None:
        self.assertEqual(_context().reference_time, NOW)

    def test_02_context_rejects_naive_time(self) -> None:
        with self.assertRaises(ValueError):
            _context(reference_time=datetime(2026, 8, 11, 8, 0))

    def test_03_ingest_invalid_context_is_structured_failure(self) -> None:
        result = MultiSourceIngestion().ingest((_mixed_batches()[0],), object())
        self.assertEqual((result.status, result.issues[0].code), (IngestionStatus.FAILED, IngestionIssueCode.INVALID_CONTEXT))

    def test_04_source_batch_accepts_only_radar_items(self) -> None:
        with self.assertRaises(ValueError):
            SourceIngestionBatch(RSS_SOURCE, (object(),), NOW)  # type: ignore[arg-type]

    def test_05_source_batch_requires_matching_source(self) -> None:
        with self.assertRaises(ValueError):
            SourceIngestionBatch(RSS_SOURCE, (_item("manual-wrong", MANUAL_SOURCE),), NOW)

    def test_06_deterministic_batch_identity(self) -> None:
        items = (_item("batch-id-item", RSS_SOURCE),)
        self.assertEqual(
            derive_batch_id(RSS_SOURCE, NOW, items),
            derive_batch_id(RSS_SOURCE, NOW, items),
        )

    def test_07_caller_provided_batch_identity_is_preserved(self) -> None:
        self.assertEqual(_batch(RSS_SOURCE, (_item("explicit-batch", RSS_SOURCE),), "caller-batch").batch_id, "caller-batch")

    def test_08_batch_identity_changes_with_safe_execution_reference(self) -> None:
        item = _item("execution-batch", RSS_SOURCE)
        first = derive_batch_id(RSS_SOURCE, NOW, (item,), "execution-one")
        second = derive_batch_id(RSS_SOURCE, NOW, (item,), "execution-two")
        self.assertNotEqual(first, second)

    def test_09_source_warning_is_structured_and_preserved(self) -> None:
        batch = SourceIngestionBatch(
            RSS_SOURCE,
            (_item("warning-item", RSS_SOURCE),),
            NOW,
            batch_id="batch-warning",
            source_warnings=(SourceBatchWarning("SOURCE_NOTICE", "Fixture source reported a bounded notice."),),
        )
        result = MultiSourceIngestion().ingest((batch,), _context())
        self.assertEqual(result.warnings[0].code, "SOURCE_NOTICE")

    def test_10_unsafe_source_warning_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            SourceBatchWarning("BAD", "Authorization: Bearer fixture")

    def test_11_multiple_batches_received_count(self) -> None:
        self.assertEqual(_mixed_result().received_item_count, 8)

    def test_12_result_has_stable_contract_version(self) -> None:
        self.assertEqual(_mixed_result().contract_version, INGESTION_CONTRACT_VERSION)

    def test_13_source_outcome_contains_batch_identities(self) -> None:
        outcome = next(value for value in _mixed_result().source_outcomes if value.source_kind is SourceKind.RSS)
        self.assertEqual(outcome.batch_ids, ("batch-rss-mixed",))

    def test_14_evidence_contains_counts_not_input_batches(self) -> None:
        result = _mixed_result()
        self.assertEqual(len(result.evidence), 3)
        self.assertFalse(hasattr(result, "batches"))


class DedupAndSourcePolicyTests(TestCase):
    def test_15_exact_duplicate_count(self) -> None:
        self.assertEqual(_mixed_result().exact_duplicates_removed, 1)

    def test_16_cross_source_exact_duplicate_keeps_one_candidate(self) -> None:
        ids = {entry.item.item_id for entry in _mixed_result().prepared_candidates}
        self.assertEqual(len(ids & {"rss-exact", "legacy-exact"}), 1)

    def test_17_possible_duplicate_is_observed(self) -> None:
        observations = _mixed_result().possible_duplicate_observations
        self.assertTrue(any(value.basis is DuplicateBasis.NORMALIZED_TITLE for value in observations))

    def test_18_possible_duplicate_is_not_removed(self) -> None:
        ids = {entry.item.item_id for entry in _mixed_result().prepared_candidates}
        self.assertTrue({"rss-possible", "legacy-possible"}.issubset(ids))

    def test_19_duplicate_winner_prefers_representation_completeness(self) -> None:
        ids = {entry.item.item_id for entry in _mixed_result().prepared_candidates}
        self.assertIn("legacy-exact", ids)
        self.assertNotIn("rss-exact", ids)

    def test_20_duplicate_winner_does_not_use_quality_score(self) -> None:
        source = MODULE.read_text(encoding="utf-8")
        winner_body = source[source.index("def _winner_key"):source.index("def _result_status")]
        self.assertNotIn("quality", winner_body.casefold())

    def test_21_explicit_source_precedence_breaks_equal_representation_tie(self) -> None:
        target = "https://content.invalid/precedence"
        rss = _item("rss-precedence", RSS_SOURCE, target_ref=target)
        legacy = _item("legacy-precedence", N8N_SOURCE, target_ref=target)
        result = MultiSourceIngestion().ingest(
            (_batch(N8N_SOURCE, (legacy,), "legacy-p"), _batch(RSS_SOURCE, (rss,), "rss-p")),
            _context(source_precedence=(SourceKind.RSS, SourceKind.N8N)),
        )
        self.assertEqual(result.prepared_candidates[0].item.item_id, "rss-precedence")

    def test_22_default_precedence_is_provider_neutral_and_stable(self) -> None:
        first = _mixed_result()
        second = MultiSourceIngestion().ingest(tuple(reversed(_mixed_batches())), _mixed_context())
        self.assertEqual(first.item_outcomes, second.item_outcomes)

    def test_23_rss_legacy_exact_duplicate(self) -> None:
        rss = _item("rss-legacy-rss", RSS_SOURCE, target_ref="https://content.invalid/rss-legacy")
        legacy = _item("rss-legacy-n8n", N8N_SOURCE, target_ref="https://content.invalid/rss-legacy")
        result = MultiSourceIngestion().ingest(
            (_batch(RSS_SOURCE, (rss,), "r-l-rss"), _batch(N8N_SOURCE, (legacy,), "r-l-n8n")), _context()
        )
        self.assertEqual(result.exact_duplicates_removed, 1)

    def test_24_rss_manual_exact_duplicate(self) -> None:
        rss = _item("rss-manual-rss", RSS_SOURCE, target_ref="https://content.invalid/rss-manual")
        manual = _item("rss-manual-manual", MANUAL_SOURCE, target_ref="https://content.invalid/rss-manual")
        result = MultiSourceIngestion().ingest(
            (_batch(RSS_SOURCE, (rss,), "r-m-rss"), _batch(MANUAL_SOURCE, (manual,), "r-m-manual")), _context()
        )
        self.assertEqual(result.exact_duplicates_removed, 1)

    def test_25_legacy_manual_exact_duplicate(self) -> None:
        legacy = _item("legacy-manual-n8n", N8N_SOURCE, target_ref="https://content.invalid/legacy-manual")
        manual = _item("legacy-manual-manual", MANUAL_SOURCE, target_ref="https://content.invalid/legacy-manual")
        result = MultiSourceIngestion().ingest(
            (_batch(N8N_SOURCE, (legacy,), "l-m-n8n"), _batch(MANUAL_SOURCE, (manual,), "l-m-manual")), _context()
        )
        self.assertEqual(result.exact_duplicates_removed, 1)

    def test_26_rss_source_outcome(self) -> None:
        outcome = next(value for value in _mixed_result().source_outcomes if value.source_kind is SourceKind.RSS)
        self.assertEqual(outcome.received, 3)

    def test_27_n8n_source_outcome(self) -> None:
        outcome = next(value for value in _mixed_result().source_outcomes if value.source_kind is SourceKind.N8N)
        self.assertEqual(outcome.received, 3)

    def test_28_manual_source_outcome(self) -> None:
        outcome = next(value for value in _mixed_result().source_outcomes if value.source_kind is SourceKind.MANUAL)
        self.assertEqual(outcome.received, 2)

    def test_29_source_disabled_is_structured(self) -> None:
        result = _mixed_result(source_policies={SourceKind.RSS: SourceIngestionPolicy(enabled=False)})
        statuses = {value.status for value in result.item_outcomes if value.source_instance_id == RSS_SOURCE.instance_id}
        self.assertEqual(statuses, {ItemIngestionStatus.SOURCE_DISABLED})

    def test_30_source_disabled_is_not_prepared(self) -> None:
        result = _mixed_result(source_policies={RSS_SOURCE.instance_id: SourceIngestionPolicy(enabled=False)})
        self.assertFalse(any(entry.item.source.kind is SourceKind.RSS for entry in result.prepared_candidates))


class FailureFeedbackAndOrderingTests(TestCase):
    def test_31_batch_limit_fails_closed_without_truncation(self) -> None:
        result = MultiSourceIngestion().ingest(
            (_mixed_batches()[0],), _context(max_items_per_batch=2)
        )
        self.assertEqual(result.rejected_item_count, 3)
        self.assertEqual(result.prepared_candidate_count, 0)

    def test_32_source_specific_batch_limit_overrides_global(self) -> None:
        result = MultiSourceIngestion().ingest(
            (_mixed_batches()[0],),
            _context(
                max_items_per_batch=1,
                source_policies={RSS_SOURCE.instance_id: SourceIngestionPolicy(max_items=3)},
            ),
        )
        self.assertGreater(result.prepared_candidate_count, 0)

    def test_33_preparation_warning_is_preserved(self) -> None:
        item = _item("missing-published-warning", MANUAL_SOURCE, published_at=None)
        result = MultiSourceIngestion().ingest(
            (_batch(MANUAL_SOURCE, (item,), "warning-preparation"),), _context()
        )
        self.assertTrue(any(warning.code == "MISSING_PUBLISHED_AT" for warning in result.warnings))

    def test_34_preparation_rejection_is_preserved(self) -> None:
        policy = _SelectiveRejectingPolicy(frozenset({"manual-cross"}))
        result = MultiSourceIngestion(policy).ingest(_mixed_batches(), _mixed_context())
        outcome = next(value for value in result.item_outcomes if value.item_id == "manual-cross")
        self.assertEqual((outcome.status, outcome.issue_code), (ItemIngestionStatus.PREPARATION_REJECTED, IngestionIssueCode.PREPARATION_REJECTED))

    def test_35_saved_feedback_is_preserved(self) -> None:
        entry = next(value for value in _mixed_result().prepared_candidates if value.item.item_id == "manual-adjacent")
        self.assertEqual(entry.user_feedback.state, UserState.SAVED)

    def test_36_read_later_feedback_is_preserved(self) -> None:
        feedback = UserFeedback("manual-cross", UserState.READ_LATER, NOW)
        result = MultiSourceIngestion().ingest(
            _mixed_batches(), _context(feedback_by_item_id={feedback.item_id: feedback})
        )
        entry = next(value for value in result.prepared_candidates if value.item.item_id == feedback.item_id)
        self.assertEqual(entry.user_feedback, feedback)

    def test_37_not_interested_feedback_is_preserved(self) -> None:
        feedback = UserFeedback("manual-cross", UserState.NOT_INTERESTED, NOW)
        result = MultiSourceIngestion().ingest(
            _mixed_batches(), _context(feedback_by_item_id={feedback.item_id: feedback})
        )
        entry = next(value for value in result.prepared_candidates if value.item.item_id == feedback.item_id)
        self.assertEqual(entry.user_feedback, feedback)

    def test_38_partial_failure(self) -> None:
        policy = _SelectiveRejectingPolicy(frozenset({"manual-cross"}))
        result = MultiSourceIngestion(policy).ingest(_mixed_batches(), _mixed_context())
        self.assertEqual(result.status, IngestionStatus.PARTIAL_SUCCESS)

    def test_39_total_failure(self) -> None:
        result = MultiSourceIngestion().ingest(
            (_mixed_batches()[0],), _context(source_policies={SourceKind.RSS: SourceIngestionPolicy(enabled=False)})
        )
        self.assertEqual(result.status, IngestionStatus.FAILED)

    def test_40_successful_batch(self) -> None:
        item = _item("success-one", MANUAL_SOURCE)
        result = MultiSourceIngestion().ingest((_batch(MANUAL_SOURCE, (item,), "success-batch"),), _context())
        self.assertEqual(result.status, IngestionStatus.SUCCESS)

    def test_41_default_fail_fast_false_allows_other_sources(self) -> None:
        result = _mixed_result(source_policies={SourceKind.RSS: SourceIngestionPolicy(enabled=False)})
        self.assertTrue(any(value.status is ItemIngestionStatus.ACCEPTED for value in result.item_outcomes))

    def test_42_explicit_fail_fast_aborts_remaining_sources(self) -> None:
        result = _mixed_result(
            source_policies={SourceKind.MANUAL: SourceIngestionPolicy(enabled=False)},
            fail_fast=True,
        )
        self.assertEqual(result.prepared_candidate_count, 0)
        self.assertTrue(any(value.status is ItemIngestionStatus.FAIL_FAST_ABORTED for value in result.item_outcomes))

    def test_43_output_order_is_stable_across_batch_order(self) -> None:
        first = _mixed_result().prepared_candidates
        second = MultiSourceIngestion().ingest(tuple(reversed(_mixed_batches())), _mixed_context()).prepared_candidates
        self.assertEqual(tuple(value.item.item_id for value in first), tuple(value.item.item_id for value in second))

    def test_44_ingestion_does_not_perform_recommendation_ranking(self) -> None:
        result = _mixed_result()
        expected = tuple(sorted((entry.item for entry in result.prepared_candidates), key=lambda item: (item.source.kind.value, item.source.instance_id, item.item_id)))
        self.assertEqual(tuple(entry.item for entry in result.prepared_candidates), expected)


class AdapterSmokeAndSafetyTests(TestCase):
    def test_45_rss_adapter_batch_uses_shared_preparation(self) -> None:
        batch = _rss_batch()
        result = MultiSourceIngestion().ingest((batch,), _context())
        self.assertEqual(result.prepared_candidate_count, 3)

    def test_46_legacy_adapter_batch_uses_shared_preparation(self) -> None:
        batch = _legacy_batch()
        result = MultiSourceIngestion().ingest((batch,), _context())
        self.assertEqual(result.prepared_candidate_count, 3)

    def test_47_manual_batch_needs_no_adapter_special_case(self) -> None:
        item = _item("manual-normal", MANUAL_SOURCE)
        result = MultiSourceIngestion().ingest((_batch(MANUAL_SOURCE, (item,), "manual-normal-batch"),), _context())
        self.assertEqual(result.prepared_candidates[0].item, item)

    def test_48_mixed_three_source_fixture_counts(self) -> None:
        result = _mixed_result()
        self.assertEqual(
            (result.received_item_count, result.accepted_item_count, result.exact_duplicates_removed, result.prepared_candidate_count),
            (8, 7, 1, 7),
        )

    def test_49_mixed_fixture_has_current_and_cross_domain(self) -> None:
        categories = {
            reason.category
            for entry in _mixed_result().prepared_candidates
            for reason in entry.recommendation_reasons
        }
        self.assertTrue({RecommendationCategory.CURRENT, RecommendationCategory.CROSS_DOMAIN}.issubset(categories))

    def test_50_mixed_recommendation_smoke_selects_three_to_five(self) -> None:
        recommendation = RecommendationOrchestrator().recommend(
            _mixed_result().prepared_candidates,
            RecommendationContext(5, active_project_ids=frozenset({"project-current"})),
        )
        self.assertEqual(len(recommendation.selections), 5)

    def test_51_mixed_audit_builder_smoke(self) -> None:
        recommendation = RecommendationOrchestrator().recommend(
            _mixed_result().prepared_candidates,
            RecommendationContext(5, active_project_ids=frozenset({"project-current"})),
        )
        snapshot = RecommendationAuditBuilder().build(recommendation, snapshot_id="audit-ingestion-mixed", created_at=NOW)
        self.assertEqual(len(snapshot.final_selections), 5)

    def test_52_mixed_audit_reader_smoke(self) -> None:
        recommendation = RecommendationOrchestrator().recommend(
            _mixed_result().prepared_candidates,
            RecommendationContext(5, active_project_ids=frozenset({"project-current"})),
        )
        snapshot = RecommendationAuditBuilder().build(recommendation, snapshot_id="audit-ingestion-reader", created_at=NOW)
        self.assertEqual(RecommendationAuditReader().read_json(snapshot.to_json()).status, AuditReadStatus.VALID)

    def test_53_raw_rss_xml_is_not_leaked(self) -> None:
        result = MultiSourceIngestion().ingest((_rss_batch(),), _context())
        projection = repr(result).casefold()
        self.assertNotIn("<rss", projection)
        self.assertNotIn("<item>", projection)

    def test_54_legacy_payload_and_full_text_are_not_leaked(self) -> None:
        items = _legacy_items(1, long_body=True)
        result = MultiSourceIngestion().ingest(
            (SourceIngestionBatch(items[0].source, items, NOW, batch_id="legacy-long"),), _context()
        )
        projection = repr(result)
        self.assertNotIn("webpage_read_status", projection)
        self.assertNotIn("UNSAFE_TAIL_MARKER", projection)

    def test_55_local_paths_are_not_leaked(self) -> None:
        projection = repr(_mixed_result())
        self.assertNotIn(str(Path(__file__).parent), projection)
        self.assertNotIn("E:\\", projection)

    def test_56_provider_specific_branches_are_absent_from_core(self) -> None:
        tree = ast.parse(MODULE.read_text(encoding="utf-8"))
        string_constants = {node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
        self.assertFalse({"RSS", "N8N", "GITHUB"} & string_constants)

    def test_57_future_arbitrary_valid_radar_item_is_accepted(self) -> None:
        future_source = Source(SourceKind.WEB, "future:provider", "Future Provider", "https://future.invalid")
        item = _item("future-valid", future_source)
        result = MultiSourceIngestion().ingest(
            (_batch(future_source, (item,), "future-batch"),), _context()
        )
        self.assertEqual(result.prepared_candidate_count, 1)

    def test_58_no_network_no_runtime_and_standard_library_only(self) -> None:
        tree = ast.parse(MODULE.read_text(encoding="utf-8"))
        imports = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imports.update(
            node.module.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module and node.level == 0
        )
        self.assertFalse(imports & {"requests", "httpx", "n8n", "subprocess", "sqlite3", "redis"})
        with mock.patch.object(socket, "create_connection", side_effect=AssertionError("network forbidden")):
            self.assertEqual(_mixed_result().prepared_candidate_count, 7)
