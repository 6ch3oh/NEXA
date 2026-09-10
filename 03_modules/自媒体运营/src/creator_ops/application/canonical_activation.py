"""Transaction-safe canonical activation from adjudicated Legacy evidence."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum
from typing import Any, Mapping

from creator_ops.compatibility.real_legacy import RealLegacyAdapter, RealLegacyReader
from creator_ops.domain.models import (
    Account, AccountStatus, ContentItem, ContentState, ContentType, Creator,
    CreatorStatus, LegacyReference, Provenance, PublishReadiness, ReviewState,
)


class ActivationResolutionStatus(str, Enum):
    ACTIVATED = "ACTIVATED"
    REFERENCED = "REFERENCED"
    PRESERVED_INVALID = "PRESERVED_INVALID"


@dataclass(frozen=True)
class CanonicalActivationRequest:
    activation_id: str
    creator_id: str
    creator_name: str
    creator_status: str
    account_statuses: Mapping[str, str]
    content_owners: Mapping[str, str]
    content_states: Mapping[str, str]
    no_verified_assets: tuple[str, ...]
    adapt_packages: tuple[str, ...]
    decision_reference: str
    version: str = "0.1"


@dataclass(frozen=True)
class CanonicalActivationResolution:
    entry_id: str
    decision_id: str
    status: ActivationResolutionStatus
    canonical_entity_type: str | None
    canonical_entity_id: str | None
    evidence: Mapping[str, Any]
    resolved_at: datetime
    version: str = "0.1"


@dataclass(frozen=True)
class CanonicalActivationReceipt:
    activation_id: str
    decision_digest: str
    creator_created: int
    accounts_created: int
    contents_created: int
    deferred_resolved: int
    invalid_preserved: int
    b4_absent: bool
    entity_counts: Mapping[str, int]
    resolution_counts: Mapping[str, int]
    idempotent: bool
    activated_at: datetime
    version: str = "0.1"


class CanonicalActivationService:
    """The only entity-specific mapper allowed to activate adjudicated records."""

    REQUIRED_ACCOUNTS = ("A1", "A2", "B1", "B2", "B3")
    REQUIRED_CONTENT = ("A2-20260714-001", "B3-20260714-001")

    def __init__(self, store: Any) -> None:
        self.store = store
        self.repo = store.production_import

    def activate(
        self, request: CanonicalActivationRequest, *, confirmation: bool, now: datetime,
    ) -> CanonicalActivationReceipt:
        if not confirmation:
            raise ValueError("canonical activation confirmation is required")
        self._validate_request(request)
        digest = _digest(request)
        existing = self.repo.find_activation_receipt(request.activation_id)
        if existing is not None:
            if existing.decision_digest != digest:
                if not self._repair_creator_name_encoding(request, existing, digest, now):
                    raise ValueError("canonical activation identity conflicts with prior decisions")
                existing = self.repo.find_activation_receipt(request.activation_id)
                assert existing is not None
            self._validate_existing_entities(request)
            return CanonicalActivationReceipt(
                existing.activation_id, existing.decision_digest,
                existing.creator_created, existing.accounts_created,
                existing.contents_created, existing.deferred_resolved,
                existing.invalid_preserved, existing.b4_absent,
                existing.entity_counts, existing.resolution_counts, True,
                existing.activated_at, existing.version,
            )

        records = RealLegacyAdapter(RealLegacyReader.confirmed_creator_ops()).build_reconciliation_records()
        accounts = {item.legacy_identity: item for item in records if item.target_entity == "Account"}
        contents = {item.legacy_identity: item for item in records if item.target_entity == "ContentItem"}
        ledger = self.repo.list_entries()
        resolutions = self._resolutions(request, ledger, now)
        creator = self._creator(request, now)
        account_entities = tuple(self._account(request, accounts[code], now) for code in self.REQUIRED_ACCOUNTS)
        content_entities = tuple(self._content(request, contents[content_id], accounts, now)
                                 for content_id in self.REQUIRED_CONTENT)

        counts = {
            "creators": 1, "accounts": len(account_entities), "content_items": len(content_entities),
            "assets": 0, "publish_records": 0, "metrics": 0, "reviews": 0,
        }
        resolution_counts = {
            status.value: sum(item.status is status for item in resolutions)
            for status in ActivationResolutionStatus
        }
        receipt = CanonicalActivationReceipt(
            request.activation_id, digest, 1, len(account_entities), len(content_entities),
            len(resolutions) - resolution_counts[ActivationResolutionStatus.PRESERVED_INVALID.value],
            resolution_counts[ActivationResolutionStatus.PRESERVED_INVALID.value], True,
            counts, resolution_counts, False, now,
        )
        with self.store.transaction():
            self.store.creators.save(creator)
            for account in account_entities:
                self.store.accounts.save(account)
            for content in content_entities:
                self.store.contents.save(content)
            for resolution in resolutions:
                self.repo.save_activation_resolution(resolution)
            self.repo.save_activation_receipt(receipt)
            self.repo.update_store_metadata({
                "canonical_activation_state": "COMPLETE_WITH_PRESERVED_INVALID",
                "canonical_activation_id": request.activation_id,
                "canonical_activation_completed_at": now.isoformat(),
                "deferred_import_count": 0,
                "preserved_invalid_count": receipt.invalid_preserved,
                "import_authorization_state": "CANONICAL_ACTIVATION_COMPLETE_WITH_PRESERVED_INVALID",
            })
        self._validate_existing_entities(request)
        return receipt

    def seal_production_baseline(
        self, *, activation_id: str, baseline_state: str,
        confirmation: bool, now: datetime,
    ) -> Mapping[str, Any]:
        """Seal V0.2 only after the canonical graph and adjudication overlay exist."""
        if not confirmation:
            raise ValueError("production baseline seal confirmation is required")
        if baseline_state not in {
            "READY", "READY_WITH_NON_BLOCKING_DEFERRED_ITEMS",
        }:
            raise ValueError("unsupported production baseline state")
        receipt = self.repo.find_activation_receipt(activation_id)
        if receipt is None:
            raise ValueError("canonical activation receipt is required before baseline seal")
        if receipt.entity_counts.get("creators") != 1 \
                or receipt.entity_counts.get("accounts") != 5 \
                or receipt.entity_counts.get("content_items") != 2 \
                or not receipt.b4_absent:
            raise ValueError("canonical activation receipt is not sealable")
        if len(self.store.creators.list()) != 1 \
                or {item.account_id for item in self.store.accounts.list()} != set(self.REQUIRED_ACCOUNTS) \
                or {item.content_id for item in self.store.contents.list()} != set(self.REQUIRED_CONTENT) \
                or len(self.repo.list_activation_resolutions()) != 12:
            raise ValueError("canonical production graph is incomplete")
        metadata = self.repo.get_store_metadata()
        existing_version = metadata.get("production_baseline_version")
        existing_state = metadata.get("production_baseline_state")
        if existing_version is not None and (
            existing_version != "CREATOR_OPS_PRODUCTION_BASELINE_V0_2"
            or existing_state != baseline_state
        ):
            raise ValueError("production baseline seal conflicts with existing metadata")
        idempotent = existing_version is not None
        if not idempotent:
            self.repo.update_store_metadata({
                "production_baseline_version": "CREATOR_OPS_PRODUCTION_BASELINE_V0_2",
                "production_baseline_state": baseline_state,
                "production_baseline_activation_id": activation_id,
                "production_baseline_sealed_at": now.isoformat(),
            })
        return {
            "baseline_version": "CREATOR_OPS_PRODUCTION_BASELINE_V0_2",
            "baseline_state": baseline_state,
            "activation_id": activation_id,
            "idempotent": idempotent,
        }

    def _repair_creator_name_encoding(
        self, request: CanonicalActivationRequest, existing: CanonicalActivationReceipt,
        digest: str, now: datetime,
    ) -> bool:
        """Repair only the observed shell-transport question-mark corruption."""
        creators = self.store.creators.list()
        if len(creators) != 1:
            return False
        current = creators[0]
        if current.creator_id != request.creator_id or not current.name \
                or set(current.name) != {"?"} or "?" in request.creator_name:
            return False
        if current.status.value != request.creator_status:
            return False
        with self.store.transaction():
            self.store.creators.update(replace(current, name=request.creator_name, updated_at=now))
            self.repo.update_activation_receipt_digest(existing.activation_id, digest)
            self.repo.update_store_metadata({
                "canonical_activation_encoding_repair": "CREATOR_DISPLAY_NAME_QUESTION_MARKS_REPAIRED",
                "canonical_activation_encoding_repaired_at": now.isoformat(),
            })
        return True

    def _validate_request(self, request: CanonicalActivationRequest) -> None:
        if set(request.account_statuses) != set(self.REQUIRED_ACCOUNTS):
            raise ValueError("activation requires exactly A1, A2, B1, B2 and B3")
        if "B4" in request.account_statuses:
            raise ValueError("B4 has no verified source and cannot be activated")
        for value in request.account_statuses.values():
            AccountStatus(value)
        CreatorStatus(request.creator_status)
        expected_owners = {"A2-20260714-001": "A2", "B3-20260714-001": "B3"}
        if dict(request.content_owners) != expected_owners:
            raise ValueError("content owner decisions do not match adjudicated identities")
        expected_states = {
            "A2-20260714-001": ContentState.ASSET_PREPARATION.value,
            "B3-20260714-001": ContentState.DRAFT.value,
        }
        if dict(request.content_states) != expected_states:
            raise ValueError("content states do not match adjudicated decisions")
        if set(request.no_verified_assets) != set(self.REQUIRED_CONTENT):
            raise ValueError("both adjudicated contents must preserve no-verified-asset truth")
        if set(request.adapt_packages) != set(self.REQUIRED_CONTENT):
            raise ValueError("both adjudicated packages must use the authoritative adapter")

    def _creator(self, request: CanonicalActivationRequest, now: datetime) -> Creator:
        provenance = Provenance(
            "human_adjudication", request.decision_reference, now,
            captured_by="CreatorOpsApplication", confidence="USER_CONFIRMED",
        )
        return Creator(
            request.creator_id, request.creator_name, CreatorStatus(request.creator_status),
            "canonical_activation", provenance, now, now,
            extension_fields={"activation_id": request.activation_id, "grouping_decision": "OPTION_A"},
        )

    def _account(self, request: CanonicalActivationRequest, record: Any, now: datetime) -> Account:
        fields = record.canonical_fields
        code = str(record.legacy_identity)
        reference = str(record.source_path)
        provenance = Provenance(
            "legacy_creator_ops", reference, now,
            captured_by="CreatorOpsApplication", confidence="USER_CONFIRMED",
        )
        return Account(
            code, request.creator_id, code, str(fields["platform"]),
            str(fields["display_name"]), str(fields["display_name"]),
            str(fields["content_direction"]), AccountStatus(request.account_statuses[code]),
            "legacy_canonical_activation", provenance, now, now,
            LegacyReference("legacy_creator_ops", "Account", code, reference),
            {"automation_note": fields.get("automation_note"),
             "style": tuple(fields.get("style") or ()),
             "legacy_content_type": fields.get("content_type"),
             "activation_id": request.activation_id},
        )

    def _content(
        self, request: CanonicalActivationRequest, record: Any,
        account_records: Mapping[str, Any], now: datetime,
    ) -> ContentItem:
        fields = record.canonical_fields
        content_id = str(record.legacy_identity)
        owner = request.content_owners[content_id]
        reference = str(record.source_path)
        created = datetime.fromisoformat(str(fields["created_at"]))
        updated = datetime.fromisoformat(str(fields["updated_at"]))
        provenance = Provenance(
            "legacy_creator_ops", reference, now,
            captured_by="CreatorOpsApplication", confidence="USER_CONFIRMED",
            notes=f"owner={owner}; activation={request.activation_id}",
        )
        prompt_references = tuple(str(item) for item in fields.get("asset_references") or ())
        return ContentItem(
            content_id, request.creator_id, (owner,), str(fields["title"]), str(fields["title"]),
            fields.get("body"), fields.get("script_reference"), ContentType(str(fields["content_type"])),
            (str(account_records[owner].canonical_fields["platform"]),), (),
            ContentState(request.content_states[content_id]), ReviewState.PENDING,
            PublishReadiness.NOT_READY, "legacy_canonical_activation", provenance,
            created, updated, LegacyReference("legacy_creator_ops", "ContentItem", content_id, reference),
            {"legacy_state": fields.get("legacy_state"),
             "state_mapping_type": fields.get("state_mapping_type"),
             "prompt_references": prompt_references,
             "legacy_package_reference": fields.get("script_reference"),
             "asset_decision": "CONFIRM_NO_VERIFIED_ASSET",
             "package_decision": "ADAPT_AFTER_CONTENT_ACTIVATION",
             "manual_publish_only": fields.get("manual_publish_only"),
             "legacy_extension_fields": dict(fields.get("legacy_extension_fields") or {}),
             "activation_id": request.activation_id},
        )

    def _resolutions(
        self, request: CanonicalActivationRequest, ledger: tuple[Any, ...], now: datetime,
    ) -> tuple[CanonicalActivationResolution, ...]:
        by_key = {(item.target_entity, item.legacy_identity): item for item in ledger}
        rows: list[CanonicalActivationResolution] = []
        for code in self.REQUIRED_ACCOUNTS:
            item = by_key[("Account", code)]
            rows.append(CanonicalActivationResolution(
                item.entry_id, f"{code}-STATUS", ActivationResolutionStatus.ACTIVATED,
                "Account", code, {"creator_id": request.creator_id,
                "status": request.account_statuses[code], "grouping": "OPTION_A"}, now,
            ))
        b4 = by_key[("Account", "B4")]
        rows.append(CanonicalActivationResolution(
            b4.entry_id, "INVALID-001", ActivationResolutionStatus.PRESERVED_INVALID,
            None, None, {"decision": "KEEP_PRESERVED", "canonical_entity_created": False}, now,
        ))
        for content_id in self.REQUIRED_CONTENT:
            content = by_key[("ContentItem", content_id)]
            rows.append(CanonicalActivationResolution(
                content.entry_id, f"{content_id}-CONTENT", ActivationResolutionStatus.ACTIVATED,
                "ContentItem", content_id, {"owner": request.content_owners[content_id],
                "state": request.content_states[content_id]}, now,
            ))
            asset = by_key[("Asset", f"missing-assets:{content_id}")]
            rows.append(CanonicalActivationResolution(
                asset.entry_id, f"{content_id}-ASSET", ActivationResolutionStatus.REFERENCED,
                None, None, {"decision": "CONFIRM_NO_VERIFIED_ASSET",
                "canonical_asset_created": False}, now,
            ))
            package = by_key[("ContentPackage", content_id)]
            rows.append(CanonicalActivationResolution(
                package.entry_id, f"{content_id}-PACKAGE", ActivationResolutionStatus.REFERENCED,
                "ContentPackage", content_id, {"decision": "ADAPT_AFTER_CONTENT_ACTIVATION",
                "legacy_source_preserved": True}, now,
            ))
        if len(rows) != 12 or len({item.entry_id for item in rows}) != 12:
            raise ValueError("activation must resolve exactly the 12 adjudicated ledger records")
        return tuple(rows)

    def _validate_existing_entities(self, request: CanonicalActivationRequest) -> None:
        creators = self.store.creators.list()
        accounts = self.store.accounts.list()
        contents = self.store.contents.list()
        if len(creators) != 1 or creators[0].creator_id != request.creator_id \
                or creators[0].name != request.creator_name \
                or creators[0].status.value != request.creator_status:
            raise ValueError("canonical Creator does not match activation decisions")
        account_by_id = {item.account_id: item for item in accounts}
        if set(account_by_id) != set(self.REQUIRED_ACCOUNTS) or "B4" in account_by_id:
            raise ValueError("canonical Account set does not match activation decisions")
        for code, status in request.account_statuses.items():
            if account_by_id[code].creator_id != request.creator_id or account_by_id[code].status.value != status:
                raise ValueError("canonical Account fields do not match activation decisions")
        content_by_id = {item.content_id: item for item in contents}
        if set(content_by_id) != set(self.REQUIRED_CONTENT):
            raise ValueError("canonical Content set does not match activation decisions")
        for content_id in self.REQUIRED_CONTENT:
            item = content_by_id[content_id]
            if item.creator_id != request.creator_id \
                    or item.target_accounts != (request.content_owners[content_id],) \
                    or item.current_state.value != request.content_states[content_id] \
                    or item.asset_references:
                raise ValueError("canonical Content fields do not match activation decisions")


def _digest(value: Any) -> str:
    rendered = json.dumps(
        value.__dict__ if hasattr(value, "__dict__") else value,
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        default=lambda item: item.value if isinstance(item, Enum)
        else item.isoformat() if isinstance(item, datetime)
        else dict(item) if isinstance(item, Mapping) else list(item),
    )
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()
