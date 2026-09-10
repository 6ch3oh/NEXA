from __future__ import annotations
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
import sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.application import MarketResearchApplication,ResearchTask
from nexa_market.application.research_workflow import WorkflowError, WorkflowErrorCode
from nexa_market.domain import ProvenanceKind
from nexa_market.evidence import InMemoryEvidenceRepository
from nexa_market.fixtures import FUNDAMENTAL_SUMMARY,MARKET_EVENT,NOW,US_QUOTE,US_SHARE,provenance
from nexa_market.journal import DecisionJournalEntry,DecisionOutcome,InMemoryDecisionJournalRepository,JournalStatus
from nexa_market.research import InMemoryResearchRepository,ResearchLifecycle
from tests.test_evidence_pack import record
class WorkflowTests(unittest.TestCase):
    def setUp(self):self.evidence=InMemoryEvidenceRepository((record("evidence.a","fixture.a","100"),record("evidence.b","fixture.b","100")));self.research=InMemoryResearchRepository();self.journal=InMemoryDecisionJournalRepository();self.app=MarketResearchApplication(self.evidence,self.research,self.journal)
    def pack(self):return self.app.build_evidence_pack(pack_id="pack.workflow",instrument_id=US_SHARE.instrument_id,as_of=NOW,generated_at=NOW,quotes=(US_QUOTE,),fundamentals=(FUNDAMENTAL_SUMMARY,),events=(MARKET_EVENT,))
    def test_evidence_to_draft_quality_publish_and_history(self):
        pack=self.pack();task=ResearchTask("task.fixture",US_SHARE.instrument_id,NOW,"Understand the local fixture",("evidence.a",),("evidence.b",));draft=self.app.create_research_draft_from_input(pack,task);quality=self.app.validate_research(draft,pack);self.assertNotEqual("FAIL",quality.outcome);saved=self.app.persist_research(draft,pack,lifecycle=ResearchLifecycle.PUBLISHED,recorded_at=NOW);self.assertEqual(saved,self.app.get_latest_research(US_SHARE.instrument_id));self.assertEqual((saved,),self.app.get_research_history(US_SHARE.instrument_id))
    def test_conflicting_pack_produces_quality_warning(self):
        self.evidence.append(record("evidence.c","fixture.c","120"));pack=self.pack();draft=self.app.create_research_draft_from_input(pack,ResearchTask("task.conflict",US_SHARE.instrument_id,NOW,"Conflict review",("evidence.a",),("evidence.b",)));self.assertIn("EVIDENCE_CONFLICT",{x.code.value for x in self.app.validate_research(draft,pack).issues})
    def test_single_evidence_cannot_fake_counter_case_or_publish(self):
        evidence=InMemoryEvidenceRepository((record("evidence.only","fixture.only","100"),));app=MarketResearchApplication(evidence,InMemoryResearchRepository(),InMemoryDecisionJournalRepository());pack=app.build_evidence_pack(pack_id="pack.single",instrument_id=US_SHARE.instrument_id,as_of=NOW,generated_at=NOW);draft=app.create_research_draft_from_input(pack,ResearchTask("task.single",US_SHARE.instrument_id,NOW,"Single source"));self.assertEqual((),draft.claims[1].counter_evidence_refs);self.assertEqual("FAIL",app.validate_research(draft,pack).outcome)
        with self.assertRaises(WorkflowError) as raised:app.persist_research(draft,pack,lifecycle=ResearchLifecycle.PUBLISHED,recorded_at=NOW)
        self.assertEqual(WorkflowErrorCode.QUALITY_FAILED,raised.exception.code)
    def test_create_and_review_journal_preserves_original_thesis(self):
        entry=DecisionJournalEntry("journal.app.revision.1","journal.app",US_SHARE.instrument_id,1,NOW,"Original thesis","Needs review",("Comparable periods",),("evidence.a",),("evidence.b",),("Unknown future",),("Contradicting filing",),("Next report",),JournalStatus.ACTIVE,(),None,None,provenance("fixture.user",ProvenanceKind.USER_RECORDED));self.app.create_decision_journal(entry);outcome=DecisionOutcome(NOW+timedelta(days=1),"Evidence changed",False,("Comparable periods",),("evidence.c",),("Source gap",),("Compare sources",),Decimal("0.3"));reviewed=self.app.review_decision_journal("journal.app",outcome,recorded_at=NOW+timedelta(days=1));self.assertEqual("Original thesis",reviewed.thesis);self.assertEqual(entry.revision_id,reviewed.supersedes)
if __name__=="__main__":unittest.main()
