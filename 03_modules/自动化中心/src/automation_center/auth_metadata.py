"""Secure, read-only Authenticated Metadata support for the Tiangong n8n instance.

Secret material is accepted only by an injected runtime provider and is consumed
inside the loopback transport.  It is never retained in a DTO or response.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
from typing import Any, Callable, Mapping, Protocol
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from automation_center.product import AutomationProviderConfig
from automation_center.run_prep import (
    TIANGONG_ENDPOINT,
    TIANGONG_PROVIDER_INSTANCE_ID,
    TIANGONG_WORKFLOW_EXTERNAL_ID,
    AuthSessionRequest,
    CredentialAvailability,
    CredentialRef,
    KnowledgeCollectInputPolicy,
    MetadataReadState,
    N8nExecutionAdapter,
    N8nWorkflowMetadataReader,
    SafeTransportResponse,
    WorkflowMetadataReadResult,
)


TIANGONG_AUTH_METADATA_VERSION = "0.1"
TIANGONG_AUTH_HEADER = "X-N8N-API-KEY"
TIANGONG_CREDENTIAL_REF_ID = "tiangong-n8n-api-key"
CANONICAL_WORKFLOW_VERSION_ID = "802897a6-0644-4927-9bad-3ecc34d8a28b"
CANONICAL_WORKFLOW_SHA256 = "B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514"


class SecretConsumer(Protocol):
    def __call__(self, secret: str) -> SafeTransportResponse: ...


class ExternalCredentialProviderPort(Protocol):
    """Opaque broker port: ordinary callers can never request a Secret value."""

    def availability(self, credential_ref_id: str) -> CredentialAvailability: ...

    def use_secret(self, credential_ref_id: str, consumer: SecretConsumer) -> SafeTransportResponse: ...


class CredentialResolutionError(RuntimeError):
    """A deliberately content-free credential error."""

    def __init__(self) -> None:
        super().__init__("credential could not be resolved safely")


class RuntimeOnlyCredentialProvider:
    """Process-only pilot provider backed by an opaque callback.

    The callback may prompt the user or bridge to an external store.  This object
    never exposes the callback result and its repr contains availability only.
    """

    __slots__ = ("_credential_ref_id", "_loader", "_available")

    def __init__(
        self,
        credential_ref_id: str,
        loader: Callable[[], str],
        *,
        available: bool = True,
    ) -> None:
        if credential_ref_id != TIANGONG_CREDENTIAL_REF_ID or not callable(loader):
            raise ValueError("runtime credential provider configuration is invalid")
        self._credential_ref_id = credential_ref_id
        self._loader = loader
        self._available = bool(available)

    def __repr__(self) -> str:
        return f"RuntimeOnlyCredentialProvider(availability={self.availability(self._credential_ref_id).value!r})"

    __str__ = __repr__

    def availability(self, credential_ref_id: str) -> CredentialAvailability:
        if credential_ref_id != self._credential_ref_id:
            return CredentialAvailability.UNAVAILABLE
        return CredentialAvailability.AVAILABLE if self._available else CredentialAvailability.UNAVAILABLE

    def use_secret(self, credential_ref_id: str, consumer: SecretConsumer) -> SafeTransportResponse:
        if self.availability(credential_ref_id) is not CredentialAvailability.AVAILABLE:
            raise CredentialResolutionError()
        secret: str | None = None
        try:
            secret = self._loader()
            if not isinstance(secret, str) or not secret or any(ord(char) < 32 for char in secret):
                raise CredentialResolutionError()
            return consumer(secret)
        except CredentialResolutionError:
            raise
        except Exception:
            raise CredentialResolutionError() from None
        finally:
            secret = None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


class AuthenticatedLoopbackTransport:
    """GET-only transport locked to Tiangong's workflow metadata endpoint."""

    __slots__ = ("_provider", "_opener_factory", "_max_response_bytes")

    def __init__(
        self,
        provider: ExternalCredentialProviderPort,
        *,
        opener_factory: Callable[..., Any] = urllib.request.build_opener,
        max_response_bytes: int = 1_048_576,
    ) -> None:
        if not hasattr(provider, "use_secret") or not hasattr(provider, "availability"):
            raise TypeError("provider must implement ExternalCredentialProviderPort")
        if not callable(opener_factory) or not 1024 <= max_response_bytes <= 4_194_304:
            raise ValueError("transport configuration is invalid")
        self._provider = provider
        self._opener_factory = opener_factory
        self._max_response_bytes = max_response_bytes

    def __repr__(self) -> str:
        return "AuthenticatedLoopbackTransport(host='127.0.0.1', port=5678, method='GET', secret='[REDACTED]')"

    __str__ = __repr__

    def get_json(
        self,
        url: str,
        auth_request: AuthSessionRequest,
        timeout_seconds: float,
    ) -> SafeTransportResponse:
        self._validate_request(url, auth_request, timeout_seconds)
        return self._provider.use_secret(
            auth_request.credential_ref_id,
            lambda secret: self._authenticated_get(url, secret, timeout_seconds),
        )

    @staticmethod
    def _validate_request(url: str, auth_request: AuthSessionRequest, timeout_seconds: float) -> None:
        if not isinstance(auth_request, AuthSessionRequest):
            raise TypeError("auth_request is invalid")
        expected = f"/api/v1/workflows/{TIANGONG_WORKFLOW_EXTERNAL_ID}"
        parsed = urlsplit(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or parsed.port != 5678
            or parsed.path != expected
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError("transport target is outside the Tiangong metadata allowlist")
        if auth_request.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID:
            raise ValueError("auth request is not bound to Tiangong")
        if "workflow.metadata.read" not in auth_request.required_scopes:
            raise ValueError("workflow metadata read scope is required")
        if not isinstance(timeout_seconds, (int, float)) or not 0.1 <= timeout_seconds <= 10.0:
            raise ValueError("timeout is outside the safe range")

    def _authenticated_get(self, url: str, secret: str, timeout_seconds: float) -> SafeTransportResponse:
        request = urllib.request.Request(
            url,
            method="GET",
            headers={"Accept": "application/json", TIANGONG_AUTH_HEADER: secret},
        )
        opener = self._opener_factory(_NoRedirect())
        try:
            with opener.open(request, timeout=timeout_seconds) as response:
                effective_url = response.geturl()
                raw = response.read(self._max_response_bytes + 1)
                if len(raw) > self._max_response_bytes:
                    raise ValueError("metadata response exceeds safe size")
                payload = json.loads(raw.decode("utf-8"))
                if not isinstance(payload, Mapping) or _contains_secret(payload, secret):
                    raise ValueError("metadata response is unsafe")
                return SafeTransportResponse(response.status, effective_url, payload)
        except urllib.error.HTTPError as error:
            # Error bodies are intentionally discarded; they may echo request data.
            return SafeTransportResponse(error.code, error.geturl(), {})
        except (CredentialResolutionError, TypeError, ValueError):
            raise
        except Exception:
            raise RuntimeError("authenticated metadata request failed safely") from None


def _contains_secret(value: Any, secret: str) -> bool:
    if isinstance(value, str):
        return secret in value
    if isinstance(value, Mapping):
        return any(_contains_secret(key, secret) or _contains_secret(child, secret) for key, child in value.items())
    if isinstance(value, (list, tuple)):
        return any(_contains_secret(child, secret) for child in value)
    return False


def build_tiangong_credential_ref(
    provider: ExternalCredentialProviderPort | None = None,
) -> CredentialRef:
    availability = (
        provider.availability(TIANGONG_CREDENTIAL_REF_ID)
        if provider is not None
        else CredentialAvailability.UNAVAILABLE
    )
    return CredentialRef(
        TIANGONG_CREDENTIAL_REF_ID,
        TIANGONG_PROVIDER_INSTANCE_ID,
        "n8n_api_key",
        availability,
        "external_runtime_provider",
    )


@dataclass(frozen=True, slots=True)
class MetadataFreshnessProjection:
    state: str
    observed_at: datetime
    age_seconds: int
    source: str = "AUTHENTICATED_N8N_METADATA"


def project_metadata_freshness(
    result: WorkflowMetadataReadResult,
    *,
    now: datetime | None = None,
    fresh_for: timedelta = timedelta(minutes=5),
) -> MetadataFreshnessProjection:
    if result.state is not MetadataReadState.OBSERVED or result.metadata is None:
        raise ValueError("authenticated metadata observation is required")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    age = max(0, int((current - result.metadata.observed_at).total_seconds()))
    return MetadataFreshnessProjection("FRESH" if age <= fresh_for.total_seconds() else "STALE", result.metadata.observed_at, age)


@dataclass(frozen=True, slots=True)
class WorkflowRevisionReconciliation:
    state: str
    production_revision: str
    canonical_revision: str
    production_updated_at: datetime
    canonical_sha256: str
    newer_side: str
    production_write_performed: bool = False


def reconcile_workflow_revision(result: WorkflowMetadataReadResult) -> WorkflowRevisionReconciliation:
    if result.state is not MetadataReadState.OBSERVED or result.metadata is None:
        raise ValueError("authenticated metadata observation is required")
    production = result.metadata
    return WorkflowRevisionReconciliation(
        "IN_SYNC" if production.version_id == CANONICAL_WORKFLOW_VERSION_ID else "REVISION_DIVERGENCE",
        production.version_id,
        CANONICAL_WORKFLOW_VERSION_ID,
        production.updated_at,
        CANONICAL_WORKFLOW_SHA256,
        "UNKNOWN_WITHOUT_CANONICAL_TIMESTAMP",
    )


def project_knowledge_collect_binding(result: WorkflowMetadataReadResult | None) -> Mapping[str, Any]:
    metadata = result.metadata if result and result.state is MetadataReadState.OBSERVED else None
    surface = next((item for item in metadata.trigger_surfaces if item.invocation_path), None) if metadata else None
    return {
        "binding_id": "knowledge-collect-v141",
        "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
        "progress_state": "INVOCATION_SURFACE_CONFIRMED" if surface else "TARGET_CONFIRMED",
        "workflow_membership": "CONFIRMED" if metadata else "AUTH_REQUIRED",
        "execution_enabled": False,
    }


@dataclass(frozen=True, slots=True, repr=False)
class KnowledgeCollectPilotRequest:
    ai_name: str
    source_text: str
    source_url: None
    input_sha256: str
    external_network_dependency: bool = False
    execution_enabled: bool = False

    def __repr__(self) -> str:
        return (
            "KnowledgeCollectPilotRequest("
            f"ai_name={self.ai_name!r}, source_text_length={len(self.source_text)}, "
            f"input_sha256={self.input_sha256!r}, execution_enabled=False)"
        )


def build_first_pilot_request() -> KnowledgeCollectPilotRequest:
    value = KnowledgeCollectInputPolicy().validate({
        "ai_name": "NEXA天工首次运行测试",
        "source_text": "这是用于验证 NEXA 到天工再到 Markdown 结果链路的非敏感最小测试资料。",
        "source_url": None,
    })
    return KnowledgeCollectPilotRequest(value.ai_name, value.source_text or "", None, value.input_sha256)


def build_first_pilot_approval_payload(result: WorkflowMetadataReadResult) -> Mapping[str, Any]:
    if result.state is not MetadataReadState.OBSERVED or result.metadata is None:
        raise ValueError("authenticated metadata observation is required")
    request = build_first_pilot_request()
    metadata = result.metadata
    return {
        "title": "天工 · 知识采集首次运行",
        "provider": "天工",
        "workflow": "knowledge.collect",
        "production_revision": metadata.version_id,
        "provider_health_required": "HEALTHY_AT_CONFIRMATION_TIME",
        "input_summary": {"ai_name": request.ai_name, "source_text_length": len(request.source_text), "source_url": None},
        "output_location": "00_待审核/AI工具/NEXA天工首次运行测试.md",
        "model_call": True,
        "external_network_access": False,
        "possible_cost": "MODEL_PROVIDER_DEPENDENT",
        "overwrite_existing": False,
        "input_safety": "PASS",
        "actions": ["CONFIRM_RUN", "CANCEL"],
        "execution_performed": False,
    }


def build_artifact_collision_preflight() -> Mapping[str, Any]:
    return {
        "state": "EXTERNAL_ARTIFACT_CHECK_REQUIRED",
        "relative_path": "00_待审核/AI工具/NEXA天工首次运行测试.md",
        "allowed_observation": ["exists", "size", "sha256"],
        "content_read_authorized": False,
        "overwrite_allowed": False,
        "check_performed": False,
    }


def build_execution_adapter_preparation(result: WorkflowMetadataReadResult | None) -> Mapping[str, Any]:
    metadata = result.metadata if result and result.state is MetadataReadState.OBSERVED else None
    surface = next((item for item in metadata.trigger_surfaces if item.invocation_path), None) if metadata else None
    return {
        "state": "READY_DISABLED" if surface else "BLOCKED_METADATA_REQUIRED",
        "provider_confirmed": True,
        "target_confirmed": bool(metadata),
        "invocation_surface_confirmed": bool(surface),
        "input_validation": "IMPLEMENTED",
        "request_correlation_id": "REQUIRED",
        "execution_id_parser": "IMPLEMENTED",
        "safe_response_handling": "IMPLEMENTED",
        "timeout_policy": "SINGLE_ATTEMPT_BOUNDED",
        "retry_policy": "NO_AUTOMATIC_RETRY",
        "duplicate_submission_guard": "CONFIRMATION_AND_CORRELATION_ID_REQUIRED",
        "result_correlation_hook": "IMPLEMENTED",
        "execution_enabled": N8nExecutionAdapter.execution_enabled,
    }


def build_first_pilot_failure_diagnosis(
    result: WorkflowMetadataReadResult,
    *,
    execution_id: str,
    safe_error_summary: str,
) -> Mapping[str, Any]:
    if result.state is not MetadataReadState.OBSERVED or result.metadata is None:
        raise ValueError("authenticated metadata observation is required")
    if not isinstance(execution_id, str) or not execution_id or len(execution_id) > 128:
        raise ValueError("execution_id is invalid")
    if not isinstance(safe_error_summary, str) or not safe_error_summary.strip() or len(safe_error_summary) > 512:
        raise ValueError("safe_error_summary is invalid")
    request = build_first_pilot_request()
    return {
        "state": "QUEQIAO_HANDOFF_READY",
        "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
        "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
        "execution_id": execution_id,
        "production_revision": result.metadata.version_id,
        "input_schema_summary": ["ai_name", "source_text", "source_url"],
        "source_sha256": request.input_sha256,
        "safe_error_summary": safe_error_summary.strip(),
        "raw_input_exposed": False,
        "raw_execution_payload_exposed": False,
        "cross_module_dispatch_performed": False,
    }


def build_auth_metadata_product_status(
    result: WorkflowMetadataReadResult | None = None,
    *,
    credential_ref: CredentialRef | None = None,
) -> Mapping[str, Any]:
    metadata = result.metadata if result and result.state is MetadataReadState.OBSERVED else None
    surface = next((item for item in metadata.trigger_surfaces if item.invocation_path), None) if metadata else None
    auth_available = bool(credential_ref and credential_ref.availability is CredentialAvailability.AVAILABLE)
    return {
        "version": TIANGONG_AUTH_METADATA_VERSION,
        "state": "TIANGONG_AUTHENTICATED_METADATA_READY" if metadata else "CREDENTIAL_USER_ACTION_REQUIRED",
        "auth": {
            "mechanism": "N8N_PUBLIC_API_KEY",
            "header": TIANGONG_AUTH_HEADER,
            "credential_source": "EXTERNAL_RUNTIME_PROVIDER",
            "availability": "AVAILABLE" if auth_available else "UNAVAILABLE",
            "metadata_auth": "CONFIRMED" if metadata else "AUTH_REQUIRED",
            "execution_auth": "AVAILABLE_FOR_CURRENT_PROCESS" if auth_available else "REQUIRED_AT_EXECUTION_TIME",
            "credential_persisted": False,
            "secret_exposed": False,
        },
        "provider": {"provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID, "display_name": "天工"},
        "workflow": {
            "external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
            "membership": "CONFIRMED" if metadata else "AUTH_REQUIRED",
            "active": metadata.active if metadata else None,
            "production_revision": metadata.version_id if metadata else None,
            "observed_at": metadata.observed_at.isoformat() if metadata else None,
        },
        "form_surface": "CONFIRMED" if surface else ("FORM_SURFACE_REQUIRES_SEPARATE_READ" if metadata else "AUTH_REQUIRED"),
        "binding": project_knowledge_collect_binding(result),
        "run_readiness": (
            "AUTH_REQUIRED" if metadata is None else
            "INVOCATION_SURFACE_REQUIRED" if surface is None else
            "EXECUTION_READINESS_BLOCKED_ACTIVE_STATE" if not metadata.active else
            "EXECUTION_AUTH_REQUIRED_AT_RUN_TIME" if not auth_available else
            "READY_FOR_USER_APPROVAL"
        ),
        "collision": build_artifact_collision_preflight(),
        "execution_adapter": build_execution_adapter_preparation(result),
        "side_effects": {"metadata_get": bool(metadata), "workflow_execution": False, "form_submit": False, "production_write": False},
    }


def read_authenticated_tiangong_metadata(
    provider: ExternalCredentialProviderPort,
    *,
    request_id: str = "tiangong-metadata-smoke",
) -> WorkflowMetadataReadResult:
    ref = build_tiangong_credential_ref(provider)
    if ref.availability is not CredentialAvailability.AVAILABLE:
        return N8nWorkflowMetadataReader().read(AutomationProviderConfig.tiangong(), None)
    request = AuthSessionRequest(
        request_id,
        TIANGONG_PROVIDER_INSTANCE_ID,
        ref.ref_id,
        ("workflow.metadata.read",),
    )
    return N8nWorkflowMetadataReader(AuthenticatedLoopbackTransport(provider)).read(
        AutomationProviderConfig.tiangong(), request
    )


__all__ = [
    "CANONICAL_WORKFLOW_SHA256", "CANONICAL_WORKFLOW_VERSION_ID", "TIANGONG_AUTH_HEADER",
    "TIANGONG_AUTH_METADATA_VERSION", "TIANGONG_CREDENTIAL_REF_ID", "AuthenticatedLoopbackTransport",
    "CredentialResolutionError", "ExternalCredentialProviderPort", "KnowledgeCollectPilotRequest",
    "MetadataFreshnessProjection", "RuntimeOnlyCredentialProvider", "WorkflowRevisionReconciliation",
    "build_artifact_collision_preflight", "build_auth_metadata_product_status", "build_execution_adapter_preparation",
    "build_first_pilot_approval_payload", "build_first_pilot_failure_diagnosis", "build_first_pilot_request", "build_tiangong_credential_ref",
    "project_knowledge_collect_binding", "project_metadata_freshness", "read_authenticated_tiangong_metadata",
    "reconcile_workflow_revision",
]
