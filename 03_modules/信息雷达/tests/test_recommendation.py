from __future__ import annotations

from dataclasses import fields
from unittest import TestCase, mock

from nexa_radar.domain import RecommendationCategory, UserState
from nexa_radar.fixtures import build_recommendation_fixture_entries
from nexa_radar.recommendation import (
    EligibilityPolicy,
    ExclusionCode,
    ExplorationPolicy,
    QualityEligibilityPolicy,
    RecommendationContext,
    RecommendationOrchestrator,
    build_quota_plan,
)
from nexa_radar.viewmodels import HomeRadarCardViewModel, build_recommended_home_view_model


def _counts(result) -> dict[RecommendationCategory, int]:
    return {
        bucket: sum(1 for selection in result.selections if selection.bucket is bucket)
        for bucket in RecommendationCategory
    }


class RecommendationContextAndQuotaTests(TestCase):
    def test_context_creation_is_explicit_and_normalized(self) -> None:
        context = RecommendationContext(
            target_count=5,
            active_project_ids=frozenset({" information-radar ", "ExecutionHub"}),
            current_interests=(" Domain Modeling ",),
        )
        self.assertEqual(context.active_project_ids, frozenset({"information-radar", "ExecutionHub"}))
        self.assertEqual(context.current_interests, ("domain modeling",))
        self.assertEqual(context.quality_policy.final_threshold, 70)

    def test_context_rejects_target_outside_three_to_five(self) -> None:
        for invalid in (2, 6, True):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                RecommendationContext(target_count=invalid)  # type: ignore[arg-type]

    def test_target_three_quota_is_two_current_one_adjacent(self) -> None:
        plan = build_quota_plan(RecommendationContext(target_count=3))
        self.assertEqual(
            tuple(request.requested for request in plan.requests),
            (2, 1, 0),
        )

    def test_target_four_quota_protects_exploration(self) -> None:
        plan = build_quota_plan(RecommendationContext(target_count=4))
        self.assertEqual(tuple(request.requested for request in plan.requests), (2, 1, 1))

    def test_target_five_quota_is_current_dominant(self) -> None:
        plan = build_quota_plan(RecommendationContext(target_count=5))
        self.assertEqual(tuple(request.requested for request in plan.requests), (3, 1, 1))

    def test_exploration_can_be_explicitly_disabled(self) -> None:
        context = RecommendationContext(
            target_count=4,
            exploration_policy=ExplorationPolicy(enabled=False),
        )
        self.assertEqual(tuple(request.requested for request in build_quota_plan(context).requests), (3, 1, 0))


class EligibilityPolicyTests(TestCase):
    def setUp(self) -> None:
        self.pool = build_recommendation_fixture_entries()
        self.by_id = {entry.item.item_id: entry for entry in self.pool}
        self.context = RecommendationContext(target_count=5)
        self.policy = EligibilityPolicy()

    def test_not_interested_is_ineligible(self) -> None:
        decision = self.policy.evaluate(self.by_id["radar-tool-001"], self.context)
        self.assertFalse(decision.eligible)
        self.assertEqual(decision.code, ExclusionCode.NOT_RECOMMENDABLE_STATE)

    def test_saved_and_read_later_remain_eligible(self) -> None:
        for item_id, state in (
            ("radar-github-001", UserState.SAVED),
            ("radar-research-001", UserState.READ_LATER),
        ):
            with self.subTest(item_id=item_id):
                entry = self.by_id[item_id]
                self.assertEqual(entry.user_feedback.state, state)
                self.assertTrue(self.policy.evaluate(entry, self.context).eligible)

    def test_final_and_provisional_scores_have_distinct_thresholds(self) -> None:
        final_decision = self.policy.evaluate(self.by_id["radar-policy-final"], self.context)
        provisional_decision = self.policy.evaluate(self.by_id["radar-policy-provisional"], self.context)
        self.assertTrue(final_decision.eligible)
        self.assertFalse(provisional_decision.eligible)
        self.assertEqual(provisional_decision.code, ExclusionCode.BELOW_QUALITY_THRESHOLD)

    def test_low_quality_cross_domain_cannot_pass_exploration_gate(self) -> None:
        decision = self.policy.evaluate(self.by_id["radar-cross-low"], self.context)
        self.assertFalse(decision.eligible)
        self.assertEqual(decision.code, ExclusionCode.BELOW_QUALITY_THRESHOLD)

    def test_non_domain_object_is_rejected(self) -> None:
        decision = self.policy.evaluate(object(), self.context)
        self.assertFalse(decision.eligible)
        self.assertEqual(decision.code, ExclusionCode.INVALID_ENTRY)


class RecommendationOrchestratorTests(TestCase):
    def setUp(self) -> None:
        self.pool = build_recommendation_fixture_entries()
        self.by_id = {entry.item.item_id: entry for entry in self.pool}
        self.orchestrator = RecommendationOrchestrator()

    def test_target_three_result_is_current_dominant(self) -> None:
        result = self.orchestrator.recommend(self.pool, RecommendationContext(target_count=3))
        self.assertEqual(_counts(result), {
            RecommendationCategory.CURRENT: 2,
            RecommendationCategory.ADJACENT: 1,
            RecommendationCategory.CROSS_DOMAIN: 0,
        })

    def test_target_four_includes_adjacent_and_cross(self) -> None:
        result = self.orchestrator.recommend(self.pool, RecommendationContext(target_count=4))
        self.assertEqual(_counts(result), {
            RecommendationCategory.CURRENT: 2,
            RecommendationCategory.ADJACENT: 1,
            RecommendationCategory.CROSS_DOMAIN: 1,
        })

    def test_target_five_uses_three_one_one(self) -> None:
        result = self.orchestrator.recommend(self.pool, RecommendationContext(target_count=5))
        self.assertEqual(_counts(result), {
            RecommendationCategory.CURRENT: 3,
            RecommendationCategory.ADJACENT: 1,
            RecommendationCategory.CROSS_DOMAIN: 1,
        })

    def test_low_quality_cross_is_not_forced_when_cross_bucket_is_short(self) -> None:
        candidates = tuple(
            self.by_id[item_id]
            for item_id in (
                "radar-github-001",
                "radar-video-001",
                "radar-learning-001",
                "radar-policy-final",
                "radar-research-001",
                "radar-cross-low",
            )
        )
        result = self.orchestrator.recommend(candidates, RecommendationContext(target_count=5))
        ids = {selection.entry.item.item_id for selection in result.selections}
        self.assertNotIn("radar-cross-low", ids)
        self.assertEqual(_counts(result)[RecommendationCategory.CROSS_DOMAIN], 0)
        self.assertTrue(any("CROSS_DOMAIN requested 1 but only 0" in reason for reason in result.fallback_reasons))

    def test_current_shortage_backfills_adjacent_then_cross(self) -> None:
        candidates = tuple(
            self.by_id[item_id]
            for item_id in ("radar-research-001", "radar-adjacent-002", "radar-cross-001", "radar-cross-002")
        )
        result = self.orchestrator.recommend(candidates, RecommendationContext(target_count=4))
        self.assertEqual(_counts(result)[RecommendationCategory.CURRENT], 0)
        self.assertEqual(_counts(result)[RecommendationCategory.ADJACENT], 2)
        self.assertEqual(_counts(result)[RecommendationCategory.CROSS_DOMAIN], 2)
        self.assertTrue(any("CURRENT requested 2 but only 0" in reason for reason in result.fallback_reasons))

    def test_adjacent_shortage_backfills_from_current_without_losing_cross_slot(self) -> None:
        candidates = tuple(
            self.by_id[item_id]
            for item_id in (
                "radar-github-001",
                "radar-video-001",
                "radar-learning-001",
                "radar-policy-final",
                "radar-cross-001",
                "radar-cross-002",
            )
        )
        result = self.orchestrator.recommend(candidates, RecommendationContext(target_count=5))
        self.assertEqual(_counts(result), {
            RecommendationCategory.CURRENT: 4,
            RecommendationCategory.ADJACENT: 0,
            RecommendationCategory.CROSS_DOMAIN: 1,
        })

    def test_backfill_is_deterministic(self) -> None:
        candidates = tuple(
            self.by_id[item_id]
            for item_id in ("radar-research-001", "radar-adjacent-002", "radar-cross-001", "radar-cross-002")
        )
        context = RecommendationContext(target_count=4)
        first = self.orchestrator.recommend(candidates, context)
        second = self.orchestrator.recommend(candidates, context)
        self.assertEqual(first.selections, second.selections)
        self.assertEqual(first.fallback_reasons, second.fallback_reasons)

    def test_exact_duplicate_reuses_radar_001_contract(self) -> None:
        context = RecommendationContext(
            target_count=4,
            quality_policy=QualityEligibilityPolicy(final_threshold=60, provisional_threshold=60),
        )
        candidates = tuple(
            self.by_id[item_id]
            for item_id in (
                "radar-video-001",
                "radar-video-duplicate",
                "radar-github-001",
                "radar-research-001",
                "radar-cross-002",
            )
        )
        result = self.orchestrator.recommend(candidates, context)
        ids = {selection.entry.item.item_id for selection in result.selections}
        self.assertIn("radar-video-001", ids)
        self.assertNotIn("radar-video-duplicate", ids)
        self.assertTrue(
            any(
                exclusion.item_id == "radar-video-duplicate" and exclusion.code is ExclusionCode.EXACT_DUPLICATE
                for exclusion in result.exclusions
            )
        )

    def test_possible_duplicate_is_not_removed(self) -> None:
        context = RecommendationContext(
            target_count=4,
            quality_policy=QualityEligibilityPolicy(final_threshold=70, provisional_threshold=70),
        )
        candidates = tuple(
            self.by_id[item_id]
            for item_id in ("radar-github-001", "radar-research-001", "radar-research-possible", "radar-cross-002")
        )
        result = self.orchestrator.recommend(candidates, context)
        ids = {selection.entry.item.item_id for selection in result.selections}
        self.assertIn("radar-research-001", ids)
        self.assertIn("radar-research-possible", ids)

    def test_active_project_relation_changes_equal_quality_order(self) -> None:
        candidates = tuple(
            self.by_id[item_id]
            for item_id in ("radar-video-001", "radar-learning-001", "radar-policy-final")
        )
        active = self.orchestrator.recommend(
            candidates,
            RecommendationContext(target_count=3, active_project_ids=frozenset({"information-radar"})),
        )
        ids = [selection.entry.item.item_id for selection in active.selections]
        self.assertLess(ids.index("radar-video-001"), ids.index("radar-learning-001"))

    def test_non_active_project_does_not_receive_boost(self) -> None:
        candidates = tuple(
            self.by_id[item_id]
            for item_id in ("radar-video-001", "radar-learning-001", "radar-policy-final")
        )
        inactive = self.orchestrator.recommend(
            candidates,
            RecommendationContext(target_count=3, active_project_ids=frozenset({"unrelated-project"})),
        )
        ids = [selection.entry.item.item_id for selection in inactive.selections]
        self.assertLess(ids.index("radar-learning-001"), ids.index("radar-video-001"))

    def test_stable_item_id_breaks_complete_ranking_tie(self) -> None:
        candidates = tuple(
            self.by_id[item_id]
            for item_id in ("radar-video-001", "radar-learning-001", "radar-policy-final")
        )
        result = self.orchestrator.recommend(candidates, RecommendationContext(target_count=3))
        tied_ids = [
            selection.entry.item.item_id
            for selection in result.selections
            if selection.entry.quality.total == 80
        ]
        self.assertEqual(tied_ids, sorted(tied_ids))

    def test_same_input_repeated_call_is_identical(self) -> None:
        context = RecommendationContext(
            target_count=5,
            active_project_ids=frozenset({"information-radar", "ExecutionHub"}),
            current_interests=("domain",),
        )
        self.assertEqual(
            self.orchestrator.recommend(self.pool, context),
            self.orchestrator.recommend(self.pool, context),
        )

    def test_output_ranks_are_stable_and_contiguous(self) -> None:
        result = self.orchestrator.recommend(self.pool, RecommendationContext(target_count=5))
        self.assertEqual([selection.rank for selection in result.selections], [1, 2, 3, 4, 5])

    def test_output_bucket_and_selection_reason_are_explainable(self) -> None:
        result = self.orchestrator.recommend(self.pool, RecommendationContext(target_count=5))
        self.assertTrue(all(selection.bucket in RecommendationCategory for selection in result.selections))
        self.assertTrue(all("quality" in selection.why_selected for selection in result.selections))
        self.assertEqual(len(result.bucket_outcomes), 3)

    def test_invalid_candidate_is_reported_not_raised(self) -> None:
        candidates = (object(), self.by_id["radar-github-001"], self.by_id["radar-research-001"])
        result = self.orchestrator.recommend(candidates, RecommendationContext(target_count=3))
        self.assertTrue(any(exclusion.code is ExclusionCode.INVALID_ENTRY for exclusion in result.exclusions))


class RecommendationHomeIntegrationTests(TestCase):
    def setUp(self) -> None:
        self.pool = build_recommendation_fixture_entries()
        self.orchestrator = RecommendationOrchestrator()

    def test_results_for_three_to_five_map_directly_to_home(self) -> None:
        for target in (3, 4, 5):
            with self.subTest(target=target):
                result = self.orchestrator.recommend(self.pool, RecommendationContext(target_count=target))
                home = build_recommended_home_view_model(result)
                self.assertEqual(len(home.cards), target)
                self.assertEqual(
                    [card.item_id for card in home.cards],
                    [selection.entry.item.item_id for selection in result.selections],
                )

    def test_provider_metadata_does_not_leak_through_recommendation_result(self) -> None:
        result = self.orchestrator.recommend(self.pool, RecommendationContext(target_count=3))
        home = build_recommended_home_view_model(result)
        card_fields = {field.name for field in fields(HomeRadarCardViewModel)}
        self.assertNotIn("metadata", card_fields)
        self.assertTrue(all(not hasattr(card, "metadata") for card in home.cards))

    def test_full_orchestration_and_home_chain_performs_no_network_calls(self) -> None:
        with mock.patch("socket.create_connection", side_effect=AssertionError("network call attempted")):
            result = self.orchestrator.recommend(self.pool, RecommendationContext(target_count=5))
            home = build_recommended_home_view_model(result)
        self.assertEqual(len(home.cards), 5)


if __name__ == "__main__":
    import unittest

    unittest.main()
