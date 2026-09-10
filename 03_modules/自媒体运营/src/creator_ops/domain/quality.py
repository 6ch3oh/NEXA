"""Authoritative QA contracts kept distinct from post-publish Review."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Sequence


class QAScope(str, Enum):
    CONTENT = "CONTENT"
    ASSET = "ASSET"
    VISUAL = "VISUAL"
    PACKAGE = "PACKAGE"
    PUBLISH = "PUBLISH"


class QAStatus(str, Enum):
    OPEN = "OPEN"
    PASS = "PASS"
    FAIL = "FAIL"
    MANUAL_REVIEW = "MANUAL_REVIEW"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class QALevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


@dataclass(frozen=True)
class QACheck:
    check_id: str
    scope: QAScope
    status: QAStatus
    level: QALevel
    item: str
    note: str | None = None
    evidence: tuple[str, ...] = ()
    extension_fields: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class QAReport:
    qa_id: str
    content_id: str
    checks: tuple[QACheck, ...]
    source_reference: str
    version: str = "0.1"

    @property
    def passed(self) -> bool:
        return bool(self.checks) and all(
            check.status in {QAStatus.PASS, QAStatus.NOT_APPLICABLE} for check in self.checks
        )

    @property
    def requires_manual_review(self) -> bool:
        return any(check.status in {QAStatus.OPEN, QAStatus.MANUAL_REVIEW} for check in self.checks)


class QACompatibilityMapper:
    """Map legacy risk/QA objects without turning them into Review records."""

    @staticmethod
    def from_risk_checklist(
        content_id: str, rows: Sequence[Mapping[str, Any]], *, source_reference: str,
    ) -> QAReport:
        checks = []
        for index, row in enumerate(rows):
            raw_status = str(row.get("status", "open")).strip().lower()
            status = {
                "checked": QAStatus.PASS,
                "pass": QAStatus.PASS,
                "passed": QAStatus.PASS,
                "failed": QAStatus.FAIL,
                "fail": QAStatus.FAIL,
                "open": QAStatus.OPEN,
            }.get(raw_status, QAStatus.MANUAL_REVIEW)
            raw_level = str(row.get("level", "MEDIUM")).strip().upper()
            level = QALevel(raw_level) if raw_level in {item.value for item in QALevel} else QALevel.MEDIUM
            check_id = str(row.get("risk_id") or row.get("check_id") or f"legacy-check-{index + 1}")
            consumed = {"risk_id", "check_id", "category", "status", "level", "item", "note", "evidence"}
            checks.append(QACheck(
                check_id=check_id,
                scope=_scope(row.get("category")),
                status=status,
                level=level,
                item=str(row.get("item") or row.get("category") or "Legacy QA check"),
                note=str(row["note"]) if row.get("note") not in (None, "") else None,
                evidence=tuple(str(item) for item in (row.get("evidence") or ())),
                extension_fields={key: value for key, value in row.items() if key not in consumed},
            ))
        return QAReport(
            qa_id=f"qa:{content_id}:{source_reference}", content_id=content_id,
            checks=tuple(checks), source_reference=source_reference,
        )


def _scope(value: Any) -> QAScope:
    text = str(value or "").lower()
    if any(token in text for token in ("视觉", "肖像", "版权", "visual")):
        return QAScope.VISUAL
    if any(token in text for token in ("素材", "asset")):
        return QAScope.ASSET
    if any(token in text for token in ("发布", "publish", "工具信息")):
        return QAScope.PUBLISH
    if any(token in text for token in ("包", "package")):
        return QAScope.PACKAGE
    return QAScope.CONTENT
