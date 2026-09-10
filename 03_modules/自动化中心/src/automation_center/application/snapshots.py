"""Static workflow snapshot grouping and selection contract V0.1."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum

from automation_center.domain import (
    AutomationEvidence,
    AutomationWorkflow,
    EvidenceKind,
    WorkflowRef,
)


class SnapshotSelectionPolicy(str, Enum):
    STRICT_UNIQUE = "strict_unique"
    EXPLICIT = "explicit"
    LATEST_OBSERVED = "latest_observed"


class SnapshotTimeKind(str, Enum):
    EVIDENCE_CAPTURED_AT = "evidence_captured_at"
    WORKFLOW_OBSERVED_AT = "workflow_observed_at"
    UNAVAILABLE = "unavailable"


class SnapshotSelectionState(str, Enum):
    UNSELECTED = "unselected"
    SELECTED = "selected"
    AMBIGUOUS = "ambiguous"
    UNRESOLVED = "unresolved"


class SnapshotDiagnosticCode(str, Enum):
    SELECTED_UNIQUE = "selected_unique"
    SELECTED_EXPLICIT = "selected_explicit"
    SELECTED_LATEST = "selected_latest"
    EQUIVALENT_CONTENT_DEDUPLICATED = "equivalent_content_deduplicated"
    DUPLICATE_SNAPSHOTS = "duplicate_snapshots"
    EXPLICIT_EVIDENCE_NOT_FOUND = "explicit_evidence_not_found"
    EXPLICIT_EVIDENCE_NOT_UNIQUE = "explicit_evidence_not_unique"
    MISSING_OBSERVED_AT = "missing_observed_at"
    INCOMPATIBLE_TIME_SEMANTICS = "incompatible_time_semantics"
    AMBIGUOUS_LATEST = "ambiguous_latest"


@dataclass(frozen=True, slots=True)
class SnapshotDiagnostic:
    code: SnapshotDiagnosticCode
    message: str


@dataclass(frozen=True, slots=True)
class StaticWorkflowSnapshot:
    workflow: AutomationWorkflow
    evidence: AutomationEvidence
    time_kind: SnapshotTimeKind = SnapshotTimeKind.EVIDENCE_CAPTURED_AT

    def __post_init__(self) -> None:
        if not isinstance(self.workflow, AutomationWorkflow):
            raise TypeError("workflow must be AutomationWorkflow")
        if not isinstance(self.evidence, AutomationEvidence):
            raise TypeError("evidence must be AutomationEvidence")
        if not isinstance(self.time_kind, SnapshotTimeKind):
            raise TypeError("time_kind must be SnapshotTimeKind")
        if self.evidence.kind not in {EvidenceKind.STATIC_EXPORT, EvidenceKind.SYNTHETIC_FIXTURE}:
            raise ValueError("static snapshots require static export or synthetic fixture evidence")
        if self.workflow.provenance.evidence_ref != self.evidence.ref:
            raise ValueError("snapshot evidence must be the workflow primary provenance evidence")
        if self.workflow.provenance.authority is not self.evidence.authority:
            raise ValueError("snapshot evidence authority must match workflow provenance")

    @property
    def identity(self) -> WorkflowRef:
        return self.workflow.ref

    @property
    def evidence_id(self) -> str:
        return self.evidence.evidence_id

    @property
    def content_hash(self) -> str | None:
        return self.evidence.content_hash

    @property
    def selection_time(self) -> datetime | None:
        if self.time_kind is SnapshotTimeKind.EVIDENCE_CAPTURED_AT:
            return self.evidence.captured_at
        if self.time_kind is SnapshotTimeKind.WORKFLOW_OBSERVED_AT:
            return self.workflow.provenance.observed_at
        return None


@dataclass(frozen=True, slots=True)
class StaticWorkflowSnapshotGroup:
    identity: WorkflowRef
    snapshots: tuple[StaticWorkflowSnapshot, ...]
    selection_state: SnapshotSelectionState = SnapshotSelectionState.UNSELECTED
    selected_snapshot: StaticWorkflowSnapshot | None = None
    selection_reason: str | None = None
    diagnostics: tuple[SnapshotDiagnostic, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.identity, WorkflowRef):
            raise TypeError("identity must be WorkflowRef")
        snapshots = tuple(self.snapshots)
        if not snapshots:
            raise ValueError("snapshot group must not be empty")
        if not all(isinstance(item, StaticWorkflowSnapshot) for item in snapshots):
            raise TypeError("snapshots must contain StaticWorkflowSnapshot values")
        if any(item.identity != self.identity for item in snapshots):
            raise ValueError("all snapshots in a group must share one workflow identity")
        object.__setattr__(self, "snapshots", tuple(sorted(snapshots, key=lambda item: item.evidence_id)))
        if self.selected_snapshot is not None and self.selected_snapshot not in snapshots:
            raise ValueError("selected snapshot must belong to its group")
        if self.selection_state is SnapshotSelectionState.SELECTED and self.selected_snapshot is None:
            raise ValueError("selected state requires a selected snapshot")
        if self.selection_state is not SnapshotSelectionState.SELECTED and self.selected_snapshot is not None:
            raise ValueError("only selected state may contain a selected snapshot")

    @property
    def snapshot_count(self) -> int:
        return len(self.snapshots)


@dataclass(frozen=True, slots=True)
class SnapshotSelectionOverview:
    snapshot_groups: int
    selected_workflows: int
    ambiguous_workflows: int
    unresolved_workflows: int


@dataclass(frozen=True, slots=True)
class SnapshotSelectionDetail:
    identity: WorkflowRef
    policy: SnapshotSelectionPolicy
    selection_state: SnapshotSelectionState
    selected_evidence_id: str | None
    snapshot_count: int
    has_other_snapshots: bool
    selection_reason: str | None
    diagnostics: tuple[SnapshotDiagnostic, ...]


@dataclass(frozen=True, slots=True)
class SnapshotSelectionResult:
    policy: SnapshotSelectionPolicy
    groups: tuple[StaticWorkflowSnapshotGroup, ...]

    @property
    def selected_snapshots(self) -> tuple[StaticWorkflowSnapshot, ...]:
        return tuple(
            group.selected_snapshot
            for group in self.groups
            if group.selection_state is SnapshotSelectionState.SELECTED and group.selected_snapshot is not None
        )

    @property
    def selected_workflows(self) -> tuple[AutomationWorkflow, ...]:
        return tuple(snapshot.workflow for snapshot in self.selected_snapshots)

    @property
    def selected_evidence(self) -> tuple[AutomationEvidence, ...]:
        return tuple(snapshot.evidence for snapshot in self.selected_snapshots)

    @property
    def overview(self) -> SnapshotSelectionOverview:
        ambiguous = sum(group.selection_state is SnapshotSelectionState.AMBIGUOUS for group in self.groups)
        unresolved = sum(group.selection_state is SnapshotSelectionState.UNRESOLVED for group in self.groups)
        return SnapshotSelectionOverview(
            snapshot_groups=len(self.groups),
            selected_workflows=len(self.selected_snapshots),
            ambiguous_workflows=ambiguous,
            unresolved_workflows=unresolved,
        )

    def detail_for(self, identity: WorkflowRef) -> SnapshotSelectionDetail:
        if not isinstance(identity, WorkflowRef):
            raise TypeError("identity must be WorkflowRef")
        try:
            group = next(item for item in self.groups if item.identity == identity)
        except StopIteration as exc:
            raise LookupError("workflow snapshot identity was not found") from exc
        selected_evidence_id = (
            group.selected_snapshot.evidence_id if group.selected_snapshot is not None else None
        )
        return SnapshotSelectionDetail(
            identity=group.identity,
            policy=self.policy,
            selection_state=group.selection_state,
            selected_evidence_id=selected_evidence_id,
            snapshot_count=group.snapshot_count,
            has_other_snapshots=group.snapshot_count > 1,
            selection_reason=group.selection_reason,
            diagnostics=group.diagnostics,
        )


def group_static_workflow_snapshots(
    snapshots: Iterable[StaticWorkflowSnapshot],
) -> tuple[StaticWorkflowSnapshotGroup, ...]:
    grouped: dict[WorkflowRef, list[StaticWorkflowSnapshot]] = defaultdict(list)
    for snapshot in snapshots:
        if not isinstance(snapshot, StaticWorkflowSnapshot):
            raise TypeError("snapshots must contain StaticWorkflowSnapshot values")
        grouped[snapshot.identity].append(snapshot)
    return tuple(
        StaticWorkflowSnapshotGroup(identity=identity, snapshots=tuple(grouped[identity]))
        for identity in sorted(
            grouped,
            key=lambda item: (
                item.provider.provider_kind,
                item.provider.provider_instance_id,
                item.external_workflow_id,
            ),
        )
    )


class StaticWorkflowSnapshotSelector:
    """Select whole static snapshots without field-level merging."""

    def select(
        self,
        snapshots: Iterable[StaticWorkflowSnapshot],
        *,
        policy: SnapshotSelectionPolicy = SnapshotSelectionPolicy.STRICT_UNIQUE,
        explicit_evidence_ids: Mapping[WorkflowRef, str] | None = None,
    ) -> SnapshotSelectionResult:
        if not isinstance(policy, SnapshotSelectionPolicy):
            raise TypeError("policy must be SnapshotSelectionPolicy")
        groups = group_static_workflow_snapshots(snapshots)
        explicit = dict(explicit_evidence_ids or {})
        known_identities = {group.identity for group in groups}
        if policy is SnapshotSelectionPolicy.EXPLICIT and any(identity not in known_identities for identity in explicit):
            raise ValueError("explicit selection contains an unknown workflow identity")
        selected_groups = tuple(self._select_group(group, policy, explicit.get(group.identity)) for group in groups)
        return SnapshotSelectionResult(policy=policy, groups=selected_groups)

    def _select_group(
        self,
        group: StaticWorkflowSnapshotGroup,
        policy: SnapshotSelectionPolicy,
        explicit_evidence_id: str | None,
    ) -> StaticWorkflowSnapshotGroup:
        if policy is SnapshotSelectionPolicy.STRICT_UNIQUE:
            if group.snapshot_count == 1:
                return self._selected(
                    group,
                    group.snapshots[0],
                    "strict_unique_single_snapshot",
                    SnapshotDiagnosticCode.SELECTED_UNIQUE,
                    "The identity has exactly one snapshot",
                )
            return self._ambiguous(
                group,
                "strict_unique_duplicate_snapshots",
                SnapshotDiagnosticCode.DUPLICATE_SNAPSHOTS,
                "STRICT_UNIQUE refuses an identity with multiple snapshots",
            )

        if policy is SnapshotSelectionPolicy.EXPLICIT:
            if not isinstance(explicit_evidence_id, str) or not explicit_evidence_id:
                return self._unresolved(
                    group,
                    "explicit_evidence_missing",
                    SnapshotDiagnosticCode.EXPLICIT_EVIDENCE_NOT_FOUND,
                    "EXPLICIT selection requires an evidence id for every identity",
                )
            matches = tuple(item for item in group.snapshots if item.evidence_id == explicit_evidence_id)
            if len(matches) == 1:
                return self._selected(
                    group,
                    matches[0],
                    "explicit_evidence_match",
                    SnapshotDiagnosticCode.SELECTED_EXPLICIT,
                    "The explicitly requested evidence id matched exactly once",
                )
            if not matches:
                return self._unresolved(
                    group,
                    "explicit_evidence_not_found",
                    SnapshotDiagnosticCode.EXPLICIT_EVIDENCE_NOT_FOUND,
                    "The explicitly requested evidence id was not found",
                )
            return self._ambiguous(
                group,
                "explicit_evidence_not_unique",
                SnapshotDiagnosticCode.EXPLICIT_EVIDENCE_NOT_UNIQUE,
                "The explicitly requested evidence id matched more than once",
            )

        if policy is SnapshotSelectionPolicy.LATEST_OBSERVED:
            if any(item.selection_time is None for item in group.snapshots):
                return self._unresolved(
                    group,
                    "missing_comparable_observed_time",
                    SnapshotDiagnosticCode.MISSING_OBSERVED_AT,
                    "LATEST_OBSERVED requires a comparable time for every candidate",
                )
            if len({item.time_kind for item in group.snapshots}) != 1:
                return self._unresolved(
                    group,
                    "incompatible_time_semantics",
                    SnapshotDiagnosticCode.INCOMPATIBLE_TIME_SEMANTICS,
                    "LATEST_OBSERVED requires compatible time semantics",
                )
            latest_time = max(item.selection_time for item in group.snapshots if item.selection_time is not None)
            latest = tuple(item for item in group.snapshots if item.selection_time == latest_time)
            if len(latest) == 1:
                return self._selected(
                    group,
                    latest[0],
                    "latest_comparable_observation",
                    SnapshotDiagnosticCode.SELECTED_LATEST,
                    "Selected the snapshot with the latest comparable static observation time",
                )
            hashes = {item.content_hash for item in latest}
            if len(hashes) == 1 and None not in hashes:
                representative = min(latest, key=lambda item: item.evidence_id)
                return self._selected(
                    group,
                    representative,
                    "equivalent_content_at_latest_time",
                    SnapshotDiagnosticCode.EQUIVALENT_CONTENT_DEDUPLICATED,
                    "Equivalent latest content was deterministically represented without deleting evidence",
                )
            return self._ambiguous(
                group,
                "ambiguous_latest_different_content",
                SnapshotDiagnosticCode.AMBIGUOUS_LATEST,
                "Different snapshot content shares the latest observation time",
            )

        raise AssertionError("unsupported selection policy")

    @staticmethod
    def _selected(
        group: StaticWorkflowSnapshotGroup,
        snapshot: StaticWorkflowSnapshot,
        reason: str,
        code: SnapshotDiagnosticCode,
        message: str,
    ) -> StaticWorkflowSnapshotGroup:
        return replace(
            group,
            selection_state=SnapshotSelectionState.SELECTED,
            selected_snapshot=snapshot,
            selection_reason=reason,
            diagnostics=(SnapshotDiagnostic(code, message),),
        )

    @staticmethod
    def _ambiguous(
        group: StaticWorkflowSnapshotGroup,
        reason: str,
        code: SnapshotDiagnosticCode,
        message: str,
    ) -> StaticWorkflowSnapshotGroup:
        return replace(
            group,
            selection_state=SnapshotSelectionState.AMBIGUOUS,
            selection_reason=reason,
            diagnostics=(SnapshotDiagnostic(code, message),),
        )

    @staticmethod
    def _unresolved(
        group: StaticWorkflowSnapshotGroup,
        reason: str,
        code: SnapshotDiagnosticCode,
        message: str,
    ) -> StaticWorkflowSnapshotGroup:
        return replace(
            group,
            selection_state=SnapshotSelectionState.UNRESOLVED,
            selection_reason=reason,
            diagnostics=(SnapshotDiagnostic(code, message),),
        )
