from __future__ import annotations

from datetime import datetime
from typing import Protocol

from src.consumption.serializer import to_canonical_json, to_json_safe
from src.contracts import (
    AuthorityCompleteness,
    AuthoritySourceType,
    BillingMode,
    EntitlementState,
    FreshnessStatus,
    PriceDimension,
)
from src.query import LookupStatus
from src.domain.security import contains_plaintext_secret

from .models import EntitlementAuthorityView, PricingAuthorityView
from .public_models import (
    NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION,
    PublicAuthorityStatus,
    PublicAttributionAuthority,
    PublicAttributionRow,
    PublicCorrelation,
    PublicEntitlementAuthority,
    PublicEntitlementLimit,
    PublicLimitAvailability,
    PublicPricingAuthority,
    PublicPricingComponent,
    PublicProvenance,
    PublicWarningCode,
)


class AuthorityReader(Protocol):
    def pricing(self, provider_id: str, model: str, billing_mode: BillingMode,
                *, as_of: datetime) -> PricingAuthorityView: ...

    def entitlement(self, provider_id: str, *, as_of: datetime,
                    token_id: str | None = None, plan: str | None = None,
                    model: str | None = None) -> EntitlementAuthorityView: ...


class PublicAuthorityReadService:
    """Versioned storage-neutral facade for module 04 and other consumers."""

    def __init__(self, reader: AuthorityReader):
        if not hasattr(reader, "pricing") or not hasattr(reader, "entitlement"):
            raise TypeError("reader must implement the AuthorityReader contract")
        self._reader = reader

    def get_pricing_authority(
        self,
        provider_id: str,
        model: str,
        billing_mode: BillingMode,
        *,
        as_of: datetime,
        dimension: PriceDimension | None = None,
        correlation: PublicCorrelation | None = None,
    ) -> PublicPricingAuthority:
        _request(provider_id, as_of, correlation)
        if not _non_empty(model):
            raise ValueError("model must not be empty")
        if not isinstance(billing_mode, BillingMode):
            raise ValueError("billing_mode must be a BillingMode")
        if dimension is not None and not isinstance(dimension, PriceDimension):
            raise ValueError("dimension must be a PriceDimension")

        view = self._reader.pricing(provider_id, model, billing_mode, as_of=as_of)
        if not isinstance(view, PricingAuthorityView):
            raise TypeError("reader returned an invalid PricingAuthorityView")
        if view.record is None:
            status, warning = _absent_pricing(view.status)
            return PublicPricingAuthority(
                schema_version=NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION,
                status=status, authority_id=None, provider_id=provider_id, model=model,
                billing_mode=billing_mode, currency=None, components=(),
                effective_from=None, authority_source_type=None,
                official_source=None, fetched_at=None, last_verified_at=None,
                freshness=FreshnessStatus.UNKNOWN,
                completeness=AuthorityCompleteness.UNKNOWN,
                warnings=(warning,), provenance=None,
                token_monetary_estimate_allowed=False, correlation=correlation,
            )

        record = view.record
        if view.status is not LookupStatus.FOUND:
            raise ValueError("non-FOUND pricing view must not carry a record")
        if (record.provider_id != provider_id or record.model != model
                or record.billing_mode is not billing_mode):
            raise ValueError("pricing reader result does not match request identity")
        components = tuple(sorted((
            PublicPricingComponent(
                component.price_dimension,
                component.unit,
                component.price_per_unit,
                component.token_id,
            )
            for component in record.components
            if dimension is None or component.price_dimension is dimension
        ), key=lambda item: (
            item.dimension.value, item.unit.value, item.token_scope_id or ""
        )))
        warnings = list(_pricing_warnings(view.freshness))
        completeness = view.completeness
        if dimension is not None and not components:
            warnings.append(PublicWarningCode.PRICING_COMPONENT_MISSING)
            completeness = AuthorityCompleteness.INCOMPLETE
        status = _pricing_status(view.freshness)
        if (
            status is PublicAuthorityStatus.FOUND_FRESH
            and completeness is AuthorityCompleteness.INCOMPLETE
        ):
            status = PublicAuthorityStatus.INCOMPLETE
        estimate_allowed = (
            billing_mode is BillingMode.API_USAGE
            and status is PublicAuthorityStatus.FOUND_FRESH
            and completeness is AuthorityCompleteness.COMPLETE
            and bool(components)
        )
        metadata = record.metadata
        _secret_safe(
            record.authority_id, record.provider_id, record.model, metadata.official_source,
            metadata.source.source_reference,
            *(component.token_scope_id for component in components),
        )
        return PublicPricingAuthority(
            schema_version=NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION, status=status,
            authority_id=record.authority_id, provider_id=record.provider_id, model=record.model,
            billing_mode=record.billing_mode, currency=record.currency,
            components=components, effective_from=record.effective_from,
            authority_source_type=metadata.authority_source_type,
            official_source=_official_reference(
                metadata.authority_source_type, metadata.official_source
            ),
            fetched_at=metadata.fetched_at,
            last_verified_at=metadata.last_verified_at,
            freshness=view.freshness, completeness=completeness,
            warnings=tuple(warnings), provenance=_provenance(view.provenance),
            token_monetary_estimate_allowed=estimate_allowed,
            correlation=correlation,
        )

    def get_entitlement_authority(
        self,
        provider_id: str,
        *,
        as_of: datetime,
        token_id: str | None = None,
        plan: str | None = None,
        model: str | None = None,
        correlation: PublicCorrelation | None = None,
    ) -> PublicEntitlementAuthority:
        _request(provider_id, as_of, correlation)
        for name, value in (("token_id", token_id), ("plan", plan), ("model", model)):
            if value is not None and not _non_empty(value):
                raise ValueError(f"{name} must be non-empty when supplied")

        view = self._reader.entitlement(
            provider_id, as_of=as_of, token_id=token_id, plan=plan, model=model
        )
        if not isinstance(view, EntitlementAuthorityView):
            raise TypeError("reader returned an invalid EntitlementAuthorityView")
        if view.record is None:
            status, warning = _absent_entitlement(view.status)
            return PublicEntitlementAuthority(
                schema_version=NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION,
                status=status, entitlement_id=None, provider_id=provider_id,
                token_scope_id=token_id, plan=plan, model=model,
                billing_mode=None, used=None, remaining=None,
                resource_unit=None, limits=(), reset_at=None,
                state=EntitlementState.UNKNOWN, observed_at=None,
                fixed_subscription_fee=None, fee_currency=None,
                billing_cycle=None, quota_cycle=None,
                authority_source_type=None, official_source=None,
                fetched_at=None, last_verified_at=None,
                freshness=FreshnessStatus.UNKNOWN,
                completeness=AuthorityCompleteness.UNKNOWN,
                warnings=(warning,), provenance=None,
                token_monetary_estimate_allowed=False,
                correlation=correlation,
            )

        record = view.record
        if view.status is not LookupStatus.FOUND:
            raise ValueError("non-FOUND entitlement view must not carry a record")
        if record.provider_id != provider_id:
            raise ValueError("entitlement reader result does not match provider")
        for requested, actual, name in (
            (token_id, record.token_id, "token_id"),
            (plan, record.plan, "plan"),
            (model, record.model, "model"),
        ):
            if requested is not None and requested != actual:
                raise ValueError(f"entitlement reader result does not match {name}")
        limits = tuple(sorted(
            (
                PublicEntitlementLimit(
                    item.kind, item.unit, item.used, item.remaining,
                    item.soft_limit, item.hard_limit, item.model,
                    _limit_availability(item),
                )
                for item in record.limits
            ),
            key=lambda item: (item.kind.value, item.unit, item.model or ""),
        ))
        warnings = list(_entitlement_warnings(view.freshness, view.state))
        if len(limits) == 1:
            used, remaining, resource_unit = (
                limits[0].used, limits[0].remaining, limits[0].unit
            )
        else:
            used = remaining = resource_unit = None
            if len(limits) > 1:
                warnings.append(PublicWarningCode.ENTITLEMENT_MULTIPLE_LIMITS)
        metadata = record.metadata
        _secret_safe(
            record.entitlement_id, record.provider_id, record.token_id,
            record.plan, record.model, record.fee_currency,
            record.billing_cycle, record.quota_cycle, metadata.official_source,
            metadata.source.source_reference,
            *(value for limit in limits for value in (limit.unit, limit.model)),
        )
        status = _entitlement_status(view.freshness, view.state)
        warnings = tuple(warnings)
        if view.state is EntitlementState.NOT_AVAILABLE:
            warnings += (PublicWarningCode.ENTITLEMENT_NOT_AVAILABLE,)
        return PublicEntitlementAuthority(
            schema_version=NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION,
            status=status,
            entitlement_id=record.entitlement_id,
            provider_id=record.provider_id, token_scope_id=record.token_id,
            plan=record.plan, model=record.model,
            billing_mode=record.billing_mode, used=used, remaining=remaining,
            resource_unit=resource_unit, limits=limits, reset_at=record.reset_at,
            state=view.state, observed_at=record.observed_at,
            fixed_subscription_fee=record.fixed_fee,
            fee_currency=record.fee_currency,
            billing_cycle=record.billing_cycle, quota_cycle=record.quota_cycle,
            authority_source_type=metadata.authority_source_type,
            official_source=_official_reference(
                metadata.authority_source_type, metadata.official_source
            ),
            fetched_at=metadata.fetched_at,
            last_verified_at=metadata.last_verified_at,
            freshness=view.freshness, completeness=view.completeness,
            warnings=warnings, provenance=_provenance(view.provenance),
            token_monetary_estimate_allowed=False, correlation=correlation,
        )


def public_to_json_safe(value):
    _public_root(value)
    return to_json_safe(value)


def public_to_canonical_json(value) -> str:
    _public_root(value)
    return to_canonical_json(value)


def to_public_attribution(summary) -> PublicAttributionAuthority:
    """Map established attribution analytics into the frozen public DTO."""

    rows = tuple(PublicAttributionRow(
        provider_id=row.provider_id or "UNATTRIBUTED",
        model=row.model or "UNATTRIBUTED",
        project_id=row.project_id or "UNATTRIBUTED",
        module_id=row.module_id or "UNATTRIBUTED",
        task_id=row.task_id or "UNATTRIBUTED",
        run_id=row.run_id or "UNATTRIBUTED",
        attribution_status=row.attribution_status.value,
        token_numerator=row.token_total,
        token_denominator=row.token_denominator,
        token_share=row.token_share,
        cost_numerator=row.cost_total,
        cost_denominator=row.cost_denominator,
        cost_share=row.cost_share,
    ) for row in summary.rows)
    return PublicAttributionAuthority(
        schema_version=NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION,
        direction=summary.direction,
        billing_mode=summary.billing_mode,
        cost_kind=summary.cost_kind.value,
        cost_share_status=summary.cost_share_status.value,
        currency=summary.currency,
        rows=rows,
    )


def _request(provider_id: str, as_of: datetime,
             correlation: PublicCorrelation | None) -> None:
    if not _non_empty(provider_id):
        raise ValueError("provider_id must not be empty")
    if not isinstance(as_of, datetime) or as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware")
    if correlation is not None and not isinstance(correlation, PublicCorrelation):
        raise ValueError("correlation must be a PublicCorrelation")
    _secret_safe(provider_id)
    if correlation is not None:
        _secret_safe(
            correlation.project_id, correlation.module_id,
            correlation.task_id, correlation.run_id,
        )


def _absent_pricing(status: LookupStatus):
    if status is LookupStatus.MISSING:
        return PublicAuthorityStatus.MISSING, PublicWarningCode.PRICING_MISSING
    if status is LookupStatus.AMBIGUOUS:
        return PublicAuthorityStatus.AMBIGUOUS, PublicWarningCode.PRICING_AMBIGUOUS
    raise ValueError("FOUND pricing view must carry a record")


def _absent_entitlement(status: LookupStatus):
    if status is LookupStatus.MISSING:
        return PublicAuthorityStatus.MISSING, PublicWarningCode.ENTITLEMENT_MISSING
    if status is LookupStatus.AMBIGUOUS:
        return PublicAuthorityStatus.AMBIGUOUS, PublicWarningCode.ENTITLEMENT_AMBIGUOUS
    raise ValueError("FOUND entitlement view must carry a record")


def _pricing_status(freshness: FreshnessStatus) -> PublicAuthorityStatus:
    if freshness is FreshnessStatus.FRESH:
        return PublicAuthorityStatus.FOUND_FRESH
    if freshness is FreshnessStatus.STALE:
        return PublicAuthorityStatus.STALE
    return PublicAuthorityStatus.UNKNOWN


def _entitlement_status(freshness: FreshnessStatus,
                        state: EntitlementState) -> PublicAuthorityStatus:
    if state is EntitlementState.NOT_AVAILABLE:
        return PublicAuthorityStatus.NOT_APPLICABLE
    if freshness is FreshnessStatus.STALE or state is EntitlementState.STALE:
        return PublicAuthorityStatus.STALE
    if freshness is FreshnessStatus.UNKNOWN or state is EntitlementState.UNKNOWN:
        return PublicAuthorityStatus.UNKNOWN
    return PublicAuthorityStatus.FOUND_FRESH


def _limit_availability(limit) -> PublicLimitAvailability:
    if limit.unlimited:
        return PublicLimitAvailability.UNLIMITED
    if any(value is not None for value in (
        limit.remaining, limit.soft_limit, limit.hard_limit
    )):
        return PublicLimitAvailability.FINITE
    return PublicLimitAvailability.UNKNOWN


def _pricing_warnings(freshness: FreshnessStatus):
    if freshness is FreshnessStatus.STALE:
        return (PublicWarningCode.PRICING_STALE,)
    if freshness is FreshnessStatus.UNKNOWN:
        return (PublicWarningCode.PRICING_UNKNOWN,)
    return ()


def _entitlement_warnings(freshness: FreshnessStatus, state: EntitlementState):
    if freshness is FreshnessStatus.STALE or state is EntitlementState.STALE:
        return (PublicWarningCode.ENTITLEMENT_STALE,)
    if freshness is FreshnessStatus.UNKNOWN or state is EntitlementState.UNKNOWN:
        return (PublicWarningCode.ENTITLEMENT_UNKNOWN,)
    return ()


def _official_reference(source_type: AuthoritySourceType,
                        reference: str | None) -> str | None:
    return reference if source_type is AuthoritySourceType.OFFICIAL_PROVIDER else None


def _provenance(source):
    if source is None or source.captured_at is None:
        return None
    return PublicProvenance(
        source.source_type, source.source_reference, source.captured_at
    )


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _secret_safe(*values: str | None) -> None:
    if any(contains_plaintext_secret(value) for value in values if value):
        raise ValueError("public authority contract rejected secret-shaped content")


def _public_root(value) -> None:
    if not isinstance(value, (
        PublicPricingAuthority, PublicEntitlementAuthority,
        PublicAttributionAuthority,
    )):
        raise TypeError("public serializer accepts only public authority responses")
