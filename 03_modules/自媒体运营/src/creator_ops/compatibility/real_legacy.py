"""Read-only adapters for the confirmed Creator Ops legacy root.

This module inventories and maps detached legacy records.  It never writes to
the source tree, creates a database, or invokes a legacy command.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Mapping

from creator_ops.domain.models import ContentState, LEGACY_ACCOUNT_CODES


CONFIRMED_LEGACY_ROOT = Path(r"E:\AI工作台\内容创作\06_自媒体运营")
EXCLUDED_DIRECTORY_NAMES = frozenset({".venv", "__pycache__"})


class LegacyReadError(ValueError):
    pass


class ParseStatus(str, Enum):
    PARSED = "PARSED"
    UNSTRUCTURED = "UNSTRUCTURED"
    FAILED = "FAILED"


class StateMappingType(str, Enum):
    EXACT = "EXACT"
    SAFE_NORMALIZATION = "SAFE_NORMALIZATION"
    LOSSY = "LOSSY"
    AMBIGUOUS = "AMBIGUOUS"
    UNMAPPED = "UNMAPPED"


@dataclass(frozen=True)
class LegacyStateMapping:
    legacy_state: str
    canonical_state: ContentState | None
    mapping_type: StateMappingType
    confidence: float
    requires_manual_review: bool
    reason: str


_STATE_MAPPINGS: dict[str, LegacyStateMapping] = {
    "candidate_ready": LegacyStateMapping(
        "candidate_ready", ContentState.IDEA, StateMappingType.SAFE_NORMALIZATION,
        0.95, False, "A daily candidate set exists but content production has not started",
    ),
    "planned": LegacyStateMapping(
        "planned", ContentState.IDEA, StateMappingType.LOSSY,
        0.65, True, "Legacy planned does not identify whether a draft or asset task already exists",
    ),
    "script_ready": LegacyStateMapping(
        "script_ready", ContentState.ASSET_PREPARATION, StateMappingType.SAFE_NORMALIZATION,
        0.85, False, "The script exists and the evidenced next work is asset preparation",
    ),
    "prompt_ready": LegacyStateMapping(
        "prompt_ready", ContentState.ASSET_PREPARATION, StateMappingType.SAFE_NORMALIZATION,
        0.85, False, "A generation prompt exists while the resulting asset is still absent",
    ),
    "waiting_for_user_material": LegacyStateMapping(
        "waiting_for_user_material", ContentState.BLOCKED, StateMappingType.SAFE_NORMALIZATION,
        0.95, False, "The legacy workflow explicitly waits for an operator-supplied asset",
    ),
    "skipped": LegacyStateMapping(
        "skipped", None, StateMappingType.UNMAPPED,
        1.0, True, "Skipped is a selection event, not a ContentItem lifecycle state",
    ),
}


def reconcile_legacy_state(value: str | None) -> LegacyStateMapping:
    normalized = (value or "").strip().lower()
    if normalized in _STATE_MAPPINGS:
        return _STATE_MAPPINGS[normalized]
    return LegacyStateMapping(
        normalized or "<missing>", None, StateMappingType.UNMAPPED,
        0.0, True, "No evidence-backed canonical state mapping exists",
    )


def legacy_state_mapping_v0_1() -> tuple[LegacyStateMapping, ...]:
    return tuple(_STATE_MAPPINGS[key] for key in sorted(_STATE_MAPPINGS))


@dataclass(frozen=True)
class RealLegacyFormatRecord:
    asset_family: str
    source_path: str
    file_format: str
    encoding: str | None
    record_shape: str
    identity_fields: tuple[str, ...]
    status_fields: tuple[str, ...]
    relationship_fields: tuple[str, ...]
    timestamp_fields: tuple[str, ...]
    provenance_fields: tuple[str, ...]
    known_nullability: tuple[str, ...]
    known_duplicates: tuple[str, ...]
    parse_status: ParseStatus
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class CanonicalLegacyRecord:
    source_path: str
    asset_family: str
    target_entity: str
    legacy_identity: str | None
    target_identity: str | None
    canonical_fields: Mapping[str, Any]
    warnings: tuple[str, ...] = ()
    confidence: float = 1.0
    requires_manual_review: bool = False
    valid: bool = True
    reference_only: bool = False
    compatibility: str = "ADAPTER_COMPATIBLE"


@dataclass(frozen=True)
class LegacyMethodologyClassification:
    account_code: str
    methodology: tuple[str, ...]
    prompt: tuple[str, ...]
    reusable_reference: tuple[str, ...]
    asset_generation_instruction: tuple[str, ...]
    model_specific_behavior: tuple[str, ...]
    operator_workflow: tuple[str, ...]
    source_paths: tuple[str, ...]


@dataclass(frozen=True)
class HumanAIHandoffContract:
    input_package: str
    reference_assets: tuple[str, ...]
    prompt: str
    operator_action: str
    chatgpt_action: str
    manual_checkpoint: bool
    generated_asset_handback: str
    content_package_attachment: str
    provenance: str
    control_mode: str = "HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF"


@dataclass(frozen=True)
class LegacyCommandMapping:
    legacy_command: str
    disposition: str
    nexa_command: str | None
    reason: str


LEGACY_COMMAND_MATRIX: tuple[LegacyCommandMapping, ...] = (
    LegacyCommandMapping("generate_daily_brief.py", "KEEP_LEGACY_TOOL", None,
                         "No NEXA research/topic-generation command exists in V0.1"),
    LegacyCommandMapping("create_selection.py", "WRAP_APPLICATION_API", "record_selection",
                         "Selection should enter through an explicit command boundary"),
    LegacyCommandMapping("validate_selection.py", "KEEP_LEGACY_TOOL", None,
                         "Read-only validation remains useful during transition"),
    LegacyCommandMapping("run_selected.py", "REPLACE_BY_COMMAND_API", "create_content_from_selection",
                         "Direct filesystem mutation is the partially replaced 005 path"),
    LegacyCommandMapping("run_research_once.cmd", "KEEP_LEGACY_TOOL", None,
                         "Research execution is outside the present Creator Ops API"),
    LegacyCommandMapping("run_semantic_search_smoke.cmd", "KEEP_LEGACY_TOOL", None,
                         "Environment smoke testing has no domain command equivalent"),
    LegacyCommandMapping("run_local_validation.cmd", "KEEP_LEGACY_TOOL", None,
                         "Historical validation must remain available and untouched"),
)


class RealLegacyReader:
    """A root-confined reader. Every path is resolved under one authorized root."""

    def __init__(self, authorized_root: str | Path) -> None:
        root = Path(authorized_root)
        if not root.is_absolute() or not root.is_dir():
            raise LegacyReadError("authorized legacy root must be an existing absolute directory")
        self.root = root.resolve()

    @classmethod
    def confirmed_creator_ops(cls) -> "RealLegacyReader":
        return cls(CONFIRMED_LEGACY_ROOT)

    def resolve(self, relative_path: str | Path) -> Path:
        candidate = (self.root / Path(relative_path)).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise LegacyReadError("legacy path escapes the authorized root") from exc
        return candidate

    def iter_files(self) -> tuple[Path, ...]:
        files = []
        for current, directory_names, file_names in os.walk(self.root):
            directory_names[:] = sorted(
                name for name in directory_names if name not in EXCLUDED_DIRECTORY_NAMES
            )
            base = Path(current)
            files.extend(base / name for name in file_names)
        return tuple(sorted(files, key=lambda item: item.relative_to(self.root).as_posix().casefold()))

    def read_bytes(self, relative_path: str | Path) -> bytes:
        path = self.resolve(relative_path)
        if not path.is_file():
            raise LegacyReadError("legacy source must be an existing file")
        return path.read_bytes()

    def read_text(self, relative_path: str | Path) -> tuple[str, str]:
        raw = self.read_bytes(relative_path)
        for encoding in ("utf-8-sig", "utf-8", "gb18030"):
            try:
                return raw.decode(encoding), encoding
            except UnicodeDecodeError:
                continue
        raise LegacyReadError("unsupported text encoding")

    def read_json(self, relative_path: str | Path) -> Any:
        text, _ = self.read_text(relative_path)
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise LegacyReadError("invalid legacy JSON") from exc

    def sha256(self, relative_path: str | Path) -> str:
        return hashlib.sha256(self.read_bytes(relative_path)).hexdigest()

    def inventory(self) -> tuple[RealLegacyFormatRecord, ...]:
        raw_records: list[tuple[Path, dict[str, Any]]] = []
        identity_occurrences: dict[tuple[str, str], int] = {}
        for path in self.iter_files():
            details = self._inspect_file(path)
            for name, value in details.pop("identity_values", ()):
                identity_occurrences[(name, value)] = identity_occurrences.get((name, value), 0) + 1
            raw_records.append((path, details))

        records = []
        for path, details in raw_records:
            duplicate_fields = tuple(sorted(
                name for name, value in details.pop("record_identities", ())
                if identity_occurrences.get((name, value), 0) > 1
            ))
            records.append(RealLegacyFormatRecord(
                source_path=path.relative_to(self.root).as_posix(),
                known_duplicates=duplicate_fields,
                **details,
            ))
        return tuple(records)

    def _inspect_file(self, path: Path) -> dict[str, Any]:
        relative = path.relative_to(self.root)
        suffix = path.suffix.lower()
        family = _classify_family(relative)
        file_format = {
            ".json": "JSON", ".md": "MARKDOWN", ".csv": "CSV", ".py": "PYTHON",
            ".cmd": "CMD", ".txt": "TEXT", ".gitignore": "GITIGNORE",
        }.get(suffix, "TEXT")
        warnings: list[str] = []
        fields: tuple[str, ...] = ()
        nullable: tuple[str, ...] = ()
        identities: tuple[tuple[str, str], ...] = ()
        try:
            text, encoding = self.read_text(relative)
            if suffix == ".json":
                payload = json.loads(text)
                shape, fields, nullable, identities = _json_shape(payload)
                if path.name == "accounts.json" and isinstance(payload, dict):
                    fields = tuple(sorted(set(fields) | {"account_code"}))
                    identities = identities + tuple(
                        ("account_code", str(code)) for code in payload if code in LEGACY_ACCOUNT_CODES
                    )
                status = ParseStatus.PARSED
            elif suffix == ".csv":
                reader = csv.DictReader(io.StringIO(text))
                rows = list(reader)
                fields = tuple(reader.fieldnames or ())
                shape = f"CSV_TABLE:{len(rows)}"
                nullable = tuple(sorted({key for row in rows for key, value in row.items() if value in (None, "")}))
                identities = _identity_values(rows)
                status = ParseStatus.PARSED
            elif suffix == ".md":
                headings = tuple(line.lstrip("#").strip() for line in text.splitlines() if line.startswith("#"))
                shape = f"MARKDOWN_DOCUMENT:headings={len(headings)}"
                fields = tuple(f"heading:{item}" for item in headings[:20])
                status = ParseStatus.UNSTRUCTURED
            else:
                shape = f"{file_format}_DOCUMENT:lines={len(text.splitlines())}"
                status = ParseStatus.UNSTRUCTURED
        except (OSError, UnicodeError, json.JSONDecodeError, csv.Error, LegacyReadError) as exc:
            encoding = None
            shape = "PARSE_FAILED"
            status = ParseStatus.FAILED
            warnings.append(f"PARSE_FAILED:{type(exc).__name__}")

        names = set(fields)
        record_identities = tuple(identities)
        return {
            "asset_family": family,
            "file_format": file_format,
            "encoding": encoding,
            "record_shape": shape,
            "identity_fields": tuple(sorted(name for name in names if _is_identity_field(name))),
            "status_fields": tuple(sorted(name for name in names if _is_status_field(name))),
            "relationship_fields": tuple(sorted(name for name in names if _is_relationship_field(name))),
            "timestamp_fields": tuple(sorted(name for name in names if _is_timestamp_field(name))),
            "provenance_fields": tuple(sorted(name for name in names if _is_provenance_field(name))),
            "known_nullability": nullable,
            "parse_status": status,
            "warnings": tuple(warnings),
            "identity_values": identities,
            "record_identities": record_identities,
        }


class RealLegacyAdapter:
    """Format-specific adapters feeding canonical reconciliation records."""

    def __init__(self, reader: RealLegacyReader) -> None:
        self.reader = reader

    def map_accounts(self) -> tuple[CanonicalLegacyRecord, ...]:
        source = "automation_mvp/config/accounts.json"
        payload = self.reader.read_json(source)
        if not isinstance(payload, dict):
            raise LegacyReadError("legacy account config must be an object")
        records = []
        for code in sorted(LEGACY_ACCOUNT_CODES):
            raw = payload.get(code)
            if not isinstance(raw, dict):
                records.append(CanonicalLegacyRecord(
                    source, "ACCOUNT", "Account", code, None,
                    {"legacy_account_code": code, "creator_id": None, "platform": None,
                     "display_name": None, "status": None, "content_direction": None,
                     "external_notion_identity": None, "provenance": source},
                    ("LEGACY_ACCOUNT_NOT_FOUND",), 1.0, True, False, False, "UNRESOLVED",
                ))
                continue
            records.append(CanonicalLegacyRecord(
                source, "ACCOUNT", "Account", code, code,
                {"legacy_account_code": code, "creator_id": None,
                 "platform": raw.get("platform"), "display_name": raw.get("name"),
                 "status": None, "content_direction": raw.get("positioning"),
                 "content_type": raw.get("default_format"),
                 "external_notion_identity": None, "automation_note": raw.get("automation_note"),
                 "style": tuple(raw.get("style") or ()), "provenance": source},
                ("CREATOR_ID_UNRESOLVED", "ACCOUNT_STATUS_UNRESOLVED"),
                0.9, True, True, False, "MERGE_FIELDS",
            ))
        return tuple(records)

    def map_contents(self) -> tuple[CanonicalLegacyRecord, ...]:
        records = []
        for path in self.reader.iter_files():
            relative = path.relative_to(self.reader.root).as_posix()
            if path.name != "metadata.json":
                continue
            raw = self.reader.read_json(relative)
            if not isinstance(raw, dict):
                continue
            legacy_id = _text_or_none(raw.get("content_id"))
            state = reconcile_legacy_state(_text_or_none(raw.get("status")))
            account = _text_or_none(raw.get("account_id") or raw.get("account"))
            package = path.parent / "content_package.md"
            package_ref = package.relative_to(self.reader.root).as_posix() if package.is_file() else None
            prompt_refs = tuple(
                item.relative_to(self.reader.root).as_posix()
                for item in sorted((path.parent / "prompts").glob("*")) if item.is_file()
            ) if (path.parent / "prompts").is_dir() else ()
            warnings = ["CREATOR_ID_UNRESOLVED"]
            if state.requires_manual_review:
                warnings.append("STATE_REQUIRES_MANUAL_REVIEW")
            records.append(CanonicalLegacyRecord(
                relative, "CONTENT", "ContentItem", legacy_id, legacy_id,
                {"content_id": legacy_id, "creator_id": None, "target_accounts": (account,) if account else (),
                 "title": raw.get("topic"), "body": None, "script_reference": package_ref,
                 "content_type": _content_type(raw.get("format")),
                 "canonical_state": state.canonical_state.value if state.canonical_state else None,
                 "legacy_state": state.legacy_state, "state_mapping_type": state.mapping_type.value,
                 "created_at": raw.get("created_at"), "updated_at": raw.get("updated_at"),
                 "asset_references": prompt_refs, "manual_publish_only": raw.get("manual_publish_only"),
                 "provenance": relative, "legacy_extension_fields": _extras(raw, _CONTENT_CONSUMED)},
                tuple(warnings), min(0.9, state.confidence), True, bool(legacy_id), False, "PARTIAL",
            ))
        return tuple(records)

    def map_notion_references(self) -> tuple[CanonicalLegacyRecord, ...]:
        records = []
        for content in self.map_contents():
            raw = self.reader.read_json(content.source_path)
            page_id = _text_or_none(raw.get("notion_page_id"))
            url = _text_or_none(raw.get("notion_url"))
            if not page_id and not url:
                continue
            records.append(CanonicalLegacyRecord(
                content.source_path, "EXTERNAL_REFERENCE", "NotionReference", page_id,
                page_id, {"database_identity": None, "page_identity": page_id,
                          "properties": (), "relations": (content.legacy_identity,),
                          "status": raw.get("status"), "account_relation": raw.get("account_id") or raw.get("account"),
                          "content_relation": content.legacy_identity, "historical_ids": (),
                          "url": url, "provenance": content.source_path},
                ("STATIC_REFERENCE_ONLY", "NOTION_DATABASE_ID_UNRESOLVED"), 0.95,
                False, True, True, "REFERENCE_ONLY",
            ))
        return tuple(records)

    def map_prompts(self) -> tuple[CanonicalLegacyRecord, ...]:
        records = []
        for path in self.reader.iter_files():
            relative_path = path.relative_to(self.reader.root)
            if "prompts" not in {part.lower() for part in relative_path.parts}:
                continue
            relative = relative_path.as_posix()
            text, _ = self.reader.read_text(relative)
            content_id, account = _content_identity_from_parts(relative_path.parts)
            metadata = _colon_metadata(text)
            records.append(CanonicalLegacyRecord(
                relative, "PROMPT", "PromptAsset", relative, relative,
                {"legacy_prompt_identity": relative, "purpose": _prompt_purpose(path.name),
                 "account_scope": (account,) if account else (), "content_type": metadata.get("尺寸"),
                 "input_contract": tuple(sorted(key for key in metadata if key not in {"状态", "输出目录"})),
                 "output_contract": metadata.get("输出目录"), "model_assumption": _model_assumption(text),
                 "source_path": relative, "status": metadata.get("状态"),
                 "content_relation": content_id, "provenance": relative},
                ("PATH_DERIVED_PROMPT_IDENTITY",), 0.9, False, True, True, "ADAPTER_COMPATIBLE",
            ))
        return tuple(records)

    def map_assets(self) -> tuple[CanonicalLegacyRecord, ...]:
        records = []
        for prompt in self.map_prompts():
            records.append(CanonicalLegacyRecord(
                prompt.source_path, "ASSET", "Asset", f"legacy-path:{prompt.source_path}",
                f"legacy-path:{prompt.source_path}",
                {"original_path": str(self.reader.resolve(prompt.source_path)), "asset_type": "PROMPT_ARTIFACT",
                 "content_relation": prompt.canonical_fields.get("content_relation"),
                 "account_relation": tuple(prompt.canonical_fields.get("account_scope") or ()),
                 "provenance": prompt.source_path, "legacy_identity": prompt.legacy_identity,
                 "generation_source_method": "HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF",
                 "status": "REFERENCE_ONLY"},
                ("REFERENCE_ONLY_NO_COPY",), 1.0, False, True, True, "REFERENCE_ONLY",
            ))
        for content in self.map_contents():
            raw = self.reader.read_json(content.source_path)
            if raw.get("assets_status") != "external_or_missing":
                continue
            legacy_id = f"missing-assets:{content.legacy_identity}"
            records.append(CanonicalLegacyRecord(
                content.source_path, "ASSET", "Asset", legacy_id, None,
                {"original_path": None, "asset_type": None, "content_relation": content.legacy_identity,
                 "account_relation": content.canonical_fields.get("target_accounts"),
                 "provenance": content.source_path, "legacy_identity": legacy_id,
                 "generation_source_method": None, "status": "UNRESOLVED"},
                ("ASSET_EXTERNAL_OR_MISSING", "ORIGINAL_PATH_UNRESOLVED"), 1.0, True, True,
                True, "UNRESOLVED",
            ))
        return tuple(records)

    def map_content_packages(self) -> tuple[CanonicalLegacyRecord, ...]:
        records = []
        for path in self.reader.iter_files():
            if path.name != "content_package.md":
                continue
            relative_path = path.relative_to(self.reader.root)
            relative = relative_path.as_posix()
            content_id, account = _content_identity_from_parts(relative_path.parts)
            text, _ = self.reader.read_text(relative)
            headings = tuple(line.lstrip("#").strip() for line in text.splitlines() if line.startswith("##"))
            records.append(CanonicalLegacyRecord(
                relative, "CONTENT_PACKAGE", "ContentPackage", content_id, content_id,
                {"content_id": content_id, "account": account, "sections": headings,
                 "transport": "MARKDOWN_REFERENCE", "source_path": relative,
                 "compatibility": "PARTIAL", "provenance": relative},
                ("MARKDOWN_REQUIRES_CONTENT_PACKAGE_ADAPTER",), 0.9, True,
                bool(content_id), True, "PARTIAL",
            ))
        return tuple(records)

    def map_publish_payload(self, data: Mapping[str, Any], source_path: str) -> CanonicalLegacyRecord:
        legacy_id = _text_or_none(data.get("publish_record_id") or data.get("id"))
        actual = data.get("actual_publish_time")
        url = _text_or_none(data.get("external_url") or data.get("url"))
        external_id = _text_or_none(data.get("external_post_id"))
        valid = bool(legacy_id and data.get("account_id") and data.get("platform") and data.get("content_id"))
        warnings = []
        if data.get("status") == "PUBLISHED" and not actual:
            warnings.append("PUBLISHED_TIME_MISSING")
        return CanonicalLegacyRecord(
            source_path, "PUBLISH", "PublishRecord", legacy_id, legacy_id,
            {"account": data.get("account_id"), "platform": data.get("platform"),
             "content": data.get("content_id"), "actual_publish_time": actual,
             "url": url, "external_post_id": external_id, "status": data.get("status"),
             "provenance_kind": "LEGACY_IMPORTED_RECORD", "provenance": source_path},
            tuple(warnings), 0.95, bool(warnings), valid, False, "ADAPTER_COMPATIBLE",
        )

    def map_metrics_payload(self, data: Mapping[str, Any], source_path: str) -> CanonicalLegacyRecord:
        warnings = []
        mapped: dict[str, int | float | None] = {}
        for field_name in ("views", "impressions", "likes", "comments", "favorites", "shares",
                           "followers_delta", "engagement"):
            value = data.get(field_name)
            if value is None or value == "":
                mapped[field_name] = None
            elif isinstance(value, (int, float)) and not isinstance(value, bool):
                mapped[field_name] = value
            else:
                try:
                    mapped[field_name] = float(value) if field_name == "engagement" else int(value)
                except (TypeError, ValueError):
                    mapped[field_name] = None
                    warnings.append(f"INVALID_METRIC_VALUE:{field_name}")
        legacy_id = _text_or_none(data.get("metrics_id") or data.get("id"))
        fields = {"metrics_id": legacy_id, "publish_record_id": data.get("publish_record_id"),
                  **mapped, "collected_at": data.get("collected_at"), "provenance": source_path}
        valid = bool(legacy_id and data.get("publish_record_id") and data.get("collected_at") and not warnings)
        return CanonicalLegacyRecord(
            source_path, "METRICS", "Metrics", legacy_id, legacy_id, fields,
            tuple(warnings), 0.95 if not warnings else 0.0, bool(warnings), valid,
            False, "ADAPTER_COMPATIBLE" if valid else "INVALID",
        )

    def map_review_payload(self, data: Mapping[str, Any], source_path: str) -> CanonicalLegacyRecord:
        consumed = {"review_id", "id", "content_id", "publish_record_id", "strengths", "weaknesses",
                    "reusable_patterns", "failed_patterns", "next_action", "evidence", "reviewed_at", "status"}
        legacy_id = _text_or_none(data.get("review_id") or data.get("id"))
        valid = bool(legacy_id and data.get("content_id") and data.get("publish_record_id") and data.get("reviewed_at"))
        return CanonicalLegacyRecord(
            source_path, "REVIEW", "Review", legacy_id, legacy_id,
            {key: data.get(key) for key in consumed} | {"extension_fields": _extras(data, consumed),
                                                         "provenance": source_path},
            (), 0.95, False, valid, False, "MERGE_FIELDS" if _extras(data, consumed) else "ADAPTER_COMPATIBLE",
        )

    def map_real_publish_records(self) -> tuple[CanonicalLegacyRecord, ...]:
        # publish_copy.md is a draft and is deliberately not a PublishRecord.
        return ()

    def map_real_metrics(self) -> tuple[CanonicalLegacyRecord, ...]:
        # Research statistics are not publication metrics.
        return ()

    def map_real_reviews(self) -> tuple[CanonicalLegacyRecord, ...]:
        # qa_report.json is pre-publish QA, not a Review/case record.
        return ()

    def map_evidence_references(self) -> tuple[CanonicalLegacyRecord, ...]:
        records = []
        for path in self.reader.iter_files():
            relative_path = path.relative_to(self.reader.root)
            relative = relative_path.as_posix()
            name = path.name
            if name.startswith("metadata.before_"):
                raw = self.reader.read_json(relative)
                identity = _text_or_none(raw.get("content_id"))
                records.append(CanonicalLegacyRecord(
                    relative, "HISTORICAL_SNAPSHOT", "CompatibilityEvidence",
                    f"{identity}:{name}", None,
                    {"content_relation": identity, "snapshot_path": relative, "provenance": relative},
                    ("HISTORICAL_SNAPSHOT_REFERENCE_ONLY",), 1.0, False, True, True, "REFERENCE_ONLY",
                ))
            elif name == "publish_copy.md":
                content_id, _ = _content_identity_from_parts(relative_path.parts)
                records.append(CanonicalLegacyRecord(
                    relative, "PUBLISH_DRAFT", "CompatibilityEvidence", f"draft:{content_id}", None,
                    {"content_relation": content_id, "source_path": relative, "provenance": relative},
                    ("NOT_A_PUBLISH_RECORD",), 1.0, False, True, True, "SKIP",
                ))
            elif name == "qa_report.json":
                content_id, _ = _content_identity_from_parts(relative_path.parts)
                records.append(CanonicalLegacyRecord(
                    relative, "QA_REFERENCE", "CompatibilityEvidence", f"qa:{content_id}", None,
                    {"content_relation": content_id, "source_path": relative, "provenance": relative},
                    ("PRE_PUBLISH_QA_NOT_REVIEW",), 1.0, False, True, True, "REFERENCE_ONLY",
                ))
        return tuple(records)

    def map_workflow_references(self) -> tuple[CanonicalLegacyRecord, ...]:
        records = []
        for relative in (
            "00_每日选题板/2026-07-14/daily_brief.json",
            "00_每日选题板/2026-07-14/daily_brief.md",
            "00_每日选题板/2026-07-14/selection.json",
            "00_每日选题板/2026-07-14/run_log.json",
        ):
            if self.reader.resolve(relative).is_file():
                records.append(CanonicalLegacyRecord(
                    relative, "WORKFLOW", "CompatibilityEvidence", relative, None,
                    {"source_path": relative, "provenance": relative},
                    ("WORKFLOW_EVENT_ADAPTER_REQUIRED",), 1.0, False, True, True, "REFERENCE_ONLY",
                ))
        return tuple(records)

    def parse_manifest_payload(self, data: Mapping[str, Any], source_path: str) -> CanonicalLegacyRecord:
        identity = _text_or_none(data.get("manifest_id") or data.get("asset_set_id") or data.get("id"))
        return CanonicalLegacyRecord(
            source_path, "MANIFEST", "LegacyManifest", identity, identity,
            {"identity": identity, "semantics": data.get("semantics"),
             "entries": tuple(data.get("entries") or ()), "provenance": source_path},
            (), 0.9, False, bool(identity), True, "REFERENCE_ONLY",
        )

    def parse_task_lock_payload(self, data: Mapping[str, Any], source_path: str) -> CanonicalLegacyRecord:
        identity = _text_or_none(data.get("lock_id") or data.get("task_id") or data.get("id"))
        return CanonicalLegacyRecord(
            source_path, "TASK_LOCK", "LegacyTaskLock", identity, identity,
            {"identity": identity, "locked": data.get("locked"), "owner": data.get("owner"),
             "semantics": data.get("semantics"), "provenance": source_path},
            ("PARSE_ONLY_NO_UNLOCK_OR_WRITEBACK",), 1.0, False, bool(identity), True, "REFERENCE_ONLY",
        )

    def classify_football_ai_visual(self) -> LegacyMethodologyClassification:
        return LegacyMethodologyClassification(
            account_code="B2",
            methodology=("fictional cyber-football storytelling", "three-shot 15-second structure",
                         "explicit AI-fantasy disclosure", "real-person and news-simulation risk controls"),
            prompt=("cyber football fantasy", "9:16", "15 seconds", "three timed shots"),
            reusable_reference=("fictional character reference", "cyber stadium", "action/reversal pattern"),
            asset_generation_instruction=("generate fictional imagery", "avoid real player likeness",
                                          "avoid team logos", "do not fabricate match results"),
            model_specific_behavior=("Seedance-style storyboard is documented but provider is not configured",),
            operator_workflow=("select topic", "review risk restrictions", "manually hand off storyboard",
                               "review generated result before attachment"),
            source_paths=("automation_mvp/config/accounts.json", "automation_mvp/scripts/adapters/b2_adapter.py",
                          "00_每日选题板/2026-07-14/daily_brief.json"),
        )

    def build_human_ai_handoff(self) -> HumanAIHandoffContract:
        prompt = "B3_小红书AI学习/2026-07/B3-20260714-001_大学生第一次用ChatGPT先记住这3点/prompts/guizang_render_request.md"
        package = "B3_小红书AI学习/2026-07/B3-20260714-001_大学生第一次用ChatGPT先记住这3点/content_package.md"
        text, _ = self.reader.read_text(prompt)
        metadata = _colon_metadata(text)
        return HumanAIHandoffContract(
            input_package=package, reference_assets=(), prompt=prompt,
            operator_action="Review package and manually invoke the approved rendering skill",
            chatgpt_action=f"Render {metadata.get('页数') or 'unresolved'} pages at {metadata.get('尺寸') or 'unresolved'}",
            manual_checkpoint=True,
            generated_asset_handback=metadata.get("输出目录") or "unresolved",
            content_package_attachment="B3-20260714-001", provenance=prompt,
        )

    def build_reconciliation_records(self) -> tuple[CanonicalLegacyRecord, ...]:
        return (
            self.map_accounts() + self.map_contents() + self.map_notion_references() +
            self.map_prompts() + self.map_assets() + self.map_content_packages() +
            self.map_evidence_references() + self.map_workflow_references()
        )


_CONTENT_CONSUMED = {
    "content_id", "account", "account_id", "account_name", "platform", "topic", "format", "status",
    "created_at", "updated_at", "manual_publish_only", "notion_page_id", "notion_url",
    "obsidian_note_path", "local_content_path", "assets_status",
}


def _classify_family(relative: Path) -> str:
    value = relative.as_posix().lower()
    name = relative.name.lower()
    if name == "accounts.json": return "ACCOUNT"
    if "metadata" in name or "content_package" in name or "content_registry" in value: return "CONTENT"
    if "/prompts/" in f"/{value}" or "prompt" in name: return "PROMPT"
    if name == "publish_copy.md": return "PUBLISH_DRAFT"
    if "qa_report" in name: return "QA_REFERENCE"
    if "manifest" in name: return "MANIFEST"
    if "task_lock" in name or "task-lock" in name: return "TASK_LOCK"
    if value.startswith("00_"): return "WORKFLOW"
    if value.startswith("90_"): return "KNOWLEDGE_REFERENCE"
    if value.startswith("98_"): return "AUDIT"
    if "/research/" in f"/{value}" or "research" in name or "agent_reach" in value or "semantic_search" in value:
        return "RESEARCH"
    if suffix_is_code(relative): return "LEGACY_TOOL"
    return "CONFIGURATION"


def suffix_is_code(path: Path) -> bool:
    return path.suffix.lower() in {".py", ".cmd"}


def _json_shape(payload: Any) -> tuple[str, tuple[str, ...], tuple[str, ...], tuple[tuple[str, str], ...]]:
    objects = tuple(_json_objects(payload))
    fields = tuple(sorted({str(key) for item in objects for key in item}))
    nullable = tuple(sorted({str(key) for item in objects for key, value in item.items() if value in (None, "")}))
    identities = _identity_values(objects)
    if isinstance(payload, list):
        return f"JSON_ARRAY:{len(payload)}", fields, nullable, identities
    if isinstance(payload, dict):
        return f"JSON_OBJECT:{len(payload)}", fields, nullable, identities
    return f"JSON_SCALAR:{type(payload).__name__}", (), (), ()


def _json_objects(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _json_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _json_objects(child)


def _identity_values(items: Iterable[Mapping[str, Any]]) -> tuple[tuple[str, str], ...]:
    names = {"id", "content_id", "account_id", "account_code", "option_id", "notion_page_id", "external_post_id",
             "sync_event_id", "query_id", "asset_set_id", "manifest_id", "lock_id", "task_id"}
    values = []
    for item in items:
        for name in names:
            value = item.get(name)
            if value not in (None, ""):
                values.append((name, str(value)))
    return tuple(values)


def _is_identity_field(name: str) -> bool:
    return name == "id" or name.endswith("_id") or name in {"content_id", "account_id", "account_code"}


def _is_status_field(name: str) -> bool:
    lower = name.lower()
    return "status" in lower or "state" in lower or lower == "result"


def _is_relationship_field(name: str) -> bool:
    lower = name.lower()
    return any(token in lower for token in ("relation", "account", "content", "notion", "obsidian"))


def _is_timestamp_field(name: str) -> bool:
    lower = name.lower()
    return lower.endswith("_at") or lower.endswith("_date") or lower.endswith("_time") or lower == "date"


def _is_provenance_field(name: str) -> bool:
    lower = name.lower()
    return any(token in lower for token in ("source", "path", "url", "provenance", "notion", "obsidian"))


def _text_or_none(value: Any) -> str | None:
    return str(value).strip() if value is not None and str(value).strip() else None


def _extras(data: Mapping[str, Any], consumed: set[str]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if key not in consumed}


def _content_type(value: Any) -> str:
    text = str(value or "").lower()
    if "视频" in text: return "SHORT_VIDEO"
    if "图文" in text or "摄影" in text: return "IMAGE_POST"
    if "文章" in text: return "ARTICLE"
    return "OTHER"


def _content_identity_from_parts(parts: Iterable[str]) -> tuple[str | None, str | None]:
    pattern = re.compile(r"^([A-Z][0-9])-\d{8}-\d{3}(?:_|$)")
    for part in parts:
        match = pattern.match(part)
        if match:
            return part.split("_", 1)[0], match.group(1)
    return None, None


def _colon_metadata(text: str) -> dict[str, str]:
    values = {}
    for line in text.splitlines():
        if "：" in line and not line.lstrip().startswith("#"):
            key, value = line.split("：", 1)
            values[key.strip()] = value.strip()
    return values


def _prompt_purpose(filename: str) -> str:
    lower = filename.lower()
    if "guizang" in lower: return "SOCIAL_CARD_RENDER_HANDOFF"
    if "visual" in lower: return "AI_VISUAL_REFERENCE"
    if "storyboard" in lower: return "VIDEO_STORYBOARD"
    return "UNRESOLVED"


def _model_assumption(text: str) -> str | None:
    lower = text.lower()
    if "guizang" in lower: return "guizang-social-card skill"
    if "seedance" in lower: return "Seedance-compatible storyboard"
    if "ai" in lower: return "Unspecified external AI"
    return None
