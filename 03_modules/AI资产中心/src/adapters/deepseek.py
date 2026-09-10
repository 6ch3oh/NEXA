from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

from src.contracts import (
    AuthorityMetadata, AuthoritySourceType, BalanceSnapshot, BalanceUnit,
    BillingMode, CostKind, CostRecord, EntitlementLimit, EntitlementLimitKind,
    EntitlementSnapshot, EntitlementState, FreshnessPolicy, PriceDimension,
    PricingAuthorityRecord, PricingSnapshot, PricingUnit, Provider,
    ProviderCategory, ProviderStatus, SourceTag, SourceType, Token, TokenStatus,
    UsageAttribution, UsageRecord,
)
from src.domain.security import contains_plaintext_secret


SANITIZED_DEEPSEEK_ADAPTER_STATUS = "SANITIZED_DEEPSEEK_ADAPTER_READY"
RAW_OFFICIAL_SCHEMA_STATUS = "EXTERNAL_DEPENDENCY"

_FIELDS = frozenset({
    "synthetic", "provider_id", "display_name", "captured_at", "model",
    "usage_id", "input_tokens", "output_tokens", "cache_read_tokens",
    "cache_write_tokens", "actual_cost", "currency", "balance", "project_id",
    "module_id", "task_id", "run_id", "pricing", "entitlement",
})
_PRICING_FIELDS = frozenset({"input_per_m", "output_per_m", "cache_read_per_m"})
_ENTITLEMENT_FIELDS = frozenset({"id", "plan", "state", "unit", "used", "remaining", "reset_at"})


@dataclass(frozen=True)
class DeepSeekCanonicalBatch:
    records: tuple[object, ...]
    pricing_authority: PricingAuthorityRecord
    entitlement: EntitlementSnapshot


class DeepSeekSanitizedAdapter:
    """Map caller-supplied synthetic/sanitized facts; performs no I/O."""

    def adapt(self, payload: Mapping[str, Any]) -> DeepSeekCanonicalBatch:
        data = _mapping(payload, _FIELDS, "DeepSeek payload")
        if data.get("synthetic") is not True:
            raise ValueError("local DeepSeek pilot requires synthetic=true")
        _reject_secret_shape(data)
        provider_id = _text(data, "provider_id")
        if provider_id != "deepseek":
            raise ValueError("DeepSeek adapter only accepts provider_id=deepseek")
        model = _text(data, "model"); captured = _time(data, "captured_at")
        source = SourceTag(SourceType.LOCAL_CONFIG, "synthetic:deepseek-pilot", captured)
        provider = Provider(provider_id, provider_id, _text(data, "display_name"),
                            ProviderCategory.LLM, ProviderStatus.ACTIVE, source)
        token = Token(
            "deepseek:synthetic-pilot", provider_id, "Synthetic pilot account",
            TokenStatus.ACTIVE, "fp:synthetic-deepseek-pilot", source,
        )
        attribution_values = {name: data.get(name) for name in
                              ("project_id", "module_id", "task_id", "run_id")}
        attribution = (UsageAttribution.attributed(**attribution_values)
                       if any(attribution_values.values()) else UsageAttribution.unattributed())
        usage = UsageRecord(
            _text(data, "usage_id"), provider_id,
            _integer(data, "input_tokens"), _integer(data, "output_tokens"),
            _integer(data, "cache_read_tokens"), _integer(data, "cache_write_tokens"),
            captured, source, token_id=token.id, model=model, attribution=attribution,
        )
        currency = _text(data, "currency").upper()
        if currency != "USD":
            raise ValueError("DeepSeek pilot balance/cost fixture currency must be USD")
        pricing_data = _mapping(data.get("pricing"), _PRICING_FIELDS, "pricing")
        components = tuple(PricingSnapshot(
            provider_id=provider_id, model=model,
            price_per_unit=_decimal(pricing_data, field),
            unit=PricingUnit.PER_1M_TOKENS, currency=currency,
            effective_at=captured, price_dimension=dimension, source=source,
        ) for field, dimension in (
            ("input_per_m", PriceDimension.INPUT),
            ("output_per_m", PriceDimension.OUTPUT),
            ("cache_read_per_m", PriceDimension.CACHE_READ),
        ) if field in pricing_data)
        if not components:
            raise ValueError("DeepSeek pricing must contain at least one component")
        metadata = AuthorityMetadata(
            AuthoritySourceType.LOCAL_MANUAL, None, captured, captured,
            FreshnessPolicy(None), source,
        )
        pricing_authority = PricingAuthorityRecord(
            f"deepseek-pilot-pricing:{model}:{captured.isoformat()}", provider_id,
            model, BillingMode.API_USAGE, captured, components, metadata,
        )
        entitlement_data = _mapping(data.get("entitlement"), _ENTITLEMENT_FIELDS, "entitlement")
        state = EntitlementState(_text(entitlement_data, "state"))
        reset = _optional_time(entitlement_data.get("reset_at"))
        limit = EntitlementLimit(
            EntitlementLimitKind.TOKEN, _text(entitlement_data, "unit"),
            used=_optional_decimal(entitlement_data.get("used")),
            remaining=_optional_decimal(entitlement_data.get("remaining")), model=model,
        )
        entitlement = EntitlementSnapshot(
            _text(entitlement_data, "id"), provider_id, BillingMode.API_USAGE,
            captured, state, (limit,), metadata, source,
            token_id=token.id, plan=_text(entitlement_data, "plan"),
            model=model, reset_at=reset,
        )
        balance = BalanceSnapshot(provider_id, _decimal(data, "balance"), BalanceUnit.USD,
                                  captured, source, token_id=token.id)
        actual = CostRecord(
            provider_id, _decimal(data, "actual_cost"), currency,
            captured, "synthetic:provider_reported", source, model=model,
            token_id=token.id, kind=CostKind.ACTUAL, usage_id=usage.usage_id,
        )
        records = (provider, token, balance, usage, *components, actual,
                   pricing_authority, entitlement)
        return DeepSeekCanonicalBatch(tuple(records), pricing_authority, entitlement)


def _mapping(value, allowed, name):
    if not isinstance(value, Mapping): raise ValueError(f"{name} must be a mapping")
    unknown = set(value) - allowed
    if unknown: raise ValueError(f"{name} contains unsupported fields: {', '.join(sorted(unknown))}")
    return dict(value)


def _reject_secret_shape(value):
    for key, item in value.items():
        lowered = str(key).lower()
        if any(marker in lowered for marker in ("key", "secret", "cookie", "authorization", "credential", "token_id")):
            raise ValueError("DeepSeek payload contains credential-shaped field")
        if isinstance(item, Mapping): _reject_secret_shape(item)
        elif isinstance(item, str) and contains_plaintext_secret(item):
            raise ValueError("DeepSeek payload contains secret-shaped content")


def _text(data, key):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip(): raise ValueError(f"{key} must be non-empty")
    return value.strip()


def _integer(data, key):
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0: raise ValueError(f"{key} must be >= 0")
    return value


def _decimal(data, key):
    if key not in data: raise ValueError(f"{key} is required")
    value = _optional_decimal(data[key])
    if value is None: raise ValueError(f"{key} is required")
    return value


def _optional_decimal(value):
    if value is None: return None
    if isinstance(value, bool): raise ValueError("decimal value is invalid")
    try: result = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError): raise ValueError("decimal value is invalid")
    if not result.is_finite() or result < 0: raise ValueError("decimal value must be finite and >= 0")
    return result


def _time(data, key): return _optional_time(data.get(key), required=key)


def _optional_time(value, required=None):
    if value is None:
        if required: raise ValueError(f"{required} is required")
        return None
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value
