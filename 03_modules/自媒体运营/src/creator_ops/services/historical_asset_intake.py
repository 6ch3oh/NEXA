"""Read-only, explicit-path historical asset intake dry run."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Iterable

from creator_ops.compatibility.historical_asset_manifest import (
    AssetFamily,
    HistoricalAssetManifestEntry,
    SourceType,
)
from creator_ops.compatibility.legacy import LegacyCompatibilityMapper
from creator_ops.domain.models import Provenance


class ReuseClassification(str, Enum):
    REUSE_AS_IS = "REUSE_AS_IS"
    REUSE_WITH_ADAPTER = "REUSE_WITH_ADAPTER"
    MIGRATION_REQUIRED = "MIGRATION_REQUIRED"
    REFERENCE_ONLY = "REFERENCE_ONLY"
    UNKNOWN = "UNKNOWN"


class MappingStatus(str, Enum):
    MAPPED = "MAPPED"
    VALIDATED_AS_IS = "VALIDATED_AS_IS"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    MIGRATION_REQUIRED = "MIGRATION_REQUIRED"
    FAILED = "FAILED"
    NOT_ATTEMPTED = "NOT_ATTEMPTED"


@dataclass(frozen=True)
class IntakeResult:
    asset_family: AssetFamily
    source_path: str
    existence: bool
    readability: bool
    detected_format: str
    mapping_status: MappingStatus
    reuse_classification: ReuseClassification
    warnings: tuple[str, ...]
    provenance: Provenance
    mapped_count: int = 0


@dataclass(frozen=True)
class IntakePlan:
    mode: str
    results: tuple[IntakeResult, ...]
    write_operations: tuple[str, ...] = ()
    version: str = "0.1"

    @property
    def is_read_only(self) -> bool:
        return self.mode == "DRY_RUN" and not self.write_operations


class HistoricalAssetIntakeService:
    """Inspect only paths explicitly authorized by validated Manifest entries."""

    def __init__(self, mapper: LegacyCompatibilityMapper | None = None) -> None:
        self.mapper = mapper or LegacyCompatibilityMapper()

    def dry_run(self, entries: Iterable[HistoricalAssetManifestEntry]) -> IntakePlan:
        results = tuple(self._inspect(entry) for entry in entries if entry.enabled)
        return IntakePlan(mode="DRY_RUN", results=results, write_operations=())

    def _inspect(self, entry: HistoricalAssetManifestEntry) -> IntakeResult:
        path = entry.path  # revalidates fail-closed path rules
        exists = path.exists()
        readable = exists and os.access(path, os.R_OK)
        detected = self._detect_format(path) if exists else "MISSING"
        warnings: list[str] = []
        if not exists:
            warnings.append("SOURCE_NOT_FOUND")
            return self._result(entry, exists, False, detected, MappingStatus.NOT_ATTEMPTED,
                                ReuseClassification.UNKNOWN, warnings)
        if not readable:
            warnings.append("SOURCE_NOT_READABLE")
            return self._result(entry, exists, False, detected, MappingStatus.NOT_ATTEMPTED,
                                ReuseClassification.UNKNOWN, warnings)
        if entry.source_type is SourceType.FILE and not path.is_file():
            warnings.append("SOURCE_TYPE_MISMATCH")
            return self._result(entry, exists, readable, detected, MappingStatus.FAILED,
                                ReuseClassification.UNKNOWN, warnings)
        if entry.source_type is SourceType.DIRECTORY and not path.is_dir():
            warnings.append("SOURCE_TYPE_MISMATCH")
            return self._result(entry, exists, readable, detected, MappingStatus.FAILED,
                                ReuseClassification.UNKNOWN, warnings)

        expected = entry.expected_format.strip().upper()
        if expected not in {"AUTO", detected, "NEXA_MANIFEST_V0.1"}:
            warnings.append(f"FORMAT_MISMATCH:expected={expected},detected={detected}")

        if entry.asset_family in {AssetFamily.MEDIA, AssetFamily.EXTERNAL_REFERENCE}:
            return self._result(entry, exists, readable, detected, MappingStatus.NOT_APPLICABLE,
                                ReuseClassification.REFERENCE_ONLY, warnings)
        if entry.asset_family is AssetFamily.WORKFLOW:
            warnings.append("NO_WORKFLOW_ADAPTER_V0.1")
            return self._result(entry, exists, readable, detected, MappingStatus.MIGRATION_REQUIRED,
                                ReuseClassification.MIGRATION_REQUIRED, warnings)
        if entry.asset_family is AssetFamily.MANIFEST:
            return self._inspect_manifest(entry, path, detected, warnings)
        if detected != "JSON":
            warnings.append("NO_COMPATIBILITY_ADAPTER_FOR_FORMAT")
            return self._result(entry, exists, readable, detected, MappingStatus.NOT_ATTEMPTED,
                                ReuseClassification.UNKNOWN, warnings)

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            mapped_count = self._run_compatibility(entry.asset_family, payload)
        except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            warnings.append(f"COMPATIBILITY_MAPPING_FAILED:{type(exc).__name__}")
            return self._result(entry, exists, readable, detected, MappingStatus.FAILED,
                                ReuseClassification.UNKNOWN, warnings)
        return self._result(entry, exists, readable, detected, MappingStatus.MAPPED,
                            ReuseClassification.REUSE_WITH_ADAPTER, warnings, mapped_count)

    def _inspect_manifest(
        self,
        entry: HistoricalAssetManifestEntry,
        path: Path,
        detected: str,
        warnings: list[str],
    ) -> IntakeResult:
        if detected != "JSON":
            warnings.append("MANIFEST_FORMAT_UNSUPPORTED")
            return self._result(entry, True, True, detected, MappingStatus.FAILED,
                                ReuseClassification.UNKNOWN, warnings)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if raw.get("manifest_version") != "0.1" or not raw.get("asset_set_id"):
                raise ValueError("manifest identity missing")
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
            warnings.append(f"MANIFEST_VALIDATION_FAILED:{type(exc).__name__}")
            return self._result(entry, True, True, detected, MappingStatus.FAILED,
                                ReuseClassification.UNKNOWN, warnings)
        return self._result(entry, True, True, detected, MappingStatus.VALIDATED_AS_IS,
                            ReuseClassification.REUSE_AS_IS, warnings, 1)

    def _run_compatibility(self, family: AssetFamily, payload: Any) -> int:
        items = payload if isinstance(payload, list) else [payload]
        if family is AssetFamily.ACCOUNT:
            return len([self.mapper.map_account(item) for item in items])
        if family is AssetFamily.CONTENT:
            for item in items:
                if "content" in item or "assets" in item:
                    self.mapper.map_content_package(item)
                else:
                    self.mapper.map_content(item)
            return len(items)
        if family is AssetFamily.PUBLISH:
            return len([self.mapper.map_publish_record(item) for item in items])
        if family is AssetFamily.METRICS:
            return len([self.mapper.map_metrics(item) for item in items])
        if family is AssetFamily.REVIEW:
            return len([self.mapper.map_review(item) for item in items])
        if family is AssetFamily.PROMPT:
            return len([self.mapper.map_prompt_asset(item) for item in items])
        raise ValueError(f"no V0.1 mapper for {family.value}")

    @staticmethod
    def _detect_format(path: Path) -> str:
        if path.is_dir():
            return "DIRECTORY"
        suffix = path.suffix.lower()
        return {".json": "JSON", ".csv": "CSV", ".txt": "TEXT"}.get(suffix, "UNKNOWN")

    @staticmethod
    def _result(
        entry: HistoricalAssetManifestEntry,
        existence: bool,
        readability: bool,
        detected_format: str,
        mapping_status: MappingStatus,
        classification: ReuseClassification,
        warnings: list[str],
        mapped_count: int = 0,
    ) -> IntakeResult:
        assert entry.provenance is not None  # guaranteed by Manifest validation
        return IntakeResult(
            asset_family=entry.asset_family,
            source_path=str(entry.path),
            existence=existence,
            readability=readability,
            detected_format=detected_format,
            mapping_status=mapping_status,
            reuse_classification=classification,
            warnings=tuple(warnings),
            provenance=entry.provenance,
            mapped_count=mapped_count,
        )
