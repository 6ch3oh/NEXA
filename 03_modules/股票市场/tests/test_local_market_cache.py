from __future__ import annotations
from datetime import timedelta
from pathlib import Path
import json,sys,tempfile,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.cache import CacheDataType,CacheFreshness,CacheItem,FreshnessPolicy,FreshnessRule,InMemoryMarketCache,LocalMarketCache
from nexa_market.fixtures import NOW,QUOTE_SOURCE,US_SHARE
from nexa_market.repositories import RecordWriteResult
POLICY=FreshnessPolicy("policy.fixture.v1",(FreshnessRule(CacheDataType.QUOTE,60,"quote.rule"),FreshnessRule(CacheDataType.FUNDAMENTAL,86400,"fundamental.rule")))
def item():return CacheItem("cache.quote.1",US_SHARE.instrument_id,CacheDataType.QUOTE,"fixture.market-feed",NOW,NOW,POLICY.expires_at(CacheDataType.QUOTE,NOW),{"price":"120","volume":None},"fixture://raw/quote-1","normalize-v1",QUOTE_SOURCE,"quote.rule")
class Contract:
    def repo(self):raise NotImplementedError
    def test_offline_fresh_stale_missing_and_identity(self):
        repo=self.repo();x=item();self.assertEqual(RecordWriteResult.CREATED,repo.append(x));self.assertEqual(CacheFreshness.FRESH,repo.latest(US_SHARE.instrument_id,CacheDataType.QUOTE,NOW).status);self.assertEqual(CacheFreshness.STALE,repo.latest(US_SHARE.instrument_id,CacheDataType.QUOTE,NOW+timedelta(seconds=61)).status);self.assertEqual(CacheFreshness.MISSING,repo.latest(US_SHARE.instrument_id,CacheDataType.NEWS,NOW).status);self.assertEqual(RecordWriteResult.UNCHANGED,repo.append(x))
class MemoryTests(Contract,unittest.TestCase):
    def repo(self):return InMemoryMarketCache()
class LocalTests(Contract,unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name).resolve()/"缓存.json"
    def tearDown(self):self.temp.cleanup()
    def repo(self):return LocalMarketCache(self.path)
    def test_restart_preserves_raw_normalized_and_provenance(self):
        self.repo().append(item());loaded=self.repo().get("cache.quote.1");self.assertEqual(item(),loaded);self.assertEqual("fixture://raw/quote-1",loaded.raw_reference);self.assertEqual("120",loaded.normalized_data["price"])
    def test_unknown_record_field_is_rejected_with_partial_diagnostic(self):
        self.repo().append(item());payload=json.loads(self.path.read_text(encoding="utf-8"));payload["records"][0]["unknown_field"]=True;self.path.write_text(json.dumps(payload),encoding="utf-8");loaded=self.repo().load_result();self.assertEqual("PARTIALLY_INVALID",loaded.status);self.assertEqual(1,loaded.rejected_count)
if __name__=="__main__":unittest.main()
