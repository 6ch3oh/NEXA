"""Manual publishing, metrics backfill, review and activity application views."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum
from typing import Sequence

from creator_ops.application.work_queue import (
    Priority, WorkItem, WorkItemStatus, WorkQueueService, WorkType,
)
from creator_ops.domain.models import (
    Account, AccountStatus, Asset, AssetStatus, AssetType, ContentItem, ContentState,
    ContentType, Metrics, Provenance, PublishRecord, Review, ReviewState,
)
from creator_ops.services.content_pipeline import (
    ContentPipelineService, ManualPublishResult, PipelineError,
)
from creator_ops.viewmodels.content_package import ContentPackageV01, build_content_package


class ChecklistStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"
    NOT_APPLICABLE = "NOT_APPLICABLE"


@dataclass(frozen=True)
class ReadinessCheck:
    check_id: str
    status: ChecklistStatus
    reason: str
    critical: bool = True


@dataclass(frozen=True)
class ManualPublishingWorkbench:
    content_id: str
    target_account: Account | None
    platform: str | None
    title: str | None
    body_or_script_reference: str | None
    asset_list: tuple[Asset, ...]
    cover_asset: Asset | None
    publish_notes: str | None
    planned_time: datetime | None
    readiness_checks: tuple[ReadinessCheck, ...]
    warnings: tuple[str, ...]
    manual_publish_confirmation_required: bool
    content_package: ContentPackageV01
    version: str = "0.1"

    @property
    def ready(self) -> bool:
        return not any(item.critical and item.status is ChecklistStatus.FAIL for item in self.readiness_checks)


@dataclass(frozen=True)
class ManualPublishCommandResult:
    pipeline_result: ManualPublishResult
    completed_work_item: WorkItem | None
    next_work_item: WorkItem | None


@dataclass(frozen=True)
class MetricsBackfillWorkbench:
    content_id: str
    publish_record_id: str
    platform: str
    account_id: str
    published_at: datetime
    metric_fields: tuple[str, ...]
    existing_metrics: Metrics | None
    missing_metrics: tuple[str, ...]
    collected_at: datetime | None
    version: str = "0.1"


@dataclass(frozen=True)
class ReviewWorkbench:
    content: ContentItem
    publish_record: PublishRecord
    metrics_snapshot: Metrics | None
    assets: tuple[Asset, ...]
    existing_review: Review | None
    missing_review_sections: tuple[str, ...]
    suggested_fields_to_fill: tuple[str, ...]
    version: str = "0.1"


class ActivityEventType(str, Enum):
    CONTENT_CREATED = "CONTENT_CREATED"
    STATE_CHANGED = "STATE_CHANGED"
    ASSET_ATTACHED = "ASSET_ATTACHED"
    CONTENT_REVIEW_COMPLETED = "CONTENT_REVIEW_COMPLETED"
    READY_TO_PUBLISH = "READY_TO_PUBLISH"
    MANUAL_PUBLISH_RECORDED = "MANUAL_PUBLISH_RECORDED"
    METRICS_RECORDED = "METRICS_RECORDED"
    POST_PUBLISH_REVIEW_COMPLETED = "POST_PUBLISH_REVIEW_COMPLETED"


@dataclass(frozen=True)
class ActivityEvent:
    event_type: ActivityEventType
    entity_id: str
    content_id: str
    occurred_at: datetime
    summary: str
    provenance: Provenance


class ManualPublishingWorkbenchService:
    def __init__(self, pipeline: ContentPipelineService | None = None) -> None:
        self.pipeline = pipeline or ContentPipelineService()

    def build(
        self, content: ContentItem, *, target_account_id: str, accounts: Sequence[Account],
        assets: Sequence[Asset], planned_time: datetime | None = None,
        publish_notes: str | None = None,
    ) -> ManualPublishingWorkbench:
        if content.current_state is not ContentState.READY_TO_PUBLISH:
            raise PipelineError("manual publishing workbench requires READY_TO_PUBLISH")
        package = build_content_package(content, accounts=accounts, assets=assets)
        account = next((item for item in accounts if item.account_id == target_account_id), None)
        asset_by_id = {item.asset_id: item for item in assets}
        linked_assets = tuple(asset_by_id[item] for item in content.asset_references if item in asset_by_id)
        cover = next((item for item in linked_assets if item.asset_type is AssetType.COVER), None)
        checks = self._checks(content, account=account, package=package)
        warnings = tuple(f"{item.check_id}:{item.reason}" for item in checks if item.status in {ChecklistStatus.FAIL, ChecklistStatus.UNKNOWN})
        return ManualPublishingWorkbench(
            content_id=content.content_id, target_account=account,
            platform=account.platform if account else None, title=content.title,
            body_or_script_reference=content.body or content.script_reference,
            asset_list=linked_assets, cover_asset=cover, publish_notes=publish_notes,
            planned_time=planned_time, readiness_checks=checks, warnings=warnings,
            manual_publish_confirmation_required=True, content_package=package,
        )

    def confirm_manual_publish(
        self, content: ContentItem, *, target_account_id: str, accounts: Sequence[Account],
        assets: Sequence[Asset], actual_publish_time: datetime,
        external_url: str | None, external_post_id: str | None,
        manual_confirmation: bool, provenance: Provenance, now: datetime,
        current_work_item: WorkItem,
    ) -> ManualPublishCommandResult:
        if current_work_item.content_id != content.content_id or current_work_item.work_type is not WorkType.MANUAL_PUBLISH:
            raise PipelineError("current work item must be the matching MANUAL_PUBLISH item")
        workbench = self.build(
            content, target_account_id=target_account_id, accounts=accounts, assets=assets,
        )
        if not workbench.ready:
            failed = [item.check_id for item in workbench.readiness_checks if item.critical and item.status is ChecklistStatus.FAIL]
            raise PipelineError("publish readiness checklist failed: " + ",".join(failed))
        if workbench.target_account is None or workbench.platform is None:
            raise PipelineError("target account is unavailable")
        # This is the only publish transition: delegate to the 002 pipeline.
        pipeline_result = self.pipeline.record_manual_publish(
            content, account=workbench.target_account, platform=workbench.platform,
            actual_publish_time=actual_publish_time, external_url=external_url,
            external_post_id=external_post_id, manual_confirmation=manual_confirmation,
            provenance=provenance, now=now,
        )
        completed = replace(
            current_work_item, status=WorkItemStatus.DONE, priority=Priority.LOW,
            priority_reason="Manual publication was confirmed", blocked_reason=None, updated_at=now,
        )
        queue = WorkQueueService().derive_work_items(
            (pipeline_result.content,), accounts=accounts, assets=assets,
            publish_records=(pipeline_result.publish_record,), metrics=(), reviews=(), now=now,
        )
        return ManualPublishCommandResult(pipeline_result, completed, queue[0])

    @staticmethod
    def _checks(
        content: ContentItem, *, account: Account | None, package: ContentPackageV01,
    ) -> tuple[ReadinessCheck, ...]:
        body_ready = bool((content.body and content.body.strip()) or (content.script_reference and content.script_reference.strip()))
        if content.asset_references:
            assets_ready = len(package.assets) == len(content.asset_references) and all(
                item.status in {AssetStatus.AVAILABLE, AssetStatus.REFERENCE_ONLY} for item in package.assets
            )
            asset_check = ReadinessCheck("REQUIRED_ASSETS_READY", ChecklistStatus.PASS if assets_ready else ChecklistStatus.FAIL,
                                         "All declared assets are ready" if assets_ready else "Declared assets are missing or not ready")
        elif content.content_type in {ContentType.IMAGE_POST, ContentType.SHORT_VIDEO, ContentType.LONG_VIDEO}:
            asset_check = ReadinessCheck("REQUIRED_ASSETS_READY", ChecklistStatus.FAIL, "Media content requires at least one asset")
        else:
            asset_check = ReadinessCheck("REQUIRED_ASSETS_READY", ChecklistStatus.NOT_APPLICABLE, "No required asset is declared")
        package_complete = bool(content.title and body_ready and account and not package.warnings)
        return (
            ReadinessCheck("CONTENT_BODY_READY", ChecklistStatus.PASS if body_ready else ChecklistStatus.FAIL,
                           "Body or script is ready" if body_ready else "Body and script reference are missing"),
            asset_check,
            ReadinessCheck("REVIEW_PASSED", ChecklistStatus.PASS if content.review_state is ReviewState.APPROVED else ChecklistStatus.FAIL,
                           "Review approved" if content.review_state is ReviewState.APPROVED else "Approved review is required"),
            ReadinessCheck("TARGET_ACCOUNT_EXISTS", ChecklistStatus.PASS if account else ChecklistStatus.FAIL,
                           "Target account found" if account else "Target account not found"),
            ReadinessCheck("ACCOUNT_ACTIVE", ChecklistStatus.PASS if account and account.status is AccountStatus.ACTIVE else ChecklistStatus.FAIL,
                           "Account active" if account and account.status is AccountStatus.ACTIVE else "Account is not active"),
            ReadinessCheck("NO_BLOCKED_STATE", ChecklistStatus.PASS if content.current_state is not ContentState.BLOCKED else ChecklistStatus.FAIL,
                           "Content is not blocked" if content.current_state is not ContentState.BLOCKED else "Content is blocked"),
            ReadinessCheck("PROVENANCE_ACCEPTABLE", ChecklistStatus.PASS if content.provenance.is_complete else ChecklistStatus.FAIL,
                           "Provenance complete" if content.provenance.is_complete else "Provenance is incomplete"),
            ReadinessCheck("PUBLISH_PACKAGE_COMPLETE", ChecklistStatus.PASS if package_complete else ChecklistStatus.FAIL,
                           "Publish package complete" if package_complete else "Title, body/script, account, or package relation is incomplete"),
        )


class MetricsBackfillWorkbenchService:
    METRIC_FIELDS = ("views", "impressions", "likes", "comments", "favorites", "shares", "followers_delta", "engagement")

    @classmethod
    def build(
        cls, content: ContentItem, publish_record: PublishRecord, metrics: Metrics | None,
    ) -> MetricsBackfillWorkbench:
        if publish_record.content_id != content.content_id or publish_record.actual_publish_time is None:
            raise PipelineError("metrics workbench requires matching published content")
        missing = cls.METRIC_FIELDS if metrics is None else tuple(
            field for field in cls.METRIC_FIELDS if getattr(metrics, field) is None
        )
        return MetricsBackfillWorkbench(
            content_id=content.content_id, publish_record_id=publish_record.publish_record_id,
            platform=publish_record.platform, account_id=publish_record.account_id,
            published_at=publish_record.actual_publish_time, metric_fields=cls.METRIC_FIELDS,
            existing_metrics=metrics, missing_metrics=tuple(missing),
            collected_at=metrics.collected_at if metrics else None,
        )


class ReviewWorkbenchService:
    REVIEW_FIELDS = ("strengths", "weaknesses", "reusable_patterns", "failed_patterns", "next_action", "evidence")

    @classmethod
    def build(
        cls, content: ContentItem, publish_record: PublishRecord, *, metrics: Metrics | None,
        assets: Sequence[Asset], existing_review: Review | None,
    ) -> ReviewWorkbench:
        if publish_record.content_id != content.content_id:
            raise PipelineError("review workbench requires matching publish record")
        linked = tuple(item for item in assets if content.content_id in item.content_relations or item.asset_id in content.asset_references)
        if existing_review is None:
            missing = cls.REVIEW_FIELDS
        else:
            missing = tuple(field for field in cls.REVIEW_FIELDS if not getattr(existing_review, field))
        return ReviewWorkbench(
            content=content, publish_record=publish_record, metrics_snapshot=metrics,
            assets=linked, existing_review=existing_review,
            missing_review_sections=tuple(missing), suggested_fields_to_fill=tuple(missing),
        )


class ActivityViewService:
    @staticmethod
    def derive(
        contents: Sequence[ContentItem], assets: Sequence[Asset], publish_records: Sequence[PublishRecord],
        metrics: Sequence[Metrics], reviews: Sequence[Review],
    ) -> tuple[ActivityEvent, ...]:
        events: list[ActivityEvent] = []
        content_by_id = {item.content_id: item for item in contents}
        for content in contents:
            events.append(ActivityEvent(ActivityEventType.CONTENT_CREATED, content.content_id, content.content_id,
                                        content.created_at, "Content created", content.provenance))
            events.append(ActivityEvent(ActivityEventType.STATE_CHANGED, content.content_id, content.content_id,
                                        content.updated_at, f"Current state: {content.current_state.value}", content.provenance))
            if content.review_state is ReviewState.APPROVED:
                events.append(ActivityEvent(ActivityEventType.CONTENT_REVIEW_COMPLETED, content.content_id, content.content_id,
                                            content.updated_at, "Content review approved", content.provenance))
            if content.current_state is ContentState.READY_TO_PUBLISH:
                events.append(ActivityEvent(ActivityEventType.READY_TO_PUBLISH, content.content_id, content.content_id,
                                            content.updated_at, "Content ready for manual publication", content.provenance))
        for asset in assets:
            for content_id in asset.content_relations:
                if content_id in content_by_id:
                    events.append(ActivityEvent(ActivityEventType.ASSET_ATTACHED, asset.asset_id, content_id,
                                                asset.updated_at, "Asset attached", asset.provenance))
        for record in publish_records:
            events.append(ActivityEvent(ActivityEventType.MANUAL_PUBLISH_RECORDED, record.publish_record_id,
                                        record.content_id, record.actual_publish_time or record.updated_at,
                                        "Manual publication recorded", record.provenance))
        publish_by_id = {item.publish_record_id: item for item in publish_records}
        for metric in metrics:
            record = publish_by_id.get(metric.publish_record_id)
            if record:
                events.append(ActivityEvent(ActivityEventType.METRICS_RECORDED, metric.metrics_id,
                                            record.content_id, metric.collected_at, "Metrics recorded", metric.provenance))
        for review in reviews:
            events.append(ActivityEvent(ActivityEventType.POST_PUBLISH_REVIEW_COMPLETED, review.review_id,
                                        review.content_id, review.reviewed_at, "Post-publish review completed", review.provenance))
        return tuple(sorted(events, key=lambda item: (item.occurred_at, item.entity_id), reverse=True))
