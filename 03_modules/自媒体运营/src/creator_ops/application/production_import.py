"""Authorized, ledger-first production import for reconciled Legacy evidence."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Mapping, Sequence
from pathlib import Path

from creator_ops.compatibility.real_legacy import (
    CanonicalLegacyRecord, RealLegacyAdapter, RealLegacyReader,
)
from creator_ops.services.import_readiness import (
    FinalImportPlannerV02, ProductionImportAuthorizationGate,
)
from creator_ops.services.legacy_reconciliation import ImportAction, ImportPlanEntry


class ProductionImportDisposition(str, Enum):
    IMPORTED = "IMPORTED"
    REFERENCED = "REFERENCED"
    SKIPPED_WITH_REASON = "SKIPPED_WITH_REASON"
    DEFERRED_FOR_USER = "DEFERRED_FOR_USER"
    INVALID_PRESERVED = "INVALID_PRESERVED"
    CONFLICT_PRESERVED = "CONFLICT_PRESERVED"


@dataclass(frozen=True)
class ProductionImportLedgerEntry:
    entry_id: str
    batch_id: str
    legacy_source: str
    source_sha256: str
    legacy_identity: str | None
    target_entity: str
    target_identity: str | None
    planner_action: str
    disposition: ProductionImportDisposition
    reason: str
    warnings: tuple[str, ...]
    confidence: float
    requires_user_decision: bool
    canonical_fields: Mapping[str, Any]
    payload_digest: str
    recorded_at: datetime
    version: str = "0.1"


@dataclass(frozen=True)
class ProductionImportReceipt:
    receipt_id: str
    run_id: str
    batch_id: str
    started_at: datetime
    completed_at: datetime
    source_assets: tuple[str, ...]
    source_fingerprints: Mapping[str, str]
    created: int
    updated: int
    referenced: int
    skipped: int
    deferred: int
    invalid: int
    conflicts: int
    idempotent_skips: int
    transaction_result: str
    post_write_validation: Mapping[str, Any]
    version: str = "0.1"


@dataclass(frozen=True)
class ProductionImportResult:
    run_id: str
    plan_entries: int
    receipts: tuple[ProductionImportReceipt, ...]
    final_counts: Mapping[str, int]
    unknown: int
    production_state: str
    version: str = "0.1"


@dataclass(frozen=True)
class ProductionBackupReceipt:
    receipt_id: str
    database_path: str
    backup_path: str
    created_at: datetime
    backup_sha256: str
    size_bytes: int
    sqlite_quick_check: str
    schema_version: str
    version: str = "0.1"


class ProductionImportService:
    """Persists only evidence-safe facts; ambiguous domain entities remain deferred."""

    BATCHES = (
        "A_IDENTITY_ACCOUNT", "B_CONTENT", "C_ASSET_REFERENCE",
        "D_PROMPT_RESEARCH_REFERENCE", "E_PACKAGE_QA_WORKFLOW_EVIDENCE",
        "F_PUBLISH_METRICS_REVIEW",
    )

    def __init__(self, store: Any) -> None:
        self.store = store
        self.repo = store.production_import

    def initialize_production_store(
        self, *, source_fingerprints: Mapping[str, str], now: datetime,
        schema_version: str, runtime_version: str, application_version: str,
        source_reconciliation_version: str,
    ) -> Mapping[str, Any]:
        existing = self.repo.get_store_metadata()
        if existing:
            expected = {
                "schema_version": schema_version,
                "runtime_version": runtime_version,
                "application_version": application_version,
                "source_reconciliation_version": source_reconciliation_version,
            }
            if any(existing.get(key) != value for key, value in expected.items()):
                raise ValueError("production store metadata conflicts with the current runtime")
            return existing
        counts = self._entity_counts()
        logical = {
            "schema_version": schema_version,
            "entity_counts": counts,
            "source_fingerprints": dict(source_fingerprints),
        }
        baseline_checksum = _digest(logical)
        metadata = {
            "store_identity": f"creator-ops-production:{uuid.uuid4()}",
            "created_at": now.isoformat(),
            "schema_version": schema_version,
            "runtime_version": runtime_version,
            "application_version": application_version,
            "source_reconciliation_version": source_reconciliation_version,
            "import_authorization_state": "AUTHORIZED_FOR_SAFE_PRODUCTION_IMPORT",
            "empty_baseline_checksum": baseline_checksum,
            "empty_entity_counts": counts,
            "source_fingerprints": dict(source_fingerprints),
        }
        with self.store.transaction():
            self.repo.save_store_metadata(metadata)
            self.repo.save_receipt(ProductionImportReceipt(
                "production-store-initialization-v0.1", "INITIALIZATION",
                "EMPTY_BASELINE", now, now, (), dict(source_fingerprints),
                0, 0, 0, 0, 0, 0, 0, 0, "COMMITTED",
                {"entity_counts": counts, "logical_checksum": baseline_checksum},
            ))
        return metadata

    def execute(
        self, *, run_id: str, source_fingerprints: Mapping[str, str],
        production_import_confirmation: bool, now: datetime,
    ) -> ProductionImportResult:
        ProductionImportAuthorizationGate.validate(
            production_import_confirmation=production_import_confirmation,
        )
        if not self.repo.get_store_metadata():
            raise ValueError("production store metadata must be initialized before import")
        reader = RealLegacyReader.confirmed_creator_ops()
        records = RealLegacyAdapter(reader).build_reconciliation_records()
        plan = FinalImportPlannerV02().plan(records)
        if len(records) != len(plan.dry_run.entries):
            raise ValueError("canonical records and final plan are not aligned")

        grouped: dict[str, list[tuple[CanonicalLegacyRecord, ImportPlanEntry]]] = {
            name: [] for name in self.BATCHES
        }
        for record, entry in zip(records, plan.dry_run.entries, strict=True):
            grouped[self._batch(record, entry)].append((record, entry))

        receipts: list[ProductionImportReceipt] = []
        for batch_id in self.BATCHES:
            items = grouped[batch_id]
            if not items:
                continue
            receipt_id = f"{run_id}:{batch_id}"
            prior = self.repo.find_receipt(receipt_id)
            if prior is not None:
                receipts.append(prior)
                continue
            counts = {
                "created": 0, "updated": 0, "referenced": 0, "skipped": 0,
                "deferred": 0, "invalid": 0, "conflicts": 0, "idempotent_skips": 0,
            }
            source_assets: list[str] = []
            with self.store.transaction():
                for record, entry in items:
                    ledger = self._ledger_entry(
                        reader, batch_id, record, entry, now=now,
                    )
                    existing = self.repo.find_entry(ledger.entry_id)
                    if existing is not None:
                        if existing.payload_digest != ledger.payload_digest:
                            raise ValueError("import identity exists with different evidence payload")
                        counts["idempotent_skips"] += 1
                        source_assets.append(record.source_path)
                        continue
                    self.repo.save_entry(ledger)
                    source_assets.append(record.source_path)
                    key = {
                        ProductionImportDisposition.IMPORTED: "created",
                        ProductionImportDisposition.REFERENCED: "referenced",
                        ProductionImportDisposition.SKIPPED_WITH_REASON: "skipped",
                        ProductionImportDisposition.DEFERRED_FOR_USER: "deferred",
                        ProductionImportDisposition.INVALID_PRESERVED: "invalid",
                        ProductionImportDisposition.CONFLICT_PRESERVED: "conflicts",
                    }[ledger.disposition]
                    counts[key] += 1
                expected_entries = self.repo.count_entries_for_batch(batch_id)
                receipt = ProductionImportReceipt(
                    receipt_id, run_id, batch_id, now, now,
                    tuple(dict.fromkeys(source_assets)), dict(source_fingerprints),
                    counts["created"], counts["updated"], counts["referenced"],
                    counts["skipped"], counts["deferred"], counts["invalid"],
                    counts["conflicts"], counts["idempotent_skips"], "COMMITTED",
                    {"ledger_batch_count": expected_entries,
                     "input_count": len(items), "unknown": 0},
                )
                self.repo.save_receipt(receipt)
            receipts.append(receipt)

        final_counts = self.repo.disposition_counts()
        unknown = len(records) - sum(final_counts.values())
        if unknown != 0:
            raise ValueError("production import accounting is incomplete")
        self.repo.update_store_metadata({
            "import_authorization_state": "SAFE_PRODUCTION_IMPORT_COMPLETE_WITH_DEFERRED",
            "last_import_run_id": run_id,
            "last_import_completed_at": now.isoformat(),
            "accounted_plan_entries": len(records),
            "deferred_import_count": final_counts.get("DEFERRED_FOR_USER", 0)
                                     + final_counts.get("INVALID_PRESERVED", 0),
        })
        master_id = f"{run_id}:PRODUCTION_IMPORT_MASTER_RECEIPT"
        if self.repo.find_receipt(master_id) is None:
            master = ProductionImportReceipt(
                master_id, run_id, "PRODUCTION_IMPORT_MASTER_RECEIPT", now, now,
                tuple(dict.fromkeys(item.source_path for item in records)),
                dict(source_fingerprints), 0, 0,
                final_counts.get("REFERENCED", 0),
                final_counts.get("SKIPPED_WITH_REASON", 0),
                final_counts.get("DEFERRED_FOR_USER", 0),
                final_counts.get("INVALID_PRESERVED", 0),
                final_counts.get("CONFLICT_PRESERVED", 0),
                sum(item.idempotent_skips for item in receipts), "COMMITTED",
                {"total_accounted": sum(final_counts.values()), "unknown": unknown,
                 "canonical_entity_counts": self._entity_counts()},
            )
            self.repo.save_receipt(master)
            receipts.append(master)
        return ProductionImportResult(
            run_id, len(records), tuple(receipts), final_counts, unknown,
            "READY_WITH_DEFERRED_LEGACY_ITEMS",
        )

    def create_first_production_backup(
        self, *, destination: str | Path, now: datetime,
    ) -> ProductionBackupReceipt:
        return self._create_verified_backup(
            "FIRST_PRODUCTION_BASELINE_BACKUP", destination=destination, now=now,
        )

    def create_canonical_activation_backup(
        self, *, destination: str | Path, now: datetime,
    ) -> ProductionBackupReceipt:
        return self._create_verified_backup(
            "CANONICAL_ACTIVATION_BASELINE_BACKUP", destination=destination, now=now,
        )

    def create_real_asset_pipeline_backup(
        self, *, destination: str | Path, now: datetime,
    ) -> ProductionBackupReceipt:
        return self._create_verified_backup(
            "REAL_ASSET_PIPELINE_BASELINE_BACKUP", destination=destination, now=now,
        )

    def _create_verified_backup(
        self, receipt_id: str, *, destination: str | Path, now: datetime,
    ) -> ProductionBackupReceipt:
        existing = self.repo.find_backup_receipt(receipt_id)
        if existing is not None:
            path = Path(existing.backup_path)
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != existing.backup_sha256:
                raise ValueError("recorded production backup is missing or changed")
            return existing
        target = self.store.create_local_backup(destination)
        connection: sqlite3.Connection | None = None
        try:
            connection = sqlite3.connect(target.as_uri() + "?mode=ro", uri=True)
            quick_check = connection.execute("PRAGMA quick_check").fetchone()[0]
            schema = connection.execute(
                "SELECT value FROM metadata WHERE key='schema_version'"
            ).fetchone()[0]
        finally:
            if connection is not None:
                connection.close()
        if quick_check != "ok":
            raise ValueError("production backup integrity check failed")
        receipt = ProductionBackupReceipt(
            receipt_id, str(Path(self.store.database_path).resolve()), str(target.resolve()), now,
            hashlib.sha256(target.read_bytes()).hexdigest(), target.stat().st_size,
            quick_check, schema,
        )
        self.repo.save_backup_receipt(receipt)
        return receipt

    def _ledger_entry(
        self, reader: RealLegacyReader, batch_id: str,
        record: CanonicalLegacyRecord, entry: ImportPlanEntry, *, now: datetime,
    ) -> ProductionImportLedgerEntry:
        disposition = self._disposition(entry)
        source_sha256 = reader.sha256(entry.legacy_source)
        projection = {
            "legacy_source": entry.legacy_source,
            "source_sha256": source_sha256,
            "legacy_identity": entry.legacy_identity,
            "target_entity": entry.target_entity,
            "target_identity": entry.target_identity,
            "planner_action": entry.action.value,
            "disposition": disposition.value,
            "reason": entry.reason,
            "warnings": list(entry.warnings),
            "confidence": entry.confidence,
            "requires_user_decision": disposition in {
                ProductionImportDisposition.DEFERRED_FOR_USER,
                ProductionImportDisposition.INVALID_PRESERVED,
                ProductionImportDisposition.CONFLICT_PRESERVED,
            },
            "canonical_fields": dict(record.canonical_fields),
        }
        identity = _digest({
            "source": entry.legacy_source, "legacy_identity": entry.legacy_identity,
            "target_entity": entry.target_entity,
        })
        return ProductionImportLedgerEntry(
            f"legacy-import:{identity}", batch_id, entry.legacy_source, source_sha256,
            entry.legacy_identity, entry.target_entity, entry.target_identity,
            entry.action.value, disposition, entry.reason, entry.warnings,
            entry.confidence, projection["requires_user_decision"],
            dict(record.canonical_fields), _digest(projection), now,
        )

    @staticmethod
    def _disposition(entry: ImportPlanEntry) -> ProductionImportDisposition:
        if entry.invalid:
            return ProductionImportDisposition.INVALID_PRESERVED
        if entry.action is ImportAction.CONFLICT:
            return ProductionImportDisposition.CONFLICT_PRESERVED
        if entry.requires_manual_review:
            return ProductionImportDisposition.DEFERRED_FOR_USER
        if entry.action is ImportAction.REFERENCE:
            return ProductionImportDisposition.REFERENCED
        if entry.action is ImportAction.SKIP:
            return ProductionImportDisposition.SKIPPED_WITH_REASON
        if entry.action in {ImportAction.CREATE, ImportAction.UPDATE}:
            raise ValueError("canonical entity import requires an entity-specific safe mapper")
        return ProductionImportDisposition.DEFERRED_FOR_USER

    @staticmethod
    def _batch(record: CanonicalLegacyRecord, entry: ImportPlanEntry) -> str:
        if entry.target_entity == "Account":
            return "A_IDENTITY_ACCOUNT"
        if entry.target_entity == "ContentItem":
            return "B_CONTENT"
        if entry.target_entity == "Asset":
            return "C_ASSET_REFERENCE"
        if entry.target_entity in {"PromptAsset", "NotionReference"}:
            return "D_PROMPT_RESEARCH_REFERENCE"
        if record.asset_family == "PUBLISH_DRAFT" or entry.target_entity in {
            "PublishRecord", "Metrics", "Review",
        }:
            return "F_PUBLISH_METRICS_REVIEW"
        return "E_PACKAGE_QA_WORKFLOW_EVIDENCE"

    def _entity_counts(self) -> Mapping[str, int]:
        return {
            "creators": len(self.store.creators.list()),
            "accounts": len(self.store.accounts.list()),
            "content_items": len(self.store.contents.list()),
            "assets": len(self.store.assets.list()),
            "publish_records": len(self.store.publish_records.list()),
            "metrics": len(self.store.metrics.list()),
            "reviews": len(self.store.reviews.list()),
        }


def _digest(value: Any) -> str:
    rendered = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        default=lambda item: item.value if isinstance(item, Enum)
        else item.isoformat() if isinstance(item, datetime) else list(item),
    )
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()
