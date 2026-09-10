"""Authoritative local QA runner and durable receipt contract."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Mapping, Sequence

from creator_ops.domain.models import Account, Asset, ContentItem, ReviewState


class QAType(str, Enum):
    CONTENT = "CONTENT"
    ASSET = "ASSET"
    PACKAGE = "PACKAGE"
    PUBLISH_PREP = "PUBLISH_PREP"
    VISUAL = "VISUAL"


class QAReceiptStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    MANUAL_REVIEW = "MANUAL_REVIEW"


@dataclass(frozen=True)
class RuntimeQACheck:
    check_id: str
    passed: bool | None
    message: str
    evidence: tuple[str, ...] = ()


@dataclass(frozen=True)
class QAReceipt:
    qa_id: str
    content_id: str
    package_id: str | None
    qa_type: QAType
    status: QAReceiptStatus
    checks: tuple[RuntimeQACheck, ...]
    failures: tuple[str, ...]
    warnings: tuple[str, ...]
    performed_at: datetime
    evidence: Mapping[str, Any]
    version: str = "0.2"

    @property
    def passed(self) -> bool:
        return self.status is QAReceiptStatus.PASS


class FormalQARunner:
    """Deterministic QA; no network, external AI, or UI-owned decisions."""

    @staticmethod
    def content(content: ContentItem, *, now: datetime) -> QAReceipt:
        checks = (
            RuntimeQACheck("content:title", bool(content.title and content.title.strip()), "title is present"),
            RuntimeQACheck("content:text", bool(
                (content.body and content.body.strip()) or content.script_reference
            ), "body or script reference is present"),
            RuntimeQACheck("content:accounts", bool(content.target_accounts), "target account exists"),
            RuntimeQACheck("content:platform", bool(content.platform_intent), "platform intent exists"),
            RuntimeQACheck("content:provenance", content.provenance.is_complete, "provenance is complete"),
        )
        return _receipt(content.content_id, None, QAType.CONTENT, checks, now)

    @staticmethod
    def assets(
        content: ContentItem, assets: Sequence[Asset], *, now: datetime,
        requirement_statuses: Mapping[str, str] | None = None,
    ) -> QAReceipt:
        linked = {item.asset_id: item for item in assets}
        checks = [RuntimeQACheck(
            "asset:required", bool(content.asset_references), "at least one asset is linked",
        )]
        for asset_id in content.asset_references:
            asset = linked.get(asset_id)
            checks.append(RuntimeQACheck(
                f"asset:{asset_id}:identity", asset is not None,
                "asset identity resolves", (asset.location,) if asset else (),
            ))
            if asset:
                checks.append(RuntimeQACheck(
                    f"asset:{asset_id}:relation", content.content_id in asset.content_relations,
                    "asset relation includes content",
                ))
                checks.append(RuntimeQACheck(
                    f"asset:{asset_id}:location", bool(asset.location.strip()), "asset location is present",
                ))
        if requirement_statuses is not None:
            checks.append(RuntimeQACheck(
                "asset:requirements", bool(requirement_statuses) and all(
                    status == "VERIFIED" for status in requirement_statuses.values()
                ), "all required visual Asset Requirements are verified",
                tuple(f"{key}={value}" for key, value in sorted(requirement_statuses.items())),
            ))
        return _receipt(content.content_id, None, QAType.ASSET, tuple(checks), now)

    @staticmethod
    def package(
        content_id: str, package_id: str, manifest_path: str | Path, *, now: datetime,
    ) -> QAReceipt:
        path = Path(manifest_path)
        checks: list[RuntimeQACheck] = []
        evidence: dict[str, Any] = {"manifest_path": str(path)}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            checks.append(RuntimeQACheck("package:manifest", True, "manifest is valid JSON", (str(path),)))
            checks.append(RuntimeQACheck(
                "package:identity", payload.get("package_id") == package_id and payload.get("content_id") == content_id,
                "package and content identity match",
            ))
            files = payload.get("files") if isinstance(payload.get("files"), list) else []
            checks.append(RuntimeQACheck("package:files", bool(files), "manifest declares files"))
            root = path.parents[1]
            for row in files:
                relative = str(row.get("path") or "")
                target = root / relative
                present = target.is_file()
                checks.append(RuntimeQACheck(f"package:file:{relative}", present, "manifest file exists"))
                if present:
                    digest = hashlib.sha256(target.read_bytes()).hexdigest()
                    checks.append(RuntimeQACheck(
                        f"package:hash:{relative}", digest == row.get("sha256"), "manifest hash matches",
                    ))
            evidence["package_digest"] = payload.get("package_digest")
        except (OSError, json.JSONDecodeError, ValueError):
            checks.append(RuntimeQACheck("package:manifest", False, "manifest is missing or invalid"))
        return _receipt(content_id, package_id, QAType.PACKAGE, tuple(checks), now, evidence=evidence)

    @staticmethod
    def publish_prep(
        content: ContentItem, accounts: Sequence[Account], assets: Sequence[Asset],
        prerequisite_receipts: Sequence[QAReceipt], *, package_id: str | None, now: datetime,
    ) -> QAReceipt:
        account_ids = {item.account_id for item in accounts}
        checks = (
            RuntimeQACheck("publish:title", bool(content.title), "title is ready"),
            RuntimeQACheck("publish:text", bool(content.body or content.script_reference), "body or script is ready"),
            RuntimeQACheck("publish:account", all(item in account_ids for item in content.target_accounts), "target accounts resolve"),
            RuntimeQACheck("publish:assets", bool(assets) and all(
                item in {asset.asset_id for asset in assets} for item in content.asset_references
            ), "linked assets resolve"),
            RuntimeQACheck("publish:review", content.review_state is ReviewState.APPROVED, "editorial review is approved"),
            RuntimeQACheck("publish:package", package_id is not None, "finalized package identity exists"),
            RuntimeQACheck("publish:prerequisites", bool(prerequisite_receipts) and all(
                receipt.passed for receipt in prerequisite_receipts
            ), "content, asset and package QA passed"),
        )
        return _receipt(content.content_id, package_id, QAType.PUBLISH_PREP, checks, now)

    @staticmethod
    def visual(
        content_id: str, *, package_id: str | None, operator_checks: Sequence[Mapping[str, Any]],
        now: datetime,
    ) -> QAReceipt:
        checks = tuple(RuntimeQACheck(
            str(item.get("check_id") or f"visual:{index + 1}"),
            True if item.get("status") == "PASS" else False if item.get("status") == "FAIL" else None,
            str(item.get("message") or "operator visual check"),
            tuple(str(value) for value in (item.get("evidence") or ())),
        ) for index, item in enumerate(operator_checks))
        return _receipt(content_id, package_id, QAType.VISUAL, checks, now)


def _receipt(
    content_id: str, package_id: str | None, qa_type: QAType,
    checks: Sequence[RuntimeQACheck], now: datetime, *, evidence: Mapping[str, Any] | None = None,
) -> QAReceipt:
    failures = tuple(item.check_id for item in checks if item.passed is False)
    warnings = tuple(item.check_id for item in checks if item.passed is None)
    status = QAReceiptStatus.FAIL if failures else QAReceiptStatus.MANUAL_REVIEW if warnings else QAReceiptStatus.PASS
    qa_id = f"qa:{content_id}:{package_id or 'none'}:{qa_type.value}:{now.isoformat()}"
    return QAReceipt(
        qa_id, content_id, package_id, qa_type, status, tuple(checks), failures,
        warnings, now, dict(evidence or {}),
    )


class QAService:
    def __init__(self, store: Any) -> None:
        self.store = store

    def persist(self, receipt: QAReceipt) -> QAReceipt:
        existing = self.store.runtime.find_qa_receipt(receipt.qa_id)
        if existing is not None:
            if existing == receipt:
                return existing
            raise ValueError("QA receipt identity conflict")
        self.store.runtime.save_qa_receipt(receipt)
        return receipt

    def latest_passed(self, content_id: str, qa_type: QAType) -> QAReceipt | None:
        receipts = self.store.runtime.list_qa_receipts(content_id=content_id, qa_type=qa_type)
        return next((item for item in reversed(receipts) if item.passed), None)
