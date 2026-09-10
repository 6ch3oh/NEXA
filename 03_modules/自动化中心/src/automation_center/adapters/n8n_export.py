"""Pure, fail-closed n8n static export mapper.

The adapter maps one explicitly supplied JSON export into Domain Contract V0.1.
It does not discover files, access a runtime, use a network, or execute workflows.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from automation_center.domain import (
    AutomationEvidence,
    AutomationStatus,
    AutomationTrigger,
    AutomationWorkflow,
    EvidenceAuthority,
    EvidenceKind,
    Provenance,
    ProviderMetadata,
    ProviderRef,
    StatusScope,
    StatusValue,
    TriggerRef,
    TriggerType,
    WorkflowRef,
)


class MappingDiagnosticCode(str, Enum):
    MALFORMED_EXPORT = "malformed_export"
    MISSING_WORKFLOW_IDENTITY = "missing_workflow_identity"
    UNKNOWN_TRIGGER = "unknown_trigger"
    SENSITIVE_FIELD_SANITIZED = "sensitive_field_sanitized"
    MAPPING_SUCCESS = "mapping_success"


@dataclass(frozen=True, slots=True)
class MappingDiagnostic:
    code: MappingDiagnosticCode
    message: str


@dataclass(frozen=True, slots=True)
class N8nExportContext:
    provider_kind: str
    provider_instance_id: str
    source_locator: str
    captured_at: datetime
    synthetic: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.provider_kind, str) or self.provider_kind.strip().lower() != "n8n":
            raise ValueError("N8nExportAdapter requires provider_kind='n8n'")
        if not isinstance(self.provider_instance_id, str) or not self.provider_instance_id.strip():
            raise ValueError("provider_instance_id is required")
        if not isinstance(self.source_locator, str) or not self.source_locator.strip():
            raise ValueError("source_locator is required")
        if not isinstance(self.captured_at, datetime) or self.captured_at.tzinfo is None or self.captured_at.utcoffset() is None:
            raise ValueError("captured_at must be timezone-aware")


@dataclass(frozen=True, slots=True)
class N8nExportMappingResult:
    workflow: AutomationWorkflow
    evidence: AutomationEvidence
    diagnostics: tuple[MappingDiagnostic, ...]


class N8nExportMappingError(ValueError):
    def __init__(self, code: MappingDiagnosticCode, message: str) -> None:
        self.code = code
        self.diagnostics = (MappingDiagnostic(code, message),)
        super().__init__(message)


_SENSITIVE_KEY = re.compile(
    r"^(?:credentials?|password|secret|tokens?|api[_-]?key|apikey|authorization|cookies?|headers?|authentication)$",
    re.IGNORECASE,
)

_TRIGGER_TYPES = {
    "n8n-nodes-base.formTrigger": TriggerType.FORM,
    "n8n-nodes-base.errorTrigger": TriggerType.ERROR,
    "n8n-nodes-base.manualTrigger": TriggerType.MANUAL,
    "n8n-nodes-base.scheduleTrigger": TriggerType.SCHEDULE,
    "n8n-nodes-base.webhook": TriggerType.WEBHOOK,
}

_TRIGGER_LABELS = {
    TriggerType.FORM: "Form trigger",
    TriggerType.ERROR: "Error trigger",
    TriggerType.MANUAL: "Manual trigger",
    TriggerType.SCHEDULE: "Schedule trigger",
    TriggerType.WEBHOOK: "Webhook trigger",
    TriggerType.OTHER: "Other trigger",
}


def _raw_bytes(raw_export: str | bytes) -> tuple[bytes, str]:
    if isinstance(raw_export, bytes):
        content = raw_export
        try:
            text = raw_export.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise N8nExportMappingError(
                MappingDiagnosticCode.MALFORMED_EXPORT,
                "n8n export must be UTF-8 JSON",
            ) from exc
        return content, text
    if isinstance(raw_export, str):
        return raw_export.encode("utf-8"), raw_export
    raise N8nExportMappingError(
        MappingDiagnosticCode.MALFORMED_EXPORT,
        "n8n export must be JSON text or bytes",
    )


def _parse_export(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise N8nExportMappingError(
            MappingDiagnosticCode.MALFORMED_EXPORT,
            "n8n export is not valid JSON",
        ) from exc
    if not isinstance(parsed, dict):
        raise N8nExportMappingError(
            MappingDiagnosticCode.MALFORMED_EXPORT,
            "n8n export root must be an object",
        )
    return parsed


def _contains_sensitive_field(value: Any) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(key, str) and _SENSITIVE_KEY.fullmatch(key):
                return True
            if _contains_sensitive_field(child):
                return True
    elif isinstance(value, list):
        return any(_contains_sensitive_field(item) for item in value)
    return False


def _is_synthetic_export(data: dict[str, Any], context: N8nExportContext) -> bool:
    marker = data.get("_fixture")
    marked_synthetic = (
        isinstance(marker, dict)
        and isinstance(marker.get("classification"), str)
        and marker["classification"].strip().lower() == "synthetic"
    )
    return context.synthetic or marked_synthetic


def _definition_value(data: dict[str, Any]) -> StatusValue:
    if "active" not in data:
        return StatusValue.UNKNOWN
    if not isinstance(data["active"], bool):
        raise N8nExportMappingError(
            MappingDiagnosticCode.MALFORMED_EXPORT,
            "n8n export active field must be boolean when present",
        )
    return StatusValue.ACTIVE if data["active"] else StatusValue.INACTIVE


def _trigger_type(node_type: str) -> TriggerType | None:
    if node_type in _TRIGGER_TYPES:
        return _TRIGGER_TYPES[node_type]
    lowered = node_type.lower()
    if "trigger" in lowered or lowered.endswith(".webhook"):
        return TriggerType.OTHER
    return None


def _map_triggers(
    nodes: list[Any],
    workflow_ref: WorkflowRef,
    provenance: Provenance,
) -> tuple[tuple[AutomationTrigger, ...], tuple[MappingDiagnostic, ...]]:
    triggers: list[AutomationTrigger] = []
    diagnostics: list[MappingDiagnostic] = []

    for node in nodes:
        if not isinstance(node, dict):
            raise N8nExportMappingError(
                MappingDiagnosticCode.MALFORMED_EXPORT,
                "every n8n node must be an object",
            )
        node_type = node.get("type")
        if not isinstance(node_type, str) or not node_type.strip():
            raise N8nExportMappingError(
                MappingDiagnosticCode.MALFORMED_EXPORT,
                "every n8n node must have a non-empty type",
            )
        mapped_type = _trigger_type(node_type)
        if mapped_type is None:
            continue

        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id.strip():
            raise N8nExportMappingError(
                MappingDiagnosticCode.MALFORMED_EXPORT,
                "trigger nodes require a stable node id",
            )

        if mapped_type is TriggerType.OTHER:
            diagnostics.append(
                MappingDiagnostic(
                    MappingDiagnosticCode.UNKNOWN_TRIGGER,
                    "An unrecognized trigger node was mapped to OTHER",
                )
            )

        metadata = ProviderMetadata(entries=(("provider_node_type", node_type),))
        triggers.append(
            AutomationTrigger(
                ref=TriggerRef(workflow_ref, node_id),
                trigger_type=mapped_type,
                provenance=provenance,
                display_label=_TRIGGER_LABELS[mapped_type],
                provider_metadata=metadata,
            )
        )

    return tuple(triggers), tuple(diagnostics)


def _workflow_metadata(data: dict[str, Any], node_count: int, trigger_count: int) -> ProviderMetadata:
    entries: list[tuple[str, str]] = [
        ("export_format", "n8n_workflow"),
        ("node_count", str(node_count)),
        ("trigger_count", str(trigger_count)),
    ]
    provider_version_id = data.get("versionId")
    if isinstance(provider_version_id, str) and provider_version_id.strip():
        try:
            candidate = ProviderMetadata(entries=(("provider_version_id", provider_version_id),))
        except (TypeError, ValueError):
            pass
        else:
            entries.extend(candidate.entries)
    return ProviderMetadata(entries=tuple(entries))


class N8nExportAdapter:
    """Map an explicitly supplied n8n static export to Domain Contract V0.1."""

    def map_export(self, raw_export: str | bytes, context: N8nExportContext) -> N8nExportMappingResult:
        content, text = _raw_bytes(raw_export)
        data = _parse_export(text)

        external_id = data.get("id")
        if not isinstance(external_id, str) or not external_id.strip():
            raise N8nExportMappingError(
                MappingDiagnosticCode.MISSING_WORKFLOW_IDENTITY,
                "n8n export requires a non-empty external workflow id",
            )

        nodes = data.get("nodes")
        if not isinstance(nodes, list):
            raise N8nExportMappingError(
                MappingDiagnosticCode.MALFORMED_EXPORT,
                "n8n export nodes field must be an array",
            )

        provider = ProviderRef(context.provider_kind, context.provider_instance_id)
        workflow_ref = WorkflowRef(provider, external_id)
        content_hash = hashlib.sha256(content).hexdigest()
        synthetic = _is_synthetic_export(data, context)
        evidence_kind = EvidenceKind.SYNTHETIC_FIXTURE if synthetic else EvidenceKind.STATIC_EXPORT
        authority = EvidenceAuthority.SYNTHETIC if synthetic else EvidenceAuthority.STATIC_EXPORT
        evidence_source = None if synthetic else provider
        identity_material = "\0".join(
            (
                "n8n-export-v0.1",
                provider.provider_kind,
                provider.provider_instance_id,
                external_id,
                context.source_locator,
                content_hash,
                evidence_kind.value,
            )
        ).encode("utf-8")
        evidence_id = "n8n-export-" + hashlib.sha256(identity_material).hexdigest()[:32]

        evidence = AutomationEvidence(
            evidence_id=evidence_id,
            kind=evidence_kind,
            authority=authority,
            source_locator=context.source_locator,
            captured_at=context.captured_at,
            sanitized=True,
            synthetic=synthetic,
            source=evidence_source,
            content_hash=content_hash,
            summary="Sanitized synthetic n8n workflow export" if synthetic else "Sanitized static n8n workflow export",
        )
        source_provenance = Provenance(evidence.ref, authority, context.captured_at)
        definition_status = AutomationStatus(
            scope=StatusScope.DEFINITION,
            value=_definition_value(data),
            provenance=source_provenance,
        )
        triggers, trigger_diagnostics = _map_triggers(nodes, workflow_ref, source_provenance)

        display_name = data.get("name")
        if not isinstance(display_name, str) or not display_name.strip():
            display_name = "Unnamed n8n workflow"

        diagnostics = list(trigger_diagnostics)
        if _contains_sensitive_field(data):
            diagnostics.append(
                MappingDiagnostic(
                    MappingDiagnosticCode.SENSITIVE_FIELD_SANITIZED,
                    "Sensitive source fields were omitted from the domain mapping",
                )
            )

        try:
            workflow = AutomationWorkflow(
                ref=workflow_ref,
                display_name=display_name,
                definition_status=definition_status,
                runtime_status=None,
                provenance=source_provenance,
                evidence_refs=(evidence.ref,),
                triggers=triggers,
                provider_metadata=_workflow_metadata(data, len(nodes), len(triggers)),
            )
        except (TypeError, ValueError) as exc:
            if display_name != "Unnamed n8n workflow":
                diagnostics.append(
                    MappingDiagnostic(
                        MappingDiagnosticCode.SENSITIVE_FIELD_SANITIZED,
                        "Unsafe display metadata was replaced during domain mapping",
                    )
                )
                workflow = AutomationWorkflow(
                    ref=workflow_ref,
                    display_name="Unnamed n8n workflow",
                    definition_status=definition_status,
                    runtime_status=None,
                    provenance=source_provenance,
                    evidence_refs=(evidence.ref,),
                    triggers=triggers,
                    provider_metadata=_workflow_metadata(data, len(nodes), len(triggers)),
                )
            else:
                raise N8nExportMappingError(
                    MappingDiagnosticCode.MALFORMED_EXPORT,
                    "n8n export cannot be represented by Domain Contract V0.1",
                ) from exc

        diagnostics.append(
            MappingDiagnostic(
                MappingDiagnosticCode.MAPPING_SUCCESS,
                "n8n static export mapped successfully",
            )
        )
        return N8nExportMappingResult(workflow, evidence, tuple(diagnostics))

    def map_export_file(self, path: str | Path, context: N8nExportContext) -> N8nExportMappingResult:
        """Thin file wrapper; the caller still supplies the safe logical locator."""

        return self.map_export(Path(path).read_bytes(), context)
