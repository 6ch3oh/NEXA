"""Deterministic Creator Ops content pipeline service V0.1."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum
from typing import Sequence

from creator_ops.domain.models import (
    Account, AccountStatus, Asset, AssetStatus, ContentItem, ContentState, ContentType,
    ContractError, Metrics, Provenance, PublicationMode, PublishReadiness,
    PublishRecord, PublishStatus, Review, ReviewState, ReviewStatus,
)
from creator_ops.state.machine import transition


class PipelineError(ContractError):
    pass


class MetricsInputMode(str, Enum):
    MANUAL = "MANUAL"
    FIXTURE = "FIXTURE"
    FUTURE_ADAPTER = "FUTURE_ADAPTER"


@dataclass(frozen=True)
class ReadyGateResult:
    passed: bool
    failures: tuple[str, ...]


@dataclass(frozen=True)
class ManualPublishResult:
    content: ContentItem
    publish_record: PublishRecord


@dataclass(frozen=True)
class MetricsRecordResult:
    content: ContentItem
    metrics: Metrics


@dataclass(frozen=True)
class ReviewLoopResult:
    content: ContentItem
    review: Review


def _aware(name: str, value: datetime) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise PipelineError(f"{name} must be timezone-aware")


class ContentPipelineService:
    """Pure domain operations; contains no networking or platform client."""

    @staticmethod
    def create_idea(
        *, content_id: str, creator_id: str, target_accounts: Sequence[str], topic: str,
        content_type: ContentType, platform_intent: Sequence[str], provenance: Provenance,
        source: str, now: datetime,
    ) -> ContentItem:
        _aware("now", now)
        return ContentItem(
            content_id=content_id, creator_id=creator_id, target_accounts=tuple(target_accounts),
            topic=topic, title=None, body=None, script_reference=None, content_type=content_type,
            platform_intent=tuple(platform_intent), asset_references=(), current_state=ContentState.IDEA,
            review_state=ReviewState.PENDING, publish_readiness=PublishReadiness.NOT_READY,
            source=source, provenance=provenance, created_at=now, updated_at=now,
        )

    def start_draft(
        self, content: ContentItem, *, title: str | None, body: str | None,
        script_reference: str | None, now: datetime,
    ) -> ContentItem:
        return replace(
            self._move(content, ContentState.DRAFT, now),
            title=title, body=body, script_reference=script_reference,
        )

    def attach_asset(self, content: ContentItem, asset: Asset, *, now: datetime) -> ContentItem:
        if asset.status not in {AssetStatus.AVAILABLE, AssetStatus.REFERENCE_ONLY}:
            raise PipelineError("asset is not available or reference-only")
        if content.content_id not in asset.content_relations:
            raise PipelineError("asset does not reference this content")
        moved = replace(content, updated_at=now) if content.current_state is ContentState.ASSET_PREPARATION \
            else self._move(content, ContentState.ASSET_PREPARATION, now)
        return replace(moved, asset_references=tuple(dict.fromkeys((*content.asset_references, asset.asset_id))))

    def complete_draft(self, content: ContentItem, *, now: datetime) -> ContentItem:
        """Advance a complete draft without inventing an Asset."""
        if not (content.title and content.title.strip()):
            raise PipelineError("draft completion requires a title")
        if not ((content.body and content.body.strip()) or
                (content.script_reference and content.script_reference.strip())):
            raise PipelineError("draft completion requires body or script reference")
        return self._move(content, ContentState.ASSET_PREPARATION, now)

    def submit_for_review(self, content: ContentItem, *, now: datetime) -> ContentItem:
        moved = self._move(content, ContentState.REVIEW, now)
        return replace(moved, review_state=ReviewState.PENDING, publish_readiness=PublishReadiness.NEEDS_REVIEW)

    @staticmethod
    def approve_review(content: ContentItem, *, now: datetime) -> ContentItem:
        _aware("now", now)
        if content.current_state is not ContentState.REVIEW:
            raise PipelineError("review approval requires REVIEW state")
        return replace(content, review_state=ReviewState.APPROVED, updated_at=now)

    def reject_review(self, content: ContentItem, *, now: datetime) -> ContentItem:
        if content.current_state is not ContentState.REVIEW:
            raise PipelineError("review rejection requires REVIEW state")
        moved = self._move(content, ContentState.REJECTED, now)
        return replace(moved, review_state=ReviewState.CHANGES_REQUESTED, publish_readiness=PublishReadiness.NOT_READY)

    @staticmethod
    def ready_to_publish_gate(
        content: ContentItem, *, accounts: Sequence[Account], assets: Sequence[Asset],
    ) -> ReadyGateResult:
        failures: list[str] = []
        if content.current_state is not ContentState.REVIEW:
            failures.append("STATE_NOT_REVIEW")
        if content.current_state is ContentState.BLOCKED:
            failures.append("CONTENT_BLOCKED")
        if not (content.body and content.body.strip()) and not (content.script_reference and content.script_reference.strip()):
            failures.append("CONTENT_BODY_OR_SCRIPT_REQUIRED")
        if content.review_state is not ReviewState.APPROVED:
            failures.append("REVIEW_NOT_APPROVED")
        account_by_id = {account.account_id: account for account in accounts}
        for account_id in content.target_accounts:
            account = account_by_id.get(account_id)
            if account is None:
                failures.append(f"TARGET_ACCOUNT_MISSING:{account_id}")
            elif account.status is not AccountStatus.ACTIVE:
                failures.append(f"TARGET_ACCOUNT_NOT_ACTIVE:{account_id}")
        asset_by_id = {asset.asset_id: asset for asset in assets}
        for asset_id in content.asset_references:
            asset = asset_by_id.get(asset_id)
            if asset is None:
                failures.append(f"ASSET_MISSING:{asset_id}")
            elif asset.status not in {AssetStatus.AVAILABLE, AssetStatus.REFERENCE_ONLY}:
                failures.append(f"ASSET_NOT_READY:{asset_id}")
        if not content.provenance.is_complete:
            failures.append("PROVENANCE_INCOMPLETE")
        return ReadyGateResult(not failures, tuple(failures))

    def mark_ready_to_publish(
        self, content: ContentItem, *, accounts: Sequence[Account], assets: Sequence[Asset], now: datetime,
    ) -> ContentItem:
        gate = self.ready_to_publish_gate(content, accounts=accounts, assets=assets)
        if not gate.passed:
            raise PipelineError("ready-to-publish gate failed: " + ",".join(gate.failures))
        moved = self._move(content, ContentState.READY_TO_PUBLISH, now)
        return replace(moved, publish_readiness=PublishReadiness.READY)

    def record_manual_publish(
        self, content: ContentItem, *, account: Account, platform: str,
        actual_publish_time: datetime, external_url: str | None, external_post_id: str | None,
        manual_confirmation: bool, provenance: Provenance, now: datetime,
    ) -> ManualPublishResult:
        _aware("actual_publish_time", actual_publish_time)
        if not manual_confirmation:
            raise PipelineError("manual_confirmation=true is required")
        if content.current_state is not ContentState.READY_TO_PUBLISH:
            raise PipelineError("manual publish recording requires READY_TO_PUBLISH")
        if account.account_id not in content.target_accounts or account.status is not AccountStatus.ACTIVE:
            raise PipelineError("account is not an active target account")
        moved = self._move(content, ContentState.PUBLISHED, now)
        stamp = int(actual_publish_time.timestamp())
        record = PublishRecord(
            publish_record_id=f"publish:{content.content_id}:{account.account_id}:{stamp}",
            platform=platform, account_id=account.account_id, content_id=content.content_id,
            publish_status=PublishStatus.PUBLISHED, planned_time=None,
            actual_publish_time=actual_publish_time, external_url=external_url,
            external_post_id=external_post_id, manual_confirmation=True,
            source="manual_confirmation", provenance=provenance,
            created_at=now, updated_at=now, publication_mode=PublicationMode.MANUAL,
        )
        return ManualPublishResult(moved, record)

    def record_metrics(
        self, content: ContentItem, publish_record: PublishRecord, *, metrics_id: str,
        views: int | None, impressions: int | None, likes: int | None,
        comments: int | None, favorites: int | None, shares: int | None,
        followers_delta: int | None, engagement: float | None, collected_at: datetime,
        input_mode: MetricsInputMode, provenance: Provenance, now: datetime,
    ) -> MetricsRecordResult:
        if publish_record.publish_status is not PublishStatus.PUBLISHED or publish_record.content_id != content.content_id:
            raise PipelineError("metrics require the matching published record")
        moved = self._move(content, ContentState.METRICS_PENDING, now)
        metrics = Metrics(
            metrics_id=metrics_id, publish_record_id=publish_record.publish_record_id,
            views=views, impressions=impressions, likes=likes, comments=comments,
            favorites=favorites, shares=shares, followers_delta=followers_delta,
            engagement=engagement, collected_at=collected_at, source=input_mode.value,
            provenance=provenance, created_at=now, updated_at=now,
        )
        return MetricsRecordResult(moved, metrics)

    def complete_review(
        self, content: ContentItem, publish_record: PublishRecord, metrics: Metrics, *,
        review_id: str, assets: Sequence[Asset], strengths: Sequence[str], weaknesses: Sequence[str],
        reusable_patterns: Sequence[str], failed_patterns: Sequence[str], next_action: str | None,
        evidence: Sequence[str], provenance: Provenance, now: datetime,
    ) -> ReviewLoopResult:
        if publish_record.content_id != content.content_id or metrics.publish_record_id != publish_record.publish_record_id:
            raise PipelineError("review references do not match content/publish/metrics")
        moved = self._move(content, ContentState.REVIEWED, now)
        review = Review(
            review_id=review_id, content_id=content.content_id,
            publish_record_id=publish_record.publish_record_id, metric_snapshot=metrics,
            strengths=tuple(strengths), weaknesses=tuple(weaknesses),
            reusable_patterns=tuple(reusable_patterns), failed_patterns=tuple(failed_patterns),
            next_action=next_action, evidence=tuple(evidence), reviewed_at=now,
            status=ReviewStatus.COMPLETE, source="manual_review", provenance=provenance,
            created_at=now, updated_at=now,
            extension_fields={"asset_ids": tuple(asset.asset_id for asset in assets)},
        )
        return ReviewLoopResult(moved, review)

    def block_content(self, content: ContentItem, *, reason: str, now: datetime) -> ContentItem:
        if not reason.strip():
            raise PipelineError("block reason is required")
        moved = self._move(content, ContentState.BLOCKED, now)
        extensions = dict(content.extension_fields)
        extensions["block_reason"] = reason
        extensions["blocked_from"] = content.current_state.value
        return replace(moved, extension_fields=extensions)

    def archive_content(self, content: ContentItem, *, now: datetime) -> ContentItem:
        return self._move(content, ContentState.ARCHIVED, now)

    @staticmethod
    def _move(content: ContentItem, target: ContentState, now: datetime) -> ContentItem:
        _aware("now", now)
        next_state = transition(content.current_state, target)
        return replace(content, current_state=next_state, updated_at=now)
