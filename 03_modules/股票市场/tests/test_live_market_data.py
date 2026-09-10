from __future__ import annotations
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from decimal import Decimal
from pathlib import Path
import hashlib,json,sys,tempfile,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))

from nexa_market.application import MarketReadAPI,MarketResearchApplication,ResearchTask
from nexa_market.cache import CacheDataType,FreshnessPolicy,FreshnessRule,LocalMarketCache
from nexa_market.domain import AssetType,DataQuality,Freshness,Provenance,ProvenanceKind,WatchlistItem
from nexa_market.evidence import LocalEvidenceRepository,MarketEvidencePackBuilder,PackAvailability
from nexa_market.fixtures import instrument
from nexa_market.ingestion.consumer import CachedMarketDataConsumer
from nexa_market.ingestion.contracts import RawAcquisitionType,RawPayloadEnvelope,RawStatus
from nexa_market.ingestion.pipeline import MarketDataIngestionPipeline,canonical_payload_hash
from nexa_market.ingestion.quote_refresh import QuoteRefreshRequest,QuoteRefreshResult,QuoteRefreshService
from nexa_market.ingestion.reality import DataReality
from nexa_market.ingestion.sec_incremental import SECIncrementalRefresh,SECRefreshDisposition
from nexa_market.journal import DecisionJournalEntry,InMemoryDecisionJournalRepository,JournalStatus
from nexa_market.product import MarketProductAPI
from nexa_market.providers import InstrumentIdentityResolver,ProviderCapability
from nexa_market.providers.sec_capture import load_sec_capture
from nexa_market.providers.sec_edgar import APPLE_PILOT_INSTRUMENT_ID,SEC_PROVIDER_ID,SecEdgarCaptureAdapter,apple_pilot_identity
from nexa_market.providers.yahoo_capture import YahooChartCaptureAdapter
from nexa_market.providers.yahoo_chart import PROVIDER_ID as YAHOO_PROVIDER,YahooChartBinding
from nexa_market.repositories import InMemoryObservationRepository,InMemoryPositionRepository,InMemoryWatchlistRepository
from nexa_market.research import InMemoryResearchRepository,ResearchLifecycle

CAPTURE_ROOT=MODULE_ROOT/"tests"/"raw_fixtures"/"sec_edgar_real";YAHOO_ROOT=MODULE_ROOT/"tests"/"raw_fixtures"/"yahoo_chart"
NOW=datetime(2026,8,14,12,tzinfo=timezone.utc);APPLE=instrument(APPLE_PILOT_INSTRUMENT_ID,"AAPL","XNAS",AssetType.STOCK,"Apple Inc.","USD","US")
POLICY=FreshnessPolicy("policy.live-data.v1",tuple(FreshnessRule(kind,seconds,f"freshness.live.{kind.value.lower()}.v1") for kind,seconds in ((CacheDataType.QUOTE,300),(CacheDataType.PRICE_HISTORY,172800),(CacheDataType.FUNDAMENTAL,7776000),(CacheDataType.FUNDAMENTAL_FACT,31536000),(CacheDataType.FILING,31536000))))

def sec_adapter():return SecEdgarCaptureAdapter(InstrumentIdentityResolver((apple_pilot_identity(),)))
def yahoo_adapter():return YahooChartCaptureAdapter(YahooChartBinding(APPLE.instrument_id,"AAPL","AAPL","NMS","US",AssetType.STOCK,"Apple Inc.","USD"))
def yahoo_payload():return json.loads((YAHOO_ROOT/"normal_stock_quote.json").read_text(encoding="utf-8"))
def raw_yahoo(operation,payload,name,received=NOW):
 p=Provenance(YAHOO_PROVIDER,ProvenanceKind.MARKET_DATA,received,None,f"fixture://yahoo/{name}","raw-fixture-v1",DataQuality.NORMALIZED,Freshness.UNKNOWN)
 return RawPayloadEnvelope(f"raw.yahoo.{name}",YAHOO_PROVIDER,operation,received-timedelta(seconds=1),received,f"fixture://request/{name}",f"fixture://yahoo/{name}","application/json","yahoo.chart.v8",RawStatus.SUCCESS,canonical_payload_hash(payload),RawAcquisitionType.DOCUMENTATION_DERIVED_FIXTURE,True,payload,p)
def sec_variant(base,payload,name):
 received=base.received_at+timedelta(seconds=1);p=Provenance(SEC_PROVIDER_ID,ProvenanceKind.FUNDAMENTAL,received,None,f"fixture://sec/{name}",base.provenance.transform_version,DataQuality.NORMALIZED,Freshness.END_OF_DAY)
 return RawPayloadEnvelope(f"raw.sec.{name}",SEC_PROVIDER_ID,base.operation,base.requested_at,received,f"fixture://request/{name}",f"fixture://sec/{name}","application/json",base.schema_hint,RawStatus.SUCCESS,canonical_payload_hash(payload),RawAcquisitionType.DOCUMENTATION_DERIVED_FIXTURE,True,payload,p,http_status=200)
def submissions_payload():return json.loads((CAPTURE_ROOT/"apple_submissions_capture.json").read_text(encoding="utf-8"))["payload"]
def companyfacts_payload():return json.loads((CAPTURE_ROOT/"apple_companyfacts_capture.json").read_text(encoding="utf-8"))["payload"]
def add_filing(payload,*,accession,form,report_date=None):
 recent=payload["filings"]["recent"];source_index=next(index for index,value in enumerate(recent["form"]) if value=="10-Q")
 for key,values in recent.items():values.insert(0,deepcopy(values[source_index]))
 recent["accessionNumber"][0]=accession;recent["form"][0]=form;recent["filingDate"][0]="2026-08-13";recent["acceptanceDateTime"][0]="2026-08-13T20:00:00.000Z";recent["primaryDocument"][0]="aapl-pilot.htm"
 if report_date is not None:recent["reportDate"][0]=report_date
 return recent["reportDate"][source_index+1]
def history_payload():
 payload=yahoo_payload();result=payload["chart"]["result"][0];result["timestamp"]=[1786109400,1786195800,1786455000];quote=result["indicators"]["quote"][0]
 quote.update({"open":[311.45,313.0,314.0],"high":[314.81,315.0,317.0],"low":[310.74,312.0,313.0],"close":[313.33,314.0,316.0],"volume":[34407100,30000000,32000000]});return payload

class SECIncrementalTests(unittest.TestCase):
 def test_unchanged_payload_is_zero_append(self):
  raw=load_sec_capture((CAPTURE_ROOT/"apple_submissions_capture.json").resolve());refresh=SECIncrementalRefresh(sec_adapter());plan=refresh.plan(raw,raw);self.assertTrue(plan.unchanged);self.assertEqual(SECRefreshDisposition.NO_CHANGE,plan.disposition)
  with tempfile.TemporaryDirectory() as temp:
   cache=LocalMarketCache(Path(temp).resolve()/"cache.json");evidence=LocalEvidenceRepository(Path(temp).resolve()/"evidence.json");MarketDataIngestionPipeline(sec_adapter(),cache,evidence,POLICY).ingest(raw);before=(len(cache.list_all()),len(evidence.list_all()));receipt=refresh.ingest(raw,raw,cache,evidence,POLICY);self.assertEqual((0,0),(receipt.cache_writes,receipt.evidence_writes));self.assertEqual(before,(len(cache.list_all()),len(evidence.list_all())))
 def test_new_accession_is_append_only_and_idempotent(self):
  previous=load_sec_capture((CAPTURE_ROOT/"apple_submissions_capture.json").resolve());payload=submissions_payload();add_filing(payload,accession="0000320193-26-000999",form="10-Q");candidate=sec_variant(previous,payload,"new-accession");refresh=SECIncrementalRefresh(sec_adapter());plan=refresh.plan(previous,candidate);self.assertEqual(("0000320193-26-000999",),plan.new_filings);self.assertEqual(1001,plan.existing_filings)
  with tempfile.TemporaryDirectory() as temp:
   cache=LocalMarketCache(Path(temp).resolve()/"cache.json");evidence=LocalEvidenceRepository(Path(temp).resolve()/"evidence.json");MarketDataIngestionPipeline(sec_adapter(),cache,evidence,POLICY).ingest(previous);one=refresh.ingest(previous,candidate,cache,evidence,POLICY);two=refresh.ingest(previous,candidate,cache,evidence,POLICY);self.assertEqual((1,1),(one.cache_writes,one.evidence_writes));self.assertEqual((0,0),(two.cache_writes,two.evidence_writes))
 def test_amendment_keeps_original_and_establishes_lineage(self):
  previous=load_sec_capture((CAPTURE_ROOT/"apple_submissions_capture.json").resolve());payload=submissions_payload();report=add_filing(payload,accession="0000320193-26-001000",form="10-Q/A");candidate=sec_variant(previous,payload,"amendment");plan=SECIncrementalRefresh(sec_adapter()).plan(previous,candidate);self.assertEqual(("0000320193-26-001000",),plan.amendments);self.assertTrue(plan.delta.filings[0].amends_accession_number);self.assertNotEqual(plan.delta.filings[0].accession_number,plan.delta.filings[0].amends_accession_number)
 def test_fundamental_new_context_duplicate_and_superseding_are_distinct(self):
  previous=load_sec_capture((CAPTURE_ROOT/"apple_companyfacts_capture.json").resolve());duplicate_payload=companyfacts_payload();duplicate_payload["description"]="offline-delta-variant";duplicate=SECIncrementalRefresh(sec_adapter()).plan(previous,sec_variant(previous,duplicate_payload,"duplicates"));self.assertEqual(876,duplicate.duplicate_facts);self.assertFalse(duplicate.new_facts)
  payload=companyfacts_payload();units=payload["facts"]["us-gaap"]["Assets"]["units"]["USD"];new=deepcopy(units[-1]);new.update({"accn":"0000320193-26-000999","end":"2026-09-26","filed":"2026-10-30","fy":2026,"fp":"FY","form":"10-K","frame":"CY2026Q3I","val":Decimal(str(new["val"]))+1});new["val"]=int(new["val"]);units.append(new);plan=SECIncrementalRefresh(sec_adapter()).plan(previous,sec_variant(previous,payload,"new-fact"));self.assertEqual(1,len(plan.new_facts));self.assertEqual(876,plan.duplicate_facts)
  superseding_payload=companyfacts_payload();target=superseding_payload["facts"]["us-gaap"]["Assets"]["units"]["USD"][-1];target["val"]+=1;superseding=SECIncrementalRefresh(sec_adapter()).plan(previous,sec_variant(previous,superseding_payload,"superseding"));self.assertEqual(1,len(superseding.superseding_facts));self.assertIn("FACT_CONTEXT_VALUE_CHANGED_SUPERSEDING",superseding.warnings)

class QuoteHistoryRealityTests(unittest.TestCase):
 def test_quote_ingestion_refresh_idempotency_and_real_mode_guard(self):
  raw=raw_yahoo(ProviderCapability.QUOTE,yahoo_payload(),"quote");
  with tempfile.TemporaryDirectory() as temp:
   cache=LocalMarketCache(Path(temp).resolve()/"cache.json");evidence=LocalEvidenceRepository(Path(temp).resolve()/"evidence.json");pipeline=MarketDataIngestionPipeline(yahoo_adapter(),cache,evidence,POLICY);service=QuoteRefreshService(pipeline,cache);request=QuoteRefreshRequest(APPLE.instrument_id,YAHOO_PROVIDER,NOW)
   one=service.ingest_offline(request,raw);two=service.ingest_offline(request,raw);self.assertEqual(QuoteRefreshResult.UPDATED,one.result);self.assertEqual(QuoteRefreshResult.NO_CHANGE,two.result);consumer=CachedMarketDataConsumer(cache);quote=consumer.read_inputs((APPLE.instrument_id,),generated_at=NOW).quotes[0];self.assertEqual(Decimal("313.33"),quote.price);self.assertEqual(Decimal("2.62"),quote.change);self.assertEqual("UNKNOWN",quote.data_delay.kind.value);self.assertEqual("UNKNOWN",quote.market_status.value);self.assertEqual("STALE",consumer.read_inputs((APPLE.instrument_id,),generated_at=NOW+timedelta(hours=1)).quotes[0].provenance.freshness.value);self.assertFalse(consumer.read_inputs((APPLE.instrument_id,),generated_at=NOW,real_product_mode=True).quotes);self.assertEqual(DataReality.DOCUMENTATION_DERIVED.value,evidence.list_all()[0].lineage["data_reality"])
 def test_price_history_projection_is_ordered_json_safe_and_restartable(self):
  raw=raw_yahoo(ProviderCapability.PRICE_HISTORY,history_payload(),"history")
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp).resolve();cache=LocalMarketCache(root/"cache.json");evidence=LocalEvidenceRepository(root/"evidence.json");out=MarketDataIngestionPipeline(yahoo_adapter(),cache,evidence,POLICY).ingest(raw);self.assertEqual((3,3),(out.receipt.cache_writes,out.receipt.evidence_writes));reloaded=LocalMarketCache(root/"cache.json")
   watch=InMemoryWatchlistRepository();watch.add(WatchlistItem(APPLE,NOW));read=MarketReadAPI(watch,InMemoryPositionRepository(),InMemoryObservationRepository(),(APPLE,),market_cache=reloaded,evidence_repository=LocalEvidenceRepository(root/"evidence.json"));detail=read.instrument_detail(APPLE.instrument_id,CachedMarketDataConsumer(reloaded).read_inputs((APPLE.instrument_id,),generated_at=NOW));series=detail["data"]["price_history"];self.assertEqual(3,series["range"]["point_count"]);self.assertEqual(sorted(x["timestamp"] for x in series["points"]),[x["timestamp"] for x in series["points"]]);self.assertTrue(series["missing_intervals"]);json.dumps(detail,ensure_ascii=False,sort_keys=True)
 def test_combined_real_sec_and_documentation_quote_smoke_preserves_trust(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp).resolve();cache=LocalMarketCache(root/"cache.json");evidence=LocalEvidenceRepository(root/"evidence.json");sec=MarketDataIngestionPipeline(sec_adapter(),cache,evidence,POLICY)
   for name in ("apple_submissions_capture.json","apple_companyfacts_capture.json"):sec.ingest(load_sec_capture((CAPTURE_ROOT/name).resolve()))
   yahoo=MarketDataIngestionPipeline(yahoo_adapter(),cache,evidence,POLICY);yahoo.ingest(raw_yahoo(ProviderCapability.QUOTE,yahoo_payload(),"combined-quote",NOW));yahoo.ingest(raw_yahoo(ProviderCapability.PRICE_HISTORY,history_payload(),"combined-history",NOW))
   cache=LocalMarketCache(root/"cache.json");evidence=LocalEvidenceRepository(root/"evidence.json");mixed=CachedMarketDataConsumer(cache).read_inputs((APPLE.instrument_id,),generated_at=NOW);real_only=CachedMarketDataConsumer(cache).read_inputs((APPLE.instrument_id,),generated_at=NOW,real_product_mode=True);self.assertEqual(1,len(mixed.quotes));self.assertFalse(real_only.quotes);self.assertEqual(1,len(real_only.fundamentals))
   pack=MarketEvidencePackBuilder().build(pack_id="pack.live.combined",instrument_id=APPLE.instrument_id,as_of=NOW,generated_at=NOW,quotes=mixed.quotes,fundamentals=mixed.fundamentals,events=mixed.events,evidence=evidence.list_by_instrument(APPLE.instrument_id));self.assertNotEqual(PackAvailability.MISSING,pack.data_quality.completeness);self.assertNotIn("quote",pack.data_quality.missing_components)
   research=InMemoryResearchRepository();journal=InMemoryDecisionJournalRepository();app=MarketResearchApplication(evidence,research,journal);revenue=next(item for item in pack.evidence if item.lineage.get("concept")=="RevenueFromContractWithCustomerExcludingAssessedTax" and item.lineage.get("fiscal_year")=="2025");counter=next(item.evidence_id for item in pack.evidence if item.kind.value=="QUOTE");task=ResearchTask("task.live.combined",APPLE.instrument_id,NOW,"Combined SEC and quote evidence",(revenue.evidence_id,),());draft=app.create_research_draft_from_input(pack,task);saved=app.persist_research(draft,pack,lifecycle=ResearchLifecycle.DRAFT,recorded_at=NOW);entry=DecisionJournalEntry("journal.live.revision.1","journal.live",APPLE.instrument_id,1,NOW,"Monitor official filings and cached quote.","Combined local evidence is available.",( "SEC periods remain comparable.",),(revenue.evidence_id,),(counter,),("Quote source is still a pilot candidate.",),("Later filings contradict the thesis.",),("Review next filing.",),JournalStatus.ACTIVE,(saved.revision_id,),None,"Local-only",Provenance("local.user",ProvenanceKind.USER_RECORDED,NOW,NOW,"local://journal","journal-v1",DataQuality.NORMALIZED,Freshness.UNKNOWN));journal.append(entry)
   watch=InMemoryWatchlistRepository();watch.add(WatchlistItem(APPLE,NOW));read=MarketReadAPI(watch,InMemoryPositionRepository(),InMemoryObservationRepository(),(APPLE,),market_cache=cache,evidence_repository=evidence,research_repository=research,journal_repository=journal);product=MarketProductAPI(read,(APPLE,),evidence_repository=evidence,research_repository=research,journal_repository=journal);detail=product.instrument_detail(APPLE.instrument_id,mixed);self.assertEqual("313.33",detail["data"]["header"]["price"]["raw_value"]);self.assertEqual("UNKNOWN",detail["data"]["header"]["delay_kind"]);self.assertEqual("AVAILABLE",detail["data"]["price_history"]["availability"]);self.assertTrue(detail["data"]["data_trust"]["mixed_reality"]);self.assertGreater(detail["data"]["data_trust"]["real_evidence_count"],0);self.assertGreater(detail["data"]["data_trust"]["documentation_derived_count"],0);self.assertIsNotNone(detail["data"]["research"]["latest"]);self.assertEqual(1,len(detail["data"]["history"]["journal"]));home=product.market_home(mixed);self.assertTrue(any(item["price"]=="313.33" for item in home["data"]["watchlist_preview"]));stale=CachedMarketDataConsumer(cache).read_inputs((APPLE.instrument_id,),generated_at=NOW+timedelta(hours=1));stale_detail=product.instrument_detail(APPLE.instrument_id,stale);self.assertEqual("STALE",stale_detail["data"]["header"]["freshness"]);self.assertIn("较早缓存数据",stale_detail["data"]["header"]["cache_explanation"]);self.assertIsNotNone(stale_detail["data"]["research"]["latest"]);self.assertEqual(1,len(stale_detail["data"]["history"]["journal"]));json.dumps(detail,ensure_ascii=False,sort_keys=True)

if __name__=="__main__":unittest.main()
