from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
import json
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from nexa_market.domain import Freshness  # noqa: E402
from nexa_market.fixtures import NOW, US_SHARE  # noqa: E402
from nexa_market.research import (  # noqa: E402
    AnswerStatus,
    BeginnerResearch,
    ClaimStatus,
    ClaimType,
    EvidenceKind,
    EvidenceRef,
    FinancialTerm,
    QualityCode,
    QualityOutcome,
    RESEARCH_CONTRACT_VERSION,
    ResearchClaim,
    ResearchQualityGate,
    ResearchQuestion,
    ResearchStance,
    SixQuestionAnswer,
    explain_term,
    explanation_catalog,
    project_beginner_research,
)
from nexa_market.viewmodels import to_json_compatible  # noqa: E402


def evidence(evidence_id: str = "evidence.fundamental.1", *, freshness=Freshness.END_OF_DAY) -> EvidenceRef:
    return EvidenceRef(evidence_id, EvidenceKind.FUNDAMENTAL, "fixture://fundamental/1", NOW, NOW, freshness)


def valid_research() -> BeginnerResearch:
    fact = ResearchClaim(
        "claim.fact.1", ClaimType.FACT, "Fixture revenue increased in the reported period.",
        ("evidence.fundamental.1",), (), (), Decimal("0.95"),
        "Only one normalized fixture period is available.", Freshness.END_OF_DAY, ClaimStatus.SUPPORTED,
    )
    interpretation = ResearchClaim(
        "claim.interpretation.1", ClaimType.INTERPRETATION,
        "The fixture suggests improving demand, subject to margin evidence.",
        ("evidence.fundamental.1",), (), ("claim.fact.1",), Decimal("0.70"),
        "Revenue alone does not establish profitability.", Freshness.END_OF_DAY, ClaimStatus.SUPPORTED,
    )
    thesis = ResearchClaim(
        "claim.thesis.1", ClaimType.THESIS, "The available evidence supports a mixed research stance.",
        ("evidence.fundamental.1",), ("evidence.risk.1",), ("claim.fact.1",), Decimal("0.60"),
        "Future operating results are unknown.", Freshness.END_OF_DAY, ClaimStatus.SUPPORTED,
    )
    counter = ResearchClaim(
        "claim.counter.1", ClaimType.FACT, "The fixture has a material evidence limitation.",
        ("evidence.risk.1",), (), (), Decimal("0.90"),
        "The limitation may be resolved by later filings.", Freshness.STALE, ClaimStatus.SUPPORTED,
    )
    answers = tuple(
        SixQuestionAnswer(question, f"Beginner answer for {question.value}.", (fact.claim_id,), AnswerStatus.ANSWERED)
        for question in ResearchQuestion
    )
    return BeginnerResearch(
        "research.beginner.1", US_SHARE.instrument_id, NOW, answers,
        (fact, interpretation, thesis, counter),
        (evidence(), EvidenceRef("evidence.risk.1", EvidenceKind.OBSERVATION, "fixture://risk/1", NOW, NOW, Freshness.STALE)),
        (interpretation.claim_id,), (counter.claim_id,),
        ("The fixture periods are comparable.",),
        ("Later filings contradict the reported operating trend.",),
        ResearchStance.MIXED,
        "Educational research only; no executable market action is provided.",
    )


class ResearchModelTests(unittest.TestCase):
    def test_valid_contract_is_immutable_versioned_and_complete(self) -> None:
        research = valid_research()
        self.assertEqual(RESEARCH_CONTRACT_VERSION, research.contract_version)
        self.assertEqual(set(ResearchQuestion), {item.question for item in research.questions})
        with self.assertRaises(AttributeError):
            research.stance = ResearchStance.POSITIVE

    def test_confidence_is_decimal_range_not_price_probability(self) -> None:
        with self.assertRaises(ValueError):
            replace(valid_research().claims[0], confidence=Decimal("1.01"))
        projection = project_beginner_research(valid_research(), ResearchQualityGate().evaluate(valid_research()))
        self.assertIn("not probability", projection.claims[0].confidence_meaning)

    def test_fact_may_be_constructed_without_evidence_but_gate_fails_closed(self) -> None:
        research = valid_research()
        unsupported = replace(research.claims[0], evidence_refs=())
        report = ResearchQualityGate().evaluate(replace(research, claims=(unsupported, *research.claims[1:])))
        self.assertEqual(QualityOutcome.FAIL, report.outcome)
        self.assertIn(QualityCode.UNSUPPORTED_FACT, {item.code for item in report.issues})


class ExplanationTests(unittest.TestCase):
    def test_first_catalog_contains_all_required_beginner_terms(self) -> None:
        catalog = explanation_catalog()
        self.assertEqual(set(FinancialTerm), {item.term for item in catalog})
        self.assertEqual(11, len(catalog))
        for item in catalog:
            self.assertTrue(item.plain_meaning)
            self.assertTrue(item.why_it_matters)
            self.assertTrue(item.limitations)

    def test_context_aware_pe_requires_evidence_and_warns_against_single_metric_conclusion(self) -> None:
        with self.assertRaises(ValueError):
            explain_term(FinancialTerm.PE, current_context="PE is 60.")
        result = explain_term(
            FinancialTerm.PE,
            current_context="PE is 60; compare growth, industry and history before interpreting it.",
            evidence_refs=("evidence.fundamental.1",),
        )
        self.assertIn("低 PE 不等于便宜", result.limitations)
        self.assertEqual(("evidence.fundamental.1",), result.evidence_refs)


class QualityGateTests(unittest.TestCase):
    def test_balanced_research_with_stale_evidence_passes_with_warning(self) -> None:
        report = ResearchQualityGate().evaluate(valid_research())
        self.assertEqual(QualityOutcome.PASS_WITH_WARNINGS, report.outcome)
        self.assertEqual(4, report.claim_count)
        self.assertEqual(2, report.supported_fact_count)
        self.assertIn(QualityCode.STALE_EVIDENCE, {item.code for item in report.issues})

    def test_unknown_evidence_and_untraceable_interpretation_fail(self) -> None:
        research = valid_research()
        bad = replace(research.claims[1], evidence_refs=("evidence.unknown",), basis_claim_refs=())
        report = ResearchQualityGate().evaluate(replace(research, claims=(research.claims[0], bad, *research.claims[2:])))
        codes = {item.code for item in report.issues}
        self.assertEqual(QualityOutcome.FAIL, report.outcome)
        self.assertIn(QualityCode.UNKNOWN_EVIDENCE_REF, codes)
        self.assertIn(QualityCode.INTERPRETATION_NOT_TRACEABLE, codes)

    def test_interpretation_basis_must_be_a_fact_not_merely_known(self) -> None:
        research = valid_research()
        bad = replace(research.claims[1], basis_claim_refs=("claim.thesis.1",))
        report = ResearchQualityGate().evaluate(replace(research, claims=(research.claims[0], bad, *research.claims[2:])))
        self.assertEqual(QualityOutcome.FAIL, report.outcome)
        self.assertIn(QualityCode.INTERPRETATION_NOT_TRACEABLE, {item.code for item in report.issues})

    def test_actionable_language_fails_and_does_not_become_a_contract(self) -> None:
        research = valid_research()
        actionable = replace(research.claims[0], statement="Buy at the current price and set a stop loss.")
        report = ResearchQualityGate().evaluate(replace(research, claims=(actionable, *research.claims[1:])))
        self.assertEqual(QualityOutcome.FAIL, report.outcome)
        self.assertIn(QualityCode.ACTIONABLE_TRADING_INSTRUCTION, {item.code for item in report.issues})

    def test_actionable_language_in_question_or_assumption_also_fails(self) -> None:
        research = valid_research()
        question = replace(research.questions[0], answer="Execute an order after reading this answer.")
        report = ResearchQualityGate().evaluate(replace(research, questions=(question, *research.questions[1:])))
        self.assertEqual(QualityOutcome.FAIL, report.outcome)
        self.assertIn(QualityCode.ACTIONABLE_TRADING_INSTRUCTION, {item.code for item in report.issues})

    def test_projection_is_json_safe_and_has_no_action_field(self) -> None:
        research = valid_research()
        projection = project_beginner_research(
            research,
            ResearchQualityGate().evaluate(research),
            explanations=(explain_term(FinancialTerm.REVENUE),),
        )
        payload = to_json_compatible(projection)
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        self.assertIn('"projection_version": "nexa.market.research-projection.v0.1"', encoded)
        for forbidden_key in ("trade_action", "order", "execution", "broker"):
            self.assertNotIn(f'"{forbidden_key}"', encoded.lower())

    def test_missing_required_question_fails_completeness(self) -> None:
        research = valid_research()
        report = ResearchQualityGate().evaluate(replace(research, questions=research.questions[:-1]))
        self.assertEqual(QualityOutcome.FAIL, report.outcome)
        self.assertIn(QualityCode.MISSING_QUESTION, {item.code for item in report.issues})

    def test_one_sided_research_is_warning_not_silent_pass(self) -> None:
        research = valid_research()
        report = ResearchQualityGate().evaluate(replace(research, counter_claim_refs=()))
        self.assertEqual(QualityOutcome.PASS_WITH_WARNINGS, report.outcome)
        self.assertIn(QualityCode.ONE_SIDED_RESEARCH, {item.code for item in report.issues})


if __name__ == "__main__":
    unittest.main()
