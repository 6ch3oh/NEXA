"""Serialization helpers for nested contract values, not whole-entity blobs."""

from __future__ import annotations

import json
from datetime import datetime
from enum import Enum
from typing import Any, Mapping

from creator_ops.domain.models import LegacyReference, Provenance
from creator_ops.persistence.errors import PersistenceError, PersistenceErrorCode


def dump_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def load_datetime(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value) if value is not None else None
    except (TypeError, ValueError) as exc:
        raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Stored timestamp is invalid", cause=exc) from exc


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, tuple):
        return list(value)
    raise TypeError(f"unsupported extension value: {type(value).__name__}")


def dump_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default)
    except (TypeError, ValueError) as exc:
        raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Value cannot be serialized", cause=exc) from exc


def load_json(value: str | None, default: Any) -> Any:
    try:
        return json.loads(value) if value is not None else default
    except (TypeError, json.JSONDecodeError) as exc:
        raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Stored JSON value is invalid", cause=exc) from exc


def dump_provenance(value: Provenance) -> str:
    return dump_json({
        "source_system": value.source_system,
        "source_reference": value.source_reference,
        "captured_at": dump_datetime(value.captured_at),
        "captured_by": value.captured_by,
        "confidence": value.confidence,
        "notes": value.notes,
        "version": value.version,
    })


def load_provenance(value: str) -> Provenance:
    raw = load_json(value, {})
    return Provenance(
        source_system=raw.get("source_system"), source_reference=raw.get("source_reference"),
        captured_at=load_datetime(raw.get("captured_at")), captured_by=raw.get("captured_by"),
        confidence=raw.get("confidence"), notes=raw.get("notes"),
        version=raw.get("version", "0.1"),
    )


def dump_legacy_reference(value: LegacyReference | None) -> str | None:
    if value is None:
        return None
    return dump_json({
        "system": value.system, "entity_type": value.entity_type,
        "legacy_id": value.legacy_id, "location": value.location, "version": value.version,
    })


def load_legacy_reference(value: str | None) -> LegacyReference | None:
    if value is None:
        return None
    raw = load_json(value, {})
    return LegacyReference(
        system=raw["system"], entity_type=raw["entity_type"],
        legacy_id=raw["legacy_id"], location=raw.get("location"),
        version=raw.get("version", "0.1"),
    )


def dump_extensions(value: Mapping[str, Any]) -> str:
    return dump_json(dict(value))


def load_extensions(value: str | None) -> dict[str, Any]:
    return dict(load_json(value, {}))
