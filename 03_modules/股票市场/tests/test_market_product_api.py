from pathlib import Path
import json,sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.application import MarketReadAPI
from nexa_market.application.models import ReadInputs
from nexa_market.evidence import InMemoryEvidenceRepository
from nexa_market.fixtures import AI_RESEARCH_RESULT,FUNDAMENTAL_SUMMARY,MARKET_EVENT,NOW,RISK_ALERT,US_QUOTE,US_SHARE
from nexa_market.journal import InMemoryDecisionJournalRepository
from nexa_market.product import MarketProductAPI,WatchlistQuery
from nexa_market.repositories import InMemoryObservationRepository,InMemoryPositionRepository,InMemoryWatchlistRepository
from nexa_market.research import InMemoryResearchRepository
from nexa_market.repositories import LocalObservationRepository,LocalPositionRepository,LocalWatchlistRepository
import tempfile
from nexa_market.state_fixtures import KNOWN_INSTRUMENTS,OBSERVATION_HISTORY,PROFIT_POSITION,WATCHLIST_NORMAL
from tests.test_decision_journal import entry
from tests.test_evidence_pack import record
from tests.test_research_repository import revision
class ProductAPITests(unittest.TestCase):
    def api(self,empty=False):
        w=InMemoryWatchlistRepository();p=InMemoryPositionRepository();o=InMemoryObservationRepository();e=InMemoryEvidenceRepository();r=InMemoryResearchRepository();j=InMemoryDecisionJournalRepository()
        if not empty:
            w.add(WATCHLIST_NORMAL);p.add(PROFIT_POSITION)
            for x in OBSERVATION_HISTORY:o.add(x)
            e.append(record("evidence.a","fixture.a","100"));e.append(record("evidence.b","fixture.b","120"));r.append(revision());j.append(entry())
        read=MarketReadAPI(w,p,o,KNOWN_INSTRUMENTS,evidence_repository=e,research_repository=r,journal_repository=j);return MarketProductAPI(read,KNOWN_INSTRUMENTS,evidence_repository=e,research_repository=r,journal_repository=j)
    def inputs(self):return ReadInputs(NOW,quotes=(US_QUOTE,),risks=(RISK_ALERT,),fundamentals=(FUNDAMENTAL_SUMMARY,),events=(MARKET_EVENT,))
    def test_home_watchlist_portfolio_are_plain_json_products(self):
        api=self.api();home=api.market_home(self.inputs());watch=api.watchlist(self.inputs(),WatchlistQuery(attention_only=True));portfolio=api.portfolio(self.inputs());self.assertTrue(home["ok"] and watch["ok"] and portfolio["ok"]);self.assertEqual("今天最需要知道什么",home["data"]["page_title"]);self.assertTrue(watch["data"]["items"][0]["attention_required"]);self.assertEqual("100.00",portfolio["data"]["positions"][0]["allocation_within_currency_percent"]);self.assertTrue(all(x in {item.value for item in __import__('nexa_market.product.models',fromlist=['ProductAction']).ProductAction} for x in home["data"]["allowed_actions"]));json.dumps((home,watch,portfolio),ensure_ascii=False)
    def test_detail_has_nine_user_question_sections(self):
        data=self.api().instrument_detail(US_SHARE.instrument_id,self.inputs())["data"];self.assertEqual({"header","my_relationship","beginner_summary","fundamentals","events","risks","research","evidence","history"},set(data)&{"header","my_relationship","beginner_summary","fundamentals","events","risks","research","evidence","history"});self.assertEqual(11,len(data["fundamentals"]["cards"]));self.assertEqual(6,len(data["beginner_summary"]["questions"]));json.dumps(data,ensure_ascii=False)
    def test_research_center_and_journal_are_product_ready(self):
        api=self.api();center=api.research_center(NOW);journal=api.decision_journal(NOW);self.assertTrue(center["ok"] and journal["ok"]);self.assertEqual(1,len(center["data"]["published"]));self.assertEqual(1,len(journal["data"]["entries"]))
    def test_legacy_research_is_explicitly_partial_and_never_silently_invented(self):
        base=self.api();api=MarketProductAPI(base._read,KNOWN_INSTRUMENTS,legacy_research=(AI_RESEARCH_RESULT,));legacy=api.research_center(NOW)["data"]["legacy_migration"];self.assertTrue(legacy["exists"]);self.assertEqual("PARTIAL",legacy["status"]);self.assertEqual(1,legacy["projected_research_count"]);self.assertTrue(legacy["diagnostics"])
    def test_first_open_has_plain_empty_states_not_zero_fabrication(self):
        api=self.api(empty=True);inputs=ReadInputs(NOW);self.assertIn("还没有",api.watchlist(inputs)["data"]["empty_state"]["title"]);self.assertIn("还没有",api.portfolio(inputs)["data"]["empty_state"]["title"]);self.assertIn("还没有",api.research_center(NOW)["data"]["empty_state"]["title"])
    def test_damaged_core_store_returns_sanitized_product_problem(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp).resolve()/"private-store.json";path.write_text("{",encoding="utf-8");read=MarketReadAPI(LocalWatchlistRepository(path),LocalPositionRepository(path),LocalObservationRepository(path),KNOWN_INSTRUMENTS);payload=MarketProductAPI(read,KNOWN_INSTRUMENTS).watchlist(ReadInputs(NOW));encoded=json.dumps(payload,ensure_ascii=False);self.assertFalse(payload["ok"]);self.assertEqual("product.local-data-unavailable",payload["problem"]["problem_id"]);self.assertNotIn(str(path),encoded);self.assertNotIn("RepositoryError",encoded)
    def test_product_output_has_no_mutable_reference_leakage(self):
        api=self.api();first=api.market_home(self.inputs());first["data"]["watchlist_preview"].clear();second=api.market_home(self.inputs());self.assertTrue(second["data"]["watchlist_preview"])
if __name__=="__main__":unittest.main()
