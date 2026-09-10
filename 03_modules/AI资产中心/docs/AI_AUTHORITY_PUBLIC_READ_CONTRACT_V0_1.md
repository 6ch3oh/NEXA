# AI Authority Public Read Contract V0.1

## Contract identity

Frozen identity: `NEXA_AI_RESOURCE_AUTHORITY_PUBLIC_CONTRACT_V0_1 = "0.1"`.
`NEXA_AI_AUTHORITY_PUBLIC_READ_VERSION` remains a compatibility alias.
`get_public_contract_manifest()` returns the canonical contract and
`get_public_contract_hash()` returns SHA-256
`9de54e55f4ebc68240fcfb9e097c3e515edbb2df7b15b53421b5425ed91134b6`.
The digest covers versioned methods, DTO fields, enums, and semantics. It never
uses mtime, paths, generation time, or runtime state.

The storage-neutral entry points are `PublicAuthorityReadService` and
`AIAssetReadService`. Public models are frozen dataclasses. Canonical JSON uses
exact Decimal strings, aware ISO-8601 datetimes, stable enum values, sorted
keys, and deterministic collection ordering.

## Pricing authority

`get_pricing_authority(provider_id, model, billing_mode, as_of, dimension?, correlation?)`
returns version/status, `authority_id`, provider/model/billing identity,
currency, components, effective time, authority and official source, fetched
and verified times, freshness, completeness, warnings, provenance, and the
explicit `token_monetary_estimate_allowed` flag.

Stable statuses are `found_fresh`, `stale`, `unknown`, `missing`, `ambiguous`,
`incomplete`, and `not_applicable`. Missing or unknown monetary values remain
null, never zero. Legacy/reference Authority preserves provenance but exposes
no official source.

Only fresh, complete, applicable `API_USAGE` pricing with at least one component
authorizes an estimated API monetary cost. Stale, unknown, missing, ambiguous,
incomplete, not-applicable, subscription, quota, credit, and hybrid facts do not.

## Entitlement authority

`get_entitlement_authority(provider_id, as_of, token_id?, plan?, model?, correlation?)`
returns snapshot identity/scope, billing mode, typed limits, used/remaining,
reset, state, subscription facts, freshness, completeness, warnings, and
provenance. AVAILABLE, LOW, EXHAUSTED, STALE, UNKNOWN, and NOT_AVAILABLE remain
distinct.

Every limit is FINITE, UNLIMITED, or UNKNOWN. UNLIMITED is emitted only from an
explicit Authority flag. Missing bounds remain UNKNOWN and missing values never
become zero. Subscription/quota may support occupancy, remaining/reset risk,
limit pressure, and resource share, but never token-times-API-price actual cost.

## Resource and attribution authority

The same frozen contract includes:

- `AIAssetReadService.get_resource_overview(...)`
- `AIAssetReadService.get_model_attribution_authority(...)`
- `AIAssetReadService.get_task_model_authority(...)`

These methods reuse the established analytics; they do not create a second
calculation layer. Attribution exposes provider/model/project/module/task/run,
token and cost numerator, denominator, and share. Missing identity serializes as
`UNATTRIBUTED`. Subscription/quota or incomplete real CostRecord coverage makes
cost share unavailable with null amounts.

`PublicCorrelation(project_id, module_id, task_id, run_id)` is reference-only
and never changes Authority selection unless a future version explicitly adds
an authoritative dimension.

## Security and ownership

Public output contains no Credential, cookie, Authorization, secret resolution,
`secret_ref`, SQL, database row, or Legacy Evidence implementation detail.
Secret-shaped inputs or Authority facts fail closed.

Module 03 is the sole source for Pricing, official-source/freshness semantics,
Entitlement, Balance/Quota, remaining/reset, and Usage/Cost Attribution. Module
04 owns Token Forecast, Project Resource Estimate, Model Allocation Proposal,
API estimated monetary presentation, and subscription/quota risk. It must not
create a second price or entitlement store, decide freshness, or fabricate
subscription monetary cost.

Status: `03_SIDE_PUBLIC_CONTRACT = READY`. Module 04 modifications: `0`.
