from __future__ import annotations
from pathlib import Path
import json,sys,tempfile,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.application import MarketReadAPI,MarketResearchApplication,ResearchTask
from nexa_market.application.models import DecisionJournalQuery,ReadInputs,ResearchQuery
from nexa_market.cache import CacheDataType,CacheItem,FreshnessPolicy,FreshnessRule,LocalMarketCache
from nexa_market.domain import Freshness,ProvenanceKind,WatchlistItem
from nexa_market.evidence import EvidenceRecord,LocalEvidenceRepository
from nexa_market.fixtures import FUNDAMENTAL_SUMMARY,MARKET_EVENT,NOW,RISK_ALERT,US_QUOTE,provenance
from nexa_market.journal import DecisionJournalEntry,JournalStatus,LocalDecisionJournalRepository
from nexa_market.product import MarketProductAPI
from nexa_market.repositories import LocalObservationRepository,LocalPositionRepository,LocalWatchlistRepository
from nexa_market.research import EvidenceKind,LocalResearchRepository,ResearchLifecycle
from nexa_market.state_fixtures import KNOWN_INSTRUMENTS,MULTI_CURRENCY_POSITIONS,OBSERVATION_HISTORY,WATCHLIST_NORMAL

class LocalProductSmokeTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
    def tearDown(self):self.temp.cleanup()
    def repositories(self):
        core=self.root/"core.json";return LocalWatchlistRepository(core),LocalPositionRepository(core),LocalObservationRepository(core),LocalEvidenceRepository(self.root/"evidence.json"),LocalResearchRepository(self.root/"research.json"),LocalDecisionJournalRepository(self.root/"journal.json"),LocalMarketCache(self.root/"cache.json")
    def seed(self):
        watch,positions,observations,evidence,research,journal,cache=self.repositories();watch.add(WATCHLIST_NORMAL)
        for x in MULTI_CURRENCY_POSITIONS:positions.add(x)
        for x in OBSERVATION_HISTORY:observations.add(x)
        for i,(source,value,fresh) in enumerate((("fixture.a","100",Freshness.END_OF_DAY),("fixture.b","120",Freshness.STALE))):
            p=provenance(source,ProvenanceKind.FUNDAMENTAL,freshness=fresh);evidence.append(EvidenceRecord(f"evidence.smoke.{i}",WATCHLIST_NORMAL.instrument.instrument_id,"revenue.fy2025",EvidenceKind.FUNDAMENTAL,value,"USD",NOW,NOW,source,p,fresh))
        policy=FreshnessPolicy("policy.smoke",(FreshnessRule(CacheDataType.QUOTE,60,"quote.rule"),));cache.append(CacheItem("cache.smoke.quote",WATCHLIST_NORMAL.instrument.instrument_id,CacheDataType.QUOTE,"fixture.market-feed",NOW,NOW,policy.expires_at(CacheDataType.QUOTE,NOW),{"price":"120"},"fixture://raw/smoke","v1",US_QUOTE.provenance,"quote.rule"))
        app=MarketResearchApplication(evidence,research,journal);pack=app.build_evidence_pack(pack_id="pack.smoke",instrument_id=WATCHLIST_NORMAL.instrument.instrument_id,as_of=NOW,generated_at=NOW,quotes=(US_QUOTE,),fundamentals=(FUNDAMENTAL_SUMMARY,),events=(MARKET_EVENT,),watchlist=watch.list_all(),positions=positions.list_all(),observations=observations.list_all());draft=app.create_research_draft_from_input(pack,ResearchTask("task.smoke",pack.instrument_id,NOW,"Offline smoke",("evidence.smoke.0",),("evidence.smoke.1",)));saved=app.persist_research(draft,pack,lifecycle=ResearchLifecycle.PUBLISHED,recorded_at=NOW);entry=DecisionJournalEntry("journal.smoke.revision.1","journal.smoke",pack.instrument_id,1,NOW,"Review the fixture evidence","A local conflict needs attention",("Fixtures are comparable",),("evidence.smoke.0",),("evidence.smoke.1",),("Future reports unknown",),("New report resolves conflict",),("Review later filing",),JournalStatus.ACTIVE,(saved.revision_id,),MULTI_CURRENCY_POSITIONS[0].position_id,"本地产品冒烟",provenance("fixture.user",ProvenanceKind.USER_RECORDED));app.create_decision_journal(entry);return pack,saved,entry
    def api(self):
        watch,positions,observations,evidence,research,journal,cache=self.repositories();return MarketReadAPI(watch,positions,observations,KNOWN_INSTRUMENTS,evidence_repository=evidence,research_repository=research,journal_repository=journal,market_cache=cache)
    def product_api(self):
        watch,positions,observations,evidence,research,journal,cache=self.repositories();read=MarketReadAPI(watch,positions,observations,KNOWN_INSTRUMENTS,evidence_repository=evidence,research_repository=research,journal_repository=journal,market_cache=cache);return MarketProductAPI(read,KNOWN_INSTRUMENTS,evidence_repository=evidence,research_repository=research,journal_repository=journal)
    def test_full_local_chain_and_restart_integrity(self):
        pack,saved,entry=self.seed();api=self.api();detail=api.instrument_detail(pack.instrument_id,ReadInputs(NOW,quotes=(US_QUOTE,),fundamentals=(FUNDAMENTAL_SUMMARY,),events=(MARKET_EVENT,)));research=api.query_research(ResearchQuery(instrument_id=pack.instrument_id),generated_at=NOW);journal=api.query_decision_journal(DecisionJournalQuery(instrument_id=pack.instrument_id),generated_at=NOW);home=api.market_home(ReadInputs(NOW,quotes=(US_QUOTE,)))
        self.assertTrue(detail["ok"] and research["ok"] and journal["ok"] and home["ok"]);self.assertEqual(saved.revision_id,research["data"]["items"][0]["revision_id"]);self.assertEqual(entry.revision_id,journal["data"]["items"][0]["revision_id"]);self.assertEqual("EVIDENCE_CONFLICT",pack.data_quality.conflicts[0].status.value);self.assertEqual("FRESH",detail["data"]["cache"]["items"][0]["freshness"]);json.dumps((detail,research,journal,home),ensure_ascii=False,sort_keys=True)
    def test_beginner_product_chain_is_identical_after_repository_restart(self):
        pack,_,_=self.seed();inputs=ReadInputs(NOW,quotes=(US_QUOTE,),risks=(RISK_ALERT,),fundamentals=(FUNDAMENTAL_SUMMARY,),events=(MARKET_EVENT,))
        def snapshot(api):
            detail=api.instrument_detail(pack.instrument_id,inputs);value={"home":api.market_home(inputs),"watchlist":api.watchlist(inputs),"portfolio":api.portfolio(inputs),"detail":detail,"research":api.research_center(NOW),"journal":api.decision_journal(NOW)}
            self.assertTrue(all(item["ok"] for item in value.values()));self.assertEqual(11,len(detail["data"]["fundamentals"]["cards"]));self.assertTrue(detail["data"]["research"]["latest"]);self.assertTrue(detail["data"]["evidence"]["items"]);self.assertTrue(detail["data"]["history"]["journal"]);self.assertTrue(detail["data"]["risks"]["items"]);json.dumps(value,ensure_ascii=False,sort_keys=True);return value
        before=snapshot(self.product_api());after=snapshot(self.product_api());self.assertEqual(before,after)
if __name__=="__main__":unittest.main()
