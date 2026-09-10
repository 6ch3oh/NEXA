"""Read-only Operator Dashboard ViewModel V0.1."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Mapping, Sequence

from creator_ops.application.work_queue import (
    NextAction, OperatorWorkState, WorkItem, WorkItemStatus, WorkQueueService, WorkType,
)
from creator_ops.application.workbenches import (
    ActivityEvent, ActivityViewService, ManualPublishingWorkbench,
    ManualPublishingWorkbenchService, MetricsBackfillWorkbench,
    MetricsBackfillWorkbenchService, ReviewWorkbench, ReviewWorkbenchService,
)
from creator_ops.domain.models import (
    Account, Asset, ContentItem, ContentState, Metrics, PublishRecord, PublishStatus, Review,
)


@dataclass(frozen=True)
class OperatorSummary:
    total_active: int
    needs_action: int
    ready_to_publish: int
    blocked: int
    metrics_pending: int
    review_pending: int


@dataclass(frozen=True)
class AccountWorkload:
    account_id: str
    legacy_account_code: str | None
    active_content_count: int
    ready_to_publish_count: int
    blocked_count: int
    published_recently: int
    metrics_pending: int
    review_pending: int


@dataclass(frozen=True)
class OperatorDashboard:
    summary: OperatorSummary
    work_queue: tuple[WorkItem, ...]
    next_actions: tuple[NextAction, ...]
    ready_to_publish: tuple[ManualPublishingWorkbench, ...]
    blocked_items: tuple[WorkItem, ...]
    metrics_backfill: tuple[MetricsBackfillWorkbench, ...]
    review_pending: tuple[ReviewWorkbench, ...]
    recently_published: tuple[PublishRecord, ...]
    account_workload: tuple[AccountWorkload, ...]
    activity_feed: tuple[ActivityEvent, ...]
    warnings: tuple[str, ...]
    data_classification: str = "TEST / SYNTHETIC"
    version: str = "0.1"


def build_account_workload(
    accounts: Sequence[Account], contents: Sequence[ContentItem], publish_records: Sequence[PublishRecord],
    metrics: Sequence[Metrics], reviews: Sequence[Review], *, now: datetime, recent_days: int = 30,
    work_queue: Sequence[WorkItem] | None = None,
) -> tuple[AccountWorkload, ...]:
    metrics_ids = {item.publish_record_id for item in metrics}
    review_ids = {item.publish_record_id for item in reviews}
    cutoff = now - timedelta(days=recent_days)
    result = []
    for account in sorted(accounts, key=lambda item: item.account_id):
        account_contents = [item for item in contents if account.account_id in item.target_accounts]
        records = [item for item in publish_records if item.account_id == account.account_id and item.publish_status is PublishStatus.PUBLISHED]
        blocked_content_ids = {
            item.content_id for item in account_contents
            if item.current_state in {ContentState.BLOCKED, ContentState.REJECTED}
        }
        blocked_content_ids.update(
            item.content_id for item in (work_queue or ())
            if account.account_id in item.account_ids and item.status is WorkItemStatus.BLOCKED
        )
        result.append(AccountWorkload(
            account_id=account.account_id, legacy_account_code=account.legacy_account_code,
            active_content_count=sum(item.current_state not in {ContentState.ARCHIVED, ContentState.REVIEWED} for item in account_contents),
            ready_to_publish_count=sum(item.current_state is ContentState.READY_TO_PUBLISH for item in account_contents),
            blocked_count=len(blocked_content_ids),
            published_recently=sum(item.actual_publish_time is not None and item.actual_publish_time >= cutoff for item in records),
            metrics_pending=sum(item.publish_record_id not in metrics_ids for item in records),
            review_pending=sum(item.publish_record_id in metrics_ids and item.publish_record_id not in review_ids for item in records),
        ))
    return tuple(result)


def build_operator_dashboard(
    accounts: Sequence[Account], contents: Sequence[ContentItem], assets: Sequence[Asset],
    publish_records: Sequence[PublishRecord], metrics: Sequence[Metrics], reviews: Sequence[Review],
    *, now: datetime, due_dates: Mapping[str, datetime] | None = None,
    operator_states: Mapping[str, OperatorWorkState] | None = None,
    work_queue: Sequence[WorkItem] | None = None,
    data_classification: str = "TEST / SYNTHETIC",
) -> OperatorDashboard:
    queue_service = WorkQueueService()
    queue = tuple(work_queue) if work_queue is not None else queue_service.derive_work_items(
        contents, accounts=accounts, assets=assets, publish_records=publish_records,
        metrics=metrics, reviews=reviews, now=now, due_dates=due_dates,
        operator_states=operator_states,
    )
    content_by_id = {item.content_id: item for item in contents}
    account_by_id = {item.account_id: item for item in accounts}
    publish_by_content = {item.content_id: item for item in publish_records}
    metrics_by_record = {item.publish_record_id: item for item in metrics}
    review_by_record = {item.publish_record_id: item for item in reviews}

    ready_views = []
    for item in queue_service.get_ready_to_publish_items(queue):
        content = content_by_id[item.content_id]
        for account_id in content.target_accounts:
            ready_views.append(ManualPublishingWorkbenchService().build(
                content, target_account_id=account_id, accounts=accounts, assets=assets,
            ))

    metric_views = []
    for item in queue_service.get_metrics_backfill_items(queue):
        content = content_by_id[item.content_id]
        record = publish_by_content.get(content.content_id)
        if record is not None:
            metric_views.append(MetricsBackfillWorkbenchService.build(
                content, record, metrics_by_record.get(record.publish_record_id),
            ))

    review_views = []
    for item in queue:
        if item.work_type is not WorkType.POST_PUBLISH_REVIEW or item.status in {WorkItemStatus.DONE, WorkItemStatus.CANCELLED}:
            continue
        content = content_by_id[item.content_id]
        record = publish_by_content.get(content.content_id)
        if record is not None:
            review_views.append(ReviewWorkbenchService.build(
                content, record, metrics=metrics_by_record.get(record.publish_record_id),
                assets=assets, existing_review=review_by_record.get(record.publish_record_id),
            ))

    blocked = queue_service.get_blocked_items(queue)
    next_actions = queue_service.get_next_actions(queue)
    recent_cutoff = now - timedelta(days=30)
    recent = tuple(sorted(
        (item for item in publish_records if item.actual_publish_time is not None and item.actual_publish_time >= recent_cutoff),
        key=lambda item: item.actual_publish_time,
        reverse=True,
    ))
    warnings = [warning for view in ready_views for warning in view.warnings]
    if any(not item.provenance.is_complete for item in contents):
        warnings.append("INCOMPLETE_CONTENT_PROVENANCE")
    if any(account_id not in account_by_id for content in contents for account_id in content.target_accounts):
        warnings.append("UNKNOWN_TARGET_ACCOUNT")
    active_queue = [item for item in queue if item.status not in {WorkItemStatus.DONE, WorkItemStatus.CANCELLED}]
    return OperatorDashboard(
        summary=OperatorSummary(
            total_active=sum(item.current_state not in {ContentState.ARCHIVED, ContentState.REVIEWED} for item in contents),
            needs_action=len(active_queue),
            ready_to_publish=len(ready_views), blocked=len(blocked),
            metrics_pending=len(metric_views), review_pending=len(review_views),
        ),
        work_queue=queue, next_actions=next_actions, ready_to_publish=tuple(ready_views),
        blocked_items=blocked, metrics_backfill=tuple(metric_views),
        review_pending=tuple(review_views), recently_published=recent,
        account_workload=build_account_workload(
            accounts, contents, publish_records, metrics, reviews, now=now, work_queue=queue,
        ),
        activity_feed=ActivityViewService.derive(contents, assets, publish_records, metrics, reviews),
        warnings=tuple(dict.fromkeys(warnings)),
        data_classification=data_classification,
    )
