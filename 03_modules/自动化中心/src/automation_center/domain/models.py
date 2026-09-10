"""Provider-neutral data contracts for NEXA Automation Center V0.1.

This module contains data only. It has no provider adapter, network, persistence,
runtime control, or automation execution capability.
"""

from __future__ import annotations

from dataclasses import dataclass, fields, is_dataclass
from datetime import datetime
from enum import Enum
import json
import re
from typing import Any


CONTRACT_VERSION = "0.1"

_PROVIDER_KIND = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_METADATA_KEY = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_SENSITIVE_KEY = re.compile(
    r"(?:credential|password|secret|api[_-]?key|access[_-]?key|token|cookie|authorization|auth[_-]?header)",
    re.IGNORECASE,
)
_SENSITIVE_VALUE = re.compile(
    r"(?:bearer\s+[a-z0-9._~+/=-]{12,}|sk-[a-z0-9_-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)",
    re.IGNORECASE,
)
_ABSOLUTE_LOCATOR = re.compile(r"^(?:[a-zA-Z]:[\\/]|[/\\]{1,2})")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


class ProviderCapability(str, Enum):
    DEFINITION_READ = "definition_read"
    RUN_READ = "run_read"
    TRIGGER_EXECUTION = "trigger_execution"


class EvidenceKind(str, Enum):
    STATIC_EXPORT = "static_export"
    RUNTIME_API = "runtime_api"
    EXECUTION_RECORD = "execution_record"
    SYNTHETIC_FIXTURE = "synthetic_fixture"
    MANUAL_IMPORT = "manual_import"


class EvidenceAuthority(str, Enum):
    STATIC_EXPORT = "static_export"
    RUNTIME = "runtime"
    EXECUTION = "execution"
    SYNTHETIC = "synthetic"
    MANUAL = "manual"


class StatusScope(str, Enum):
    DEFINITION = "definition"
    RUNTIME = "runtime"
    RUN = "run"


class StatusValue(str, Enum):
    UNKNOWN = "unknown"
    UNAVAILABLE = "unavailable"
    ACTIVE = "active"
    INACTIVE = "inactive"
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TriggerType(str, Enum):
    FORM = "form"
    ERROR = "error"
    MANUAL = "manual"
    SCHEDULE = "schedule"
    WEBHOOK = "webhook"
    OTHER = "other"
    UNKNOWN = "unknown"


def _text(value: str, field_name: str, *, max_length: int = 256) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{field_name} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} must not be empty")
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} exceeds {max_length} characters")
    if any(ord(character) < 32 for character in normalized):
        raise ValueError(f"{field_name} contains control characters")
    if _SENSITIVE_VALUE.search(normalized):
        raise ValueError(f"{field_name} contains a sensitive value pattern")
    return normalized


def _optional_text(value: str | None, field_name: str, *, max_length: int = 2048) -> str | None:
    if value is None:
        return None
    return _text(value, field_name, max_length=max_length)


def _aware(value: datetime, field_name: str) -> datetime:
    if not isinstance(value, datetime):
        raise TypeError(f"{field_name} must be a datetime")
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value


def _version(value: str) -> None:
    if value != CONTRACT_VERSION:
        raise ValueError(f"unsupported schema version: {value!r}")


@dataclass(frozen=True, slots=True)
class ProviderRef:
    provider_kind: str
    provider_instance_id: str

    def __post_init__(self) -> None:
        provider_kind = _text(self.provider_kind, "provider_kind", max_length=64).lower()
        if not _PROVIDER_KIND.fullmatch(provider_kind):
            raise ValueError("provider_kind must be a lowercase provider slug")
        object.__setattr__(self, "provider_kind", provider_kind)
        object.__setattr__(
            self,
            "provider_instance_id",
            _text(self.provider_instance_id, "provider_instance_id", max_length=128),
        )


@dataclass(frozen=True, slots=True)
class WorkflowRef:
    provider: ProviderRef
    external_workflow_id: str

    def __post_init__(self) -> None:
        if not isinstance(self.provider, ProviderRef):
            raise TypeError("provider must be ProviderRef")
        object.__setattr__(
            self,
            "external_workflow_id",
            _text(self.external_workflow_id, "external_workflow_id", max_length=256),
        )


@dataclass(frozen=True, slots=True)
class RunRef:
    provider: ProviderRef
    external_run_id: str

    def __post_init__(self) -> None:
        if not isinstance(self.provider, ProviderRef):
            raise TypeError("provider must be ProviderRef")
        object.__setattr__(
            self,
            "external_run_id",
            _text(self.external_run_id, "external_run_id", max_length=256),
        )


@dataclass(frozen=True, slots=True)
class TriggerRef:
    workflow: WorkflowRef
    local_key: str

    def __post_init__(self) -> None:
        if not isinstance(self.workflow, WorkflowRef):
            raise TypeError("workflow must be WorkflowRef")
        object.__setattr__(self, "local_key", _text(self.local_key, "local_key", max_length=256))


@dataclass(frozen=True, slots=True)
class EvidenceRef:
    evidence_id: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "evidence_id", _text(self.evidence_id, "evidence_id", max_length=256))


@dataclass(frozen=True, slots=True)
class Provenance:
    evidence_ref: EvidenceRef
    authority: EvidenceAuthority
    observed_at: datetime

    def __post_init__(self) -> None:
        if not isinstance(self.evidence_ref, EvidenceRef):
            raise TypeError("evidence_ref must be EvidenceRef")
        if not isinstance(self.authority, EvidenceAuthority):
            raise TypeError("authority must be EvidenceAuthority")
        _aware(self.observed_at, "observed_at")


@dataclass(frozen=True, slots=True)
class ProviderMetadata:
    """A sanitized, bounded and shallow provider-specific extension."""

    entries: tuple[tuple[str, str], ...] = ()
    sanitized: bool = True

    def __post_init__(self) -> None:
        if not self.sanitized:
            raise ValueError("provider_metadata must be sanitized")
        entries = tuple(self.entries)
        if len(entries) > 16:
            raise ValueError("provider_metadata supports at most 16 entries")

        normalized: list[tuple[str, str]] = []
        seen: set[str] = set()
        for entry in entries:
            if not isinstance(entry, tuple) or len(entry) != 2:
                raise TypeError("provider_metadata entries must be (key, value) tuples")
            key, value = entry
            if not isinstance(key, str) or not _METADATA_KEY.fullmatch(key):
                raise ValueError("provider_metadata key must be a lowercase slug")
            if _SENSITIVE_KEY.search(key):
                raise ValueError(f"sensitive provider_metadata key is forbidden: {key}")
            if key in seen:
                raise ValueError(f"duplicate provider_metadata key: {key}")
            seen.add(key)
            normalized.append((key, _text(value, f"provider_metadata[{key}]", max_length=256)))

        object.__setattr__(self, "entries", tuple(sorted(normalized)))


@dataclass(frozen=True, slots=True)
class AutomationEvidence:
    evidence_id: str
    kind: EvidenceKind
    authority: EvidenceAuthority
    source_locator: str
    captured_at: datetime
    sanitized: bool
    synthetic: bool
    source: ProviderRef | None = None
    content_hash: str | None = None
    summary: str | None = None
    schema_version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "evidence_id", _text(self.evidence_id, "evidence_id", max_length=256))
        if not isinstance(self.kind, EvidenceKind):
            raise TypeError("kind must be EvidenceKind")
        if not isinstance(self.authority, EvidenceAuthority):
            raise TypeError("authority must be EvidenceAuthority")
        locator = _text(self.source_locator, "source_locator", max_length=512)
        if "://" in locator or _ABSOLUTE_LOCATOR.search(locator):
            raise ValueError("source_locator must be a safe logical locator, not a URL or absolute path")
        object.__setattr__(self, "source_locator", locator)
        _aware(self.captured_at, "captured_at")
        _version(self.schema_version)

        if not self.sanitized:
            raise ValueError("evidence entering the domain contract must be sanitized")
        if self.source is not None and not isinstance(self.source, ProviderRef):
            raise TypeError("source must be ProviderRef or None")

        expected_authority = {
            EvidenceKind.STATIC_EXPORT: EvidenceAuthority.STATIC_EXPORT,
            EvidenceKind.RUNTIME_API: EvidenceAuthority.RUNTIME,
            EvidenceKind.EXECUTION_RECORD: EvidenceAuthority.EXECUTION,
            EvidenceKind.SYNTHETIC_FIXTURE: EvidenceAuthority.SYNTHETIC,
            EvidenceKind.MANUAL_IMPORT: EvidenceAuthority.MANUAL,
        }[self.kind]
        if self.authority is not expected_authority:
            raise ValueError("evidence kind cannot be upgraded beyond its source authority")

        if self.kind is EvidenceKind.SYNTHETIC_FIXTURE:
            if not self.synthetic or self.source is not None:
                raise ValueError("synthetic fixture evidence must be synthetic and must not claim a provider source")
        else:
            if self.synthetic:
                raise ValueError("non-fixture evidence cannot be marked synthetic")
            if self.kind in {
                EvidenceKind.STATIC_EXPORT,
                EvidenceKind.RUNTIME_API,
                EvidenceKind.EXECUTION_RECORD,
            } and self.source is None:
                raise ValueError("provider evidence must identify its provider source")

        if self.content_hash is not None:
            if not isinstance(self.content_hash, str) or not _SHA256.fullmatch(self.content_hash):
                raise ValueError("content_hash must be a SHA-256 hex digest")
            object.__setattr__(self, "content_hash", self.content_hash.lower())
        object.__setattr__(self, "summary", _optional_text(self.summary, "summary"))

    @property
    def ref(self) -> EvidenceRef:
        return EvidenceRef(self.evidence_id)


@dataclass(frozen=True, slots=True)
class AutomationStatus:
    scope: StatusScope
    value: StatusValue
    provenance: Provenance
    schema_version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.scope, StatusScope):
            raise TypeError("scope must be StatusScope")
        if not isinstance(self.value, StatusValue):
            raise TypeError("value must be StatusValue")
        if not isinstance(self.provenance, Provenance):
            raise TypeError("provenance must be Provenance")
        _version(self.schema_version)

        allowed_values = {
            StatusScope.DEFINITION: {
                StatusValue.UNKNOWN,
                StatusValue.UNAVAILABLE,
                StatusValue.ACTIVE,
                StatusValue.INACTIVE,
            },
            StatusScope.RUNTIME: {
                StatusValue.UNKNOWN,
                StatusValue.UNAVAILABLE,
                StatusValue.ACTIVE,
                StatusValue.INACTIVE,
            },
            StatusScope.RUN: {
                StatusValue.UNKNOWN,
                StatusValue.PENDING,
                StatusValue.RUNNING,
                StatusValue.SUCCEEDED,
                StatusValue.FAILED,
                StatusValue.CANCELLED,
            },
        }[self.scope]
        if self.value not in allowed_values:
            raise ValueError(f"{self.value.value} is not valid for {self.scope.value} status")

        allowed_authorities = {
            StatusScope.DEFINITION: {
                EvidenceAuthority.STATIC_EXPORT,
                EvidenceAuthority.SYNTHETIC,
                EvidenceAuthority.MANUAL,
            },
            StatusScope.RUNTIME: {EvidenceAuthority.RUNTIME},
            StatusScope.RUN: {EvidenceAuthority.EXECUTION},
        }[self.scope]
        if self.provenance.authority not in allowed_authorities:
            raise ValueError("status scope does not match evidence authority")


def _evidence_refs(values: tuple[EvidenceRef, ...], field_name: str) -> tuple[EvidenceRef, ...]:
    normalized = tuple(values)
    if not normalized:
        raise ValueError(f"{field_name} must contain at least one evidence reference")
    if not all(isinstance(value, EvidenceRef) for value in normalized):
        raise TypeError(f"{field_name} must contain EvidenceRef values")
    return tuple(sorted(set(normalized), key=lambda value: value.evidence_id))


@dataclass(frozen=True, slots=True)
class AutomationProvider:
    ref: ProviderRef
    capabilities: frozenset[ProviderCapability]
    provenance: Provenance
    display_name: str | None = None
    schema_version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.ref, ProviderRef):
            raise TypeError("ref must be ProviderRef")
        capabilities = frozenset(self.capabilities)
        if not all(isinstance(value, ProviderCapability) for value in capabilities):
            raise TypeError("capabilities must contain ProviderCapability values")
        object.__setattr__(self, "capabilities", capabilities)
        if not isinstance(self.provenance, Provenance):
            raise TypeError("provenance must be Provenance")
        object.__setattr__(self, "display_name", _optional_text(self.display_name, "display_name", max_length=256))
        _version(self.schema_version)


@dataclass(frozen=True, slots=True)
class AutomationTrigger:
    ref: TriggerRef
    trigger_type: TriggerType
    provenance: Provenance
    display_label: str | None = None
    provider_metadata: ProviderMetadata | None = None
    schema_version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.ref, TriggerRef):
            raise TypeError("ref must be TriggerRef")
        if not isinstance(self.trigger_type, TriggerType):
            raise TypeError("trigger_type must be TriggerType")
        if not isinstance(self.provenance, Provenance):
            raise TypeError("provenance must be Provenance")
        object.__setattr__(self, "display_label", _optional_text(self.display_label, "display_label", max_length=256))
        if self.provider_metadata is not None and not isinstance(self.provider_metadata, ProviderMetadata):
            raise TypeError("provider_metadata must be ProviderMetadata or None")
        _version(self.schema_version)

    @property
    def workflow_ref(self) -> WorkflowRef:
        return self.ref.workflow


@dataclass(frozen=True, slots=True)
class AutomationWorkflow:
    ref: WorkflowRef
    display_name: str
    definition_status: AutomationStatus
    provenance: Provenance
    evidence_refs: tuple[EvidenceRef, ...]
    triggers: tuple[AutomationTrigger, ...] = ()
    runtime_status: AutomationStatus | None = None
    description: str | None = None
    tags: tuple[str, ...] = ()
    provider_metadata: ProviderMetadata | None = None
    schema_version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.ref, WorkflowRef):
            raise TypeError("ref must be WorkflowRef")
        object.__setattr__(self, "display_name", _text(self.display_name, "display_name", max_length=256))
        if not isinstance(self.definition_status, AutomationStatus) or self.definition_status.scope is not StatusScope.DEFINITION:
            raise ValueError("definition_status must have DEFINITION scope")
        if not isinstance(self.provenance, Provenance):
            raise TypeError("provenance must be Provenance")

        evidence_refs = _evidence_refs(self.evidence_refs, "evidence_refs")
        required_refs = {self.provenance.evidence_ref, self.definition_status.provenance.evidence_ref}
        if not required_refs.issubset(evidence_refs):
            raise ValueError("workflow evidence_refs must include workflow and definition status provenance")
        object.__setattr__(self, "evidence_refs", evidence_refs)

        triggers = tuple(self.triggers)
        if not all(isinstance(trigger, AutomationTrigger) for trigger in triggers):
            raise TypeError("triggers must contain AutomationTrigger values")
        if any(trigger.workflow_ref != self.ref for trigger in triggers):
            raise ValueError("every trigger must reference this workflow")
        object.__setattr__(self, "triggers", triggers)

        if self.runtime_status is not None:
            if not isinstance(self.runtime_status, AutomationStatus) or self.runtime_status.scope is not StatusScope.RUNTIME:
                raise ValueError("runtime_status must have RUNTIME scope")
            if self.runtime_status.provenance.evidence_ref not in evidence_refs:
                raise ValueError("workflow evidence_refs must include runtime status provenance")

        object.__setattr__(self, "description", _optional_text(self.description, "description"))
        normalized_tags = tuple(sorted({_text(tag, "tag", max_length=64) for tag in self.tags}))
        object.__setattr__(self, "tags", normalized_tags)
        if self.provider_metadata is not None and not isinstance(self.provider_metadata, ProviderMetadata):
            raise TypeError("provider_metadata must be ProviderMetadata or None")
        _version(self.schema_version)

    @property
    def provider(self) -> ProviderRef:
        return self.ref.provider


@dataclass(frozen=True, slots=True)
class AutomationRun:
    ref: RunRef
    workflow_ref: WorkflowRef
    status: AutomationStatus
    provenance: Provenance
    evidence_refs: tuple[EvidenceRef, ...]
    started_at: datetime | None = None
    finished_at: datetime | None = None
    trigger_ref: TriggerRef | None = None
    input_summary: str | None = None
    output_summary: str | None = None
    provider_metadata: ProviderMetadata | None = None
    schema_version: str = CONTRACT_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.ref, RunRef):
            raise TypeError("ref must be RunRef")
        if not isinstance(self.workflow_ref, WorkflowRef):
            raise TypeError("workflow_ref must be WorkflowRef")
        if self.ref.provider != self.workflow_ref.provider:
            raise ValueError("run and workflow must belong to the same provider instance")
        if not isinstance(self.status, AutomationStatus) or self.status.scope is not StatusScope.RUN:
            raise ValueError("run status must have RUN scope")
        if not isinstance(self.provenance, Provenance):
            raise TypeError("provenance must be Provenance")

        evidence_refs = _evidence_refs(self.evidence_refs, "evidence_refs")
        required_refs = {self.provenance.evidence_ref, self.status.provenance.evidence_ref}
        if not required_refs.issubset(evidence_refs):
            raise ValueError("run evidence_refs must include run and status provenance")
        object.__setattr__(self, "evidence_refs", evidence_refs)

        if self.started_at is not None:
            _aware(self.started_at, "started_at")
        if self.finished_at is not None:
            _aware(self.finished_at, "finished_at")
        if self.started_at is not None and self.finished_at is not None and self.finished_at < self.started_at:
            raise ValueError("finished_at must not be earlier than started_at")
        if self.trigger_ref is not None:
            if not isinstance(self.trigger_ref, TriggerRef):
                raise TypeError("trigger_ref must be TriggerRef or None")
            if self.trigger_ref.workflow != self.workflow_ref:
                raise ValueError("trigger_ref must belong to the run workflow")

        object.__setattr__(self, "input_summary", _optional_text(self.input_summary, "input_summary"))
        object.__setattr__(self, "output_summary", _optional_text(self.output_summary, "output_summary"))
        if self.provider_metadata is not None and not isinstance(self.provider_metadata, ProviderMetadata):
            raise TypeError("provider_metadata must be ProviderMetadata or None")
        _version(self.schema_version)

    @property
    def provider(self) -> ProviderRef:
        return self.ref.provider


def to_primitive(value: Any) -> Any:
    """Convert a contract object to deterministic JSON-compatible primitives."""

    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        _aware(value, "datetime")
        return value.isoformat()
    if is_dataclass(value) and not isinstance(value, type):
        return {item.name: to_primitive(getattr(value, item.name)) for item in fields(value)}
    if isinstance(value, (set, frozenset)):
        converted = [to_primitive(item) for item in value]
        return sorted(converted, key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
    if isinstance(value, (tuple, list)):
        return [to_primitive(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("contract dictionaries require string keys")
        return {key: to_primitive(value[key]) for key in sorted(value)}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"unsupported contract value: {type(value).__name__}")


def serialize_contract(value: Any) -> str:
    """Serialize a validated contract object deterministically as compact JSON."""

    return json.dumps(to_primitive(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
