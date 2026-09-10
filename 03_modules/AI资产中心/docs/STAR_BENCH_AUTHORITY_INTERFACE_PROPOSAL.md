# 03 → 04 StarBench Authority Interface Proposal

Status: **03_SIDE_PUBLIC_CONTRACT_READY**. Module 04 is not modified. Actual
cross-module wiring remains subject to module 00 coordination.

The frozen 03-side contract is documented in
`AI_AUTHORITY_PUBLIC_READ_CONTRACT_V0_1.md` and exported by
`src.authority.PublicAuthorityReadService`.

## Pricing query

`get_pricing_authority(provider_id, model, billing_mode, as_of, dimension?, correlation?)`

The response is versioned and returns provider/model/billing identity,
currency, composable price components, effective time, authority and official
source semantics, verification timestamps, freshness, completeness, stable
warnings, provenance, and an explicit `token_monetary_estimate_allowed` flag.

StarBench must visibly degrade `STALE`, `UNKNOWN`, `MISSING`, and `AMBIGUOUS`.
Historical forecasts use the latest Authority whose effective time is not
after the requested historical `as_of`.

## Entitlement query

`get_entitlement_authority(provider_id, as_of, token_id?, plan?, model?, correlation?)`

The response preserves resource identity, typed limits, used/remaining/reset,
state, subscription terms, freshness, completeness, warnings, and provenance.
Unknown quantities remain null. Multiple heterogeneous limits are not silently
summed; each limit remains explicit.

## StarBench usage rules

Only `API_USAGE` with a `FOUND_FRESH`, complete Authority and applicable
components has `token_monetary_estimate_allowed=true`. StarBench may combine
that result with its Token Forecast to produce an API monetary estimate.

For `SUBSCRIPTION`, `QUOTA`, `CREDIT`, `HYBRID`, stale, unknown, missing, or
ambiguous Authority, the flag is false. Subscription Token or request forecasts
describe resource occupancy and risk only. Fixed subscription fees are separate
facts and must never be allocated as `Token × API price`.

Correlation fields (`project_id`, `task_id`, `run_id`) are references only. They
must not change the returned official price unless a future authoritative
pricing rule explicitly depends on such a condition.

## Ownership

Module 03 owns authoritative pricing, official-source verification semantics,
freshness, entitlement, quota, remaining, reset, and the public contract.
Module 04 owns Token Forecast, Model Allocation, Project Resource Estimate, and
consumer-side scenario presentation. Module 04 does not own a price database,
freshness decisions, or subscription remaining calculations.
