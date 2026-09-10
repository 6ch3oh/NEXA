from pathlib import Path
import json,sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.fixtures import FUNDAMENTAL_SUMMARY,RISK_ALERT
from nexa_market.product.cards import evidence_cards,indicator_cards,risk_cards
from nexa_market.research import FinancialTerm
from nexa_market.viewmodels import to_json_compatible
from tests.test_evidence_pack import record
class ProductCardTests(unittest.TestCase):
    def test_evidence_cards_explain_conflict_and_never_hide_sources(self):
        cards=evidence_cards((record("evidence.a","fixture.a","100"),record("evidence.b","fixture.b","120")));self.assertEqual(2,len(cards));self.assertTrue(all(x.conflict_status=="EVIDENCE_CONFLICT" for x in cards));self.assertEqual({"fixture.a","fixture.b"},{x.source for x in cards});json.dumps(to_json_compatible(cards),ensure_ascii=False)
    def test_indicator_catalog_has_all_beginner_terms_and_explicit_missing(self):
        cards=indicator_cards(FUNDAMENTAL_SUMMARY,evidence_refs=("evidence.fundamental",));self.assertEqual(set(FinancialTerm),{FinancialTerm(x.term_id.removeprefix("term.").upper()) for x in cards});self.assertEqual(11,len(cards));pe=next(x for x in cards if x.term_id=="term.pe");self.assertIn("不能判断贵或便宜",pe.current_value_interpretation);missing=next(x for x in cards if x.term_id=="term.eps");self.assertEqual("当前没有可靠数据",missing.value.display)
    def test_risk_card_has_text_severity_and_review_only(self):
        card=risk_cards((RISK_ALERT,))[0];self.assertEqual("中",card.severity_label);self.assertEqual("REVIEW",card.recommended_action);self.assertIn("复核",card.review_prompt)
if __name__=="__main__":unittest.main()
