from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from types import MappingProxyType
from typing import Any, Mapping

from src.domain.security import contains_plaintext_secret


DEEPSEEK_REAL_PILOT_PREFLIGHT_STATUS = "DEEPSEEK_REAL_PILOT_PREFLIGHT_READY"
DEEPSEEK_PROVIDER_ID = "deepseek"
DEEPSEEK_BALANCE_ENDPOINT = "https://api.deepseek.com/user/balance"
DEEPSEEK_CHAT_ENDPOINT = "https://api.deepseek.com/chat/completions"
DEEPSEEK_MODEL = "deepseek-v4-flash"
DEEPSEEK_PLANNED_REQUESTS = 2
DEEPSEEK_RETRY_COUNT = 0
DEEPSEEK_TIMEOUT_SECONDS = 30
DEEPSEEK_MAX_OUTPUT_TOKENS = 1
DEEPSEEK_MAXIMUM_ESTIMATED_COST = "UNKNOWN"

_CHAT_PAYLOAD = {
    "model": DEEPSEEK_MODEL,
    "messages": [{"role": "user", "content": "ping"}],
    "thinking": {"type": "disabled"},
    "max_tokens": DEEPSEEK_MAX_OUTPUT_TOKENS,
    "stream": False,
}


@dataclass(frozen=True)
class DeepSeekCredentialAvailability:
    configured: bool
    safe_mechanism_available: bool
    runtime_access_ready: bool
    mechanism_name: str | None = None

    def __post_init__(self) -> None:
        for name in ("configured", "safe_mechanism_available", "runtime_access_ready"):
            if not isinstance(getattr(self, name), bool):
                raise ValueError(f"{name} must be a bool")
        if self.mechanism_name is not None:
            _safe_text(self.mechanism_name, "mechanism_name")
        if (self.safe_mechanism_available or self.runtime_access_ready) and not self.configured:
            raise ValueError("unconfigured credential cannot be runtime ready")
        if self.runtime_access_ready and not self.safe_mechanism_available:
            raise ValueError("runtime access requires a safe credential mechanism")


@dataclass(frozen=True)
class DeepSeekRequestSpec:
    sequence: int
    purpose: str
    method: str
    endpoint: str
    timeout_seconds: int
    retry_count: int
    payload: Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.sequence not in (1, 2):
            raise ValueError("DeepSeek request sequence must be 1 or 2")
        if self.timeout_seconds != DEEPSEEK_TIMEOUT_SECONDS or self.retry_count != 0:
            raise ValueError("DeepSeek request safety budget changed")
        if self.method not in ("GET", "POST"):
            raise ValueError("DeepSeek request method is invalid")
        _safe_text(self.purpose, "purpose")


@dataclass(frozen=True)
class DeepSeekPilotPlan:
    provider_id: str
    auth_mechanism: str
    requests: tuple[DeepSeekRequestSpec, ...]
    planned_real_requests: int
    retry_count: int
    maximum_output_tokens: int
    maximum_estimated_cost: str
    credential: DeepSeekCredentialAvailability
    secret_logging_enabled: bool = False

    def __post_init__(self) -> None:
        if self.provider_id != DEEPSEEK_PROVIDER_ID:
            raise ValueError("DeepSeek provider identity changed")
        if self.auth_mechanism != "HTTP Bearer":
            raise ValueError("DeepSeek auth mechanism changed")
        if self.planned_real_requests != 2 or len(self.requests) != 2:
            raise ValueError("DeepSeek pilot requires exactly two planned requests")
        if self.retry_count != 0 or self.maximum_output_tokens != 1:
            raise ValueError("DeepSeek pilot request budget changed")
        if self.maximum_estimated_cost != "UNKNOWN":
            raise ValueError("DeepSeek cost ceiling must remain explicit UNKNOWN")
        if self.secret_logging_enabled:
            raise ValueError("secret logging must remain disabled")
        _validate_request_specs(self.requests)


@dataclass(frozen=True)
class DeepSeekBalanceInfo:
    currency: str
    total_balance: Decimal
    granted_balance: Decimal
    topped_up_balance: Decimal


@dataclass(frozen=True)
class DeepSeekBalanceResponse:
    is_available: bool
    balance_infos: tuple[DeepSeekBalanceInfo, ...]


@dataclass(frozen=True)
class DeepSeekUsageResponse:
    response_id: str
    model: str
    finish_reason: str
    prompt_tokens: int
    prompt_cache_hit_tokens: int
    prompt_cache_miss_tokens: int
    completion_tokens: int
    total_tokens: int


def default_deepseek_pilot_plan() -> DeepSeekPilotPlan:
    """Return the frozen plan without inspecting any runtime credential."""

    credential = DeepSeekCredentialAvailability(False, False, False)
    return DeepSeekPilotPlan(
        provider_id=DEEPSEEK_PROVIDER_ID,
        auth_mechanism="HTTP Bearer",
        requests=(
            DeepSeekRequestSpec(
                1, "official balance acquisition", "GET",
                DEEPSEEK_BALANCE_ENDPOINT, 30, 0,
            ),
            DeepSeekRequestSpec(
                2, "minimal usage acquisition", "POST",
                DEEPSEEK_CHAT_ENDPOINT, 30, 0,
                MappingProxyType(_CHAT_PAYLOAD),
            ),
        ),
        planned_real_requests=2,
        retry_count=0,
        maximum_output_tokens=1,
        maximum_estimated_cost="UNKNOWN",
        credential=credential,
    )


def validate_balance_response(payload: Mapping[str, Any]) -> DeepSeekBalanceResponse:
    data = _mapping(payload, {"is_available", "balance_infos"}, "balance response")
    if not isinstance(data.get("is_available"), bool):
        raise ValueError("DeepSeek is_available must be a bool")
    infos = data.get("balance_infos")
    if not isinstance(infos, list) or not infos:
        raise ValueError("DeepSeek balance_infos must be a non-empty list")
    rows = []
    for raw in infos:
        row = _mapping(raw, {
            "currency", "total_balance", "granted_balance", "topped_up_balance",
        }, "balance info")
        currency = row.get("currency")
        if currency not in ("CNY", "USD"):
            raise ValueError("DeepSeek balance currency is invalid")
        rows.append(DeepSeekBalanceInfo(
            currency,
            _non_negative_decimal(row.get("total_balance"), "total_balance"),
            _non_negative_decimal(row.get("granted_balance"), "granted_balance"),
            _non_negative_decimal(row.get("topped_up_balance"), "topped_up_balance"),
        ))
    return DeepSeekBalanceResponse(data["is_available"], tuple(rows))


def validate_chat_response(payload: Mapping[str, Any]) -> DeepSeekUsageResponse:
    data = _mapping(payload, {
        "id", "choices", "created", "model", "object", "system_fingerprint", "usage",
    }, "chat response")
    if data.get("model") != DEEPSEEK_MODEL or data.get("object") != "chat.completion":
        raise ValueError("DeepSeek chat identity does not match the pilot")
    response_id = data.get("id")
    _safe_text(response_id, "response id")
    choices = data.get("choices")
    if not isinstance(choices, list) or len(choices) != 1:
        raise ValueError("DeepSeek pilot requires exactly one choice")
    choice = _mapping(choices[0], {"finish_reason", "index", "message", "logprobs"}, "choice")
    finish_reason = choice.get("finish_reason")
    if finish_reason not in ("stop", "length"):
        raise ValueError("DeepSeek finish_reason is not accepted for the pilot")
    message = _mapping(
        choice.get("message"),
        {"role", "content", "reasoning_content", "tool_calls"},
        "message",
    )
    if message.get("role") != "assistant":
        raise ValueError("DeepSeek chat message role is invalid")
    usage = _mapping(data.get("usage"), {
        "completion_tokens", "prompt_tokens", "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens", "total_tokens", "completion_tokens_details",
    }, "usage")
    values = {name: _non_negative_int(usage.get(name), name) for name in (
        "completion_tokens", "prompt_tokens", "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens", "total_tokens",
    )}
    details = usage.get("completion_tokens_details")
    if details is not None:
        detail_data = _mapping(details, {"reasoning_tokens"}, "completion token details")
        _non_negative_int(detail_data.get("reasoning_tokens"), "reasoning_tokens")
    if values["completion_tokens"] > 1:
        raise ValueError("DeepSeek completion exceeded the preflight token ceiling")
    if values["prompt_tokens"] != values["prompt_cache_hit_tokens"] + values["prompt_cache_miss_tokens"]:
        raise ValueError("DeepSeek prompt token breakdown is inconsistent")
    if values["total_tokens"] != values["prompt_tokens"] + values["completion_tokens"]:
        raise ValueError("DeepSeek total token count is inconsistent")
    return DeepSeekUsageResponse(
        response_id, data["model"], finish_reason,
        values["prompt_tokens"], values["prompt_cache_hit_tokens"],
        values["prompt_cache_miss_tokens"], values["completion_tokens"],
        values["total_tokens"],
    )


def validate_future_authorization_gate(
    plan: DeepSeekPilotPlan, *, user_explicitly_authorized: bool,
    accepts_unknown_maximum_cost: bool,
) -> None:
    if not isinstance(plan, DeepSeekPilotPlan):
        raise TypeError("plan must be a DeepSeekPilotPlan")
    if not user_explicitly_authorized or not accepts_unknown_maximum_cost:
        raise PermissionError("explicit pilot authorization and UNKNOWN cost acceptance are required")
    if not (
        plan.credential.configured
        and plan.credential.safe_mechanism_available
        and plan.credential.runtime_access_ready
    ):
        raise PermissionError("safe runtime credential availability is not proven")
    _validate_request_specs(plan.requests)


def _validate_request_specs(requests: tuple[DeepSeekRequestSpec, ...]) -> None:
    first, second = requests
    if (first.sequence, first.method, first.endpoint, first.payload) != (
        1, "GET", DEEPSEEK_BALANCE_ENDPOINT, None
    ):
        raise ValueError("DeepSeek balance request changed")
    if (second.sequence, second.method, second.endpoint) != (
        2, "POST", DEEPSEEK_CHAT_ENDPOINT
    ) or dict(second.payload or {}) != _CHAT_PAYLOAD:
        raise ValueError("DeepSeek chat request changed")


def _mapping(value: Any, allowed: set[str], name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"DeepSeek {name} must be an object")
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"DeepSeek {name} contains unknown fields: {sorted(unknown)}")
    _reject_secret_shape(value)
    return value


def _reject_secret_shape(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            lowered = str(key).lower()
            if any(marker in lowered for marker in (
                "key", "secret", "cookie", "authorization", "credential",
            )):
                raise ValueError("DeepSeek response contains credential-shaped field")
            _reject_secret_shape(item)
    elif isinstance(value, list):
        for item in value:
            _reject_secret_shape(item)
    elif isinstance(value, str) and contains_plaintext_secret(value):
        raise ValueError("DeepSeek response contains secret-shaped text")


def _safe_text(value: Any, name: str) -> None:
    if not isinstance(value, str) or not value.strip() or contains_plaintext_secret(value):
        raise ValueError(f"DeepSeek {name} is invalid")


def _non_negative_decimal(value: Any, name: str) -> Decimal:
    try:
        result = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"DeepSeek {name} is invalid") from exc
    if not result.is_finite() or result < 0:
        raise ValueError(f"DeepSeek {name} must be finite and non-negative")
    return result


def _non_negative_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"DeepSeek {name} must be a non-negative integer")
    return value
