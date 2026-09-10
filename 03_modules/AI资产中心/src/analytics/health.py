from __future__ import annotations

from datetime import datetime, timedelta

from src.query import LookupStatus, QueryService

from .models import (
    BalanceHealthStatus,
    BalanceHealthSummary,
    ProvenanceSummary,
    W_BALANCE_AMBIGUOUS,
    W_BALANCE_MISSING,
    W_BALANCE_STALE,
    _require_aware,
)
from .provenance import summarize_provenance


def summarize_balance_health(
    query: QueryService,
    provider_id: str,
    *,
    token_id: str | None = None,
    as_of: datetime,
    stale_after: timedelta | None = None,
) -> BalanceHealthSummary:
    """Summarize the latest factual balance without comparing balance units.

    ``as_of`` is explicit so the result never depends on the system clock.
    Staleness is only evaluated when the caller explicitly supplies
    ``stale_after``.
    """

    if not isinstance(query, QueryService):
        raise TypeError("query must be a QueryService")
    _require_aware(as_of, "as_of")
    if stale_after is not None:
        if not isinstance(stale_after, timedelta) or stale_after < timedelta(0):
            raise ValueError("stale_after must be a non-negative timedelta")

    result = query.latest_balance(provider_id, token_id=token_id, as_of=as_of)
    if result.status is LookupStatus.MISSING:
        return BalanceHealthSummary(
            provider_id=provider_id,
            token_id=token_id,
            status=BalanceHealthStatus.MISSING,
            balance=None,
            as_of=as_of,
            stale_after=stale_after,
            warnings=(W_BALANCE_MISSING,),
            provenance=ProvenanceSummary(()),
        )
    if result.status is LookupStatus.AMBIGUOUS:
        return BalanceHealthSummary(
            provider_id=provider_id,
            token_id=token_id,
            status=BalanceHealthStatus.UNKNOWN,
            balance=None,
            as_of=as_of,
            stale_after=stale_after,
            warnings=(W_BALANCE_AMBIGUOUS,),
            provenance=summarize_provenance(item.source for item in result.candidates),
        )

    balance = result.record
    if balance is None:
        raise ValueError("FOUND balance lookup must carry a record")
    _require_aware(balance.observed_at, "balance observed_at")
    if stale_after is not None and as_of - balance.observed_at > stale_after:
        status = BalanceHealthStatus.STALE
        warnings = (W_BALANCE_STALE,)
    else:
        status = BalanceHealthStatus.AVAILABLE
        warnings = ()
    return BalanceHealthSummary(
        provider_id=provider_id,
        token_id=token_id,
        status=status,
        balance=balance,
        as_of=as_of,
        stale_after=stale_after,
        warnings=warnings,
        provenance=summarize_provenance((balance.source,)),
    )
