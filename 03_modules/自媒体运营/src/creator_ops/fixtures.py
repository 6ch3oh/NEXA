"""Loader for the synthetic, offline Creator Ops baseline fixture."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from creator_ops.domain.models import (
    Account, AccountStatus, Asset, AssetStatus, AssetType, ContentItem, ContentState,
    ContentType, Creator, CreatorStatus, GenerationMethod, Metrics, Provenance,
    PublicationMode, PublishReadiness, PublishRecord, PublishStatus, Review,
    ReviewState, ReviewStatus,
)


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def _prov(raw: dict) -> Provenance:
    return Provenance(
        source_system=raw.get("source_system"), source_reference=raw.get("source_reference"),
        captured_at=_dt(raw.get("captured_at")), captured_by=raw.get("captured_by"),
        confidence=raw.get("confidence"), notes=raw.get("notes"),
    )


@dataclass(frozen=True)
class FixtureSet:
    creator: Creator
    accounts: tuple[Account, ...]
    contents: tuple[ContentItem, ...]
    assets: tuple[Asset, ...]
    publish_records: tuple[PublishRecord, ...]
    metrics: tuple[Metrics, ...]
    reviews: tuple[Review, ...]
    legacy_examples: tuple[dict, ...]


def load_fixture(path: str | Path) -> FixtureSet:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    c = raw["creator"]
    creator = Creator(
        creator_id=c["creator_id"], name=c["name"], status=CreatorStatus(c["status"]),
        source=c["source"], provenance=_prov(c["provenance"]),
        created_at=_dt(c["created_at"]), updated_at=_dt(c["updated_at"]),
    )
    accounts = tuple(Account(
        account_id=x["account_id"], creator_id=x["creator_id"],
        legacy_account_code=x.get("legacy_account_code"), platform=x["platform"],
        account_name=x["account_name"], display_name=x["display_name"],
        content_direction=x["content_direction"], status=AccountStatus(x["status"]),
        source=x["source"], provenance=_prov(x["provenance"]),
        created_at=_dt(x["created_at"]), updated_at=_dt(x["updated_at"]),
    ) for x in raw["accounts"])
    contents = tuple(ContentItem(
        content_id=x["content_id"], creator_id=x["creator_id"],
        target_accounts=tuple(x["target_accounts"]), topic=x["topic"], title=x.get("title"),
        body=x.get("body"), script_reference=x.get("script_reference"),
        content_type=ContentType(x["content_type"]), platform_intent=tuple(x["platform_intent"]),
        asset_references=tuple(x["asset_references"]), current_state=ContentState(x["current_state"]),
        review_state=ReviewState(x["review_state"]), publish_readiness=PublishReadiness(x["publish_readiness"]),
        source=x["source"], provenance=_prov(x["provenance"]),
        created_at=_dt(x["created_at"]), updated_at=_dt(x["updated_at"]),
    ) for x in raw["contents"])
    assets = tuple(Asset(
        asset_id=x["asset_id"], asset_type=AssetType(x["asset_type"]), source=x["source"],
        location=x["location"], content_relations=tuple(x["content_relations"]),
        provenance=_prov(x["provenance"]), generation_method=GenerationMethod(x["generation_method"]),
        creator_id=x.get("creator_id"), account_relations=tuple(x["account_relations"]),
        status=AssetStatus(x["status"]), created_at=_dt(x["created_at"]), updated_at=_dt(x["updated_at"]),
    ) for x in raw["assets"])
    publish_records = tuple(PublishRecord(
        publish_record_id=x["publish_record_id"], platform=x["platform"], account_id=x["account_id"],
        content_id=x["content_id"], publish_status=PublishStatus(x["publish_status"]),
        planned_time=_dt(x.get("planned_time")), actual_publish_time=_dt(x.get("actual_publish_time")),
        external_url=x.get("external_url"), external_post_id=x.get("external_post_id"),
        manual_confirmation=x["manual_confirmation"], source=x["source"], provenance=_prov(x["provenance"]),
        created_at=_dt(x["created_at"]), updated_at=_dt(x["updated_at"]),
        publication_mode=PublicationMode.MANUAL,
    ) for x in raw["publish_records"])
    metrics = tuple(Metrics(
        metrics_id=x["metrics_id"], publish_record_id=x["publish_record_id"], views=x.get("views"),
        impressions=x.get("impressions"), likes=x.get("likes"), comments=x.get("comments"),
        favorites=x.get("favorites"), shares=x.get("shares"), followers_delta=x.get("followers_delta"),
        engagement=x.get("engagement"), collected_at=_dt(x["collected_at"]), source=x["source"],
        provenance=_prov(x["provenance"]), created_at=_dt(x["created_at"]), updated_at=_dt(x["updated_at"]),
    ) for x in raw["metrics"])
    metric_by_record = {x.publish_record_id: x for x in metrics}
    reviews = tuple(Review(
        review_id=x["review_id"], content_id=x["content_id"], publish_record_id=x["publish_record_id"],
        metric_snapshot=metric_by_record.get(x["publish_record_id"]), strengths=tuple(x["strengths"]),
        weaknesses=tuple(x["weaknesses"]), reusable_patterns=tuple(x["reusable_patterns"]),
        failed_patterns=tuple(x["failed_patterns"]), next_action=x.get("next_action"),
        evidence=tuple(x["evidence"]), reviewed_at=_dt(x["reviewed_at"]),
        status=ReviewStatus(x["status"]), source=x["source"], provenance=_prov(x["provenance"]),
        created_at=_dt(x["created_at"]), updated_at=_dt(x["updated_at"]),
    ) for x in raw["reviews"])
    return FixtureSet(creator, accounts, contents, assets, publish_records, metrics, reviews, tuple(raw["legacy_examples"]))
