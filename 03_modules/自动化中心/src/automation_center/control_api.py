"""JSON-safe public facade for Automation Control Foundation V0.1."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from enum import Enum
import json
from typing import Any

from automation_center.application.control import (
    CONTROL_FOUNDATION_VERSION,
    AutomationControlService,
    AutomationRunRequest,
    CapabilityNotFoundError,
    DeploymentGateInput,
    DiagnosisRequest,
    HistoricalHealthObservation,
    ControlWorkflowIdentity,
    RepairCandidate,
    RepairRequest,
    RiskLevel,
    RunRequestState,
    CandidateState,
    CandidateValidation,
    ValidationOutcome,
    ResultActionType,
    WorkflowBuildCandidate,
    WorkflowBuildRequest,
)
from automation_center.application.results import BusinessResultStatus, ResultExecutionStatus
from automation_center.application.results import result_to_primitive
from automation_center.product import (
    AutomationProviderConfig,
    ProductResultArtifact,
    ProviderHealthObservation,
    candidate_pipeline_contracts,
    prepare_queqiao_handoff,
    project_run_lifecycle,
    transition_run_lifecycle,
)
from automation_center.run_prep import (
    CredentialAvailability,
    CredentialRef,
    ExecutionStatusReader,
    KnowledgeCollectInputPolicy,
    N8nCredentialBoundary,
    N8nExecutionAdapter,
    N8nWorkflowMetadataReader,
    WorkflowMetadataReadResult,
    build_copy_result_payload,
    build_execution_artifact_manifest,
    build_run_confirmation_payload,
    build_tiangong_diagnosis_handoff,
    evaluate_manual_run_preflight,
    evaluate_production_update_preflight,
    evaluate_repair_metadata_binding,
)
from automation_center.auth_metadata import (
    build_artifact_collision_preflight,
    build_auth_metadata_product_status,
    build_execution_adapter_preparation,
    build_first_pilot_approval_payload,
    build_first_pilot_failure_diagnosis,
    build_first_pilot_request,
    project_knowledge_collect_binding,
    project_metadata_freshness,
    reconcile_workflow_revision,
)
from automation_center.metadata_reconcile import (
    build_first_run_readiness,
    build_tiangong_metadata_reconciliation_status,
    build_update_preparation,
)
from automation_center.production_update import (
    build_production_update_status,
    build_production_update_request,
    verify_revision_lock,
)


AUTOMATION_CONTROL_API_VERSION = "0.1"


class ControlAPIErrorCode(str, Enum):
    NOT_FOUND = "not_found"
    INVALID_INPUT = "invalid_input"
    INVALID_REQUEST = "invalid_request"
    POLICY_BLOCKED = "policy_blocked"
    INTERNAL_INVARIANT_VIOLATION = "internal_invariant_violation"


class AutomationControlAPI:
    """Create safe control-plane requests without executing or publishing them."""

    api_version = AUTOMATION_CONTROL_API_VERSION
    foundation_version = CONTROL_FOUNDATION_VERSION

    def __init__(self, service: AutomationControlService) -> None:
        if not isinstance(service, AutomationControlService):
            raise TypeError("service must be AutomationControlService")
        self._service = service

    def list_capabilities(self) -> dict[str, Any]:
        return self._invoke("list_capabilities", self._service.registry.list_capabilities)

    def get_capability(self, capability_id: str) -> dict[str, Any]:
        try:
            return self._success(self._service.registry.get_capability(capability_id))
        except CapabilityNotFoundError:
            return self._error(ControlAPIErrorCode.NOT_FOUND, "Capability was not found", "get_capability")
        except (TypeError, ValueError):
            return self._error(ControlAPIErrorCode.INVALID_INPUT, "Capability identity is invalid", "get_capability")

    def validate_input(self, capability_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._validated("validate_input", lambda: self._service.validate_input(capability_id, payload))

    def prepare_run(self, capability_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._validated("prepare_run", lambda: self._service.prepare_run(capability_id, payload))

    def create_run_request(
        self,
        capability_id: str,
        payload: Mapping[str, Any],
        request_id: str,
        *,
        confirmation_granted: bool = False,
    ) -> dict[str, Any]:
        return self._validated(
            "create_run_request",
            lambda: self._service.create_run_request(
                capability_id,
                payload,
                request_id,
                confirmation_granted=confirmation_granted,
            ),
        )

    def retry_request(self, request: AutomationRunRequest | Mapping[str, Any], request_id: str) -> dict[str, Any]:
        return self._validated(
            "retry_request",
            lambda: self._service.retry_request(self._run_request(request), request_id),
        )

    def project_run_request_lifecycle(
        self,
        request: AutomationRunRequest | Mapping[str, Any],
    ) -> dict[str, Any]:
        return self._validated(
            "project_run_request_lifecycle",
            lambda: project_run_lifecycle(self._run_request(request)),
        )

    def get_candidate_pipeline_contracts(self) -> dict[str, Any]:
        return self._success(candidate_pipeline_contracts())

    def transition_run_request(self, current_state: str, target_state: str) -> dict[str, Any]:
        return self._validated(
            "transition_run_request",
            lambda: transition_run_lifecycle(current_state, target_state),
        )

    def prepare_queqiao_handoff(self, **fields: Any) -> dict[str, Any]:
        return self._validated(
            "prepare_queqiao_handoff",
            lambda: prepare_queqiao_handoff(**fields),
        )

    def validate_knowledge_collect_input(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._validated("validate_knowledge_collect_input", lambda: KnowledgeCollectInputPolicy().validate(payload))

    def create_auth_session_request(
        self, *, credential_ref_id: str, availability: str, request_id: str, scopes: tuple[str, ...]
    ) -> dict[str, Any]:
        def create() -> Any:
            ref = CredentialRef(
                credential_ref_id, "n8n-tiangong-primary", "n8n_api",
                CredentialAvailability(availability),
            )
            request = N8nCredentialBoundary.create_session_request(ref, request_id=request_id, scopes=scopes)
            return {"credential_ref": ref, "request": request, "redacted_context": N8nCredentialBoundary.redacted_context(request, ref)}
        return self._validated("create_auth_session_request", create)

    def read_workflow_metadata(
        self, *, config: AutomationProviderConfig, auth_request: Any = None, transport: Any = None
    ) -> dict[str, Any]:
        return self._validated(
            "read_workflow_metadata",
            lambda: N8nWorkflowMetadataReader(transport).read(config, auth_request),
        )

    def evaluate_manual_run_preflight(self, **fields: Any) -> dict[str, Any]:
        return self._validated("evaluate_manual_run_preflight", lambda: evaluate_manual_run_preflight(**fields))

    def project_tiangong_auth_metadata(
        self, metadata_result: WorkflowMetadataReadResult | None = None, credential_ref: CredentialRef | None = None
    ) -> dict[str, Any]:
        return self._validated(
            "project_tiangong_auth_metadata",
            lambda: build_auth_metadata_product_status(metadata_result, credential_ref=credential_ref),
        )

    def project_metadata_freshness(self, metadata_result: WorkflowMetadataReadResult) -> dict[str, Any]:
        return self._validated("project_metadata_freshness", lambda: project_metadata_freshness(metadata_result))

    def reconcile_tiangong_revision(self, metadata_result: WorkflowMetadataReadResult) -> dict[str, Any]:
        return self._validated("reconcile_tiangong_revision", lambda: reconcile_workflow_revision(metadata_result))

    def project_knowledge_collect_binding(self, metadata_result: WorkflowMetadataReadResult | None) -> dict[str, Any]:
        return self._validated(
            "project_knowledge_collect_binding", lambda: project_knowledge_collect_binding(metadata_result)
        )

    def create_first_pilot_request(self) -> dict[str, Any]:
        return self._validated("create_first_pilot_request", build_first_pilot_request)

    def create_first_pilot_approval_payload(self, metadata_result: WorkflowMetadataReadResult) -> dict[str, Any]:
        return self._validated(
            "create_first_pilot_approval_payload", lambda: build_first_pilot_approval_payload(metadata_result)
        )

    def create_first_pilot_failure_diagnosis(
        self, metadata_result: WorkflowMetadataReadResult, *, execution_id: str, safe_error_summary: str
    ) -> dict[str, Any]:
        return self._validated(
            "create_first_pilot_failure_diagnosis",
            lambda: build_first_pilot_failure_diagnosis(
                metadata_result, execution_id=execution_id, safe_error_summary=safe_error_summary
            ),
        )

    def get_artifact_collision_preflight(self) -> dict[str, Any]:
        return self._validated("get_artifact_collision_preflight", build_artifact_collision_preflight)

    def get_execution_adapter_preparation(self, metadata_result: WorkflowMetadataReadResult | None) -> dict[str, Any]:
        return self._validated(
            "get_execution_adapter_preparation", lambda: build_execution_adapter_preparation(metadata_result)
        )

    def get_tiangong_metadata_reconciliation(self) -> dict[str, Any]:
        return self._validated(
            "get_tiangong_metadata_reconciliation", build_tiangong_metadata_reconciliation_status
        )

    def get_reconciled_first_run_readiness(self) -> dict[str, Any]:
        return self._validated("get_reconciled_first_run_readiness", build_first_run_readiness)

    def get_tiangong_update_preparation(self) -> dict[str, Any]:
        return self._validated("get_tiangong_update_preparation", build_update_preparation)

    def get_tiangong_production_update(self) -> dict[str, Any]:
        return self._validated("get_tiangong_production_update", build_production_update_status)

    def create_tiangong_production_update_request(self) -> dict[str, Any]:
        return self._validated("create_tiangong_production_update_request", build_production_update_request)

    def verify_tiangong_revision_lock(
        self, lock: Any, *, observed_revision: str, observed_updated_at: str
    ) -> dict[str, Any]:
        return self._validated(
            "verify_tiangong_revision_lock",
            lambda: verify_revision_lock(
                lock, observed_revision=observed_revision, observed_updated_at=observed_updated_at
            ),
        )

    def create_run_confirmation_payload(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._validated(
            "create_run_confirmation_payload",
            lambda: build_run_confirmation_payload(KnowledgeCollectInputPolicy().validate(payload)),
        )

    def build_execution_request(
        self, *, surface: Any, payload: Mapping[str, Any], confirmation_id: str
    ) -> dict[str, Any]:
        return self._validated(
            "build_execution_request",
            lambda: N8nExecutionAdapter.build_request(
                surface, KnowledgeCollectInputPolicy().validate(payload), confirmation_id=confirmation_id
            ),
        )

    def parse_execution_response(self, status_code: int, payload: Mapping[str, Any]) -> dict[str, Any]:
        return self._validated(
            "parse_execution_response", lambda: N8nExecutionAdapter.parse_response(status_code, payload)
        )

    def observe_execution(
        self, execution_id: str, *, auth_request: Any = None, transport: Any = None
    ) -> dict[str, Any]:
        return self._validated(
            "observe_execution", lambda: ExecutionStatusReader(transport).read(execution_id, auth_request)
        )

    def build_execution_artifact_manifest(self, **fields: Any) -> dict[str, Any]:
        return self._validated(
            "build_execution_artifact_manifest", lambda: build_execution_artifact_manifest(**fields)
        )

    def build_copy_result_payload(self, artifact: ProductResultArtifact, *, title: str) -> dict[str, Any]:
        return self._validated(
            "build_copy_result_payload", lambda: build_copy_result_payload(artifact, title=title)
        )

    def create_tiangong_diagnosis_handoff(self, **fields: Any) -> dict[str, Any]:
        return self._validated(
            "create_tiangong_diagnosis_handoff", lambda: build_tiangong_diagnosis_handoff(**fields)
        )

    def evaluate_repair_metadata_binding(
        self, metadata_result: WorkflowMetadataReadResult | None
    ) -> dict[str, Any]:
        return self._validated(
            "evaluate_repair_metadata_binding", lambda: evaluate_repair_metadata_binding(metadata_result)
        )

    def evaluate_production_update_preflight(self, **checks: bool) -> dict[str, Any]:
        return self._validated(
            "evaluate_production_update_preflight", lambda: evaluate_production_update_preflight(**checks)
        )

    def create_result_action(
        self,
        action_type: str,
        safe_value: str,
        *,
        label: str,
        media_type: str,
        primary: bool = False,
    ) -> dict[str, Any]:
        try:
            parsed_type = ResultActionType(action_type)
        except (TypeError, ValueError):
            return self._error(ControlAPIErrorCode.INVALID_INPUT, "Result action type is invalid", "create_result_action")
        return self._validated(
            "create_result_action",
            lambda: self._service.create_result_action(
                parsed_type, safe_value, label=label, media_type=media_type, primary=primary
            ),
        )

    def create_diagnosis_request(self, **fields: Any) -> dict[str, Any]:
        return self._validated(
            "create_diagnosis_request",
            lambda: DiagnosisRequest(**self._with_identity(fields)),
        )

    def create_repair_request(self, **fields: Any) -> dict[str, Any]:
        return self._validated(
            "create_repair_request",
            lambda: RepairRequest(**self._with_identity(fields)),
        )

    def create_workflow_build_request(self, **fields: Any) -> dict[str, Any]:
        def create() -> WorkflowBuildRequest:
            values = dict(fields)
            values["risk_level"] = RiskLevel(values["risk_level"])
            return WorkflowBuildRequest(**values)

        return self._validated("create_workflow_build_request", create)

    def create_repair_candidate(self, **fields: Any) -> dict[str, Any]:
        def create() -> RepairCandidate:
            values = self._with_identity(fields)
            values["validation"] = self._validation(values["validation"])
            values["risk_level"] = RiskLevel(values["risk_level"])
            if "state" in values:
                values["state"] = CandidateState(values["state"])
            return RepairCandidate(**values)

        return self._validated("create_repair_candidate", create)

    def create_workflow_build_candidate(self, **fields: Any) -> dict[str, Any]:
        def create() -> WorkflowBuildCandidate:
            values = dict(fields)
            values["validation"] = self._validation(values["validation"])
            if "state" in values:
                values["state"] = CandidateState(values["state"])
            return WorkflowBuildCandidate(**values)

        return self._validated("create_workflow_build_candidate", create)

    def project_health(
        self,
        workflow_identity: Mapping[str, Any],
        observations: list[Mapping[str, Any]],
    ) -> dict[str, Any]:
        def project() -> Any:
            identity = self._identity(workflow_identity)
            values = tuple(
                HistoricalHealthObservation(
                    execution_external_id=item["execution_external_id"],
                    execution_status=ResultExecutionStatus(item["execution_status"]),
                    business_status=BusinessResultStatus(item["business_status"]),
                    observed_at=self._datetime(item.get("observed_at")),
                    safe_error_summary=item.get("safe_error_summary"),
                )
                for item in observations
            )
            return self._service.project_health(identity, values)

        return self._validated("project_health", project)

    def evaluate_deployment_gate(self, **fields: Any) -> dict[str, Any]:
        return self._validated(
            "evaluate_deployment_gate",
            lambda: self._service.evaluate_deployment_gate(DeploymentGateInput(**fields)),
        )

    def _validated(self, operation: str, callback: Any) -> dict[str, Any]:
        try:
            return self._success(callback())
        except CapabilityNotFoundError:
            return self._error(ControlAPIErrorCode.NOT_FOUND, "Capability was not found", operation)
        except (TypeError, ValueError, KeyError):
            return self._error(ControlAPIErrorCode.INVALID_INPUT, "Control input is invalid", operation)
        except Exception:
            return self._error(
                ControlAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "Control request could not be prepared safely",
                operation,
            )

    def _invoke(self, operation: str, callback: Any) -> dict[str, Any]:
        try:
            return self._success(callback())
        except Exception:
            return self._error(
                ControlAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "Control query could not be completed safely",
                operation,
            )

    @staticmethod
    def _identity(value: Any) -> ControlWorkflowIdentity:
        if isinstance(value, ControlWorkflowIdentity):
            return value
        if not isinstance(value, Mapping):
            raise TypeError("workflow_identity must be an object")
        allowed = {"provider_kind", "provider_instance_id", "external_workflow_id"}
        if not set(value).issubset(allowed) or not {"provider_kind", "external_workflow_id"}.issubset(value):
            raise ValueError("workflow_identity fields are invalid")
        return ControlWorkflowIdentity(
            provider_kind=value["provider_kind"],
            provider_instance_id=value.get("provider_instance_id"),
            external_workflow_id=value["external_workflow_id"],
        )

    @classmethod
    def _with_identity(cls, fields: Mapping[str, Any]) -> dict[str, Any]:
        values = dict(fields)
        values["workflow_identity"] = cls._identity(values["workflow_identity"])
        return values

    @staticmethod
    def _validation(value: Any) -> CandidateValidation:
        if isinstance(value, CandidateValidation):
            return value
        if not isinstance(value, Mapping):
            raise TypeError("validation must be an object")
        return CandidateValidation(
            static_tests=ValidationOutcome(value["static_tests"]),
            sandbox_validation=ValidationOutcome(value["sandbox_validation"]),
            test_summary=tuple(value.get("test_summary", ())),
        )

    @classmethod
    def _run_request(cls, value: Any) -> AutomationRunRequest:
        if isinstance(value, AutomationRunRequest):
            return value
        if not isinstance(value, Mapping):
            raise TypeError("request must be an object")
        return AutomationRunRequest(
            request_id=value["request_id"],
            capability_id=value["capability_id"],
            workflow_identity=cls._identity(value["workflow_identity"]),
            input_payload=tuple(tuple(item) for item in value["input_payload"]),
            input_sha256=value["input_sha256"],
            state=RunRequestState(value["state"]),
            risk_level=RiskLevel(value["risk_level"]),
            confirmation_required=value["confirmation_required"],
            confirmation_granted=value["confirmation_granted"],
            blockers=tuple(value.get("blockers", ())),
            retry_of_request_id=value.get("retry_of_request_id"),
            execution_authorized=value.get("execution_authorized", False),
            dispatched=value.get("dispatched", False),
        )

    @staticmethod
    def _datetime(value: Any) -> datetime | None:
        if value is None or isinstance(value, datetime):
            return value
        if not isinstance(value, str):
            raise TypeError("observed_at must be an ISO-8601 string")
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("observed_at must include a timezone")
        return parsed

    @staticmethod
    def _success(data: Any) -> dict[str, Any]:
        return {
            "api_version": AUTOMATION_CONTROL_API_VERSION,
            "foundation_version": CONTROL_FOUNDATION_VERSION,
            "ok": True,
            "data": _json_copy(data),
        }

    @staticmethod
    def _error(code: ControlAPIErrorCode, message: str, operation: str) -> dict[str, Any]:
        return {
            "api_version": AUTOMATION_CONTROL_API_VERSION,
            "foundation_version": CONTROL_FOUNDATION_VERSION,
            "ok": False,
            "error": {"code": code.value, "message": message, "details": {"operation": operation}},
        }


def build_control_api(service: AutomationControlService) -> AutomationControlAPI:
    return AutomationControlAPI(service)


def serialize_control_api_response(response: Mapping[str, Any]) -> str:
    return json.dumps(
        _json_copy(response),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _json_copy(value: Any) -> Any:
    encoded = json.dumps(
        result_to_primitive(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return json.loads(encoded)


__all__ = [
    "AUTOMATION_CONTROL_API_VERSION",
    "AutomationControlAPI",
    "ControlAPIErrorCode",
    "build_control_api",
    "serialize_control_api_response",
]
