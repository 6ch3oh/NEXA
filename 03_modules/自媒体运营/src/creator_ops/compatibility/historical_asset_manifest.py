"""Fail-closed authorization contract for historical asset intake."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

from creator_ops.domain.models import LEGACY_ACCOUNT_CODES, Provenance


MANIFEST_VERSION = "0.1"


class ManifestValidationError(ValueError):
    pass


class AssetFamily(str, Enum):
    ACCOUNT = "ACCOUNT"
    CONTENT = "CONTENT"
    MEDIA = "MEDIA"
    PROMPT = "PROMPT"
    PUBLISH = "PUBLISH"
    METRICS = "METRICS"
    REVIEW = "REVIEW"
    WORKFLOW = "WORKFLOW"
    MANIFEST = "MANIFEST"
    EXTERNAL_REFERENCE = "EXTERNAL_REFERENCE"


class SourceType(str, Enum):
    FILE = "FILE"
    DIRECTORY = "DIRECTORY"
    AUTO = "AUTO"


class ReadMode(str, Enum):
    READ_ONLY = "READ_ONLY"


_URL_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")
_WILDCARD_CHARS = frozenset("*?[]{}")


def _module_root() -> Path:
    return Path(__file__).resolve().parents[3]


def validate_authorized_path(raw_path: str) -> Path:
    """Validate one explicit local path without expanding or discovering scope."""
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ManifestValidationError("absolute_path is required")
    candidate_text = raw_path.strip()
    if _URL_PATTERN.match(candidate_text):
        raise ManifestValidationError("URLs are not supported by Intake V0.1")
    if candidate_text.startswith(("\\\\", "//")):
        raise ManifestValidationError("network/UNC paths require separate authorization")
    if any(char in candidate_text for char in _WILDCARD_CHARS):
        raise ManifestValidationError("wildcards and glob paths are forbidden")

    candidate = Path(candidate_text)
    if not candidate.is_absolute():
        raise ManifestValidationError("relative paths are forbidden")
    if ".." in candidate.parts:
        raise ManifestValidationError("parent traversal is forbidden")
    resolved = candidate.resolve(strict=False)
    if resolved == Path(resolved.anchor):
        raise ManifestValidationError("disk roots are forbidden")

    module = _module_root().resolve()
    known_broad_roots = {module, module.parent.resolve(), module.parents[1].resolve()}
    if resolved in known_broad_roots:
        raise ManifestValidationError("module/workspace aggregate directories are overbroad")
    if resolved.exists() and resolved.is_dir() and len(resolved.parts) < 4:
        raise ManifestValidationError("directory authorization is obviously overbroad")
    return resolved


@dataclass(frozen=True)
class HistoricalAssetManifestEntry:
    manifest_version: str
    asset_set_id: str
    asset_family: AssetFamily
    source_type: SourceType
    absolute_path: str
    read_mode: ReadMode
    expected_format: str
    legacy_system: str
    account_codes: tuple[str, ...]
    content_scope: str | None
    provenance: Provenance | None
    notes: str | None = None
    enabled: bool = True

    def __post_init__(self) -> None:
        if self.manifest_version != MANIFEST_VERSION:
            raise ManifestValidationError(f"unsupported manifest_version: {self.manifest_version}")
        if not isinstance(self.asset_family, AssetFamily):
            raise ManifestValidationError("asset_family must be declared")
        if not isinstance(self.source_type, SourceType):
            raise ManifestValidationError("source_type must be declared")
        if self.read_mode is not ReadMode.READ_ONLY:
            raise ManifestValidationError("Phase 1 allows READ_ONLY only")
        for name in ("asset_set_id", "expected_format", "legacy_system"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ManifestValidationError(f"{name} is required")
        if self.provenance is None or not self.provenance.is_complete:
            raise ManifestValidationError("complete provenance is required")
        invalid_codes = {code for code in self.account_codes if code not in LEGACY_ACCOUNT_CODES}
        if invalid_codes:
            raise ManifestValidationError(f"unknown legacy account codes: {sorted(invalid_codes)}")
        validate_authorized_path(self.absolute_path)

    @property
    def path(self) -> Path:
        return validate_authorized_path(self.absolute_path)

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any]) -> "HistoricalAssetManifestEntry":
        provenance = raw.get("provenance")
        if provenance is not None and not isinstance(provenance, Provenance):
            from datetime import datetime
            captured = provenance.get("captured_at")
            provenance = Provenance(
                source_system=provenance.get("source_system"),
                source_reference=provenance.get("source_reference"),
                captured_at=datetime.fromisoformat(str(captured).replace("Z", "+00:00")) if captured else None,
                captured_by=provenance.get("captured_by"),
                confidence=provenance.get("confidence"),
                notes=provenance.get("notes"),
            )
        try:
            family = AssetFamily(raw["asset_family"])
            source_type = SourceType(raw.get("source_type", "AUTO"))
            read_mode = ReadMode(raw["read_mode"])
        except (KeyError, ValueError) as exc:
            raise ManifestValidationError(f"invalid manifest enum: {exc}") from exc
        return cls(
            manifest_version=str(raw.get("manifest_version", "")),
            asset_set_id=str(raw.get("asset_set_id", "")),
            asset_family=family,
            source_type=source_type,
            absolute_path=str(raw.get("absolute_path", "")),
            read_mode=read_mode,
            expected_format=str(raw.get("expected_format", "")),
            legacy_system=str(raw.get("legacy_system", "")),
            account_codes=tuple(raw.get("account_codes") or ()),
            content_scope=raw.get("content_scope"),
            provenance=provenance,
            notes=raw.get("notes"),
            enabled=bool(raw.get("enabled", True)),
        )


@dataclass(frozen=True)
class HistoricalAssetManifest:
    manifest_version: str
    asset_set_id: str
    entries: tuple[HistoricalAssetManifestEntry, ...]

    def __post_init__(self) -> None:
        if self.manifest_version != MANIFEST_VERSION:
            raise ManifestValidationError("unsupported manifest version")
        if not self.asset_set_id.strip():
            raise ManifestValidationError("asset_set_id is required")
        if not self.entries:
            raise ManifestValidationError("manifest must contain at least one entry")
        for entry in self.entries:
            if entry.manifest_version != self.manifest_version or entry.asset_set_id != self.asset_set_id:
                raise ManifestValidationError("entry manifest identity mismatch")

    @classmethod
    def from_json(cls, path: str | Path) -> "HistoricalAssetManifest":
        manifest_path = validate_authorized_path(str(path))
        if not manifest_path.is_file():
            raise ManifestValidationError("manifest path must be a readable file")
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = tuple(HistoricalAssetManifestEntry.from_mapping(item) for item in raw.get("entries", ()))
        return cls(str(raw.get("manifest_version", "")), str(raw.get("asset_set_id", "")), entries)
