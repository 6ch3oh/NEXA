"""Presentation adapter for the local UI.

This module intentionally imports only the controlled top-level ``creator_ops``
surface and Python's standard library. It never opens SQLite, a repository, a
legacy source tree, or a second workflow.
"""

from __future__ import annotations

import dataclasses
import enum
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from creator_ops import CommandResult, CreatorOpsAPIError, CreatorOpsApplication


UI_VERSION = "0.1"
NAVIGATION = (
    ("dashboard", "总览"),
    ("works", "作品"),
    ("queue", "工作队列"),
    ("content", "内容"),
    ("accounts", "账号"),
    ("assets", "素材"),
    ("reviews", "审核"),
    ("publishing", "发布"),
    ("research", "研究"),
    ("health", "运行状态"),
)


class UIAdapterError(RuntimeError):
    def __init__(self, code: str, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def to_public_json(value: Any) -> Any:
    """Convert public frozen DTOs/ViewModels into JSON-safe presentation data."""

    if dataclasses.is_dataclass(value):
        return {field.name: to_public_json(getattr(value, field.name)) for field in dataclasses.fields(value)}
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Mapping):
        return {str(key): to_public_json(item) for key, item in value.items()}
    if isinstance(value, (tuple, list, set, frozenset)):
        return [to_public_json(item) for item in value]
    return value


class CreatorOpsUIAdapter:
    """Read projections and explicit user-intent commands for the local UI."""

    ACTIONS = frozenset({
        "update_work_item", "submit_asset", "review_visual_asset", "run_qa",
        "editorial_review", "build_package", "record_manual_publish",
        "record_metrics", "complete_post_publish_review", "create_research",
        "add_research_source", "synthesize_research", "plan_topics", "recover_runtime",
        "set_work_portfolio", "set_work_move_permission", "move_work_to_managed",
        "open_work_original", "open_work_location", "open_work_potplayer",
    })

    def __init__(self, application: CreatorOpsApplication) -> None:
        self.application = application

    @staticmethod
    def now() -> datetime:
        return datetime.now(timezone.utc)

    def bootstrap(self) -> dict[str, Any]:
        return {
            "ui_version": UI_VERSION,
            "navigation": [{"id": item[0], "label": item[1]} for item in NAVIGATION],
            "runtime": to_public_json(self.application.get_runtime_info()),
            "health": to_public_json(self.application.health()),
            "safety": {
                "local_only": True,
                "automatic_publishing": "NONE",
                "network_capability": "NONE",
                "manual_publish_notice": "这不会帮你在平台发布内容。仅记录你已经人工完成了发布。",
            },
        }

    def dashboard(self) -> dict[str, Any]:
        now = self.now()
        return {
            "dashboard": to_public_json(self.application.get_dashboard(now=now)),
            "creators": to_public_json(self.application.list_creators()),
            "health": to_public_json(self.application.health()),
            "runtime": to_public_json(self.application.get_runtime_info()),
        }

    def works(self, view: str = "recent") -> dict[str, Any]:
        now = self.now()
        return {
            "items": to_public_json(self.application.list_local_works(view=view, now=now)),
            "view": view, "as_of": now.isoformat(),
            "capabilities": to_public_json(self.application.get_local_works_capabilities()),
        }

    def work_detail(self, work_id: str) -> dict[str, Any]:
        return {
            "work": to_public_json(self.application.get_local_work(work_id)),
            "capabilities": to_public_json(self.application.get_local_works_capabilities()),
        }

    def intake_work_resources(self, resources: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        return {"items": to_public_json(self.application.intake_local_work_resources(resources))}

    def relocate_work_media(self, media_id: str, absolute_path: str) -> dict[str, Any]:
        return {"work": to_public_json(
            self.application.relocate_local_work_media(media_id, absolute_path=absolute_path)
        )}

    def work_media_path(self, media_id: str) -> Path:
        return self.application.local_work_media_path(media_id)

    def work_thumbnail_path(self, media_id: str) -> Path:
        return self.application.local_work_thumbnail_path(media_id)

    def work_queue(self) -> dict[str, Any]:
        now = self.now()
        return {"items": to_public_json(self.application.get_work_queue(now=now)), "as_of": now.isoformat()}

    def contents(self, filters: Mapping[str, str] | None = None) -> dict[str, Any]:
        filters = filters or {}
        now = self.now()
        queue = {item.content_id: item for item in self.application.get_work_queue(now=now)}
        items = []
        for content in self.application.list_content(state=filters.get("state") or None):
            work_item = queue.get(content.content_id)
            if filters.get("account") and filters["account"] not in content.target_accounts:
                continue
            if filters.get("blocked") == "true" and (work_item is None or work_item.status.value != "BLOCKED"):
                continue
            if filters.get("needs_action") == "true" and work_item is None:
                continue
            requirements = self.application.get_asset_requirements(content.content_id)
            intake = self.application.get_asset_intake_status(content.content_id) if requirements else None
            items.append({
                "content": to_public_json(content),
                "work_item": to_public_json(work_item),
                "asset_intake": to_public_json(intake),
                "qa": to_public_json(self.application.list_qa_receipts(content.content_id)),
            })
        return {"items": items, "filters": dict(filters), "as_of": now.isoformat()}

    def content_detail(self, content_id: str) -> dict[str, Any]:
        now = self.now()
        detail = self.application.get_content_detail(content_id)
        queue_item = next(
            (item for item in self.application.get_work_queue(now=now) if item.content_id == content_id),
            None,
        )
        requirements = self.application.get_asset_requirements(content_id)
        packet = self._optional(lambda: self.application.get_visual_production_packet(content_id))
        publishing = []
        for account in detail.accounts:
            publishing.append(self._optional(
                lambda account_id=account.account_id: self.application.get_publishing_workbench(
                    content_id, account_id,
                ),
            ))
        activity = [item for item in self.application.get_activity() if item.content_id == content_id]
        return {
            "detail": to_public_json(detail),
            "work_item": to_public_json(queue_item),
            "requirements": to_public_json(requirements),
            "asset_intake": to_public_json(
                self.application.get_asset_intake_status(content_id) if requirements else None,
            ),
            "submissions": to_public_json(self.application.list_asset_submissions(content_id)),
            "visual_reviews": to_public_json(self.application.list_visual_review_records(content_id)),
            "production_packet": packet,
            "qa": to_public_json(self.application.list_qa_receipts(content_id)),
            "publishing": publishing,
            "activity": to_public_json(activity),
            "audit": to_public_json(self.application.get_audit_trail(content_id=content_id)),
        }

    def accounts(self) -> dict[str, Any]:
        now = self.now()
        return {
            "items": [{
                "account": to_public_json(account),
                "workload": to_public_json(self.application.get_account_workload(account.account_id, now=now)),
            } for account in self.application.list_accounts()],
            "as_of": now.isoformat(),
        }

    def account_detail(self, account_id: str) -> dict[str, Any]:
        account = next((item for item in self.application.list_accounts() if item.account_id == account_id), None)
        if account is None:
            raise UIAdapterError("NOT_FOUND", "Account not found", status=404)
        now = self.now()
        contents = [item for item in self.application.list_content() if account_id in item.target_accounts]
        content_ids = {item.content_id for item in contents}
        activity = [item for item in self.application.get_activity() if item.content_id in content_ids]
        return {
            "account": to_public_json(account),
            "workload": to_public_json(self.application.get_account_workload(account_id, now=now)),
            "contents": to_public_json(contents),
            "activity": to_public_json(activity),
        }

    def assets(self) -> dict[str, Any]:
        items = []
        for content in self.application.list_content():
            requirements = self.application.get_asset_requirements(content.content_id)
            items.append({
                "content": to_public_json(content),
                "requirements": to_public_json(requirements),
                "intake": to_public_json(
                    self.application.get_asset_intake_status(content.content_id) if requirements else None,
                ),
                "submissions": to_public_json(self.application.list_asset_submissions(content.content_id)),
                "reviews": to_public_json(self.application.list_visual_review_records(content.content_id)),
                "packet": self._optional(
                    lambda content_id=content.content_id: self.application.get_visual_production_packet(content_id),
                ),
            })
        return {"items": items}

    def reviews(self) -> dict[str, Any]:
        rows = []
        research = self.application.list_research()
        for content in self.application.list_content():
            detail = self.application.get_content_detail(content.content_id)
            post_publish = []
            for record in detail.publish_records:
                post_publish.append(self._optional(
                    lambda record_id=record.publish_record_id: self.application.get_review_workbench(
                        content.content_id, record_id,
                    ),
                ))
            rows.append({
                "content": to_public_json(content),
                "qa": to_public_json(self.application.list_qa_receipts(content.content_id)),
                "assets": to_public_json(detail.assets),
                "production_packet": self._optional(
                    lambda content_id=content.content_id:
                    self.application.get_visual_production_packet(content_id),
                ),
                "publishing": [self._optional(
                    lambda account_id=account.account_id, content_id=content.content_id:
                    self.application.get_publishing_workbench(content_id, account_id),
                ) for account in detail.accounts],
                "research": to_public_json(tuple(
                    item for item in research if item.account_id in content.target_accounts
                )),
                "publish_records": to_public_json(detail.publish_records),
                "post_publish_workbenches": post_publish,
            })
        return {"items": rows}

    def publishing(self) -> dict[str, Any]:
        rows = []
        for content in self.application.list_content():
            detail = self.application.get_content_detail(content.content_id)
            for account in detail.accounts:
                rows.append({
                    "content": to_public_json(content),
                    "account": to_public_json(account),
                    "workbench": self._optional(
                        lambda content_id=content.content_id, account_id=account.account_id:
                        self.application.get_publishing_workbench(content_id, account_id),
                    ),
                    "publish_records": to_public_json(detail.publish_records),
                    "metrics": to_public_json(detail.metrics),
                    "reviews": to_public_json(detail.reviews),
                })
        return {"items": rows}

    def research(self) -> dict[str, Any]:
        return {"items": to_public_json(self.application.list_research())}

    def health(self) -> dict[str, Any]:
        return {
            "health": to_public_json(self.application.health()),
            "runtime": to_public_json(self.application.get_runtime_info()),
            "tasks": to_public_json(self.application.list_runtime_tasks()),
            "recovery": to_public_json(self.application.list_recovery_evidence()),
            "audit": to_public_json(self.application.get_audit_trail()),
        }

    def visual_review(self, submission_id: str) -> dict[str, Any]:
        return {"workbench": to_public_json(self.application.get_visual_review_workbench(submission_id))}

    def preview_path(self, submission_id: str) -> Path:
        workbench = self.application.get_visual_review_workbench(submission_id)
        path = Path(workbench.managed_path).resolve()
        if not path.is_file():
            raise UIAdapterError("NOT_FOUND", "Managed preview is unavailable", status=404)
        return path

    def dispatch(self, action: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        if action not in self.ACTIONS:
            raise UIAdapterError("NOT_FOUND", "Unknown UI action", status=404)
        method = getattr(self, f"_action_{action}")
        try:
            value = method(dict(payload))
        except UIAdapterError:
            raise
        except CreatorOpsAPIError as exc:
            raise UIAdapterError(exc.code, str(exc)) from exc
        except (KeyError, TypeError, ValueError) as exc:
            raise UIAdapterError("VALIDATION_ERROR", str(exc)) from exc
        result = to_public_json(value)
        if isinstance(value, CommandResult) and value.status.value != "SUCCESS":
            return {"ok": False, "result": result}
        return {"ok": True, "result": result}

    def _action_update_work_item(self, data: dict[str, Any]) -> CommandResult:
        return self.application.update_work_item_overlay(
            work_item_id=str(data["work_item_id"]), content_id=str(data["content_id"]),
            status=str(data["status"]), due_at=_datetime_or_none(data.get("due_at")),
            blocked_reason=_text_or_none(data.get("blocked_reason")),
            operator_notes=_text_or_none(data.get("operator_notes")), now=self.now(),
        )

    def _action_submit_asset(self, data: dict[str, Any]) -> CommandResult:
        return self.application.submit_asset(
            str(data["content_id"]), str(data["requirement_id"]), str(data["asset_path"]),
            now=self.now(),
        )

    def _action_review_visual_asset(self, data: dict[str, Any]) -> CommandResult:
        if data.get("human_confirmation") is not True:
            raise UIAdapterError("CONFIRMATION_REQUIRED", "Visual review requires an explicit human confirmation")
        checks = data.get("operator_checks")
        if not isinstance(checks, Mapping):
            raise UIAdapterError("VALIDATION_ERROR", "operator_checks must be an object")
        return self.application.review_visual_asset(
            str(data["submission_id"]), decision=str(data["decision"]),
            operator_checks={str(key): str(value) for key, value in checks.items()},
            notes=_text_or_none(data.get("notes")), human_confirmation=True, now=self.now(),
        )

    def _action_run_qa(self, data: dict[str, Any]) -> CommandResult:
        content_id = str(data["content_id"])
        qa_type = str(data["qa_type"]).upper()
        if qa_type == "CONTENT":
            return self.application.run_content_qa(content_id, now=self.now())
        if qa_type == "ASSET":
            return self.application.run_asset_qa(content_id, now=self.now())
        if qa_type == "VISUAL":
            checks = data.get("operator_checks") or []
            if not isinstance(checks, Sequence) or isinstance(checks, (str, bytes)):
                raise UIAdapterError("VALIDATION_ERROR", "operator_checks must be a list")
            return self.application.run_visual_qa(
                content_id, package_id=_text_or_none(data.get("package_id")),
                operator_checks=checks, now=self.now(),
            )
        if qa_type == "PACKAGE":
            return self.application.run_package_qa(
                content_id, package_id=str(data["package_id"]),
                manifest_path=str(data["manifest_path"]), now=self.now(),
            )
        if qa_type == "PUBLISH_PREP":
            return self.application.run_publish_prep_qa(
                content_id, package_id=str(data["package_id"]), now=self.now(),
            )
        raise UIAdapterError("VALIDATION_ERROR", "Unknown QA type")

    def _action_editorial_review(self, data: dict[str, Any]) -> CommandResult:
        content_id = str(data["content_id"])
        decision = str(data["decision"]).upper()
        if decision == "APPROVE":
            return self.application.approve_review(content_id, now=self.now())
        if decision in {"REJECT", "REQUEST_CHANGES"}:
            return self.application.reject_review(content_id, now=self.now())
        raise UIAdapterError("VALIDATION_ERROR", "Unknown editorial decision")

    def _action_build_package(self, data: dict[str, Any]) -> CommandResult:
        return self.application.build_local_package(
            str(data["content_id"]), account_id=str(data["account_id"]),
            package_id=str(data["package_id"]), target_root=str(data["target_root"]),
            now=self.now(),
        )

    def _action_record_manual_publish(self, data: dict[str, Any]) -> CommandResult:
        if data.get("manual_confirmation") is not True:
            raise UIAdapterError("CONFIRMATION_REQUIRED", "Manual publish recording requires explicit confirmation")
        return self.application.confirm_manual_publish(
            str(data["content_id"]), str(data["account_id"]),
            actual_publish_time=_datetime_required(data.get("actual_publish_time")),
            manual_confirmation=True, now=self.now(),
            external_url=_text_or_none(data.get("external_url")),
            external_post_id=_text_or_none(data.get("external_post_id")),
        )

    def _action_record_metrics(self, data: dict[str, Any]) -> CommandResult:
        numeric = {name: _int_or_none(data.get(name)) for name in (
            "views", "impressions", "likes", "comments", "favorites", "shares", "followers_delta",
        )}
        return self.application.record_metrics(
            str(data["content_id"]), str(data["publish_record_id"]),
            metrics_id=str(data["metrics_id"]),
            collected_at=_datetime_required(data.get("collected_at")), now=self.now(),
            engagement=_float_or_none(data.get("engagement")), **numeric,
        )

    def _action_complete_post_publish_review(self, data: dict[str, Any]) -> CommandResult:
        return self.application.complete_review(
            str(data["content_id"]), str(data["publish_record_id"]), str(data["metrics_id"]),
            review_id=str(data["review_id"]), strengths=_string_list(data.get("strengths")),
            weaknesses=_string_list(data.get("weaknesses")),
            reusable_patterns=_string_list(data.get("reusable_patterns")),
            failed_patterns=_string_list(data.get("failed_patterns")),
            next_action=_text_or_none(data.get("next_action")),
            evidence=_string_list(data.get("evidence")), now=self.now(),
        )

    def _action_create_research(self, data: dict[str, Any]) -> CommandResult:
        return self.application.create_research(
            research_id=str(data["research_id"]), topic=str(data["topic"]),
            account_id=str(data["account_id"]), content_intent=str(data["content_intent"]),
            now=self.now(), source_reference="creator_ops_local_ui_v0.1",
        )

    def _action_add_research_source(self, data: dict[str, Any]) -> CommandResult:
        return self.application.add_research_source(
            str(data["research_id"]), source_id=str(data["source_id"]),
            source_type=str(data["source_type"]), reference=str(data["reference"]),
            summary=str(data["summary"]), evidence=_string_list(data.get("evidence")), now=self.now(),
        )

    def _action_synthesize_research(self, data: dict[str, Any]) -> CommandResult:
        return self.application.synthesize_research(str(data["research_id"]), now=self.now())

    def _action_plan_topics(self, data: dict[str, Any]) -> Any:
        return self.application.plan_topics(
            str(data["research_id"]), operator_intent=str(data["operator_intent"]),
        )

    def _action_recover_runtime(self, _: dict[str, Any]) -> CommandResult:
        return self.application.recover_runtime(now=self.now())

    def _action_set_work_portfolio(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.application.set_local_work_portfolio(
            str(data["work_id"]), included=data.get("included") is True,
        )

    def _action_set_work_move_permission(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.application.set_local_work_move_permission(enabled=data.get("enabled") is True)

    def _action_move_work_to_managed(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.application.move_local_work_to_managed(
            str(data["work_id"]), explicit_user_intent=data.get("explicit_user_intent") is True,
        )

    def _action_open_work_original(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.application.open_local_work_original(str(data["media_id"]))

    def _action_open_work_location(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.application.open_local_work_location(str(data["media_id"]))

    def _action_open_work_potplayer(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.application.open_local_work_potplayer(str(data["media_id"]))

    @staticmethod
    def _optional(call: Any) -> dict[str, Any]:
        try:
            return {"available": True, "data": to_public_json(call())}
        except Exception as exc:  # public read methods already sanitize storage errors
            code = getattr(exc, "code", "NOT_AVAILABLE")
            return {"available": False, "error": {"code": code, "message": str(exc)}}


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _datetime_or_none(value: Any) -> datetime | None:
    return None if _text_or_none(value) is None else _datetime_required(value)


def _datetime_required(value: Any) -> datetime:
    text = _text_or_none(value)
    if text is None:
        raise ValueError("datetime is required")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _int_or_none(value: Any) -> int | None:
    return None if _text_or_none(value) is None else int(str(value))


def _float_or_none(value: Any) -> float | None:
    return None if _text_or_none(value) is None else float(str(value))


def _string_list(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(item.strip() for item in value.splitlines() if item.strip())
    if isinstance(value, Sequence):
        return tuple(str(item).strip() for item in value if str(item).strip())
    raise ValueError("expected a list or newline-separated text")
