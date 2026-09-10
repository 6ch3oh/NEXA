from __future__ import annotations

from dataclasses import dataclass

from src.contracts import (
    AuthorityCompleteness,
    EntitlementSnapshot,
    EntitlementState,
    FreshnessStatus,
    PricingAuthorityRecord,
    SourceTag,
)
from src.query import LookupStatus


@dataclass(frozen=True)
class PricingAuthorityView:
    status: LookupStatus
    record: PricingAuthorityRecord | None
    freshness: FreshnessStatus
    completeness: AuthorityCompleteness
    warnings: tuple[str, ...]
    provenance: SourceTag | None


@dataclass(frozen=True)
class EntitlementAuthorityView:
    status: LookupStatus
    record: EntitlementSnapshot | None
    state: EntitlementState
    freshness: FreshnessStatus
    completeness: AuthorityCompleteness
    warnings: tuple[str, ...]
    provenance: SourceTag | None
