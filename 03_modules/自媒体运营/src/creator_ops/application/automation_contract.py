"""Pure authoritative automation, lock, retry and recovery contracts.

These contracts plan actions only.  They do not run an automation center,
write journals, call Notion, or execute recovery.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping


class AutomationTaskStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    BLOCKED = "BLOCKED"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class LockStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    HELD = "HELD"
    EXPIRED = "EXPIRED"
    CONFLICT = "CONFLICT"


class RecoveryAction(str, Enum):
    CONTINUE_FORWARD = "CONTINUE_FORWARD"
    ROLLBACK = "ROLLBACK"
    MARK_COMMITTED = "MARK_COMMITTED"
    RETRY = "RETRY"
    MANUAL_REVIEW = "MANUAL_REVIEW"


class AutomationTriggerType(str, Enum):
    MANUAL = "MANUAL"
    FILE_OBSERVED = "FILE_OBSERVED"
    RECOVERY = "RECOVERY"
    EXTERNAL_DEFERRED = "EXTERNAL_DEFERRED"


class AutomationResultStatus(str, Enum):
    SUCCEEDED = "SUCCEEDED"
    FAILED_RETRYABLE = "FAILED_RETRYABLE"
    FAILED_TERMINAL = "FAILED_TERMINAL"
    BLOCKED = "BLOCKED"
    MANUAL_REVIEW = "MANUAL_REVIEW"


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int
    retryable_error_codes: frozenset[str]

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")

    def allows(self, *, attempt_no: int, error_code: str) -> bool:
        return attempt_no < self.max_attempts and error_code in self.retryable_error_codes


@dataclass(frozen=True)
class AutomationTask:
    task_id: str
    operation: str
    subject_identity: str
    idempotency_key: str
    status: AutomationTaskStatus
    attempt_no: int
    retry_policy: RetryPolicy
    provenance_reference: str

    def __post_init__(self) -> None:
        if not all((self.task_id, self.operation, self.subject_identity,
                    self.idempotency_key, self.provenance_reference)):
            raise ValueError("automation task identity and provenance are required")
        if self.attempt_no < 1:
            raise ValueError("attempt_no must be >= 1")


@dataclass(frozen=True)
class AutomationTrigger:
    trigger_id: str
    trigger_type: AutomationTriggerType
    subject_identity: str
    observed_reference: str
    idempotency_key: str
    manual_confirmation: bool = True


@dataclass(frozen=True)
class AutomationResult:
    task_id: str
    attempt_no: int
    status: AutomationResultStatus
    output_references: tuple[str, ...] = ()
    error_code: str | None = None
    error_message: str | None = None
    evidence_hashes: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.task_id or self.attempt_no < 1:
            raise ValueError("automation result requires task_id and a positive attempt")
        failed = self.status in {
            AutomationResultStatus.FAILED_RETRYABLE, AutomationResultStatus.FAILED_TERMINAL,
        }
        if failed and (not self.error_code or not self.error_message):
            raise ValueError("failed automation result requires an error code and message")


@dataclass(frozen=True)
class HumanAIHandoff:
    handoff_id: str
    task_id: str
    provider_role: str
    prompt_reference: str
    reference_assets: tuple[str, ...]
    expected_output: str
    output_handback_reference: str | None = None
    qa_required: bool = True
    manual_confirmation_required: bool = True
    control_mode: str = "HUMAN_CONTROLLED_EXTERNAL_AI_HANDOFF"


@dataclass(frozen=True)
class TaskLock:
    lock_id: str
    task_id: str
    owner_id: str | None
    fencing_token: int
    status: LockStatus
    expires_at: str | None


@dataclass(frozen=True)
class LockPlan:
    allowed: bool
    status: LockStatus
    next_fencing_token: int
    reason: str


class TaskLockPlanner:
    @staticmethod
    def plan_acquire(lock: TaskLock | None, *, task_id: str, owner_id: str) -> LockPlan:
        if not task_id or not owner_id:
            raise ValueError("task_id and owner_id are required")
        if lock is None:
            return LockPlan(True, LockStatus.HELD, 1, "new lock may be acquired")
        if lock.task_id != task_id:
            return LockPlan(False, LockStatus.CONFLICT, lock.fencing_token, "lock identity mismatch")
        if lock.status in {LockStatus.AVAILABLE, LockStatus.EXPIRED}:
            return LockPlan(True, LockStatus.HELD, lock.fencing_token + 1, "available lock may be acquired")
        if lock.owner_id == owner_id and lock.status is LockStatus.HELD:
            return LockPlan(True, LockStatus.HELD, lock.fencing_token, "idempotent acquire by current owner")
        return LockPlan(False, LockStatus.CONFLICT, lock.fencing_token, "lock is held by another owner")


@dataclass(frozen=True)
class RecoveryCheckpoint:
    transaction_id: str
    phase: str
    expected_hashes: Mapping[str, str | None]
    previous_hashes: Mapping[str, str | None]
    replaced_targets: frozenset[str]
    attempt_no: int
    error_code: str | None = None


@dataclass(frozen=True)
class RecoveryPlan:
    action: RecoveryAction
    reason: str
    executable: bool = False
    requires_manual_confirmation: bool = True


class AutomationRecoveryPlanner:
    TERMINAL = frozenset({"SYNC_QUEUED", "ROLLED_BACK", "COMPLETED"})

    @staticmethod
    def plan(
        checkpoint: RecoveryCheckpoint,
        *, observed_hashes: Mapping[str, str | None],
        retry_policy: RetryPolicy | None = None,
    ) -> RecoveryPlan:
        if checkpoint.phase in AutomationRecoveryPlanner.TERMINAL:
            return RecoveryPlan(RecoveryAction.MANUAL_REVIEW, "transaction is already terminal")
        expected_names = set(checkpoint.expected_hashes)
        if expected_names != set(checkpoint.previous_hashes) or expected_names != set(observed_hashes):
            return RecoveryPlan(RecoveryAction.MANUAL_REVIEW, "target set is incomplete or inconsistent")
        if all(observed_hashes[name] == checkpoint.expected_hashes[name] for name in expected_names):
            return RecoveryPlan(RecoveryAction.MARK_COMMITTED, "all targets match expected hashes")
        external = [name for name in expected_names if observed_hashes[name] not in {
            checkpoint.expected_hashes[name], checkpoint.previous_hashes[name], None,
        }]
        if external:
            return RecoveryPlan(RecoveryAction.MANUAL_REVIEW, "external target hash detected")
        if checkpoint.replaced_targets:
            unreplaced = expected_names - set(checkpoint.replaced_targets)
            if all(observed_hashes[name] == checkpoint.expected_hashes[name] for name in checkpoint.replaced_targets) and all(
                observed_hashes[name] in {checkpoint.previous_hashes[name], None} for name in unreplaced
            ):
                return RecoveryPlan(RecoveryAction.CONTINUE_FORWARD, "partial commit can continue deterministically")
            if all(observed_hashes[name] in {checkpoint.expected_hashes[name], checkpoint.previous_hashes[name], None}
                   for name in expected_names):
                return RecoveryPlan(RecoveryAction.ROLLBACK, "recorded previous hashes allow deterministic rollback")
        if not checkpoint.replaced_targets and all(
            observed_hashes[name] == checkpoint.previous_hashes[name] for name in expected_names
        ):
            if retry_policy and checkpoint.error_code and retry_policy.allows(
                attempt_no=checkpoint.attempt_no, error_code=checkpoint.error_code,
            ):
                return RecoveryPlan(RecoveryAction.RETRY, "retry policy permits a new attempt")
            return RecoveryPlan(RecoveryAction.ROLLBACK, "no target replacement was committed")
        return RecoveryPlan(RecoveryAction.MANUAL_REVIEW, "deterministic recovery is not proven")
