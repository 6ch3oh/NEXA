from __future__ import annotations
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
import json,sys,tempfile,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.domain import ProvenanceKind
from nexa_market.fixtures import NOW,US_SHARE,provenance
from nexa_market.journal import DecisionJournalEntry,DecisionOutcome,InMemoryDecisionJournalRepository,JournalStatus,LocalDecisionJournalRepository
from nexa_market.repositories import RecordWriteResult
def entry(n=1,supersedes=None,outcome=None,status=JournalStatus.ACTIVE):return DecisionJournalEntry(f"journal-revision.1.{n}","journal.1",US_SHARE.instrument_id,n,NOW,"The evidence supports continued attention.","A reported change requires review.",( "Reported periods remain comparable.",),("evidence.a",),("evidence.b",),("Future evidence is unknown.",),("A later filing contradicts the thesis.",),("Review the next filing.",),status,("revision.history.1",),None,"用户记录",provenance("fixture.user",ProvenanceKind.USER_RECORDED),outcome,supersedes)
class Contract:
    def repo(self):raise NotImplementedError
    def test_append_only_revision_and_review(self):
        repo=self.repo();one=entry();outcome=DecisionOutcome(NOW+timedelta(days=1),"Later evidence weakened the thesis.",False,("Reported periods remain comparable.",),("evidence.c",),("A source limitation.",),("Record source differences.",),Decimal("0.3"));two=entry(2,one.revision_id,outcome,JournalStatus.REVIEWED);self.assertEqual(RecordWriteResult.CREATED,repo.append(one));self.assertEqual(RecordWriteResult.CREATED,repo.append(two));self.assertEqual(two,repo.latest("journal.1"));self.assertEqual(RecordWriteResult.IDENTITY_CONFLICT,repo.append(replace(one,thesis="rewritten history")))
    def test_broken_lineage_rejected(self):
        repo=self.repo();repo.append(entry());self.assertEqual(RecordWriteResult.IDENTITY_CONFLICT,repo.append(entry(3,"journal-revision.1.1")))
class MemoryTests(Contract,unittest.TestCase):
    def repo(self):return InMemoryDecisionJournalRepository()
class LocalTests(Contract,unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name).resolve()/"决策日志.json"
    def tearDown(self):self.temp.cleanup()
    def repo(self):return LocalDecisionJournalRepository(self.path)
    def test_restart_preserves_unicode_provenance_and_outcome(self):
        one=entry();self.repo().append(one);self.assertEqual(one,self.repo().latest("journal.1"));self.assertIn("用户记录",self.path.read_text(encoding="utf-8"))
    def test_unknown_record_field_is_diagnostic_not_silently_ignored(self):
        self.repo().append(entry());payload=json.loads(self.path.read_text(encoding="utf-8"));payload["records"][0]["unknown_field"]=True;self.path.write_text(json.dumps(payload,ensure_ascii=False),encoding="utf-8");loaded=self.repo().load_result();self.assertEqual("PARTIALLY_INVALID",loaded.status);self.assertEqual(0,loaded.loaded_count);self.assertEqual(1,loaded.rejected_count)
if __name__=="__main__":unittest.main()
