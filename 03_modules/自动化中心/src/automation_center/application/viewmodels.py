"""Provider-neutral, UI-safe ViewModel Contract V0.1."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any

from automation_center.domain import to_primitive


VIEWMODEL_VERSION = "0.1"


@dataclass(frozen=True, slots=True)
class WorkflowIdentityViewModel:
    provider_kind: str
    provider_instance_id: str
    external_workflow_id: str


@dataclass(frozen=True, slots=True)
class TriggerSummaryViewModel:
    trigger_type: str
    label: str
    count: int


@dataclass(frozen=True, slots=True)
class TriggerCountViewModel:
    trigger_type: str
    count: int


@dataclass(frozen=True, slots=True)
class EvidenceSummaryViewModel:
    evidence_id: str
    source_type: str
    source_label: str
    authority: str
    captured_at: str
    synthetic: bool
    sanitized: bool
    integrity_hash_prefix: str | None


@dataclass(frozen=True, slots=True)
class MetadataItemViewModel:
    key: str
    value: str


@dataclass(frozen=True, slots=True)
class AutomationWorkflowListItemViewModel:
    identity: WorkflowIdentityViewModel
    display_name: str
    provider_kind: str
    provider_instance_id: str
    provider_display_name: str
    definition_status: str
    runtime_available: bool
    runtime_observed: bool
    runtime_status: str
    trigger_summary: tuple[TriggerSummaryViewModel, ...]
    evidence_source_type: str
    evidence_authority: str
    evidence_synthetic: bool
    observed_at: str
    provenance_label: str
    last_run: None = None
    schema_version: str = VIEWMODEL_VERSION


@dataclass(frozen=True, slots=True)
class AutomationWorkflowDetailViewModel:
    summary: AutomationWorkflowListItemViewModel
    description: str | None
    tags: tuple[str, ...]
    evidence: tuple[EvidenceSummaryViewModel, ...]
    provider_metadata: tuple[MetadataItemViewModel, ...]
    last_run: None = None
    schema_version: str = VIEWMODEL_VERSION


@dataclass(frozen=True, slots=True)
class AutomationOverviewViewModel:
    total_workflows: int
    definition_active_count: int
    definition_inactive_count: int
    definition_unknown_count: int
    definition_unavailable_count: int
    runtime_observed_count: int
    runtime_not_observed_count: int
    runtime_active_count: int
    runtime_inactive_count: int
    runtime_unknown_count: int
    runtime_unavailable_count: int
    provider_count: int
    trigger_type_summary: tuple[TriggerCountViewModel, ...]
    schema_version: str = VIEWMODEL_VERSION


def serialize_viewmodel(value: Any) -> str:
    """Serialize a ViewModel deterministically as compact UTF-8 JSON text."""

    return json.dumps(to_primitive(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
