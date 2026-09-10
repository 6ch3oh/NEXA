"""Read-only presentation model for Creator Ops Phase 1."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import MappingProxyType
from typing import Mapping, Sequence

from creator_ops.domain.models import (
    Account, AccountStatus, Asset, AssetStatus, ContentItem, ContentState,
    Metrics, PublishRecord, PublishStatus, Review,
)


@dataclass(frozen=True)
class AccountSummary:
    total: int
    active: int
    paused_or_inactive: int
    legacy_codes: tuple[str, ...]


@dataclass(frozen=True)
class ContentSummary:
    content_id: str
    title: str | None
    state: str
    updated_at: datetime


@dataclass(frozen=True)
class AccountActivity:
    account_id: str
    targeted_content_count: int
    published_count: int


@dataclass(frozen=True)
class AssetReadiness:
    available_assets: int
    reference_only_assets: int
    content_with_assets: int
    ready_content_missing_assets: int


@dataclass(frozen=True)
class CreatorOpsOverview:
    generated_at: datetime
    account_summary: AccountSummary
    content_pipeline_counts: Mapping[str, int]
    ready_to_publish_count: int
    published_recently: tuple[ContentSummary, ...]
    metrics_pending: int
    reviews_pending: int
    recent_content: tuple[ContentSummary, ...]
    account_activity_summary: tuple[AccountActivity, ...]
    asset_readiness: AssetReadiness
    warnings: tuple[str, ...]
    version: str = "0.1"

    @property
    def ideas(self) -> int:
        return self.content_pipeline_counts.get(ContentState.IDEA.value, 0)

    @property
    def drafts(self) -> int:
        return self.content_pipeline_counts.get(ContentState.DRAFT.value, 0)

    @property
    def asset_preparation(self) -> int:
        return self.content_pipeline_counts.get(ContentState.ASSET_PREPARATION.value, 0)

    @property
    def under_review(self) -> int:
        return self.content_pipeline_counts.get(ContentState.REVIEW.value, 0)

    @property
    def ready_to_publish(self) -> int:
        return self.ready_to_publish_count

    @property
    def published(self) -> int:
        return self.content_pipeline_counts.get(ContentState.PUBLISHED.value, 0)

    @property
    def review_pending(self) -> int:
        return self.reviews_pending

    @property
    def blocked(self) -> int:
        return self.content_pipeline_counts.get(ContentState.BLOCKED.value, 0)

    @property
    def recent_activity(self) -> tuple[ContentSummary, ...]:
        return self.recent_content


def build_overview(
    accounts: Sequence[Account],
    contents: Sequence[ContentItem],
    assets: Sequence[Asset],
    publish_records: Sequence[PublishRecord],
    metrics: Sequence[Metrics],
    reviews: Sequence[Review],
    *,
    now: datetime | None = None,
    recent_days: int = 30,
) -> CreatorOpsOverview:
    """Build an immutable snapshot; this function performs no I/O."""
    generated = now or datetime.now(timezone.utc)
    if generated.tzinfo is None or generated.utcoffset() is None:
        raise ValueError("now must be timezone-aware")

    pipeline = Counter(item.current_state.value for item in contents)
    active = sum(account.status is AccountStatus.ACTIVE for account in accounts)
    codes = tuple(sorted(x.legacy_account_code for x in accounts if x.legacy_account_code))

    content_by_id = {item.content_id: item for item in contents}
    recent_cutoff = generated - timedelta(days=recent_days)
    recent_published_ids = {
        record.content_id for record in publish_records
        if record.publish_status is PublishStatus.PUBLISHED
        and record.actual_publish_time is not None
        and record.actual_publish_time >= recent_cutoff
    }
    published_recently = tuple(
        ContentSummary(item.content_id, item.title, item.current_state.value, item.updated_at)
        for item in sorted(
            (content_by_id[x] for x in recent_published_ids if x in content_by_id),
            key=lambda x: x.updated_at,
            reverse=True,
        )
    )

    published_record_ids = {
        record.publish_record_id for record in publish_records
        if record.publish_status is PublishStatus.PUBLISHED
    }
    metrics_record_ids = {item.publish_record_id for item in metrics}
    review_record_ids = {item.publish_record_id for item in reviews}
    linked_content = {content_id for asset in assets for content_id in asset.content_relations}
    ready_contents = [x for x in contents if x.current_state is ContentState.READY_TO_PUBLISH]

    activities = []
    for account in sorted(accounts, key=lambda x: x.account_id):
        targeted = sum(account.account_id in item.target_accounts for item in contents)
        published = sum(
            record.account_id == account.account_id and record.publish_status is PublishStatus.PUBLISHED
            for record in publish_records
        )
        activities.append(AccountActivity(account.account_id, targeted, published))

    warnings = []
    incomplete = sum(not item.provenance.is_complete for item in (*accounts, *contents, *assets, *publish_records, *metrics, *reviews))
    if incomplete:
        warnings.append(f"INCOMPLETE_PROVENANCE:{incomplete}")
    ready_missing = sum(item.content_id not in linked_content for item in ready_contents)
    if ready_missing:
        warnings.append(f"READY_CONTENT_WITHOUT_ASSET:{ready_missing}")
    if any(code not in codes for code in ("A1", "A2", "B1", "B2", "B3", "B4")):
        warnings.append("LEGACY_ACCOUNT_MATRIX_INCOMPLETE")

    recent_content = tuple(
        ContentSummary(item.content_id, item.title, item.current_state.value, item.updated_at)
        for item in sorted(contents, key=lambda x: x.updated_at, reverse=True)[:10]
    )
    return CreatorOpsOverview(
        generated_at=generated,
        account_summary=AccountSummary(len(accounts), active, len(accounts) - active, codes),
        content_pipeline_counts=MappingProxyType(dict(sorted(pipeline.items()))),
        ready_to_publish_count=len(ready_contents),
        published_recently=published_recently,
        metrics_pending=len(published_record_ids - metrics_record_ids),
        reviews_pending=len(published_record_ids - review_record_ids),
        recent_content=recent_content,
        account_activity_summary=tuple(activities),
        asset_readiness=AssetReadiness(
            available_assets=sum(x.status is AssetStatus.AVAILABLE for x in assets),
            reference_only_assets=sum(x.status is AssetStatus.REFERENCE_ONLY for x in assets),
            content_with_assets=len(linked_content),
            ready_content_missing_assets=ready_missing,
        ),
        warnings=tuple(warnings),
    )
