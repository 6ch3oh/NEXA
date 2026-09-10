"""Tiangong manual-run preparation contracts; no credentials or execution."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
import hashlib
import ipaddress
import json
import re
from typing import Any, Mapping, Protocol, runtime_checkable
from urllib.parse import urlsplit

from automation_center.application.instance_confirmation import ArtifactFilenamePolicy
from automation_center.product import (
    AutomationProviderConfig,
    ProductResultArtifact,
    ProviderHealthObservation,
    ProviderHealthState,
)


TIANGONG_RUN_PREP_VERSION = "0.1"
TIANGONG_PROVIDER_INSTANCE_ID = "n8n-tiangong-primary"
TIANGONG_DISPLAY_NAME = "天工"
TIANGONG_CONFIRMATION_PROVENANCE = "USER_CONFIRMED"
TIANGONG_WORKFLOW_EXTERNAL_ID = "ymYh8t76VP3jGPbr"
TIANGONG_ENDPOINT = "http://127.0.0.1:5678"
TIANGONG_MANUAL_RUN_PREP_STATE = "TIANGONG_KNOWLEDGE_COLLECT_MANUAL_RUN_PREP_READY"

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
_RELATIVE_PATH = re.compile(r"^[A-Za-z0-9._~!$&'()+,;=:@%/-]{1,512}$")
_SENSITIVE = re.compile(
    r"(?:bearer\s+[A-Za-z0-9._~+/=-]{6,}|sk-[A-Za-z0-9_-]{8,}|"
    r"-----BEGIN [A-Z ]+PRIVATE KEY-----|"
    r"(?:api[_-]?key|token|secret|password|cookie)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)


def _identifier(value: str, name: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"{name} is invalid")
    return value


def _safe_text(value: str, name: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{name} must be text")
    normalized = value.strip()
    if not normalized or len(normalized) > maximum:
        raise ValueError(f"{name} is invalid")
    if any(ord(char) < 32 and char not in "\n\t" for char in normalized):
        raise ValueError(f"{name} contains control characters")
    if _SENSITIVE.search(normalized):
        raise ValueError(f"{name} contains sensitive material")
    return normalized


def _aware(value: datetime, name: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value


def _parse_time(value: Any, name: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{name} is invalid")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return _aware(parsed, name)


def _logical_path(value: str, name: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{name} must be text")
    normalized = value.strip().replace("\\", "/")
    if not normalized or len(normalized) > 512 or any(ord(char) < 32 for char in normalized):
        raise ValueError(f"{name} is invalid")
    if normalized.startswith("/") or ".." in normalized.split("/") or re.match(r"^[A-Za-z]:", normalized) or "://" in normalized:
        raise ValueError(f"{name} must be a logical relative path")
    return normalized


class CredentialAvailability(str, Enum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class CredentialRef:
    ref_id: str
    provider_instance_id: str
    credential_kind: str
    availability: CredentialAvailability
    source: str = "controlled_credential_store"

    def __post_init__(self) -> None:
        _identifier(self.ref_id, "ref_id")
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID:
            raise ValueError("CredentialRef is not bound to Tiangong")
        _identifier(self.credential_kind, "credential_kind")
        if not isinstance(self.availability, CredentialAvailability):
            raise TypeError("availability must be CredentialAvailability")
        _identifier(self.source, "source")


@dataclass(frozen=True, slots=True)
class AuthSessionRequest:
    request_id: str
    provider_instance_id: str
    credential_ref_id: str
    required_scopes: tuple[str, ...]
    secret_delivery_target: str = "trusted_transport_only"
    application_secret_access: bool = False

    def __post_init__(self) -> None:
        _identifier(self.request_id, "request_id")
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID:
            raise ValueError("Auth session is not bound to Tiangong")
        _identifier(self.credential_ref_id, "credential_ref_id")
        scopes = tuple(self.required_scopes)
        allowed = {"workflow.metadata.read", "execution.status.read", "workflow.invoke"}
        if not scopes or not set(scopes).issubset(allowed):
            raise ValueError("required_scopes are invalid")
        if self.secret_delivery_target != "trusted_transport_only" or self.application_secret_access:
            raise ValueError("Secret material must stay inside the trusted transport")
        object.__setattr__(self, "required_scopes", scopes)


@dataclass(frozen=True, slots=True)
class RedactedAuthContext:
    session_request_id: str
    provider_instance_id: str
    credential_ref_id: str
    granted_scopes: tuple[str, ...]
    availability: CredentialAvailability
    redaction_marker: str = "SECRET_NOT_EXPOSED"

    def __post_init__(self) -> None:
        _identifier(self.session_request_id, "session_request_id")
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID:
            raise ValueError("Auth context is not bound to Tiangong")
        _identifier(self.credential_ref_id, "credential_ref_id")
        if not isinstance(self.availability, CredentialAvailability):
            raise TypeError("availability must be CredentialAvailability")
        if self.redaction_marker != "SECRET_NOT_EXPOSED":
            raise ValueError("Auth context must remain redacted")
        object.__setattr__(self, "granted_scopes", tuple(self.granted_scopes))


@runtime_checkable
class CredentialProvider(Protocol):
    """Implemented by a secure store boundary outside ordinary Application code."""

    def create_redacted_context(self, request: AuthSessionRequest) -> RedactedAuthContext: ...


class N8nCredentialBoundary:
    SECRET_REDACTION_RULES = (
        "never accept secret values in Application DTOs",
        "trusted transport resolves CredentialRef",
        "diagnostics replace sensitive patterns",
        "API responses expose reference and availability only",
    )

    @staticmethod
    def create_session_request(
        credential_ref: CredentialRef,
        *,
        request_id: str,
        scopes: tuple[str, ...],
    ) -> AuthSessionRequest:
        if not isinstance(credential_ref, CredentialRef):
            raise TypeError("credential_ref must be CredentialRef")
        return AuthSessionRequest(
            request_id,
            credential_ref.provider_instance_id,
            credential_ref.ref_id,
            scopes,
        )

    @staticmethod
    def redacted_context(request: AuthSessionRequest, credential_ref: CredentialRef) -> RedactedAuthContext:
        if request.credential_ref_id != credential_ref.ref_id:
            raise ValueError("Credential reference mismatch")
        return RedactedAuthContext(
            request.request_id,
            request.provider_instance_id,
            request.credential_ref_id,
            request.required_scopes if credential_ref.availability is CredentialAvailability.AVAILABLE else (),
            credential_ref.availability,
        )

    @staticmethod
    def sanitize_diagnostic(value: str) -> str:
        if not isinstance(value, str):
            raise TypeError("diagnostic must be text")
        return _SENSITIVE.sub("[REDACTED]", value)[:512]

    @staticmethod
    def auth_required_diagnostic(credential_ref: CredentialRef | None) -> dict[str, Any]:
        return {
            "state": "AUTH_REQUIRED",
            "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
            "credential_ref_id": credential_ref.ref_id if credential_ref else None,
            "availability": credential_ref.availability.value if credential_ref else "UNKNOWN",
            "secret_exposed": False,
        }


@dataclass(frozen=True, slots=True)
class SafeTransportResponse:
    status_code: int
    effective_url: str
    payload: Mapping[str, Any]

    def __post_init__(self) -> None:
        if not isinstance(self.status_code, int) or not 100 <= self.status_code <= 599:
            raise ValueError("status_code is invalid")
        if not isinstance(self.payload, Mapping):
            raise TypeError("payload must be a mapping")


@runtime_checkable
class AuthenticatedN8nReadTransport(Protocol):
    """The only layer permitted to resolve CredentialRef inside a secure implementation."""

    def get_json(
        self,
        url: str,
        auth_request: AuthSessionRequest,
        timeout_seconds: float,
    ) -> SafeTransportResponse: ...


class MetadataReadState(str, Enum):
    AUTH_REQUIRED = "AUTH_REQUIRED"
    OBSERVED = "OBSERVED"
    NOT_FOUND = "NOT_FOUND"
    FAILED = "FAILED"


@dataclass(frozen=True, slots=True)
class N8nFormInvocationSurface:
    provider_instance_id: str
    workflow_external_id: str
    trigger_type: str
    invocation_path: str | None
    method: str
    required_input_mapping: tuple[tuple[str, str], ...]
    authentication_requirement: str
    expected_execution_identity_availability: str
    result_correlation_readiness: str
    safety_classification: str
    state: str

    def __post_init__(self) -> None:
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID:
            raise ValueError("Form surface is not bound to Tiangong")
        if self.workflow_external_id != TIANGONG_WORKFLOW_EXTERNAL_ID:
            raise ValueError("Form surface is not bound to knowledge.collect")
        if self.trigger_type != "form" or self.method != "POST":
            raise ValueError("Only the n8n Form POST surface is supported")
        if self.invocation_path is not None:
            path = self.invocation_path.replace("\\", "/")
            if not path.startswith("/form/") or ".." in path.split("/") or "://" in path:
                raise ValueError("invocation_path is unsafe")
            object.__setattr__(self, "invocation_path", path)
        expected = (("ai_name", "ai_name"), ("source_text", "source_text"), ("source_url", "source_url"))
        if tuple(self.required_input_mapping) != expected:
            raise ValueError("Form input mapping is not the frozen knowledge.collect schema")
        if self.safety_classification != "CONTROLLED_MANUAL_SIDE_EFFECT":
            raise ValueError("Form invocation must be classified as a controlled side effect")


@dataclass(frozen=True, slots=True)
class WorkflowRuntimeMetadata:
    provider_instance_id: str
    workflow_external_id: str
    workflow_name: str
    membership_confirmed: bool
    active: bool
    version_id: str
    updated_at: datetime
    trigger_surfaces: tuple[N8nFormInvocationSurface, ...]
    execution_capable_surface_confirmed: bool
    observed_at: datetime
    freshness: str
    evidence_provenance: str

    def __post_init__(self) -> None:
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID:
            raise ValueError("Metadata is not bound to Tiangong")
        if self.workflow_external_id != TIANGONG_WORKFLOW_EXTERNAL_ID or not self.membership_confirmed:
            raise ValueError("Metadata membership is not confirmed")
        _safe_text(self.workflow_name, "workflow_name", 256)
        if not isinstance(self.active, bool) or not isinstance(self.execution_capable_surface_confirmed, bool):
            raise TypeError("metadata booleans are invalid")
        _identifier(self.version_id, "version_id")
        _aware(self.updated_at, "updated_at")
        _aware(self.observed_at, "observed_at")
        if self.freshness not in {"fresh", "stale"}:
            raise ValueError("freshness is invalid")
        surfaces = tuple(self.trigger_surfaces)
        if not all(isinstance(item, N8nFormInvocationSurface) for item in surfaces):
            raise TypeError("trigger_surfaces are invalid")
        object.__setattr__(self, "trigger_surfaces", surfaces)


@dataclass(frozen=True, slots=True)
class WorkflowMetadataReadResult:
    state: MetadataReadState
    metadata: WorkflowRuntimeMetadata | None
    diagnostics: tuple[str, ...]
    auth_secret_exposed: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.state, MetadataReadState):
            raise TypeError("state must be MetadataReadState")
        if (self.state is MetadataReadState.OBSERVED) != (self.metadata is not None):
            raise ValueError("metadata presence does not match state")
        if self.auth_secret_exposed:
            raise ValueError("Metadata result cannot expose Auth Secret")


class N8nWorkflowMetadataReader:
    """Read-only, loopback-only metadata adapter over an injected secure transport."""

    def __init__(self, transport: AuthenticatedN8nReadTransport | None = None) -> None:
        self._transport = transport

    def read(
        self,
        config: AutomationProviderConfig,
        auth_request: AuthSessionRequest | None,
        *,
        timeout_seconds: float = 2.0,
    ) -> WorkflowMetadataReadResult:
        _require_tiangong_config(config)
        if auth_request is None:
            return WorkflowMetadataReadResult(MetadataReadState.AUTH_REQUIRED, None, ("auth_session_required",))
        if "workflow.metadata.read" not in auth_request.required_scopes:
            return WorkflowMetadataReadResult(MetadataReadState.AUTH_REQUIRED, None, ("metadata_scope_required",))
        if self._transport is None:
            return WorkflowMetadataReadResult(MetadataReadState.AUTH_REQUIRED, None, ("secure_transport_not_configured",))
        url = f"{TIANGONG_ENDPOINT}/api/v1/workflows/{TIANGONG_WORKFLOW_EXTERNAL_ID}"
        try:
            response = self._transport.get_json(url, auth_request, timeout_seconds)
            self._validate_effective_url(response.effective_url, f"/api/v1/workflows/{TIANGONG_WORKFLOW_EXTERNAL_ID}")
            if response.status_code in {401, 403}:
                return WorkflowMetadataReadResult(MetadataReadState.AUTH_REQUIRED, None, ("provider_auth_rejected",))
            if response.status_code == 404:
                return WorkflowMetadataReadResult(MetadataReadState.NOT_FOUND, None, ("workflow_membership_not_found",))
            if response.status_code != 200:
                return WorkflowMetadataReadResult(MetadataReadState.FAILED, None, ("metadata_read_failed",))
            return WorkflowMetadataReadResult(MetadataReadState.OBSERVED, self._parse(response.payload), ())
        except Exception:
            # The transport is a trust boundary. Never project exception text: a
            # provider implementation could include credential material in it.
            return WorkflowMetadataReadResult(MetadataReadState.FAILED, None, ("unsafe_or_invalid_metadata_response",))

    @staticmethod
    def _validate_effective_url(value: str, expected_path: str) -> None:
        parsed = urlsplit(value)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port != 5678:
            raise ValueError("metadata transport escaped the loopback allowlist")
        if parsed.path != expected_path or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError("metadata transport returned an unexpected URL")

    @staticmethod
    def _parse(payload: Mapping[str, Any]) -> WorkflowRuntimeMetadata:
        if payload.get("id") != TIANGONG_WORKFLOW_EXTERNAL_ID:
            raise ValueError("workflow membership mismatch")
        workflow_name = _safe_text(payload.get("name", "knowledge.collect"), "workflow_name", 256)
        if not isinstance(payload.get("active"), bool):
            raise ValueError("active is invalid")
        version_id = _identifier(payload.get("versionId"), "version_id")
        updated_at = _parse_time(payload.get("updatedAt"), "updated_at")
        nodes = payload.get("nodes", ())
        if not isinstance(nodes, (list, tuple)):
            raise ValueError("nodes metadata is invalid")
        surfaces: list[N8nFormInvocationSurface] = []
        for node in nodes:
            if not isinstance(node, Mapping) or node.get("type") != "n8n-nodes-base.formTrigger":
                continue
            form_id = node.get("webhookId")
            path = f"/form/{_identifier(form_id, 'form_trigger_id')}" if form_id is not None else None
            parameters = node.get("parameters", {})
            if not isinstance(parameters, Mapping):
                raise ValueError("form parameters are invalid")
            form_fields = parameters.get("formFields", {})
            values = form_fields.get("values", ()) if isinstance(form_fields, Mapping) else ()
            if not isinstance(values, (list, tuple)):
                raise ValueError("form fields are invalid")
            field_names = tuple(item.get("fieldName") for item in values if isinstance(item, Mapping))
            expected = ("ai_name", "source_text", "source_url")
            if values and field_names != expected:
                raise ValueError("form input mapping differs from the frozen schema")
            surfaces.append(_form_surface(path))
        observed_at = datetime.now(timezone.utc)
        return WorkflowRuntimeMetadata(
            TIANGONG_PROVIDER_INSTANCE_ID,
            TIANGONG_WORKFLOW_EXTERNAL_ID,
            workflow_name,
            True,
            payload["active"],
            version_id,
            updated_at,
            tuple(surfaces),
            any(item.invocation_path is not None for item in surfaces),
            observed_at,
            "fresh",
            "authenticated_n8n_metadata_read",
        )


def _form_surface(path: str | None) -> N8nFormInvocationSurface:
    return N8nFormInvocationSurface(
        TIANGONG_PROVIDER_INSTANCE_ID,
        TIANGONG_WORKFLOW_EXTERNAL_ID,
        "form",
        path,
        "POST",
        (("ai_name", "ai_name"), ("source_text", "source_text"), ("source_url", "source_url")),
        "provider_surface_specific",
        "expected_from_n8n_response",
        "execution_manifest_required",
        "CONTROLLED_MANUAL_SIDE_EFFECT",
        "IMPLEMENTATION_READY" if path else "METADATA_REQUIRED",
    )


class SourceURLSafety(str, Enum):
    NO_URL = "NO_URL"
    PUBLIC_NETWORK = "PUBLIC_NETWORK"
    LOCAL_ADDRESS_RISK = "LOCAL_ADDRESS_RISK"


@dataclass(frozen=True, slots=True, repr=False)
class ValidatedKnowledgeCollectInput:
    ai_name: str
    artifact_filename: str
    source_text: str | None
    source_url: str | None
    source_url_safety: SourceURLSafety
    input_sha256: str

    def __repr__(self) -> str:
        return (
            "ValidatedKnowledgeCollectInput("
            f"ai_name={self.ai_name!r}, artifact_filename={self.artifact_filename!r}, "
            f"source_text_length={len(self.source_text or '')}, source_url_present={self.source_url is not None}, "
            f"source_url_safety={self.source_url_safety.value!r}, input_sha256={self.input_sha256!r})"
        )

    @property
    def safe_source_summary(self) -> str:
        if self.source_url:
            parsed = urlsplit(self.source_url)
            return f"{parsed.scheme}://{parsed.hostname}/…"
        if self.source_text:
            return f"提供了 {len(self.source_text)} 个字符的资料原文"
        return "未提供可选来源"


class KnowledgeCollectInputPolicy:
    MAX_SOURCE_TEXT_BYTES = 48_000

    def validate(self, payload: Mapping[str, Any]) -> ValidatedKnowledgeCollectInput:
        if not isinstance(payload, Mapping) or set(payload) - {"ai_name", "source_text", "source_url"}:
            raise ValueError("knowledge.collect input fields are invalid")
        ai_name = _safe_text(payload.get("ai_name"), "ai_name", 128)
        artifact_filename = ArtifactFilenamePolicy().validate(ai_name)
        source_text = payload.get("source_text")
        if source_text in {None, ""}:
            source_text = None
        else:
            source_text = source_text.replace("\r\n", "\n").replace("\r", "\n") if isinstance(source_text, str) else source_text
            source_text = _safe_text(source_text, "source_text", 12_000)
            if len(source_text.encode("utf-8")) > self.MAX_SOURCE_TEXT_BYTES:
                raise ValueError("source_text exceeds encoded size limit")
        source_url = payload.get("source_url")
        if source_url in {None, ""}:
            source_url = None
            url_safety = SourceURLSafety.NO_URL
        else:
            source_url = _safe_text(source_url, "source_url", 2048)
            parsed = urlsplit(source_url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("source_url must be a safe HTTP(S) URL")
            url_safety = SourceURLSafety.LOCAL_ADDRESS_RISK if self._local_address(parsed.hostname) else SourceURLSafety.PUBLIC_NETWORK
        canonical = json.dumps(
            {"ai_name": ai_name, "source_text": source_text, "source_url": source_url},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return ValidatedKnowledgeCollectInput(
            ai_name,
            artifact_filename,
            source_text,
            source_url,
            url_safety,
            hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        )

    @staticmethod
    def _local_address(host: str) -> bool:
        lowered = host.lower().rstrip(".")
        if lowered in {"localhost", "localhost.localdomain"} or lowered.endswith(".local"):
            return True
        try:
            address = ipaddress.ip_address(lowered)
        except ValueError:
            return False
        return not address.is_global


class ManualRunPreflightState(str, Enum):
    READY = "READY"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    METADATA_REQUIRED = "METADATA_REQUIRED"
    INPUT_INVALID = "INPUT_INVALID"
    ARTIFACT_BLOCKED = "ARTIFACT_BLOCKED"
    USER_CONFIRMATION_REQUIRED = "USER_CONFIRMATION_REQUIRED"
    NOT_READY = "NOT_READY"


@dataclass(frozen=True, slots=True)
class PreflightCheck:
    name: str
    passed: bool
    blocker: str | None = None


@dataclass(frozen=True, slots=True)
class ManualRunPreflight:
    state: ManualRunPreflightState
    provider_instance_id: str
    capability_id: str
    checks: tuple[PreflightCheck, ...]
    blockers: tuple[str, ...]
    input_manifest: Mapping[str, Any] | None
    execution_performed: bool = False

    def __post_init__(self) -> None:
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID or self.capability_id != "knowledge.collect":
            raise ValueError("preflight target is invalid")
        if self.execution_performed:
            raise ValueError("preflight cannot execute a Workflow")


def evaluate_manual_run_preflight(
    *,
    config: AutomationProviderConfig,
    health: ProviderHealthObservation | None,
    credential_ref: CredentialRef | None,
    metadata_result: WorkflowMetadataReadResult | None,
    input_payload: Mapping[str, Any],
    artifact_binding_ready: bool,
    artifact_reader_ready: bool,
    execution_confirmation_available: bool,
) -> ManualRunPreflight:
    input_value: ValidatedKnowledgeCollectInput | None = None
    try:
        _require_tiangong_config(config)
        input_value = KnowledgeCollectInputPolicy().validate(input_payload)
        input_valid = True
    except (TypeError, ValueError):
        input_valid = False
    metadata = metadata_result.metadata if metadata_result and metadata_result.state is MetadataReadState.OBSERVED else None
    surface = next((item for item in metadata.trigger_surfaces if item.invocation_path), None) if metadata else None
    credential_available = bool(credential_ref and credential_ref.availability is CredentialAvailability.AVAILABLE)
    checks = (
        PreflightCheck("provider_identity_confirmed", config.confirmed and config.provider_instance_id == TIANGONG_PROVIDER_INSTANCE_ID, "PROVIDER_IDENTITY_REQUIRED"),
        PreflightCheck("provider_health_fresh", bool(health and health.state is ProviderHealthState.HEALTHY and health.freshness == "fresh"), "PROVIDER_HEALTH_REQUIRED"),
        PreflightCheck("workflow_target_resolved", True, None),
        PreflightCheck("auth_available", credential_available, "AUTH_REQUIRED"),
        PreflightCheck("metadata_membership_confirmed", bool(metadata and metadata.membership_confirmed), "METADATA_REQUIRED"),
        PreflightCheck("workflow_active_callable", bool(metadata and metadata.active), "WORKFLOW_NOT_CALLABLE"),
        PreflightCheck("invocation_surface_resolved", surface is not None, "INVOCATION_SURFACE_REQUIRED"),
        PreflightCheck("input_valid", input_valid, "INPUT_INVALID"),
        PreflightCheck("filename_safe", input_valid, "FILENAME_UNSAFE"),
        PreflightCheck("result_artifact_binding_ready", artifact_binding_ready, "ARTIFACT_BINDING_REQUIRED"),
        PreflightCheck("result_reader_implementation_ready", artifact_reader_ready, "ARTIFACT_READER_REQUIRED"),
        PreflightCheck("execution_confirmation_available", execution_confirmation_available, "USER_CONFIRMATION_REQUIRED"),
    )
    blockers = tuple(check.blocker for check in checks if not check.passed and check.blocker)
    if not input_valid:
        state = ManualRunPreflightState.INPUT_INVALID
    elif not credential_available:
        state = ManualRunPreflightState.AUTH_REQUIRED
    elif metadata is None or surface is None:
        state = ManualRunPreflightState.METADATA_REQUIRED
    elif not artifact_binding_ready or not artifact_reader_ready:
        state = ManualRunPreflightState.ARTIFACT_BLOCKED
    elif not execution_confirmation_available:
        state = ManualRunPreflightState.USER_CONFIRMATION_REQUIRED
    elif blockers:
        state = ManualRunPreflightState.NOT_READY
    else:
        state = ManualRunPreflightState.READY
    manifest = None if input_value is None else {
        "ai_name": input_value.ai_name,
        "artifact_filename": input_value.artifact_filename,
        "source_text_provided": input_value.source_text is not None,
        "source_text_length": len(input_value.source_text or ""),
        "source_url_provided": input_value.source_url is not None,
        "source_url_safety": input_value.source_url_safety.value,
        "input_sha256": input_value.input_sha256,
        "raw_source_content_exposed": False,
    }
    return ManualRunPreflight(
        state,
        TIANGONG_PROVIDER_INSTANCE_ID,
        "knowledge.collect",
        checks,
        blockers,
        manifest,
    )


@dataclass(frozen=True, slots=True)
class RunConfirmationPayload:
    title: str
    provider_display_name: str
    capability_display_name: str
    ai_name: str
    source_summary: str
    output_summary: str
    intended_operation: str
    risk: str
    actions: tuple[str, ...] = ("RUN", "CANCEL")
    credential_exposed: bool = False
    internal_url_exposed: bool = False

    def __post_init__(self) -> None:
        if self.provider_display_name != TIANGONG_DISPLAY_NAME:
            raise ValueError("confirmation payload must use Tiangong display name")
        if self.credential_exposed or self.internal_url_exposed:
            raise ValueError("confirmation payload exposes internal material")


def build_run_confirmation_payload(value: ValidatedKnowledgeCollectInput) -> RunConfirmationPayload:
    if not isinstance(value, ValidatedKnowledgeCollectInput):
        raise TypeError("value must be ValidatedKnowledgeCollectInput")
    return RunConfirmationPayload(
        "天工 · 知识采集",
        TIANGONG_DISPLAY_NAME,
        "知识采集",
        value.ai_name,
        value.safe_source_summary,
        "知识库 Markdown",
        "调用天工中的 knowledge.collect",
        "中",
    )


@dataclass(frozen=True, slots=True)
class N8nExecutionRequest:
    provider_instance_id: str
    workflow_external_id: str
    method: str
    invocation_path: str
    input_sha256: str
    input_fields: tuple[str, ...]
    confirmation_id: str
    execution_enabled: bool = False
    body_exposed: bool = False

    def __post_init__(self) -> None:
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID or self.workflow_external_id != TIANGONG_WORKFLOW_EXTERNAL_ID:
            raise ValueError("execution request target is invalid")
        if self.method != "POST" or not self.invocation_path.startswith("/form/"):
            raise ValueError("execution request surface is invalid")
        if not _SHA256.fullmatch(self.input_sha256):
            raise ValueError("input_sha256 is invalid")
        _identifier(self.confirmation_id, "confirmation_id")
        if self.execution_enabled or self.body_exposed:
            raise ValueError("execution request must remain disabled and redacted")


@dataclass(frozen=True, slots=True)
class N8nExecutionResponse:
    state: str
    execution_id: str | None
    provider_status: str
    safe_error_code: str | None
    raw_payload_exposed: bool = False

    def __post_init__(self) -> None:
        if self.state not in {"ACCEPTED", "SUCCEEDED", "FAILED", "UNKNOWN"}:
            raise ValueError("execution response state is invalid")
        if self.execution_id is not None:
            _identifier(self.execution_id, "execution_id")
        if self.raw_payload_exposed:
            raise ValueError("execution response cannot expose raw payload")


class N8nExecutionAdapter:
    """Request/response contract only; send is deliberately unavailable in this Goal."""

    execution_enabled = False

    @staticmethod
    def build_request(
        surface: N8nFormInvocationSurface,
        input_value: ValidatedKnowledgeCollectInput,
        *,
        confirmation_id: str,
    ) -> N8nExecutionRequest:
        if surface.invocation_path is None or surface.state != "IMPLEMENTATION_READY":
            raise ValueError("invocation surface is unresolved")
        return N8nExecutionRequest(
            TIANGONG_PROVIDER_INSTANCE_ID,
            TIANGONG_WORKFLOW_EXTERNAL_ID,
            surface.method,
            surface.invocation_path,
            input_value.input_sha256,
            ("ai_name", "source_text", "source_url"),
            confirmation_id,
        )

    @staticmethod
    def parse_response(status_code: int, payload: Mapping[str, Any]) -> N8nExecutionResponse:
        if not isinstance(payload, Mapping):
            raise TypeError("payload must be a mapping")
        execution_id = payload.get("executionId") or payload.get("execution_id")
        if execution_id is not None:
            execution_id = _identifier(str(execution_id), "execution_id")
        source_state = str(payload.get("status", "unknown")).lower()
        state = {
            "accepted": "ACCEPTED", "queued": "ACCEPTED", "running": "ACCEPTED",
            "success": "SUCCEEDED", "succeeded": "SUCCEEDED", "failed": "FAILED", "error": "FAILED",
        }.get(source_state, "UNKNOWN")
        if status_code >= 400:
            state = "FAILED"
        return N8nExecutionResponse(
            state,
            execution_id,
            source_state,
            "provider_request_failed" if state == "FAILED" else None,
        )

    @staticmethod
    def send(_: N8nExecutionRequest) -> None:
        raise PermissionError("execution_enabled=false; explicit future authorization is required")


class ExecutionObservationState(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class ExecutionObservation:
    provider_instance_id: str
    workflow_external_id: str
    execution_id: str
    state: ExecutionObservationState
    observed_at: datetime
    freshness: str
    source: str
    safe_error_summary: str | None = None
    synthetic_authority_claimed: bool = False

    def __post_init__(self) -> None:
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID or self.workflow_external_id != TIANGONG_WORKFLOW_EXTERNAL_ID:
            raise ValueError("observation target is invalid")
        _identifier(self.execution_id, "execution_id")
        if not isinstance(self.state, ExecutionObservationState):
            raise TypeError("state must be ExecutionObservationState")
        _aware(self.observed_at, "observed_at")
        if self.freshness not in {"fresh", "stale"}:
            raise ValueError("freshness is invalid")
        if self.synthetic_authority_claimed:
            raise ValueError("synthetic data cannot claim Runtime authority")


class ExecutionStatusReader:
    def __init__(self, transport: AuthenticatedN8nReadTransport | None = None) -> None:
        self._transport = transport

    def read(self, execution_id: str, auth_request: AuthSessionRequest | None) -> ExecutionObservation:
        execution_id = _identifier(execution_id, "execution_id")
        if auth_request is None or "execution.status.read" not in auth_request.required_scopes:
            return self._unknown(execution_id, "auth_required")
        if self._transport is None:
            return self._unknown(execution_id, "secure_transport_not_configured")
        path = f"/api/v1/executions/{execution_id}"
        url = f"{TIANGONG_ENDPOINT}{path}"
        try:
            response = self._transport.get_json(url, auth_request, 2.0)
            N8nWorkflowMetadataReader._validate_effective_url(response.effective_url, path)
            if response.status_code != 200:
                return self._unknown(execution_id, "execution_read_failed")
            if str(response.payload.get("id")) != execution_id:
                return self._unknown(execution_id, "execution_identity_mismatch")
            if response.payload.get("workflowId") != TIANGONG_WORKFLOW_EXTERNAL_ID:
                return self._unknown(execution_id, "workflow_identity_mismatch")
            source = str(response.payload.get("status", "unknown")).lower()
            state = {
                "new": ExecutionObservationState.QUEUED,
                "queued": ExecutionObservationState.QUEUED,
                "running": ExecutionObservationState.RUNNING,
                "success": ExecutionObservationState.SUCCEEDED,
                "succeeded": ExecutionObservationState.SUCCEEDED,
                "error": ExecutionObservationState.FAILED,
                "failed": ExecutionObservationState.FAILED,
            }.get(source, ExecutionObservationState.UNKNOWN)
            return ExecutionObservation(
                TIANGONG_PROVIDER_INSTANCE_ID,
                TIANGONG_WORKFLOW_EXTERNAL_ID,
                execution_id,
                state,
                datetime.now(timezone.utc),
                "fresh",
                "authenticated_n8n_execution_read",
                "provider_execution_failed" if state is ExecutionObservationState.FAILED else None,
            )
        except (TypeError, ValueError, KeyError):
            return self._unknown(execution_id, "unsafe_or_invalid_execution_response")

    @staticmethod
    def _unknown(execution_id: str, reason: str) -> ExecutionObservation:
        return ExecutionObservation(
            TIANGONG_PROVIDER_INSTANCE_ID,
            TIANGONG_WORKFLOW_EXTERNAL_ID,
            execution_id,
            ExecutionObservationState.UNKNOWN,
            datetime.now(timezone.utc),
            "fresh",
            reason,
        )


class CorrelationState(str, Enum):
    CONFIRMED = "CONFIRMED"
    CORRELATION_NOT_CONFIRMED = "CORRELATION_NOT_CONFIRMED"


@dataclass(frozen=True, slots=True)
class ExecutionArtifactManifest:
    execution_id: str
    workflow_external_id: str
    expected_artifact_relative_path: str
    artifact_type: str
    created_at: datetime | None
    observed_at: datetime
    source: str
    integrity_sha256: str | None
    availability: str
    correlation_state: CorrelationState

    def __post_init__(self) -> None:
        _identifier(self.execution_id, "execution_id")
        if self.workflow_external_id != TIANGONG_WORKFLOW_EXTERNAL_ID:
            raise ValueError("manifest workflow is invalid")
        object.__setattr__(self, "expected_artifact_relative_path", _logical_path(self.expected_artifact_relative_path, "expected_artifact_relative_path"))
        if self.artifact_type != "MARKDOWN":
            raise ValueError("knowledge.collect artifact must be MARKDOWN")
        if self.created_at is not None:
            _aware(self.created_at, "created_at")
        _aware(self.observed_at, "observed_at")
        if self.integrity_sha256 is not None and not _SHA256.fullmatch(self.integrity_sha256):
            raise ValueError("integrity_sha256 is invalid")
        if self.correlation_state is CorrelationState.CONFIRMED and (self.created_at is None or self.integrity_sha256 is None):
            raise ValueError("confirmed correlation requires time and integrity evidence")


def build_execution_artifact_manifest(
    *,
    execution_id: str,
    ai_name: str,
    observed_at: datetime,
    explicit_correlation_evidence: bool = False,
    created_at: datetime | None = None,
    integrity_sha256: str | None = None,
) -> ExecutionArtifactManifest:
    filename = ArtifactFilenamePolicy().validate(ai_name)
    confirmed = bool(explicit_correlation_evidence and created_at is not None and integrity_sha256 is not None)
    return ExecutionArtifactManifest(
        execution_id,
        TIANGONG_WORKFLOW_EXTERNAL_ID,
        f"00_待审核/AI工具/{filename}",
        "MARKDOWN",
        created_at,
        observed_at,
        "explicit_execution_artifact_evidence" if confirmed else "expected_path_only",
        integrity_sha256,
        "AVAILABLE" if confirmed else "UNKNOWN",
        CorrelationState.CONFIRMED if confirmed else CorrelationState.CORRELATION_NOT_CONFIRMED,
    )


@dataclass(frozen=True, slots=True)
class CopyResultPayload:
    action: str
    title: str
    mime_type: str
    content: str
    source_provenance: str
    integrity_sha256: str
    truncation_status: str
    raw_execution_payload_exposed: bool = False

    def __post_init__(self) -> None:
        if self.action != "COPY_MARKDOWN" or self.mime_type != "text/markdown":
            raise ValueError("copy payload must be Markdown")
        if not _SHA256.fullmatch(self.integrity_sha256):
            raise ValueError("integrity_sha256 is invalid")
        if self.truncation_status != "NOT_TRUNCATED" or self.raw_execution_payload_exposed:
            raise ValueError("copy payload is unsafe")


def build_copy_result_payload(artifact: ProductResultArtifact, *, title: str) -> CopyResultPayload:
    if not isinstance(artifact, ProductResultArtifact):
        raise TypeError("artifact must be ProductResultArtifact")
    if artifact.primary_action != "copy_markdown" or not artifact.copy_ready or artifact.copy_payload is None:
        raise ValueError("Markdown artifact content is not authorized and ready")
    content = artifact.copy_payload
    return CopyResultPayload(
        "COPY_MARKDOWN",
        _safe_text(title, "title", 128),
        "text/markdown",
        content,
        artifact.provenance,
        hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "NOT_TRUNCATED",
    )


def build_tiangong_diagnosis_handoff(
    *,
    request_id: str,
    execution_id: str,
    safe_error_summary: str,
    canonical_source_sha256: str,
    safe_evidence_refs: tuple[str, ...],
    expected_behavior: str,
    observed_behavior: str,
) -> dict[str, Any]:
    _identifier(request_id, "request_id")
    _identifier(execution_id, "execution_id")
    if not _SHA256.fullmatch(canonical_source_sha256):
        raise ValueError("canonical_source_sha256 is invalid")
    refs = tuple(_logical_path(item, "safe_evidence_ref") for item in safe_evidence_refs)
    return {
        "state": "QUEQIAO_HANDOFF_READY",
        "request_id": request_id,
        "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
        "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
        "execution_id": execution_id,
        "safe_error_summary": _safe_text(safe_error_summary, "safe_error_summary", 512),
        "canonical_source_sha256": canonical_source_sha256.upper(),
        "safe_evidence_refs": list(refs),
        "expected_behavior": _safe_text(expected_behavior, "expected_behavior", 2000),
        "observed_behavior": _safe_text(observed_behavior, "observed_behavior", 2000),
        "cross_module_dispatch_performed": False,
    }


def evaluate_repair_metadata_binding(metadata_result: WorkflowMetadataReadResult | None) -> dict[str, Any]:
    metadata = metadata_result.metadata if metadata_result and metadata_result.state is MetadataReadState.OBSERVED else None
    return {
        "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
        "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
        "base_revision": metadata.version_id if metadata else None,
        "state": "METADATA_BOUND" if metadata else "BLOCKED_METADATA_REQUIRED",
        "publish_eligible": False,
        "canonical_export_used_as_runtime_revision": False,
    }


@dataclass(frozen=True, slots=True)
class ProductionUpdatePreflight:
    state: str
    blockers: tuple[str, ...]
    checks: Mapping[str, bool]
    production_action_performed: bool = False

    def __post_init__(self) -> None:
        if self.state not in {"PRODUCTION_UPDATE_PREP_READY", "BLOCKED"}:
            raise ValueError("production update preflight state is invalid")
        if self.production_action_performed:
            raise ValueError("production update preflight cannot publish")


def evaluate_production_update_preflight(**checks: bool) -> ProductionUpdatePreflight:
    required = (
        "provider_confirmed", "workflow_membership_confirmed", "current_revision_confirmed",
        "immutable_backup_ready", "candidate_validated", "sandbox_passed", "secret_safe",
        "user_approved", "rollback_source_available", "post_publish_verify_defined",
    )
    if set(checks) != set(required) or not all(isinstance(value, bool) for value in checks.values()):
        raise ValueError("production update checks are incomplete")
    blockers = tuple(name for name in required if not checks[name])
    return ProductionUpdatePreflight(
        "PRODUCTION_UPDATE_PREP_READY" if not blockers else "BLOCKED",
        blockers,
        {name: checks[name] for name in required},
    )


def build_tiangong_readiness_contract() -> dict[str, Any]:
    return {
        "state": TIANGONG_MANUAL_RUN_PREP_STATE,
        "provider": {
            "display_name": TIANGONG_DISPLAY_NAME,
            "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
            "provider_kind": "n8n",
            "confirmation": TIANGONG_CONFIRMATION_PROVENANCE,
            "identity_derived_from_endpoint_or_container": False,
        },
        "capability_id": "knowledge.collect",
        "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
        "auth_boundary": {
            "state": "IMPLEMENTATION_READY",
            "credential_value_visible_to_application": False,
            "credential_value_visible_to_api_or_ai": False,
        },
        "metadata": {"state": "AUTH_REQUIRED", "static_fallback_as_current_metadata": False},
        "form_surface": {"state": "METADATA_REQUIRED", "submission_performed": False},
        "manual_run": {"state": "AUTH_REQUIRED", "execution_enabled": False},
        "execution_observation": {"state": "AUTH_REQUIRED", "historical_inference_allowed": False},
        "result": {
            "correlation": "CORRELATION_NOT_CONFIRMED",
            "copy": "IMPLEMENTATION_READY",
            "external_artifact_read": "EXTERNAL_ARTIFACT_READ_AUTHORIZATION_REQUIRED",
        },
        "diagnosis": "QUEQIAO_HANDOFF_READY",
        "repair": "BLOCKED_METADATA_REQUIRED",
        "publish": "BLOCKED_EXTERNAL",
        "side_effects": {
            "credential_read": False,
            "workflow_execution": False,
            "form_submit": False,
            "production_publish": False,
        },
    }


def _require_tiangong_config(config: AutomationProviderConfig) -> None:
    if not isinstance(config, AutomationProviderConfig):
        raise TypeError("config must be AutomationProviderConfig")
    if (
        not config.confirmed
        or config.provider_kind != "n8n"
        or config.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID
        or config.display_label != TIANGONG_DISPLAY_NAME
        or config.source != TIANGONG_CONFIRMATION_PROVENANCE
    ):
        raise ValueError("formal Tiangong configuration is required")


__all__ = [
    "TIANGONG_CONFIRMATION_PROVENANCE", "TIANGONG_DISPLAY_NAME", "TIANGONG_ENDPOINT",
    "TIANGONG_MANUAL_RUN_PREP_STATE", "TIANGONG_PROVIDER_INSTANCE_ID", "TIANGONG_RUN_PREP_VERSION",
    "TIANGONG_WORKFLOW_EXTERNAL_ID", "AuthSessionRequest", "AuthenticatedN8nReadTransport",
    "CopyResultPayload", "CorrelationState", "CredentialAvailability", "CredentialProvider",
    "CredentialRef", "ExecutionArtifactManifest", "ExecutionObservation", "ExecutionObservationState",
    "ExecutionStatusReader", "KnowledgeCollectInputPolicy", "ManualRunPreflight",
    "ManualRunPreflightState", "MetadataReadState", "N8nCredentialBoundary", "N8nExecutionAdapter",
    "N8nExecutionRequest", "N8nExecutionResponse", "N8nFormInvocationSurface",
    "N8nWorkflowMetadataReader", "PreflightCheck", "ProductionUpdatePreflight",
    "RedactedAuthContext", "RunConfirmationPayload", "SafeTransportResponse", "SourceURLSafety",
    "ValidatedKnowledgeCollectInput", "WorkflowMetadataReadResult", "WorkflowRuntimeMetadata",
    "build_copy_result_payload", "build_execution_artifact_manifest", "build_run_confirmation_payload",
    "build_tiangong_diagnosis_handoff", "build_tiangong_readiness_contract",
    "evaluate_manual_run_preflight", "evaluate_production_update_preflight",
    "evaluate_repair_metadata_binding",
]
