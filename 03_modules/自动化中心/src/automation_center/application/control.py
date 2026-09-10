"""Provider-neutral control foundation contracts with no execution capability."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum
import hashlib
import json
import re
from typing import Any, Iterable, Mapping
from urllib.parse import urlsplit

from .results import BusinessResultStatus, ResultExecutionStatus, result_to_primitive


CONTROL_FOUNDATION_VERSION = "0.1"

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$")
_CAPABILITY_ID = re.compile(r"^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$")
_PROVIDER_KIND = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
_ABSOLUTE = re.compile(r"^(?:[A-Za-z]:[\\/]|[/\\]{1,2})")
_SENSITIVE = re.compile(
    r"(?:bearer\s+[A-Za-z0-9._~+/=-]{8,}|sk-[A-Za-z0-9_-]{8,}|"
    r"-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S{8,})",
    re.IGNORECASE,
)


def _text(value: str, field_name: str, *, max_length: int = 1024) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{field_name} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} must not be empty")
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} exceeds {max_length} characters")
    if any(ord(character) < 32 and character not in "\n\t" for character in normalized):
        raise ValueError(f"{field_name} contains control characters")
    if _SENSITIVE.search(normalized):
        raise ValueError(f"{field_name} contains sensitive text")
    return normalized


def _optional_text(value: str | None, field_name: str, *, max_length: int = 1024) -> str | None:
    return None if value is None else _text(value, field_name, max_length=max_length)


def _identifier(value: str, field_name: str) -> str:
    normalized = _text(value, field_name, max_length=256)
    if not _ID.fullmatch(normalized):
        raise ValueError(f"{field_name} must be a safe identifier")
    return normalized


def _logical_ref(value: str, field_name: str) -> str:
    normalized = _text(value, field_name, max_length=512)
    portable = normalized.replace("\\", "/")
    if _ABSOLUTE.search(normalized) or "://" in normalized or ".." in portable.split("/"):
        raise ValueError(f"{field_name} must be a safe logical reference")
    return portable


def _hash(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ValueError(f"{field_name} must be a SHA-256 digest")
    return value.lower()


def _aware(value: datetime | None, field_name: str) -> None:
    if value is None:
        return
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")


def _tuple_text(values: Iterable[str], field_name: str, *, max_items: int = 32) -> tuple[str, ...]:
    result = tuple(_text(value, field_name, max_length=512) for value in values)
    if len(result) > max_items:
        raise ValueError(f"{field_name} has too many items")
    return result


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ConfirmationPolicy(str, Enum):
    NONE = "none"
    ALWAYS = "always"
    CONDITIONAL = "conditional"


class CapabilityAvailability(str, Enum):
    AVAILABLE = "available"
    CONFIGURATION_REQUIRED = "configuration_required"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


class InvocationMode(str, Enum):
    FORM = "form"
    MANUAL = "manual"
    WEBHOOK = "webhook"
    CLI = "cli"
    API = "api"
    PROVIDER_DELEGATED = "provider_delegated"


class InputFieldKind(str, Enum):
    TEXT = "text"
    LONG_TEXT = "long_text"
    URL = "url"


class ResultActionType(str, Enum):
    COPY_TEXT = "copy_text"
    COPY_MARKDOWN = "copy_markdown"
    COPY_JSON = "copy_json"
    OPEN_FILE = "open_file"
    COPY_FILE_PATH = "copy_file_path"
    OPEN_URL = "open_url"
    COPY_URL = "copy_url"


class ControlRunState(str, Enum):
    NOT_RUNNING = "not_running"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    PARTIAL = "partial"
    FAILED = "failed"
    NEEDS_ATTENTION = "needs_attention"
    UNKNOWN = "unknown"


class RunRequestState(str, Enum):
    PREPARED = "prepared"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    READY_FOR_PROVIDER = "ready_for_provider"
    BLOCKED = "blocked"


class CandidateState(str, Enum):
    DRAFT = "draft"
    VALIDATION_PENDING = "validation_pending"
    SANDBOX_PENDING = "sandbox_pending"
    VALIDATED = "validated"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"


class ValidationOutcome(str, Enum):
    NOT_RUN = "not_run"
    PASS = "pass"
    FAIL = "fail"


class DeploymentState(str, Enum):
    DRAFT = "draft"
    TESTING = "testing"
    VALIDATED = "validated"
    READY_TO_PUBLISH = "ready_to_publish"
    PUBLISHED = "published"
    PUBLISH_FAILED = "publish_failed"
    ROLLBACK_REQUIRED = "rollback_required"


@dataclass(frozen=True, slots=True)
class ControlWorkflowIdentity:
    provider_kind: str
    external_workflow_id: str
    provider_instance_id: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.provider_kind, str) or not _PROVIDER_KIND.fullmatch(self.provider_kind):
            raise ValueError("provider_kind must be a lowercase provider slug")
        object.__setattr__(self, "external_workflow_id", _identifier(self.external_workflow_id, "external_workflow_id"))
        if self.provider_instance_id is not None:
            object.__setattr__(self, "provider_instance_id", _identifier(self.provider_instance_id, "provider_instance_id"))

    @property
    def resolved(self) -> bool:
        return self.provider_instance_id is not None


@dataclass(frozen=True, slots=True)
class CapabilityInputField:
    name: str
    display_name: str
    field_kind: InputFieldKind
    required: bool
    max_length: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", _identifier(self.name, "input field name"))
        object.__setattr__(self, "display_name", _text(self.display_name, "input display_name", max_length=128))
        if not isinstance(self.field_kind, InputFieldKind):
            raise TypeError("field_kind must be InputFieldKind")
        if not isinstance(self.required, bool):
            raise TypeError("required must be bool")
        if not isinstance(self.max_length, int) or not 1 <= self.max_length <= 20000:
            raise ValueError("max_length must be between 1 and 20000")

    def validate(self, value: Any) -> str:
        normalized = _text(value, self.name, max_length=self.max_length)
        if self.field_kind is InputFieldKind.URL:
            parsed = urlsplit(normalized)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
                raise ValueError(f"{self.name} must be a safe HTTP(S) URL")
        return normalized


@dataclass(frozen=True, slots=True)
class CapabilityInputSchema:
    fields: tuple[CapabilityInputField, ...]
    additional_fields_allowed: bool = False

    def __post_init__(self) -> None:
        fields = tuple(self.fields)
        if not fields or not all(isinstance(item, CapabilityInputField) for item in fields):
            raise ValueError("fields must contain CapabilityInputField values")
        names = [item.name for item in fields]
        if len(names) != len(set(names)):
            raise ValueError("input field names must be unique")
        if not isinstance(self.additional_fields_allowed, bool):
            raise TypeError("additional_fields_allowed must be bool")
        if self.additional_fields_allowed:
            raise ValueError("control input schemas must fail closed on additional fields")
        object.__setattr__(self, "fields", fields)

    def validate(self, payload: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
        if not isinstance(payload, Mapping) or not all(isinstance(key, str) for key in payload):
            raise TypeError("input payload must be an object with string keys")
        by_name = {field.name: field for field in self.fields}
        unknown = set(payload) - set(by_name)
        if unknown:
            raise ValueError("input payload contains unsupported fields")
        normalized: list[tuple[str, str]] = []
        for field in self.fields:
            value = payload.get(field.name)
            if value is None or value == "":
                if field.required:
                    raise ValueError(f"required input is missing: {field.name}")
                continue
            normalized.append((field.name, field.validate(value)))
        return tuple(normalized)


@dataclass(frozen=True, slots=True)
class CapabilityOutputSchema:
    result_type: str
    media_type: str
    primary_action: ResultActionType
    allowed_actions: tuple[ResultActionType, ...]
    safe_projection_required: bool = True

    def __post_init__(self) -> None:
        object.__setattr__(self, "result_type", _identifier(self.result_type, "result_type"))
        object.__setattr__(self, "media_type", _text(self.media_type, "media_type", max_length=128))
        if not isinstance(self.primary_action, ResultActionType):
            raise TypeError("primary_action must be ResultActionType")
        actions = tuple(self.allowed_actions)
        if not actions or not all(isinstance(item, ResultActionType) for item in actions):
            raise ValueError("allowed_actions must contain ResultActionType values")
        if self.primary_action not in actions:
            raise ValueError("primary_action must be allowed")
        if not isinstance(self.safe_projection_required, bool):
            raise TypeError("safe_projection_required must be bool")
        if not self.safe_projection_required:
            raise ValueError("control outputs must require a safe projection")
        object.__setattr__(self, "allowed_actions", actions)


@dataclass(frozen=True, slots=True)
class CapabilityProvenance:
    canonical_source_ref: str
    canonical_source_sha256: str
    canonical_version: str
    sandbox_source_ref: str | None
    sandbox_source_sha256: str | None
    result_evidence_refs: tuple[str, ...]
    production_target_resolved: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "canonical_source_ref", _logical_ref(self.canonical_source_ref, "canonical_source_ref"))
        object.__setattr__(self, "canonical_source_sha256", _hash(self.canonical_source_sha256, "canonical_source_sha256"))
        object.__setattr__(self, "canonical_version", _text(self.canonical_version, "canonical_version", max_length=64))
        if self.sandbox_source_ref is None:
            if self.sandbox_source_sha256 is not None:
                raise ValueError("sandbox hash requires a sandbox source")
        else:
            object.__setattr__(self, "sandbox_source_ref", _logical_ref(self.sandbox_source_ref, "sandbox_source_ref"))
            object.__setattr__(self, "sandbox_source_sha256", _hash(self.sandbox_source_sha256 or "", "sandbox_source_sha256"))
        refs = tuple(_logical_ref(value, "result_evidence_ref") for value in self.result_evidence_refs)
        object.__setattr__(self, "result_evidence_refs", refs)
        if not isinstance(self.production_target_resolved, bool):
            raise TypeError("production_target_resolved must be bool")


@dataclass(frozen=True, slots=True)
class AutomationCapability:
    capability_id: str
    display_name: str
    description_for_ai: str
    workflow_identity: ControlWorkflowIdentity
    input_schema: CapabilityInputSchema
    output_schema: CapabilityOutputSchema
    risk_level: RiskLevel
    confirmation_policy: ConfirmationPolicy
    availability: CapabilityAvailability
    invocation_modes: tuple[InvocationMode, ...]
    provenance: CapabilityProvenance
    execution_engine: str
    schema_version: str = CONTROL_FOUNDATION_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.capability_id, str) or not _CAPABILITY_ID.fullmatch(self.capability_id):
            raise ValueError("capability_id must be a dotted lowercase identifier")
        object.__setattr__(self, "display_name", _text(self.display_name, "display_name", max_length=128))
        object.__setattr__(self, "description_for_ai", _text(self.description_for_ai, "description_for_ai", max_length=1024))
        if not isinstance(self.workflow_identity, ControlWorkflowIdentity):
            raise TypeError("workflow_identity must be ControlWorkflowIdentity")
        if not isinstance(self.input_schema, CapabilityInputSchema):
            raise TypeError("input_schema must be CapabilityInputSchema")
        if not isinstance(self.output_schema, CapabilityOutputSchema):
            raise TypeError("output_schema must be CapabilityOutputSchema")
        if not isinstance(self.risk_level, RiskLevel):
            raise TypeError("risk_level must be RiskLevel")
        if not isinstance(self.confirmation_policy, ConfirmationPolicy):
            raise TypeError("confirmation_policy must be ConfirmationPolicy")
        if not isinstance(self.availability, CapabilityAvailability):
            raise TypeError("availability must be CapabilityAvailability")
        modes = tuple(self.invocation_modes)
        if not modes or not all(isinstance(item, InvocationMode) for item in modes):
            raise ValueError("invocation_modes must contain InvocationMode values")
        object.__setattr__(self, "invocation_modes", modes)
        if not isinstance(self.provenance, CapabilityProvenance):
            raise TypeError("provenance must be CapabilityProvenance")
        object.__setattr__(self, "execution_engine", _text(self.execution_engine, "execution_engine", max_length=64))
        if self.schema_version != CONTROL_FOUNDATION_VERSION:
            raise ValueError("unsupported control foundation version")


class CapabilityNotFoundError(LookupError):
    pass


class CapabilityRegistry:
    def __init__(self, capabilities: Iterable[AutomationCapability]) -> None:
        values = tuple(capabilities)
        if not all(isinstance(item, AutomationCapability) for item in values):
            raise TypeError("capabilities must contain AutomationCapability values")
        by_id = {item.capability_id: item for item in values}
        if len(by_id) != len(values):
            raise ValueError("duplicate capability identity")
        self._by_id = by_id

    def list_capabilities(self) -> tuple[AutomationCapability, ...]:
        return tuple(self._by_id[key] for key in sorted(self._by_id))

    def get_capability(self, capability_id: str) -> AutomationCapability:
        try:
            return self._by_id[capability_id]
        except KeyError as exc:
            raise CapabilityNotFoundError("capability was not found") from exc


@dataclass(frozen=True, slots=True)
class ValidatedCapabilityInput:
    capability_id: str
    values: tuple[tuple[str, str], ...]
    input_sha256: str

    def __post_init__(self) -> None:
        if not _CAPABILITY_ID.fullmatch(self.capability_id):
            raise ValueError("invalid capability_id")
        values = tuple(self.values)
        if not all(isinstance(item, tuple) and len(item) == 2 for item in values):
            raise TypeError("values must contain key/value tuples")
        object.__setattr__(self, "values", values)
        object.__setattr__(self, "input_sha256", _hash(self.input_sha256, "input_sha256"))

    def as_dict(self) -> dict[str, str]:
        return dict(self.values)


@dataclass(frozen=True, slots=True)
class RunPreparation:
    capability_id: str
    workflow_identity: ControlWorkflowIdentity
    validated_input: ValidatedCapabilityInput
    risk_level: RiskLevel
    confirmation_required: bool
    availability: CapabilityAvailability
    blockers: tuple[str, ...]
    execution_engine: str
    executable_now: bool = False
    execution_side_effects: bool = False


@dataclass(frozen=True, slots=True)
class AutomationRunRequest:
    request_id: str
    capability_id: str
    workflow_identity: ControlWorkflowIdentity
    input_payload: tuple[tuple[str, str], ...]
    input_sha256: str
    state: RunRequestState
    risk_level: RiskLevel
    confirmation_required: bool
    confirmation_granted: bool
    blockers: tuple[str, ...]
    retry_of_request_id: str | None = None
    execution_authorized: bool = False
    dispatched: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "request_id", _identifier(self.request_id, "request_id"))
        if self.retry_of_request_id is not None:
            object.__setattr__(self, "retry_of_request_id", _identifier(self.retry_of_request_id, "retry_of_request_id"))
        for field_name in (
            "confirmation_required",
            "confirmation_granted",
            "execution_authorized",
            "dispatched",
        ):
            if not isinstance(getattr(self, field_name), bool):
                raise TypeError(f"{field_name} must be bool")
        if self.execution_authorized or self.dispatched:
            raise ValueError("control foundation cannot authorize or dispatch execution")


@dataclass(frozen=True, slots=True)
class ResultAction:
    action_type: ResultActionType
    label: str
    safe_value: str
    media_type: str
    primary: bool
    source_is_safe_projection: bool = True

    def __post_init__(self) -> None:
        if not isinstance(self.action_type, ResultActionType):
            raise TypeError("action_type must be ResultActionType")
        object.__setattr__(self, "label", _text(self.label, "label", max_length=128))
        if not isinstance(self.primary, bool) or not isinstance(self.source_is_safe_projection, bool):
            raise TypeError("primary and source_is_safe_projection must be bool")
        value = _text(self.safe_value, "safe_value", max_length=20000)
        if not self.source_is_safe_projection:
            raise ValueError("result actions require a safe result projection")
        if self.action_type in {ResultActionType.OPEN_FILE, ResultActionType.COPY_FILE_PATH}:
            value = _logical_ref(value, "safe_value")
        if self.action_type in {ResultActionType.OPEN_URL, ResultActionType.COPY_URL}:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
                raise ValueError("URL action requires a safe HTTP(S) URL")
        if self.action_type is ResultActionType.COPY_JSON:
            try:
                parsed_json = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("COPY_JSON requires valid JSON") from exc
            value = json.dumps(parsed_json, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        object.__setattr__(self, "safe_value", value)
        object.__setattr__(self, "media_type", _text(self.media_type, "media_type", max_length=128))


@dataclass(frozen=True, slots=True)
class HistoricalHealthObservation:
    execution_external_id: str
    execution_status: ResultExecutionStatus
    business_status: BusinessResultStatus
    observed_at: datetime | None
    safe_error_summary: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "execution_external_id", _identifier(self.execution_external_id, "execution_external_id"))
        if not isinstance(self.execution_status, ResultExecutionStatus):
            raise TypeError("execution_status must be ResultExecutionStatus")
        if not isinstance(self.business_status, BusinessResultStatus):
            raise TypeError("business_status must be BusinessResultStatus")
        _aware(self.observed_at, "observed_at")
        object.__setattr__(self, "safe_error_summary", _optional_text(self.safe_error_summary, "safe_error_summary", max_length=512))

    @property
    def failed(self) -> bool:
        return self.execution_status is ResultExecutionStatus.FAILED or self.business_status is BusinessResultStatus.FAILED

    @property
    def successful(self) -> bool:
        return self.execution_status is ResultExecutionStatus.SUCCESS and self.business_status is BusinessResultStatus.SUCCESS


@dataclass(frozen=True, slots=True)
class WorkflowHealthProjection:
    workflow_identity: ControlWorkflowIdentity
    current_run_state: ControlRunState
    current_runtime_observed: bool
    current_runtime_inference_allowed: bool
    last_observed_execution_id: str | None
    last_observed_at: str | None
    last_success_at: str | None
    last_failure_at: str | None
    consecutive_failures: int | None
    latest_safe_error_summary: str | None
    needs_attention: bool
    evidence_basis: str
    diagnostics: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DiagnosisRequest:
    request_id: str
    workflow_identity: ControlWorkflowIdentity
    problem_statement: str
    workflow_source_refs: tuple[str, ...]
    relevant_execution_ids: tuple[str, ...]
    safe_evidence: tuple[str, ...]
    expected_behavior: str
    observed_behavior: str
    cross_module_dispatch_performed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "request_id", _identifier(self.request_id, "request_id"))
        object.__setattr__(self, "problem_statement", _text(self.problem_statement, "problem_statement", max_length=2000))
        object.__setattr__(self, "workflow_source_refs", tuple(_logical_ref(value, "workflow_source_ref") for value in self.workflow_source_refs))
        object.__setattr__(self, "relevant_execution_ids", tuple(_identifier(value, "execution_id") for value in self.relevant_execution_ids))
        object.__setattr__(self, "safe_evidence", _tuple_text(self.safe_evidence, "safe_evidence"))
        object.__setattr__(self, "expected_behavior", _text(self.expected_behavior, "expected_behavior", max_length=2000))
        object.__setattr__(self, "observed_behavior", _text(self.observed_behavior, "observed_behavior", max_length=2000))
        if not isinstance(self.cross_module_dispatch_performed, bool):
            raise TypeError("cross_module_dispatch_performed must be bool")
        if self.cross_module_dispatch_performed:
            raise ValueError("control foundation cannot dispatch cross-module diagnosis")


@dataclass(frozen=True, slots=True)
class RepairRequest:
    request_id: str
    diagnosis_request_id: str
    workflow_identity: ControlWorkflowIdentity
    requested_change: str
    constraints: tuple[str, ...]
    source_revision_sha256: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "request_id", _identifier(self.request_id, "request_id"))
        object.__setattr__(self, "diagnosis_request_id", _identifier(self.diagnosis_request_id, "diagnosis_request_id"))
        object.__setattr__(self, "requested_change", _text(self.requested_change, "requested_change", max_length=2000))
        object.__setattr__(self, "constraints", _tuple_text(self.constraints, "constraint"))
        object.__setattr__(self, "source_revision_sha256", _hash(self.source_revision_sha256, "source_revision_sha256"))


@dataclass(frozen=True, slots=True)
class CandidateValidation:
    static_tests: ValidationOutcome
    sandbox_validation: ValidationOutcome
    test_summary: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.static_tests, ValidationOutcome) or not isinstance(self.sandbox_validation, ValidationOutcome):
            raise TypeError("validation outcomes are invalid")
        object.__setattr__(self, "test_summary", _tuple_text(self.test_summary, "test_summary"))


@dataclass(frozen=True, slots=True)
class RepairCandidate:
    candidate_id: str
    repair_request_id: str
    workflow_identity: ControlWorkflowIdentity
    source_revision_sha256: str
    modified_artifact_ref: str
    modified_artifact_sha256: str
    change_summary: str
    validation: CandidateValidation
    risk_level: RiskLevel
    state: CandidateState = CandidateState.DRAFT
    publish_eligible: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidate_id", _identifier(self.candidate_id, "candidate_id"))
        object.__setattr__(self, "repair_request_id", _identifier(self.repair_request_id, "repair_request_id"))
        object.__setattr__(self, "source_revision_sha256", _hash(self.source_revision_sha256, "source_revision_sha256"))
        object.__setattr__(self, "modified_artifact_ref", _logical_ref(self.modified_artifact_ref, "modified_artifact_ref"))
        object.__setattr__(self, "modified_artifact_sha256", _hash(self.modified_artifact_sha256, "modified_artifact_sha256"))
        object.__setattr__(self, "change_summary", _text(self.change_summary, "change_summary", max_length=2000))
        if not isinstance(self.validation, CandidateValidation) or not isinstance(self.risk_level, RiskLevel) or not isinstance(self.state, CandidateState):
            raise TypeError("repair candidate enum/validation values are invalid")
        if not isinstance(self.publish_eligible, bool):
            raise TypeError("publish_eligible must be bool")
        if self.publish_eligible:
            raise ValueError("repair candidate alone cannot be publish eligible")


@dataclass(frozen=True, slots=True)
class WorkflowBuildRequest:
    request_id: str
    capability_intent: str
    input_requirements: tuple[str, ...]
    output_requirements: tuple[str, ...]
    reuse_source_refs: tuple[str, ...]
    reuse_assessment: str
    risk_level: RiskLevel

    def __post_init__(self) -> None:
        object.__setattr__(self, "request_id", _identifier(self.request_id, "request_id"))
        object.__setattr__(self, "capability_intent", _text(self.capability_intent, "capability_intent", max_length=2000))
        object.__setattr__(self, "input_requirements", _tuple_text(self.input_requirements, "input_requirement"))
        object.__setattr__(self, "output_requirements", _tuple_text(self.output_requirements, "output_requirement"))
        object.__setattr__(self, "reuse_source_refs", tuple(_logical_ref(value, "reuse_source_ref") for value in self.reuse_source_refs))
        object.__setattr__(self, "reuse_assessment", _text(self.reuse_assessment, "reuse_assessment", max_length=2000))
        if not isinstance(self.risk_level, RiskLevel):
            raise TypeError("risk_level must be RiskLevel")


@dataclass(frozen=True, slots=True)
class WorkflowBuildCandidate:
    candidate_id: str
    build_request_id: str
    provider_kind: str
    candidate_artifact_ref: str
    candidate_artifact_sha256: str
    reused_source_refs: tuple[str, ...]
    change_summary: str
    validation: CandidateValidation
    state: CandidateState = CandidateState.DRAFT

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidate_id", _identifier(self.candidate_id, "candidate_id"))
        object.__setattr__(self, "build_request_id", _identifier(self.build_request_id, "build_request_id"))
        if not isinstance(self.provider_kind, str) or not _PROVIDER_KIND.fullmatch(self.provider_kind):
            raise ValueError("provider_kind must be a lowercase provider slug")
        object.__setattr__(self, "candidate_artifact_ref", _logical_ref(self.candidate_artifact_ref, "candidate_artifact_ref"))
        object.__setattr__(self, "candidate_artifact_sha256", _hash(self.candidate_artifact_sha256, "candidate_artifact_sha256"))
        object.__setattr__(self, "reused_source_refs", tuple(_logical_ref(value, "reused_source_ref") for value in self.reused_source_refs))
        object.__setattr__(self, "change_summary", _text(self.change_summary, "change_summary", max_length=2000))
        if not isinstance(self.validation, CandidateValidation) or not isinstance(self.state, CandidateState):
            raise TypeError("build candidate validation/state is invalid")


@dataclass(frozen=True, slots=True)
class DeploymentGateInput:
    candidate_id: str
    source_identity_resolved: bool
    target_provider_resolved: bool
    backup_ref: str | None
    restore_instructions_ref: str | None
    static_tests_passed: bool
    sandbox_passed: bool
    no_secret_exposure: bool
    user_approval_granted: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidate_id", _identifier(self.candidate_id, "candidate_id"))
        for field_name in (
            "source_identity_resolved",
            "target_provider_resolved",
            "static_tests_passed",
            "sandbox_passed",
            "no_secret_exposure",
            "user_approval_granted",
        ):
            if not isinstance(getattr(self, field_name), bool):
                raise TypeError(f"{field_name} must be bool")
        if self.backup_ref is not None:
            object.__setattr__(self, "backup_ref", _logical_ref(self.backup_ref, "backup_ref"))
        if self.restore_instructions_ref is not None:
            object.__setattr__(self, "restore_instructions_ref", _logical_ref(self.restore_instructions_ref, "restore_instructions_ref"))


@dataclass(frozen=True, slots=True)
class DeploymentGate:
    candidate_id: str
    state: DeploymentState
    publish_eligible: bool
    blockers: tuple[str, ...]
    user_approval_required: bool
    production_action_performed: bool = False

    def __post_init__(self) -> None:
        for field_name in ("publish_eligible", "user_approval_required", "production_action_performed"):
            if not isinstance(getattr(self, field_name), bool):
                raise TypeError(f"{field_name} must be bool")
        if self.production_action_performed:
            raise ValueError("deployment gate cannot perform production actions")


_CANDIDATE_TRANSITIONS = {
    CandidateState.DRAFT: {CandidateState.VALIDATION_PENDING, CandidateState.REJECTED, CandidateState.SUPERSEDED},
    CandidateState.VALIDATION_PENDING: {CandidateState.SANDBOX_PENDING, CandidateState.REJECTED, CandidateState.SUPERSEDED},
    CandidateState.SANDBOX_PENDING: {CandidateState.VALIDATED, CandidateState.REJECTED, CandidateState.SUPERSEDED},
    CandidateState.VALIDATED: {CandidateState.SUPERSEDED},
    CandidateState.REJECTED: set(),
    CandidateState.SUPERSEDED: set(),
}


def transition_candidate(candidate: RepairCandidate | WorkflowBuildCandidate, state: CandidateState) -> RepairCandidate | WorkflowBuildCandidate:
    if not isinstance(candidate, (RepairCandidate, WorkflowBuildCandidate)) or not isinstance(state, CandidateState):
        raise TypeError("candidate/state is invalid")
    if state not in _CANDIDATE_TRANSITIONS[candidate.state]:
        raise ValueError("candidate lifecycle transition is not allowed")
    if state is CandidateState.SANDBOX_PENDING and candidate.validation.static_tests is not ValidationOutcome.PASS:
        raise ValueError("static tests must pass before sandbox validation")
    if state is CandidateState.VALIDATED and (
        candidate.validation.static_tests is not ValidationOutcome.PASS
        or candidate.validation.sandbox_validation is not ValidationOutcome.PASS
    ):
        raise ValueError("static and sandbox validation must pass")
    return replace(candidate, state=state)


class AutomationControlService:
    """Pure request/projection service. It has no provider dispatcher or executor."""

    def __init__(self, registry: CapabilityRegistry) -> None:
        if not isinstance(registry, CapabilityRegistry):
            raise TypeError("registry must be CapabilityRegistry")
        self.registry = registry

    def validate_input(self, capability_id: str, payload: Mapping[str, Any]) -> ValidatedCapabilityInput:
        capability = self.registry.get_capability(capability_id)
        values = capability.input_schema.validate(payload)
        encoded = json.dumps(dict(values), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        return ValidatedCapabilityInput(capability_id, values, hashlib.sha256(encoded.encode("utf-8")).hexdigest())

    def prepare_run(self, capability_id: str, payload: Mapping[str, Any]) -> RunPreparation:
        capability = self.registry.get_capability(capability_id)
        validated = self.validate_input(capability_id, payload)
        blockers: list[str] = []
        if not capability.workflow_identity.resolved:
            blockers.append("provider_instance_unresolved")
        if not capability.provenance.production_target_resolved:
            blockers.append("production_target_unresolved")
        if capability.availability is not CapabilityAvailability.AVAILABLE:
            blockers.append("capability_not_available_for_execution")
        blockers.extend(("auth_required", "workflow_metadata_required", "execution_adapter_disabled"))
        return RunPreparation(
            capability_id=capability_id,
            workflow_identity=capability.workflow_identity,
            validated_input=validated,
            risk_level=capability.risk_level,
            confirmation_required=capability.confirmation_policy is not ConfirmationPolicy.NONE,
            availability=capability.availability,
            blockers=tuple(dict.fromkeys(blockers)),
            execution_engine=capability.execution_engine,
        )

    def create_run_request(
        self,
        capability_id: str,
        payload: Mapping[str, Any],
        request_id: str,
        *,
        confirmation_granted: bool = False,
    ) -> AutomationRunRequest:
        preparation = self.prepare_run(capability_id, payload)
        if preparation.blockers:
            state = RunRequestState.BLOCKED
        elif preparation.confirmation_required and not confirmation_granted:
            state = RunRequestState.AWAITING_CONFIRMATION
        else:
            state = RunRequestState.READY_FOR_PROVIDER
        return AutomationRunRequest(
            request_id=request_id,
            capability_id=capability_id,
            workflow_identity=preparation.workflow_identity,
            input_payload=preparation.validated_input.values,
            input_sha256=preparation.validated_input.input_sha256,
            state=state,
            risk_level=preparation.risk_level,
            confirmation_required=preparation.confirmation_required,
            confirmation_granted=confirmation_granted,
            blockers=preparation.blockers,
        )

    def retry_request(self, request: AutomationRunRequest, request_id: str) -> AutomationRunRequest:
        if not isinstance(request, AutomationRunRequest):
            raise TypeError("request must be AutomationRunRequest")
        return replace(
            request,
            request_id=_identifier(request_id, "request_id"),
            retry_of_request_id=request.request_id,
            state=RunRequestState.BLOCKED if request.blockers else RunRequestState.PREPARED,
            execution_authorized=False,
            dispatched=False,
        )

    @staticmethod
    def create_result_action(
        action_type: ResultActionType,
        safe_value: str,
        *,
        label: str,
        media_type: str,
        primary: bool = False,
    ) -> ResultAction:
        return ResultAction(action_type, label, safe_value, media_type, primary)

    @staticmethod
    def project_health(
        workflow_identity: ControlWorkflowIdentity,
        observations: Iterable[HistoricalHealthObservation],
    ) -> WorkflowHealthProjection:
        if not isinstance(workflow_identity, ControlWorkflowIdentity):
            raise TypeError("workflow_identity must be ControlWorkflowIdentity")
        values = tuple(observations)
        if not all(isinstance(item, HistoricalHealthObservation) for item in values):
            raise TypeError("observations must contain HistoricalHealthObservation values")
        dated = sorted((item for item in values if item.observed_at is not None), key=lambda item: item.observed_at, reverse=True)
        diagnostics: list[str] = ["historical_evidence_only", "current_runtime_not_observed"]
        latest = dated[0] if dated else None
        if not dated and values:
            diagnostics.append("undated_history_excluded_from_latest")
        tied_latest = bool(latest and sum(item.observed_at == latest.observed_at for item in dated) > 1)
        if tied_latest:
            diagnostics.append("latest_historical_observation_ambiguous")
            latest = None
        success_times = [item.observed_at for item in dated if item.successful]
        failure_times = [item.observed_at for item in dated if item.failed]
        consecutive: int | None = None
        if latest is not None:
            consecutive = 0
            for item in dated:
                if item.failed:
                    consecutive += 1
                else:
                    break
        needs_attention = bool(latest and latest.failed)
        return WorkflowHealthProjection(
            workflow_identity=workflow_identity,
            current_run_state=ControlRunState.UNKNOWN,
            current_runtime_observed=False,
            current_runtime_inference_allowed=False,
            last_observed_execution_id=latest.execution_external_id if latest else None,
            last_observed_at=latest.observed_at.isoformat() if latest and latest.observed_at else None,
            last_success_at=max(success_times).isoformat() if success_times else None,
            last_failure_at=max(failure_times).isoformat() if failure_times else None,
            consecutive_failures=consecutive,
            latest_safe_error_summary=latest.safe_error_summary if latest and latest.failed else None,
            needs_attention=needs_attention,
            evidence_basis="historical_result_only",
            diagnostics=tuple(diagnostics),
        )

    @staticmethod
    def evaluate_deployment_gate(value: DeploymentGateInput) -> DeploymentGate:
        if not isinstance(value, DeploymentGateInput):
            raise TypeError("value must be DeploymentGateInput")
        blockers: list[str] = []
        checks = (
            (value.source_identity_resolved, "source_identity_unresolved"),
            (value.target_provider_resolved, "target_provider_unresolved"),
            (value.backup_ref is not None, "backup_missing"),
            (value.restore_instructions_ref is not None, "restore_instructions_missing"),
            (value.static_tests_passed, "static_tests_not_passed"),
            (value.sandbox_passed, "sandbox_not_passed"),
            (value.no_secret_exposure, "secret_safety_not_confirmed"),
            (value.user_approval_granted, "user_approval_required"),
        )
        for passed, code in checks:
            if not passed:
                blockers.append(code)
        if not value.static_tests_passed or not value.sandbox_passed:
            state = DeploymentState.TESTING
        elif blockers:
            state = DeploymentState.VALIDATED
        else:
            state = DeploymentState.READY_TO_PUBLISH
        return DeploymentGate(
            candidate_id=value.candidate_id,
            state=state,
            publish_eligible=not blockers,
            blockers=tuple(blockers),
            user_approval_required=True,
        )


def build_v141_knowledge_collect_capability() -> AutomationCapability:
    return AutomationCapability(
        capability_id="knowledge.collect",
        display_name="AI 知识库采集",
        description_for_ai=(
            "根据 AI 产品名称和可选资料原文或来源网址，委托既有 n8n Workflow 生成待审核知识库 Markdown 候选。"
        ),
        workflow_identity=ControlWorkflowIdentity(
            provider_kind="n8n",
            provider_instance_id="n8n-tiangong-primary",
            external_workflow_id="ymYh8t76VP3jGPbr",
        ),
        input_schema=CapabilityInputSchema(
            fields=(
                CapabilityInputField("ai_name", "AI 产品名称", InputFieldKind.TEXT, True, 128),
                CapabilityInputField("source_text", "资料原文", InputFieldKind.LONG_TEXT, False, 12000),
                CapabilityInputField("source_url", "来源网址", InputFieldKind.URL, False, 2048),
            )
        ),
        output_schema=CapabilityOutputSchema(
            result_type="knowledge_markdown_document",
            media_type="text/markdown",
            primary_action=ResultActionType.COPY_MARKDOWN,
            allowed_actions=(
                ResultActionType.COPY_MARKDOWN,
                ResultActionType.COPY_TEXT,
                ResultActionType.OPEN_FILE,
                ResultActionType.COPY_FILE_PATH,
            ),
        ),
        risk_level=RiskLevel.MEDIUM,
        confirmation_policy=ConfirmationPolicy.ALWAYS,
        availability=CapabilityAvailability.CONFIGURATION_REQUIRED,
        invocation_modes=(InvocationMode.FORM, InvocationMode.PROVIDER_DELEGATED),
        provenance=CapabilityProvenance(
            canonical_source_ref="source_import/n8n_工作流开发/output/中国AI知识库采集器_V1.4.1_网页失败兜底版.json",
            canonical_source_sha256="B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514",
            canonical_version="V1.4.1",
            sandbox_source_ref="source_import/n8n_工作流开发/_system/n8n_runtime_test/中国AI知识库采集器_V1.4.1_隔离测试版.json",
            sandbox_source_sha256="F05B31D86EB0467946546557F71C5AEAC91D992451CB0E0000F7824725B9DDB6",
            result_evidence_refs=(
                "source_import/n8n_工作流开发/_system/n8n_runtime_test/evidence/authbridge5_parsed_results.json",
                "source_import/n8n_工作流开发/_system/n8n_runtime_test/evidence/authbridge5_run_summary.json",
            ),
            production_target_resolved=True,
        ),
        execution_engine="n8n",
    )


def build_default_capability_registry() -> CapabilityRegistry:
    return CapabilityRegistry((build_v141_knowledge_collect_capability(),))


def build_control_service(registry: CapabilityRegistry | None = None) -> AutomationControlService:
    return AutomationControlService(registry or build_default_capability_registry())


def serialize_control_contract(value: Any) -> str:
    return json.dumps(
        result_to_primitive(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


__all__ = [
    "CONTROL_FOUNDATION_VERSION",
    "AutomationCapability",
    "AutomationControlService",
    "AutomationRunRequest",
    "CandidateState",
    "CandidateValidation",
    "CapabilityAvailability",
    "CapabilityInputField",
    "CapabilityInputSchema",
    "CapabilityNotFoundError",
    "CapabilityOutputSchema",
    "CapabilityProvenance",
    "CapabilityRegistry",
    "ConfirmationPolicy",
    "ControlRunState",
    "ControlWorkflowIdentity",
    "DeploymentGate",
    "DeploymentGateInput",
    "DeploymentState",
    "DiagnosisRequest",
    "HistoricalHealthObservation",
    "InputFieldKind",
    "InvocationMode",
    "RepairCandidate",
    "RepairRequest",
    "ResultAction",
    "ResultActionType",
    "RiskLevel",
    "RunPreparation",
    "RunRequestState",
    "ValidatedCapabilityInput",
    "ValidationOutcome",
    "WorkflowBuildCandidate",
    "WorkflowBuildRequest",
    "WorkflowHealthProjection",
    "build_control_service",
    "build_default_capability_registry",
    "build_v141_knowledge_collect_capability",
    "serialize_control_contract",
    "transition_candidate",
]
