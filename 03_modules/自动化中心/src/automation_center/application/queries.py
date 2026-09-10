"""Read-only static workflow queries over validated Domain objects."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

from automation_center.domain import (
    AutomationEvidence,
    AutomationProvider,
    AutomationWorkflow,
    EvidenceAuthority,
    EvidenceKind,
    EvidenceRef,
    ProviderRef,
    StatusValue,
    TriggerType,
    WorkflowRef,
)

from .viewmodels import (
    AutomationOverviewViewModel,
    AutomationWorkflowDetailViewModel,
    AutomationWorkflowListItemViewModel,
    EvidenceSummaryViewModel,
    MetadataItemViewModel,
    TriggerCountViewModel,
    TriggerSummaryViewModel,
    WorkflowIdentityViewModel,
)


class ApplicationProjectionError(ValueError):
    pass


class DuplicateWorkflowIdentityError(ApplicationProjectionError):
    pass


class WorkflowNotFoundError(LookupError):
    pass


_TRIGGER_LABELS = {
    TriggerType.FORM: "Form",
    TriggerType.ERROR: "Error",
    TriggerType.MANUAL: "Manual",
    TriggerType.SCHEDULE: "Schedule",
    TriggerType.WEBHOOK: "Webhook",
    TriggerType.OTHER: "Other",
    TriggerType.UNKNOWN: "Unknown",
}

_EVIDENCE_LABELS = {
    EvidenceKind.STATIC_EXPORT: "Static export / captured evidence",
    EvidenceKind.SYNTHETIC_FIXTURE: "Synthetic fixture",
    EvidenceKind.RUNTIME_API: "Runtime API observation",
    EvidenceKind.EXECUTION_RECORD: "Execution record",
    EvidenceKind.MANUAL_IMPORT: "Manual import",
}


class StaticWorkflowQueryService:
    """Query already-mapped Domain objects without provider or runtime access."""

    def __init__(
        self,
        workflows: Iterable[AutomationWorkflow],
        providers: Iterable[AutomationProvider],
        evidence: Iterable[AutomationEvidence],
    ) -> None:
        self._snapshot_selection = None
        self._workflows = tuple(workflows)
        self._workflow_by_ref: dict[WorkflowRef, AutomationWorkflow] = {}
        for workflow in self._workflows:
            if not isinstance(workflow, AutomationWorkflow):
                raise TypeError("workflows must contain AutomationWorkflow values")
            if workflow.ref in self._workflow_by_ref:
                raise DuplicateWorkflowIdentityError("duplicate provider-scoped workflow identity")
            self._workflow_by_ref[workflow.ref] = workflow

        self._provider_by_ref: dict[ProviderRef, AutomationProvider] = {}
        for provider in providers:
            if not isinstance(provider, AutomationProvider):
                raise TypeError("providers must contain AutomationProvider values")
            if provider.ref in self._provider_by_ref:
                raise ApplicationProjectionError("duplicate provider identity")
            self._provider_by_ref[provider.ref] = provider

        self._evidence_by_ref: dict[EvidenceRef, AutomationEvidence] = {}
        for item in evidence:
            if not isinstance(item, AutomationEvidence):
                raise TypeError("evidence must contain AutomationEvidence values")
            if item.ref in self._evidence_by_ref:
                raise ApplicationProjectionError("duplicate evidence identity")
            self._evidence_by_ref[item.ref] = item

        for workflow in self._workflows:
            self._validate_projection_inputs(workflow)

    @classmethod
    def from_snapshot_selection(cls, selection: object, providers: Iterable[AutomationProvider]):
        """Build queries from only the whole snapshots selected by the snapshot contract."""

        from automation_center.application.snapshots import SnapshotSelectionResult

        if not isinstance(selection, SnapshotSelectionResult):
            raise TypeError("selection must be SnapshotSelectionResult")
        service = cls(selection.selected_workflows, providers, selection.selected_evidence)
        service._snapshot_selection = selection
        return service

    def get_snapshot_selection(self, identity: WorkflowRef):
        """Return non-sensitive selection context without changing ViewModel V0.1."""

        if self._snapshot_selection is None:
            raise ApplicationProjectionError("snapshot selection context is not available")
        return self._snapshot_selection.detail_for(identity)

    def list_workflows(
        self,
        *,
        provider_kind: str | None = None,
        provider_instance_id: str | None = None,
        definition_status: StatusValue | None = None,
        trigger_type: TriggerType | None = None,
        text: str | None = None,
    ) -> tuple[AutomationWorkflowListItemViewModel, ...]:
        if definition_status is not None and not isinstance(definition_status, StatusValue):
            raise TypeError("definition_status must be StatusValue or None")
        if trigger_type is not None and not isinstance(trigger_type, TriggerType):
            raise TypeError("trigger_type must be TriggerType or None")
        if text is not None and not isinstance(text, str):
            raise TypeError("text must be a string or None")

        needle = text.strip().casefold() if text else None
        filtered = (
            workflow
            for workflow in self._workflows
            if (provider_kind is None or workflow.provider.provider_kind == provider_kind)
            and (provider_instance_id is None or workflow.provider.provider_instance_id == provider_instance_id)
            and (definition_status is None or workflow.definition_status.value is definition_status)
            and (trigger_type is None or any(item.trigger_type is trigger_type for item in workflow.triggers))
            and (needle is None or needle in workflow.display_name.casefold())
        )
        ordered = sorted(
            filtered,
            key=lambda workflow: (
                workflow.display_name.casefold(),
                workflow.provider.provider_kind,
                workflow.provider.provider_instance_id,
                workflow.ref.external_workflow_id,
            ),
        )
        return tuple(self._project_list_item(workflow) for workflow in ordered)

    def get_workflow(self, identity: WorkflowRef) -> AutomationWorkflowDetailViewModel:
        if not isinstance(identity, WorkflowRef):
            raise TypeError("identity must be WorkflowRef; display name lookup is not supported")
        try:
            workflow = self._workflow_by_ref[identity]
        except KeyError as exc:
            raise WorkflowNotFoundError("workflow identity was not found") from exc
        return self._project_detail(workflow)

    def get_overview(self) -> AutomationOverviewViewModel:
        definition_counts = Counter(workflow.definition_status.value for workflow in self._workflows)
        runtime_statuses = tuple(
            workflow.runtime_status for workflow in self._workflows if workflow.runtime_status is not None
        )
        runtime_counts = Counter(status.value for status in runtime_statuses)
        trigger_counts = Counter(
            trigger.trigger_type.value for workflow in self._workflows for trigger in workflow.triggers
        )
        return AutomationOverviewViewModel(
            total_workflows=len(self._workflows),
            definition_active_count=definition_counts[StatusValue.ACTIVE],
            definition_inactive_count=definition_counts[StatusValue.INACTIVE],
            definition_unknown_count=definition_counts[StatusValue.UNKNOWN],
            definition_unavailable_count=definition_counts[StatusValue.UNAVAILABLE],
            runtime_observed_count=len(runtime_statuses),
            runtime_not_observed_count=len(self._workflows) - len(runtime_statuses),
            runtime_active_count=runtime_counts[StatusValue.ACTIVE],
            runtime_inactive_count=runtime_counts[StatusValue.INACTIVE],
            runtime_unknown_count=runtime_counts[StatusValue.UNKNOWN],
            runtime_unavailable_count=runtime_counts[StatusValue.UNAVAILABLE],
            provider_count=len({workflow.provider for workflow in self._workflows}),
            trigger_type_summary=tuple(
                TriggerCountViewModel(trigger_type=kind, count=count)
                for kind, count in sorted(trigger_counts.items())
            ),
        )

    def _validate_projection_inputs(self, workflow: AutomationWorkflow) -> None:
        if workflow.provider not in self._provider_by_ref:
            raise ApplicationProjectionError("workflow provider is missing")
        for evidence_ref in workflow.evidence_refs:
            if evidence_ref not in self._evidence_by_ref:
                raise ApplicationProjectionError("workflow evidence is missing")

        primary = self._evidence_for(workflow.provenance.evidence_ref)
        if primary.authority is not workflow.provenance.authority:
            raise ApplicationProjectionError("workflow provenance authority does not match evidence")
        if not primary.synthetic and primary.source != workflow.provider:
            raise ApplicationProjectionError("provider evidence source does not match workflow provider")
        if workflow.definition_status.provenance.evidence_ref not in self._evidence_by_ref:
            raise ApplicationProjectionError("definition status evidence is missing")
        if workflow.runtime_status is not None:
            runtime_evidence = self._evidence_for(workflow.runtime_status.provenance.evidence_ref)
            if runtime_evidence.authority is not EvidenceAuthority.RUNTIME:
                raise ApplicationProjectionError("runtime status requires runtime authority")

    def _project_list_item(self, workflow: AutomationWorkflow) -> AutomationWorkflowListItemViewModel:
        provider = self._provider_by_ref[workflow.provider]
        primary = self._evidence_for(workflow.provenance.evidence_ref)
        runtime_status = workflow.runtime_status
        runtime_observed = runtime_status is not None
        runtime_value = runtime_status.value.value if runtime_status is not None else "not_observed"
        runtime_available = runtime_status is not None and runtime_status.value is not StatusValue.UNAVAILABLE
        return AutomationWorkflowListItemViewModel(
            identity=WorkflowIdentityViewModel(
                provider_kind=workflow.provider.provider_kind,
                provider_instance_id=workflow.provider.provider_instance_id,
                external_workflow_id=workflow.ref.external_workflow_id,
            ),
            display_name=workflow.display_name,
            provider_kind=workflow.provider.provider_kind,
            provider_instance_id=workflow.provider.provider_instance_id,
            provider_display_name=provider.display_name or workflow.provider.provider_kind,
            definition_status=workflow.definition_status.value.value,
            runtime_available=runtime_available,
            runtime_observed=runtime_observed,
            runtime_status=runtime_value,
            trigger_summary=self._trigger_summary(workflow),
            evidence_source_type=primary.kind.value,
            evidence_authority=primary.authority.value,
            evidence_synthetic=primary.synthetic,
            observed_at=workflow.provenance.observed_at.isoformat(),
            provenance_label=_EVIDENCE_LABELS[primary.kind],
        )

    def _project_detail(self, workflow: AutomationWorkflow) -> AutomationWorkflowDetailViewModel:
        return AutomationWorkflowDetailViewModel(
            summary=self._project_list_item(workflow),
            description=workflow.description,
            tags=workflow.tags,
            evidence=tuple(
                self._project_evidence(self._evidence_for(evidence_ref))
                for evidence_ref in workflow.evidence_refs
            ),
            provider_metadata=tuple(
                MetadataItemViewModel(key=key, value=value)
                for key, value in (workflow.provider_metadata.entries if workflow.provider_metadata else ())
            ),
        )

    def _trigger_summary(self, workflow: AutomationWorkflow) -> tuple[TriggerSummaryViewModel, ...]:
        counts = Counter(trigger.trigger_type for trigger in workflow.triggers)
        return tuple(
            TriggerSummaryViewModel(trigger_type=trigger_type.value, label=_TRIGGER_LABELS[trigger_type], count=count)
            for trigger_type, count in sorted(counts.items(), key=lambda item: item[0].value)
        )

    def _project_evidence(self, evidence: AutomationEvidence) -> EvidenceSummaryViewModel:
        return EvidenceSummaryViewModel(
            evidence_id=evidence.evidence_id,
            source_type=evidence.kind.value,
            source_label=_EVIDENCE_LABELS[evidence.kind],
            authority=evidence.authority.value,
            captured_at=evidence.captured_at.isoformat(),
            synthetic=evidence.synthetic,
            sanitized=evidence.sanitized,
            integrity_hash_prefix=evidence.content_hash[:12] if evidence.content_hash else None,
        )

    def _evidence_for(self, evidence_ref: EvidenceRef) -> AutomationEvidence:
        try:
            return self._evidence_by_ref[evidence_ref]
        except KeyError as exc:
            raise ApplicationProjectionError("referenced evidence is missing") from exc
