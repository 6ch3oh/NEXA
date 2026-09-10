from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.services.import_readiness import ProductionImportAuthorizationGate


class ImportReadinessV02Tests(unittest.TestCase):
    def test_real_006_plan_is_reconciled_and_still_zero_write(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp) / "absent.sqlite3"
            app = create_creator_ops_application(db)
            plan = app.get_import_readiness_v0_2()
            self.assertEqual(len(plan.dry_run.entries), 34)
            self.assertEqual(plan.dry_run.action_counts()["MANUAL_REVIEW"], 8)
            self.assertEqual(plan.judgment_required_count, 12)
            self.assertEqual(plan.invalid_count, 1)
            self.assertTrue(plan.ready_for_explicit_user_authorization)
            self.assertFalse(plan.production_import_authorized)
            self.assertEqual(plan.production_writes, ())
            self.assertFalse(db.exists())

    def test_import_gate_rejects_absent_or_false_confirmation(self) -> None:
        with self.assertRaises(PermissionError):
            ProductionImportAuthorizationGate.validate(production_import_confirmation=False)

    def test_gate_has_no_executor_and_goal_does_not_supply_true(self) -> None:
        self.assertFalse(hasattr(ProductionImportAuthorizationGate, "execute"))


if __name__ == "__main__":
    unittest.main()
