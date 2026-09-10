from __future__ import annotations

import ast
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from unittest import TestCase, mock

from nexa_radar.audit import RecommendationAuditBuilder
from nexa_radar.audit_reader import AuditReadStatus, RecommendationAuditReader
from nexa_radar.candidate_preparation import (
    BASELINE_SCORER_ID,
    BASELINE_SCORER_VERSION,
    CandidatePreparationBatchResult,
    CandidatePreparationContext,
    CandidatePreparationPolicy,
    CandidatePreparationResult,
    PreparationRejectionCode,
    PreparationStatus,
    PreparationWarningCode,
    ProjectMatchingRule,
    SourceTrust,
)
from nexa_radar.domain import (
    ContentType,
    ProjectRelationType,
    Provenance,
    RadarItem,
    RecommendationCategory,
    RecommendationCode,
    Source,
    SourceKind,
    UserFeedback,
    UserState,
)
from nexa_radar.recommendation import RecommendationContext, RecommendationOrchestrator
from nexa_radar.rss_adapter import OfflineRssAdapter


NOW = datetime(2026, 8, 10, 12, 0, tzinfo=UTC)
PUBLISHED = datetime(2026, 8, 8, 9, 0, tzinfo=UTC)
SOURCE = Source(SourceKind.MANUAL, "manual:preparation-fixture", "Preparation Fixture", "https://source.invalid")
RSS_XML = (Path(__file__).parent / "fixtures" / "rss_normal.xml").read_bytes()


def _item(
    item_id: str = "prep-item-001",
    *,
    title: str = "Deterministic systems workflow for reliable automation",
    summary: str = "A complete evidence-focused summary about workflow architecture, deterministic policy, and reliable offline automation behavior.",
    published_at: datetime | None = PUBLISHED,
    source: Source = SOURCE,
) -> RadarItem:
    provenance = Provenance(
        source_instance_id=source.instance_id,
        adapter_id="fixture:preparation:v0.1",
        original_ref=f"https://content.invalid/{item_id}",
        discovered_at=NOW,
        provider_item_id=f"provider-{item_id}",
        normalized=True,
        evidence_ref=f"fixture-evidence:{item_id}",
    )
    return RadarItem(
        item_id=item_id,
        title=title,
        summary=summary,
        target_ref=f"https://content.invalid/{item_id}",
        source=source,
        content_type=ContentType.ARTICLE,
        discovered_at=NOW,
        provenance=provenance,
        published_at=published_at,
    )


def _context(
    *,
    active_project_ids: frozenset[str] = frozenset({"project-current"}),
    current_interests: tuple[str, ...] = ("deterministic systems",),
    project_matching_rules=None,
    adjacent_topic_rules=None,
    source_trust=None,
) -> CandidatePreparationContext:
    return CandidatePreparationContext(
        active_project_ids=active_project_ids,
        current_interests=current_interests,
        project_matching_rules=project_matching_rules
        if project_matching_rules is not None
        else {"project-current": ProjectMatchingRule(keywords=("workflow",))},
        adjacent_topic_rules=adjacent_topic_rules
        if adjacent_topic_rules is not None
        else {"deterministic systems": ("observability",)},
        source_trust=source_trust if source_trust is not None else {SOURCE.instance_id: SourceTrust.NORMAL},
        reference_time=NOW,
    )


def _empty_context(**kwargs) -> CandidatePreparationContext:
    return CandidatePreparationContext(
        active_project_ids=kwargs.get("active_project_ids", frozenset()),
        current_interests=kwargs.get("current_interests", ()),
        project_matching_rules=kwargs.get("project_matching_rules", {}),
        adjacent_topic_rules=kwargs.get("adjacent_topic_rules", {}),
        source_trust=kwargs.get("source_trust", {}),
        reference_time=kwargs.get("reference_time", NOW),
    )


class CandidatePreparationContextTests(TestCase):
    def test_context_creation_normalizes_and_freezes_values(self) -> None:
        context = CandidatePreparationContext(
            active_project_ids=frozenset({" project-current "}),
            current_interests=(" Deterministic Systems ", "deterministic systems"),
            project_matching_rules={"project-current": ProjectMatchingRule(keywords=(" WorkFlow ",))},
            adjacent_topic_rules={" Deterministic Systems ": (" Observability ",)},
            source_trust={SOURCE.instance_id: SourceTrust.VERIFIED},
            reference_time=NOW,
        )
        self.assertEqual(context.current_interests, ("deterministic systems",))
        self.assertEqual(context.project_matching_rules["project-current"].keywords, ("workflow",))
        with self.assertRaises(TypeError):
            context.source_trust["x"] = SourceTrust.NORMAL  # type: ignore[index]

    def test_naive_reference_time_is_invalid(self) -> None:
        with self.assertRaises(ValueError):
            _empty_context(reference_time=datetime(2026, 8, 10))

    def test_invalid_source_trust_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            _empty_context(source_trust={SOURCE.instance_id: "VERIFIED"})  # type: ignore[dict-item]

    def test_empty_project_rule_is_invalid(self) -> None:
        with self.assertRaises(ValueError):
            ProjectMatchingRule()

    def test_adjacent_topics_cannot_be_plain_string(self) -> None:
        with self.assertRaises(ValueError):
            _empty_context(adjacent_topic_rules={"automation": "observability"})  # type: ignore[dict-item]

    def test_normalized_adjacent_rule_conflict_is_invalid(self) -> None:
        with self.assertRaises(ValueError):
            _empty_context(adjacent_topic_rules={"AI": ("ml",), " ai ": ("models",)})

    def test_policy_returns_structured_invalid_context_rejection(self) -> None:
        result = CandidatePreparationPolicy().prepare(_item(), object())
        self.assertEqual(result.status, PreparationStatus.REJECTED)
        self.assertEqual(result.rejection.code, PreparationRejectionCode.INVALID_CONTEXT)  # type: ignore[union-attr]


class BaselineQualityPolicyTests(TestCase):
    def setUp(self) -> None:
        self.policy = CandidatePreparationPolicy()

    def test_radar_item_becomes_radar_entry(self) -> None:
        result = self.policy.prepare(_item(), _context())
        self.assertIsInstance(result, CandidatePreparationResult)
        self.assertTrue(result.prepared)
        self.assertEqual(result.entry.item.item_id, "prep-item-001")  # type: ignore[union-attr]

    def test_quality_has_seven_explicit_dimensions(self) -> None:
        quality = self.policy.prepare(_item(), _context()).entry.quality  # type: ignore[union-attr]
        self.assertEqual(len(quality.dimensions), 7)
        self.assertEqual(
            tuple(dimension.name for dimension in quality.dimensions),
            ("title_completeness", "summary_completeness", "target_validity", "source_completeness", "provenance_completeness", "publication_metadata", "source_trust"),
        )

    def test_scorer_identity_and_version_are_stable(self) -> None:
        quality = self.policy.prepare(_item(), _context()).entry.quality  # type: ignore[union-attr]
        self.assertEqual(quality.scorer_id, BASELINE_SCORER_ID)
        self.assertEqual(quality.version, BASELINE_SCORER_VERSION)
        self.assertEqual((quality.scorer_id, quality.version), ("radar-baseline-preparation", "0.1"))

    def test_baseline_quality_is_provisional(self) -> None:
        self.assertFalse(self.policy.prepare(_item(), _context()).entry.quality.is_final)  # type: ignore[union-attr]

    def test_complete_candidate_passes_existing_provisional_gate(self) -> None:
        entry = self.policy.prepare(_item(), _context()).entry
        decision = RecommendationOrchestrator()._eligibility_policy.evaluate(entry, RecommendationContext(3))  # type: ignore[attr-defined]
        self.assertTrue(decision.eligible)
        self.assertGreaterEqual(entry.quality.total, 75)  # type: ignore[union-attr]

    def test_missing_summary_marker_lowers_score(self) -> None:
        complete = self.policy.prepare(_item(), _context()).entry.quality.total  # type: ignore[union-attr]
        limited = self.policy.prepare(_item(summary="No summary provided."), _context()).entry.quality.total  # type: ignore[union-attr]
        self.assertLess(limited, complete)

    def test_missing_published_time_lowers_score_without_rejection(self) -> None:
        result = self.policy.prepare(_item(published_at=None), _context())
        self.assertTrue(result.prepared)
        self.assertIn(PreparationWarningCode.MISSING_PUBLISHED_AT, {warning.code for warning in result.warnings})
        self.assertLess(result.entry.quality.total, self.policy.prepare(_item(), _context()).entry.quality.total)  # type: ignore[union-attr]

    def test_warning_is_structured_and_bound_to_item(self) -> None:
        warning = self.policy.prepare(_item(published_at=None), _context()).warnings[0]
        self.assertEqual(warning.code, PreparationWarningCode.MISSING_PUBLISHED_AT)
        self.assertEqual(warning.item_id, "prep-item-001")
        self.assertTrue(warning.explanation)

    def test_scores_are_not_a_uniform_constant(self) -> None:
        values = {
            self.policy.prepare(_item(), _context()).entry.quality.total,  # type: ignore[union-attr]
            self.policy.prepare(_item(summary="Brief summary."), _context()).entry.quality.total,  # type: ignore[union-attr]
            self.policy.prepare(_item(published_at=None), _context()).entry.quality.total,  # type: ignore[union-attr]
        }
        self.assertGreaterEqual(len(values), 3)

    def test_source_trust_is_explicit_and_changes_quality(self) -> None:
        verified = self.policy.prepare(_item(), _context(source_trust={SOURCE.instance_id: SourceTrust.VERIFIED}))
        low = self.policy.prepare(_item(), _context(source_trust={SOURCE.instance_id: SourceTrust.LOW_CONFIDENCE}))
        self.assertGreater(verified.entry.quality.total, low.entry.quality.total)  # type: ignore[union-attr]
        self.assertIn(PreparationWarningCode.LOW_SOURCE_TRUST, {warning.code for warning in low.warnings})

    def test_same_input_produces_equal_result(self) -> None:
        item, context = _item(), _context()
        self.assertEqual(self.policy.prepare(item, context), self.policy.prepare(item, context))


class RecommendationEvidenceTests(TestCase):
    def setUp(self) -> None:
        self.policy = CandidatePreparationPolicy()

    def test_current_project_reason(self) -> None:
        result = self.policy.prepare(_item(), _context(current_interests=()))
        self.assertEqual(result.recommendation_evidence[0].code, RecommendationCode.CURRENT_PROJECT)

    def test_current_interest_reason(self) -> None:
        result = self.policy.prepare(_item(), _empty_context(current_interests=("deterministic systems",)))
        self.assertEqual(result.recommendation_evidence[0].code, RecommendationCode.CURRENT_INTEREST)

    def test_adjacent_reason_uses_explicit_rule(self) -> None:
        context = _empty_context(
            current_interests=("reliability",),
            adjacent_topic_rules={"reliability": ("observability",)},
        )
        result = self.policy.prepare(_item(title="Observability patterns for offline systems"), context)
        self.assertEqual(result.recommendation_evidence[0].code, RecommendationCode.ADJACENT_FIELD)

    def test_cross_domain_is_non_rejecting_fallback(self) -> None:
        result = self.policy.prepare(_item(), _empty_context())
        self.assertTrue(result.prepared)
        self.assertEqual(result.recommendation_evidence[0].code, RecommendationCode.CROSS_DOMAIN)
        self.assertIn(PreparationWarningCode.FALLBACK_CROSS_DOMAIN, {warning.code for warning in result.warnings})

    def test_bucket_precedence_is_current_then_adjacent(self) -> None:
        context = _context(adjacent_topic_rules={"another-interest": ("workflow",)})
        result = self.policy.prepare(_item(), context)
        categories = tuple(reason.category for reason in result.recommendation_evidence)
        self.assertEqual(categories[0], RecommendationCategory.CURRENT)
        self.assertIn(RecommendationCategory.ADJACENT, categories)

    def test_multiple_reasons_have_stable_order(self) -> None:
        first = self.policy.prepare(_item(), _context()).recommendation_evidence
        second = self.policy.prepare(_item(), _context()).recommendation_evidence
        self.assertEqual(first, second)
        self.assertEqual(tuple(reason.code for reason in first[:2]), (RecommendationCode.CURRENT_PROJECT, RecommendationCode.CURRENT_INTEREST))

    def test_single_project_relation_has_finite_relevance(self) -> None:
        relation = self.policy.prepare(_item(), _context(current_interests=())).project_relation_evidence[0]
        self.assertEqual(relation.relevance, 0.65)
        self.assertEqual(relation.relation_type, ProjectRelationType.DIRECT_USE)

    def test_multiple_rule_matches_increase_relevance(self) -> None:
        rule = ProjectMatchingRule(keywords=("workflow", "automation"))
        relation = self.policy.prepare(_item(), _context(current_interests=(), project_matching_rules={"project-current": rule})).project_relation_evidence[0]
        self.assertEqual(relation.relevance, 0.8)

    def test_explicit_item_mapping_has_one_relevance(self) -> None:
        rule = ProjectMatchingRule(item_ids=frozenset({"prep-item-001"}))
        relation = self.policy.prepare(_item(), _context(current_interests=(), project_matching_rules={"project-current": rule})).project_relation_evidence[0]
        self.assertEqual(relation.relevance, 1.0)

    def test_multiple_project_relations_are_sorted_by_context_mapping(self) -> None:
        rules = {"project-z": ProjectMatchingRule(keywords=("workflow",)), "project-a": ProjectMatchingRule(keywords=("automation",))}
        relations = self.policy.prepare(_item(), _context(active_project_ids=frozenset(), current_interests=(), project_matching_rules=rules)).project_relation_evidence
        self.assertEqual(tuple(relation.project_id for relation in relations), ("project-a", "project-z"))

    def test_missing_project_relation_is_warning_not_rejection(self) -> None:
        result = self.policy.prepare(_item(), _empty_context())
        self.assertTrue(result.prepared)
        self.assertIn(PreparationWarningCode.NO_PROJECT_RELATION, {warning.code for warning in result.warnings})

    def test_project_ids_are_not_hardcoded_in_production_policy(self) -> None:
        source = (Path(__file__).parents[1] / "nexa_radar" / "candidate_preparation.py").read_text(encoding="utf-8")
        for forbidden in ("ExecutionHub", "StarBench", "information-radar"):
            self.assertNotIn(forbidden, source)


class FeedbackBatchAndNeutralityTests(TestCase):
    def setUp(self) -> None:
        self.policy = CandidatePreparationPolicy()

    def test_default_feedback_uses_injected_reference_time(self) -> None:
        feedback = self.policy.prepare(_item(), _context()).entry.user_feedback  # type: ignore[union-attr]
        self.assertEqual(feedback.state, UserState.DEFAULT)
        self.assertEqual(feedback.updated_at, NOW)

    def test_saved_feedback_is_preserved(self) -> None:
        feedback = UserFeedback("prep-item-001", UserState.SAVED, PUBLISHED)
        self.assertIs(self.policy.prepare(_item(), _context(), feedback).entry.user_feedback, feedback)  # type: ignore[union-attr]

    def test_read_later_feedback_is_preserved(self) -> None:
        feedback = UserFeedback("prep-item-001", UserState.READ_LATER, PUBLISHED)
        self.assertEqual(self.policy.prepare(_item(), _context(), feedback).entry.user_feedback.state, UserState.READ_LATER)  # type: ignore[union-attr]

    def test_not_interested_feedback_is_preserved(self) -> None:
        feedback = UserFeedback("prep-item-001", UserState.NOT_INTERESTED, PUBLISHED)
        self.assertEqual(self.policy.prepare(_item(), _context(), feedback).entry.user_feedback.state, UserState.NOT_INTERESTED)  # type: ignore[union-attr]

    def test_mismatched_feedback_is_rejected(self) -> None:
        feedback = UserFeedback("another-item", UserState.SAVED, NOW)
        result = self.policy.prepare(_item(), _context(), feedback)
        self.assertEqual(result.rejection.code, PreparationRejectionCode.INVALID_USER_FEEDBACK)  # type: ignore[union-attr]

    def test_invalid_item_is_structurally_rejected(self) -> None:
        result = self.policy.prepare(object(), _context())
        self.assertFalse(result.prepared)
        self.assertEqual(result.rejection.code, PreparationRejectionCode.INVALID_ITEM)  # type: ignore[union-attr]

    def test_prepare_many_preserves_input_order_and_counts(self) -> None:
        items = (_item("prep-a"), object(), _item("prep-b"))
        batch = self.policy.prepare_many(items, _empty_context())
        self.assertIsInstance(batch, CandidatePreparationBatchResult)
        self.assertEqual(batch.prepared_count, 2)
        self.assertEqual(batch.rejected_count, 1)
        self.assertEqual(tuple(entry.item.item_id for entry in batch.prepared_candidates), ("prep-a", "prep-b"))

    def test_prepare_many_preserves_existing_feedback(self) -> None:
        item = _item("prep-saved")
        feedback = UserFeedback(item.item_id, UserState.SAVED, PUBLISHED)
        batch = self.policy.prepare_many((item,), _empty_context(), {item.item_id: feedback})
        self.assertEqual(batch.prepared_candidates[0].user_feedback.state, UserState.SAVED)

    def test_manual_non_rss_item_uses_same_policy(self) -> None:
        result = self.policy.prepare(_item(), _context())
        self.assertTrue(result.prepared)
        self.assertEqual(result.entry.item.source.kind, SourceKind.MANUAL)  # type: ignore[union-attr]

    def test_n8n_kind_requires_no_web_or_n8n_special_case(self) -> None:
        source = Source(SourceKind.N8N, "n8n:future-adapter", "Future Legacy Adapter")
        result = self.policy.prepare(_item(source=source), _empty_context())
        self.assertTrue(result.prepared)
        module_source = (Path(__file__).parents[1] / "nexa_radar" / "candidate_preparation.py").read_text(encoding="utf-8")
        self.assertNotIn("OfflineRssAdapter", module_source)
        self.assertNotIn("N8nAdapter", module_source)


class OfflineFullChainTests(TestCase):
    def _full_chain(self):
        rss = OfflineRssAdapter(feed_ref="fixture:radar-006")
        ingestion = rss.ingest(RSS_XML, discovered_at=NOW)
        preparation = CandidatePreparationPolicy().prepare_many(ingestion.items, _empty_context())
        recommendation = RecommendationOrchestrator().recommend(preparation.prepared_candidates, RecommendationContext(3))
        snapshot = RecommendationAuditBuilder().build(recommendation, snapshot_id="radar-006-chain", created_at=NOW)
        read_result = RecommendationAuditReader().read_json(snapshot.to_json())
        return ingestion, preparation, recommendation, snapshot, read_result

    def test_rss_items_prepare_through_same_policy(self) -> None:
        ingestion, preparation, *_ = self._full_chain()
        self.assertEqual(preparation.prepared_count, len(ingestion.items))
        self.assertTrue(all(entry.item.source.kind is SourceKind.RSS for entry in preparation.prepared_candidates))

    def test_preparation_to_recommendation_passes(self) -> None:
        _, _, recommendation, _, _ = self._full_chain()
        self.assertEqual(len(recommendation.selections), 3)
        self.assertEqual(recommendation.input_candidate_count, 4)
        self.assertEqual(recommendation.unique_candidate_count, 3)

    def test_recommendation_to_audit_and_reader_passes(self) -> None:
        *_, snapshot, read_result = self._full_chain()
        self.assertEqual(read_result.status, AuditReadStatus.VALID)
        self.assertEqual(len(snapshot.final_selections), 3)

    def test_full_chain_is_deterministic(self) -> None:
        first = self._full_chain()[3].to_json()
        second = self._full_chain()[3].to_json()
        self.assertEqual(first, second)

    def test_raw_rss_xml_does_not_leak(self) -> None:
        ingestion, preparation, _, snapshot, _ = self._full_chain()
        projected = repr(preparation) + snapshot.to_json()
        self.assertNotIn("<rss", projected.casefold())
        self.assertNotIn("steal-cookie", projected)
        self.assertFalse(any(item.metadata for item in ingestion.items))

    def test_preparation_does_not_reimplement_dedup(self) -> None:
        module_path = Path(__file__).parents[1] / "nexa_radar" / "candidate_preparation.py"
        source = module_path.read_text(encoding="utf-8")
        self.assertNotIn("canonical_identity", source)
        self.assertNotIn("from .dedup", source)

    def test_full_chain_makes_no_network_calls(self) -> None:
        with mock.patch("socket.create_connection", side_effect=AssertionError("network forbidden")), mock.patch(
            "urllib.request.urlopen", side_effect=AssertionError("network forbidden")
        ):
            self._full_chain()

    def test_candidate_module_uses_only_standard_library_and_internal_imports(self) -> None:
        path = Path(__file__).parents[1] / "nexa_radar" / "candidate_preparation.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        external = []
        allowed = {"dataclasses", "datetime", "enum", "types", "typing", "urllib", "re", "__future__"}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                external.extend(alias.name for alias in node.names if alias.name.split(".")[0] not in allowed)
            if isinstance(node, ast.ImportFrom) and node.level == 0 and (node.module or "").split(".")[0] not in allowed:
                external.append(node.module)
        self.assertEqual(external, [])
