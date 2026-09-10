"""Unified static-definition and historical-result read composition V0.1.

This module combines already-validated application projections. It does not
read providers, infer Runtime state, parse raw results, or execute automation.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from enum import Enum
import json
from typing import Any

from automation_center.domain import ProviderRef, WorkflowRef

from .queries import StaticWorkflowQueryService
from .results import (
    AutomationExecutionResultRecord,
    BusinessResultStatus,
    HistoricalResultQueryService,
    ProvenanceCompleteness,
    ProviderInstanceContextSource,
    ResultExecutionIdentity,
    ResultExecutionStatus,
    ResultSourceClassification,
    result_to_primitive,
)
from .snapshots import SnapshotSelectionResult
from .viewmodels import (
    AutomationOverviewViewModel,
    EvidenceSummaryViewModel,
    TriggerSummaryViewModel,
    WorkflowIdentityViewModel,
)


UNIFIED_READ_MODEL_VERSION = "0.1"


class LatestHistoricalResultState(str, Enum):
    NONE = "none"
    SELECTED = "selected"
    AMBIGUOUS = "ambiguous"


class UnifiedWorkflowClassification(str, Enum):
    STATIC_WITH_HISTORICAL_RESULTS = "static_with_historical_results"
    STATIC_ONLY_NO_RECORDED_RESULTS = "static_only_no_recorded_results"


class OrphanResultClassification(str, Enum):
    RESULT_ONLY_ORPHAN_STATIC_NOT_OBSERVED = "result_only_orphan_static_not_observed"


class UnifiedDiagnosticCode(str, Enum):
    CALLER_DECLARED_RESULT_IDENTITY = "caller_declared_result_identity"
    PROVIDER_INSTANCE_UNRESOLVED = "provider_instance_unresolved"
    ORPHAN_STATIC_NOT_OBSERVED = "orphan_static_not_observed"
    NO_RECORDED_HISTORICAL_RESULTS = "no_recorded_historical_results"
    UNDATED_RESULT_EXCLUDED_FROM_LATEST = "undated_result_excluded_from_latest"
    AMBIGUOUS_LATEST_RESULT = "ambiguous_latest_result"
    SNAPSHOT_SELECTION_NOT_SUPPLIED = "snapshot_selection_not_supplied"


@dataclass(frozen=True, slots=True)
class UnifiedReadDiagnostic:
    code: UnifiedDiagnosticCode
    message: str


@dataclass(frozen=True, slots=True)
class UnifiedSnapshotSelectionViewModel:
    policy: str
    selection_state: str
    selected_evidence_id: str | None
    snapshot_count: int
    has_other_snapshots: bool
    selection_reason: str | None
    diagnostic_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class HistoricalResultEvidenceSummaryViewModel:
    source_classification: str
    execution_engine_reality: str
    environment_class: str
    dependency_class: str
    provenance_completeness: str
    source_artifact_count: int
    source_artifact_kinds: tuple[str, ...]
    source_integrity_prefix: str
    sanitized_result_integrity_prefix: str


@dataclass(frozen=True, slots=True)
class UnifiedHistoricalResultViewModel:
    record_id: str
    execution_identity: ResultExecutionIdentity | None
    workflow_identity: WorkflowIdentityViewModel | None
    provider_kind: str
    provider_instance_id: str | None
    provider_instance_context_source: str
    caller_declared_context: bool
    workflow_external_id: str
    execution_external_id: str
    execution_status: str
    business_status: str
    result_type: str
    observed_at: str | None
    dated: bool
    safe_result_summary: str
    evidence: HistoricalResultEvidenceSummaryViewModel
    diagnostic_codes: tuple[str, ...]
    historical_result_only: bool = True
    current_runtime_inference_allowed: bool = False
    schema_version: str = UNIFIED_READ_MODEL_VERSION


@dataclass(frozen=True, slots=True)
class UnifiedHistoricalSummaryViewModel:
    historical_result_count: int
    execution_success_count: int
    execution_failed_count: int
    execution_unknown_count: int
    execution_not_observed_count: int
    business_success_count: int
    business_partial_count: int
    business_failed_count: int
    business_unknown_count: int
    business_not_reported_count: int
    sandbox_result_count: int
    undated_result_count: int
    provenance_complete_count: int
    provenance_partial_count: int
    provenance_completeness: str


@dataclass(frozen=True, slots=True)
class AutomationWorkflowReadModel:
    identity: WorkflowIdentityViewModel
    display_name: str
    provider_kind: str
    provider_instance_id: str
    provider_display_name: str
    definition_status: str
    trigger_summary: tuple[TriggerSummaryViewModel, ...]
    static_evidence: tuple[EvidenceSummaryViewModel, ...]
    snapshot_selection: UnifiedSnapshotSelectionViewModel
    workflow_classification: str
    runtime_status: str
    runtime_observed: bool
    runtime_available: bool
    historical_summary: UnifiedHistoricalSummaryViewModel
    latest_result_state: str
    latest_historical_result: UnifiedHistoricalResultViewModel | None
    latest_execution_status: str | None
    latest_business_status: str | None
    caller_declared_result_identity: bool
    historical_results: tuple[UnifiedHistoricalResultViewModel, ...]
    diagnostics: tuple[UnifiedReadDiagnostic, ...]
    current_runtime_inference_allowed: bool = False
    schema_version: str = UNIFIED_READ_MODEL_VERSION


@dataclass(frozen=True, slots=True)
class UnresolvedAutomationResultViewModel:
    result: UnifiedHistoricalResultViewModel
    unresolved_reason: str
    known_provider_kind: str
    provider_instance_state: str
    diagnostics: tuple[UnifiedReadDiagnostic, ...]
    schema_version: str = UNIFIED_READ_MODEL_VERSION


@dataclass(frozen=True, slots=True)
class OrphanAutomationResultWorkflowViewModel:
    identity: WorkflowIdentityViewModel
    classification: str
    runtime_status: str
    runtime_observed: bool
    historical_summary: UnifiedHistoricalSummaryViewModel
    latest_result_state: str
    latest_historical_result: UnifiedHistoricalResultViewModel | None
    historical_results: tuple[UnifiedHistoricalResultViewModel, ...]
    diagnostics: tuple[UnifiedReadDiagnostic, ...]
    current_runtime_inference_allowed: bool = False
    schema_version: str = UNIFIED_READ_MODEL_VERSION


@dataclass(frozen=True, slots=True)
class UnifiedAutomationOverviewViewModel:
    static_overview: AutomationOverviewViewModel
    total_workflows: int
    workflows_with_historical_results: int
    workflows_without_observed_historical_results: int
    unresolved_result_count: int
    orphan_result_workflow_count: int
    orphan_result_count: int
    historical_result_count: int
    historical_execution_success_count: int
    historical_execution_failed_count: int
    historical_execution_unknown_count: int
    historical_execution_not_observed_count: int
    historical_business_success_count: int
    historical_business_partial_count: int
    historical_business_failed_count: int
    historical_business_unknown_count: int
    historical_business_not_reported_count: int
    sandbox_result_count: int
    undated_result_count: int
    runtime_observed_count: int
    runtime_not_observed_count: int
    runtime_status: str = "not_observed"
    current_runtime_inference_allowed: bool = False
    schema_version: str = UNIFIED_READ_MODEL_VERSION


class UnifiedReadProjectionError(ValueError):
    pass


class UnifiedWorkflowNotFoundError(LookupError):
    pass


class UnifiedResultNotFoundError(LookupError):
    pass


class UnifiedAutomationQueryService:
    """Compose static definitions and historical results without Runtime inference."""

    def __init__(
        self,
        static_query: StaticWorkflowQueryService,
        historical_results: Iterable[AutomationExecutionResultRecord],
        *,
        snapshot_selection: SnapshotSelectionResult | None = None,
    ) -> None:
        if not isinstance(static_query, StaticWorkflowQueryService):
            raise TypeError("static_query must be StaticWorkflowQueryService")
        if snapshot_selection is not None and not isinstance(
            snapshot_selection, SnapshotSelectionResult
        ):
            raise TypeError("snapshot_selection must be SnapshotSelectionResult or None")

        self._static_query = static_query
        self._snapshot_selection = snapshot_selection
        self._records = tuple(historical_results)
        self._historical_query = HistoricalResultQueryService(self._records)
        self._record_by_execution_identity: dict[
            ResultExecutionIdentity, AutomationExecutionResultRecord
        ] = {
            record.execution_identity: record
            for record in self._records
            if record.execution_identity is not None
        }

        static_items = static_query.list_workflows()
        self._static_by_ref = {
            self._workflow_ref(item.identity): static_query.get_workflow(
                self._workflow_ref(item.identity)
            )
            for item in static_items
        }
        if any(detail.summary.runtime_observed for detail in self._static_by_ref.values()):
            raise UnifiedReadProjectionError(
                "Unified Read Model V0.1 accepts no Runtime observations"
            )
        self._validate_snapshot_selection()

        self._matched_records: dict[WorkflowRef, list[AutomationExecutionResultRecord]] = defaultdict(list)
        self._orphan_records: dict[WorkflowRef, list[AutomationExecutionResultRecord]] = defaultdict(list)
        self._unresolved_records: list[AutomationExecutionResultRecord] = []
        for record in self._records:
            identity = self._result_workflow_ref(record)
            if identity is None:
                self._unresolved_records.append(record)
            elif identity in self._static_by_ref:
                self._matched_records[identity].append(record)
            else:
                self._orphan_records[identity].append(record)

        self._workflow_models = tuple(
            self._build_workflow_model(identity, self._static_by_ref[identity])
            for identity in sorted(self._static_by_ref, key=self._workflow_ref_key)
        )
        self._workflow_model_by_ref = {
            self._workflow_ref(item.identity): item for item in self._workflow_models
        }
        self._orphan_models = tuple(
            self._build_orphan_model(identity, self._orphan_records[identity])
            for identity in sorted(self._orphan_records, key=self._workflow_ref_key)
        )
        self._unresolved_models = tuple(
            self._build_unresolved_model(record)
            for record in self._sort_records(self._unresolved_records)
        )

    def list_workflow_read_models(self) -> tuple[AutomationWorkflowReadModel, ...]:
        return tuple(
            sorted(
                self._workflow_models,
                key=lambda item: (
                    item.display_name.casefold(),
                    item.provider_kind,
                    item.provider_instance_id,
                    item.identity.external_workflow_id,
                ),
            )
        )

    def get_workflow_read_model(self, identity: WorkflowRef) -> AutomationWorkflowReadModel:
        if not isinstance(identity, WorkflowRef):
            raise TypeError("identity must be WorkflowRef; name lookup is not supported")
        try:
            return self._workflow_model_by_ref[identity]
        except KeyError as exc:
            raise UnifiedWorkflowNotFoundError("unified workflow identity was not found") from exc

    def list_historical_results(
        self,
        *,
        workflow_identity: WorkflowRef | None = None,
    ) -> tuple[UnifiedHistoricalResultViewModel, ...]:
        if workflow_identity is not None and not isinstance(workflow_identity, WorkflowRef):
            raise TypeError("workflow_identity must be WorkflowRef or None")
        records = (
            self._records
            if workflow_identity is None
            else tuple(
                record
                for record in self._records
                if self._result_workflow_ref(record) == workflow_identity
            )
        )
        return tuple(self._project_result(record) for record in self._sort_records(records))

    def get_result_by_execution_identity(
        self,
        identity: ResultExecutionIdentity,
    ) -> UnifiedHistoricalResultViewModel:
        if not isinstance(identity, ResultExecutionIdentity):
            raise TypeError("identity must be ResultExecutionIdentity")
        try:
            return self._project_result(self._record_by_execution_identity[identity])
        except KeyError as exc:
            raise UnifiedResultNotFoundError("historical execution result was not found") from exc

    def list_unresolved_results(self) -> tuple[UnresolvedAutomationResultViewModel, ...]:
        return self._unresolved_models

    def list_orphan_results(self) -> tuple[OrphanAutomationResultWorkflowViewModel, ...]:
        return self._orphan_models

    def get_overview(self) -> UnifiedAutomationOverviewViewModel:
        static_overview = self._static_query.get_overview()
        summary = self._summarize(self._records)
        with_results = sum(
            bool(self._matched_records.get(identity)) for identity in self._static_by_ref
        )
        return UnifiedAutomationOverviewViewModel(
            static_overview=static_overview,
            total_workflows=len(self._static_by_ref),
            workflows_with_historical_results=with_results,
            workflows_without_observed_historical_results=(
                len(self._static_by_ref) - with_results
            ),
            unresolved_result_count=len(self._unresolved_records),
            orphan_result_workflow_count=len(self._orphan_records),
            orphan_result_count=sum(len(records) for records in self._orphan_records.values()),
            historical_result_count=summary.historical_result_count,
            historical_execution_success_count=summary.execution_success_count,
            historical_execution_failed_count=summary.execution_failed_count,
            historical_execution_unknown_count=summary.execution_unknown_count,
            historical_execution_not_observed_count=summary.execution_not_observed_count,
            historical_business_success_count=summary.business_success_count,
            historical_business_partial_count=summary.business_partial_count,
            historical_business_failed_count=summary.business_failed_count,
            historical_business_unknown_count=summary.business_unknown_count,
            historical_business_not_reported_count=summary.business_not_reported_count,
            sandbox_result_count=summary.sandbox_result_count,
            undated_result_count=summary.undated_result_count,
            runtime_observed_count=0,
            runtime_not_observed_count=len(self._static_by_ref),
        )

    def _build_workflow_model(self, identity: WorkflowRef, static_detail: Any) -> AutomationWorkflowReadModel:
        records = tuple(self._matched_records.get(identity, ()))
        ordered_records = self._sort_records(records)
        projected_results = tuple(self._project_result(record) for record in ordered_records)
        latest_state, latest_record, latest_diagnostics = self._select_latest(records)
        latest = self._project_result(latest_record) if latest_record is not None else None
        summary = self._summarize(records)
        diagnostics = list(latest_diagnostics)
        caller_declared = any(
            record.provider_instance_context_source
            is ProviderInstanceContextSource.CALLER_DECLARED
            for record in records
        )
        if caller_declared:
            diagnostics.append(
                UnifiedReadDiagnostic(
                    UnifiedDiagnosticCode.CALLER_DECLARED_RESULT_IDENTITY,
                    "Historical result join uses caller-declared provider instance context",
                )
            )
        if not records:
            diagnostics.append(
                UnifiedReadDiagnostic(
                    UnifiedDiagnosticCode.NO_RECORDED_HISTORICAL_RESULTS,
                    "No historical result is recorded; this does not prove the workflow never executed",
                )
            )
        snapshot = self._snapshot_view(identity)
        if self._snapshot_selection is None:
            diagnostics.append(
                UnifiedReadDiagnostic(
                    UnifiedDiagnosticCode.SNAPSHOT_SELECTION_NOT_SUPPLIED,
                    "Snapshot selection context was not supplied to the unified composition",
                )
            )
        summary_item = static_detail.summary
        return AutomationWorkflowReadModel(
            identity=summary_item.identity,
            display_name=summary_item.display_name,
            provider_kind=summary_item.provider_kind,
            provider_instance_id=summary_item.provider_instance_id,
            provider_display_name=summary_item.provider_display_name,
            definition_status=summary_item.definition_status,
            trigger_summary=summary_item.trigger_summary,
            static_evidence=static_detail.evidence,
            snapshot_selection=snapshot,
            workflow_classification=(
                UnifiedWorkflowClassification.STATIC_WITH_HISTORICAL_RESULTS.value
                if records
                else UnifiedWorkflowClassification.STATIC_ONLY_NO_RECORDED_RESULTS.value
            ),
            runtime_status="not_observed",
            runtime_observed=False,
            runtime_available=False,
            historical_summary=summary,
            latest_result_state=latest_state.value,
            latest_historical_result=latest,
            latest_execution_status=latest.execution_status if latest is not None else None,
            latest_business_status=latest.business_status if latest is not None else None,
            caller_declared_result_identity=caller_declared,
            historical_results=projected_results,
            diagnostics=tuple(diagnostics),
        )

    def _build_orphan_model(
        self,
        identity: WorkflowRef,
        records: Iterable[AutomationExecutionResultRecord],
    ) -> OrphanAutomationResultWorkflowViewModel:
        materialized = tuple(records)
        latest_state, latest_record, latest_diagnostics = self._select_latest(materialized)
        diagnostics = (
            UnifiedReadDiagnostic(
                UnifiedDiagnosticCode.ORPHAN_STATIC_NOT_OBSERVED,
                "Historical results have a complete identity but no supplied static definition",
            ),
        ) + latest_diagnostics
        return OrphanAutomationResultWorkflowViewModel(
            identity=self._identity_view(identity),
            classification=(
                OrphanResultClassification.RESULT_ONLY_ORPHAN_STATIC_NOT_OBSERVED.value
            ),
            runtime_status="not_observed",
            runtime_observed=False,
            historical_summary=self._summarize(materialized),
            latest_result_state=latest_state.value,
            latest_historical_result=(
                self._project_result(latest_record) if latest_record is not None else None
            ),
            historical_results=tuple(
                self._project_result(record) for record in self._sort_records(materialized)
            ),
            diagnostics=diagnostics,
        )

    def _build_unresolved_model(
        self,
        record: AutomationExecutionResultRecord,
    ) -> UnresolvedAutomationResultViewModel:
        return UnresolvedAutomationResultViewModel(
            result=self._project_result(record),
            unresolved_reason=UnifiedDiagnosticCode.PROVIDER_INSTANCE_UNRESOLVED.value,
            known_provider_kind=record.provider_kind,
            provider_instance_state=record.provider_instance_context_source.value,
            diagnostics=(
                UnifiedReadDiagnostic(
                    UnifiedDiagnosticCode.PROVIDER_INSTANCE_UNRESOLVED,
                    "Provider instance is unresolved; the result was not joined to a workflow",
                ),
            ),
        )

    def _snapshot_view(self, identity: WorkflowRef) -> UnifiedSnapshotSelectionViewModel:
        if self._snapshot_selection is None:
            return UnifiedSnapshotSelectionViewModel(
                policy="not_supplied",
                selection_state="not_supplied",
                selected_evidence_id=None,
                snapshot_count=1,
                has_other_snapshots=False,
                selection_reason=None,
                diagnostic_codes=(UnifiedDiagnosticCode.SNAPSHOT_SELECTION_NOT_SUPPLIED.value,),
            )
        detail = self._snapshot_selection.detail_for(identity)
        return UnifiedSnapshotSelectionViewModel(
            policy=detail.policy.value,
            selection_state=detail.selection_state.value,
            selected_evidence_id=detail.selected_evidence_id,
            snapshot_count=detail.snapshot_count,
            has_other_snapshots=detail.has_other_snapshots,
            selection_reason=detail.selection_reason,
            diagnostic_codes=tuple(item.code.value for item in detail.diagnostics),
        )

    @staticmethod
    def _project_result(record: AutomationExecutionResultRecord) -> UnifiedHistoricalResultViewModel:
        evidence = record.source_evidence
        workflow_identity = None
        if record.provider_instance_id is not None:
            workflow_identity = WorkflowIdentityViewModel(
                provider_kind=record.provider_kind,
                provider_instance_id=record.provider_instance_id,
                external_workflow_id=record.workflow_external_id,
            )
        return UnifiedHistoricalResultViewModel(
            record_id=record.record_id,
            execution_identity=record.execution_identity,
            workflow_identity=workflow_identity,
            provider_kind=record.provider_kind,
            provider_instance_id=record.provider_instance_id,
            provider_instance_context_source=record.provider_instance_context_source.value,
            caller_declared_context=(
                record.provider_instance_context_source
                is ProviderInstanceContextSource.CALLER_DECLARED
            ),
            workflow_external_id=record.workflow_external_id,
            execution_external_id=record.execution_external_id,
            execution_status=record.execution_status.value,
            business_status=record.business_status.value,
            result_type=record.result_type.value,
            observed_at=record.observed_at.isoformat() if record.observed_at else None,
            dated=record.observed_at is not None,
            safe_result_summary=record.safe_result_summary,
            evidence=HistoricalResultEvidenceSummaryViewModel(
                source_classification=evidence.source_classification.value,
                execution_engine_reality=evidence.execution_engine_reality.value,
                environment_class=evidence.environment_class.value,
                dependency_class=evidence.dependency_class.value,
                provenance_completeness=evidence.provenance_completeness.value,
                source_artifact_count=len(evidence.source_artifacts),
                source_artifact_kinds=tuple(
                    item.artifact_kind.value for item in evidence.source_artifacts
                ),
                source_integrity_prefix=evidence.source_integrity_sha256[:12],
                sanitized_result_integrity_prefix=record.sanitized_result_sha256[:12],
            ),
            diagnostic_codes=tuple(item.code.value for item in record.diagnostics),
        )

    @staticmethod
    def _summarize(
        records: Iterable[AutomationExecutionResultRecord],
    ) -> UnifiedHistoricalSummaryViewModel:
        materialized = tuple(records)
        execution = Counter(record.execution_status for record in materialized)
        business = Counter(record.business_status for record in materialized)
        complete = sum(
            record.source_evidence.provenance_completeness
            is ProvenanceCompleteness.COMPLETE
            for record in materialized
        )
        partial = len(materialized) - complete
        provenance = "not_observed" if not materialized else ("complete" if partial == 0 else "partial")
        return UnifiedHistoricalSummaryViewModel(
            historical_result_count=len(materialized),
            execution_success_count=execution[ResultExecutionStatus.SUCCESS],
            execution_failed_count=execution[ResultExecutionStatus.FAILED],
            execution_unknown_count=execution[ResultExecutionStatus.UNKNOWN],
            execution_not_observed_count=execution[ResultExecutionStatus.NOT_OBSERVED],
            business_success_count=business[BusinessResultStatus.SUCCESS],
            business_partial_count=business[BusinessResultStatus.PARTIAL],
            business_failed_count=business[BusinessResultStatus.FAILED],
            business_unknown_count=business[BusinessResultStatus.UNKNOWN],
            business_not_reported_count=business[BusinessResultStatus.NOT_REPORTED],
            sandbox_result_count=sum(
                record.source_evidence.source_classification
                is ResultSourceClassification.SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES
                for record in materialized
            ),
            undated_result_count=sum(record.observed_at is None for record in materialized),
            provenance_complete_count=complete,
            provenance_partial_count=partial,
            provenance_completeness=provenance,
        )

    @classmethod
    def _select_latest(
        cls,
        records: Iterable[AutomationExecutionResultRecord],
    ) -> tuple[
        LatestHistoricalResultState,
        AutomationExecutionResultRecord | None,
        tuple[UnifiedReadDiagnostic, ...],
    ]:
        materialized = tuple(records)
        dated = tuple(record for record in materialized if record.observed_at is not None)
        diagnostics: list[UnifiedReadDiagnostic] = []
        if len(dated) != len(materialized):
            diagnostics.append(
                UnifiedReadDiagnostic(
                    UnifiedDiagnosticCode.UNDATED_RESULT_EXCLUDED_FROM_LATEST,
                    "Undated historical results were excluded from latest selection",
                )
            )
        if not dated:
            return LatestHistoricalResultState.NONE, None, tuple(diagnostics)
        latest_time = max(record.observed_at for record in dated)
        latest = tuple(record for record in dated if record.observed_at == latest_time)
        if len(latest) == 1:
            return LatestHistoricalResultState.SELECTED, latest[0], tuple(diagnostics)
        diagnostics.append(
            UnifiedReadDiagnostic(
                UnifiedDiagnosticCode.AMBIGUOUS_LATEST_RESULT,
                "Multiple historical results share the greatest trusted timestamp",
            )
        )
        return LatestHistoricalResultState.AMBIGUOUS, None, tuple(diagnostics)

    @classmethod
    def _sort_records(
        cls,
        records: Iterable[AutomationExecutionResultRecord],
    ) -> tuple[AutomationExecutionResultRecord, ...]:
        materialized = tuple(records)
        dated = sorted(
            (record for record in materialized if record.observed_at is not None),
            key=cls._record_identity_key,
        )
        dated.sort(key=lambda record: record.observed_at, reverse=True)
        undated = sorted(
            (record for record in materialized if record.observed_at is None),
            key=cls._record_identity_key,
        )
        return tuple(dated + undated)

    def _validate_snapshot_selection(self) -> None:
        if self._snapshot_selection is None:
            return
        selected = {snapshot.identity for snapshot in self._snapshot_selection.selected_snapshots}
        if selected != set(self._static_by_ref):
            raise UnifiedReadProjectionError(
                "snapshot selection and static query selected identities must match"
            )

    @staticmethod
    def _workflow_ref(identity: WorkflowIdentityViewModel) -> WorkflowRef:
        return WorkflowRef(
            ProviderRef(identity.provider_kind, identity.provider_instance_id),
            identity.external_workflow_id,
        )

    @staticmethod
    def _identity_view(identity: WorkflowRef) -> WorkflowIdentityViewModel:
        return WorkflowIdentityViewModel(
            provider_kind=identity.provider.provider_kind,
            provider_instance_id=identity.provider.provider_instance_id,
            external_workflow_id=identity.external_workflow_id,
        )

    @staticmethod
    def _result_workflow_ref(record: AutomationExecutionResultRecord) -> WorkflowRef | None:
        if record.provider_instance_id is None:
            return None
        return WorkflowRef(
            ProviderRef(record.provider_kind, record.provider_instance_id),
            record.workflow_external_id,
        )

    @staticmethod
    def _workflow_ref_key(identity: WorkflowRef) -> tuple[str, str, str]:
        return (
            identity.provider.provider_kind,
            identity.provider.provider_instance_id,
            identity.external_workflow_id,
        )

    @staticmethod
    def _record_identity_key(
        record: AutomationExecutionResultRecord,
    ) -> tuple[str, str, str, str, str]:
        return (
            record.provider_kind,
            record.provider_instance_id or "",
            record.workflow_external_id,
            record.execution_external_id,
            record.record_id,
        )


def serialize_unified_read_model(value: Any) -> str:
    """Serialize a unified read projection deterministically."""

    return json.dumps(
        result_to_primitive(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
