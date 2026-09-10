"""Durable local task, lock, recovery and audit runtime contracts."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Mapping


class DurableTaskType(str, Enum):
    RESEARCH = "RESEARCH"
    DRAFT = "DRAFT"
    ASSET_PREP = "ASSET_PREP"
    PACKAGE_BUILD = "PACKAGE_BUILD"
    QA = "QA"
    REVIEW = "REVIEW"
    PUBLISH_PREP = "PUBLISH_PREP"
    METRICS_BACKFILL = "METRICS_BACKFILL"
    POST_PUBLISH_REVIEW = "POST_PUBLISH_REVIEW"


class DurableTaskStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    BLOCKED = "BLOCKED"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    TERMINAL_FAILURE = "TERMINAL_FAILURE"
    CANCELLED = "CANCELLED"


class RecoveryDecision(str, Enum):
    RESUME = "RESUME"
    RETRY = "RETRY"
    ROLLBACK_STAGING = "ROLLBACK_STAGING"
    MANUAL_REVIEW = "MANUAL_REVIEW"
    TERMINAL_FAILURE = "TERMINAL_FAILURE"


@dataclass(frozen=True)
class DurableTask:
    task_id: str
    content_id: str
    task_type: DurableTaskType
    status: DurableTaskStatus
    owner: str | None
    attempt: int
    idempotency_key: str
    created_at: datetime
    updated_at: datetime
    provenance: Mapping[str, Any]
    started_at: datetime | None = None
    completed_at: datetime | None = None
    last_error: str | None = None
    recovery_state: str | None = None
    version: str = "0.2"

    def __post_init__(self) -> None:
        if not all((self.task_id, self.content_id, self.idempotency_key)):
            raise ValueError("durable task identity is required")
        if self.attempt < 0:
            raise ValueError("task attempt must be non-negative")
        if not self.provenance:
            raise ValueError("task provenance is required")


@dataclass(frozen=True)
class DurableTaskLock:
    task_id: str
    owner: str
    fencing_token: int
    acquired_at: datetime
    heartbeat_at: datetime
    expires_at: datetime
    released_at: datetime | None = None
    version: str = "0.2"

    def is_stale(self, now: datetime) -> bool:
        return self.released_at is None and self.expires_at <= now


@dataclass(frozen=True)
class RecoveryEvidence:
    recovery_id: str
    task_id: str
    what_happened: str
    previous_state: str
    decision: RecoveryDecision
    resulting_state: str
    occurred_at: datetime
    evidence: Mapping[str, Any]
    version: str = "0.2"


@dataclass(frozen=True)
class AuditEvent:
    event_id: str
    content_id: str | None
    actor: str
    action: str
    occurred_at: datetime
    result: str
    previous_state: str | None = None
    resulting_state: str | None = None
    failure_reason: str | None = None
    recovery_reference: str | None = None
    evidence: Mapping[str, Any] = field(default_factory=dict)
    version: str = "0.2"


class DurableRuntimeService:
    """Transactional runtime over one SQLite repository; WorkItem remains derived."""

    def __init__(self, store: Any, *, lock_ttl_seconds: int = 300) -> None:
        self.store = store
        self.repo = store.runtime
        self.lock_ttl_seconds = lock_ttl_seconds

    def create_task(
        self, *, task_id: str, content_id: str, task_type: DurableTaskType,
        idempotency_key: str, provenance: Mapping[str, Any], now: datetime,
    ) -> DurableTask:
        existing = self.repo.find_task_by_idempotency_key(idempotency_key)
        if existing is not None:
            if existing.content_id != content_id or existing.task_type is not task_type:
                raise ValueError("idempotency key conflicts with another task identity")
            return existing
        task = DurableTask(
            task_id, content_id, task_type, DurableTaskStatus.PENDING, None, 0,
            idempotency_key, now, now, dict(provenance),
        )
        with self.store.transaction():
            self.repo.save_task(task)
            self.repo.save_audit(AuditEvent(
                f"audit:{task_id}:created", content_id, "runtime", "TASK_CREATED", now,
                "SUCCESS", resulting_state=task.status.value,
            ))
        return task

    def acquire(self, task_id: str, *, owner: str, now: datetime) -> DurableTaskLock:
        if not owner:
            raise ValueError("lock owner is required")
        with self.store.transaction():
            task = self.repo.get_task(task_id)
            lock = self.repo.get_lock(task_id)
            if lock and lock.released_at is None and not lock.is_stale(now):
                if lock.owner != owner:
                    raise ValueError("task lock is held by another owner")
                return lock
            token = (lock.fencing_token + 1) if lock else 1
            next_lock = DurableTaskLock(
                task_id, owner, token, now, now,
                now + timedelta(seconds=self.lock_ttl_seconds),
            )
            self.repo.put_lock(next_lock)
            if task.status in {DurableTaskStatus.PENDING, DurableTaskStatus.FAILED, DurableTaskStatus.BLOCKED}:
                self.repo.update_task(replace(
                    task, status=DurableTaskStatus.RUNNING, owner=owner,
                    attempt=task.attempt + 1, started_at=task.started_at or now,
                    updated_at=now, last_error=None,
                ))
            return next_lock

    def heartbeat(self, task_id: str, *, owner: str, fencing_token: int, now: datetime) -> DurableTaskLock:
        with self.store.transaction():
            lock = self._owned_lock(task_id, owner, fencing_token, now, allow_stale=False)
            refreshed = replace(
                lock, heartbeat_at=now,
                expires_at=now + timedelta(seconds=self.lock_ttl_seconds),
            )
            self.repo.put_lock(refreshed)
            return refreshed

    def release(self, task_id: str, *, owner: str, fencing_token: int, now: datetime) -> DurableTaskLock:
        with self.store.transaction():
            lock = self._owned_lock(task_id, owner, fencing_token, now, allow_stale=True)
            released = replace(lock, released_at=now)
            self.repo.put_lock(released)
            return released

    def complete(self, task_id: str, *, owner: str, fencing_token: int, now: datetime) -> DurableTask:
        with self.store.transaction():
            task = self.repo.get_task(task_id)
            if task.status is DurableTaskStatus.SUCCEEDED:
                return task
            self._owned_lock(task_id, owner, fencing_token, now, allow_stale=False)
            if task.status is not DurableTaskStatus.RUNNING:
                raise ValueError("only a running task may complete")
            done = replace(task, status=DurableTaskStatus.SUCCEEDED, completed_at=now, updated_at=now)
            self.repo.update_task(done)
            lock = self.repo.get_lock(task_id)
            self.repo.put_lock(replace(lock, released_at=now))
            self.repo.save_audit(AuditEvent(
                f"audit:{task_id}:completed:{task.attempt}", task.content_id, owner,
                "TASK_COMPLETED", now, "SUCCESS", task.status.value, done.status.value,
            ))
            return done

    def fail(
        self, task_id: str, *, owner: str, fencing_token: int, error: str,
        retryable: bool, now: datetime,
    ) -> DurableTask:
        with self.store.transaction():
            self._owned_lock(task_id, owner, fencing_token, now, allow_stale=True)
            task = self.repo.get_task(task_id)
            status = DurableTaskStatus.FAILED if retryable else DurableTaskStatus.TERMINAL_FAILURE
            failed = replace(task, status=status, last_error=error, updated_at=now,
                             completed_at=now if not retryable else None)
            self.repo.update_task(failed)
            lock = self.repo.get_lock(task_id)
            self.repo.put_lock(replace(lock, released_at=now))
            return failed

    def recover_stale(self, *, now: datetime) -> tuple[RecoveryEvidence, ...]:
        recovered: list[RecoveryEvidence] = []
        for lock in self.repo.list_active_locks():
            if not lock.is_stale(now):
                continue
            with self.store.transaction():
                task = self.repo.get_task(lock.task_id)
                if task.status is not DurableTaskStatus.RUNNING:
                    decision = RecoveryDecision.MANUAL_REVIEW
                    resulting = task.status
                elif task.task_type is DurableTaskType.PACKAGE_BUILD:
                    decision = RecoveryDecision.ROLLBACK_STAGING
                    resulting = DurableTaskStatus.BLOCKED
                elif task.attempt < 3:
                    decision = RecoveryDecision.RETRY
                    resulting = DurableTaskStatus.FAILED
                else:
                    decision = RecoveryDecision.TERMINAL_FAILURE
                    resulting = DurableTaskStatus.TERMINAL_FAILURE
                updated = replace(
                    task, status=resulting, owner=None, updated_at=now,
                    last_error="PROCESS_INTERRUPTED_STALE_LOCK",
                    recovery_state=decision.value,
                    completed_at=now if resulting is DurableTaskStatus.TERMINAL_FAILURE else None,
                )
                self.repo.update_task(updated)
                self.repo.put_lock(replace(lock, released_at=now))
                item = RecoveryEvidence(
                    f"recovery:{task.task_id}:{task.attempt}", task.task_id,
                    "Process ended while task lock became stale", task.status.value,
                    decision, resulting.value, now,
                    {"owner": lock.owner, "fencing_token": lock.fencing_token,
                     "heartbeat_at": lock.heartbeat_at.isoformat()},
                )
                self.repo.save_recovery(item)
                self.repo.save_audit(AuditEvent(
                    f"audit:{task.task_id}:recovery:{task.attempt}", task.content_id,
                    "recovery", "TASK_RECOVERY", now, "RECOVERED", task.status.value,
                    resulting.value, recovery_reference=item.recovery_id,
                ))
                recovered.append(item)
        return tuple(recovered)

    def _owned_lock(
        self, task_id: str, owner: str, fencing_token: int, now: datetime, *, allow_stale: bool,
    ) -> DurableTaskLock:
        lock = self.repo.get_lock(task_id)
        if lock is None or lock.released_at is not None:
            raise ValueError("task lock is not active")
        if lock.owner != owner or lock.fencing_token != fencing_token:
            raise ValueError("task lock ownership or fencing token mismatch")
        if lock.is_stale(now) and not allow_stale:
            raise ValueError("task lock is stale")
        return lock
