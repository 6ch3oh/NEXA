from __future__ import annotations
from datetime import datetime,timezone
import hashlib,json
from pathlib import Path
import sys,tempfile,time,unittest

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import nexa_market.desktop as desktop
from nexa_market.desktop import DESKTOP_BRIDGE_VERSION,MarketModuleConfig,create_market_application

NOW=datetime(2026,8,14,8,tzinfo=timezone.utc);GOLDEN=ROOT/"tests"/"desktop_golden"
def config(root,mode="EMPTY",seed=True):return MarketModuleConfig(Path(root).resolve(),timezone="Asia/Shanghai",clock=lambda:NOW,runtime_mode=mode,seed_local_real_captures=seed)
def bridge(root,mode="EMPTY",seed=True):return create_market_application(config(root,mode,seed))
def seal(payload):return hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()
def keys(value):
 if isinstance(value,dict):return set(value).union(*(keys(x) for x in value.values()))
 if isinstance(value,list):return set().union(*(keys(x) for x in value))
 return set()

class DesktopBridgeTests(unittest.TestCase):
 def test_public_surface_and_route_manifest_are_tiny_and_framework_neutral(self):
  self.assertEqual(["DESKTOP_BRIDGE_VERSION","MARKET_ROUTE_MANIFEST","MarketModuleConfig","MarketDesktopBridge","create_market_application"],desktop.__all__);self.assertEqual(5,len(desktop.__all__))
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp);routes=b.get_route_manifest();self.assertEqual(6,len(routes));self.assertEqual("market",routes[0]["route_id"]);detail=next(x for x in routes if x["required_parameter"]=="instrument_id");self.assertEqual("market",detail["parent"]);json.dumps(routes,ensure_ascii=False,allow_nan=False)
 def test_lifecycle_is_idempotent_and_restartable(self):
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp);self.assertEqual("STOPPED",b.stop()["lifecycle"]);self.assertEqual("READY",b.start()["lifecycle"]);self.assertEqual("READY",b.start()["lifecycle"]);self.assertEqual("STOPPED",b.stop()["lifecycle"]);self.assertEqual("STOPPED",b.stop()["lifecycle"]);self.assertEqual("READY",b.start()["lifecycle"])
 def test_empty_snapshot_is_json_safe_and_return_values_are_isolated(self):
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp);b.start();one=b.get_desktop_snapshot();self.assertEqual("EMPTY",one["selected_mode"]);self.assertEqual(0,one["key_counters"]["watchlist_count"]);json.dumps(one,ensure_ascii=False,allow_nan=False);one["key_counters"]["watchlist_count"]=999;one["home"]["ok"]=False;two=b.get_desktop_snapshot();self.assertEqual(0,two["key_counters"]["watchlist_count"]);self.assertTrue(two["home"]["ok"])
 def test_demo_mode_is_explicit_and_durable_user_state_survives_host_recreation(self):
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp,"DEMO");b.start();snap=b.get_desktop_snapshot();self.assertEqual("DEMO",snap["selected_mode"]);self.assertEqual(1,snap["key_counters"]["watchlist_count"]);home=b.get_market_home();self.assertEqual("SYNTHETIC_DEMO",home["data"]["desktop_data_reality"]["page_classification"])
   result=b.execute_action("UPDATE_WATCHLIST",{"instrument_id":"US.XNAS.NEXA","note":"Persisted host note","priority":"HIGH"});self.assertTrue(result["success"]);b.stop();reloaded=bridge(temp,"DEMO");reloaded.start();item=reloaded.get_watchlist()["data"]["items"][0];self.assertEqual("Persisted host note",item["note"]);self.assertEqual("HIGH",item["priority"])
 def test_real_apple_local_projection_has_no_fixture_or_raw_schema_leakage(self):
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp,"LOCAL_REAL");self.assertEqual("READY",b.start()["lifecycle"]);detail=b.get_instrument_detail("US.XNAS.AAPL");self.assertTrue(detail["ok"]);header=detail["data"]["header"];self.assertEqual("305.26",header["price"]["raw_value"]);self.assertEqual("AVAILABLE",header["price"]["availability"]);self.assertEqual("STALE",header["freshness"]);self.assertEqual("UNKNOWN",header["delay_kind"]);self.assertEqual(5,detail["data"]["price_history"]["range"]["point_count"]);reality=detail["data"]["desktop_data_reality"];self.assertEqual("CACHED_REAL",reality["page_classification"]);self.assertFalse(reality["fixture_fallback_allowed"]);self.assertGreater(reality["real"],0);self.assertGreater(reality["cached_real"],0);self.assertEqual(0,reality["documentation_derived"]);self.assertTrue({"chart","indicators","regularMarketPrice","exchangeDataDelayedBy"}.isdisjoint(keys(detail)))
 def test_refresh_contract_never_performs_network_and_trading_commands_are_forbidden(self):
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp);b.start();local=b.refresh_local_projection();self.assertTrue(local["success"]);self.assertEqual("SUCCESS",local["status"]);network=b.execute_action("REFRESH_MARKET_DATA",{});self.assertFalse(network["success"]);self.assertEqual("NETWORK_NOT_AUTHORIZED",network["status"])
   for action in ("BUY","SELL","ORDER","TRANSFER"):
    denied=b.execute_action(action,{});self.assertFalse(denied["success"]);self.assertEqual("FORBIDDEN",denied["status"])
 def test_corrupted_store_enters_read_only_problem_state_without_internal_exception_leak(self):
  with tempfile.TemporaryDirectory() as temp:
   first=bridge(temp);first.start();first.stop();state=Path(temp)/"state"/"market-state.json";state.write_text("{not-json",encoding="utf-8");b=bridge(temp);status=b.start();self.assertEqual("READ_ONLY",status["lifecycle"]);self.assertTrue(status["read_only"]);page=b.get_market_home();self.assertFalse(page["ok"]);self.assertIn("problem",page);self.assertNotIn("Exception",json.dumps(page));write=b.execute_action("ADD_WATCHLIST",{"instrument_id":"US.XNAS.AAPL"});self.assertFalse(write["success"]);self.assertEqual("READ_ONLY",write["status"])
 def test_uniform_action_results_cover_manual_position_and_watchlist_lifecycle(self):
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp);b.start();actions=(("ADD_WATCHLIST",{"instrument_id":"US.XNAS.AAPL"}),("UPDATE_WATCHLIST",{"instrument_id":"US.XNAS.AAPL","note":"Host note","tags":["review"],"priority":"HIGH"}),("RECORD_POSITION",{"position_id":"position.actions.apple","instrument_id":"US.XNAS.AAPL","quantity":"1","average_cost":"300","currency":"USD"}),("UPDATE_POSITION",{"position_id":"position.actions.apple","quantity":"2","average_cost":"290","note":"Manual only"}),("CLOSE_POSITION",{"position_id":"position.actions.apple"}),("REMOVE_WATCHLIST",{"instrument_id":"US.XNAS.AAPL"}))
   for action,payload in actions:
    result=b.execute_action(action,payload);self.assertTrue(result["success"],action);self.assertEqual({"bridge_version","generated_at","problem","status","success","updated_projection","warning"},set(result));self.assertEqual("SUCCESS",result["status"]);json.dumps(result,ensure_ascii=False,allow_nan=False)
   self.assertEqual(0,b.get_desktop_snapshot()["key_counters"]["watchlist_count"]);self.assertEqual(0,b.get_desktop_snapshot()["key_counters"]["open_position_count"])
 def test_desktop_acceptance_smoke_and_restart(self):
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp,"LOCAL_REAL");b.start();self.assertTrue(b.get_market_home()["ok"]);self.assertTrue(b.get_watchlist()["ok"]);self.assertTrue(b.get_portfolio()["ok"]);self.assertTrue(b.get_instrument_detail("US.XNAS.AAPL")["ok"]);self.assertTrue(b.explain_term("REVENUE",instrument_id="US.XNAS.AAPL")["ok"]);self.assertGreater(b.list_evidence(instrument_id="US.XNAS.AAPL")["data"]["total_count"],0);self.assertTrue(b.get_research_center()["ok"]);self.assertTrue(b.get_decision_journal()["ok"])
   evidence_ids=[x["evidence_id"] for x in b.list_evidence(instrument_id="US.XNAS.AAPL")["data"]["items"][:2]]
   actions=(("ADD_WATCHLIST",{"instrument_id":"US.XNAS.AAPL","tags":["desktop"]}),("RECORD_POSITION",{"position_id":"position.desktop.apple","instrument_id":"US.XNAS.AAPL","quantity":"2","average_cost":"250","currency":"USD"}),("CREATE_OBSERVATION",{"observation_id":"observation.desktop.apple","instrument_id":"US.XNAS.AAPL","content":"Review the local Apple evidence."}),("CREATE_RESEARCH_DRAFT",{"instrument_id":"US.XNAS.AAPL","task_id":"task.desktop.apple","focus":"Review Apple","supporting_evidence_refs":[evidence_ids[0]],"counter_evidence_refs":[evidence_ids[1]]}),("VALIDATE_RESEARCH",{"instrument_id":"US.XNAS.AAPL"}),("PUBLISH_RESEARCH",{"instrument_id":"US.XNAS.AAPL"}),("CREATE_JOURNAL",{"instrument_id":"US.XNAS.AAPL","journal_id":"journal.desktop.apple","thesis":"Continue reviewing official evidence."}),("REVIEW_JOURNAL",{"journal_id":"journal.desktop.apple","what_happened":"Official evidence remained available.","thesis_still_valid":True,"lessons":["Keep source and freshness visible."],"confidence_after_review":"0.6"}))
   for action,payload in actions:self.assertTrue(b.execute_action(action,payload)["success"],action)
   b.stop();reloaded=bridge(temp,"LOCAL_REAL");reloaded.start();snap=reloaded.get_desktop_snapshot();self.assertEqual(1,snap["key_counters"]["watchlist_count"]);self.assertEqual(1,snap["key_counters"]["open_position_count"]);detail=reloaded.get_instrument_detail("US.XNAS.AAPL");self.assertEqual(1,len(detail["data"]["history"]["observations"]));self.assertEqual(3,len(detail["data"]["history"]["research_revisions"]));self.assertEqual(1,len(detail["data"]["history"]["retrospectives"]));self.assertEqual("READY",reloaded.get_module_status()["lifecycle"]);self.assertEqual("STOPPED",reloaded.stop()["lifecycle"])
 def test_typical_local_snapshot_has_bounded_linear_runtime(self):
  with tempfile.TemporaryDirectory() as temp:
   b=bridge(temp,"LOCAL_REAL");b.start();start=time.perf_counter();b.get_desktop_snapshot();elapsed=time.perf_counter()-start;self.assertLess(elapsed,15)
 def test_all_desktop_goldens_match(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp).resolve();empty=bridge(root/"empty");empty.start();demo=bridge(root/"demo","DEMO");demo.start();real=bridge(root/"real","LOCAL_REAL");real.start();partial=bridge(root/"partial","LOCAL_REAL",False);partial.start()
   payloads={"desktop_snapshot_empty":empty.get_desktop_snapshot(),"desktop_snapshot_beginner":demo.get_desktop_snapshot(),"desktop_snapshot_real_apple":real.get_instrument_detail("US.XNAS.AAPL"),"desktop_snapshot_partial":partial.get_desktop_snapshot(),"route_manifest":empty.get_route_manifest(),"user_action_result":empty.execute_action("ADD_WATCHLIST",{"instrument_id":"US.XNAS.AAPL","priority":"HIGH","tags":["golden"],"note":"Desktop golden action"})}
   for name,payload in payloads.items():golden=json.loads((GOLDEN/f"{name}.json").read_text(encoding="utf-8"));self.assertEqual(DESKTOP_BRIDGE_VERSION,golden["bridge_version"],name);self.assertEqual(golden["contract_sha256"],seal(payload),name);self.assertEqual(golden["top_level_keys"],sorted(payload) if isinstance(payload,dict) else [],name);json.dumps(payload,ensure_ascii=False,allow_nan=False)

if __name__=="__main__":unittest.main()
