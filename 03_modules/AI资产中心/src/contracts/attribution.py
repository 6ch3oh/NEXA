from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class AttributionStatus(str, Enum):
    ATTRIBUTED = "attributed"
    UNATTRIBUTED = "unattributed"


@dataclass(frozen=True)
class UsageAttribution:
    status: AttributionStatus = AttributionStatus.UNATTRIBUTED
    project_id: str | None = None
    module_id: str | None = None
    task_id: str | None = None
    run_id: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.status, AttributionStatus):
            raise ValueError("attribution status is invalid")
        values = (self.project_id, self.module_id, self.task_id, self.run_id)
        if any(value is not None and not _non_empty(value) for value in values):
            raise ValueError("attribution identifiers must be non-empty when supplied")
        if self.status is AttributionStatus.UNATTRIBUTED and any(value is not None for value in values):
            raise ValueError("UNATTRIBUTED cannot carry attribution identifiers")
        if self.status is AttributionStatus.ATTRIBUTED and not any(value is not None for value in values):
            raise ValueError("ATTRIBUTED requires at least one identifier")

    @classmethod
    def unattributed(cls) -> UsageAttribution:
        return cls()

    @classmethod
    def attributed(
        cls,
        *,
        project_id: str | None = None,
        module_id: str | None = None,
        task_id: str | None = None,
        run_id: str | None = None,
    ) -> UsageAttribution:
        return cls(AttributionStatus.ATTRIBUTED, project_id, module_id, task_id, run_id)


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())
