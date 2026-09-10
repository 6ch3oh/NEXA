"""Offline provider-target resolution contracts; never contacts a provider."""

from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from enum import Enum
import json
import re
from typing import Any, Iterable, Mapping


PROVIDER_TARGET_VERSION = "0.1"

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SHA256 = re.compile(r"^[A-Fa-f0-9]{64}$")


def _text(value: str, name: str, *, maximum: int = 1024) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be non-empty text")
    result = value.strip()
    if len(result) > maximum or any(ord(char) < 32 and char not in "\t\n" for char in result):
        raise ValueError(f"{name} is unsafe or too long")
    return result


def _optional_text(value: str | None, name: str, *, maximum: int = 1024) -> str | None:
    return None if value is None else _text(value, name, maximum=maximum)


def _identifier(value: str, name: str) -> str:
    result = _text(value, name, maximum=128)
    if not _IDENTIFIER.fullmatch(result):
        raise ValueError(f"{name} must be a safe identifier")
    return result


def _optional_identifier(value: str | None, name: str) -> str | None:
    return None if value is None else _identifier(value, name)


def _logical_ref(value: str, name: str) -> str:
    result = _text(value, name, maximum=512).replace("\\", "/")
    if result.startswith(("/", "//")) or re.match(r"^[A-Za-z]:/", result):
        raise ValueError(f"{name} must be a project-relative logical reference")
    if ".." in result.split("/"):
        raise ValueError(f"{name} must not traverse directories")
    return result


def _logical_path_template(value: str, name: str) -> str:
    result = _text(value, name, maximum=512).replace("\\", "/")
    if not result.startswith("/") or result.startswith("//") or ".." in result.split("/"):
        raise ValueError(f"{name} must be an absolute provider-logical path without traversal")
    return result


def _hash(value: str, name: str) -> str:
    result = _text(value, name, maximum=64).upper()
    if not _SHA256.fullmatch(result):
        raise ValueError(f"{name} must be a SHA-256")
    return result


def _texts(values: Iterable[str], name: str, *, maximum_items: int = 32) -> tuple[str, ...]:
    result = tuple(_text(value, name) for value in values)
    if len(result) > maximum_items or len(set(result)) != len(result):
        raise ValueError(f"{name} has too many or duplicate values")
    return result


class ResolutionState(str, Enum):
    RESOLVED = "resolved"
    PARTIALLY_RESOLVED = "partially_resolved"
    UNRESOLVED = "unresolved"
    NOT_READY = "not_ready"


class ResolutionConfidence(str, Enum):
    CONFIRMED = "confirmed"
    CONTEXTUAL = "contextual"
    UNRESOLVED = "unresolved"


class SurfaceClassification(str, Enum):
    SUPPORTED_EXISTING = "supported_existing"
    CANDIDATE = "candidate"
    TEST_ONLY = "test_only"
    LEGACY_ONLY = "legacy_only"
    UNRESOLVED = "unresolved"


class RequirementState(str, Enum):
    REQUIRED = "required"
    NOT_REQUIRED = "not_required"
    UNRESOLVED = "unresolved"


class ExecutionSurfaceKind(str, Enum):
    FORM_TRIGGER = "form_trigger"
    WEBHOOK = "webhook"
    CLI_EXECUTE = "cli_execute"
    API = "api"
    MANUAL_UI = "manual_ui"


class PublishMethod(str, Enum):
    CLI_IMPORT = "cli_import"
    UI_IMPORT = "ui_import"
    API_UPDATE = "api_update"
    PREFLIGHT_CONFIRMATION_ONLY = "preflight_confirmation_only"


class ArtifactKind(str, Enum):
    MARKDOWN_FILE = "markdown_file"


class ArtifactActionReadiness(str, Enum):
    READY = "ready"
    NOT_READY = "not_ready"


class BackupRestoreReadiness(str, Enum):
    READY = "ready"
    PARTIAL = "partial"
    NOT_READY = "not_ready"


@dataclass(frozen=True, slots=True)
class ResolutionEvidence:
    evidence_id: str
    logical_ref: str
    summary: str
    sha256: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "evidence_id", _identifier(self.evidence_id, "evidence_id"))
        object.__setattr__(self, "logical_ref", _logical_ref(self.logical_ref, "logical_ref"))
        object.__setattr__(self, "summary", _text(self.summary, "summary"))
        if self.sha256 is not None:
            object.__setattr__(self, "sha256", _hash(self.sha256, "sha256"))


@dataclass(frozen=True, slots=True)
class ProviderInstanceResolution:
    provider_kind: str
    provider_instance_id: str | None
    state: ResolutionState
    confidence: ResolutionConfidence
    observed_container_name: str | None
    observed_version: str | None
    stable_endpoint: str | None
    blockers: tuple[str, ...]
    evidence: tuple[ResolutionEvidence, ...]
    runtime_probe_performed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "provider_kind", _identifier(self.provider_kind, "provider_kind"))
        object.__setattr__(self, "provider_instance_id", _optional_identifier(self.provider_instance_id, "provider_instance_id"))
        object.__setattr__(self, "observed_container_name", _optional_identifier(self.observed_container_name, "observed_container_name"))
        object.__setattr__(self, "observed_version", _optional_text(self.observed_version, "observed_version", maximum=64))
        object.__setattr__(self, "stable_endpoint", _optional_text(self.stable_endpoint, "stable_endpoint", maximum=256))
        object.__setattr__(self, "blockers", _texts(self.blockers, "blockers"))
        if not isinstance(self.runtime_probe_performed, bool):
            raise TypeError("runtime_probe_performed must be bool")
        if self.state is ResolutionState.RESOLVED and self.provider_instance_id is None:
            raise ValueError("resolved provider requires provider_instance_id")
        if self.provider_instance_id is None and self.state is not ResolutionState.UNRESOLVED:
            raise ValueError("missing provider_instance_id must remain unresolved")
        if self.runtime_probe_performed:
            raise ValueError("V0.1 is offline and cannot claim a runtime probe")


@dataclass(frozen=True, slots=True)
class WorkflowTargetResolution:
    capability_id: str
    provider_kind: str
    provider_instance_id: str | None
    external_workflow_id: str
    canonical_source_ref: str
    canonical_source_sha256: str
    canonical_version_id: str
    sandbox_external_workflow_id: str
    sandbox_source_ref: str
    sandbox_source_sha256: str
    sandbox_production_separated: bool
    state: ResolutionState
    confidence: ResolutionConfidence
    blockers: tuple[str, ...]
    evidence: tuple[ResolutionEvidence, ...]

    def __post_init__(self) -> None:
        for field_name in ("capability_id", "provider_kind", "external_workflow_id", "canonical_version_id", "sandbox_external_workflow_id"):
            object.__setattr__(self, field_name, _identifier(getattr(self, field_name), field_name))
        object.__setattr__(self, "provider_instance_id", _optional_identifier(self.provider_instance_id, "provider_instance_id"))
        object.__setattr__(self, "canonical_source_ref", _logical_ref(self.canonical_source_ref, "canonical_source_ref"))
        object.__setattr__(self, "sandbox_source_ref", _logical_ref(self.sandbox_source_ref, "sandbox_source_ref"))
        object.__setattr__(self, "canonical_source_sha256", _hash(self.canonical_source_sha256, "canonical_source_sha256"))
        object.__setattr__(self, "sandbox_source_sha256", _hash(self.sandbox_source_sha256, "sandbox_source_sha256"))
        object.__setattr__(self, "blockers", _texts(self.blockers, "blockers"))
        if not isinstance(self.sandbox_production_separated, bool):
            raise TypeError("sandbox_production_separated must be bool")
        if not self.sandbox_production_separated:
            raise ValueError("sandbox and production targets must remain separated")
        if self.provider_instance_id is None and self.state is ResolutionState.RESOLVED:
            raise ValueError("provider-scoped target cannot resolve without provider instance")
        if self.external_workflow_id == self.sandbox_external_workflow_id:
            raise ValueError("sandbox identity must not equal production candidate identity")


@dataclass(frozen=True, slots=True)
class ExecutionSurface:
    surface_id: str
    kind: ExecutionSurfaceKind
    classification: SurfaceClassification
    target_scope: str
    suitable_for_manual_run: bool
    suitable_for_ai_call: bool
    authentication: RequirementState
    has_side_effects: bool
    execution_id_return: ResolutionState
    final_result_return: ResolutionState
    notes: tuple[str, ...]
    evidence: tuple[ResolutionEvidence, ...]
    invocation_performed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "surface_id", _identifier(self.surface_id, "surface_id"))
        object.__setattr__(self, "target_scope", _text(self.target_scope, "target_scope", maximum=128))
        object.__setattr__(self, "notes", _texts(self.notes, "notes"))
        for name in ("suitable_for_manual_run", "suitable_for_ai_call", "has_side_effects", "invocation_performed"):
            if not isinstance(getattr(self, name), bool):
                raise TypeError(f"{name} must be bool")
        if self.invocation_performed:
            raise ValueError("surface inventory cannot claim invocation")


@dataclass(frozen=True, slots=True)
class WorkflowPublishSurface:
    surface_id: str
    method: PublishMethod
    classification: SurfaceClassification
    target_identity: str
    required_inputs: tuple[str, ...]
    authentication: RequirementState
    overwrite_behavior: ResolutionState
    expected_source_sha256: str | None
    backup_required: bool
    confirmation_required: bool
    publish_implemented: bool
    evidence: tuple[ResolutionEvidence, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "surface_id", _identifier(self.surface_id, "surface_id"))
        object.__setattr__(self, "target_identity", _text(self.target_identity, "target_identity", maximum=128))
        object.__setattr__(self, "required_inputs", _texts(self.required_inputs, "required_inputs"))
        if self.expected_source_sha256 is not None:
            object.__setattr__(self, "expected_source_sha256", _hash(self.expected_source_sha256, "expected_source_sha256"))
        for name in ("backup_required", "confirmation_required", "publish_implemented"):
            if not isinstance(getattr(self, name), bool):
                raise TypeError(f"{name} must be bool")


@dataclass(frozen=True, slots=True)
class WorkflowBackupRestorePlan:
    plan_id: str
    target: WorkflowTargetResolution
    readiness: BackupRestoreReadiness
    existing_assets: tuple[str, ...]
    required_backup_steps: tuple[str, ...]
    required_restore_steps: tuple[str, ...]
    blockers: tuple[str, ...]
    production_backup_performed: bool = False
    production_restore_performed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "plan_id", _identifier(self.plan_id, "plan_id"))
        for name in ("existing_assets", "required_backup_steps", "required_restore_steps", "blockers"):
            object.__setattr__(self, name, _texts(getattr(self, name), name))
        if self.production_backup_performed or self.production_restore_performed:
            raise ValueError("V0.1 plan cannot claim a production backup or restore")


@dataclass(frozen=True, slots=True)
class AutomationResultArtifact:
    artifact_id: str
    capability_id: str
    kind: ArtifactKind
    media_type: str
    producer_nodes: tuple[str, ...]
    provider_logical_path_template: str
    source_result_field: str
    provider_storage_mapping: ResolutionState
    execution_correlation: ResolutionState
    may_contain_user_material: bool
    copy_markdown: ArtifactActionReadiness
    open_file: ArtifactActionReadiness
    copy_file_path: ArtifactActionReadiness
    blockers: tuple[str, ...]
    evidence: tuple[ResolutionEvidence, ...]
    content_read_performed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "artifact_id", _identifier(self.artifact_id, "artifact_id"))
        object.__setattr__(self, "capability_id", _identifier(self.capability_id, "capability_id"))
        object.__setattr__(self, "media_type", _text(self.media_type, "media_type", maximum=128))
        object.__setattr__(self, "producer_nodes", _texts(self.producer_nodes, "producer_nodes"))
        object.__setattr__(self, "provider_logical_path_template", _logical_path_template(self.provider_logical_path_template, "provider_logical_path_template"))
        object.__setattr__(self, "source_result_field", _identifier(self.source_result_field, "source_result_field"))
        object.__setattr__(self, "blockers", _texts(self.blockers, "blockers"))
        for name in ("may_contain_user_material", "content_read_performed"):
            if not isinstance(getattr(self, name), bool):
                raise TypeError(f"{name} must be bool")
        if self.content_read_performed:
            raise ValueError("artifact contract cannot claim content read")
        if self.execution_correlation is not ResolutionState.RESOLVED:
            if any(value is ArtifactActionReadiness.READY for value in (self.copy_markdown, self.open_file, self.copy_file_path)):
                raise ValueError("artifact actions cannot be ready without execution correlation")


@dataclass(frozen=True, slots=True)
class CapabilityInvocationBinding:
    binding_id: str
    capability_id: str
    state: ResolutionState
    target: WorkflowTargetResolution
    invocation_surface_id: str
    input_mapping: tuple[tuple[str, str], ...]
    result_artifact_id: str
    blockers: tuple[str, ...]
    execution_enabled: bool = False

    def __post_init__(self) -> None:
        for name in ("binding_id", "capability_id", "invocation_surface_id", "result_artifact_id"):
            object.__setattr__(self, name, _identifier(getattr(self, name), name))
        normalized = tuple((_identifier(source, "input source"), _identifier(target, "input target")) for source, target in self.input_mapping)
        if len(set(normalized)) != len(normalized):
            raise ValueError("input_mapping contains duplicates")
        object.__setattr__(self, "input_mapping", normalized)
        object.__setattr__(self, "blockers", _texts(self.blockers, "blockers"))
        if not isinstance(self.execution_enabled, bool):
            raise TypeError("execution_enabled must be bool")
        if self.execution_enabled or self.state is not ResolutionState.NOT_READY:
            raise ValueError("V0.1 binding must remain NOT_READY and non-executable")


@dataclass(frozen=True, slots=True)
class ProviderTargetResolution:
    version: str
    provider: ProviderInstanceResolution
    target: WorkflowTargetResolution
    execution_surfaces: tuple[ExecutionSurface, ...]
    publish_surfaces: tuple[WorkflowPublishSurface, ...]
    backup_restore: WorkflowBackupRestorePlan
    result_artifact: AutomationResultArtifact
    invocation_binding: CapabilityInvocationBinding
    current_run_state: str = "unknown"

    def __post_init__(self) -> None:
        if self.version != PROVIDER_TARGET_VERSION:
            raise ValueError("unsupported provider target version")
        if self.current_run_state != "unknown":
            raise ValueError("offline target resolution cannot infer current Runtime state")
        surface_ids = [surface.surface_id for surface in self.execution_surfaces]
        if len(surface_ids) != len(set(surface_ids)):
            raise ValueError("execution surface ids must be unique")
        if self.invocation_binding.invocation_surface_id not in surface_ids:
            raise ValueError("binding must reference an inventoried execution surface")


class ProviderTargetResolver:
    """Deterministically resolves an explicitly supplied, sanitized evidence model."""

    def resolve_v141(self) -> ProviderTargetResolution:
        return build_v141_provider_target_resolution()


def build_v141_provider_target_resolution() -> ProviderTargetResolution:
    canonical = ResolutionEvidence(
        "v141-canonical-export",
        "source_import/n8n_工作流开发/output/中国AI知识库采集器_V1.4.1_网页失败兜底版.json",
        "Canonical V1.4.1 source with external workflow id, form trigger, output chain, and provider-logical file path.",
        "B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514",
    )
    runtime_report = ResolutionEvidence(
        "legacy-runtime-report",
        "source_import/n8n_工作流开发/_system/n8n_real_runtime_report.md",
        "Historical report identifies workflow export via official CLI and an observed local container, but not a stable endpoint or instance contract.",
    )
    deployment = ResolutionEvidence(
        "legacy-deployment-v1",
        "source_import/n8n_工作流开发/_system/n8n_deployment/README.md",
        "Deployment V1.0 supports static precheck and isolated import only; production script records confirmation without connecting or publishing.",
    )
    sandbox = ResolutionEvidence(
        "v141-sandbox-export",
        "source_import/n8n_工作流开发/_system/n8n_runtime_test/中国AI知识库采集器_V1.4.1_隔离测试版.json",
        "Isolated inactive workflow using manual trigger and stubs; it is not the production target.",
        "F05B31D86EB0467946546557F71C5AEAC91D992451CB0E0000F7824725B9DDB6",
    )

    provider = ProviderInstanceResolution(
        provider_kind="n8n",
        provider_instance_id=None,
        state=ResolutionState.UNRESOLVED,
        confidence=ResolutionConfidence.UNRESOLVED,
        observed_container_name="n8n",
        observed_version="2.32.7",
        stable_endpoint=None,
        blockers=("stable_instance_identity_absent", "stable_production_endpoint_absent", "runtime_confirmation_not_authorized"),
        evidence=(runtime_report, deployment),
    )
    target = WorkflowTargetResolution(
        capability_id="knowledge.collect",
        provider_kind="n8n",
        provider_instance_id=None,
        external_workflow_id="ymYh8t76VP3jGPbr",
        canonical_source_ref=canonical.logical_ref,
        canonical_source_sha256=canonical.sha256 or "",
        canonical_version_id="802897a6-0644-4927-9bad-3ecc34d8a28b",
        sandbox_external_workflow_id="V141Final403429",
        sandbox_source_ref=sandbox.logical_ref,
        sandbox_source_sha256=sandbox.sha256 or "",
        sandbox_production_separated=True,
        state=ResolutionState.PARTIALLY_RESOLVED,
        confidence=ResolutionConfidence.CONTEXTUAL,
        blockers=("provider_instance_unresolved", "current_production_revision_not_runtime_confirmed"),
        evidence=(canonical, runtime_report, sandbox),
    )

    surfaces = (
        ExecutionSurface("v141-form-trigger", ExecutionSurfaceKind.FORM_TRIGGER, SurfaceClassification.SUPPORTED_EXISTING,
                         "production_candidate", True, False, RequirementState.UNRESOLVED, True,
                         ResolutionState.UNRESOLVED, ResolutionState.UNRESOLVED,
                         ("recommended_future_manual_surface", "form_url_template_absent", "no_execution_or_artifact_return_contract"), (canonical,)),
        ExecutionSurface("sandbox-cli-execute", ExecutionSurfaceKind.CLI_EXECUTE, SurfaceClassification.TEST_ONLY,
                         "isolated_sandbox", True, False, RequirementState.NOT_REQUIRED, True,
                         ResolutionState.RESOLVED, ResolutionState.PARTIALLY_RESOLVED,
                         ("official_n8n_cli", "requires_isolated_container", "must_not_target_production"), (sandbox, runtime_report)),
        ExecutionSurface("production-cli-execute", ExecutionSurfaceKind.CLI_EXECUTE, SurfaceClassification.UNRESOLVED,
                         "production", False, False, RequirementState.UNRESOLVED, True,
                         ResolutionState.UNRESOLVED, ResolutionState.UNRESOLVED,
                         ("no_authorized_production_execute_helper",), (runtime_report,)),
        ExecutionSurface("production-api", ExecutionSurfaceKind.API, SurfaceClassification.UNRESOLVED,
                         "production", False, False, RequirementState.REQUIRED, True,
                         ResolutionState.UNRESOLVED, ResolutionState.UNRESOLVED,
                         ("no_api_helper_or_endpoint_evidence", "credential_required_but_not_read"), (deployment,)),
        ExecutionSurface("production-webhook", ExecutionSurfaceKind.WEBHOOK, SurfaceClassification.UNRESOLVED,
                         "production", False, False, RequirementState.UNRESOLVED, True,
                         ResolutionState.UNRESOLVED, ResolutionState.UNRESOLVED,
                         ("workflow_uses_form_trigger_not_webhook_trigger", "no_webhook_url_template"), (canonical,)),
    )

    publish_surfaces = (
        WorkflowPublishSurface("production-confirmation-precheck", PublishMethod.PREFLIGHT_CONFIRMATION_ONLY,
                               SurfaceClassification.LEGACY_ONLY, "production_unresolved",
                               ("candidate_workflow_json", "strict_static_precheck", "user_confirmation"),
                               RequirementState.NOT_REQUIRED, ResolutionState.UNRESOLVED,
                               canonical.sha256, True, True, False, (deployment,)),
        WorkflowPublishSurface("isolated-cli-import", PublishMethod.CLI_IMPORT, SurfaceClassification.TEST_ONLY,
                               "isolated_ephemeral_n8n", ("candidate_workflow_json", "inactive_state"),
                               RequirementState.NOT_REQUIRED, ResolutionState.RESOLVED,
                               canonical.sha256, False, False, True, (deployment,)),
        WorkflowPublishSurface("production-cli-import", PublishMethod.CLI_IMPORT, SurfaceClassification.CANDIDATE,
                               "production_unresolved", ("candidate_workflow_json", "resolved_target", "immutable_backup", "user_confirmation"),
                               RequirementState.UNRESOLVED, ResolutionState.UNRESOLVED,
                               canonical.sha256, True, True, False, (deployment, runtime_report)),
        WorkflowPublishSurface("production-api-update", PublishMethod.API_UPDATE, SurfaceClassification.UNRESOLVED,
                               "production_unresolved", ("resolved_endpoint", "resolved_target", "authentication", "immutable_backup", "candidate_workflow_json"),
                               RequirementState.REQUIRED, ResolutionState.UNRESOLVED,
                               canonical.sha256, True, True, False, (deployment,)),
    )

    backup_restore = WorkflowBackupRestorePlan(
        plan_id="knowledge-collect-backup-restore-v01",
        target=target,
        readiness=BackupRestoreReadiness.NOT_READY,
        existing_assets=("canonical_versioned_json", "historical_official_cli_export", "isolated_export_evidence"),
        required_backup_steps=("resolve_provider_and_target", "export_current_production_workflow", "store_immutable_export", "record_provider_scoped_identity_hash_and_timestamp"),
        required_restore_steps=("retain_pre_publish_backup", "publish_candidate_only_after_approval", "verify_provider_scoped_target", "restore_exact_backup_on_failure", "verify_restored_hash_and_record_report"),
        blockers=("current_production_export_not_available_offline", "production_export_adapter_absent", "restore_adapter_absent", "provider_instance_unresolved"),
    )

    artifact = AutomationResultArtifact(
        artifact_id="knowledge-collect-markdown",
        capability_id="knowledge.collect",
        kind=ArtifactKind.MARKDOWN_FILE,
        media_type="text/markdown",
        producer_nodes=("Basic LLM Chain", "Convert to File", "Read/Write Files from Disk"),
        provider_logical_path_template="/knowledge/00_待审核/AI工具/{ai_name}.md",
        source_result_field="text",
        provider_storage_mapping=ResolutionState.UNRESOLVED,
        execution_correlation=ResolutionState.UNRESOLVED,
        may_contain_user_material=True,
        copy_markdown=ArtifactActionReadiness.NOT_READY,
        open_file=ArtifactActionReadiness.NOT_READY,
        copy_file_path=ArtifactActionReadiness.NOT_READY,
        blockers=("provider_volume_mapping_unresolved", "execution_to_artifact_manifest_absent", "safe_artifact_reader_absent", "ai_name_filename_safety_not_evidenced"),
        evidence=(canonical,),
    )
    binding = CapabilityInvocationBinding(
        binding_id="knowledge-collect-v141",
        capability_id="knowledge.collect",
        state=ResolutionState.NOT_READY,
        target=target,
        invocation_surface_id="v141-form-trigger",
        input_mapping=(("ai_name", "ai_name"), ("source_text", "source_text"), ("source_url", "source_url")),
        result_artifact_id=artifact.artifact_id,
        blockers=("provider_instance_unresolved", "production_form_url_unresolved", "execution_identity_return_unresolved", "result_artifact_read_not_ready"),
    )
    return ProviderTargetResolution(PROVIDER_TARGET_VERSION, provider, target, surfaces, publish_surfaces, backup_restore, artifact, binding)


def build_provider_target_resolver() -> ProviderTargetResolver:
    return ProviderTargetResolver()


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


def serialize_provider_target(value: Any) -> str:
    return json.dumps(_primitive(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
