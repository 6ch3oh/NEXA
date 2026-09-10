"""Read-only ownership catalog for the six immutable legacy source groups.

The catalog describes disposition, not import. It skips vendored/runtime
caches, assigns every remaining file to a capability and decision, and never
opens a database or writes to a legacy path.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


SOURCE_GROUPS = (
    "00_Codex项目调教", "06_自媒体运营", "视频创作",
    "99_总数据库", "公众号创作", "图文创作",
)
EXCLUDED_SOURCE_DIRECTORIES = frozenset({".venv", "node_modules", "__pycache__", ".git"})


class AuthoritativeDecision(str, Enum):
    KEEP = "KEEP"
    MERGE = "MERGE"
    REPLACE_PARTIALLY = "REPLACE_PARTIALLY"
    REFERENCE_ONLY = "REFERENCE_ONLY"
    DELETE_CANDIDATE = "DELETE_CANDIDATE"


class Capability(str, Enum):
    IDENTITY = "IDENTITY"
    PLANNING_RESEARCH = "PLANNING_RESEARCH"
    CONTENT = "CONTENT"
    WORKFLOW_RECOVERY = "WORKFLOW_RECOVERY"
    PACKAGE_HANDOFF = "PACKAGE_HANDOFF"
    PROMPT = "PROMPT"
    ASSET = "ASSET"
    QA = "QA"
    PUBLISHING = "PUBLISHING"
    PERFORMANCE_CASE_LIBRARY = "PERFORMANCE_CASE_LIBRARY"
    HUMAN_AI_HANDOFF = "HUMAN_AI_HANDOFF"
    OPERATIONS = "OPERATIONS"
    PERSISTENCE = "PERSISTENCE"
    PUBLIC_INTERFACE = "PUBLIC_INTERFACE"
    AUTOMATION_CONTRACT = "AUTOMATION_CONTRACT"
    HISTORICAL_EVIDENCE = "HISTORICAL_EVIDENCE"


@dataclass(frozen=True)
class SourceDisposition:
    group: str
    relative_path: str
    size_bytes: int
    capability: Capability
    decision: AuthoritativeDecision
    rationale: str


@dataclass(frozen=True)
class SourceCoverage:
    records: tuple[SourceDisposition, ...]
    expected_groups: tuple[str, ...]

    @property
    def covered_files(self) -> int:
        return len(self.records)

    @property
    def total_bytes(self) -> int:
        return sum(item.size_bytes for item in self.records)

    @property
    def uncovered_groups(self) -> tuple[str, ...]:
        present = {item.group for item in self.records}
        return tuple(group for group in self.expected_groups if group not in present)

    @property
    def coverage_percent(self) -> float:
        return 100.0 if self.records and not self.uncovered_groups else 0.0

    def decision_counts(self) -> dict[str, int]:
        return {item.value: sum(record.decision is item for record in self.records)
                for item in AuthoritativeDecision}

    def capability_counts(self) -> dict[str, int]:
        return {item.value: sum(record.capability is item for record in self.records)
                for item in Capability if any(record.capability is item for record in self.records)}


class SourceReconciliationCatalog:
    """Root-confined, metadata-only inventory with total disposition coverage."""

    def __init__(self, source_root: str | Path) -> None:
        root = Path(source_root)
        if not root.is_absolute() or not root.is_dir():
            raise ValueError("source_root must be an existing absolute directory")
        self.root = root.resolve()
        missing = tuple(group for group in SOURCE_GROUPS if not (self.root / group).is_dir())
        if missing:
            raise ValueError(f"missing required source groups: {', '.join(missing)}")

    @classmethod
    def current_module(cls) -> "SourceReconciliationCatalog":
        return cls(Path(__file__).resolve().parents[3] / "source_import")

    def build(self) -> SourceCoverage:
        records: list[SourceDisposition] = []
        for group in SOURCE_GROUPS:
            group_root = (self.root / group).resolve()
            for current, directories, names in os.walk(group_root):
                directories[:] = sorted(name for name in directories
                                         if name not in EXCLUDED_SOURCE_DIRECTORIES)
                for name in sorted(names):
                    path = (Path(current) / name).resolve()
                    try:
                        relative = path.relative_to(group_root).as_posix()
                    except ValueError as exc:
                        raise ValueError("source path escapes the authorized group") from exc
                    capability, decision, rationale = _classify(group, relative)
                    records.append(SourceDisposition(
                        group, relative, path.stat().st_size, capability, decision, rationale,
                    ))
        records.sort(key=lambda item: (SOURCE_GROUPS.index(item.group), item.relative_path.casefold()))
        return SourceCoverage(tuple(records), SOURCE_GROUPS)


def _classify(group: str, relative_path: str) -> tuple[Capability, AuthoritativeDecision, str]:
    path = relative_path.replace("\\", "/")
    lower = path.casefold()
    if group == "00_Codex项目调教":
        if lower.startswith("automation/package_export/"):
            return Capability.PACKAGE_HANDOFF, AuthoritativeDecision.REPLACE_PARTIALLY, \
                "Manifest/completeness semantics merged; legacy writer and CLI are not authoritative"
        if lower.startswith("automation/state_engine/"):
            return Capability.WORKFLOW_RECOVERY, AuthoritativeDecision.REPLACE_PARTIALLY, \
                "Transaction/retry/recovery semantics retained behind pure NEXA planning contracts"
        if lower.startswith("automation/ingest/"):
            return Capability.ASSET, AuthoritativeDecision.REPLACE_PARTIALLY, \
                "Validation semantics retained; NEXA owns mutation and persistence boundaries"
        if lower.startswith("automation/contracts/"):
            return Capability.AUTOMATION_CONTRACT, AuthoritativeDecision.MERGE, \
                "Task/result semantics represented by the authoritative offline contract"
        if lower.startswith(("automation/notion_sync/", "automation/orchestrator/")):
            return Capability.PUBLIC_INTERFACE, AuthoritativeDecision.REFERENCE_ONLY, \
                "External sync/orchestration is tested evidence but deferred from V0.1"
        if lower.startswith("contents/"):
            capability = Capability.PROMPT if "/04_prompts/" in lower else Capability.PACKAGE_HANDOFF
            return capability, AuthoritativeDecision.REFERENCE_ONLY, \
                "Real content package evidence preserved; production import is not authorized"
        if lower.startswith(("prompts/", "skills/", "templates/")) or "提示词" in path:
            return Capability.PROMPT, AuthoritativeDecision.REFERENCE_ONLY, \
                "Historical prompt or methodology asset is preserved byte-for-byte"
        if lower.startswith("tools/chatgpt_image_router/"):
            return Capability.HUMAN_AI_HANDOFF, AuthoritativeDecision.REPLACE_PARTIALLY, \
                "Manual handoff semantics retained; legacy executable route is non-authoritative"
        if lower.startswith("tools/video_tools/"):
            return Capability.ASSET, AuthoritativeDecision.REFERENCE_ONLY, \
                "Media tooling is evidence only and is not invoked by V0.1"
        if lower.startswith("scripts/"):
            capability = Capability.PLANNING_RESEARCH if any(
                word in lower for word in ("research", "weekly", "add_case", "video_extraction")
            ) else Capability.PUBLIC_INTERFACE
            return capability, AuthoritativeDecision.REFERENCE_ONLY, \
                "Legacy script remains auditable; Application API is the sole NEXA entry"
        if lower.startswith("tests/"):
            return Capability.QA, AuthoritativeDecision.REFERENCE_ONLY, \
                "Legacy tests are executable maturity evidence, not a production runtime"
        if lower.startswith(("logs/", "manual_runs/", "inbox/")):
            return Capability.HISTORICAL_EVIDENCE, AuthoritativeDecision.REFERENCE_ONLY, \
                "Run log or input evidence is immutable and excluded from runtime state"
        if lower.startswith("notion/"):
            return Capability.IDENTITY, AuthoritativeDecision.REFERENCE_ONLY, \
                "Static Notion schema and identity evidence retained without a connection"
        if lower.startswith("docs/") or lower.endswith(".md"):
            return Capability.HISTORICAL_EVIDENCE, AuthoritativeDecision.REFERENCE_ONLY, \
                "Legacy design or runbook remains non-authoritative documentation"
        if lower.startswith(".env"):
            return Capability.HISTORICAL_EVIDENCE, AuthoritativeDecision.REFERENCE_ONLY, \
                "Potential secret configuration is neither parsed nor exposed"
        return Capability.HISTORICAL_EVIDENCE, AuthoritativeDecision.REFERENCE_ONLY, \
            "Legacy root-level artifact remains immutable evidence"
    if group == "06_自媒体运营":
        if lower == "automation_mvp/config/accounts.json":
            return Capability.IDENTITY, AuthoritativeDecision.MERGE, \
                "A1/A2/B1/B2/B3/B4 identity and positioning are preserved through compatibility mapping"
        if lower.startswith("automation_mvp/config/"):
            return Capability.AUTOMATION_CONTRACT, AuthoritativeDecision.REFERENCE_ONLY, \
                "Provider and research configuration is deferred and never loaded by V0.1"
        if lower.startswith("automation_mvp/scripts/") or lower.endswith(".cmd"):
            return Capability.PLANNING_RESEARCH, AuthoritativeDecision.REFERENCE_ONLY, \
                "Research/topic scripts remain optional tools; no second runtime is introduced"
        if lower.startswith("automation_mvp/tests/"):
            return Capability.QA, AuthoritativeDecision.REFERENCE_ONLY, \
                "Legacy validation tests remain evidence"
        if lower.startswith("automation_mvp/"):
            return Capability.HISTORICAL_EVIDENCE, AuthoritativeDecision.REFERENCE_ONLY, \
                "Legacy MVP schema, output, logs and reports remain immutable evidence"
        if any(token in lower for token in ("每日选题板", "a2_", "b3_")):
            capability = Capability.PROMPT if "prompt" in lower or "提示词" in path else Capability.CONTENT
            return capability, AuthoritativeDecision.REFERENCE_ONLY, \
                "Real operational content or prompt is preserved without formal import"
        return Capability.HISTORICAL_EVIDENCE, AuthoritativeDecision.REFERENCE_ONLY, \
            "Migration and knowledge-export evidence remains outside runtime state"
    if group == "视频创作":
        if lower.endswith("case.json") or "内容案例总库" in path:
            return Capability.PERFORMANCE_CASE_LIBRARY, AuthoritativeDecision.MERGE, \
                "Case identity/status/material fields are exposed by a read-only adapter"
        if "提示词" in path or "prompt" in lower:
            return Capability.PROMPT, AuthoritativeDecision.REFERENCE_ONLY, \
                "Case-derived prompt is a protected reference asset"
        if lower.endswith((".mp4", ".jpg", ".jpeg", ".png", ".webp")):
            return Capability.ASSET, AuthoritativeDecision.REFERENCE_ONLY, \
                "Real media, cover or evidence asset is protected and not imported"
        return Capability.PERFORMANCE_CASE_LIBRARY, AuthoritativeDecision.REFERENCE_ONLY, \
            "Case analysis, storyboard, manifest or index remains read-only evidence"
    if group == "99_总数据库":
        return Capability.PERFORMANCE_CASE_LIBRARY, AuthoritativeDecision.REFERENCE_ONLY, \
            "Live CSV is empty; populated backup remains evidence pending import authority"
    if group in {"公众号创作", "图文创作"}:
        return Capability.PLANNING_RESEARCH, AuthoritativeDecision.REFERENCE_ONLY, \
            "Placeholder or link-collection structure has no competing runtime"
    raise AssertionError("all source groups require an explicit classifier")
