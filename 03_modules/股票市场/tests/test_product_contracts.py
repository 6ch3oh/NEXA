from pathlib import Path
import json,sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.product.language import EMPTY_STATES,NAVIGATION,freshness_explanation,problem_from_read_error,quality_explanation
from nexa_market.product.models import ProductAction,ProductArea,UserActionType
from nexa_market.viewmodels import to_json_compatible
class ProductContractTests(unittest.TestCase):
    def test_information_architecture_has_four_primary_entries(self):
        self.assertEqual((ProductArea.MARKET_HOME,ProductArea.WATCHLIST,ProductArea.PORTFOLIO,ProductArea.RESEARCH_CENTER),tuple(x[0] for x in NAVIGATION))
    def test_empty_states_are_plain_language_and_actionable(self):
        self.assertEqual(set(ProductArea)-{ProductArea.INSTRUMENT_DETAIL},set(EMPTY_STATES));self.assertIn("还没有",EMPTY_STATES[ProductArea.WATCHLIST].title);json.dumps(to_json_compatible(tuple(EMPTY_STATES.values())),ensure_ascii=False)
    def test_error_contract_does_not_expose_internal_message_or_path(self):
        problem=problem_from_read_error(ProductArea.RESEARCH_CENTER,{"code":"CORE_STATE_UNAVAILABLE","message":"RepositoryError C:/secret/store.json"});encoded=json.dumps(to_json_compatible(problem),ensure_ascii=False);self.assertNotIn("RepositoryError",encoded);self.assertNotIn("C:/secret",encoded);self.assertEqual(UserActionType.CHECK_DATA,problem.next_action)
    def test_product_actions_contain_no_execution_contract(self):
        encoded=" ".join(x.value for x in ProductAction);self.assertNotIn("BUY",encoded);self.assertNotIn("SELL",encoded);self.assertNotIn("ORDER",encoded);self.assertNotIn("TRANSFER",encoded)
    def test_unknown_states_degrade_to_plain_language(self):
        self.assertEqual("数据状态尚未明确。",freshness_explanation("FUTURE_STATE"));self.assertEqual("尚未完成研究质量检查。",quality_explanation("FUTURE_STATE"))
if __name__=="__main__":unittest.main()
