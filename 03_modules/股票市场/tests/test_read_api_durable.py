from __future__ import annotations
from pathlib import Path
import json,sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.application import MarketReadAPI
from nexa_market.application.models import DecisionJournalQuery,ReadInputs,ResearchQuery
from nexa_market.cache import CacheDataType,InMemoryMarketCache
from nexa_market.evidence import InMemoryEvidenceRepository
from nexa_market.fixtures import NOW,US_SHARE
from nexa_market.journal import InMemoryDecisionJournalRepository
from nexa_market.repositories import InMemoryObservationRepository,InMemoryPositionRepository,InMemoryWatchlistRepository
from nexa_market.research import InMemoryResearchRepository, LocalResearchRepository
import tempfile
from nexa_market.state_fixtures import KNOWN_INSTRUMENTS
from tests.test_decision_journal import entry
from tests.test_evidence_pack import record
from tests.test_local_market_cache import item
from tests.test_research_repository import revision
class DurableReadTests(unittest.TestCase):
    def api(self):
        evidence=InMemoryEvidenceRepository((record("evidence.read","fixture.read","100"),));research=InMemoryResearchRepository();research.append(revision());journal=InMemoryDecisionJournalRepository();journal.append(entry());cache=InMemoryMarketCache();cache.append(item())
        return MarketReadAPI(InMemoryWatchlistRepository(),InMemoryPositionRepository(),InMemoryObservationRepository(),KNOWN_INSTRUMENTS,evidence_repository=evidence,research_repository=research,journal_repository=journal,market_cache=cache)
    def test_detail_contains_durable_summaries_without_ui_join(self):
        data=self.api().instrument_detail(US_SHARE.instrument_id,ReadInputs(NOW))["data"];self.assertEqual("AVAILABLE",data["availability"]["evidence"]);self.assertEqual(1,data["durable_research"]["history_count"]);self.assertEqual(1,data["decision_journal"]["active_count"]);self.assertEqual("FRESH",data["cache"]["items"][0]["freshness"]);json.dumps(data,ensure_ascii=False,sort_keys=True)
    def test_research_and_journal_queries_are_versioned_paginated_json(self):
        api=self.api();r=api.query_research(ResearchQuery(instrument_id=US_SHARE.instrument_id,limit=1),generated_at=NOW);j=api.query_decision_journal(DecisionJournalQuery(status="ACTIVE"),generated_at=NOW);self.assertTrue(r["ok"]);self.assertEqual(1,r["data"]["total_count"]);self.assertTrue(j["ok"]);self.assertEqual(1,j["data"]["total_count"]);json.dumps((r,j),ensure_ascii=False)
    def test_home_exposes_attention_counts(self):
        attention=self.api().market_home(ReadInputs(NOW))["data"]["research_attention"];self.assertEqual(1,attention["latest_research_count"]);self.assertGreaterEqual(attention["missing_quote_cache_count"],1)
    def test_damaged_durable_repository_returns_stable_error_envelope(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp).resolve()/"broken.json";path.write_text("{",encoding="utf-8");api=MarketReadAPI(InMemoryWatchlistRepository(),InMemoryPositionRepository(),InMemoryObservationRepository(),KNOWN_INSTRUMENTS,research_repository=LocalResearchRepository(path));payload=api.query_research(ResearchQuery(),generated_at=NOW);self.assertFalse(payload["ok"]);self.assertEqual("CORE_STATE_UNAVAILABLE",payload["error"]["code"])
if __name__=="__main__":unittest.main()
