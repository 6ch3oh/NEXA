from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from src.contracts import AuthoritySourceType, FreshnessStatus, SourceType


class IntakeStatus(str, Enum):
    STORED = "stored"
    IDEMPOTENT = "idempotent"


class IntakeReasonCode(str, Enum):
    STORED = "stored"
    EXACT_DUPLICATE = "exact_duplicate"


class IntakeErrorCode(str, Enum):
    REFERENCE_MISSING = "reference_missing"
    REFERENCE_MISMATCH = "reference_mismatch"
    STORE_CONFLICT = "store_conflict"
    SECRET_REJECTED = "secret_rejected"
    INVALID_CANONICAL_RECORD = "invalid_canonical_record"
    BATCH_CONFLICT = "batch_conflict"


@dataclass(frozen=True)
class IntakeResult:
    status: IntakeStatus
    record_type: str
    record_identity: str
    persisted: bool
    idempotent: bool
    reason_code: IntakeReasonCode

    def __post_init__(self) -> None:
        if not isinstance(self.status, IntakeStatus):
            raise ValueError("status must be an IntakeStatus")
        if not isinstance(self.reason_code, IntakeReasonCode):
            raise ValueError("reason_code must be an IntakeReasonCode")
        if not isinstance(self.record_type, str) or not self.record_type.strip():
            raise ValueError("record_type must not be empty")
        if not isinstance(self.record_identity, str) or not self.record_identity.strip():
            raise ValueError("record_identity must not be empty")
        if self.status is IntakeStatus.STORED:
            if not self.persisted or self.idempotent or self.reason_code is not IntakeReasonCode.STORED:
                raise ValueError("STORED result flags are inconsistent")
        elif self.persisted or not self.idempotent or self.reason_code is not IntakeReasonCode.EXACT_DUPLICATE:
            raise ValueError("IDEMPOTENT result flags are inconsistent")


@dataclass(frozen=True)
class BatchIntakeResult:
    results: tuple[IntakeResult, ...]
    transaction_committed: bool

    def __post_init__(self) -> None:
        if not isinstance(self.results, tuple) or not all(
            isinstance(item, IntakeResult) for item in self.results
        ):
            raise ValueError("batch results must contain IntakeResult values")
        if not self.results:
            raise ValueError("batch intake result must not be empty")
        if self.transaction_committed is not True:
            raise ValueError("a returned batch result must represent a committed transaction")

    @property
    def stored_count(self) -> int:
        return sum(item.status is IntakeStatus.STORED for item in self.results)

    @property
    def idempotent_count(self) -> int:
        return sum(item.status is IntakeStatus.IDEMPOTENT for item in self.results)


@dataclass(frozen=True)
class AuthorityUpdateReceipt:
    authority_kind: str
    authority_identity: str
    intake_status: IntakeStatus
    persisted: bool
    idempotent: bool
    authority_source_type: AuthoritySourceType
    source_type: SourceType
    source_reference: str | None
    fetched_at: datetime | None
    verified_at: datetime | None
    effective_or_observed_at: datetime
    freshness_at_acceptance: FreshnessStatus
    history_preserved: bool = True

    def __post_init__(self) -> None:
        if self.authority_kind not in {"pricing_authority", "entitlement"}:
            raise ValueError("authority receipt kind is invalid")
        if not isinstance(self.authority_identity, str) or not self.authority_identity.strip():
            raise ValueError("authority receipt identity must not be empty")
        if not isinstance(self.intake_status, IntakeStatus):
            raise ValueError("authority receipt intake_status is invalid")
        if self.persisted != (self.intake_status is IntakeStatus.STORED):
            raise ValueError("authority receipt persisted flag is inconsistent")
        if self.idempotent != (self.intake_status is IntakeStatus.IDEMPOTENT):
            raise ValueError("authority receipt idempotent flag is inconsistent")
        if not isinstance(self.authority_source_type, AuthoritySourceType):
            raise ValueError("authority receipt source type is invalid")
        if not isinstance(self.source_type, SourceType):
            raise ValueError("authority receipt provenance source type is invalid")
        for name in ("fetched_at", "verified_at", "effective_or_observed_at"):
            value = getattr(self, name)
            if value is not None and (
                not isinstance(value, datetime)
                or value.tzinfo is None
                or value.utcoffset() is None
            ):
                raise ValueError(f"authority receipt {name} must be timezone-aware")
        if not isinstance(self.freshness_at_acceptance, FreshnessStatus):
            raise ValueError("authority receipt freshness is invalid")
        if self.history_preserved is not True:
            raise ValueError("authority updates must preserve history")


class IntakeError(RuntimeError):
    code: IntakeErrorCode

    def __init__(self, message: str):
        super().__init__(message)


class ReferenceMissingError(IntakeError):
    code = IntakeErrorCode.REFERENCE_MISSING


class ReferenceMismatchError(IntakeError):
    code = IntakeErrorCode.REFERENCE_MISMATCH


class IntakeStoreConflictError(IntakeError):
    code = IntakeErrorCode.STORE_CONFLICT


class SecretRejectedError(IntakeError):
    code = IntakeErrorCode.SECRET_REJECTED


class InvalidCanonicalRecordError(IntakeError):
    code = IntakeErrorCode.INVALID_CANONICAL_RECORD


class BatchConflictError(IntakeError):
    code = IntakeErrorCode.BATCH_CONFLICT
