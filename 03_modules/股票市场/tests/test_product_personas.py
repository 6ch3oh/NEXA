from pathlib import Path
import json,sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.product.fixtures import product_personas
from nexa_market.product.snapshot import build_product_snapshot
from nexa_market.viewmodels import to_json_compatible
class ProductPersonaTests(unittest.TestCase):
    def test_four_authoritative_personas_cover_empty_light_complete_and_issues(self):
        values=product_personas();self.assertEqual(("persona.new","persona.light","persona.complete","persona.data-issues"),tuple(x.persona_id for x in values));self.assertIsNotNone(values[0].product_api.watchlist(values[0].inputs)["data"]["empty_state"]);self.assertEqual(3,values[1].product_api.watchlist(values[1].inputs)["data"]["total_count"]);self.assertGreaterEqual(len(values[2].product_api.instrument_detail(values[2].default_instrument_id,values[2].inputs)["data"]["evidence"]["items"]),2);self.assertGreaterEqual(len(values[3].product_api.market_home(values[3].inputs)["data"]["attention_today"]),3)
    def test_persona_outputs_are_deterministic_json(self):
        first=product_personas();second=product_personas()
        for a,b in zip(first,second):self.assertEqual(json.dumps(a.product_api.market_home(a.inputs),ensure_ascii=False,sort_keys=True),json.dumps(b.product_api.market_home(b.inputs),ensure_ascii=False,sort_keys=True))
    def test_complete_persona_has_cn_hk_us_index_overview(self):
        complete=product_personas()[2];items=complete.product_api.market_home(complete.inputs)["data"]["market_overview"]["items"];self.assertEqual({"CN","HK","US"},{x["market"] for x in items})
    def test_every_persona_full_snapshot_is_json_safe(self):
        for persona in product_personas():json.dumps(to_json_compatible(build_product_snapshot(persona)),ensure_ascii=False,sort_keys=True)
if __name__=="__main__":unittest.main()
