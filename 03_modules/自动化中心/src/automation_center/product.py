"""Product-backend V0.2 projections; no workflow execution or production mutation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
import json
from pathlib import Path
import re
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from automation_center.application.control import AutomationCapability, AutomationRunRequest
from automation_center.application.instance_confirmation import ArtifactFilenamePolicy


PRODUCT_BACKEND_VERSION = "0.2"
FORMAL_PROVIDER_INSTANCE_ID = "n8n-tiangong-primary"
FORMAL_PROVIDER_DISPLAY_NAME = "天工"
FORMAL_PROVIDER_CONFIRMATION_SOURCE = "USER_CONFIRMED"
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class ProviderHealthState(str, Enum):
    HEALTHY = "HEALTHY"
    UNREACHABLE = "UNREACHABLE"
    UNKNOWN = "UNKNOWN"
    STALE = "STALE"


@dataclass(frozen=True, slots=True)
class AutomationProviderConfig:
    provider_kind: str = "n8n"
    provider_instance_id: str | None = None
    display_label: str = "本机 n8n / 待确认实例名称"
    endpoint_id: str = "n8n-local-loopback-5678"
    endpoint: str = "http://127.0.0.1:5678/healthz"
    source: str = "local_explicit_configuration"
    confirmed: bool = False
    last_health_observation: ProviderHealthObservation | None = None
    capability_bindings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.provider_kind != "n8n":
            raise ValueError("V0.2 local product supports only n8n")
        if self.endpoint != "http://127.0.0.1:5678/healthz":
            raise ValueError("only the approved loopback health endpoint is allowed")
        if not _IDENTIFIER.fullmatch(self.endpoint_id):
            raise ValueError("endpoint_id is invalid")
        if not isinstance(self.display_label, str) or not self.display_label.strip():
            raise ValueError("display_label is required")
        if self.provider_instance_id is not None and not _IDENTIFIER.fullmatch(self.provider_instance_id):
            raise ValueError("provider_instance_id is invalid")
        if self.confirmed != (self.provider_instance_id is not None):
            raise ValueError("confirmed identity requires an explicit provider_instance_id")
        if self.last_health_observation is not None and not isinstance(self.last_health_observation, ProviderHealthObservation):
            raise TypeError("last_health_observation must be ProviderHealthObservation")
        bindings = tuple(self.capability_bindings)
        if any(not isinstance(item, str) or not _IDENTIFIER.fullmatch(item) for item in bindings):
            raise ValueError("capability_bindings are invalid")
        object.__setattr__(self, "capability_bindings", bindings)

    @classmethod
    def candidate(cls, label: str = "本机 n8n / 待确认实例名称") -> AutomationProviderConfig:
        return cls(display_label=label)

    @classmethod
    def confirmed_instance(cls, provider_instance_id: str, label: str = "本机 n8n") -> AutomationProviderConfig:
        return cls(provider_instance_id=provider_instance_id, display_label=label, confirmed=True)

    @classmethod
    def tiangong(
        cls,
        *,
        last_health_observation: ProviderHealthObservation | None = None,
    ) -> AutomationProviderConfig:
        return cls(
            provider_instance_id=FORMAL_PROVIDER_INSTANCE_ID,
            display_label=FORMAL_PROVIDER_DISPLAY_NAME,
            source=FORMAL_PROVIDER_CONFIRMATION_SOURCE,
            confirmed=True,
            last_health_observation=last_health_observation,
            capability_bindings=("knowledge.collect",),
        )


@dataclass(frozen=True, slots=True)
class ProviderHealthObservation:
    state: ProviderHealthState
    observed_at: datetime
    endpoint_id: str
    source: str
    freshness: str
    http_status: int | None = None
    diagnostic_code: str | None = None

    def __post_init__(self) -> None:
        if self.observed_at.tzinfo is None or self.observed_at.utcoffset() is None:
            raise ValueError("observed_at must be timezone-aware")
        if self.freshness not in {"fresh", "stale", "not_observed"}:
            raise ValueError("freshness is invalid")


class N8nProviderHealthReader:
    """Read only the approved loopback /healthz surface."""

    def __init__(self, transport: Callable[[str, float], tuple[int, bytes]] | None = None) -> None:
        self._transport = transport or self._default_transport

    def observe(self, config: AutomationProviderConfig, *, timeout_seconds: float = 2.0) -> ProviderHealthObservation:
        if not isinstance(config, AutomationProviderConfig):
            raise TypeError("config must be AutomationProviderConfig")
        now = datetime.now(timezone.utc)
        try:
            status, body = self._transport(config.endpoint, timeout_seconds)
            healthy = status == 200 and json.loads(body.decode("utf-8")) == {"status": "ok"}
            return ProviderHealthObservation(
                ProviderHealthState.HEALTHY if healthy else ProviderHealthState.UNKNOWN,
                now, config.endpoint_id, "loopback_healthz", "fresh", status,
                None if healthy else "unexpected_health_response",
            )
        except Exception:
            return ProviderHealthObservation(
                ProviderHealthState.UNREACHABLE, now, config.endpoint_id,
                "loopback_healthz", "fresh", None, "loopback_health_unreachable",
            )

    @staticmethod
    def _default_transport(endpoint: str, timeout: float) -> tuple[int, bytes]:
        parsed = urlsplit(endpoint)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port != 5678 or parsed.path != "/healthz":
            raise ValueError("health reader refused a non-approved endpoint")
        with urlopen(Request(endpoint, method="GET"), timeout=timeout) as response:
            return response.status, response.read(256)

    @staticmethod
    def mark_stale(observation: ProviderHealthObservation) -> ProviderHealthObservation:
        return ProviderHealthObservation(
            ProviderHealthState.STALE, observation.observed_at, observation.endpoint_id,
            observation.source, "stale", observation.http_status, "health_observation_stale",
        )


class ProductArtifactKind(str, Enum):
    TEXT = "text"
    MARKDOWN = "markdown"
    JSON = "json"
    FILE = "file"
    URL = "url"


@dataclass(frozen=True, slots=True)
class ArtifactReadPlan:
    artifact_id: str
    root_id: str
    relative_path: str
    media_type: str
    maximum_bytes: int
    encoding: str
    read_only: bool
    implementation_ready: bool
    external_authorization_required: bool


@dataclass(frozen=True, slots=True)
class ProductResultArtifact:
    artifact_id: str
    kind: ProductArtifactKind
    media_type: str
    provenance: str
    content_availability: str
    safe_locator: str | None
    actions: tuple[str, ...]
    primary_action: str
    copy_ready: bool
    open_ready: bool
    copy_payload: str | None = None


def build_product_artifact(
    *,
    artifact_id: str,
    kind: ProductArtifactKind,
    safe_value: str,
    provenance: str,
) -> ProductResultArtifact:
    if not _IDENTIFIER.fullmatch(artifact_id):
        raise ValueError("artifact_id is invalid")
    if not isinstance(kind, ProductArtifactKind):
        raise TypeError("kind must be ProductArtifactKind")
    if not isinstance(safe_value, str) or not safe_value.strip() or len(safe_value) > 1_048_576:
        raise ValueError("safe_value is invalid")
    if not isinstance(provenance, str) or not provenance.strip() or len(provenance) > 128:
        raise ValueError("provenance is invalid")
    value = safe_value.replace("\r\n", "\n").replace("\r", "\n")
    if any(ord(char) < 32 and char not in "\n\t" for char in value):
        raise ValueError("safe_value contains unsafe controls")
    mapping = {
        ProductArtifactKind.TEXT: ("text/plain", ("copy_text",), "copy_text", True, False),
        ProductArtifactKind.MARKDOWN: ("text/markdown", ("copy_markdown", "copy_text"), "copy_markdown", True, False),
        ProductArtifactKind.JSON: ("application/json", ("copy_json", "copy_text"), "copy_json", True, False),
        ProductArtifactKind.FILE: ("application/octet-stream", ("open_file", "copy_file_path"), "open_file", False, True),
        ProductArtifactKind.URL: ("text/uri-list", ("open_url", "copy_url"), "open_url", True, True),
    }
    media_type, actions, primary, copy_ready, open_ready = mapping[kind]
    locator = None
    payload = value if copy_ready else None
    if kind is ProductArtifactKind.JSON:
        try:
            payload = json.dumps(json.loads(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ValueError("JSON artifact is invalid") from exc
    elif kind is ProductArtifactKind.FILE:
        normalized = value.replace("\\", "/")
        if re.match(r"^(?:[A-Za-z]:|/)", normalized) or ".." in normalized.split("/"):
            raise ValueError("FILE artifact requires a safe logical locator")
        locator = normalized
    elif kind is ProductArtifactKind.URL:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("URL artifact is invalid")
        locator = value
    return ProductResultArtifact(
        artifact_id, kind, media_type, provenance.strip(), "content_available",
        locator, actions, primary, copy_ready, open_ready, payload,
    )


class MarkdownArtifactResolver:
    MAXIMUM_BYTES = 1_048_576

    def plan(self, ai_name: str) -> ArtifactReadPlan:
        filename = ArtifactFilenamePolicy().validate(ai_name)
        return ArtifactReadPlan(
            artifact_id=f"knowledge-markdown-{filename[:-3]}",
            root_id="knowledge-mount-root", relative_path=f"00_待审核/AI工具/{filename}",
            media_type="text/markdown", maximum_bytes=self.MAXIMUM_BYTES,
            encoding="utf-8", read_only=True, implementation_ready=True,
            external_authorization_required=True,
        )

    def read_fixture(self, plan: ArtifactReadPlan, *, allowed_root: Path) -> ProductResultArtifact:
        root = allowed_root.resolve()
        target = (root / Path(plan.relative_path)).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ValueError("artifact escaped the allowed root") from exc
        if target.suffix.lower() != ".md" or not target.is_file():
            raise ValueError("artifact must be an existing Markdown file")
        data = target.read_bytes()
        if len(data) > plan.maximum_bytes:
            raise ValueError("artifact exceeds size limit")
        text = data.decode(plan.encoding).replace("\r\n", "\n").replace("\r", "\n")
        if any(ord(char) < 32 and char not in "\n\r\t" for char in text):
            raise ValueError("artifact contains unsafe control characters")
        return ProductResultArtifact(
            plan.artifact_id, ProductArtifactKind.MARKDOWN, plan.media_type,
            "authorized_synthetic_fixture", "content_available", plan.relative_path,
            ("copy_markdown", "copy_text", "open_file", "copy_file_path"),
            "copy_markdown", True, True, text,
        )


def project_ai_capability(capability: AutomationCapability, *, config: AutomationProviderConfig) -> dict[str, Any]:
    return {
        "capability_id": capability.capability_id,
        "name": capability.display_name,
        "description": capability.description_for_ai,
        "input_schema": [
            {"name": field.name, "kind": field.field_kind.value, "required": field.required, "max_length": field.max_length}
            for field in capability.input_schema.fields
        ],
        "output_schema": {
            "result_type": capability.output_schema.result_type,
            "media_type": capability.output_schema.media_type,
            "primary_action": capability.output_schema.primary_action.value,
        },
        "risk": capability.risk_level.value,
        "confirmation_policy": capability.confirmation_policy.value,
        "availability": "configuration_required",
        "readiness": "not_ready",
        "why_unavailable": [
            *([] if config.confirmed else ["provider_unconfirmed"]),
            "auth_required", "execution_surface_unconfirmed",
        ],
        "execution_engine": "n8n",
    }


def project_run_lifecycle(request: AutomationRunRequest) -> dict[str, Any]:
    state = {
        "prepared": "prepared", "awaiting_confirmation": "waiting_confirmation",
        "ready_for_provider": "ready_to_dispatch", "blocked": "dispatch_blocked",
    }[request.state.value]
    return {
        "request_id": request.request_id, "state": state,
        "blockers": list(request.blockers), "dispatched": False,
        "allowed_states": [
            "prepared", "validated", "waiting_confirmation", "ready_to_dispatch",
            "dispatch_blocked", "dispatched", "running", "succeeded", "partial",
            "failed", "cancelled", "unknown",
        ],
    }


def transition_run_lifecycle(current_state: str, target_state: str) -> dict[str, Any]:
    allowed = {
        "prepared": {"validated", "dispatch_blocked", "cancelled"},
        "validated": {"waiting_confirmation", "ready_to_dispatch", "dispatch_blocked", "cancelled"},
        "waiting_confirmation": {"ready_to_dispatch", "dispatch_blocked", "cancelled"},
        "ready_to_dispatch": {"dispatch_blocked", "cancelled"},
        "dispatch_blocked": {"prepared", "cancelled"},
        "dispatched": {"running", "failed", "unknown"},
        "running": {"succeeded", "partial", "failed", "cancelled", "unknown"},
        "succeeded": set(), "partial": set(), "failed": set(), "cancelled": set(), "unknown": set(),
    }
    if current_state not in allowed or target_state not in allowed:
        raise ValueError("run lifecycle state is invalid")
    if target_state in {"dispatched", "running"}:
        raise ValueError("local product backend cannot claim provider dispatch or Runtime state")
    if target_state not in allowed[current_state]:
        raise ValueError("run lifecycle transition is not allowed")
    return {"from": current_state, "to": target_state, "execution_side_effect": False}


def prepare_queqiao_handoff(
    *,
    handoff_id: str,
    workflow_source_ref: str,
    source_sha256: str,
    request_kind: str,
    request_summary: str,
    safe_evidence: list[str],
) -> dict[str, Any]:
    if not _IDENTIFIER.fullmatch(handoff_id):
        raise ValueError("handoff_id is invalid")
    if request_kind not in {"diagnosis", "repair", "workflow_build"}:
        raise ValueError("request_kind is invalid")
    if not re.fullmatch(r"[0-9A-Fa-f]{64}", source_sha256):
        raise ValueError("source_sha256 is invalid")
    if not isinstance(workflow_source_ref, str) or not workflow_source_ref or ".." in workflow_source_ref.replace("\\", "/").split("/"):
        raise ValueError("workflow_source_ref is invalid")
    if re.match(r"^(?:[A-Za-z]:[\\/]|[/\\])", workflow_source_ref):
        raise ValueError("workflow_source_ref must be logical")
    if not isinstance(request_summary, str) or not request_summary.strip() or len(request_summary) > 2000:
        raise ValueError("request_summary is invalid")
    evidence = tuple(safe_evidence)
    if len(evidence) > 32 or any(not isinstance(item, str) or not item.strip() or len(item) > 512 for item in evidence):
        raise ValueError("safe_evidence is invalid")
    encoded = json.dumps([request_summary, *evidence], ensure_ascii=False).lower()
    if any(token in encoded for token in ("password", "credential", "bearer ", "api_key", "cookie")):
        raise ValueError("handoff contains unsafe evidence")
    return {
        "handoff_id": handoff_id, "state": "QUEQIAO_HANDOFF_READY",
        "request_kind": request_kind, "workflow_source_ref": workflow_source_ref,
        "source_sha256": source_sha256.upper(), "request_summary": request_summary.strip(),
        "safe_evidence": list(evidence), "cross_module_dispatch_performed": False,
    }


def knowledge_collect_readiness(config: AutomationProviderConfig, health: ProviderHealthObservation | None) -> dict[str, Any]:
    provider = "READY" if config.confirmed else "CONFIG_REQUIRED"
    health_state = health.state.value if health else "UNKNOWN"
    return {
        "capability_id": "knowledge.collect",
        "read": {"state": "READY", "blockers": []},
        "provider_health": {"state": "READY" if health_state == "HEALTHY" else "NOT_READY", "observed": health_state},
        "run": {"state": "AUTH_REQUIRED" if config.confirmed else provider, "blockers": ["auth_required", "execution_surface_unconfirmed"]},
        "result_copy": {"state": "IMPLEMENTATION_READY", "blockers": ["execution_artifact_association_required", "external_artifact_read_authorization"]},
        "diagnose": {"state": "READY", "blockers": []},
        "repair": {"state": "IMPLEMENTATION_READY", "blockers": ["cross_module_handoff_required"]},
        "build": {"state": "IMPLEMENTATION_READY", "blockers": ["cross_module_handoff_required"]},
        "publish": {"state": "BLOCKED_EXTERNAL", "blockers": ["user_approval_required", "auth_required", "production_write_required"]},
    }


def build_ui_reference_payload() -> dict[str, Any]:
    """Synthetic UI contract data; never presented as real Runtime evidence."""

    return {
        "classification": "synthetic_ui_reference",
        "overview": {
            "provider_health": "UNKNOWN", "workflow_total": 3,
            "workflow_running": 0, "workflow_runtime_unknown": 3,
            "needs_attention": 2, "historical_success": 1, "historical_failure": 1,
        },
        "workflow_list": [
            {"id": "knowledge.collect", "name": "AI 知识库采集", "status": "NEEDS_CONFIGURATION", "synthetic": False},
            {"id": "fixture.success", "name": "Synthetic Success", "status": "OK", "synthetic": True},
            {"id": "fixture.failed", "name": "Synthetic Failed", "status": "FAILURE_OBSERVED", "synthetic": True},
        ],
        "workflow_detail": {
            "capability_id": "knowledge.collect", "workflow_runtime": "NOT_OBSERVED",
            "inputs": ["ai_name", "source_text", "source_url"],
            "result_type": "knowledge_markdown_document",
            "sandbox": {"state": "PASS", "production": False},
            "actions": {"run": "AUTH_REQUIRED", "copy_result": "IMPLEMENTATION_READY", "ai_diagnosis": "READY", "repair": "IMPLEMENTATION_READY"},
        },
        "result_detail": {
            "artifact_kind": "MARKDOWN", "media_type": "text/markdown",
            "content": "# Synthetic Knowledge Result\n\nUI reference only.",
            "primary_action": "COPY_MARKDOWN", "copy_ready": True,
            "provenance": "synthetic_ui_reference",
        },
        "failure_detail": {
            "safe_error_summary": "Synthetic provider request failed.",
            "workflow_runtime": "NOT_OBSERVED", "historical_failure_only": True,
            "actions": {"retry": "READY", "ai_diagnosis": "READY"},
        },
    }


def candidate_pipeline_contracts() -> dict[str, Any]:
    """Stable, execution-free pipeline contracts for AI/UI handoff."""

    common = {
        "validation_chain": ["static_validation", "sandbox_validation", "safety_report"],
        "sandbox_policy": {
            "test_only": True, "production_target": False,
            "credential_allowed": False, "external_network_allowed": False,
            "production_docker_modification_allowed": False,
        },
        "publish_gate": {
            "requires": ["source_identity", "target_provider", "backup", "restore_instructions", "static_pass", "sandbox_pass", "secret_safety", "user_approval"],
            "production_action_performed": False,
        },
    }
    return {
        "diagnosis_repair": {
            "state": "queqiao_handoff_ready",
            "stages": ["failure", "diagnosis", "repair_request", "repair_candidate", "validation", "sandbox_evidence", "ready_to_publish"],
            "handoff_payload": ["workflow_source_ref", "source_sha256", "base_revision", "safe_evidence", "request", "constraints"],
            "candidate_fields": ["changed_artifact", "changed_artifact_sha256", "change_summary", "validation_results", "sandbox_result", "safety_report", "rollback_requirement"],
            **common,
        },
        "workflow_build": {
            "state": "queqiao_handoff_ready",
            "policy": "legacy_reuse_first",
            "stages": ["user_requirement", "build_request", "legacy_reuse_analysis", "candidate", "validation", "sandbox", "publish_gate"],
            "reuse_priorities": ["existing_workflow", "node_patterns", "error_handling", "result_output", "sandbox_pattern"],
            **common,
        },
    }


__all__ = [
    "PRODUCT_BACKEND_VERSION", "FORMAL_PROVIDER_CONFIRMATION_SOURCE", "FORMAL_PROVIDER_DISPLAY_NAME",
    "FORMAL_PROVIDER_INSTANCE_ID", "ArtifactReadPlan", "AutomationProviderConfig",
    "MarkdownArtifactResolver", "N8nProviderHealthReader", "ProductArtifactKind",
    "ProductResultArtifact", "ProviderHealthObservation", "ProviderHealthState",
    "build_product_artifact", "build_ui_reference_payload", "candidate_pipeline_contracts", "knowledge_collect_readiness", "prepare_queqiao_handoff", "project_ai_capability", "project_run_lifecycle", "transition_run_lifecycle",
]
