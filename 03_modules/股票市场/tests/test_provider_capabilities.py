from pathlib import Path
import json,sys,unittest
MODULE_ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(MODULE_ROOT))
from nexa_market.providers import AuthenticationClass,CostClass,OfficialStatus,ProviderCapability,candidate_manifests
from nexa_market.viewmodels import to_json_compatible
class ProviderManifestTests(unittest.TestCase):
    def test_candidates_are_metadata_only_and_no_final_provider_is_selected(self):
        values=candidate_manifests();self.assertEqual(12,len(values));self.assertEqual(12,len({x.provider_id for x in values}));self.assertTrue(all(x.network_required for x in values));self.assertTrue(any(x.official_status is OfficialStatus.REGULATOR for x in values));self.assertTrue(all(not x.enabled for x in values));json.dumps(to_json_compatible(values),sort_keys=True)
    def test_paid_and_credential_decisions_are_explicit(self):
        paid=next(x for x in candidate_manifests() if x.provider_id=="candidate.commercial");self.assertEqual(AuthenticationClass.PAID_ACCOUNT_REQUIRED,paid.authentication);self.assertFalse(paid.fallback_eligible);self.assertEqual(set(ProviderCapability),set(paid.capabilities))
if __name__=="__main__":unittest.main()
