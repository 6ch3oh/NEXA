"""V0.2 zero-write import readiness over the authoritative 006 pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from creator_ops.compatibility.real_legacy import CanonicalLegacyRecord
from creator_ops.services.legacy_reconciliation import (
    ImportDryRunPlan, ImportDryRunPlanner, TargetIdentity,
)


@dataclass(frozen=True)
class FinalImportPlanV02:
    dry_run: ImportDryRunPlan
    schema_version: str
    judgment_required_count: int
    invalid_count: int
    production_import_authorized: bool = False
    production_writes: tuple[str, ...] = ()
    decision_gate: str = "EXPLICIT_USER_AUTHORIZATION_REQUIRED"
    version: str = "0.2"

    @property
    def ready_for_explicit_user_authorization(self) -> bool:
        return self.dry_run.is_zero_write and not self.production_writes


class ProductionImportAuthorizationGate:
    """No executor: validates authority but never mutates data."""

    @staticmethod
    def validate(*, production_import_confirmation: bool) -> None:
        if production_import_confirmation is not True:
            raise PermissionError("production_import_confirmation=true is required")


class FinalImportPlannerV02:
    def __init__(self, planner: ImportDryRunPlanner | None = None) -> None:
        self.planner = planner or ImportDryRunPlanner()

    def plan(
        self, records: Iterable[CanonicalLegacyRecord],
        targets: Iterable[TargetIdentity] = (),
    ) -> FinalImportPlanV02:
        dry_run = self.planner.plan(
            records, targets, target_state="AUTHORITATIVE_V0.2_SCHEMA_NO_PRODUCTION_STORE",
        )
        judgment = sum(
            item.requires_manual_review for item in dry_run.entries
        )
        invalid = sum(item.invalid for item in dry_run.entries)
        return FinalImportPlanV02(
            dry_run, "creator_ops_schema_v0.2", judgment, invalid,
            production_import_authorized=False, production_writes=(),
        )
