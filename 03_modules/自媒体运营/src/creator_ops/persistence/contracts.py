"""Repository and backup contracts; Domain remains storage-agnostic."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol, Sequence, TypeVar

from creator_ops.application.work_queue import WorkItemStatus
from creator_ops.domain.models import Account, Asset, ContentItem, Creator, Metrics, PublishRecord, Review


T = TypeVar("T")


class Repository(Protocol[T]):
    def save(self, entity: T) -> None: ...
    def get_by_id(self, entity_id: str) -> T: ...
    def list(self) -> tuple[T, ...]: ...
    def update(self, entity: T) -> None: ...


class CreatorRepository(Repository[Creator], Protocol):
    pass


class AccountRepository(Repository[Account], Protocol):
    def find_by_creator_id(self, creator_id: str) -> tuple[Account, ...]: ...


class ContentRepository(Repository[ContentItem], Protocol):
    def find_by_account_id(self, account_id: str) -> tuple[ContentItem, ...]: ...
    def find_by_states(self, states: Sequence[str]) -> tuple[ContentItem, ...]: ...


class AssetRepository(Repository[Asset], Protocol):
    def find_by_content_id(self, content_id: str) -> tuple[Asset, ...]: ...


class PublishRecordRepository(Repository[PublishRecord], Protocol):
    def find_by_content_id(self, content_id: str) -> tuple[PublishRecord, ...]: ...
    def find_latest(self, limit: int = 20) -> tuple[PublishRecord, ...]: ...


class MetricsRepository(Repository[Metrics], Protocol):
    def find_by_publish_record_id(self, publish_record_id: str) -> tuple[Metrics, ...]: ...
    def find_latest(self, publish_record_id: str) -> Metrics | None: ...


class ReviewRepository(Repository[Review], Protocol):
    def find_by_content_id(self, content_id: str) -> tuple[Review, ...]: ...
    def find_by_publish_record_id(self, publish_record_id: str) -> tuple[Review, ...]: ...


@dataclass(frozen=True)
class WorkItemOverlay:
    work_item_id: str
    content_id: str
    status: WorkItemStatus
    due_at: datetime | None
    blocked_reason: str | None
    operator_notes: str | None
    updated_at: datetime
    version: str = "0.1"


class WorkItemOverlayRepository(Protocol):
    def save(self, overlay: WorkItemOverlay) -> None: ...
    def get_by_id(self, work_item_id: str) -> WorkItemOverlay: ...
    def list(self) -> tuple[WorkItemOverlay, ...]: ...
    def update(self, overlay: WorkItemOverlay) -> None: ...
    def put(self, overlay: WorkItemOverlay) -> None: ...
    def find_by_content_id(self, content_id: str) -> tuple[WorkItemOverlay, ...]: ...


class LocalBackupContract(Protocol):
    def create_local_backup(self, destination: str | Path) -> Path: ...

