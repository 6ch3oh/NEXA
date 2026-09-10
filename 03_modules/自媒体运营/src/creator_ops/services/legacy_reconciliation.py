"""Identity reconciliation and zero-write import planning for legacy records."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Mapping

from creator_ops.compatibility.real_legacy import CanonicalLegacyRecord


class IdentityResolutionStatus(str, Enum):
    MATCHED = "MATCHED"
    NEW = "NEW"
    POSSIBLE_DUPLICATE = "POSSIBLE_DUPLICATE"
    CONFLICT = "CONFLICT"
    UNRESOLVED = "UNRESOLVED"


class ImportAction(str, Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    REFERENCE = "REFERENCE"
    SKIP = "SKIP"
    CONFLICT = "CONFLICT"
    MANUAL_REVIEW = "MANUAL_REVIEW"


@dataclass(frozen=True)
class TargetIdentity:
    entity_type: str
    target_identity: str
    legacy_identity: str | None = None
    source_path: str | None = None
    account_code: str | None = None
    external_post_id: str | None = None
    content_package_identity: str | None = None
    title: str | None = None


@dataclass(frozen=True)
class IdentityResolution:
    status: IdentityResolutionStatus
    target_identity: str | None
    reason: str
    matched_candidates: tuple[str, ...] = ()


@dataclass(frozen=True)
class ImportPlanEntry:
    legacy_source: str
    legacy_identity: str | None
    target_entity: str
    target_identity: str | None
    action: ImportAction
    reason: str
    warnings: tuple[str, ...]
    confidence: float
    requires_manual_review: bool
    invalid: bool = False


@dataclass(frozen=True)
class ImportDryRunPlan:
    target_state: str
    entries: tuple[ImportPlanEntry, ...]
    production_writes: tuple[str, ...] = ()
    version: str = "0.1"

    @property
    def is_zero_write(self) -> bool:
        return not self.production_writes

    def action_counts(self) -> Mapping[str, int]:
        counts = {action.value: 0 for action in ImportAction}
        for entry in self.entries:
            counts[entry.action.value] += 1
        counts["INVALID"] = sum(1 for entry in self.entries if entry.invalid)
        return counts


class LegacyIdentityResolver:
    """Resolve only evidence-backed identity keys; title is duplicate evidence only."""

    def resolve(
        self,
        record: CanonicalLegacyRecord,
        targets: Iterable[TargetIdentity],
    ) -> IdentityResolution:
        candidates = tuple(target for target in targets if target.entity_type == record.target_entity)
        legacy_matches = tuple(
            target for target in candidates
            if record.legacy_identity and target.legacy_identity == record.legacy_identity
        )
        if len(legacy_matches) > 1:
            return self._conflict("same legacy ID maps to multiple target records", legacy_matches)
        if len(legacy_matches) == 1:
            match = legacy_matches[0]
            external = _field(record, "external_post_id")
            if external and match.external_post_id and external != match.external_post_id:
                return self._conflict("legacy ID and external post ID disagree", legacy_matches)
            return IdentityResolution(IdentityResolutionStatus.MATCHED, match.target_identity,
                                      "exact legacy identity match", (match.target_identity,))

        path_matches = tuple(
            target for target in candidates
            if target.source_path and target.source_path == record.source_path
        )
        if len(path_matches) > 1:
            return self._conflict("same source path maps to multiple target records", path_matches)
        if len(path_matches) == 1:
            match = path_matches[0]
            return IdentityResolution(IdentityResolutionStatus.MATCHED, match.target_identity,
                                      "exact source path match", (match.target_identity,))

        external_id = _field(record, "external_post_id")
        if external_id:
            external_matches = tuple(target for target in candidates if target.external_post_id == external_id)
            if len(external_matches) > 1:
                return self._conflict("external post ID maps to multiple target records", external_matches)
            if len(external_matches) == 1:
                match = external_matches[0]
                return IdentityResolution(IdentityResolutionStatus.MATCHED, match.target_identity,
                                          "exact external post ID match", (match.target_identity,))

        package_identity = _field(record, "content_id") if record.target_entity == "ContentPackage" else None
        if package_identity:
            package_matches = tuple(
                target for target in candidates if target.content_package_identity == package_identity
            )
            if len(package_matches) > 1:
                return self._conflict("content package identity maps to multiple targets", package_matches)
            if len(package_matches) == 1:
                match = package_matches[0]
                return IdentityResolution(IdentityResolutionStatus.MATCHED, match.target_identity,
                                          "exact content package identity match", (match.target_identity,))

        account_code = _field(record, "legacy_account_code")
        if record.target_entity == "Account" and account_code:
            account_matches = tuple(target for target in candidates if target.account_code == account_code)
            if len(account_matches) > 1:
                return self._conflict("account code maps to multiple targets", account_matches)
            if len(account_matches) == 1:
                match = account_matches[0]
                return IdentityResolution(IdentityResolutionStatus.MATCHED, match.target_identity,
                                          "exact account code match", (match.target_identity,))

        title = _field(record, "title")
        if title:
            title_matches = tuple(target for target in candidates if target.title == title)
            if title_matches:
                return IdentityResolution(
                    IdentityResolutionStatus.POSSIBLE_DUPLICATE, None,
                    "title similarity is not authoritative identity",
                    tuple(item.target_identity for item in title_matches),
                )

        if record.target_identity:
            return IdentityResolution(IdentityResolutionStatus.NEW, record.target_identity,
                                      "no evidence-backed target identity match")
        return IdentityResolution(IdentityResolutionStatus.UNRESOLVED, None,
                                  "record has no safe target identity")

    @staticmethod
    def _conflict(reason: str, matches: tuple[TargetIdentity, ...]) -> IdentityResolution:
        return IdentityResolution(
            IdentityResolutionStatus.CONFLICT, None, reason,
            tuple(item.target_identity for item in matches),
        )


class ImportDryRunPlanner:
    """Produce proposed actions without executing any mutation."""

    def __init__(self, resolver: LegacyIdentityResolver | None = None) -> None:
        self.resolver = resolver or LegacyIdentityResolver()

    def plan(
        self,
        records: Iterable[CanonicalLegacyRecord],
        targets: Iterable[TargetIdentity] = (),
        *,
        target_state: str = "EMPTY_PRODUCTION_STORE",
    ) -> ImportDryRunPlan:
        target_tuple = tuple(targets)
        entries = tuple(self._entry(record, target_tuple) for record in records)
        return ImportDryRunPlan(target_state=target_state, entries=entries, production_writes=())

    def _entry(
        self,
        record: CanonicalLegacyRecord,
        targets: tuple[TargetIdentity, ...],
    ) -> ImportPlanEntry:
        if not record.valid:
            return self._result(record, ImportAction.MANUAL_REVIEW,
                                "record is invalid or its real source identity is missing", True, True)
        if record.compatibility == "SKIP":
            return self._result(record, ImportAction.SKIP,
                                "evidence is intentionally excluded from canonical import", False, False)
        if record.reference_only:
            return self._result(record, ImportAction.REFERENCE,
                                "reference policy preserves the source without copying", False,
                                record.requires_manual_review)
        resolution = self.resolver.resolve(record, targets)
        if resolution.status is IdentityResolutionStatus.CONFLICT:
            return self._result(record, ImportAction.CONFLICT, resolution.reason, False, True,
                                resolution.target_identity)
        if resolution.status is IdentityResolutionStatus.POSSIBLE_DUPLICATE:
            return self._result(record, ImportAction.MANUAL_REVIEW, resolution.reason, False, True)
        if resolution.status is IdentityResolutionStatus.UNRESOLVED:
            return self._result(record, ImportAction.MANUAL_REVIEW, resolution.reason, False, True)
        if record.requires_manual_review:
            return self._result(record, ImportAction.MANUAL_REVIEW,
                                "mapping explicitly requires operator reconciliation", False, True,
                                resolution.target_identity)
        if resolution.status is IdentityResolutionStatus.MATCHED:
            return self._result(record, ImportAction.UPDATE, resolution.reason, False, False,
                                resolution.target_identity)
        return self._result(record, ImportAction.CREATE, resolution.reason, False, False,
                            resolution.target_identity)

    @staticmethod
    def _result(
        record: CanonicalLegacyRecord,
        action: ImportAction,
        reason: str,
        invalid: bool,
        manual_review: bool,
        target_identity: str | None = None,
    ) -> ImportPlanEntry:
        return ImportPlanEntry(
            legacy_source=record.source_path,
            legacy_identity=record.legacy_identity,
            target_entity=record.target_entity,
            target_identity=target_identity if target_identity is not None else record.target_identity,
            action=action,
            reason=reason,
            warnings=record.warnings,
            confidence=record.confidence,
            requires_manual_review=manual_review,
            invalid=invalid,
        )


def _field(record: CanonicalLegacyRecord, name: str) -> str | None:
    value = record.canonical_fields.get(name)
    return str(value) if value not in (None, "") else None
