from __future__ import annotations

from dataclasses import fields, replace
from datetime import UTC, datetime
from unittest import TestCase, mock

from nexa_radar.adapters import GitHubAdapter, N8nAdapter, RadarAdapter, RssAdapter
from nexa_radar.dedup import DuplicateBasis, DuplicateKind, canonical_identity, compare
from nexa_radar.domain import (
    ContentMetadata,
    ContentType,
    ProjectRelation,
    ProjectRelationType,
    QualityScore,
    RadarItem,
    RecommendationCategory,
    RecommendationCode,
    RecommendationReason,
    ScoreDimension,
    Source,
    SourceKind,
    UserFeedback,
    UserState,
)
from nexa_radar.fixtures import DISCOVERED, build_fixture_entries
from nexa_radar.viewmodels import HomeRadarCardViewModel, build_home_view_model


class DomainContractTests(TestCase):
    def setUp(self) -> None:
        self.entries = build_fixture_entries()

    def test_radar_item_valid_creation(self) -> None:
        item = self.entries[0].item
        self.assertIsInstance(item, RadarItem)
        self.assertEqual(item.item_id, "radar-github-001")

    def test_missing_required_title_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            replace(self.entries[0].item, title="  ")

    def test_target_reference_must_be_absolute(self) -> None:
        with self.assertRaises(ValueError):
            replace(self.entries[0].item, target_ref="relative/path")

    def test_content_type_validation(self) -> None:
        with self.assertRaises(ValueError):
            replace(self.entries[0].item, content_type="GITHUB_PROJECT")  # type: ignore[arg-type]
        self.assertTrue(
            {
                ContentType.VIDEO,
                ContentType.GITHUB_PROJECT,
                ContentType.AI_TOOL,
                ContentType.RESEARCH,
                ContentType.LEARNING_RESOURCE,
            }.issubset(set(ContentType))
        )

    def test_source_kind_and_instance_are_distinct_and_validated(self) -> None:
        source = self.entries[0].item.source
        self.assertEqual(source.kind, SourceKind.GITHUB)
        self.assertEqual(source.instance_id, "github:nexa-fixtures")
        with self.assertRaises(ValueError):
            Source("GITHUB", "github:bad", "Bad source")  # type: ignore[arg-type]

    def test_provenance_is_traceable_and_preserved(self) -> None:
        provenance = self.entries[0].item.provenance
        self.assertTrue(provenance.traceable)
        self.assertTrue(provenance.normalized)
        self.assertEqual(provenance.provider_item_id, "repo-1001")
        self.assertEqual(provenance.source_instance_id, self.entries[0].item.source.instance_id)

    def test_user_feedback_is_separate_from_item_provenance(self) -> None:
        entry = self.entries[0]
        changed = replace(entry, user_feedback=UserFeedback(entry.item.item_id, UserState.VIEWED, DISCOVERED))
        self.assertIs(changed.item, entry.item)
        self.assertIs(changed.item.provenance, entry.item.provenance)
        self.assertEqual(changed.user_feedback.state, UserState.VIEWED)

    def test_controlled_metadata_rejects_sensitive_or_nested_fields(self) -> None:
        with self.assertRaises(ValueError):
            ContentMetadata("test-v1", {"access_token": "not-allowed"})
        with self.assertRaises(ValueError):
            ContentMetadata("test-v1", {"nested": {"anything": True}})  # type: ignore[dict-item]

    def test_quality_total_is_deterministic_arithmetic_mean(self) -> None:
        quality = QualityScore(
            (ScoreDimension("a", 80, "fixture a"), ScoreDimension("b", 90, "fixture b")),
            "fixture-scorer",
            "1",
        )
        self.assertEqual(quality.total, 85.0)
        self.assertFalse(quality.is_final)

    def test_quality_dimension_range_is_enforced(self) -> None:
        for invalid in (-0.01, 100.01):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                ScoreDimension("invalid", invalid, "fixture evidence")

    def test_recommendation_reason_is_structured(self) -> None:
        reason = self.entries[0].recommendation_reasons[0]
        self.assertEqual(reason.code, RecommendationCode.CURRENT_PROJECT)
        self.assertEqual(reason.category, RecommendationCategory.CURRENT)
        self.assertTrue(reason.explanation)
        with self.assertRaises(ValueError):
            RecommendationReason("CURRENT_PROJECT", RecommendationCategory.CURRENT, "invalid enum")  # type: ignore[arg-type]

    def test_project_relation_range_is_enforced(self) -> None:
        with self.assertRaises(ValueError):
            ProjectRelation("ExecutionHub", ProjectRelationType.DIRECT_USE, 1.01, "too high")

    def test_one_item_supports_multiple_projects(self) -> None:
        relations = self.entries[0].project_relations
        self.assertEqual(len(relations), 2)
        self.assertEqual({relation.project_id for relation in relations}, {"ExecutionHub", "automation-center"})

    def test_fixture_covers_required_content_types(self) -> None:
        content_types = {entry.item.content_type for entry in self.entries}
        self.assertTrue(
            {
                ContentType.VIDEO,
                ContentType.GITHUB_PROJECT,
                ContentType.AI_TOOL,
                ContentType.RESEARCH,
                ContentType.LEARNING_RESOURCE,
            }.issubset(content_types)
        )

    def test_fixture_covers_required_user_states(self) -> None:
        states = {entry.user_feedback.state for entry in self.entries}
        self.assertTrue({UserState.SAVED, UserState.READ_LATER, UserState.NOT_INTERESTED}.issubset(states))

    def test_fixture_covers_all_recommendation_categories(self) -> None:
        categories = {
            reason.category
            for entry in self.entries
            for reason in entry.recommendation_reasons
        }
        self.assertEqual(categories, set(RecommendationCategory))


class DedupContractTests(TestCase):
    def setUp(self) -> None:
        self.entries = build_fixture_entries()

    def test_canonical_identity_normalizes_url_without_network(self) -> None:
        left = canonical_identity("HTTPS://Example.invalid:443/a//b/?z=2&utm_source=x&a=1#fragment")
        right = canonical_identity("https://example.invalid/a/b?a=1&z=2")
        self.assertEqual(left, right)

    def test_exact_duplicate_by_canonical_identity(self) -> None:
        decision = compare(self.entries[1].item, self.entries[6].item)
        self.assertEqual(decision.kind, DuplicateKind.EXACT_DUPLICATE)
        self.assertEqual(decision.basis, DuplicateBasis.CANONICAL_IDENTITY)

    def test_exact_duplicate_by_provider_item_id(self) -> None:
        original = self.entries[0].item
        alternative = replace(
            original,
            item_id="radar-github-alternative",
            target_ref="https://mirror.invalid/local-workflow-engine",
            provenance=replace(original.provenance, original_ref="https://mirror.invalid/local-workflow-engine"),
        )
        decision = compare(original, alternative)
        self.assertEqual(decision.kind, DuplicateKind.EXACT_DUPLICATE)
        self.assertEqual(decision.basis, DuplicateBasis.PROVIDER_ITEM_ID)

    def test_normalized_title_is_only_possible_duplicate(self) -> None:
        decision = compare(self.entries[2].item, self.entries[7].item)
        self.assertEqual(decision.kind, DuplicateKind.POSSIBLE_DUPLICATE)
        self.assertEqual(decision.basis, DuplicateBasis.NORMALIZED_TITLE)
        self.assertLess(decision.confidence, 1)

    def test_distinct_content_is_not_suppressed(self) -> None:
        decision = compare(self.entries[0].item, self.entries[4].item)
        self.assertEqual(decision.kind, DuplicateKind.DISTINCT)
        self.assertEqual(decision.basis, DuplicateBasis.NONE)


class HomeViewModelTests(TestCase):
    def setUp(self) -> None:
        self.entries = build_fixture_entries()

    def test_fixture_maps_to_home_view_model(self) -> None:
        home = build_home_view_model(self.entries, limit=5)
        self.assertEqual(len(home.cards), 5)
        self.assertTrue(all(isinstance(card, HomeRadarCardViewModel) for card in home.cards))
        card = home.cards[0]
        self.assertTrue(card.title)
        self.assertTrue(card.source_name)
        self.assertTrue(card.content_type)
        self.assertTrue(card.short_summary)
        self.assertGreaterEqual(card.quality.total, 0)
        self.assertTrue(card.recommendation_reasons)
        self.assertTrue(card.project_relations)
        self.assertTrue(card.user_state)
        self.assertTrue(card.target_ref)

    def test_home_limit_is_strictly_three_to_five(self) -> None:
        self.assertEqual(len(build_home_view_model(self.entries, limit=3).cards), 3)
        self.assertEqual(len(build_home_view_model(self.entries, limit=5).cards), 5)
        for invalid in (2, 6):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                build_home_view_model(self.entries, limit=invalid)

    def test_negative_feedback_is_not_shown(self) -> None:
        home = build_home_view_model((self.entries[5], *self.entries[:5]), limit=5)
        self.assertNotIn("radar-tool-001", {card.item_id for card in home.cards})

    def test_exact_duplicate_is_suppressed_but_possible_duplicate_is_retained(self) -> None:
        ordered = (
            self.entries[1],
            self.entries[6],
            self.entries[2],
            self.entries[7],
            self.entries[0],
            self.entries[3],
        )
        home = build_home_view_model(ordered, limit=5)
        ids = {card.item_id for card in home.cards}
        self.assertNotIn("radar-video-duplicate", ids)
        self.assertIn("radar-research-001", ids)
        self.assertIn("radar-research-possible", ids)

    def test_recommendation_category_survives_mapping(self) -> None:
        home = build_home_view_model(self.entries, limit=5)
        categories = {
            reason.category
            for card in home.cards
            for reason in card.recommendation_reasons
        }
        self.assertEqual(categories, {category.value for category in RecommendationCategory})

    def test_provider_metadata_does_not_leak_to_card_contract(self) -> None:
        card_field_names = {field.name for field in fields(HomeRadarCardViewModel)}
        self.assertNotIn("metadata", card_field_names)
        self.assertNotIn("provider_fields", card_field_names)
        card = build_home_view_model(self.entries, limit=3).cards[0]
        self.assertFalse(hasattr(card, "metadata"))

    def test_domain_chain_performs_no_network_calls(self) -> None:
        with mock.patch("socket.create_connection", side_effect=AssertionError("network call attempted")):
            entries = build_fixture_entries()
            home = build_home_view_model(entries, limit=5)
        self.assertEqual(len(home.cards), 5)

    def test_adapter_boundaries_exist_without_implementations(self) -> None:
        for protocol in (RadarAdapter, RssAdapter, GitHubAdapter, N8nAdapter):
            self.assertTrue(getattr(protocol, "_is_protocol", False))
        self.assertTrue(callable(getattr(RadarAdapter, "normalize")))


if __name__ == "__main__":
    import unittest

    unittest.main()
