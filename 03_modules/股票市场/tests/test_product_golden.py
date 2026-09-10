from pathlib import Path
import hashlib
import json
import sys
import unittest

MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))
from nexa_market.product.fixtures import product_personas
from nexa_market.product.snapshot import build_product_snapshot
from nexa_market.viewmodels import to_json_compatible
GOLDEN = MODULE_ROOT / "tests" / "product_golden"


def contract_digest(value: dict) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class ProductGoldenTests(unittest.TestCase):
    def current(self):
        persona=next(x for x in product_personas() if x.persona_id=="persona.complete");value=to_json_compatible(build_product_snapshot(persona));return {"market_home":value["market_home"],"watchlist":value["watchlist"],"portfolio":value["portfolio"],"instrument_detail":value["instrument_detail"],"research_center":value["research_center"],"decision_journal":value["decision_journal"]}
    def test_six_golden_contracts_match_public_product_projection(self):
        current = self.current()
        self.assertEqual(set(current), {x.stem for x in GOLDEN.glob("*.json")})
        for name, value in current.items():
            golden = json.loads((GOLDEN / f"{name}.json").read_text(encoding="utf-8"))
            self.assertEqual(golden["contract_sha256"], contract_digest(value), name)
            self.assertEqual(golden["area"], value["area"], name)
            self.assertEqual(golden["product_api_version"], value["product_api_version"], name)
            self.assertEqual(golden["generated_at"], value["generated_at"], name)
            self.assertEqual(golden["beginner_mode"], value["beginner_mode"], name)
    def test_public_top_level_envelopes_are_stable(self):
        for name,value in self.current().items():self.assertEqual({"ok","product_api_version","area","generated_at","beginner_mode","data"},set(value),name)
if __name__=="__main__":unittest.main()
