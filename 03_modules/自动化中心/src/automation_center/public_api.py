"""Stable, provider-neutral public read facade for Automation Center V0.1."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
import json
from typing import Any, TypedDict

from automation_center.application import (
    UnifiedAutomationQueryService,
    UnifiedResultNotFoundError,
    UnifiedWorkflowNotFoundError,
    result_to_primitive,
)
from automation_center.domain import ProviderRef, WorkflowRef
from automation_center.application import ResultExecutionIdentity


AUTOMATION_READ_API_VERSION = "0.1"


class ReadAPIErrorCode(str, Enum):
    NOT_FOUND = "not_found"
    INVALID_IDENTITY = "invalid_identity"
    INVALID_QUERY = "invalid_query"
    AMBIGUOUS = "ambiguous"
    INTERNAL_INVARIANT_VIOLATION = "internal_invariant_violation"
    UNRESOLVED_IDENTITY = "unresolved_identity"


class ReadAPIErrorBody(TypedDict):
    code: str
    message: str
    details: dict[str, str]


class ReadAPISuccessEnvelope(TypedDict):
    api_version: str
    ok: bool
    data: Any


class ReadAPIErrorEnvelope(TypedDict):
    api_version: str
    ok: bool
    error: ReadAPIErrorBody


ReadAPIResponse = ReadAPISuccessEnvelope | ReadAPIErrorEnvelope


@dataclass(frozen=True, slots=True)
class _UIProfile:
    value: dict[str, Any]

    def __post_init__(self) -> None:
        if not isinstance(self.value, dict):
            raise TypeError("UI profile must be an internal JSON object")


@dataclass(frozen=True, slots=True)
class _ProductProfile:
    value: dict[str, Any]

    def __post_init__(self) -> None:
        if not isinstance(self.value, dict):
            raise TypeError("product profile must be an internal JSON object")


class _IdentityInputError(ValueError):
    pass


class _QueryInputError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class WorkflowIdentityInput:
    provider_kind: str
    provider_instance_id: str
    external_workflow_id: str

    @classmethod
    def from_value(cls, value: Mapping[str, Any] | WorkflowIdentityInput) -> WorkflowIdentityInput:
        if isinstance(value, cls):
            value = {
                "provider_kind": value.provider_kind,
                "provider_instance_id": value.provider_instance_id,
                "external_workflow_id": value.external_workflow_id,
            }
        if not isinstance(value, Mapping):
            raise _IdentityInputError("workflow identity must be an object")
        required = {"provider_kind", "provider_instance_id", "external_workflow_id"}
        if set(value) != required:
            raise _IdentityInputError("workflow identity fields are invalid")
        fields = tuple(value[key] for key in sorted(required))
        if not all(isinstance(item, str) and item.strip() for item in fields):
            raise _IdentityInputError("workflow identity values must be non-empty strings")
        try:
            identity = WorkflowRef(
                ProviderRef(value["provider_kind"], value["provider_instance_id"]),
                value["external_workflow_id"],
            )
        except (TypeError, ValueError) as exc:
            raise _IdentityInputError("workflow identity values are invalid") from exc
        return cls(
            identity.provider.provider_kind,
            identity.provider.provider_instance_id,
            identity.external_workflow_id,
        )

    def to_domain(self) -> WorkflowRef:
        return WorkflowRef(
            ProviderRef(self.provider_kind, self.provider_instance_id),
            self.external_workflow_id,
        )


@dataclass(frozen=True, slots=True)
class ExecutionIdentityInput:
    provider_kind: str
    provider_instance_id: str
    execution_external_id: str

    @classmethod
    def from_value(cls, value: Mapping[str, Any] | ExecutionIdentityInput) -> ExecutionIdentityInput:
        if isinstance(value, cls):
            value = {
                "provider_kind": value.provider_kind,
                "provider_instance_id": value.provider_instance_id,
                "execution_external_id": value.execution_external_id,
            }
        if not isinstance(value, Mapping):
            raise _IdentityInputError("execution identity must be an object")
        required = {"provider_kind", "provider_instance_id", "execution_external_id"}
        if set(value) != required:
            raise _IdentityInputError("execution identity fields are invalid")
        fields = tuple(value[key] for key in sorted(required))
        if not all(isinstance(item, str) and item.strip() for item in fields):
            raise _IdentityInputError("execution identity values must be non-empty strings")
        try:
            identity = ResultExecutionIdentity(
                value["provider_kind"].strip(),
                value["provider_instance_id"].strip(),
                value["execution_external_id"].strip(),
            )
        except (TypeError, ValueError) as exc:
            raise _IdentityInputError("execution identity values are invalid") from exc
        return cls(
            identity.provider_kind,
            identity.provider_instance_id,
            identity.execution_external_id,
        )

    def to_application(self) -> ResultExecutionIdentity:
        return ResultExecutionIdentity(
            self.provider_kind,
            self.provider_instance_id,
            self.execution_external_id,
        )


_DEFINITION_STATUSES = {"active", "inactive", "unknown", "unavailable"}
_TRIGGER_TYPES = {"form", "error", "manual", "schedule", "webhook", "other", "unknown"}
_EXECUTION_STATUSES = {"success", "failed", "unknown", "not_observed"}
_BUSINESS_STATUSES = {"success", "partial", "failed", "unknown", "not_reported"}
_SANDBOX_CLASSIFICATION = "sandbox_real_execution_with_synthetic_dependencies"


class AutomationReadAPI:
    """Thin JSON-safe facade over a prepared UnifiedAutomationQueryService."""

    api_version = AUTOMATION_READ_API_VERSION

    def __init__(
        self,
        query_service: UnifiedAutomationQueryService | None,
        *,
        _ui_profile: _UIProfile | None = None,
        _product_profile: _ProductProfile | None = None,
    ) -> None:
        if query_service is not None and not isinstance(query_service, UnifiedAutomationQueryService):
            raise TypeError("query_service must be UnifiedAutomationQueryService")
        if query_service is None and _product_profile is None:
            raise TypeError("query_service is required outside internal product-only mode")
        self._query_service = query_service
        if _ui_profile is not None and not isinstance(_ui_profile, _UIProfile):
            raise TypeError("_ui_profile is an internal composition value")
        self._ui_profile = (
            _json_copy(_ui_profile.value) if _ui_profile is not None else None
        )
        if _product_profile is not None and not isinstance(_product_profile, _ProductProfile):
            raise TypeError("_product_profile is an internal composition value")
        self._product_profile = (
            _json_copy(_product_profile.value) if _product_profile is not None else None
        )

    def get_overview(self) -> ReadAPIResponse:
        if self._query_service is None:
            return self._query_unconfigured("get_overview")
        return self._invoke("get_overview", self._query_service.get_overview)

    def list_workflows(
        self,
        *,
        provider_kind: str | None = None,
        provider_instance_id: str | None = None,
        definition_status: str | None = None,
        trigger_type: str | None = None,
        text: str | None = None,
    ) -> ReadAPIResponse:
        try:
            provider_kind = self._optional_text(provider_kind, "provider_kind", max_length=64)
            provider_instance_id = self._optional_text(
                provider_instance_id, "provider_instance_id", max_length=128
            )
            definition_status = self._optional_choice(
                definition_status, "definition_status", _DEFINITION_STATUSES
            )
            trigger_type = self._optional_choice(trigger_type, "trigger_type", _TRIGGER_TYPES)
            text = self._optional_text(text, "text", max_length=256)
        except _QueryInputError:
            return self._error(
                ReadAPIErrorCode.INVALID_QUERY,
                "Workflow query filters are invalid",
                "list_workflows",
            )

        def query() -> tuple[Any, ...]:
            workflows = self._query_service.list_workflow_read_models()
            needle = text.casefold() if text is not None else None
            return tuple(
                item
                for item in workflows
                if (provider_kind is None or item.provider_kind == provider_kind)
                and (
                    provider_instance_id is None
                    or item.provider_instance_id == provider_instance_id
                )
                and (definition_status is None or item.definition_status == definition_status)
                and (
                    trigger_type is None
                    or any(trigger.trigger_type == trigger_type for trigger in item.trigger_summary)
                )
                and (needle is None or needle in item.display_name.casefold())
            )

        return self._invoke("list_workflows", query)

    def get_workflow(
        self,
        identity: Mapping[str, Any] | WorkflowIdentityInput,
    ) -> ReadAPIResponse:
        if self._query_service is None:
            return self._query_unconfigured("get_workflow")
        try:
            workflow_identity = WorkflowIdentityInput.from_value(identity).to_domain()
        except _IdentityInputError:
            return self._error(
                ReadAPIErrorCode.INVALID_IDENTITY,
                "Workflow identity is invalid",
                "get_workflow",
            )
        try:
            return self._success(
                self._query_service.get_workflow_read_model(workflow_identity)
            )
        except UnifiedWorkflowNotFoundError:
            return self._error(
                ReadAPIErrorCode.NOT_FOUND,
                "Workflow was not found",
                "get_workflow",
            )
        except Exception:
            return self._error(
                ReadAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "Workflow query could not be completed safely",
                "get_workflow",
            )

    def list_results(
        self,
        *,
        execution_status: str | None = None,
        business_status: str | None = None,
        sandbox: bool | None = None,
        workflow_identity: Mapping[str, Any] | WorkflowIdentityInput | None = None,
    ) -> ReadAPIResponse:
        try:
            execution_status = self._optional_choice(
                execution_status, "execution_status", _EXECUTION_STATUSES
            )
            business_status = self._optional_choice(
                business_status, "business_status", _BUSINESS_STATUSES
            )
            if sandbox is not None and not isinstance(sandbox, bool):
                raise _QueryInputError("sandbox must be a boolean")
            parsed_workflow = (
                WorkflowIdentityInput.from_value(workflow_identity).to_domain()
                if workflow_identity is not None
                else None
            )
        except _IdentityInputError:
            return self._error(
                ReadAPIErrorCode.INVALID_IDENTITY,
                "Workflow identity filter is invalid",
                "list_results",
            )
        except _QueryInputError:
            return self._error(
                ReadAPIErrorCode.INVALID_QUERY,
                "Result query filters are invalid",
                "list_results",
            )

        def query() -> tuple[Any, ...]:
            results = self._query_service.list_historical_results(
                workflow_identity=parsed_workflow
            )
            return tuple(
                item
                for item in results
                if (execution_status is None or item.execution_status == execution_status)
                and (business_status is None or item.business_status == business_status)
                and (
                    sandbox is None
                    or (
                        item.evidence.source_classification == _SANDBOX_CLASSIFICATION
                    )
                    is sandbox
                )
            )

        return self._invoke("list_results", query)

    def get_result(
        self,
        identity: Mapping[str, Any] | ExecutionIdentityInput,
    ) -> ReadAPIResponse:
        if self._query_service is None:
            return self._query_unconfigured("get_result")
        try:
            execution_identity = ExecutionIdentityInput.from_value(identity).to_application()
        except _IdentityInputError:
            return self._error(
                ReadAPIErrorCode.INVALID_IDENTITY,
                "Execution identity is invalid",
                "get_result",
            )
        try:
            return self._success(
                self._query_service.get_result_by_execution_identity(execution_identity)
            )
        except UnifiedResultNotFoundError:
            return self._error(
                ReadAPIErrorCode.NOT_FOUND,
                "Historical result was not found",
                "get_result",
            )
        except Exception:
            return self._error(
                ReadAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "Historical result query could not be completed safely",
                "get_result",
            )

    def list_unresolved_results(
        self,
        *,
        provider_kind: str | None = None,
        execution_status: str | None = None,
        business_status: str | None = None,
    ) -> ReadAPIResponse:
        try:
            provider_kind = self._optional_text(provider_kind, "provider_kind", max_length=64)
            execution_status = self._optional_choice(
                execution_status, "execution_status", _EXECUTION_STATUSES
            )
            business_status = self._optional_choice(
                business_status, "business_status", _BUSINESS_STATUSES
            )
        except _QueryInputError:
            return self._error(
                ReadAPIErrorCode.INVALID_QUERY,
                "Unresolved result query filters are invalid",
                "list_unresolved_results",
            )

        def query() -> tuple[Any, ...]:
            results = self._query_service.list_unresolved_results()
            return tuple(
                item
                for item in results
                if (provider_kind is None or item.known_provider_kind == provider_kind)
                and (
                    execution_status is None
                    or item.result.execution_status == execution_status
                )
                and (
                    business_status is None
                    or item.result.business_status == business_status
                )
            )

        return self._invoke("list_unresolved_results", query)

    def list_orphan_results(self) -> ReadAPIResponse:
        if self._query_service is None:
            return self._query_unconfigured("list_orphan_results")
        return self._invoke(
            "list_orphan_results", self._query_service.list_orphan_results
        )

    def get_ui_overview(self) -> ReadAPIResponse:
        """Return the existing overview with bounded UI integration semantics."""

        if self._ui_profile is None:
            return self._ui_not_configured("get_ui_overview")
        try:
            overview = _json_copy(self._query_service.get_overview())
            overview["ui_integration"] = _json_copy(self._ui_profile["overview"])
            return self._success(overview)
        except Exception:
            return self._error(
                ReadAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "UI overview could not be completed safely",
                "get_ui_overview",
            )

    def list_ui_workflows(self) -> ReadAPIResponse:
        """Return workflow list items augmented by explicitly registered UI profiles."""

        if self._ui_profile is None:
            return self._ui_not_configured("list_ui_workflows")
        try:
            profiles = self._ui_profile["workflows"]
            values = []
            for item in self._query_service.list_workflow_read_models():
                projected = _json_copy(item)
                profile = profiles.get(_workflow_profile_key(item.identity))
                if profile is not None:
                    projected["ui"] = _json_copy(profile["list"])
                values.append(projected)
            return self._success(values)
        except Exception:
            return self._error(
                ReadAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "UI workflow list could not be completed safely",
                "list_ui_workflows",
            )

    def get_ui_workflow(
        self,
        identity: Mapping[str, Any] | WorkflowIdentityInput,
    ) -> ReadAPIResponse:
        """Return one workflow detail plus safe capability/control readiness metadata."""

        if self._ui_profile is None:
            return self._ui_not_configured("get_ui_workflow")
        try:
            workflow_identity = WorkflowIdentityInput.from_value(identity).to_domain()
        except _IdentityInputError:
            return self._error(
                ReadAPIErrorCode.INVALID_IDENTITY,
                "Workflow identity is invalid",
                "get_ui_workflow",
            )
        try:
            model = self._query_service.get_workflow_read_model(workflow_identity)
            projected = _json_copy(model)
            profile = self._ui_profile["workflows"].get(_workflow_profile_key(model.identity))
            if profile is not None:
                projected["ui"] = _json_copy(profile["detail"])
            return self._success(projected)
        except UnifiedWorkflowNotFoundError:
            return self._error(
                ReadAPIErrorCode.NOT_FOUND,
                "Workflow was not found",
                "get_ui_workflow",
            )
        except Exception:
            return self._error(
                ReadAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "UI workflow detail could not be completed safely",
                "get_ui_workflow",
            )

    def list_ui_results(self) -> ReadAPIResponse:
        """Return safe historical projections with result-action readiness."""

        if self._ui_profile is None:
            return self._ui_not_configured("list_ui_results")
        try:
            action = self._ui_profile["result_action"]
            values = []
            for item in self._query_service.list_historical_results():
                projected = _json_copy(item)
                projected["result_action"] = _json_copy(action)
                values.append(projected)
            return self._success(values)
        except Exception:
            return self._error(
                ReadAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "UI result list could not be completed safely",
                "list_ui_results",
            )

    def get_product_backend(self) -> ReadAPIResponse:
        if self._product_profile is None:
            return self._ui_not_configured("get_product_backend")
        return self._success(self._product_profile["backend"])

    def list_product_workflows(self) -> ReadAPIResponse:
        if self._product_profile is None:
            return self._ui_not_configured("list_product_workflows")
        return self._success(self._product_profile["workflows"])

    def list_ai_callable_capabilities(self) -> ReadAPIResponse:
        if self._product_profile is None:
            return self._ui_not_configured("list_ai_callable_capabilities")
        return self._success(self._product_profile["ai_capabilities"])

    def get_production_readiness_matrix(self) -> ReadAPIResponse:
        if self._product_profile is None:
            return self._ui_not_configured("get_production_readiness_matrix")
        return self._success(self._product_profile["readiness_matrix"])

    def get_ui_reference_payload(self) -> ReadAPIResponse:
        if self._product_profile is None:
            return self._ui_not_configured("get_ui_reference_payload")
        return self._success(self._product_profile["ui_reference"])

    def get_tiangong_run_preparation(self) -> ReadAPIResponse:
        if self._product_profile is None:
            return self._ui_not_configured("get_tiangong_run_preparation")
        return self._success(self._product_profile["tiangong_run_prep"])

    def get_tiangong_auth_metadata(self) -> ReadAPIResponse:
        """Return the Secret-free authenticated Metadata product projection."""
        if self._product_profile is None:
            return self._ui_not_configured("get_tiangong_auth_metadata")
        return self._success(self._product_profile["tiangong_auth_metadata"])

    def get_tiangong_metadata_reconciliation(self) -> ReadAPIResponse:
        """Return frozen real-Metadata reconciliation and update readiness."""
        if self._product_profile is None:
            return self._ui_not_configured("get_tiangong_metadata_reconciliation")
        return self._success(self._product_profile["tiangong_metadata_reconciliation"])

    def get_tiangong_production_update(self) -> ReadAPIResponse:
        """Return the production-update candidate and its remaining gate."""
        if self._product_profile is None:
            return self._ui_not_configured("get_tiangong_production_update")
        return self._success(self._product_profile["tiangong_production_update"])

    def _ui_not_configured(self, operation: str) -> ReadAPIErrorEnvelope:
        return self._error(
            ReadAPIErrorCode.INVALID_QUERY,
            "UI integration profile is not configured",
            operation,
        )

    def _query_unconfigured(self, operation: str) -> ReadAPIErrorEnvelope:
        return self._error(
            ReadAPIErrorCode.UNRESOLVED_IDENTITY,
            "Confirmed Provider identity is required for normalized Workflow queries",
            operation,
        )

    def _invoke(self, operation: str, callback: Any) -> ReadAPIResponse:
        if self._query_service is None:
            return self._error(
                ReadAPIErrorCode.INVALID_QUERY,
                "Provider identity configuration is required for this operation",
                operation,
            )
        try:
            return self._success(callback())
        except Exception:
            return self._error(
                ReadAPIErrorCode.INTERNAL_INVARIANT_VIOLATION,
                "Read operation could not be completed safely",
                operation,
            )

    @staticmethod
    def _success(data: Any) -> ReadAPISuccessEnvelope:
        return {
            "api_version": AUTOMATION_READ_API_VERSION,
            "ok": True,
            "data": _json_copy(data),
        }

    @staticmethod
    def _error(
        code: ReadAPIErrorCode,
        message: str,
        operation: str,
    ) -> ReadAPIErrorEnvelope:
        return {
            "api_version": AUTOMATION_READ_API_VERSION,
            "ok": False,
            "error": {
                "code": code.value,
                "message": message,
                "details": {"operation": operation},
            },
        }

    @staticmethod
    def _optional_text(value: Any, field_name: str, *, max_length: int) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise _QueryInputError(f"{field_name} must be a string")
        normalized = value.strip()
        if not normalized or len(normalized) > max_length:
            raise _QueryInputError(f"{field_name} is invalid")
        if any(ord(character) < 32 for character in normalized):
            raise _QueryInputError(f"{field_name} is invalid")
        return normalized

    @classmethod
    def _optional_choice(
        cls,
        value: Any,
        field_name: str,
        choices: set[str],
    ) -> str | None:
        normalized = cls._optional_text(value, field_name, max_length=64)
        if normalized is not None and normalized not in choices:
            raise _QueryInputError(f"{field_name} is invalid")
        return normalized


def build_read_api(
    query_service: UnifiedAutomationQueryService,
) -> AutomationReadAPI:
    """Build the facade from an explicitly prepared in-memory query service."""

    return AutomationReadAPI(query_service)


def _build_ui_read_api(
    query_service: UnifiedAutomationQueryService,
    ui_profile: Mapping[str, Any],
    product_profile: Mapping[str, Any] | None = None,
) -> AutomationReadAPI:
    """Internal composition hook; UI metadata is not caller-injectable public input."""

    copied = _json_copy(ui_profile)
    if not isinstance(copied, dict):
        raise TypeError("ui_profile must serialize to an object")
    product = _json_copy(product_profile) if product_profile is not None else None
    if product is not None and not isinstance(product, dict):
        raise TypeError("product_profile must serialize to an object")
    return AutomationReadAPI(
        query_service,
        _ui_profile=_UIProfile(copied),
        _product_profile=_ProductProfile(product) if product is not None else None,
    )


def _build_product_only_read_api(product_profile: Mapping[str, Any]) -> AutomationReadAPI:
    product = _json_copy(product_profile)
    if not isinstance(product, dict):
        raise TypeError("product_profile must serialize to an object")
    return AutomationReadAPI(None, _product_profile=_ProductProfile(product))


def _workflow_profile_key(identity: Any) -> str:
    """Bind UI metadata to the full provider-scoped Workflow identity."""

    return json.dumps(
        [
            identity.provider_kind,
            identity.provider_instance_id,
            identity.external_workflow_id,
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def serialize_read_api_response(response: ReadAPIResponse) -> str:
    """Serialize a response as deterministic compact JSON."""

    copied = _json_copy(response)
    return json.dumps(
        copied,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _json_copy(value: Any) -> Any:
    primitive = result_to_primitive(value)
    encoded = json.dumps(
        primitive,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return json.loads(encoded)


__all__ = [
    "AUTOMATION_READ_API_VERSION",
    "AutomationReadAPI",
    "ExecutionIdentityInput",
    "ReadAPIErrorBody",
    "ReadAPIErrorCode",
    "ReadAPIErrorEnvelope",
    "ReadAPIResponse",
    "ReadAPISuccessEnvelope",
    "WorkflowIdentityInput",
    "build_read_api",
    "serialize_read_api_response",
]
