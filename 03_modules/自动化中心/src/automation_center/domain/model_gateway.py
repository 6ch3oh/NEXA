"""NEXA-owned model gateway contracts and explicit OWNER policy resolution.

This module deliberately does not select models from price, benchmarks, usage, or
external recommendations. It only resolves an explicit tier/capability binding
and an OWNER-maintained model profile.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
import json
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping


CONTRACT_VERSION = "0.1"


class UserTier(StrEnum):
    FREE = "FREE"
    BASIC = "BASIC"
    PRO = "PRO"
    PREMIUM = "PREMIUM"
    OWNER = "OWNER"


class ModelGatewayPolicyError(ValueError):
    """A fail-closed policy rejection with a stable machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class RateLimitPolicy:
    requests_per_minute: int | None = None
    tokens_per_minute: int | None = None


@dataclass(frozen=True, slots=True)
class ModelProfile:
    profile_id: str
    display_name: str
    litellm_alias: str
    enabled: bool
    user_tiers: tuple[UserTier, ...]
    fallback_profile: str | None = None
    max_cost_per_request: float | None = None
    daily_budget: float | None = None
    monthly_budget: float | None = None
    rate_limit: RateLimitPolicy | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class TierModelBinding:
    user_tier: UserTier
    workflow_capability: str
    model_profile_id: str
    enabled: bool


@dataclass(frozen=True, slots=True)
class ModelGatewayRequest:
    request_id: str
    customer_id: str
    user_tier: UserTier
    capability_id: str
    model_profile: str | None
    input: str
    metadata: Mapping[str, Any] = field(
        default_factory=lambda: MappingProxyType({})
    )


@dataclass(frozen=True, slots=True)
class GatewayUsage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class ModelGatewayResult:
    request_id: str
    requested_profile: str
    resolved_alias: str
    resolved_provider: str
    resolved_model: str
    status: str
    usage: GatewayUsage
    estimated_cost: float | None
    actual_cost: float | None
    latency_ms: int
    provider_request_id: str | None


@dataclass(frozen=True, slots=True)
class ResolvedModelRoute:
    user_tier: UserTier
    capability_id: str
    profile_id: str
    litellm_alias: str


@dataclass(frozen=True, slots=True)
class ModelGatewayPolicy:
    profiles: Mapping[str, ModelProfile]
    bindings: Mapping[tuple[UserTier, str], TierModelBinding]
    fallback_enabled: bool = False

    @classmethod
    def from_path(cls, path: str | Path) -> "ModelGatewayPolicy":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if payload.get("schema_version") != CONTRACT_VERSION:
            raise ModelGatewayPolicyError(
                "UNSUPPORTED_SCHEMA_VERSION", "model gateway policy must use schema 0.1"
            )
        if payload.get("fallback_enabled") is not False:
            raise ModelGatewayPolicyError(
                "FALLBACK_NOT_EXPLICITLY_OFF",
                "fallback must remain explicitly disabled in the non-production POC",
            )

        profiles: dict[str, ModelProfile] = {}
        for raw in payload.get("profiles", []):
            profile_id = _required_text(raw, "profile_id")
            if profile_id in profiles:
                raise ModelGatewayPolicyError(
                    "DUPLICATE_PROFILE", f"duplicate profile: {profile_id}"
                )
            tiers = tuple(_parse_tier(value) for value in raw.get("user_tiers", []))
            rate_limit_raw = raw.get("rate_limit")
            rate_limit = None
            if rate_limit_raw is not None:
                rate_limit = RateLimitPolicy(
                    requests_per_minute=rate_limit_raw.get("requests_per_minute"),
                    tokens_per_minute=rate_limit_raw.get("tokens_per_minute"),
                )
            profiles[profile_id] = ModelProfile(
                profile_id=profile_id,
                display_name=_required_text(raw, "display_name"),
                litellm_alias=_required_text(raw, "litellm_alias"),
                enabled=raw.get("enabled") is True,
                user_tiers=tiers,
                fallback_profile=raw.get("fallback_profile"),
                max_cost_per_request=raw.get("max_cost_per_request"),
                daily_budget=raw.get("daily_budget"),
                monthly_budget=raw.get("monthly_budget"),
                rate_limit=rate_limit,
                notes=str(raw.get("notes", "")),
            )

        bindings: dict[tuple[UserTier, str], TierModelBinding] = {}
        for raw in payload.get("bindings", []):
            tier = _parse_tier(raw.get("user_tier"))
            capability = _required_text(raw, "workflow_capability")
            key = (tier, capability)
            if key in bindings:
                raise ModelGatewayPolicyError(
                    "DUPLICATE_BINDING", f"duplicate binding: {tier}/{capability}"
                )
            bindings[key] = TierModelBinding(
                user_tier=tier,
                workflow_capability=capability,
                model_profile_id=_required_text(raw, "model_profile_id"),
                enabled=raw.get("enabled") is True,
            )

        return cls(
            profiles=MappingProxyType(profiles),
            bindings=MappingProxyType(bindings),
            fallback_enabled=False,
        )

    def resolve(self, request: ModelGatewayRequest) -> ResolvedModelRoute:
        binding = self.bindings.get((request.user_tier, request.capability_id))
        if binding is None or not binding.enabled:
            raise ModelGatewayPolicyError(
                "TIER_CAPABILITY_NOT_CONFIGURED",
                f"no enabled binding for {request.user_tier}/{request.capability_id}",
            )
        profile = self.profiles.get(binding.model_profile_id)
        if profile is None:
            raise ModelGatewayPolicyError(
                "PROFILE_NOT_CONFIGURED",
                f"binding references missing profile: {binding.model_profile_id}",
            )
        if request.model_profile not in (None, profile.profile_id):
            raise ModelGatewayPolicyError(
                "CALLER_PROFILE_OVERRIDE_REJECTED",
                "caller cannot override the OWNER-maintained tier binding",
            )
        if not profile.enabled:
            raise ModelGatewayPolicyError(
                "PROFILE_DISABLED", f"profile is disabled: {profile.profile_id}"
            )
        if request.user_tier not in profile.user_tiers:
            raise ModelGatewayPolicyError(
                "PROFILE_TIER_NOT_ALLOWED",
                f"profile {profile.profile_id} does not allow {request.user_tier}",
            )
        if profile.fallback_profile is not None:
            raise ModelGatewayPolicyError(
                "FALLBACK_NOT_ALLOWED_IN_POC",
                "fallback_profile must be null while fallback is disabled",
            )
        return ResolvedModelRoute(
            user_tier=request.user_tier,
            capability_id=request.capability_id,
            profile_id=profile.profile_id,
            litellm_alias=profile.litellm_alias,
        )


def _required_text(payload: Mapping[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ModelGatewayPolicyError("INVALID_POLICY_FIELD", f"{key} must be text")
    return value.strip()


def _parse_tier(value: Any) -> UserTier:
    try:
        return UserTier(str(value))
    except ValueError as exc:
        raise ModelGatewayPolicyError("UNKNOWN_USER_TIER", f"unknown user tier: {value}") from exc
