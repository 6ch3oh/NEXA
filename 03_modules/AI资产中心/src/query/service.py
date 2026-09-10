from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

from src.contracts import (
    BalanceSnapshot,
    BillingMode,
    CostKind,
    CostRecord,
    EntitlementSnapshot,
    PriceDimension,
    PricingSnapshot,
    PricingAuthorityRecord,
    Provider,
    SourceTag,
    Token,
    UsageRecord,
)

from .models import (
    SECTION_BALANCE,
    SECTION_DERIVED_COST,
    SECTION_EXPLICIT_COST,
    SECTION_PRICING,
    SECTION_PROVIDER,
    SECTION_TOKEN,
    SECTION_USAGE,
    W_BALANCE_AMBIGUOUS,
    W_BALANCE_MISSING,
    W_DERIVED_COST_MISSING,
    W_EXPLICIT_COST_MISSING,
    W_NO_TOKENS,
    W_PRICING_AMBIGUOUS,
    W_PRICING_MISSING,
    W_PRICING_WITHOUT_USAGE,
    W_PROVIDER_AMBIGUOUS,
    W_PROVIDER_MISSING,
    W_USAGE_MISSING,
    W_USAGE_WITHOUT_PRICING,
    AssetSnapshot,
    LookupStatus,
    SnapshotAssembly,
    UniqueLookupResult,
)


@dataclass(frozen=True)
class QueryService:
    """Storage-neutral, read-only, deterministic canonical Query Service.

    Constructed exclusively from caller-injected canonical collections. It never
    mutates domain objects, never touches environment/credentials/files/network,
    and never accesses Legacy or external repositories.
    """

    providers: tuple[Provider, ...] = field(default_factory=tuple)
    tokens: tuple[Token, ...] = field(default_factory=tuple)
    balances: tuple[BalanceSnapshot, ...] = field(default_factory=tuple)
    usages: tuple[UsageRecord, ...] = field(default_factory=tuple)
    pricing: tuple[PricingSnapshot, ...] = field(default_factory=tuple)
    costs: tuple[CostRecord, ...] = field(default_factory=tuple)
    pricing_authorities: tuple[PricingAuthorityRecord, ...] = field(default_factory=tuple)
    entitlements: tuple[EntitlementSnapshot, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        for attr, contract in (
            ("providers", Provider),
            ("tokens", Token),
            ("balances", BalanceSnapshot),
            ("usages", UsageRecord),
            ("pricing", PricingSnapshot),
            ("costs", CostRecord),
            ("pricing_authorities", PricingAuthorityRecord),
            ("entitlements", EntitlementSnapshot),
        ):
            values = tuple(getattr(self, attr))
            for item in values:
                if not isinstance(item, contract):
                    raise ValueError(f"{attr} must contain only {contract.__name__} objects")
            object.__setattr__(self, attr, values)

    def lookup_provider(self, provider_id: str) -> UniqueLookupResult[Provider]:
        """Explicit unique-result provider lookup.

        Duplicate provider identities are AMBIGUOUS rather than being folded
        into the same ``None`` result as a genuinely missing provider.
        """
        matches = tuple(
            sorted(
                (provider for provider in self.providers if provider.id == provider_id),
                key=_provider_sort_key,
            )
        )
        if not matches:
            return UniqueLookupResult(status=LookupStatus.MISSING, candidates=())
        if len(matches) > 1:
            return UniqueLookupResult(status=LookupStatus.AMBIGUOUS, candidates=matches)
        return UniqueLookupResult(status=LookupStatus.FOUND, record=matches[0], candidates=matches)

    def get_provider(self, provider_id: str) -> Provider | None:
        """Compatibility lookup returning the unique Provider or ``None``.

        Callers that need to distinguish missing from duplicate identities use
        :meth:`lookup_provider`.
        """
        result = self.lookup_provider(provider_id)
        return result.record if result.status is LookupStatus.FOUND else None

    def list_tokens(self, provider_id: str | None = None) -> tuple[Token, ...]:
        """All tokens, optionally provider-filtered, deterministically ordered."""
        matches = [
            token
            for token in self.tokens
            if provider_id is None or token.provider_id == provider_id
        ]
        return tuple(sorted(matches, key=_token_sort_key))

    def latest_balance(
        self,
        provider_id: str,
        token_id: str | None = None,
        as_of: datetime | None = None,
    ) -> UniqueLookupResult[BalanceSnapshot]:
        """Latest BalanceSnapshot for a provider/token identity using observed_at.

        ``as_of`` excludes records observed strictly after the cutoff. Records
        with the same logical identity and the same latest observed_at but
        conflicting content are explicitly AMBIGUOUS; nothing is guessed.
        """
        matches = [
            snapshot
            for snapshot in self.balances
            if snapshot.provider_id == provider_id
            and snapshot.token_id == token_id
            and (as_of is None or snapshot.observed_at <= as_of)
        ]
        if not matches:
            return UniqueLookupResult(status=LookupStatus.MISSING, candidates=())
        latest_at = max(snapshot.observed_at for snapshot in matches)
        at_latest = [snapshot for snapshot in matches if snapshot.observed_at == latest_at]
        ordered = tuple(sorted(at_latest, key=_balance_sort_key))
        distinct_content = {(snapshot.value, snapshot.unit) for snapshot in at_latest}
        if len(distinct_content) > 1:
            return UniqueLookupResult(status=LookupStatus.AMBIGUOUS, candidates=ordered)
        return UniqueLookupResult(status=LookupStatus.FOUND, record=ordered[0], candidates=ordered)

    def list_usage(
        self,
        provider_id: str | None = None,
        token_id: str | None = None,
        model: str | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> tuple[UsageRecord, ...]:
        """Usage records with optional provider/token/model/time filters.

        The time range is inclusive on both ends and uses ``observed_at``. Usage
        is quantity only; no cost is calculated. Ordering is deterministic.
        """
        matches = [
            usage
            for usage in self.usages
            if (provider_id is None or usage.provider_id == provider_id)
            and (token_id is None or usage.token_id == token_id)
            and (model is None or usage.model == model)
            and (start is None or usage.observed_at >= start)
            and (end is None or usage.observed_at <= end)
        ]
        return tuple(sorted(matches, key=_usage_sort_key))

    def resolve_pricing(
        self,
        provider_id: str,
        model: str,
        price_dimension: PriceDimension,
        effective_at: datetime | None = None,
    ) -> UniqueLookupResult[PricingSnapshot]:
        """Resolve the unique PricingSnapshot effective for the query.

        Uses ``effective_at``; an optional ``effective_at`` cutoff only admits
        snapshots whose effective time is at or before the cutoff. Multiple
        unresolved candidates with conflicting content are explicitly AMBIGUOUS.
        """
        matches = [
            snapshot
            for snapshot in self.pricing
            if snapshot.provider_id == provider_id
            and snapshot.model == model
            and snapshot.price_dimension is price_dimension
            and (effective_at is None or snapshot.effective_at <= effective_at)
        ]
        if not matches:
            return UniqueLookupResult(status=LookupStatus.MISSING, candidates=())
        latest_at = max(snapshot.effective_at for snapshot in matches)
        at_latest = [snapshot for snapshot in matches if snapshot.effective_at == latest_at]
        ordered = tuple(sorted(at_latest, key=_pricing_sort_key))
        distinct_content = {
            (
                snapshot.price_per_unit,
                snapshot.currency,
                snapshot.unit,
                snapshot.token_id,
            )
            for snapshot in at_latest
        }
        if len(distinct_content) > 1:
            return UniqueLookupResult(status=LookupStatus.AMBIGUOUS, candidates=ordered)
        return UniqueLookupResult(status=LookupStatus.FOUND, record=ordered[0], candidates=ordered)

    def list_costs(
        self,
        provider_id: str | None = None,
        token_id: str | None = None,
        model: str | None = None,
        kind: CostKind | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> tuple[CostRecord, ...]:
        """Cost records with optional provider/token/model/kind/time filters.

        The time range is inclusive on both ends and uses ``occurred_at``.
        Explicit ACTUAL and derived ESTIMATED records stay separate records and
        are never merged into a single cost truth. Ordering is deterministic.
        """
        matches = [
            record
            for record in self.costs
            if (provider_id is None or record.provider_id == provider_id)
            and (token_id is None or record.token_id == token_id)
            and (model is None or record.model == model)
            and (kind is None or record.kind is kind)
            and (start is None or record.occurred_at >= start)
            and (end is None or record.occurred_at <= end)
        ]
        return tuple(sorted(matches, key=_cost_sort_key))

    def resolve_pricing_authority(
        self,
        provider_id: str,
        model: str,
        billing_mode: BillingMode,
        as_of: datetime | None = None,
    ) -> UniqueLookupResult[PricingAuthorityRecord]:
        matches = [
            record for record in self.pricing_authorities
            if record.provider_id == provider_id
            and record.model == model
            and record.billing_mode is billing_mode
            and (as_of is None or record.applies_at(as_of))
        ]
        if not matches:
            return UniqueLookupResult(status=LookupStatus.MISSING, candidates=())
        latest_at = max(record.effective_from for record in matches)
        latest = tuple(sorted(
            (record for record in matches if record.effective_from == latest_at),
            key=_pricing_authority_sort_key,
        ))
        if as_of is None and any(record.time_rule is not None for record in latest):
            return UniqueLookupResult(status=LookupStatus.AMBIGUOUS, candidates=latest)
        distinct = set(latest)
        if len(distinct) > 1:
            return UniqueLookupResult(status=LookupStatus.AMBIGUOUS, candidates=latest)
        return UniqueLookupResult(status=LookupStatus.FOUND, record=latest[0], candidates=latest)

    def latest_entitlement(
        self,
        provider_id: str,
        *,
        token_id: str | None = None,
        plan: str | None = None,
        model: str | None = None,
        as_of: datetime | None = None,
    ) -> UniqueLookupResult[EntitlementSnapshot]:
        matches = [
            snapshot for snapshot in self.entitlements
            if snapshot.provider_id == provider_id
            and (token_id is None or snapshot.token_id == token_id)
            and (plan is None or snapshot.plan == plan)
            and (model is None or snapshot.model == model)
            and (as_of is None or snapshot.observed_at <= as_of)
        ]
        if not matches:
            return UniqueLookupResult(status=LookupStatus.MISSING, candidates=())
        latest_at = max(snapshot.observed_at for snapshot in matches)
        latest = tuple(sorted(
            (snapshot for snapshot in matches if snapshot.observed_at == latest_at),
            key=_entitlement_sort_key,
        ))
        distinct = set(latest)
        if len(distinct) > 1:
            return UniqueLookupResult(status=LookupStatus.AMBIGUOUS, candidates=latest)
        return UniqueLookupResult(status=LookupStatus.FOUND, record=latest[0], candidates=latest)

    def get_asset_snapshot(
        self,
        provider_id: str,
        assembled_at: datetime | None = None,
    ) -> AssetSnapshot:
        """Immutable AssetSnapshot read model for a provider scope.

        Aggregates existing canonical records only. Missing data is represented
        by explicit warnings/missing-section markers, never by fake defaults.
        """
        provider_result = self.lookup_provider(provider_id)
        provider = provider_result.record if provider_result.status is LookupStatus.FOUND else None

        warnings: list[str] = []
        completeness: list[str] = []

        if provider_result.status is LookupStatus.AMBIGUOUS:
            warnings.append(W_PROVIDER_AMBIGUOUS)
        elif provider is None:
            warnings.append(W_PROVIDER_MISSING)
        else:
            completeness.append(SECTION_PROVIDER)

        tokens = self.list_tokens(provider_id)
        if tokens:
            completeness.append(SECTION_TOKEN)
        else:
            warnings.append(W_NO_TOKENS)

        balances: list[BalanceSnapshot] = []
        for identity in [None, *(token.id for token in tokens)]:
            result = self.latest_balance(provider_id, token_id=identity)
            if result.status is LookupStatus.FOUND:
                if result.record is not None:
                    balances.append(result.record)
            elif result.status is LookupStatus.AMBIGUOUS:
                warnings.append(_identity_warning(W_BALANCE_AMBIGUOUS, identity))
            else:
                warnings.append(_identity_warning(W_BALANCE_MISSING, identity))
        if balances:
            completeness.append(SECTION_BALANCE)

        provider_pricing = [p for p in self.pricing if p.provider_id == provider_id]
        pricing: list[PricingSnapshot] = []
        for model, dimension in sorted({(p.model, p.price_dimension) for p in provider_pricing}):
            result = self.resolve_pricing(provider_id, model, dimension)
            if result.status is LookupStatus.FOUND:
                if result.record is not None:
                    pricing.append(result.record)
            elif result.status is LookupStatus.AMBIGUOUS:
                warnings.append(f"{W_PRICING_AMBIGUOUS}:{model}:{dimension.value}")
        if pricing:
            completeness.append(SECTION_PRICING)
        elif not provider_pricing and (tokens or self.usages):
            warnings.append(W_PRICING_MISSING)

        usage_records = self.list_usage(provider_id)
        if usage_records:
            completeness.append(SECTION_USAGE)
        else:
            warnings.append(W_USAGE_MISSING)
        if not provider_pricing and usage_records:
            warnings.append(W_USAGE_WITHOUT_PRICING)
        if provider_pricing and not usage_records:
            warnings.append(W_PRICING_WITHOUT_USAGE)

        explicit_costs = self.list_costs(provider_id, kind=CostKind.ACTUAL)
        derived_costs = self.list_costs(provider_id, kind=CostKind.ESTIMATED)
        if explicit_costs:
            completeness.append(SECTION_EXPLICIT_COST)
        else:
            warnings.append(W_EXPLICIT_COST_MISSING)
        if derived_costs:
            completeness.append(SECTION_DERIVED_COST)
        else:
            warnings.append(W_DERIVED_COST_MISSING)

        latest_usage = usage_records[-1] if usage_records else None
        provenance = _collect_provenance(
            provider,
            tokens,
            balances,
            pricing,
            (latest_usage,) if latest_usage is not None else (),
            explicit_costs,
            derived_costs,
        )
        assembly = SnapshotAssembly(assembled_at=assembled_at) if assembled_at is not None else None

        return AssetSnapshot(
            provider_id=provider_id,
            provider=provider,
            tokens=tokens,
            balances=tuple(sorted(balances, key=_balance_sort_key)),
            pricing=tuple(sorted(pricing, key=_pricing_sort_key)),
            usage=(latest_usage,) if latest_usage is not None else (),
            explicit_costs=explicit_costs,
            derived_costs=derived_costs,
            provenance=provenance,
            warnings=tuple(warnings),
            completeness=tuple(completeness),
            assembly=assembly,
        )


def _identity_warning(marker: str, identity: str | None) -> str:
    if identity is None:
        return marker
    return f"{marker}:{identity}"


def _source_sort_key(source: SourceTag):
    return (
        source.source_type.value,
        source.source_reference or "",
        source.captured_at,
    )


def _provider_sort_key(provider: Provider):
    return (
        provider.id,
        provider.key,
        provider.display_name,
        provider.category.value,
        provider.status.value,
        _source_sort_key(provider.source),
    )


def _token_sort_key(token: Token):
    return (
        token.id,
        token.provider_id,
        token.label,
        token.status.value,
        token.masked_identifier,
        token.secret_ref or "",
        _source_sort_key(token.source),
    )


def _balance_sort_key(snapshot: BalanceSnapshot):
    return (
        snapshot.observed_at,
        snapshot.provider_id,
        snapshot.token_id or "",
        snapshot.unit.value,
        snapshot.value,
        _source_sort_key(snapshot.source),
    )


def _usage_sort_key(usage: UsageRecord):
    return (
        usage.observed_at,
        usage.provider_id,
        usage.usage_id,
        usage.token_id or "",
        usage.model or "",
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_tokens,
        usage.cache_write_tokens,
        _source_sort_key(usage.source),
    )


def _pricing_sort_key(snapshot: PricingSnapshot):
    return (
        snapshot.effective_at,
        snapshot.provider_id,
        snapshot.model,
        snapshot.price_dimension.value,
        snapshot.currency,
        snapshot.unit.value,
        snapshot.price_per_unit,
        snapshot.token_id or "",
        _source_sort_key(snapshot.source),
    )


def _cost_sort_key(record: CostRecord):
    return (
        record.occurred_at,
        record.provider_id,
        record.kind.value,
        record.cost_basis,
        record.amount,
        record.token_id or "",
        record.model or "",
        record.currency,
        record.usage_id or "",
        _source_sort_key(record.source),
    )


def _pricing_authority_sort_key(record: PricingAuthorityRecord):
    return (
        record.effective_from,
        record.provider_id,
        record.model,
        record.billing_mode.value,
        record.authority_id,
    )


def _entitlement_sort_key(snapshot: EntitlementSnapshot):
    return (
        snapshot.observed_at,
        snapshot.provider_id,
        snapshot.entitlement_id,
        snapshot.token_id or "",
        snapshot.plan or "",
        snapshot.model or "",
    )


def _collect_provenance(
    provider: Provider | None,
    tokens: tuple[Token, ...],
    balances: Iterable[BalanceSnapshot],
    pricing: Iterable[PricingSnapshot],
    usage: Iterable[UsageRecord],
    explicit_costs: Iterable[CostRecord],
    derived_costs: Iterable[CostRecord],
) -> tuple[SourceTag, ...]:
    """Deterministic, deduplicated record-level provenance for the snapshot.

    Deduplication keys on (source_type, source_reference) so that the result is
    stable regardless of the recorded capture time; ordering is explicit.
    """
    sources: list[SourceTag] = []
    if provider is not None:
        sources.append(provider.source)
    sources.extend(token.source for token in tokens)
    sources.extend(snapshot.source for snapshot in balances)
    sources.extend(snapshot.source for snapshot in pricing)
    sources.extend(usage.source for usage in usage)
    sources.extend(record.source for record in explicit_costs)
    sources.extend(record.source for record in derived_costs)

    seen: dict[tuple[str, str | None], SourceTag] = {}
    for tag in sources:
        key = (tag.source_type.value, tag.source_reference)
        if key not in seen:
            seen[key] = tag
    ordered = sorted(seen.values(), key=lambda t: (t.source_type.value, t.source_reference or ""))
    return tuple(ordered)
