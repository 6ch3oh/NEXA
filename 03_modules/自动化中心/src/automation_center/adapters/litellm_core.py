"""Thin in-process adapter from the frozen NEXA contract to LiteLLM Core.

The NEXA policy resolves tier/profile/alias before this adapter is entered.
LiteLLM is imported lazily so ordinary domain tests do not require the isolated
POC runtime. This module is not a workflow engine, proxy, or model selector.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import time
from types import MappingProxyType
from typing import Any, Callable, Mapping

from automation_center.domain.model_gateway import (
    GatewayUsage,
    ModelGatewayPolicy,
    ModelGatewayPolicyError,
    ModelGatewayRequest,
    ModelGatewayResult,
)
from automation_center.domain.model_invocation import (
    CostSource,
    InvocationStatus,
    ModelErrorCategory,
    ModelInvocationRecord,
    usage_availability,
)


CompletionFunction = Callable[..., Any]


class LiteLLMCoreError(RuntimeError):
    """A bounded Core adapter/configuration failure."""


@dataclass(frozen=True, slots=True)
class LiteLLMCoreTarget:
    alias: str
    provider_model: str
    provider_label: str
    mock_response: Any | None = None


@dataclass(frozen=True, slots=True)
class NormalizedModelError:
    category: ModelErrorCategory
    code: str
    retryable: bool
    safe_message: str
    provider_status_code: int | None
    provider_error_id: str | None


class LiteLLMCoreClient:
    """Execute an already-resolved alias through the LiteLLM Python package."""

    def __init__(
        self,
        targets: Mapping[str, LiteLLMCoreTarget],
        *,
        completion_function: CompletionFunction | None = None,
    ) -> None:
        self.targets = MappingProxyType(dict(targets))
        self._completion_function = completion_function
        self.core_calls: list[dict[str, str]] = []

    @classmethod
    def from_path(
        cls,
        path: str | Path,
        *,
        completion_function: CompletionFunction | None = None,
    ) -> "LiteLLMCoreClient":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if payload.get("schema_version") != "0.1":
            raise LiteLLMCoreError("unsupported LiteLLM Core target schema")
        if payload.get("architecture_role") != "ADOPT_AS_LIBRARY / OSS CORE":
            raise LiteLLMCoreError("LiteLLM runtime must remain OSS Core library mode")
        if payload.get("fallback_enabled") is not False:
            raise LiteLLMCoreError("fallback must remain off in the non-production POC")

        targets: dict[str, LiteLLMCoreTarget] = {}
        for raw in payload.get("alias_targets", []):
            alias = _required_text(raw, "alias")
            if alias in targets:
                raise LiteLLMCoreError(f"duplicate Core alias target: {alias}")
            targets[alias] = LiteLLMCoreTarget(
                alias=alias,
                provider_model=_required_text(raw, "provider_model"),
                provider_label=_required_text(raw, "provider_label"),
                mock_response=_optional_text(raw.get("mock_response")),
            )
        return cls(targets, completion_function=completion_function)

    def execute(
        self, policy: ModelGatewayPolicy, request: ModelGatewayRequest
    ) -> ModelGatewayResult:
        # The fail-closed NEXA business policy is always evaluated before Core.
        route = policy.resolve(request)
        target = self.targets.get(route.litellm_alias)
        if target is None:
            raise ModelGatewayPolicyError(
                "LITELLM_ALIAS_NOT_CONFIGURED",
                f"no LiteLLM Core target for alias: {route.litellm_alias}",
            )

        completion = self._completion_function
        if completion is None:
            import litellm

            completion = litellm.completion

        arguments: dict[str, Any] = {
            "model": target.provider_model,
            "messages": [{"role": "user", "content": request.input}],
            "stream": False,
            "metadata": {
                **dict(request.metadata),
                "request_id": request.request_id,
                "customer_id": request.customer_id,
                "user_tier": request.user_tier.value,
                "model_profile": route.profile_id,
            },
        }
        if target.mock_response is not None:
            arguments["mock_response"] = target.mock_response

        self.core_calls.append(
            {
                "request_id": request.request_id,
                "alias": route.litellm_alias,
                "provider_model": target.provider_model,
                "provider_label": target.provider_label,
            }
        )
        started = time.perf_counter()
        response = completion(**arguments)
        latency_ms = round((time.perf_counter() - started) * 1000)
        usage = _response_value(response, "usage") or {}

        return ModelGatewayResult(
            request_id=request.request_id,
            requested_profile=route.profile_id,
            resolved_alias=route.litellm_alias,
            resolved_provider=target.provider_label,
            resolved_model=str(_response_value(response, "model") or "unreported"),
            status="success",
            usage=GatewayUsage(
                prompt_tokens=_response_value(usage, "prompt_tokens"),
                completion_tokens=_response_value(usage, "completion_tokens"),
                total_tokens=_response_value(usage, "total_tokens"),
            ),
            estimated_cost=None,
            actual_cost=None,
            latency_ms=latency_ms,
            provider_request_id=_response_value(response, "id"),
        )

    def invoke(
        self,
        policy: ModelGatewayPolicy,
        request: ModelGatewayRequest,
        *,
        workflow_id: str | None = None,
        execution_id: str | None = None,
        artifact_ref: str | None = None,
        estimated_cost_amount: float | None = None,
        estimated_cost_currency: str | None = None,
    ) -> ModelInvocationRecord:
        """Return a stable record for one Core attempt without automatic retry."""

        route = policy.resolve(request)
        target = self.targets.get(route.litellm_alias)
        if target is None:
            raise ModelGatewayPolicyError(
                "LITELLM_ALIAS_NOT_CONFIGURED",
                f"no LiteLLM Core target for alias: {route.litellm_alias}",
            )
        completion = self._completion_function
        if completion is None:
            import litellm

            completion = litellm.completion

        arguments = _completion_arguments(request, route.profile_id, target)
        started_at = datetime.now(timezone.utc)
        started = time.perf_counter()
        self.core_calls.append(
            {
                "request_id": request.request_id,
                "alias": route.litellm_alias,
                "provider_model": target.provider_model,
                "provider_label": target.provider_label,
            }
        )
        try:
            response = completion(**arguments)
        except Exception as exc:
            completed_at = datetime.now(timezone.utc)
            error = normalize_litellm_error(exc)
            return ModelInvocationRecord(
                request_id=request.request_id,
                customer_id=request.customer_id,
                user_tier=request.user_tier,
                capability_id=request.capability_id,
                workflow_id=_safe_identifier(workflow_id),
                execution_id=_safe_identifier(execution_id),
                model_profile=route.profile_id,
                requested_alias=route.litellm_alias,
                resolved_provider=target.provider_label,
                resolved_model=target.provider_model,
                status=InvocationStatus.ERROR,
                started_at=started_at,
                completed_at=completed_at,
                latency_ms=round((time.perf_counter() - started) * 1000),
                usage_availability=usage_availability(None, None, None),
                input_tokens=None,
                output_tokens=None,
                total_tokens=None,
                cost_amount=None,
                cost_currency=None,
                cost_source=CostSource.UNAVAILABLE,
                provider_request_id=None,
                provider_response_id=None,
                result_type="MODEL_ERROR",
                result_summary="Model invocation failed safely.",
                artifact_ref=_safe_identifier(artifact_ref),
                error_category=error.category,
                error_code=error.code,
                retryable=error.retryable,
                safe_message=error.safe_message,
                provider_status_code=error.provider_status_code,
                provider_error_id=error.provider_error_id,
            )

        completed_at = datetime.now(timezone.utc)
        input_tokens, output_tokens, total_tokens = normalize_usage(response)
        cost_amount, cost_currency, cost_source = normalize_cost(
            response,
            estimated_cost_amount=estimated_cost_amount,
            estimated_cost_currency=estimated_cost_currency,
        )
        hidden = _hidden_mapping(response)
        return ModelInvocationRecord(
            request_id=request.request_id,
            customer_id=request.customer_id,
            user_tier=request.user_tier,
            capability_id=request.capability_id,
            workflow_id=_safe_identifier(workflow_id),
            execution_id=_safe_identifier(execution_id),
            model_profile=route.profile_id,
            requested_alias=route.litellm_alias,
            resolved_provider=target.provider_label,
            resolved_model=str(_response_value(response, "model") or target.provider_model),
            status=InvocationStatus.SUCCESS,
            started_at=started_at,
            completed_at=completed_at,
            latency_ms=round((time.perf_counter() - started) * 1000),
            usage_availability=usage_availability(
                input_tokens, output_tokens, total_tokens
            ),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            cost_amount=cost_amount,
            cost_currency=cost_currency,
            cost_source=cost_source,
            provider_request_id=_safe_identifier(
                _response_value(response, "provider_request_id")
                or hidden.get("provider_request_id")
            ),
            provider_response_id=_safe_identifier(_response_value(response, "id")),
            result_type="MODEL_COMPLETION",
            result_summary="Model invocation completed successfully.",
            artifact_ref=_safe_identifier(artifact_ref),
            error_category=None,
            error_code=None,
            retryable=None,
            safe_message=None,
            provider_status_code=None,
            provider_error_id=None,
        )


def _required_text(payload: Mapping[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise LiteLLMCoreError(f"{key} must be non-empty text")
    return value.strip()


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise LiteLLMCoreError("mock_response must be text or null")
    return value


def _completion_arguments(
    request: ModelGatewayRequest, profile_id: str, target: LiteLLMCoreTarget
) -> dict[str, Any]:
    arguments: dict[str, Any] = {
        "model": target.provider_model,
        "messages": [{"role": "user", "content": request.input}],
        "stream": False,
        "metadata": {
            **dict(request.metadata),
            "request_id": request.request_id,
            "customer_id": request.customer_id,
            "user_tier": request.user_tier.value,
            "model_profile": profile_id,
        },
    }
    if target.mock_response is not None:
        arguments["mock_response"] = target.mock_response
    return arguments


def normalize_usage(response: Any) -> tuple[int | None, int | None, int | None]:
    usage = _response_value(response, "usage")
    if usage is None:
        return None, None, None
    hidden = _hidden_mapping(response)
    reported = hidden.get("nexa_usage_reported_fields")
    trusted_fields = set(reported) if isinstance(reported, (list, tuple, set)) else set()
    return (
        _token_value(usage, ("prompt_tokens", "input_tokens"), trusted_fields),
        _token_value(usage, ("completion_tokens", "output_tokens"), trusted_fields),
        _token_value(usage, ("total_tokens",), trusted_fields),
    )


def normalize_cost(
    response: Any,
    *,
    estimated_cost_amount: float | None = None,
    estimated_cost_currency: str | None = None,
) -> tuple[float | None, str | None, CostSource]:
    hidden = _hidden_mapping(response)
    provider_amount = _finite_nonnegative(
        hidden.get("provider_reported_cost")
        if "provider_reported_cost" in hidden
        else _response_value(response, "provider_reported_cost")
    )
    provider_currency = _currency(hidden.get("provider_cost_currency"))
    if provider_amount is not None and provider_currency is not None:
        return provider_amount, provider_currency, CostSource.PROVIDER_REPORTED

    litellm_amount = _finite_nonnegative(
        hidden.get("response_cost")
        if "response_cost" in hidden
        else _response_value(response, "response_cost")
    )
    if litellm_amount is not None:
        return litellm_amount, "USD", CostSource.LITELLM_CALCULATED

    estimated_amount = _finite_nonnegative(estimated_cost_amount)
    estimated_currency = _currency(estimated_cost_currency)
    if estimated_amount is not None and estimated_currency is not None:
        return estimated_amount, estimated_currency, CostSource.NEXA_ESTIMATED
    return None, None, CostSource.UNAVAILABLE


def normalize_litellm_error(error: Exception) -> NormalizedModelError:
    names = {item.__name__ for item in type(error).__mro__}
    status = _provider_status(error)
    if "ContextWindowExceededError" in names:
        category = ModelErrorCategory.CONTEXT_LIMIT_EXCEEDED
    elif "ContentPolicyViolationError" in names:
        category = ModelErrorCategory.CONTENT_POLICY_BLOCKED
    elif "AuthenticationError" in names or status == 401:
        category = ModelErrorCategory.AUTHENTICATION_FAILED
    elif "PermissionDeniedError" in names or status == 403:
        category = ModelErrorCategory.PERMISSION_DENIED
    elif "RateLimitError" in names or status == 429:
        category = ModelErrorCategory.RATE_LIMITED
    elif names.intersection({"Timeout", "TimeoutError", "APITimeoutError"}) or status == 408:
        category = ModelErrorCategory.TIMEOUT
    elif "NotFoundError" in names or status == 404:
        category = ModelErrorCategory.MODEL_UNAVAILABLE
    elif names.intersection({"APIConnectionError", "ConnectionError", "OSError"}):
        category = ModelErrorCategory.NETWORK_ERROR
    elif names.intersection({"InternalServerError", "ServiceUnavailableError"}) or (
        status is not None and 500 <= status <= 599
    ):
        category = ModelErrorCategory.PROVIDER_UNAVAILABLE
    elif "LiteLLMCoreError" in names:
        category = ModelErrorCategory.INTERNAL_GATEWAY_ERROR
    elif "BadRequestError" in names or status in {400, 422}:
        category = ModelErrorCategory.INVALID_REQUEST
    else:
        category = ModelErrorCategory.UNKNOWN_PROVIDER_ERROR
    retryable = category in {
        ModelErrorCategory.RATE_LIMITED,
        ModelErrorCategory.TIMEOUT,
        ModelErrorCategory.PROVIDER_UNAVAILABLE,
        ModelErrorCategory.NETWORK_ERROR,
    }
    return NormalizedModelError(
        category=category,
        code=f"NEXA_MODEL_{category.value}",
        retryable=retryable,
        safe_message=_SAFE_MESSAGES[category],
        provider_status_code=status,
        provider_error_id=_provider_error_id(error),
    )


_SAFE_MESSAGES = {
    ModelErrorCategory.INVALID_REQUEST: "The model request was invalid.",
    ModelErrorCategory.AUTHENTICATION_FAILED: "Provider authentication failed.",
    ModelErrorCategory.PERMISSION_DENIED: "The provider denied this request.",
    ModelErrorCategory.RATE_LIMITED: "The provider rate limit was reached.",
    ModelErrorCategory.TIMEOUT: "The provider request timed out.",
    ModelErrorCategory.PROVIDER_UNAVAILABLE: "The provider is temporarily unavailable.",
    ModelErrorCategory.MODEL_UNAVAILABLE: "The requested model is unavailable.",
    ModelErrorCategory.CONTENT_POLICY_BLOCKED: "The request was blocked by content policy.",
    ModelErrorCategory.CONTEXT_LIMIT_EXCEEDED: "The model context limit was exceeded.",
    ModelErrorCategory.NETWORK_ERROR: "A network error prevented the provider request.",
    ModelErrorCategory.INTERNAL_GATEWAY_ERROR: "The model adapter failed internally.",
    ModelErrorCategory.UNKNOWN_PROVIDER_ERROR: "The provider request failed safely.",
}
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:/-]{1,256}$")
_ISO_CURRENCY = re.compile(r"^[A-Z]{3}$")


def _response_value(value: Any, key: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def _hidden_mapping(response: Any) -> Mapping[str, Any]:
    value = _response_value(response, "_hidden_params")
    return value if isinstance(value, Mapping) else {}


def _token_value(
    usage: Any, aliases: tuple[str, ...], trusted_fields: set[str]
) -> int | None:
    for alias in aliases:
        value = _response_value(usage, alias)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            return None
        # LiteLLM's Usage type may synthesize zero for a missing field. Retain
        # zero only when the raw transport boundary explicitly marked it present.
        if value == 0 and alias not in trusted_fields and not isinstance(usage, Mapping):
            return None
        return value
    return None


def _finite_nonnegative(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    if not math.isfinite(result) or result < 0:
        return None
    return result


def _currency(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.upper()
    return normalized if _ISO_CURRENCY.fullmatch(normalized) else None


def _provider_status(error: Exception) -> int | None:
    value = getattr(error, "status_code", None)
    if value is None:
        response = getattr(error, "response", None)
        value = getattr(response, "status_code", None)
    return value if isinstance(value, int) and not isinstance(value, bool) and 100 <= value <= 599 else None


def _provider_error_id(error: Exception) -> str | None:
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None)
    if isinstance(headers, Mapping):
        for key in ("x-request-id", "request-id", "x-amzn-requestid"):
            value = headers.get(key)
            safe = _safe_identifier(value)
            if safe is not None:
                return safe
    return None


def _safe_identifier(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not _SAFE_IDENTIFIER.fullmatch(value):
        return None
    return value
