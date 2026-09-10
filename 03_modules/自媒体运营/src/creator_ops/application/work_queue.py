"""Derived Creator Ops work queue, next-action and priority contracts V0.1."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from types import MappingProxyType
from typing import Mapping, Sequence

from creator_ops.domain.models import (
    Account, AccountStatus, Asset, AssetStatus, ContentItem, ContentState,
    Metrics, Provenance, PublishRecord, Review, ReviewState,
)


class WorkType(str, Enum):
    TOPIC = "TOPIC"
    DRAFT = "DRAFT"
    ASSET = "ASSET"
    REVIEW = "REVIEW"
    PUBLISH_PREP = "PUBLISH_PREP"
    MANUAL_PUBLISH = "MANUAL_PUBLISH"
    METRICS_BACKFILL = "METRICS_BACKFILL"
    POST_PUBLISH_REVIEW = "POST_PUBLISH_REVIEW"


class WorkItemStatus(str, Enum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    DONE = "DONE"
    CANCELLED = "CANCELLED"


class Priority(str, Enum):
    URGENT = "URGENT"
    HIGH = "HIGH"
    NORMAL = "NORMAL"
    LOW = "LOW"


class FieldOwnership(str, Enum):
    DERIVED = "DERIVED"
    OPERATOR_STATE = "OPERATOR_STATE"


class BlockerCode(str, Enum):
    MISSING_CONTENT = "MISSING_CONTENT"
    MISSING_ASSET = "MISSING_ASSET"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    REVIEW_REJECTED = "REVIEW_REJECTED"
    ACCOUNT_INVALID = "ACCOUNT_INVALID"
    ACCOUNT_INACTIVE = "ACCOUNT_INACTIVE"
    PROVENANCE_INCOMPLETE = "PROVENANCE_INCOMPLETE"
    PUBLISH_PACKAGE_INCOMPLETE = "PUBLISH_PACKAGE_INCOMPLETE"
    MANUAL_CONFIRMATION_REQUIRED = "MANUAL_CONFIRMATION_REQUIRED"
    METRICS_MISSING = "METRICS_MISSING"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class Blocker:
    code: BlockerCode
    message: str
    source: str
    blocking: bool


class NextActionType(str, Enum):
    WRITE_DRAFT = "WRITE_DRAFT"
    PREPARE_ASSETS = "PREPARE_ASSETS"
    GENERATE_ASSET = "GENERATE_ASSET"
    SUBMIT_ASSET = "SUBMIT_ASSET"
    VERIFY_ASSET = "VERIFY_ASSET"
    VISUAL_REVIEW = "VISUAL_REVIEW"
    REVIEW_CONTENT = "REVIEW_CONTENT"
    REVISE_DRAFT = "REVISE_DRAFT"
    MANUAL_PUBLISH = "MANUAL_PUBLISH"
    BACKFILL_METRICS = "BACKFILL_METRICS"
    REVIEW_PERFORMANCE = "REVIEW_PERFORMANCE"
    RESOLVE_BLOCKER = "RESOLVE_BLOCKER"
    NONE = "NONE"


@dataclass(frozen=True)
class NextAction:
    content_id: str
    current_state: ContentState
    next_action_type: NextActionType
    next_action_label: str
    blocking_reason: str | None
    required_inputs: tuple[str, ...]
    readiness: str


@dataclass(frozen=True)
class OperatorWorkState:
    status: WorkItemStatus
    due_at: datetime | None = None
    blocked_reason: str | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class WorkItem:
    work_item_id: str
    content_id: str
    work_type: WorkType
    status: WorkItemStatus
    priority: Priority
    priority_reason: str
    account_ids: tuple[str, ...]
    due_at: datetime | None
    blocked_reason: str | None
    blockers: tuple[Blocker, ...]
    next_action: NextAction
    created_at: datetime
    updated_at: datetime
    provenance: Provenance
    field_ownership: Mapping[str, FieldOwnership] = field(
        default_factory=lambda: MappingProxyType({
            "work_item_id": FieldOwnership.DERIVED,
            "content_id": FieldOwnership.DERIVED,
            "work_type": FieldOwnership.DERIVED,
            "priority": FieldOwnership.DERIVED,
            "account_ids": FieldOwnership.DERIVED,
            "next_action": FieldOwnership.DERIVED,
            "provenance": FieldOwnership.DERIVED,
            "status": FieldOwnership.OPERATOR_STATE,
            "due_at": FieldOwnership.OPERATOR_STATE,
            "blocked_reason": FieldOwnership.OPERATOR_STATE,
        })
    )
    version: str = "0.1"


class NextActionResolver:
    @staticmethod
    def resolve(
        content: ContentItem, *, has_metrics: bool, has_review: bool,
        blockers: Sequence[Blocker],
    ) -> NextAction:
        blocking = next((item for item in blockers if item.blocking), None)
        if content.current_state is ContentState.BLOCKED:
            return NextAction(content.content_id, content.current_state, NextActionType.RESOLVE_BLOCKER,
                              "Resolve blocker", blocking.message if blocking else "Content is blocked",
                              ("blocker_resolution",), "BLOCKED")
        if content.current_state is ContentState.IDEA:
            return NextAction(content.content_id, content.current_state, NextActionType.WRITE_DRAFT,
                              "Write draft", None, ("title", "body_or_script"), "READY")
        if content.current_state is ContentState.DRAFT:
            return NextAction(content.content_id, content.current_state, NextActionType.PREPARE_ASSETS,
                              "Prepare assets", None, ("asset_plan",), "READY")
        if content.current_state is ContentState.ASSET_PREPARATION:
            return NextAction(content.content_id, content.current_state, NextActionType.PREPARE_ASSETS,
                              "Complete required assets", blocking.message if blocking else None,
                              ("available_assets",), "BLOCKED" if blocking else "READY")
        if content.current_state is ContentState.REVIEW:
            return NextAction(content.content_id, content.current_state, NextActionType.REVIEW_CONTENT,
                              "Review content", None, ("review_decision",), "READY")
        if content.current_state is ContentState.REJECTED:
            return NextAction(content.content_id, content.current_state, NextActionType.REVISE_DRAFT,
                              "Revise rejected content", blocking.message if blocking else "Review rejected",
                              ("revisions",), "BLOCKED")
        if content.current_state is ContentState.READY_TO_PUBLISH:
            return NextAction(content.content_id, content.current_state, NextActionType.MANUAL_PUBLISH,
                              "Publish manually and confirm", blocking.message if blocking else None,
                              ("manual_confirmation", "actual_publish_time"), "BLOCKED" if blocking else "READY")
        if content.current_state in {ContentState.PUBLISHED, ContentState.METRICS_PENDING}:
            if not has_metrics:
                return NextAction(content.content_id, content.current_state, NextActionType.BACKFILL_METRICS,
                                  "Backfill metrics", None, ("metric_snapshot", "collected_at"), "READY")
            if not has_review:
                return NextAction(content.content_id, content.current_state, NextActionType.REVIEW_PERFORMANCE,
                                  "Review performance", None, ("review_sections",), "READY")
        return NextAction(content.content_id, content.current_state, NextActionType.NONE,
                          "No action", None, (), "COMPLETE")


class PriorityResolver:
    @staticmethod
    def resolve(
        *, work_type: WorkType, status: WorkItemStatus, due_at: datetime | None, now: datetime,
    ) -> tuple[Priority, str]:
        if status is WorkItemStatus.BLOCKED:
            return Priority.URGENT, "Blocking issue requires operator resolution"
        if due_at is not None and due_at < now and status not in {WorkItemStatus.DONE, WorkItemStatus.CANCELLED}:
            return Priority.URGENT, f"Overdue since {due_at.isoformat()}"
        if status in {WorkItemStatus.DONE, WorkItemStatus.CANCELLED}:
            return Priority.LOW, "Work item is terminal"
        if work_type is WorkType.MANUAL_PUBLISH:
            return Priority.HIGH, "Content is ready for manual publication"
        if work_type is WorkType.METRICS_BACKFILL:
            return Priority.HIGH, "Published content is missing metrics"
        if work_type in {WorkType.REVIEW, WorkType.POST_PUBLISH_REVIEW}:
            return Priority.HIGH, "Review action is pending"
        if work_type is WorkType.TOPIC:
            return Priority.LOW, "Idea is at the start of the pipeline"
        return Priority.NORMAL, "Active pipeline work"


class WorkQueueService:
    """Derive operational work from domain truth plus explicit operator overrides."""

    def __init__(self) -> None:
        self.next_action_resolver = NextActionResolver()
        self.priority_resolver = PriorityResolver()

    def derive_work_items(
        self, contents: Sequence[ContentItem], *, accounts: Sequence[Account], assets: Sequence[Asset],
        publish_records: Sequence[PublishRecord], metrics: Sequence[Metrics], reviews: Sequence[Review],
        now: datetime, due_dates: Mapping[str, datetime] | None = None,
        operator_states: Mapping[str, OperatorWorkState] | None = None,
        asset_pipeline_actions: Mapping[str, str] | None = None,
    ) -> tuple[WorkItem, ...]:
        due_dates = due_dates or {}
        operator_states = operator_states or {}
        asset_pipeline_actions = asset_pipeline_actions or {}
        publish_by_content = {item.content_id: item for item in publish_records}
        metrics_record_ids = {item.publish_record_id for item in metrics}
        review_record_ids = {item.publish_record_id for item in reviews}
        work_items = []
        for content in contents:
            publish = publish_by_content.get(content.content_id)
            has_metrics = bool(publish and publish.publish_record_id in metrics_record_ids)
            has_review = bool(publish and publish.publish_record_id in review_record_ids)
            blockers = self._derive_blockers(content, accounts=accounts, assets=assets,
                                             has_metrics=has_metrics, has_review=has_review)
            work_type = self._work_type(content, has_metrics=has_metrics, has_review=has_review)
            next_action = self.next_action_resolver.resolve(
                content, has_metrics=has_metrics, has_review=has_review, blockers=blockers,
            )
            pipeline_action = asset_pipeline_actions.get(content.content_id)
            if content.current_state is ContentState.ASSET_PREPARATION and pipeline_action in {
                "GENERATE_ASSET", "SUBMIT_ASSET", "VERIFY_ASSET", "VISUAL_REVIEW",
            }:
                action_type = NextActionType(pipeline_action)
                label, inputs = {
                    NextActionType.GENERATE_ASSET: ("Generate required visual assets", ("visual_production_packet",)),
                    NextActionType.SUBMIT_ASSET: ("Submit generated asset", ("requirement_id", "asset_path")),
                    NextActionType.VERIFY_ASSET: ("Verify submitted asset", ("validated_submission",)),
                    NextActionType.VISUAL_REVIEW: ("Complete human visual review", ("visual_review_decision",)),
                }[action_type]
                next_action = NextAction(
                    content.content_id, content.current_state, action_type, label,
                    next((item.message for item in blockers if item.blocking), None),
                    inputs, "BLOCKED",
                )
            work_id = f"work:{content.content_id}:{work_type.value.lower()}"
            due_at = due_dates.get(content.content_id)
            status = self._derived_status(content, blockers, next_action)
            blocked_reason = next((item.message for item in blockers if item.blocking), None)
            updated_at = content.updated_at
            override = operator_states.get(work_id)
            if override is not None:
                status = override.status
                due_at = override.due_at if override.due_at is not None else due_at
                blocked_reason = override.blocked_reason if override.blocked_reason is not None else blocked_reason
                updated_at = override.updated_at or updated_at
            priority, reason = self.priority_resolver.resolve(
                work_type=work_type, status=status, due_at=due_at, now=now,
            )
            work_items.append(WorkItem(
                work_item_id=work_id, content_id=content.content_id, work_type=work_type,
                status=status, priority=priority, priority_reason=reason,
                account_ids=content.target_accounts, due_at=due_at,
                blocked_reason=blocked_reason, blockers=tuple(blockers), next_action=next_action,
                created_at=content.created_at, updated_at=updated_at, provenance=content.provenance,
            ))
        rank = {Priority.URGENT: 0, Priority.HIGH: 1, Priority.NORMAL: 2, Priority.LOW: 3}
        return tuple(sorted(work_items, key=lambda item: (
            rank[item.priority], item.due_at or datetime.max.replace(tzinfo=now.tzinfo),
            item.created_at, item.work_item_id,
        )))

    def get_next_actions(self, items: Sequence[WorkItem]) -> tuple[NextAction, ...]:
        return tuple(item.next_action for item in items if item.next_action.next_action_type is not NextActionType.NONE)

    def get_blocked_items(self, items: Sequence[WorkItem]) -> tuple[WorkItem, ...]:
        return tuple(item for item in items if item.status is WorkItemStatus.BLOCKED)

    def get_ready_to_publish_items(self, items: Sequence[WorkItem]) -> tuple[WorkItem, ...]:
        return tuple(item for item in items if item.work_type is WorkType.MANUAL_PUBLISH
                     and item.status not in {WorkItemStatus.DONE, WorkItemStatus.CANCELLED})

    def get_metrics_backfill_items(self, items: Sequence[WorkItem]) -> tuple[WorkItem, ...]:
        return tuple(item for item in items if item.work_type is WorkType.METRICS_BACKFILL
                     and item.status not in {WorkItemStatus.DONE, WorkItemStatus.CANCELLED})

    def get_review_pending_items(self, items: Sequence[WorkItem]) -> tuple[WorkItem, ...]:
        return tuple(item for item in items if item.work_type in {WorkType.REVIEW, WorkType.POST_PUBLISH_REVIEW}
                     and item.status not in {WorkItemStatus.DONE, WorkItemStatus.CANCELLED})

    @staticmethod
    def _work_type(content: ContentItem, *, has_metrics: bool, has_review: bool) -> WorkType:
        state = content.current_state
        if state is ContentState.IDEA:
            return WorkType.DRAFT
        if state in {ContentState.DRAFT, ContentState.ASSET_PREPARATION}:
            return WorkType.ASSET
        if state is ContentState.REVIEW:
            return WorkType.REVIEW
        if state is ContentState.REJECTED:
            return WorkType.DRAFT
        if state is ContentState.READY_TO_PUBLISH:
            return WorkType.MANUAL_PUBLISH
        if state in {ContentState.PUBLISHED, ContentState.METRICS_PENDING}:
            if not has_metrics:
                return WorkType.METRICS_BACKFILL
            return WorkType.POST_PUBLISH_REVIEW
        if state is ContentState.REVIEWED:
            return WorkType.POST_PUBLISH_REVIEW
        if state is ContentState.ARCHIVED:
            return WorkType.TOPIC
        if state is ContentState.BLOCKED:
            blocked_from = str(content.extension_fields.get("blocked_from", "IDEA"))
            return {
                "DRAFT": WorkType.ASSET, "ASSET_PREPARATION": WorkType.ASSET,
                "REVIEW": WorkType.REVIEW, "READY_TO_PUBLISH": WorkType.MANUAL_PUBLISH,
                "PUBLISHED": WorkType.METRICS_BACKFILL,
            }.get(blocked_from, WorkType.TOPIC)
        return WorkType.TOPIC

    @staticmethod
    def _derived_status(
        content: ContentItem, blockers: Sequence[Blocker], next_action: NextAction,
    ) -> WorkItemStatus:
        if content.current_state is ContentState.ARCHIVED:
            return WorkItemStatus.CANCELLED
        if content.current_state is ContentState.REVIEWED or next_action.next_action_type is NextActionType.NONE:
            return WorkItemStatus.DONE
        if content.current_state is ContentState.BLOCKED or any(item.blocking for item in blockers):
            return WorkItemStatus.BLOCKED
        return WorkItemStatus.OPEN

    @staticmethod
    def _derive_blockers(
        content: ContentItem, *, accounts: Sequence[Account], assets: Sequence[Asset],
        has_metrics: bool, has_review: bool,
    ) -> tuple[Blocker, ...]:
        blockers: list[Blocker] = []
        account_by_id = {item.account_id: item for item in accounts}
        asset_by_id = {item.asset_id: item for item in assets}
        for account_id in content.target_accounts:
            account = account_by_id.get(account_id)
            if account is None:
                blockers.append(Blocker(BlockerCode.ACCOUNT_INVALID, f"Account not found: {account_id}", "Account", True))
            elif account.status is not AccountStatus.ACTIVE:
                blockers.append(Blocker(BlockerCode.ACCOUNT_INACTIVE, f"Account not active: {account_id}", "Account", True))
        if content.current_state in {ContentState.ASSET_PREPARATION, ContentState.REVIEW, ContentState.READY_TO_PUBLISH}:
            if not content.asset_references and content.content_type.value in {"IMAGE_POST", "SHORT_VIDEO", "LONG_VIDEO"}:
                blockers.append(Blocker(BlockerCode.MISSING_ASSET, "Required media asset is missing", "Asset", True))
            for asset_id in content.asset_references:
                asset = asset_by_id.get(asset_id)
                if asset is None or asset.status not in {AssetStatus.AVAILABLE, AssetStatus.REFERENCE_ONLY}:
                    blockers.append(Blocker(BlockerCode.MISSING_ASSET, f"Asset not ready: {asset_id}", "Asset", True))
        if content.current_state is ContentState.REVIEW and content.review_state is not ReviewState.APPROVED:
            blockers.append(Blocker(BlockerCode.REVIEW_REQUIRED, "Review decision is pending", "Review", False))
        if content.current_state is ContentState.REJECTED:
            blockers.append(Blocker(BlockerCode.REVIEW_REJECTED, "Content review was rejected", "Review", True))
        if content.current_state is ContentState.READY_TO_PUBLISH:
            if not (content.body and content.body.strip()) and not (content.script_reference and content.script_reference.strip()):
                blockers.append(Blocker(BlockerCode.MISSING_CONTENT, "Body or script reference is missing", "ContentItem", True))
            if content.review_state is not ReviewState.APPROVED:
                blockers.append(Blocker(BlockerCode.REVIEW_REQUIRED, "Approved review is required", "Review", True))
            if not content.title:
                blockers.append(Blocker(BlockerCode.PUBLISH_PACKAGE_INCOMPLETE, "Publish title is missing", "ContentPackage", True))
            if not content.provenance.is_complete:
                blockers.append(Blocker(BlockerCode.PROVENANCE_INCOMPLETE, "Content provenance is incomplete", "Provenance", True))
        if content.current_state in {ContentState.PUBLISHED, ContentState.METRICS_PENDING} and not has_metrics:
            blockers.append(Blocker(BlockerCode.METRICS_MISSING, "Published content has no metric snapshot", "Metrics", False))
        if content.current_state in {ContentState.PUBLISHED, ContentState.METRICS_PENDING} and has_metrics and not has_review:
            blockers.append(Blocker(BlockerCode.REVIEW_REQUIRED, "Post-publish review is pending", "Review", False))
        if content.current_state is ContentState.BLOCKED:
            reason = str(content.extension_fields.get("block_reason") or "Content is blocked")
            blockers.append(Blocker(BlockerCode.UNKNOWN, reason, "ContentItem.current_state", True))
        return tuple(blockers)
