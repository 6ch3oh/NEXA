"""Sanitized, read-only confirmation contracts for a local n8n instance."""

from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from enum import Enum
import json
import re
from typing import Any, Mapping

from .target_resolution import (
    CapabilityInvocationBinding,
    ProviderTargetResolution,
    ResolutionState,
    build_v141_provider_target_resolution,
)


PROVIDER_INSTANCE_CONFIRMATION_VERSION = "0.2"

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")
_RESERVED_WINDOWS = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def _text(value: str, name: str, maximum: int = 1024) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be non-empty text")
    result = value.strip()
    if len(result) > maximum or any(ord(char) < 32 for char in result):
        raise ValueError(f"{name} is unsafe or too long")
    return result


def _optional_text(value: str | None, name: str, maximum: int = 1024) -> str | None:
    return None if value is None else _text(value, name, maximum)


def _identifier(value: str, name: str) -> str:
    result = _text(value, name, 128)
    if not _IDENTIFIER.fullmatch(result):
        raise ValueError(f"{name} must be a safe identifier")
    return result


def _optional_identifier(value: str | None, name: str) -> str | None:
    return None if value is None else _identifier(value, name)


class ProviderRuntimeState(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    UNKNOWN = "unknown"


class StableIdentityState(str, Enum):
    CONFIRMED = "confirmed"
    CONFIRMATION_REQUIRED = "confirmation_required"
    UNRESOLVED = "unresolved"


class IdentityProvenance(str, Enum):
    DEPLOYMENT_CONFIG_DERIVED = "deployment_config_derived"
    RUNTIME_METADATA_DERIVED = "runtime_metadata_derived"
    USER_CONFIRMATION_REQUIRED = "user_confirmation_required"
    USER_CONFIRMED = "user_confirmed"


class EndpointScope(str, Enum):
    LOCAL_LOOPBACK = "local_loopback"
    LOCAL_ALL_INTERFACES = "local_all_interfaces"
    REMOTE = "remote"


class AuthenticationRequirement(str, Enum):
    NOT_REQUIRED_FOR_HEALTH = "not_required_for_health"
    REQUIRED = "required"
    UNRESOLVED = "unresolved"


class ConfirmationState(str, Enum):
    CONFIRMED = "confirmed"
    AUTH_REQUIRED = "auth_required"
    EXECUTION_SIDE_EFFECT_RISK = "execution_side_effect_risk"
    UNRESOLVED = "unresolved"


class ArtifactReadiness(str, Enum):
    LOCATION_CONFIRMED = "location_confirmed"
    CONTENT_READ_NOT_AUTHORIZED = "content_read_not_authorized"
    UNRESOLVED = "unresolved"


class BindingProgressState(str, Enum):
    NOT_READY = "not_ready"
    TARGET_CONFIRMED = "target_confirmed"
    INVOCATION_SURFACE_CONFIRMED = "invocation_surface_confirmed"


@dataclass(frozen=True, slots=True)
class ProviderRuntimeObservation:
    state: ProviderRuntimeState
    container_name: str
    container_id_diagnostic: str
    image: str
    published_port: int
    health_status_code: int
    health_body: str
    observed_via: tuple[str, ...]
    workflow_run_state: str = "unknown"
    modification_performed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "container_name", _identifier(self.container_name, "container_name"))
        object.__setattr__(self, "container_id_diagnostic", _identifier(self.container_id_diagnostic, "container_id_diagnostic"))
        object.__setattr__(self, "image", _text(self.image, "image", 256))
        if not isinstance(self.published_port, int) or not 1 <= self.published_port <= 65535:
            raise ValueError("published_port is invalid")
        if self.health_status_code != 200 or self.health_body != '{"status":"ok"}':
            raise ValueError("unexpected health observation")
        if self.workflow_run_state != "unknown":
            raise ValueError("provider health cannot infer Workflow run state")
        if self.modification_performed:
            raise ValueError("read-only observation cannot modify Runtime")


@dataclass(frozen=True, slots=True)
class ProviderInstanceCandidate:
    provider_kind: str
    stable_provider_instance_id: str | None
    state: StableIdentityState
    suggested_label: str
    provenance: IdentityProvenance
    runtime_container_name: str
    container_id_is_stable_identity: bool = False
    user_confirmation_required: bool = True

    def __post_init__(self) -> None:
        object.__setattr__(self, "provider_kind", _identifier(self.provider_kind, "provider_kind"))
        object.__setattr__(self, "stable_provider_instance_id", _optional_identifier(self.stable_provider_instance_id, "stable_provider_instance_id"))
        object.__setattr__(self, "suggested_label", _identifier(self.suggested_label, "suggested_label"))
        object.__setattr__(self, "runtime_container_name", _identifier(self.runtime_container_name, "runtime_container_name"))
        if self.container_id_is_stable_identity:
            raise ValueError("container id must never become stable identity")
        if self.state is StableIdentityState.CONFIRMED and self.stable_provider_instance_id is None:
            raise ValueError("confirmed identity requires stable id")
        if self.stable_provider_instance_id is None and not self.user_confirmation_required:
            raise ValueError("unresolved stable identity requires user confirmation")


@dataclass(frozen=True, slots=True)
class ProviderEndpointDescriptor:
    endpoint_id: str
    scheme: str
    host: str
    port: int
    scope: EndpointScope
    source: str
    confidence: ConfirmationState
    authentication: AuthenticationRequirement
    health_path: str
    health_confirmed: bool
    contains_credentials: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "endpoint_id", _identifier(self.endpoint_id, "endpoint_id"))
        if self.scheme not in {"http", "https"}:
            raise ValueError("unsupported endpoint scheme")
        if self.host not in {"127.0.0.1", "localhost"}:
            raise ValueError("V0.1 endpoint must be loopback")
        if not isinstance(self.port, int) or not 1 <= self.port <= 65535:
            raise ValueError("invalid endpoint port")
        object.__setattr__(self, "source", _text(self.source, "source", 256))
        if self.health_path != "/healthz":
            raise ValueError("only documented health path is allowed")
        if not isinstance(self.health_confirmed, bool) or not isinstance(self.contains_credentials, bool):
            raise TypeError("endpoint flags must be bool")
        if self.contains_credentials:
            raise ValueError("endpoint descriptor cannot contain credentials")

    @property
    def base_url(self) -> str:
        return f"{self.scheme}://{self.host}:{self.port}"


@dataclass(frozen=True, slots=True)
class WorkflowRuntimeConfirmation:
    external_workflow_id: str
    membership: ConfirmationState
    current_revision: ConfirmationState
    active_state: ConfirmationState
    updated_at: ConfirmationState
    auth_required_for_further_confirmation: bool
    current_revision_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "external_workflow_id", _identifier(self.external_workflow_id, "external_workflow_id"))
        object.__setattr__(self, "current_revision_id", _optional_identifier(self.current_revision_id, "current_revision_id"))
        if not isinstance(self.auth_required_for_further_confirmation, bool):
            raise TypeError("auth_required_for_further_confirmation must be bool")
        if self.current_revision is not ConfirmationState.CONFIRMED and self.current_revision_id is not None:
            raise ValueError("unconfirmed revision cannot carry revision id")


@dataclass(frozen=True, slots=True)
class FormTriggerConfirmation:
    state: ConfirmationState
    belongs_to_instance: ConfirmationState
    form_url: str | None
    authentication: AuthenticationRequirement
    page_get_performed: bool
    form_submit_performed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "form_url", _optional_text(self.form_url, "form_url", 512))
        if self.form_submit_performed:
            raise ValueError("form submission is forbidden")
        if self.page_get_performed and self.state is not ConfirmationState.CONFIRMED:
            raise ValueError("page GET cannot be claimed without confirmation")


@dataclass(frozen=True, slots=True)
class ResultArtifactLocationBinding:
    binding_id: str
    provider_instance_label: str
    container_root: str
    host_root: str
    relative_path_template: str
    artifact_type: str
    provenance: IdentityProvenance
    readiness: ArtifactReadiness
    content_read_performed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "binding_id", _identifier(self.binding_id, "binding_id"))
        object.__setattr__(self, "provider_instance_label", _identifier(self.provider_instance_label, "provider_instance_label"))
        if self.container_root != "/knowledge":
            raise ValueError("unexpected container root")
        if not _DRIVE.match(self.host_root) or ".." in self.host_root.replace("\\", "/").split("/"):
            raise ValueError("host_root must be a safe absolute Windows path")
        if self.relative_path_template != "00_待审核/AI工具/{ai_name}.md":
            raise ValueError("unexpected artifact template")
        if self.artifact_type != "MARKDOWN":
            raise ValueError("unexpected artifact type")
        if self.content_read_performed:
            raise ValueError("artifact location confirmation cannot read content")


@dataclass(frozen=True, slots=True)
class ArtifactFilenamePolicy:
    policy_id: str = "artifact-filename-v01"
    maximum_stem_length: int = 120

    def __post_init__(self) -> None:
        object.__setattr__(self, "policy_id", _identifier(self.policy_id, "policy_id"))
        if not isinstance(self.maximum_stem_length, int) or self.maximum_stem_length < 1:
            raise ValueError("invalid maximum_stem_length")

    def validate(self, ai_name: str) -> str:
        if not isinstance(ai_name, str) or ai_name != ai_name.strip():
            raise ValueError("filename must not contain leading or trailing whitespace")
        value = _text(ai_name, "ai_name", self.maximum_stem_length)
        if any(ord(char) == 127 for char in value):
            raise ValueError("filename control characters are forbidden")
        if value in {".", ".."} or ".." in value:
            raise ValueError("filename traversal is forbidden")
        if any(char in value for char in "/\\:<>\"|?*") or _DRIVE.match(value):
            raise ValueError("filename separators or reserved characters are forbidden")
        if value.endswith((".", " ")):
            raise ValueError("filename cannot end with dot or space")
        stem = value.split(".", 1)[0].upper()
        if stem in _RESERVED_WINDOWS:
            raise ValueError("reserved Windows filename is forbidden")
        return f"{value}.md"


@dataclass(frozen=True, slots=True)
class ConfirmedCapabilityBinding:
    base_binding: CapabilityInvocationBinding
    progress_state: BindingProgressState
    provider_instance_candidate_label: str
    endpoint_id: str
    artifact_location_binding_id: str
    execution_enabled: bool = False

    def __post_init__(self) -> None:
        for name in ("provider_instance_candidate_label", "endpoint_id", "artifact_location_binding_id"):
            object.__setattr__(self, name, _identifier(getattr(self, name), name))
        if self.execution_enabled:
            raise ValueError("confirmation Goal cannot enable execution")
        if self.progress_state is not BindingProgressState.TARGET_CONFIRMED:
            raise ValueError("membership/form surface are not confirmed; state must remain TARGET_CONFIRMED")


@dataclass(frozen=True, slots=True)
class ProviderInstanceConfirmation:
    version: str
    runtime: ProviderRuntimeObservation
    instance: ProviderInstanceCandidate
    endpoint: ProviderEndpointDescriptor
    workflow: WorkflowRuntimeConfirmation
    form_trigger: FormTriggerConfirmation
    artifact_location: ResultArtifactLocationBinding
    filename_policy: ArtifactFilenamePolicy
    capability_binding: ConfirmedCapabilityBinding
    target_resolution: ProviderTargetResolution
    docker_modification_performed: bool = False
    production_modification_performed: bool = False

    def __post_init__(self) -> None:
        if self.version != PROVIDER_INSTANCE_CONFIRMATION_VERSION:
            raise ValueError("unsupported confirmation version")
        if self.docker_modification_performed or self.production_modification_performed:
            raise ValueError("confirmation must be read-only")
        if self.runtime.workflow_run_state != "unknown":
            raise ValueError("Workflow run state must stay unknown")


class ProviderInstanceConfirmationResolver:
    """Returns the sanitized result of the explicitly authorized observations."""

    def resolve_v141(self) -> ProviderInstanceConfirmation:
        base = build_v141_provider_target_resolution()
        runtime = ProviderRuntimeObservation(
            ProviderRuntimeState.RUNNING, "n8n", "13f658a439b0", "docker.n8n.io/n8nio/n8n",
            5678, 200, '{"status":"ok"}', ("docker_ps", "docker_inspect_whitelist", "local_port_observation", "loopback_health_get"),
        )
        instance = ProviderInstanceCandidate(
            "n8n", "n8n-tiangong-primary", StableIdentityState.CONFIRMED, "n8n-tiangong-primary",
            IdentityProvenance.USER_CONFIRMED, "n8n", user_confirmation_required=False,
        )
        endpoint = ProviderEndpointDescriptor(
            "n8n-local-loopback-5678", "http", "127.0.0.1", 5678,
            EndpointScope.LOCAL_LOOPBACK, "docker_published_port_and_healthz", ConfirmationState.CONFIRMED,
            AuthenticationRequirement.NOT_REQUIRED_FOR_HEALTH, "/healthz", True,
        )
        workflow = WorkflowRuntimeConfirmation(
            "ymYh8t76VP3jGPbr", ConfirmationState.AUTH_REQUIRED, ConfirmationState.AUTH_REQUIRED,
            ConfirmationState.AUTH_REQUIRED, ConfirmationState.AUTH_REQUIRED, True,
        )
        form = FormTriggerConfirmation(
            ConfirmationState.EXECUTION_SIDE_EFFECT_RISK, ConfirmationState.UNRESOLVED, None,
            AuthenticationRequirement.UNRESOLVED, False,
        )
        location = ResultArtifactLocationBinding(
            "knowledge-markdown-local-mount", instance.suggested_label, "/knowledge",
            "E:\\个人数字资产中心\\01_知识库", "00_待审核/AI工具/{ai_name}.md", "MARKDOWN",
            IdentityProvenance.RUNTIME_METADATA_DERIVED, ArtifactReadiness.CONTENT_READ_NOT_AUTHORIZED,
        )
        binding = ConfirmedCapabilityBinding(
            base.invocation_binding, BindingProgressState.TARGET_CONFIRMED, instance.suggested_label,
            endpoint.endpoint_id, location.binding_id,
        )
        return ProviderInstanceConfirmation(
            PROVIDER_INSTANCE_CONFIRMATION_VERSION, runtime, instance, endpoint, workflow, form,
            location, ArtifactFilenamePolicy(), binding, base,
        )


def build_provider_instance_confirmation_resolver() -> ProviderInstanceConfirmationResolver:
    return ProviderInstanceConfirmationResolver()


def _primitive(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {key: _primitive(child) for key, child in asdict(value).items()}
    if isinstance(value, Mapping):
        return {str(key): _primitive(child) for key, child in value.items()}
    if isinstance(value, (tuple, list)):
        return [_primitive(child) for child in value]
    return value


def serialize_provider_instance_confirmation(value: Any) -> str:
    return json.dumps(_primitive(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
