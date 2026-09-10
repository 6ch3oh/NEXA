from __future__ import annotations

import json
from dataclasses import fields, is_dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any


def to_json_safe(value: Any) -> Any:
    """Convert supported immutable read models to deterministic JSON-safe data."""

    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        raise TypeError("float is not supported by the consumption serializer")
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Decimal must be finite")
        return format(value, "f")
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datetime must be timezone-aware")
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: to_json_safe(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, (tuple, list)):
        return [to_json_safe(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("JSON object keys must be strings")
        return {key: to_json_safe(value[key]) for key in sorted(value)}
    raise TypeError(f"unsupported consumption value: {type(value).__name__}")


def to_canonical_json(value: Any) -> str:
    return json.dumps(
        to_json_safe(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
