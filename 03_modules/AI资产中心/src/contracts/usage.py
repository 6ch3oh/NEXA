from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .source_tag import SourceTag
from .attribution import UsageAttribution

_TOKEN_FIELD_NAMES = (
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
)


@dataclass(frozen=True)
class UsageRecord:
    """Canonical Provider-neutral usage observation.

    Usage is quantity only: token counts plus observation provenance. It never
    carries monetary cost. ``total_tokens`` is defined canonically as the sum of
    input, output, cache-read, and cache-write components. A caller-supplied
    total must equal that canonical sum or construction fails closed.
    """

    usage_id: str
    provider_id: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    observed_at: datetime
    source: SourceTag
    token_id: str | None = None
    model: str | None = None
    total_tokens: int | None = None
    attribution: UsageAttribution = field(default_factory=UsageAttribution.unattributed)

    def __post_init__(self) -> None:
        if not _non_empty(self.usage_id):
            raise ValueError("UsageRecord usage_id must not be empty")
        if not _non_empty(self.provider_id):
            raise ValueError("UsageRecord provider_id must not be empty")
        if self.token_id is not None and not isinstance(self.token_id, str):
            raise ValueError("UsageRecord token_id must be a string")
        if self.model is not None and not isinstance(self.model, str):
            raise ValueError("UsageRecord model must be a string")
        if not isinstance(self.observed_at, datetime):
            raise ValueError("UsageRecord observed_at must be a datetime")
        if not isinstance(self.source, SourceTag):
            raise ValueError("UsageRecord source must be a SourceTag")
        if not isinstance(self.attribution, UsageAttribution):
            raise ValueError("UsageRecord attribution must be a UsageAttribution")

        for name in _TOKEN_FIELD_NAMES:
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"UsageRecord {name} must be an integer >= 0")

        canonical_total = (
            self.input_tokens
            + self.output_tokens
            + self.cache_read_tokens
            + self.cache_write_tokens
        )
        if self.total_tokens is not None:
            if isinstance(self.total_tokens, bool) or not isinstance(self.total_tokens, int):
                raise ValueError("UsageRecord total_tokens must be an integer")
            if self.total_tokens != canonical_total:
                raise ValueError("UsageRecord total_tokens must equal the canonical component sum")
        else:
            object.__setattr__(self, "total_tokens", canonical_total)


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())
