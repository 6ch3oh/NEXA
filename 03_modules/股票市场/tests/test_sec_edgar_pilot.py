from __future__ import annotations
from datetime import datetime,timezone
from pathlib import Path
import json,sys,tempfile,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))

from nexa_market.application import MarketReadAPI,MarketResearchApplication,ReadInputs,ResearchTask
from nexa_market.cache import CacheDataType,FreshnessPolicy,FreshnessRule,LocalMarketCache
from nexa_market.domain import AssetType,Freshness,WatchlistItem
from nexa_market.evidence import LocalEvidenceRepository,MarketEvidencePackBuilder,PackAvailability
from nexa_market.fixtures import NOW,instrument
from nexa_market.ingestion import CachedMarketDataConsumer,MarketDataIngestionPipeline,MarketDataQuality,RawAcquisitionType
from nexa_market.journal import InMemoryDecisionJournalRepository
from nexa_market.product import MarketProductAPI
from nexa_market.providers import ProviderCapability,InstrumentIdentityResolver
from nexa_market.providers.sec_edgar import APPLE_PILOT_CIK,APPLE_PILOT_INSTRUMENT_ID,SEC_PROVIDER_ID,SecEdgarCaptureAdapter,apple_pilot_identity
from nexa_market.providers.sec_capture import load_sec_capture
from nexa_market.repositories import InMemoryObservationRepository,InMemoryPositionRepository,InMemoryWatchlistRepository
from nexa_market.research import EvidenceKind,FinancialTerm,InMemoryResearchRepository,explain_term
from nexa_market.viewmodels import to_json_compatible

CAPTURES=MODULE_ROOT/"tests"/"raw_fixtures"/"sec_edgar_real"
SUBMISSIONS=CAPTURES/"apple_submissions_capture.json";COMPANYFACTS=CAPTURES/"apple_companyfacts_capture.json"
CIK=APPLE_PILOT_CIK
APPLE=instrument(APPLE_PILOT_INSTRUMENT_ID,"AAPL","XNAS",AssetType.STOCK,"Apple Inc.","USD","US")
APPLE_SEC_IDENTITY=apple_pilot_identity()
POLICY=FreshnessPolicy("policy.sec-pilot.v1",tuple(FreshnessRule(kind,seconds,f"freshness.sec.{kind.value.lower()}.v1") for kind,seconds in ((CacheDataType.FUNDAMENTAL,86400*90),(CacheDataType.FUNDAMENTAL_FACT,86400*365),(CacheDataType.FILING,86400*365))))

class SecEdgarPilotTests(unittest.TestCase):
 def adapter(self):return SecEdgarCaptureAdapter(InstrumentIdentityResolver((APPLE_SEC_IDENTITY,)))
 def test_capture_seals_are_real_redacted_hash_verified_and_identity_is_explicit(self):
  for path,operation,digest in ((SUBMISSIONS,ProviderCapability.FILINGS,"cfb523130eb737106361d6b5d4897842161ab85b310d4d8462c355d41c0f3eab"),(COMPANYFACTS,ProviderCapability.FUNDAMENTALS,"2d1974cf68b105aa4ae1a9da58bc95488993216dde40f8470bcf17eef4c8a472")):
   raw=load_sec_capture(path.resolve());self.assertEqual(operation,raw.operation);self.assertEqual(digest,raw.raw_sha256);self.assertEqual(200,raw.http_status);self.assertEqual(RawAcquisitionType.REAL_PROVIDER_CAPTURE,raw.acquisition_type);self.assertFalse(raw.synthetic);self.assertEqual("NEXA Market Research <REDACTED_CONTACT>",json.loads(path.read_text(encoding="utf-8"))["user_agent"])
  resolver=InstrumentIdentityResolver((APPLE_SEC_IDENTITY,));self.assertEqual(APPLE.instrument_id,resolver.resolve_identifier(SEC_PROVIDER_ID,"0000320193",as_of=NOW).matches[0].instrument_id);self.assertFalse(resolver.resolve(SEC_PROVIDER_ID,"MSFT",as_of=NOW).matches)
 def test_real_submissions_replay_normalizes_complete_filing_lineage(self):
  _,batch=self.adapter().normalize(load_sec_capture(SUBMISSIONS.resolve()));self.assertEqual(1001,len(batch.filings));latest=batch.filings[0];self.assertEqual("US",latest.jurisdiction);self.assertTrue(latest.accession_number);self.assertTrue(latest.source_reference.startswith("https://www.sec.gov/Archives/edgar/data/320193/"));self.assertEqual(SEC_PROVIDER_ID,latest.provenance.source);self.assertIn("#cfb523",latest.provenance.raw_reference)
 def test_real_companyfacts_replay_preserves_period_unit_accession_and_duplicates(self):
  _,batch=self.adapter().normalize(load_sec_capture(COMPANYFACTS.resolve()));facts=batch.fundamental_facts;self.assertEqual(876,len(facts));self.assertEqual({"USD"},{x.unit for x in facts});self.assertEqual({CIK},{x.source_entity_identifier for x in facts});self.assertTrue({"INSTANT","DURATION"}.issubset({x.period_kind.value for x in facts}));self.assertTrue({"ANNUAL","QUARTERLY"}.issubset({x.reporting_scope.value for x in facts}));self.assertTrue(all(x.accession_number and x.form and x.filed_at and x.period_end for x in facts));self.assertGreater(len(facts),len({(x.taxonomy,x.concept) for x in facts}));self.assertEqual(1,len(batch.fundamentals));self.assertEqual("ANNUAL:FY2025",batch.fundamentals[0].reporting_period)
 def test_schema_drift_and_identity_mismatch_fail_closed_without_writes(self):
  value=json.loads(SUBMISSIONS.read_text(encoding="utf-8"));value["payload"]["cik"]="0000789019";value["payload_sha256"]=__import__("hashlib").sha256(json.dumps(value["payload"],ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp).resolve()/"mismatch.json";path.write_text(json.dumps(value),encoding="utf-8");raw=load_sec_capture(path)
   cache=LocalMarketCache(Path(temp).resolve()/"cache.json");evidence=LocalEvidenceRepository(Path(temp).resolve()/"evidence.json");out=MarketDataIngestionPipeline(self.adapter(),cache,evidence,POLICY).ingest(raw);self.assertEqual(MarketDataQuality.INVALID,out.receipt.quality);self.assertEqual(0,out.receipt.cache_writes);self.assertEqual(0,out.receipt.evidence_writes)
 def test_real_capture_to_restart_pack_explanation_research_and_product(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp).resolve();cache=LocalMarketCache(root/"sec-cache.json");evidence=LocalEvidenceRepository(root/"sec-evidence.json");pipeline=MarketDataIngestionPipeline(self.adapter(),cache,evidence,POLICY)
   filings=pipeline.ingest(load_sec_capture(SUBMISSIONS.resolve()));facts=pipeline.ingest(load_sec_capture(COMPANYFACTS.resolve()));self.assertFalse(filings.receipt.errors);self.assertFalse(facts.receipt.errors);self.assertEqual(1878,len(cache.list_all()));self.assertEqual(1881,len(evidence.list_all()))
   reloaded_cache=LocalMarketCache(root/"sec-cache.json");reloaded_evidence=LocalEvidenceRepository(root/"sec-evidence.json");self.assertEqual(len(cache.list_all()),len(reloaded_cache.list_all()));self.assertEqual(len(evidence.list_all()),len(reloaded_evidence.list_all()))
   generated=max(x.received_at for x in (load_sec_capture(SUBMISSIONS.resolve()),load_sec_capture(COMPANYFACTS.resolve())));inputs=CachedMarketDataConsumer(reloaded_cache).read_inputs((APPLE.instrument_id,),generated_at=generated);self.assertFalse(inputs.quotes);self.assertEqual(1,len(inputs.fundamentals));self.assertEqual(1001,len(inputs.events))
   pack=MarketEvidencePackBuilder().build(pack_id="pack.sec.apple.real",instrument_id=APPLE.instrument_id,as_of=generated,generated_at=generated,fundamentals=inputs.fundamentals,events=inputs.events,evidence=reloaded_evidence.list_by_instrument(APPLE.instrument_id));self.assertEqual(PackAvailability.PARTIAL,pack.data_quality.completeness)
   revenue=next(x for x in pack.evidence if x.kind is EvidenceKind.FUNDAMENTAL and x.lineage.get("concept")=="RevenueFromContractWithCustomerExcludingAssessedTax" and x.lineage.get("reporting_scope")=="ANNUAL" and x.lineage.get("fiscal_year")=="2025");self.assertEqual(CIK,revenue.lineage["source_entity_identifier"]);self.assertTrue(revenue.lineage["raw_capture_reference"]);explanation=explain_term(FinancialTerm.REVENUE,current_context=f"Apple FY2025 revenue was {revenue.normalized_value} {revenue.unit}; reporting period {revenue.lineage['period_end']}.",evidence_refs=(revenue.evidence_id,));self.assertIn(revenue.normalized_value,explanation.current_context);self.assertIn("收入增长不等于利润",explanation.limitations)
   research_repo=InMemoryResearchRepository();app=MarketResearchApplication(reloaded_evidence,research_repo,InMemoryDecisionJournalRepository());task=ResearchTask("sec.apple.real",APPLE.instrument_id,generated,"Use real SEC evidence as deterministic local research input.",(revenue.evidence_id,),());draft=app.create_research_draft_from_input(pack,task);self.assertEqual(0,len([x for x in draft.claims if "BUY" in x.statement or "SELL" in x.statement]))
   watch=InMemoryWatchlistRepository();watch.add(WatchlistItem(APPLE,generated));read=MarketReadAPI(watch,InMemoryPositionRepository(),InMemoryObservationRepository(),(APPLE,),evidence_repository=reloaded_evidence,research_repository=research_repo,market_cache=reloaded_cache);product=MarketProductAPI(read,(APPLE,),evidence_repository=reloaded_evidence,research_repository=research_repo);detail=product.instrument_detail(APPLE.instrument_id,ReadInputs(generated,fundamentals=inputs.fundamentals,events=inputs.events,explanations=(explanation,),beginner_research=(draft,)));self.assertTrue(detail["ok"]);self.assertEqual("Apple Inc.",detail["data"]["header"]["company_name"]);self.assertEqual("AAPL",detail["data"]["header"]["symbol"]);self.assertEqual("UNAVAILABLE",detail["data"]["header"]["price"]["availability"]);revenue_card=next(x for x in detail["data"]["fundamentals"]["cards"] if x["term_id"]=="term.revenue");self.assertEqual("ANNUAL:FY2025",revenue_card["reporting_period"]);self.assertEqual("END_OF_DAY",revenue_card["freshness"]);self.assertTrue(revenue_card["evidence_refs"]);sec_card=next(x for x in detail["data"]["evidence"]["items"] if x["evidence_id"]==revenue.evidence_id);self.assertEqual("us-gaap",sec_card["provenance"]["taxonomy"]);self.assertEqual("2025",sec_card["provenance"]["fiscal_year"]);self.assertEqual(CIK,sec_card["provenance"]["source_entity_identifier"]);json.dumps(to_json_compatible(detail),ensure_ascii=False,sort_keys=True)

if __name__=="__main__":unittest.main()
