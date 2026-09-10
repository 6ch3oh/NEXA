from __future__ import annotations

import unittest
from datetime import datetime, timezone
from decimal import Decimal

from src.analytics import Period, UNATTRIBUTED, build_resource_intelligence
from src.authority import model_to_attribution, task_to_models
from src.contracts import (
    BillingMode, CostKind, CostRecord, SourceTag, SourceType,
    UsageAttribution, UsageRecord,
)
from src.query import QueryService


T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
T1 = datetime(2026, 2, 1, tzinfo=timezone.utc)
SOURCE = SourceTag(SourceType.REMOTE_PROVIDER_API, "synthetic:intelligence", T0)


def usage(usage_id, provider, model, tokens, *, project=None, task=None, run=None, at=T0):
    attribution = (UsageAttribution.attributed(project_id=project, task_id=task, run_id=run)
                   if any((project, task, run)) else UsageAttribution.unattributed())
    return UsageRecord(usage_id, provider, tokens, 0, 0, 0, at, SOURCE,
                       model=model, attribution=attribution)


def cost(record, amount, kind=CostKind.ACTUAL, currency="USD"):
    return CostRecord(record.provider_id, Decimal(amount), currency, record.observed_at,
                      "synthetic:reported", SOURCE, model=record.model, kind=kind,
                      usage_id=record.usage_id)


class ResourceIntelligenceCase(unittest.TestCase):
    def setUp(self):
        self.a = usage("a", "deepseek", "v4", 60, project="p1", task="t1", run="r1")
        self.b = usage("b", "deepseek", "v4", 40, project="p1", task="t2", run="r2")
        self.c = usage("c", "openai", "gpt", 100, project="p1", task="t1", run="r3")
        self.u = usage("u", "deepseek", "v4", 50)
        self.costs = (
            cost(self.a, "6"), cost(self.b, "4"), cost(self.c, "20"), cost(self.u, "5"),
            cost(self.a, "3", CostKind.ESTIMATED), cost(self.c, "7", currency="CNY"),
        )

    def result(self, usages=None, costs=None):
        return build_resource_intelligence(
            QueryService(usages=tuple(usages or (self.a, self.b, self.c, self.u)),
                         costs=tuple(costs or self.costs)), Period(T0, T1)
        )

    def test_coverage_and_unattributed_are_explicit(self):
        result = self.result()
        self.assertEqual(result.coverage.total_tokens, 250)
        self.assertEqual(result.coverage.unattributed_tokens, 50)
        self.assertEqual(result.coverage.attribution_coverage, Decimal("0.8"))
        self.assertEqual(result.coverage.unattributed_ratio, Decimal("0.2"))
        self.assertIn(UNATTRIBUTED, {row.key for row in result.project_token_ranking})

    def test_rankings_have_numerator_denominator_share_and_stable_ties(self):
        forward = self.result()
        reverse = self.result(tuple(reversed((self.a, self.b, self.c, self.u))),
                              tuple(reversed(self.costs)))
        self.assertEqual(forward, reverse)
        first = forward.model_token_ranking[0]
        self.assertEqual((first.token_numerator, first.token_denominator), (150, 250))
        self.assertEqual(first.token_share, Decimal("0.6"))
        self.assertEqual(tuple(row.key for row in forward.task_token_ranking[:2]),
                         ("p1:t1", "UNATTRIBUTED:UNATTRIBUTED"))

    def test_actual_estimated_and_currencies_never_merge(self):
        result = self.result()
        self.assertTrue(result.model_actual_cost_ranking)
        self.assertTrue(result.model_estimated_cost_ranking)
        self.assertTrue(result.task_actual_cost_ranking)
        self.assertTrue(result.task_estimated_cost_ranking)
        self.assertTrue(result.project_actual_cost_ranking)
        self.assertTrue(result.project_estimated_cost_ranking)
        currencies = {row.currency for row in result.model_actual_cost_ranking}
        self.assertEqual(currencies, {"USD", "CNY"})
        for row in result.model_actual_cost_ranking:
            same_currency = [item for item in result.model_actual_cost_ranking
                             if item.currency == row.currency]
            self.assertEqual(row.cost_denominator,
                             sum((item.cost_numerator for item in same_currency), Decimal(0)))

    def test_mismatched_cost_usage_identity_is_not_ranked(self):
        wrong = CostRecord(self.a.provider_id, Decimal("99"), "USD", T0, "bad", SOURCE,
                           model="other", usage_id=self.a.usage_id)
        self.assertEqual(self.result((self.a,), (wrong,)).model_actual_cost_ranking, ())

    def test_period_is_half_open(self):
        at_end = usage("end", "deepseek", "v4", 999, at=T1)
        self.assertEqual(self.result((self.a, at_end), ()).coverage.total_tokens, 60)

    def test_named_four_way_shares_and_subscription_cost_unavailable(self):
        model = model_to_attribution((self.a, self.b), (cost(self.a, "6"), cost(self.b, "4")),
                                     provider_id="deepseek", model="v4", start=T0, end=T1,
                                     billing_mode=BillingMode.API_USAGE)
        self.assertEqual(model.rows[0].task_share_of_model_token, Decimal("0.6"))
        self.assertEqual(model.rows[0].task_share_of_model_cost, Decimal("0.6"))
        task = task_to_models((self.a, self.c), (cost(self.a, "6"), cost(self.c, "20")),
                              project_id="p1", task_id="t1", start=T0, end=T1,
                              billing_mode=BillingMode.SUBSCRIPTION)
        self.assertEqual(task.rows[0].model_share_of_task_token, Decimal("0.375"))
        self.assertIsNone(task.rows[0].model_share_of_task_cost)


if __name__ == "__main__":
    unittest.main()
