from __future__ import annotations

from hashlib import sha256

from src.consumption.serializer import to_canonical_json

from .public_models import (
    NEXA_AI_RESOURCE_AUTHORITY_PUBLIC_CONTRACT_V0_1,
    PublicAuthorityStatus,
    PublicLimitAvailability,
)


_PUBLIC_CONTRACT_MANIFEST = {
    "name": "NEXA_AI_RESOURCE_AUTHORITY_PUBLIC_CONTRACT_V0_1",
    "version": NEXA_AI_RESOURCE_AUTHORITY_PUBLIC_CONTRACT_V0_1,
    "calling_methods": [
        "PublicAuthorityReadService.get_pricing_authority",
        "PublicAuthorityReadService.get_entitlement_authority",
        "AIAssetReadService.get_resource_overview",
        "AIAssetReadService.get_model_attribution_authority",
        "AIAssetReadService.get_task_model_authority",
    ],
    "dto_fields": {
        "PublicPricingComponent": [
            "dimension", "unit", "price_per_unit", "token_scope_id",
        ],
        "PublicPricingAuthority": [
            "schema_version", "status", "authority_id", "provider_id", "model",
            "billing_mode", "currency", "components", "effective_from",
            "authority_source_type", "official_source", "fetched_at",
            "last_verified_at", "freshness", "completeness", "warnings",
            "provenance", "token_monetary_estimate_allowed", "correlation",
        ],
        "PublicEntitlementAuthority": [
            "schema_version", "status", "entitlement_id", "provider_id",
            "token_scope_id", "plan", "model", "billing_mode", "used",
            "remaining", "resource_unit", "limits", "reset_at", "state",
            "observed_at", "fixed_subscription_fee", "fee_currency",
            "billing_cycle", "quota_cycle", "authority_source_type",
            "official_source", "fetched_at", "last_verified_at", "freshness",
            "completeness", "warnings", "provenance",
            "token_monetary_estimate_allowed", "correlation",
        ],
        "PublicEntitlementLimit": [
            "kind", "unit", "used", "remaining", "soft_limit", "hard_limit",
            "model", "availability",
        ],
        "PublicAttributionAuthority": [
            "schema_version", "direction", "billing_mode", "cost_kind",
            "cost_share_status", "currency", "rows",
        ],
        "PublicAttributionRow": [
            "provider_id", "model", "project_id", "module_id", "task_id",
            "run_id", "attribution_status", "token_numerator",
            "token_denominator", "token_share", "cost_numerator",
            "cost_denominator", "cost_share",
        ],
        "PublicCorrelation": ["project_id", "module_id", "task_id", "run_id"],
    },
    "enums": {
        "PublicAuthorityStatus": [item.value for item in PublicAuthorityStatus],
        "PublicLimitAvailability": [item.value for item in PublicLimitAvailability],
    },
    "semantics": {
        "freshness": "fresh, stale, and unknown are distinct; consumers do not infer freshness",
        "completeness": "complete, incomplete, and unknown remain explicit",
        "unknown": "unknown and missing never become numeric zero or unlimited",
        "api_monetary": "only fresh complete API usage pricing authorizes estimates",
        "subscription_monetary": "subscription and quota never authorize token-times-price actual cost",
        "attribution": "missing project/module/task/run identities are UNATTRIBUTED; shares expose numerator and denominator",
    },
}


def get_public_contract_manifest() -> dict:
    """Return a detached deterministic representation of the frozen contract."""

    import json

    return json.loads(to_canonical_json(_PUBLIC_CONTRACT_MANIFEST))


def get_public_contract_hash() -> str:
    payload = to_canonical_json(_PUBLIC_CONTRACT_MANIFEST).encode("utf-8")
    return sha256(payload).hexdigest()
