# AI Asset Core Readiness V0.1

Status: `READY`

This review closes the local, credential-free core for NEXA AI resource
intelligence. It does not authorize provider network access or cross-module UI
wiring.

## Responsibility map

| Layer | Responsibility | Status |
| --- | --- | --- |
| Contracts | Provider-neutral canonical facts | READY |
| Adapters | Caller-supplied sanitized/external shapes to canonical records | READY |
| Intake | Type, Secret, relationship and whole-batch atomic persistence gates | READY |
| Store | SQLite V3 persistence, history, migration and one-transaction batch writes | READY |
| Query | Deterministic selection with explicit missing/ambiguous outcomes | READY |
| Analytics | Rollup, ranking, directional shares and attribution coverage | READY |
| Authority | Historical pricing/entitlement fact resolution and public read contract | READY |
| Consumption | Stable consumer payloads, including Resource Overview 0.1 | READY |
| Budget | Policy persistence and read-only evaluation | READY |
| Application | Local orchestration over the established layers | READY |

No second Store, Query, Pricing core, Provider core, Token core, Credential
core, Authority history or Consumption implementation was introduced.

## Atomic Intake

`CanonicalIntakeService.ingest_batch` performs whole-batch type, plaintext
Secret, stable identity, event identity and relationship preflight. Provider,
Token, Balance, Usage, Pricing and Cost records (plus existing Authority
records) then participate in one `BEGIN IMMEDIATE` SQLite transaction. A write
exception rolls back every row. Existing single-record methods retain their
auto-commit contract. SQLite remains schema V3.

## Resource intelligence

The established Analytics layer now owns Model, Task and Project Token rankings
and separate Actual/Estimated cost rankings. Each share exposes its numerator,
denominator and Decimal ratio. Cost denominators are per currency; currencies
are never added. Model-to-Task and Task-to-Model relationships use a half-open
period and expose the four named token/cost directions. Unattributed Usage is a
first-class `UNATTRIBUTED` bucket with coverage and unattributed ratios.

Task and Project cost rankings require a provider-scoped, token/model-matching
Usage link. Model cost rankings may use a standalone CostRecord's own model
identity. Subscription and quota Usage never derive monetary shares from API
prices.

## Resource Overview

`AIAssetReadService.get_resource_overview` composes existing Query, Portfolio
Consumption, Analytics, Budget evaluation and Balance Health. Its versioned
payload contains total Tokens, separate Actual/Estimated currency totals,
rankings, attribution coverage, budget status and compact balance health.
Balance details remain in existing provider/token consumption reads.

## Authority update lifecycle

Existing Authority records remain the durable history. The optional immutable
`AuthorityUpdateReceipt` reports stored/idempotent outcome, identity, source,
fetched/verified/effective or observed time, freshness at acceptance and the
history-preserved invariant. No receipt table, manager, scheduler or workflow
engine exists.

## DeepSeek local pilot readiness

Status: `SANITIZED_DEEPSEEK_ADAPTER_READY`

The dedicated DeepSeek adapter only accepts caller-supplied, whitelisted,
`synthetic=true` local facts. Unknown or credential-shaped content fails
closed. It performs no filesystem discovery, HTTP, environment, credential or
provider-client operation. Synthetic Authority is `LOCAL_MANUAL`, never
official. The local chain creates a Secret-free synthetic Canonical Token with
no `secret_ref`; Balance, Usage, Cost and Entitlement reference that Token.

`RAW_OFFICIAL_SCHEMA_VERIFICATION = EXTERNAL_DEPENDENCY`. The project contains
no trusted official raw DeepSeek response schema, so no raw parser was guessed.

## External dependencies retained intentionally

- real DeepSeek Credential and account authorization;
- real HTTP/network transport and official raw schema verification;
- official network price refresh and runtime scheduling;
- 00-coordinated StarBench/Dashboard/UI integration;
- notifications and budget enforcement.

These are outside the local core and do not block local readiness.
