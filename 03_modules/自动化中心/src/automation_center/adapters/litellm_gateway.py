"""Historical non-production HTTP proxy experiment (non-authoritative).

The current architecture uses ``litellm_core.LiteLLMCoreClient``. This module is
retained only as evidence of the superseded POC and must not be selected by new
runtime construction.
"""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from automation_center.domain.model_gateway import (
    GatewayUsage,
    ModelGatewayPolicy,
    ModelGatewayRequest,
    ModelGatewayResult,
)


class LiteLLMGatewayError(RuntimeError):
    pass


class LiteLLMGatewayClient:
    """Small boundary adapter; it contains no model-selection policy."""

    def __init__(
        self,
        base_url: str,
        *,
        provider_label: str = "gateway-unreported",
        timeout_seconds: float = 20.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.provider_label = provider_label
        self.timeout_seconds = timeout_seconds

    def execute(
        self, policy: ModelGatewayPolicy, request: ModelGatewayRequest
    ) -> ModelGatewayResult:
        route = policy.resolve(request)
        payload = {
            "model": route.litellm_alias,
            "messages": [{"role": "user", "content": request.input}],
            "stream": False,
            "user": request.customer_id,
            "metadata": {
                **dict(request.metadata),
                "request_id": request.request_id,
                "customer_id": request.customer_id,
                "user_tier": request.user_tier.value,
                "model_profile": route.profile_id,
            },
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        http_request = Request(
            f"{self.base_url}/v1/chat/completions",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        started = time.perf_counter()
        try:
            with urlopen(http_request, timeout=self.timeout_seconds) as response:
                response_payload: dict[str, Any] = json.loads(
                    response.read().decode("utf-8")
                )
                response_headers = response.headers
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise LiteLLMGatewayError(
                f"LiteLLM rejected request with HTTP {exc.code}: {detail[:500]}"
            ) from exc
        except (URLError, TimeoutError) as exc:
            raise LiteLLMGatewayError(f"LiteLLM unavailable: {exc}") from exc
        latency_ms = round((time.perf_counter() - started) * 1000)

        usage_raw = response_payload.get("usage") or {}
        actual_cost = _optional_float(
            response_headers.get("x-litellm-response-cost")
        )
        return ModelGatewayResult(
            request_id=request.request_id,
            requested_profile=route.profile_id,
            resolved_alias=route.litellm_alias,
            resolved_provider=self.provider_label,
            resolved_model=str(response_payload.get("model", "unreported")),
            status="success",
            usage=GatewayUsage(
                prompt_tokens=usage_raw.get("prompt_tokens"),
                completion_tokens=usage_raw.get("completion_tokens"),
                total_tokens=usage_raw.get("total_tokens"),
            ),
            estimated_cost=None,
            actual_cost=actual_cost,
            latency_ms=latency_ms,
            provider_request_id=response_payload.get("id"),
        )


def _optional_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None
