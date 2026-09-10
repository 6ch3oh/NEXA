from __future__ import annotations
from dataclasses import replace
from pathlib import Path
import sys,tempfile,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.fixtures import NOW,US_SHARE
from nexa_market.repositories import RecordWriteResult
from nexa_market.research import InMemoryResearchRepository,LocalResearchRepository,ResearchLifecycle,ResearchQualityGate,ResearchRevision
from tests.test_beginner_research import valid_research
def revision(n=1,supersedes=None,lifecycle=ResearchLifecycle.PUBLISHED):
    r=replace(valid_research(),research_id=f"research.history.{n}");return ResearchRevision(f"revision.history.{n}",r,n,lifecycle,ResearchQualityGate().evaluate(r),NOW,supersedes)
class Contract:
    def repo(self):raise NotImplementedError
    def test_history_is_append_only_and_latest_is_revision_aware(self):
        repo=self.repo();one=revision();two=revision(2,one.revision_id);self.assertEqual(RecordWriteResult.CREATED,repo.append(one));self.assertEqual(RecordWriteResult.CREATED,repo.append(two));self.assertEqual(two,repo.latest(US_SHARE.instrument_id));self.assertEqual((one,two),repo.list_by_instrument(US_SHARE.instrument_id));self.assertEqual(RecordWriteResult.IDENTITY_CONFLICT,repo.append(replace(one,lifecycle=ResearchLifecycle.DRAFT)))
    def test_broken_lineage_is_explicit_conflict(self):
        repo=self.repo();one=revision();repo.append(one);self.assertEqual(RecordWriteResult.IDENTITY_CONFLICT,repo.append(revision(3,one.revision_id)))
class MemoryTests(Contract,unittest.TestCase):
    def repo(self):return InMemoryResearchRepository()
class LocalTests(Contract,unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name).resolve()/"研究.json"
    def tearDown(self):self.temp.cleanup()
    def repo(self):return LocalResearchRepository(self.path)
    def test_restart_preserves_quality_evidence_and_lineage(self):
        one=revision();two=revision(2,one.revision_id);self.repo().append(one);self.repo().append(two);loaded=self.repo().latest(US_SHARE.instrument_id);self.assertEqual(two,loaded);self.assertEqual(two.research.evidence,loaded.research.evidence);self.assertEqual(two.quality,loaded.quality)
if __name__=="__main__":unittest.main()
