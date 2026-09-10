from __future__ import annotations
from datetime import timedelta
from decimal import Decimal
import json
from pathlib import Path
import sys,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from nexa_market.application import MarketReadAPI
from nexa_market.cache import CacheDataType,FreshnessPolicy,FreshnessRule,LocalMarketCache
from nexa_market.domain import AssetType,WatchlistItem
from nexa_market.evidence import LocalEvidenceRepository,MarketEvidencePackBuilder,PackAvailability
from nexa_market.fixtures import instrument
from nexa_market.ingestion.consumer import CachedMarketDataConsumer
from nexa_market.ingestion.contracts import RawAcquisitionType
from nexa_market.ingestion.pipeline import MarketDataIngestionPipeline
from nexa_market.product import MarketProductAPI
from nexa_market.providers import InstrumentIdentityResolver
from nexa_market.providers.sec_capture import load_sec_capture
from nexa_market.providers.sec_edgar import APPLE_PILOT_INSTRUMENT_ID,SecEdgarCaptureAdapter,apple_pilot_identity
from nexa_market.providers.yahoo_capture import YahooChartCaptureAdapter,YAHOO_CAPTURE_TRANSFORM_VERSION
from nexa_market.providers.yahoo_capture_file import load_yahoo_capture
from nexa_market.providers.yahoo_chart import PROVIDER_ID,YahooChartBinding
from nexa_market.repositories import InMemoryObservationRepository,InMemoryPositionRepository,InMemoryWatchlistRepository

CAP=ROOT/"tests"/"raw_fixtures"/"yahoo_chart_real";SEC=ROOT/"tests"/"raw_fixtures"/"sec_edgar_real"
QUOTE=CAP/"apple_quote_capture.json";HISTORY=CAP/"apple_price_history_capture.json"
APPLE=instrument(APPLE_PILOT_INSTRUMENT_ID,"AAPL","XNAS",AssetType.STOCK,"Apple Inc.","USD","US")
POLICY=FreshnessPolicy("policy.yahoo-real-pilot.v1",tuple(FreshnessRule(k,s,f"freshness.yahoo-real.{k.value.lower()}.v1") for k,s in ((CacheDataType.QUOTE,300),(CacheDataType.PRICE_HISTORY,172800),(CacheDataType.FUNDAMENTAL,7776000),(CacheDataType.FUNDAMENTAL_FACT,31536000),(CacheDataType.FILING,31536000))))
def yahoo_adapter():return YahooChartCaptureAdapter(YahooChartBinding(APPLE.instrument_id,"AAPL","AAPL","NMS","US",AssetType.STOCK,"Apple Inc.","USD"))
def sec_adapter():return SecEdgarCaptureAdapter(InstrumentIdentityResolver((apple_pilot_identity(),)))
def json_keys(value):
 if isinstance(value,dict):return set(value).union(*(json_keys(x) for x in value.values()))
 if isinstance(value,(list,tuple)):return set().union(*(json_keys(x) for x in value))
 return set()

class YahooRealPilotTests(unittest.TestCase):
 def test_sealed_captures_replay_to_canonical_quote_and_history(self):
  q=load_yahoo_capture(QUOTE.resolve());h=load_yahoo_capture(HISTORY.resolve());self.assertEqual(RawAcquisitionType.REAL_PROVIDER_CAPTURE,q.acquisition_type);self.assertFalse(q.synthetic);self.assertEqual("dda8aece555c7fcb3d37aa275e03ea7ce4618b97839aecd2c60d09e4afc06e99",q.raw_sha256);self.assertEqual("78848190cd2aa1d39543f2260549c0e7746cab2877cbffe2a221e3f8b2110391",h.raw_sha256)
  instrument_id,qb=yahoo_adapter().normalize(q);quote=qb.quotes[0];self.assertEqual(APPLE.instrument_id,instrument_id);self.assertEqual(Decimal("305.26"),quote.price);self.assertEqual("USD",quote.currency);self.assertEqual("UNKNOWN",quote.data_delay.kind.value);self.assertEqual("UNKNOWN",quote.market_status.value);self.assertEqual(YAHOO_CAPTURE_TRANSFORM_VERSION,quote.provenance.transform_version)
  _,hb=yahoo_adapter().normalize(h);self.assertEqual(5,len(hb.price_history));self.assertEqual(sorted(x.period_end for x in hb.price_history),[x.period_end for x in hb.price_history]);self.assertTrue(all(x.currency=="USD" and x.close>0 and x.provenance.raw_reference.startswith("capture://yahoo/") for x in hb.price_history))
 def test_capture_seal_rejects_payload_tampering(self):
  value=json.loads(QUOTE.read_text(encoding="utf-8"));value["payload"]["chart"]["result"][0]["meta"]["symbol"]="NOT-AAPL"
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp).resolve()/"tampered.json";path.write_text(json.dumps(value),encoding="utf-8")
   with self.assertRaisesRegex(ValueError,"hash mismatch"):load_yahoo_capture(path)
 def test_real_capture_cache_evidence_product_and_restart(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp).resolve();cache=LocalMarketCache(root/"cache.json");evidence=LocalEvidenceRepository(root/"evidence.json");pipeline=MarketDataIngestionPipeline(yahoo_adapter(),cache,evidence,POLICY);q=load_yahoo_capture(QUOTE.resolve());h=load_yahoo_capture(HISTORY.resolve());qo=pipeline.ingest(q);ho=pipeline.ingest(h);self.assertEqual((1,1),(qo.receipt.cache_writes,qo.receipt.evidence_writes));self.assertEqual((5,5),(ho.receipt.cache_writes,ho.receipt.evidence_writes));again=pipeline.ingest(q);self.assertEqual((0,0),(again.receipt.cache_writes,again.receipt.evidence_writes))
   sec=MarketDataIngestionPipeline(sec_adapter(),cache,evidence,POLICY)
   for name in ("apple_submissions_capture.json","apple_companyfacts_capture.json"):self.assertFalse(sec.ingest(load_sec_capture((SEC/name).resolve())).receipt.errors)
   cache=LocalMarketCache(root/"cache.json");evidence=LocalEvidenceRepository(root/"evidence.json");generated=max(q.received_at,h.received_at);inputs=CachedMarketDataConsumer(cache).read_inputs((APPLE.instrument_id,),generated_at=generated,real_product_mode=True);self.assertEqual(Decimal("305.26"),inputs.quotes[0].price);self.assertEqual(1,len(inputs.fundamentals));qe=next(x for x in evidence.list_by_instrument(APPLE.instrument_id) if x.source==PROVIDER_ID and x.kind.value=="QUOTE");self.assertEqual("REAL_PROVIDER_CAPTURE",qe.lineage["data_reality"]);self.assertEqual(q.raw_sha256,qe.lineage["raw_sha256"])
   pack=MarketEvidencePackBuilder().build(pack_id="pack.yahoo.apple.real",instrument_id=APPLE.instrument_id,as_of=generated,generated_at=generated,quotes=inputs.quotes,fundamentals=inputs.fundamentals,events=inputs.events,evidence=evidence.list_by_instrument(APPLE.instrument_id));self.assertNotEqual(PackAvailability.MISSING,pack.data_quality.completeness);self.assertNotIn("quote",pack.data_quality.missing_components)
   watch=InMemoryWatchlistRepository();watch.add(WatchlistItem(APPLE,generated));read=MarketReadAPI(watch,InMemoryPositionRepository(),InMemoryObservationRepository(),(APPLE,),market_cache=cache,evidence_repository=evidence);product=MarketProductAPI(read,(APPLE,),evidence_repository=evidence);detail=product.instrument_detail(APPLE.instrument_id,inputs);self.assertEqual("305.26",detail["data"]["header"]["price"]["raw_value"]);self.assertEqual("UNKNOWN",detail["data"]["header"]["delay_kind"]);self.assertEqual("UNKNOWN",detail["data"]["header"]["market_status"]);self.assertEqual("AVAILABLE",detail["data"]["price_history"]["availability"]);self.assertEqual(5,detail["data"]["price_history"]["range"]["point_count"]);projection=json.dumps(detail,ensure_ascii=False,sort_keys=True)
   self.assertTrue({"regularMarketPrice","exchangeDataDelayedBy","indicators","chart"}.isdisjoint(json_keys(detail)))
   stale=CachedMarketDataConsumer(cache).read_inputs((APPLE.instrument_id,),generated_at=generated+timedelta(hours=1),real_product_mode=True);stale_detail=product.instrument_detail(APPLE.instrument_id,stale);self.assertEqual("STALE",stale_detail["data"]["header"]["freshness"]);self.assertEqual("305.26",stale_detail["data"]["header"]["price"]["raw_value"]);self.assertEqual(1,len(stale.fundamentals))

if __name__=="__main__":unittest.main()
