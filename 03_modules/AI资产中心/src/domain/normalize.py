from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from src.contracts.balance import BalanceSnapshot, BalanceUnit

_KEY_TO_UNIT: dict[str, BalanceUnit] = {
    "balance": BalanceUnit.USD,
    "usd": BalanceUnit.USD,
    "usd_balance": BalanceUnit.USD,
    "cny": BalanceUnit.CNY,
    "credit": BalanceUnit.CREDITS,
    "credits": BalanceUnit.CREDITS,
    "remaining": BalanceUnit.CREDITS,
    "remaining_credits": BalanceUnit.CREDITS,
    "quota": BalanceUnit.QUOTA,
    "token_quota": BalanceUnit.TOKEN_QUOTA,
    "points": BalanceUnit.POINTS,
}


def normalize_balance(
    raw: dict[str, Any],
    provider_id: str,
    observed_at: datetime,
    source: Any,
    token_id: str | None = None,
) -> BalanceSnapshot:
    """Map a provider-specific raw balance object into the Provider-neutral
    BalanceSnapshot. Pure local conversion; never performs network access."""
    value, unit = _extract_value_and_unit(raw)
    return BalanceSnapshot(
        provider_id=provider_id,
        value=value,
        unit=unit,
        observed_at=observed_at,
        source=source,
        token_id=token_id,
    )


def _extract_value_and_unit(raw: dict[str, Any]) -> tuple[Decimal, BalanceUnit]:
    for key, unit in _KEY_TO_UNIT.items():
        if key in raw:
            return _to_decimal(raw[key]), unit
    raise ValueError(f"cannot normalize balance: no known key in {sorted(raw)}")


def _to_decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"invalid balance value type: {type(value).__name__}")
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"invalid numeric balance value: {value!r}") from exc
