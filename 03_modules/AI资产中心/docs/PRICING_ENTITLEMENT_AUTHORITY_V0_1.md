# NEXA Pricing & Entitlement Authority V0.1

## Scope

This module is the canonical local authority for provider/model pricing,
subscription and quota entitlements, usage attribution, and historical/as-of
resolution. It is provider-neutral, read-only at the Authority view boundary,
and contains no credential values or network refresh implementation.

## Pricing Authority

`PricingAuthorityRecord` wraps existing `PricingSnapshot` components. It does
not create a second PriceHistory. Historical truth remains the sequence of
snapshots selected by `effective_from <= as_of`.

Required semantics are provider, model, `BillingMode`, one currency, component
prices, authority source type, official source, fetched/verified time, explicit
freshness policy, and provenance. Source types distinguish
`OFFICIAL_PROVIDER`, `LEGACY_REFERENCE`, `LOCAL_MANUAL`, and `DERIVED`; Legacy
or offline evidence must never be labelled official.

Freshness is evaluated only from `last_verified_at`, caller policy
`valid_for`, and `as_of`: `FRESH`, `STALE`, or `UNKNOWN`. No global magic age is
assumed. `AuthorityReadService.pricing` returns the record, components,
currency, effective time, freshness, completeness, warnings, and provenance.

## Entitlement Authority

`EntitlementSnapshot` is distinct from Balance, Budget, and Usage. It carries
provider, optional token/account, plan and model scope, billing mode, optional
fixed fee and cycles, reset time, typed resource/request/task/model/token/
context/call limits, used/remaining/soft/hard values, resource state,
observation time, freshness, and provenance.

Unavailable quantities remain `None`; state/freshness can be `UNKNOWN`. Stale
records are returned as stale evidence, never promoted to current truth.
`QueryService.latest_entitlement` exposes MISSING and same-time AMBIGUOUS
explicitly.

## Billing and subscription boundary

`BillingMode` supports `API_USAGE`, `SUBSCRIPTION`, `QUOTA`, `CREDIT`, and
`HYBRID`. `calculate_authoritative_cost` accepts only `API_USAGE`. It rejects
subscription/quota/credit authorities, so `tokens × API price` can never be
presented as subscription monetary cost. A subscription may independently
record its fixed fee, cycle, usage, quota, remaining resource and reset time.

## Official refresh contract

`OfficialRefreshPolicy` defines on-demand or periodic semantics without doing
network I/O. Periodic mode requires an explicit positive interval. An official
refresh result must verify an `OFFICIAL_PROVIDER` source; without a real adapter
the Authority remains `STALE` or `UNKNOWN`.

## Usage attribution

`UsageRecord.attribution` is backward compatible: omitted attribution becomes
`UNATTRIBUTED`. An attributed observation may include project, module, task and
run identifiers. SQLite round-trips these fields.

The two supported summaries are model-to-attribution and task-to-models. Every
row exposes `token_denominator` and `cost_denominator` alongside its share.
Cost share is available only for API usage billing when every selected Usage
has an explicitly linked, single-currency `CostRecord` of the selected kind.
Partial, mixed-currency, missing, or subscription cost evidence is
`UNAVAILABLE`; no cost is guessed.

## Consumption and Legacy reuse

Existing Consumption schema 0.1 is unchanged. New Pricing, Entitlement, and
Attribution views live under `src.authority`. Existing Provider, Token,
PricingSnapshot, credential security, adapters, Evidence, and
`LEGACY_AI_ASSET_MAPPING.md` are reused; none are reimplemented.

## Security

Canonical Intake accepts constructed contracts only, validates Provider and
optional Token/component references, preserves provenance, and applies the
plaintext-secret gate to Authority metadata and attribution identifiers. Views
contain no secrets.
