"""Application coordinator: Domain/Pipeline invocation plus atomic persistence."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Any, Sequence

from creator_ops.application.work_queue import WorkItemStatus, WorkType
from creator_ops.application.workbenches import (
    ManualPublishCommandResult, ManualPublishingWorkbenchService,
)
from creator_ops.domain.models import (
    Account, AccountStatus, Asset, AssetStatus, AssetType, ContentItem, ContentType,
    Creator, CreatorStatus, GenerationMethod, Metrics, Provenance, Review,
)
from creator_ops.persistence.contracts import WorkItemOverlay
from creator_ops.persistence.errors import PersistenceError, PersistenceErrorCode
from creator_ops.persistence.query_service import CreatorOpsQueryService
from creator_ops.persistence.sqlite_adapter import SQLiteCreatorOpsStore
from creator_ops.services.content_pipeline import (
    ContentPipelineService, ManualPublishResult, MetricsInputMode, MetricsRecordResult,
    ReviewLoopResult,
)


class PersistentCreatorOpsService:
    """Coordinates existing rules and repositories without duplicating either."""

    def __init__(self, store: SQLiteCreatorOpsStore) -> None:
        self.store = store
        self.pipeline = ContentPipelineService()
        self.query = CreatorOpsQueryService(store)

    def create_creator(
        self, *, creator_id: str, name: str, status: CreatorStatus,
        source: str, provenance: Provenance, now: datetime,
    ) -> Creator:
        creator = Creator(
            creator_id=creator_id, name=name, status=status, source=source,
            provenance=provenance, created_at=now, updated_at=now,
        )
        with self.store.transaction():
            self.store.creators.save(creator)
        return creator

    def create_account(
        self, *, account_id: str, creator_id: str, legacy_account_code: str | None,
        platform: str, account_name: str, display_name: str,
        content_direction: str, status: AccountStatus, source: str,
        provenance: Provenance, now: datetime,
    ) -> Account:
        account = Account(
            account_id=account_id, creator_id=creator_id,
            legacy_account_code=legacy_account_code, platform=platform,
            account_name=account_name, display_name=display_name,
            content_direction=content_direction, status=status, source=source,
            provenance=provenance, created_at=now, updated_at=now,
        )
        with self.store.transaction():
            self.store.creators.get_by_id(creator_id)
            self.store.accounts.save(account)
        return account

    def create_idea(
        self, *, content_id: str, creator_id: str, target_accounts: Sequence[str],
        topic: str, content_type: ContentType, platform_intent: Sequence[str],
        provenance: Provenance, source: str, now: datetime,
    ) -> ContentItem:
        with self.store.transaction():
            self.store.creators.get_by_id(creator_id)
            for account_id in target_accounts:
                self.store.accounts.get_by_id(account_id)
            content = self.pipeline.create_idea(
                content_id=content_id, creator_id=creator_id,
                target_accounts=target_accounts, topic=topic,
                content_type=content_type, platform_intent=platform_intent,
                provenance=provenance, source=source, now=now,
            )
            self.store.contents.save(content)
            return content

    def start_draft(
        self, content_id: str, *, title: str | None, body: str | None,
        script_reference: str | None, now: datetime,
    ) -> ContentItem:
        with self.store.transaction():
            content = self.store.contents.get_by_id(content_id)
            updated = self.pipeline.start_draft(
                content, title=title, body=body,
                script_reference=script_reference, now=now,
            )
            self.store.contents.update(updated)
            return updated

    def attach_asset(
        self, content_id: str, *, asset_id: str, asset_type: AssetType,
        source: str, location: str, provenance: Provenance,
        generation_method: GenerationMethod, creator_id: str | None,
        account_relations: Sequence[str], status: AssetStatus, now: datetime,
    ) -> ContentItem:
        with self.store.transaction():
            content = self.store.contents.get_by_id(content_id)
            asset = Asset(
                asset_id=asset_id, asset_type=asset_type, source=source,
                location=location, content_relations=(content_id,),
                provenance=provenance, generation_method=generation_method,
                creator_id=creator_id, account_relations=tuple(account_relations),
                status=status, created_at=now, updated_at=now,
            )
            updated = self.pipeline.attach_asset(content, asset, now=now)
            self.store.assets.save(asset)
            self.store.contents.update(updated)
            return updated

    def complete_draft(self, content_id: str, *, now: datetime) -> ContentItem:
        return self._update_content(content_id, self.pipeline.complete_draft, now=now)

    def submit_for_review(self, content_id: str, *, now: datetime) -> ContentItem:
        return self._update_content(content_id, self.pipeline.submit_for_review, now=now)

    def approve_review(self, content_id: str, *, now: datetime) -> ContentItem:
        return self._update_content(content_id, self.pipeline.approve_review, now=now)

    def reject_review(self, content_id: str, *, now: datetime) -> ContentItem:
        return self._update_content(content_id, self.pipeline.reject_review, now=now)

    def mark_ready_to_publish(self, content_id: str, *, now: datetime) -> ContentItem:
        with self.store.transaction():
            content = self.store.contents.get_by_id(content_id)
            updated = self.pipeline.mark_ready_to_publish(
                content, accounts=self.store.accounts.list(),
                assets=self.store.assets.find_by_content_id(content_id), now=now,
            )
            self.store.contents.update(updated)
            return updated

    def _update_content(self, content_id: str, operation: Any, *, now: datetime) -> ContentItem:
        with self.store.transaction():
            content = self.store.contents.get_by_id(content_id)
            updated = operation(content, now=now)
            self.store.contents.update(updated)
            return updated

    def save_work_item_overlay(self, overlay: WorkItemOverlay) -> None:
        with self.store.transaction():
            self.store.work_item_overlays.put(overlay)

    def record_manual_publish(
        self, *, content_id: str, account_id: str, actual_publish_time: datetime,
        external_url: str | None, external_post_id: str | None,
        manual_confirmation: bool, provenance: Provenance, now: datetime,
    ) -> ManualPublishCommandResult:
        with self.store.transaction():
            content = self.store.contents.get_by_id(content_id)
            account = self.store.accounts.get_by_id(account_id)
            publish_id = f"publish:{content_id}:{account_id}:{int(actual_publish_time.timestamp())}"
            try:
                existing = self.store.publish_records.get_by_id(publish_id)
            except PersistenceError as exc:
                if exc.code is not PersistenceErrorCode.NOT_FOUND:
                    raise
            else:
                if (existing.actual_publish_time, existing.external_url, existing.external_post_id) != (
                    actual_publish_time, external_url, external_post_id,
                ):
                    raise PersistenceError(PersistenceErrorCode.CONFLICT, "Publish identity payload conflicts")
                return ManualPublishCommandResult(
                    ManualPublishResult(content, existing), None, None,  # type: ignore[arg-type]
                )
            assets = self.store.assets.find_by_content_id(content_id)
            accounts = self.store.accounts.list()
            queue = self.query.derive_work_queue(now=now)
            current = next(
                (item for item in queue if item.content_id == content_id and item.work_type is WorkType.MANUAL_PUBLISH),
                None,
            )
            if current is None:
                raise PersistenceError(PersistenceErrorCode.VALIDATION_ERROR, "Matching manual publish work item was not found")
            result = ManualPublishingWorkbenchService(self.pipeline).confirm_manual_publish(
                content, target_account_id=account_id, accounts=accounts, assets=assets,
                actual_publish_time=actual_publish_time, external_url=external_url,
                external_post_id=external_post_id, manual_confirmation=manual_confirmation,
                provenance=provenance, now=now, current_work_item=current,
            )
            self.store.contents.update(result.pipeline_result.content)
            self.store.publish_records.save(result.pipeline_result.publish_record)
            old_overlay = next(iter(self.store.work_item_overlays.find_by_content_id(content_id)), None)
            self.store.work_item_overlays.put(WorkItemOverlay(
                work_item_id=result.completed_work_item.work_item_id, content_id=content_id,
                status=WorkItemStatus.DONE, due_at=result.completed_work_item.due_at,
                blocked_reason=None, operator_notes=old_overlay.operator_notes if old_overlay else None,
                updated_at=now,
            ))
            return result

    def record_metrics(
        self, *, content_id: str, publish_record_id: str, metrics_id: str,
        views: int | None, impressions: int | None, likes: int | None,
        comments: int | None, favorites: int | None, shares: int | None,
        followers_delta: int | None, engagement: float | None,
        collected_at: datetime, input_mode: MetricsInputMode,
        provenance: Provenance, now: datetime,
    ) -> MetricsRecordResult:
        with self.store.transaction():
            content = self.store.contents.get_by_id(content_id)
            publish = self.store.publish_records.get_by_id(publish_record_id)
            try:
                existing = self.store.metrics.get_by_id(metrics_id)
            except PersistenceError as exc:
                if exc.code is not PersistenceErrorCode.NOT_FOUND:
                    raise
            else:
                incoming = (views, impressions, likes, comments, favorites, shares,
                            followers_delta, engagement, collected_at, publish_record_id)
                current = (existing.views, existing.impressions, existing.likes, existing.comments,
                           existing.favorites, existing.shares, existing.followers_delta,
                           existing.engagement, existing.collected_at, existing.publish_record_id)
                if current != incoming:
                    raise PersistenceError(PersistenceErrorCode.CONFLICT, "Metrics identity payload conflicts")
                return MetricsRecordResult(content, existing)
            result = self.pipeline.record_metrics(
                content, publish, metrics_id=metrics_id, views=views, impressions=impressions,
                likes=likes, comments=comments, favorites=favorites, shares=shares,
                followers_delta=followers_delta, engagement=engagement,
                collected_at=collected_at, input_mode=input_mode,
                provenance=provenance, now=now,
            )
            self.store.contents.update(result.content)
            self.store.metrics.save(result.metrics)
            return result

    def update_metrics(
        self, metrics_id: str, *, collected_at: datetime, now: datetime,
        views: int | None, impressions: int | None, likes: int | None,
        comments: int | None, favorites: int | None, shares: int | None,
        followers_delta: int | None, engagement: float | None,
    ) -> Metrics:
        with self.store.transaction():
            current = self.store.metrics.get_by_id(metrics_id)
            updated = replace(
                current, views=views, impressions=impressions, likes=likes,
                comments=comments, favorites=favorites, shares=shares,
                followers_delta=followers_delta, engagement=engagement,
                collected_at=collected_at, updated_at=now,
            )
            self.store.metrics.update(updated)
            return updated

    def complete_review(
        self, *, content_id: str, publish_record_id: str, metrics_id: str,
        review_id: str, strengths: Sequence[str], weaknesses: Sequence[str],
        reusable_patterns: Sequence[str], failed_patterns: Sequence[str],
        next_action: str | None, evidence: Sequence[str],
        provenance: Provenance, now: datetime,
    ) -> ReviewLoopResult:
        with self.store.transaction():
            content = self.store.contents.get_by_id(content_id)
            publish = self.store.publish_records.get_by_id(publish_record_id)
            metrics = self.store.metrics.get_by_id(metrics_id)
            try:
                existing = self.store.reviews.get_by_id(review_id)
            except PersistenceError as exc:
                if exc.code is not PersistenceErrorCode.NOT_FOUND:
                    raise
            else:
                incoming = (tuple(strengths), tuple(weaknesses), tuple(reusable_patterns),
                            tuple(failed_patterns), next_action, tuple(evidence),
                            content_id, publish_record_id)
                current = (existing.strengths, existing.weaknesses, existing.reusable_patterns,
                           existing.failed_patterns, existing.next_action, existing.evidence,
                           existing.content_id, existing.publish_record_id)
                if current != incoming:
                    raise PersistenceError(PersistenceErrorCode.CONFLICT, "Review identity payload conflicts")
                return ReviewLoopResult(content, existing)
            assets = self.store.assets.find_by_content_id(content_id)
            result = self.pipeline.complete_review(
                content, publish, metrics, review_id=review_id, assets=assets,
                strengths=strengths, weaknesses=weaknesses,
                reusable_patterns=reusable_patterns, failed_patterns=failed_patterns,
                next_action=next_action, evidence=evidence,
                provenance=provenance, now=now,
            )
            self.store.contents.update(result.content)
            self.store.reviews.save(result.review)
            return result
