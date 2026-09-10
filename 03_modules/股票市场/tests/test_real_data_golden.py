from __future__ import annotations
from pathlib import Path
import hashlib,json,sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from tests.test_real_data_readiness import MAPS,NOW,POLICY,US_SHARE,quote_payload,raw
from nexa_market.application import MarketReadAPI
from nexa_market.cache import InMemoryMarketCache
from nexa_market.domain import WatchlistItem
from nexa_market.evidence import InMemoryEvidenceRepository
from nexa_market.ingestion import CachedMarketDataConsumer,DocumentationFixtureAdapter,MarketDataIngestionPipeline
from nexa_market.product import MarketProductAPI
from nexa_market.providers import *
from nexa_market.repositories import InMemoryObservationRepository,InMemoryPositionRepository,InMemoryWatchlistRepository
from nexa_market.viewmodels import to_json_compatible
GOLDEN=MODULE_ROOT/"tests"/"real_data_golden"
def digest(value):return hashlib.sha256(json.dumps(to_json_compatible(value),ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
def projections():
 cache=InMemoryMarketCache();evidence=InMemoryEvidenceRepository();pipeline=MarketDataIngestionPipeline(DocumentationFixtureAdapter(InstrumentIdentityResolver(MAPS)),cache,evidence,POLICY);receipt=pipeline.ingest(raw("fixture.us",ProviderCapability.QUOTE,quote_payload("AAPL","XNAS"))).receipt;inputs=CachedMarketDataConsumer(cache).read_inputs((US_SHARE.instrument_id,),generated_at=NOW);watch=InMemoryWatchlistRepository();watch.add(WatchlistItem(US_SHARE,NOW));read=MarketReadAPI(watch,InMemoryPositionRepository(),InMemoryObservationRepository(),(US_SHARE,),evidence_repository=evidence,market_cache=cache);detail=MarketProductAPI(read,(US_SHARE,),evidence_repository=evidence).instrument_detail(US_SHARE.instrument_id,inputs);plan=RefreshPlanner(ProviderSelectionPolicy(candidate_manifests())).plan(MarketDataRefreshRequest((US_SHARE.instrument_id,),ProviderMarket.US,AssetType.STOCK,(ProviderCapability.FILINGS,),requested_at=NOW));return {"provider_registry":candidate_manifests(),"refresh_dry_run":plan,"quote_ingestion_receipt":receipt,"product_detail":detail}
class RealDataGoldenTests(unittest.TestCase):
 def test_four_public_readiness_golden_digests(self):
  values=projections();self.assertEqual(set(values),{x.stem for x in GOLDEN.glob("*.json")})
  for name,value in values.items():self.assertEqual(json.loads((GOLDEN/f"{name}.json").read_text(encoding="utf-8"))["contract_sha256"],digest(value),name)
 def test_projection_is_deterministic_on_rebuild(self):self.assertEqual({k:digest(v) for k,v in projections().items()},{k:digest(v) for k,v in projections().items()})
if __name__=="__main__":unittest.main()
