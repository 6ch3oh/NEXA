from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .source_tag import SourceTag


class ProviderCategory(str, Enum):
    LLM = "llm"
    EMBEDDING = "embedding"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    VISION = "vision"
    SEARCH = "search"
    OTHER = "other"


class ProviderStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    DISABLED = "disabled"
    EXPIRED = "expired"


@dataclass(frozen=True)
class Provider:
    id: str
    key: str
    display_name: str
    category: ProviderCategory
    status: ProviderStatus
    source: SourceTag

    def __post_init__(self) -> None:
        if not _non_empty(self.id):
            raise ValueError("Provider id must not be empty")
        if not _non_empty(self.key):
            raise ValueError("Provider key/code must not be empty")
        if not _non_empty(self.display_name):
            raise ValueError("Provider display_name must not be empty")
        if not isinstance(self.category, ProviderCategory):
            raise ValueError("Provider category must be a ProviderCategory")
        if not isinstance(self.status, ProviderStatus):
            raise ValueError("Provider status must be a ProviderStatus")
        if not isinstance(self.source, SourceTag):
            raise ValueError("Provider source must be a SourceTag")


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())
