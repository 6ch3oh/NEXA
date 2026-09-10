"""Read-only query service over hydrated Domain entities."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from creator_ops.application.work_queue import OperatorWorkState, WorkItem, WorkItemStatus, WorkQueueService
from creator_ops.domain.models import Account, Asset, ContentItem, ContentState, Metrics, PublishRecord, PublishStatus, Review
from creator_ops.persistence.sqlite_adapter import SQLiteCreatorOpsStore
from creator_ops.viewmodels.operator_dashboard import OperatorDashboard, build_operator_dashboard


@dataclass(frozen=True)
class ContentDetail:
    content: ContentItem
    accounts: tuple[Account, ...]
    assets: tuple[Asset, ...]
    publish_records: tuple[PublishRecord, ...]
    metrics: tuple[Metrics, ...]
    reviews: tuple[Review, ...]


class CreatorOpsQueryService:
    def __init__(self, store: SQLiteCreatorOpsStore) -> None:
        self.store = store

    def list_active_content(self) -> tuple[ContentItem, ...]:
        active_states = tuple(
            state.value for state in ContentState
            if state not in {ContentState.ARCHIVED, ContentState.REVIEWED}
        )
        return self.store.contents.find_by_states(active_states)

    def list_content_by_state(self, state: ContentState) -> tuple[ContentItem, ...]:
        return self.store.contents.find_by_states((state.value,))

    def get_content_detail(self, content_id: str) -> ContentDetail:
        content = self.store.contents.get_by_id(content_id)
        account_by_id = {item.account_id: item for item in self.store.accounts.list()}
        accounts = tuple(account_by_id[item] for item in content.target_accounts if item in account_by_id)
        assets = self.store.assets.find_by_content_id(content_id)
        publishes = self.store.publish_records.find_by_content_id(content_id)
        metrics = tuple(
            metric for record in publishes
            for metric in self.store.metrics.find_by_publish_record_id(record.publish_record_id)
        )
        reviews = self.store.reviews.find_by_content_id(content_id)
        return ContentDetail(content, accounts, assets, publishes, metrics, reviews)

    def list_accounts(self) -> tuple[Account, ...]:
        return self.store.accounts.list()

    def list_creators(self):
        return self.store.creators.list()

    def get_account_workload_inputs(self, account_id: str) -> tuple[Account, tuple[ContentItem, ...], tuple[PublishRecord, ...]]:
        account = self.store.accounts.get_by_id(account_id)
        contents = self.store.contents.find_by_account_id(account_id)
        publishes = tuple(
            record for record in self.store.publish_records.list() if record.account_id == account_id
        )
        return account, contents, publishes

    def recently_published(self, *, now: datetime, days: int = 30) -> tuple[PublishRecord, ...]:
        cutoff = now - timedelta(days=days)
        return tuple(
            item for item in self.store.publish_records.find_latest(1000)
            if item.actual_publish_time is not None and item.actual_publish_time >= cutoff
        )

    def publish_by_content(self, content_id: str) -> tuple[PublishRecord, ...]:
        return self.store.publish_records.find_by_content_id(content_id)

    def missing_metrics(self) -> tuple[PublishRecord, ...]:
        metrics_record_ids = {item.publish_record_id for item in self.store.metrics.list()}
        return tuple(item for item in self.store.publish_records.list()
                     if item.publish_status is PublishStatus.PUBLISHED and item.publish_record_id not in metrics_record_ids)

    def latest_metric_snapshot(self, publish_record_id: str) -> Metrics | None:
        return self.store.metrics.find_latest(publish_record_id)

    def review_pending(self) -> tuple[ContentItem, ...]:
        metrics_record_ids = {item.publish_record_id for item in self.store.metrics.list()}
        review_record_ids = {item.publish_record_id for item in self.store.reviews.list()}
        content_ids = {
            item.content_id for item in self.store.publish_records.list()
            if item.publish_record_id in metrics_record_ids and item.publish_record_id not in review_record_ids
        }
        return tuple(item for item in self.store.contents.list() if item.content_id in content_ids)

    def derive_work_queue(self, *, now: datetime) -> tuple[WorkItem, ...]:
        overlays = self.store.work_item_overlays.list()
        operator_states = {
            item.work_item_id: OperatorWorkState(
                status=item.status, due_at=item.due_at, blocked_reason=item.blocked_reason,
                updated_at=item.updated_at,
            ) for item in overlays
        }
        asset_actions = {
            content.content_id: self._visual_next_action(content.content_id)
            for content in self.store.contents.list()
        }
        return WorkQueueService().derive_work_items(
            self.store.contents.list(), accounts=self.store.accounts.list(), assets=self.store.assets.list(),
            publish_records=self.store.publish_records.list(), metrics=self.store.metrics.list(),
            reviews=self.store.reviews.list(), now=now, operator_states=operator_states,
            asset_pipeline_actions=asset_actions,
        )

    def _visual_next_action(self, content_id: str) -> str:
        requirements = self.store.visual_assets.list_requirements(content_id)
        if not requirements:
            return ""
        submissions = self.store.visual_assets.list_submissions(content_id=content_id)
        if any(item.status.value == "PENDING_HUMAN_VISUAL_REVIEW" for item in submissions):
            return "VISUAL_REVIEW"
        if any(item.status.value in {"ACTIVATED_PACKAGE_PENDING", "RECOVERY_REQUIRED"} for item in submissions):
            return "VERIFY_ASSET"
        if any(item.status.value == "SUBMITTED" for item in requirements):
            return "VERIFY_ASSET"
        if all(item.status.value == "VERIFIED" for item in requirements):
            return ""
        return "GENERATE_ASSET"

    def operator_dashboard(self, *, now: datetime) -> OperatorDashboard:
        overlays = self.store.work_item_overlays.list()
        operator_states = {
            item.work_item_id: OperatorWorkState(
                status=item.status, due_at=item.due_at, blocked_reason=item.blocked_reason,
                updated_at=item.updated_at,
            ) for item in overlays
        }
        metadata = self.store.production_import.get_store_metadata()
        work_queue = self.derive_work_queue(now=now)
        classification = (
            "PRODUCTION / LEGACY_DERIVED"
            if metadata.get("import_authorization_state") in {
                "SAFE_PRODUCTION_IMPORT_COMPLETE_WITH_DEFERRED",
                "CANONICAL_ACTIVATION_COMPLETE_WITH_PRESERVED_INVALID",
            }
            else "TEST / SYNTHETIC"
        )
        return build_operator_dashboard(
            self.store.accounts.list(), self.store.contents.list(), self.store.assets.list(),
            self.store.publish_records.list(), self.store.metrics.list(), self.store.reviews.list(),
            now=now, operator_states=operator_states, work_queue=work_queue,
            data_classification=classification,
        )
