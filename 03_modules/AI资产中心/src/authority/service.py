from __future__ import annotations

from datetime import datetime
from pathlib import Path

from src.contracts import (
    AuthorityCompleteness,
    BillingMode,
    EntitlementState,
    FreshnessStatus,
)
from src.query import LookupStatus, QueryService
from src.store import SQLiteCanonicalStore

from .models import EntitlementAuthorityView, PricingAuthorityView


class AuthorityReadService:
    """Secret-free local Authority read boundary over canonical SQLite data."""

    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)

    def pricing(self, provider_id: str, model: str, billing_mode: BillingMode,
                *, as_of: datetime) -> PricingAuthorityView:
        _aware(as_of)
        query = self._query()
        result = query.resolve_pricing_authority(provider_id, model, billing_mode, as_of)
        if result.status is not LookupStatus.FOUND or result.record is None:
            warning = "PRICING_AUTHORITY_MISSING" if result.status is LookupStatus.MISSING else "PRICING_AUTHORITY_AMBIGUOUS"
            return PricingAuthorityView(result.status, None, FreshnessStatus.UNKNOWN,
                                        AuthorityCompleteness.UNKNOWN, (warning,), None)
        record = result.record
        freshness = record.metadata.freshness_policy.evaluate(record.metadata.last_verified_at, as_of)
        complete = AuthorityCompleteness.COMPLETE if freshness is FreshnessStatus.FRESH else AuthorityCompleteness.INCOMPLETE
        warnings = () if freshness is FreshnessStatus.FRESH else (f"PRICING_AUTHORITY_{freshness.value.upper()}",)
        return PricingAuthorityView(result.status, record, freshness, complete,
                                    warnings, record.metadata.source)

    def entitlement(self, provider_id: str, *, as_of: datetime,
                    token_id: str | None = None, plan: str | None = None,
                    model: str | None = None) -> EntitlementAuthorityView:
        _aware(as_of)
        query = self._query()
        result = query.latest_entitlement(provider_id, token_id=token_id,
                                          plan=plan, model=model, as_of=as_of)
        if result.status is not LookupStatus.FOUND or result.record is None:
            warning = "ENTITLEMENT_MISSING" if result.status is LookupStatus.MISSING else "ENTITLEMENT_AMBIGUOUS"
            return EntitlementAuthorityView(result.status, None, EntitlementState.UNKNOWN,
                                            FreshnessStatus.UNKNOWN, AuthorityCompleteness.UNKNOWN,
                                            (warning,), None)
        record = result.record
        freshness = record.freshness(as_of)
        state = (record.state if freshness is FreshnessStatus.FRESH else
                 EntitlementState.STALE if freshness is FreshnessStatus.STALE else
                 EntitlementState.UNKNOWN)
        complete = AuthorityCompleteness.COMPLETE if freshness is FreshnessStatus.FRESH else AuthorityCompleteness.INCOMPLETE
        warnings = () if freshness is FreshnessStatus.FRESH else (f"ENTITLEMENT_{freshness.value.upper()}",)
        return EntitlementAuthorityView(result.status, record, state, freshness,
                                        complete, warnings, record.metadata.source)

    def _query(self) -> QueryService:
        with SQLiteCanonicalStore(self.database_path) as store:
            return QueryService(**store.load_collections().as_query_kwargs())


def _aware(value: datetime) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware")
