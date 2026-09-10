from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from src.contracts import (
    BalanceSnapshot,
    BalanceUnit,
    CostKind,
    CostRecord,
    PriceDimension,
    PricingSnapshot,
    PricingUnit,
    Provider,
    ProviderCategory,
    ProviderStatus,
    SourceTag,
    SourceType,
    Token,
    TokenStatus,
)
from src.domain.security import contains_plaintext_secret

LEGACY_LOCATION = "legacy:token-monitor"

# Evidence-backed legacy enums from src/shared/limits.js.
LEGACY_PROVIDER_IDS = frozenset({
    "claude", "codex", "cursor", "antigravity", "opencode", "openrouter",
    "deepseek", "minimax", "mimo", "grok", "copilot", "kiro", "zai",
    "volcengine", "qoder", "zaiteam", "kimi", "ollama", "thirdparty",
})
LEGACY_STATUSES = frozenset({
    "ok", "disabled", "notConfigured", "unauthorized", "rateLimited",
    "sourceRateLimited", "unavailable", "error",
})
LEGACY_SOURCES = frozenset({"oauth", "cli", "web", "rpc", "local", "api"})

# Token/cost keys from src/shared/usage.js.
TOKEN_KEYS = (
    "totalTokens", "total_tokens", "totalTokenCount", "total_token_count",
    "tokens", "tokenCount", "token_count",
)
TOKEN_COMPONENT_KEYS = (
    "input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens",
    "output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens",
    "cacheRead", "cacheReadTokens", "cache_read_tokens",
    "cacheWrite", "cacheWriteTokens", "cache_write_tokens",
    "cachedTokens", "cached_tokens",
    "cacheCreationInputTokens", "cache_creation_input_tokens",
    "cacheReadInputTokens", "cache_read_input_tokens",
    "totalInput", "totalOutput", "totalCacheRead", "totalCacheWrite",
)
# Only USD-explicit cost fields may produce a CostRecord. The committed baseline
# proves costUsd (monetary USD by name) but does not prove that generic
# cost/totalCost carry monetary, currency, or temporal meaning, so those fail
# closed instead of being converted.
COST_KEYS = ("costUsd", "cost_usd", "costUSD")

_SHA256_FINGERPRINT_RE = re.compile(r"^[0-9a-fA-F]{64}$")

# Raw credential field names that must never enter NEXA contracts. Source of
# truth: credentialStore.js CREDENTIAL_SETTING_PATHS plus generic secret names.
_SECRET_FIELD_NAMES = frozenset({
    "hubhostsecret", "secret", "claudewebcookie", "opencodecookie",
    "opencodeprofiles", "openrouterprofiles", "deepseekapikey", "minimaxapikey",
    "copilotapitoken", "zaiapikey", "zaiteamapikey", "zaiteamorganizationid",
    "zaiteamprojectid", "volcengineaccesskeyid", "volcenginesecretaccesskey",
    "qodercookie", "kimiapikey", "kimiwebaccesstoken", "ollamacookie",
    "notiontoken", "thirdpartyprofiles",
    "apikey", "api_key", "api_token", "apitoken", "accesstoken", "access_token",
    "clientsecret", "client_secret", "cookie", "cookies", "authorization",
    "auth", "password", "passwd", "credential", "credentials", "webcookie",
    "web_cookie", "cookieheader", "cookie_header", "sessionkey", "servicetoken",
    "refreshtoken", "refresh_token", "jwt", "bearer", "privatekey",
    "private_key", "secretkey", "secret_key", "token", "hostsecret", "host_secret",
})

_STATUS_TO_PROVIDER = {
    "ok": ProviderStatus.ACTIVE,
    "rateLimited": ProviderStatus.ACTIVE,
    "sourceRateLimited": ProviderStatus.ACTIVE,
    "disabled": ProviderStatus.DISABLED,
    "notConfigured": ProviderStatus.INACTIVE,
    "unauthorized": ProviderStatus.INACTIVE,
    "unavailable": ProviderStatus.INACTIVE,
    "error": ProviderStatus.INACTIVE,
}

_STATUS_TO_TOKEN = {
    "ok": TokenStatus.ACTIVE,
    "rateLimited": TokenStatus.ACTIVE,
    "sourceRateLimited": TokenStatus.ACTIVE,
    "unavailable": TokenStatus.ACTIVE,
    "error": TokenStatus.ACTIVE,
    "unauthorized": TokenStatus.REVOKED,
    "disabled": TokenStatus.SUSPENDED,
}

_CURRENCY_TO_UNIT = {
    "usd": BalanceUnit.USD,
    "cny": BalanceUnit.CNY,
    "eur": BalanceUnit.EUR,
    "credits": BalanceUnit.CREDITS,
    "credit": BalanceUnit.CREDITS,
    "quota": BalanceUnit.QUOTA,
    "token_quota": BalanceUnit.TOKEN_QUOTA,
    "points": BalanceUnit.POINTS,
}


# --------------------------------------------------------------------------- #
# Secret rejection helpers. Secret ingestion is out of scope: raw credential
# fields and plaintext-secret values are rejected predictably before any
# conversion happens.
# --------------------------------------------------------------------------- #
def _find_secret_fields(data: Any, prefix: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(data, dict):
        for key, value in data.items():
            lowered = str(key).strip().lower()
            if lowered in _SECRET_FIELD_NAMES:
                found.append(f"{prefix}{key}")
            found.extend(_find_secret_fields(value, prefix=f"{prefix}{key}."))
    elif isinstance(data, (list, tuple)):
        for index, item in enumerate(data):
            found.extend(_find_secret_fields(item, prefix=f"{prefix}[{index}]."))
    return found


def _reject_plaintext_values(data: Any) -> None:
    if isinstance(data, dict):
        for value in data.values():
            _reject_plaintext_values(value)
    elif isinstance(data, (list, tuple)):
        for item in data:
            _reject_plaintext_values(item)
    elif isinstance(data, str) and contains_plaintext_secret(data):
        raise ValueError("legacy adapter rejects a plaintext secret value")


def _reject_raw_secrets(data: Any) -> None:
    found = _find_secret_fields(data)
    if found:
        shown = ", ".join(sorted(set(found))[:8])
        raise ValueError(f"legacy adapter rejects raw secret field(s): {shown}")
    _reject_plaintext_values(data)


def _ensure_not_plaintext(value: str, field: str) -> None:
    if contains_plaintext_secret(value):
        raise ValueError(f"{field} must not carry a plaintext secret")


# --------------------------------------------------------------------------- #
# Low-level value coercion (mirrors legacy asNumber/numberOrNull semantics).
# --------------------------------------------------------------------------- #
def _as_number(value: Any) -> float:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return float(value) if _finite(value) else 0
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0
        try:
            return float(text.replace(",", "").replace("$", "").replace("%", ""))
        except ValueError:
            return 0
    return 0


def _finite(value: Any) -> bool:
    try:
        import math

        return math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


def _optional_number(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if not _finite(value):
            return None
        return Decimal(str(value))
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return Decimal(text)
        except InvalidOperation:
            return None
    return None


def _optional_nonneg(value: Any) -> Decimal | None:
    number = _optional_number(value)
    if number is None or number < 0:
        return None
    return number


def _optional_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _first_number(obj: Any, keys: tuple[str, ...]) -> float:
    if not isinstance(obj, dict):
        return 0
    for key in keys:
        if key in obj:
            value = _as_number(obj[key])
            if value != 0:
                return value
    return 0


def _parse_iso(value: Any) -> datetime | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if not _finite(value):
            return None
        milliseconds = value * 1000 if value < 20_000_000_000 else value
        try:
            return datetime.fromtimestamp(milliseconds / 1000, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    return None


def _normalize_provider_id(value: Any) -> str | None:
    raw = str(value or "").strip().lower()
    return raw if raw in LEGACY_PROVIDER_IDS else None


def _require_record(record: Any) -> None:
    if not isinstance(record, dict):
        raise ValueError("legacy record must be a dict")


def _provider_identity(record: dict[str, Any], id_prefix: str) -> tuple[str, str, str]:
    provider_code = _normalize_provider_id(record.get("provider"))
    if provider_code is None:
        raise ValueError("legacy provider record has invalid or missing 'provider'")
    account_key = _normalize_account_fingerprint(record.get("accountKey"))
    if account_key:
        provider_id = f"{id_prefix}:{provider_code}:{account_key}"
    else:
        provider_id = f"{id_prefix}:{provider_code}"
    return provider_code, account_key, provider_id


def _normalize_account_fingerprint(value: Any) -> str:
    """Return a canonical SHA-256 identity or fail closed on raw account data."""
    raw = _optional_str(value)
    if not raw:
        return ""
    digest = raw[7:] if raw.lower().startswith("sha256:") else raw
    if not _SHA256_FINGERPRINT_RE.fullmatch(digest):
        raise ValueError("accountKey must be a validated SHA-256 fingerprint")
    return f"sha256:{digest.lower()}"


# --------------------------------------------------------------------------- #
# SourceTag: provenance is generated by the adapter from conversion facts, not
# a unified legacy provenance contract. SourceType is always LEGACY_IMPORT.
# --------------------------------------------------------------------------- #
def legacy_source_tag(
    record: dict[str, Any] | None = None,
    *,
    location: str | None = None,
    source: str | None = None,
    source_detail: str | None = None,
    captured_at: datetime | None = None,
) -> SourceTag:
    if isinstance(record, dict):
        _reject_raw_secrets(record)
        provider = _optional_str(record.get("provider"))
        if source is None:
            source = _optional_str(record.get("source"))
        if source_detail is None:
            source_detail = _optional_str(record.get("sourceDetail") or record.get("source_detail"))
        if captured_at is None:
            captured_at = _parse_iso(record.get("updatedAt"))
    else:
        provider = None

    parts = [LEGACY_LOCATION]
    if location:
        parts.append(location)
    if provider:
        parts.append(f"provider={provider}")
    if source:
        parts.append(f"source={source}")
    if source_detail:
        parts.append(f"sourceDetail={source_detail}")
    return SourceTag(
        source_type=SourceType.LEGACY_IMPORT,
        source_reference=":".join(parts),
        captured_at=captured_at,
    )


# --------------------------------------------------------------------------- #
# Legacy normalized provider -> Provider.
# --------------------------------------------------------------------------- #
def provider_from_legacy(
    record: dict[str, Any],
    *,
    category: ProviderCategory | None = None,
    id_prefix: str = "legacy",
) -> Provider:
    _reject_raw_secrets(record)
    _require_record(record)
    provider_code, account_key, provider_id = _provider_identity(record, id_prefix)
    display_name = _optional_str(record.get("accountLabel")) or provider_code
    resolved_category = category if category is not None else ProviderCategory.OTHER
    if not isinstance(resolved_category, ProviderCategory):
        raise ValueError("category must be a ProviderCategory")
    return Provider(
        id=provider_id,
        key=provider_code,
        display_name=display_name,
        category=resolved_category,
        status=_provider_status(record.get("status")),
        source=legacy_source_tag(record, location="src/shared/limits.js:normalizeLimitProvider"),
    )


def _provider_status(value: Any) -> ProviderStatus:
    raw = str(value or "").strip()
    if raw not in _STATUS_TO_PROVIDER:
        raise ValueError(f"invalid legacy status: {value!r}")
    return _STATUS_TO_PROVIDER[raw]


# --------------------------------------------------------------------------- #
# Safe credential/account metadata -> Token. No raw secret is accepted.
# --------------------------------------------------------------------------- #
def token_from_legacy(
    record: dict[str, Any],
    *,
    configured: bool | None = None,
    provider_id: str | None = None,
    id_prefix: str = "legacy",
) -> Token | None:
    _reject_raw_secrets(record)
    _require_record(record)
    provider_code, account_key, derived_provider_id = _provider_identity(record, id_prefix)
    effective_provider_id = provider_id if provider_id else derived_provider_id

    if configured is None:
        if "configured" in record:
            configured = bool(record.get("configured"))
        else:
            configured = _configured_from_status(record.get("status")) and bool(account_key)
    if not configured:
        return None

    masked_identifier = _optional_str(record.get("masked_identifier"))
    if not masked_identifier:
        if not account_key:
            return None
        _ensure_not_plaintext(account_key, "accountKey")
        masked_identifier = f"fp:{account_key}"
    _ensure_not_plaintext(masked_identifier, "masked_identifier")
    if "*" not in masked_identifier and not masked_identifier.startswith("fp:"):
        raise ValueError("masked_identifier must be masked or fingerprinted")

    label = (
        _optional_str(record.get("accountLabel"))
        or _optional_str(record.get("planLabel"))
        or provider_code
    )
    token_id = f"{id_prefix}:token:{provider_code}:{account_key}" if account_key else f"{id_prefix}:token:{provider_code}:{masked_identifier}"
    secret_ref = _token_secret_ref(record)

    return Token(
        id=token_id,
        provider_id=effective_provider_id,
        label=label,
        status=_token_status(record.get("status")),
        masked_identifier=masked_identifier,
        source=legacy_source_tag(record, location="src/shared/limits.js:normalizeLimitProvider"),
        secret_ref=secret_ref,
    )


def _configured_from_status(value: Any) -> bool:
    raw = str(value or "").strip()
    if raw not in LEGACY_STATUSES:
        raise ValueError(f"invalid legacy status: {value!r}")
    return raw != "notConfigured" and raw != "disabled"


def _token_status(value: Any) -> TokenStatus:
    raw = str(value or "").strip()
    if raw not in _STATUS_TO_TOKEN:
        raise ValueError(f"legacy status {value!r} cannot map to a TokenStatus")
    return _STATUS_TO_TOKEN[raw]


def _token_secret_ref(record: dict[str, Any]) -> str | None:
    if "secret_ref" not in record or record["secret_ref"] is None:
        return None
    candidate = str(record["secret_ref"]).strip()
    if not candidate:
        raise ValueError("secret_ref must not be empty")
    _ensure_not_plaintext(candidate, "secret_ref")
    if "=" in candidate or contains_plaintext_secret(candidate):
        raise ValueError("secret_ref must be a non-secret reference")
    return candidate


# --------------------------------------------------------------------------- #
# Normalized balance/credits-window metadata -> BalanceSnapshot.
# --------------------------------------------------------------------------- #
def balance_from_legacy(
    record: dict[str, Any],
    *,
    provider_id: str | None = None,
    token_id: str | None = None,
    id_prefix: str = "legacy",
) -> BalanceSnapshot | None:
    _reject_raw_secrets(record)
    _require_record(record)
    if provider_id is None:
        _, _, provider_id = _provider_identity(record, id_prefix)
    amount, currency = _extract_balance(record)
    if amount is None:
        return None
    return BalanceSnapshot(
        provider_id=provider_id,
        value=amount,
        unit=_balance_unit(currency),
        observed_at=_balance_observed_at(record),
        source=legacy_source_tag(record, location="src/shared/limits.js:normalizeProviderBalance"),
        token_id=token_id,
    )


def _extract_balance(record: dict[str, Any]) -> tuple[Decimal | None, str | None]:
    balance = record.get("balance")
    if isinstance(balance, dict):
        amount = _optional_number(balance.get("amount") or balance.get("accountBalance"))
        if amount is not None:
            return amount, _optional_str(balance.get("currency")) or None
    windows = record.get("windows")
    if isinstance(windows, list):
        for window in windows:
            if isinstance(window, dict) and window.get("metric") == "credits":
                remaining = _optional_number(window.get("remaining"))
                if remaining is not None:
                    return remaining, _optional_str(window.get("currency")) or None
    balance_usd = _optional_number(record.get("balanceUsd"))
    if balance_usd is not None:
        return balance_usd, "USD"
    return None, None


def _balance_unit(currency: str | None) -> BalanceUnit:
    if not currency:
        return BalanceUnit.OTHER
    return _CURRENCY_TO_UNIT.get(currency.strip().lower(), BalanceUnit.OTHER)


def _balance_observed_at(record: dict[str, Any]) -> datetime:
    for key in ("updatedAt", "checkedAt"):
        parsed = _parse_iso(record.get(key))
        if parsed is not None:
            return parsed
    balance = record.get("balance")
    if isinstance(balance, dict):
        for key in ("snapshotDate", "trackingSince", "updatedAt"):
            parsed = _parse_iso(balance.get(key))
            if parsed is not None:
                return parsed
    raise ValueError("balance conversion requires a valid legacy timestamp (updatedAt/snapshotDate/trackingSince)")


# --------------------------------------------------------------------------- #
# Legacy custom pricing rows -> one or more PricingSnapshot (per-million).
# --------------------------------------------------------------------------- #
def pricing_from_legacy(
    custom_pricing_rows: list[dict[str, Any]],
    *,
    provider_id: str,
    currency: str = "USD",
    effective_at: datetime | None = None,
    token_id: str | None = None,
    source: SourceTag | None = None,
) -> list[PricingSnapshot]:
    _reject_raw_secrets(custom_pricing_rows)
    if not isinstance(custom_pricing_rows, list):
        raise ValueError("custom_pricing_rows must be a list")
    if not provider_id or not str(provider_id).strip():
        raise ValueError("provider_id must not be empty")
    if not currency or not str(currency).strip():
        raise ValueError("currency must not be empty")
    if effective_at is None:
        effective_at = datetime.now(timezone.utc)
    if not isinstance(effective_at, datetime):
        raise ValueError("effective_at must be a datetime")
    resolved_source = source if source is not None else legacy_source_tag(
        location="src/shared/tokscaleCustomPricing.js:normalizeCustomPricingSetting"
    )

    snapshots: list[PricingSnapshot] = []
    for row in custom_pricing_rows:
        if not isinstance(row, dict):
            continue
        model = _optional_str(row.get("modelId"))
        if not model:
            continue
        input_price = _optional_nonneg(row.get("inputPerM"))
        output_price = _optional_nonneg(row.get("outputPerM"))
        cache_price = _optional_nonneg(row.get("cacheReadPerM"))
        if not ((input_price is not None and input_price > 0) or (output_price is not None and output_price > 0)):
            continue
        if input_price is not None:
            snapshots.append(_pricing_row(provider_id, model, input_price, PriceDimension.INPUT, currency, effective_at, resolved_source, token_id))
        if output_price is not None:
            snapshots.append(_pricing_row(provider_id, model, output_price, PriceDimension.OUTPUT, currency, effective_at, resolved_source, token_id))
        if cache_price is not None:
            snapshots.append(_pricing_row(provider_id, model, cache_price, PriceDimension.CACHE_READ, currency, effective_at, resolved_source, token_id))
    return snapshots


def _pricing_row(
    provider_id: str,
    model: str,
    price: Decimal,
    price_dimension: PriceDimension,
    currency: str,
    effective_at: datetime,
    source: SourceTag,
    token_id: str | None,
) -> PricingSnapshot:
    return PricingSnapshot(
        provider_id=provider_id,
        model=model,
        price_per_unit=price,
        unit=PricingUnit.PER_1M_TOKENS,
        currency=currency,
        effective_at=effective_at,
        source=source,
        token_id=token_id,
        price_dimension=price_dimension,
    )


# --------------------------------------------------------------------------- #
# Usage/cost: token quantity stays separate from monetary cost. A CostRecord is
# created only when a numeric monetary cost is explicitly supplied.
# --------------------------------------------------------------------------- #
def legacy_usage_tokens(row: dict[str, Any]) -> int:
    _reject_raw_secrets(row)
    if not isinstance(row, dict):
        return 0
    direct = _first_number(row, TOKEN_KEYS)
    if direct != 0:
        return int(round(direct))
    total = sum(_as_number(row.get(key)) for key in TOKEN_COMPONENT_KEYS)
    return int(round(total))


def cost_from_legacy(
    row: dict[str, Any],
    *,
    provider_id: str,
    occurred_at: datetime | None = None,
    token_id: str | None = None,
    model: str | None = None,
    source: SourceTag | None = None,
) -> CostRecord | None:
    _reject_raw_secrets(row)
    if not isinstance(row, dict):
        raise ValueError("usage row must be a dict")
    if not provider_id or not str(provider_id).strip():
        raise ValueError("provider_id must not be empty")
    cost_key, cost_value = _first_cost(row)
    if cost_key is None:
        return None
    occurred = occurred_at
    if occurred is None:
        occurred = _usage_timestamp(row)
    if occurred is None:
        raise ValueError("cost conversion requires a valid legacy timestamp")
    if model is None:
        model = _optional_str(row.get("model") or row.get("modelName") or row.get("model_name")) or None
    resolved_source = source if source is not None else legacy_source_tag(
        location="src/shared/usage.js:costValue"
    )
    return CostRecord(
        provider_id=provider_id,
        amount=cost_value,
        currency="USD",
        occurred_at=occurred,
        cost_basis=f"legacy:{cost_key}",
        source=resolved_source,
        token_id=token_id,
        model=model,
    )


def _first_cost(row: dict[str, Any]) -> tuple[str | None, Decimal | None]:
    for key in COST_KEYS:
        if key in row and row[key] is not None:
            number = _optional_number(row[key])
            if number is not None:
                return key, number
    return None, None


_USAGE_TIMESTAMP_KEYS = (
    "lastUsedAt", "last_used_at", "updatedAt", "updated_at",
    "lastActivityAt", "last_activity_at", "timestamp",
    "startedAt", "started_at", "createdAt", "created_at",
)


def _usage_timestamp(row: dict[str, Any]) -> datetime | None:
    for key in _USAGE_TIMESTAMP_KEYS:
        parsed = _parse_iso(row.get(key))
        if parsed is not None:
            return parsed
    return None
