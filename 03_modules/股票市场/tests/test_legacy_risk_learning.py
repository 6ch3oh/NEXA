from pathlib import Path
import json,sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.fixtures import AI_RESEARCH_RESULT,NOW,US_SHARE
from nexa_market.risk import LocalRiskEvaluator
from nexa_market.research import FinancialTerm,LegacyAIResearchMigration,LegacyMigrationStatus,ResearchQualityGate,learning_hook
from nexa_market.viewmodels import to_json_compatible
from tests.test_beginner_research import valid_research
from tests.test_evidence_pack import record
from nexa_market.evidence import MarketEvidencePackBuilder
class LegacyRiskLearningTests(unittest.TestCase):
    def test_legacy_migration_is_partial_diagnostic_and_deterministic(self):
        result=LegacyAIResearchMigration().migrate(AI_RESEARCH_RESULT);self.assertEqual(LegacyMigrationStatus.PARTIAL,result.status);self.assertEqual(US_SHARE.instrument_id,result.research[0].instrument_id);self.assertTrue(result.diagnostics);self.assertEqual(result,LegacyAIResearchMigration().migrate(AI_RESEARCH_RESULT));json.dumps(to_json_compatible(result),ensure_ascii=False)
    def test_local_risk_detects_missing_conflict_and_quality_without_action(self):
        pack=MarketEvidencePackBuilder().build(pack_id="pack.risk",instrument_id=US_SHARE.instrument_id,as_of=NOW,generated_at=NOW,evidence=(record("evidence.a","fixture.a","100"),record("evidence.b","fixture.b","120")))
        alerts=LocalRiskEvaluator().evaluate(pack,detected_at=NOW,research_quality=ResearchQualityGate().evaluate(valid_research()));types={x.risk_type.value for x in alerts};self.assertIn("DATA_MISSING",types);self.assertIn("EVIDENCE_CONFLICT",types);self.assertIn("RESEARCH_QUALITY",types);self.assertNotIn("sell",json.dumps(to_json_compatible(alerts)).lower())
    def test_learning_hook_is_json_safe_and_only_a_future_contract(self):
        hook=learning_hook(FinancialTerm.PE,evidence_refs=("evidence.a",),suggested_next=FinancialTerm.ROE);self.assertEqual("ROE",hook.suggested_next_concept);json.dumps(to_json_compatible(hook),ensure_ascii=False)
if __name__=="__main__":unittest.main()
