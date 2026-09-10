from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SourceType(str, Enum):
    REMOTE_PROVIDER_API = "remote_provider_api"
    LEGACY_IMPORT = "legacy_import"
    LOCAL_CONFIG = "local_config"
    MANUAL = "manual"
    DERIVED_CALCULATED = "derived_calculated"


@dataclass(frozen=True)
class SourceTag:
    source_type: SourceType
    source_reference: str | None = None
    captured_at: datetime | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.source_type, SourceType):
            raise ValueError("source_type must be a SourceType")
        if self.source_reference is not None and not isinstance(self.source_reference, str):
            raise ValueError("source_reference must be a string")
        if self.captured_at is not None and not isinstance(self.captured_at, datetime):
            raise ValueError("captured_at must be a datetime")
        if self.captured_at is None:
            object.__setattr__(self, "captured_at", utc_now())
