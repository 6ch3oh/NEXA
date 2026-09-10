"""Loader for the synthetic Creator Ops Workbench V0.1 scenario fixture."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Mapping

from creator_ops.domain.models import (
    Account, Asset, AssetStatus, AssetType, ContentItem, ContentState, ContentType,
    GenerationMethod, Metrics, Provenance, PublicationMode, PublishReadiness,
    PublishRecord, PublishStatus, Review, ReviewState, ReviewStatus,
)
from creator_ops.fixtures import FixtureSet


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class WorkbenchFixtureSet:
    accounts: tuple[Account, ...]
    contents: tuple[ContentItem, ...]
    assets: tuple[Asset, ...]
    publish_records: tuple[PublishRecord, ...]
    metrics: tuple[Metrics, ...]
    reviews: tuple[Review, ...]
    due_dates: Mapping[str, datetime]
    synthetic_data_only: bool


def _provenance(content_id: str, at: datetime, complete: bool = True) -> Provenance:
    return Provenance(
        source_system="workbench_fixture",
        source_reference=f"workbench/{content_id}" if complete else None,
        captured_at=at if complete else None,
        notes="TEST / SYNTHETIC",
    )


def load_workbench_fixture(path: str | Path, baseline: FixtureSet) -> WorkbenchFixtureSet:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not raw.get("synthetic_data_only"):
        raise ValueError("workbench fixture must declare synthetic_data_only=true")
    contents = []
    for item in raw["scenarios"]:
        created = _dt(item["created_at"])
        updated = _dt(item.get("updated_at", item["created_at"]))
        contents.append(ContentItem(
            content_id=item["content_id"], creator_id="creator-demo-001",
            target_accounts=tuple(item["target_accounts"]), topic=item["scenario_id"],
            title=item.get("title"), body=item.get("body"), script_reference=item.get("script_reference"),
            content_type=ContentType(item.get("content_type", "ARTICLE")),
            platform_intent=("demo-platform",), asset_references=tuple(item.get("asset_references", ())),
            current_state=ContentState(item["current_state"]),
            review_state=ReviewState(item.get("review_state", "PENDING")),
            publish_readiness=PublishReadiness(item.get("publish_readiness", "NOT_READY")),
            source="workbench_fixture", provenance=_provenance(item["content_id"], created, item.get("provenance_complete", True)),
            created_at=created, updated_at=updated, extension_fields=item.get("extension_fields", {}),
        ))
    content_by_id = {item.content_id: item for item in contents}
    assets = tuple(Asset(
        asset_id=item["asset_id"], asset_type=AssetType(item["asset_type"]),
        source="workbench_fixture", location=item["location"],
        content_relations=tuple(item["content_relations"]),
        provenance=_provenance(item["content_relations"][0], _dt(item["created_at"])),
        generation_method=GenerationMethod.HUMAN_CREATED, creator_id="creator-demo-001",
        account_relations=tuple(item["account_relations"]), status=AssetStatus(item["status"]),
        created_at=_dt(item["created_at"]), updated_at=_dt(item["created_at"]),
    ) for item in raw["assets"])
    publish_records = tuple(PublishRecord(
        publish_record_id=item["publish_record_id"], platform="demo-platform",
        account_id=item["account_id"], content_id=item["content_id"],
        publish_status=PublishStatus.PUBLISHED, planned_time=None,
        actual_publish_time=_dt(item["actual_publish_time"]), external_url=None,
        external_post_id=item["publish_record_id"], manual_confirmation=True,
        source="workbench_fixture", provenance=_provenance(item["content_id"], _dt(item["actual_publish_time"])),
        created_at=_dt(item["actual_publish_time"]), updated_at=_dt(item["actual_publish_time"]),
        publication_mode=PublicationMode.MANUAL,
    ) for item in raw["publish_records"])
    publish_by_id = {item.publish_record_id: item for item in publish_records}
    metrics = tuple(Metrics(
        metrics_id=item["metrics_id"], publish_record_id=item["publish_record_id"],
        views=item.get("views"), impressions=item.get("impressions"), likes=item.get("likes"),
        comments=item.get("comments"), favorites=item.get("favorites"), shares=item.get("shares"),
        followers_delta=item.get("followers_delta"), engagement=item.get("engagement"),
        collected_at=_dt(item["collected_at"]), source="FIXTURE",
        provenance=_provenance(publish_by_id[item["publish_record_id"]].content_id, _dt(item["collected_at"])),
        created_at=_dt(item["collected_at"]), updated_at=_dt(item["collected_at"]),
    ) for item in raw["metrics"])
    metric_by_record = {item.publish_record_id: item for item in metrics}
    reviews = tuple(Review(
        review_id=item["review_id"], content_id=item["content_id"],
        publish_record_id=item["publish_record_id"], metric_snapshot=metric_by_record.get(item["publish_record_id"]),
        strengths=tuple(item.get("strengths", ())), weaknesses=tuple(item.get("weaknesses", ())),
        reusable_patterns=tuple(item.get("reusable_patterns", ())), failed_patterns=tuple(item.get("failed_patterns", ())),
        next_action=item.get("next_action"), evidence=tuple(item.get("evidence", ())),
        reviewed_at=_dt(item["reviewed_at"]), status=ReviewStatus.COMPLETE,
        source="workbench_fixture", provenance=_provenance(item["content_id"], _dt(item["reviewed_at"])),
        created_at=_dt(item["reviewed_at"]), updated_at=_dt(item["reviewed_at"]),
    ) for item in raw["reviews"])
    due_dates = {key: _dt(value) for key, value in raw.get("due_dates", {}).items()}
    if any(item.content_id not in content_by_id for item in publish_records):
        raise ValueError("fixture publish record references unknown content")
    return WorkbenchFixtureSet(
        accounts=baseline.accounts, contents=tuple(contents), assets=assets,
        publish_records=publish_records, metrics=metrics, reviews=reviews,
        due_dates=due_dates, synthetic_data_only=True,
    )
