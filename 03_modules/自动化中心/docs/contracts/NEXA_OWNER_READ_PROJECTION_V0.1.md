# NEXA OWNER Read Projection v0.1

Status: `FROZEN_CONTRACT / READ_ONLY / UI_NOT_STARTED`

## Purpose and authority

The OWNER Read Projection is the stable application-query boundary for a future
Refine or NEXA Desktop administration UI:

`Request Ledger SQLite -> SQLite read repository -> OwnerReadQueryService -> future UI`

The UI must not query SQLite, compose SQL, import LiteLLM objects, or depend on
`ModelInvocationRecord` internals. Request Ledger remains business authority;
Model Invocation Record remains invocation authority. This projection does not
become a second database, event store, billing ledger, knowledge authority, or
model-selection engine.

## Application query contract

The current Python facade maps future client names to methods:

| Candidate client method | Python application method |
| --- | --- |
| `getOverview` | `get_overview` |
| `listCustomers` | `list_customers` |
| `getCustomer` | `get_customer` |
| `listRequests` | `list_requests` |
| `getRequest` | `get_request` |
| `listKnowledgeReviewQueue` | `list_knowledge_review_queue` |
| `getModelUsage` | `get_model_usage` |
| `getTierUsage` | `get_tier_usage` |
| `listRecentActivity` | `list_recent_activity` |

There is no HTTP server and no write method. Stable dataclasses plus canonical
JSON-safe serialization form the application contract.

## Time windows

`TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, and `CUSTOM` resolve to a
half-open `[from_at, to_at)` UTC interval. Day boundaries are first resolved in
the requested timezone, preventing local-midnight data from crossing buckets.

Any installed IANA timezone is supported. For service-free Windows runtimes
without IANA data, `UTC`, `Asia/Shanghai` (UTC+8, no DST since 1991), and explicit
`UTC±HH:MM` offsets remain available. The contract does not globally hardcode
UTC+8. A future deployment that needs DST-aware zones must provide system IANA
data or the standard `tzdata` package as a separately reviewed runtime decision.

Request counts use request `created_at`; invocation/token/cost/model activity
uses invocation `created_at`. This prevents a delayed invocation from being
misreported on the request's earlier day.

## Overview

`OwnerOperationsOverview` contains resolved window, distinct CUSTOMER count,
separate OWNER/CUSTOMER request counts, request outcomes, invocation/token/cost
rollups, knowledge-review counts, and a bounded recent-request list.

Token sums include only known fields. `token_unknown_count` counts invocations
where any token dimension is unavailable.

## Customer views

`OwnerCustomerListItem` includes stable customer identity, latest observed tier,
first/last activity, request outcomes, invocation/token/cost rollups, pending
review count, and activity state. CUSTOMER list excludes OWNER identity.

Active means `last_seen_at >= now - active_days`; default `active_days=30`.
This is observed activity, not subscription, payment, login, or entitlement
state. Search uses literal substring matching on `customer_id`; tier filtering
uses latest observed tier.

`OwnerCustomerDetail` uses exact customer identity and returns all-time summary
plus a paged request history containing no other customer.

## Request views

Request list supports actor, exact customer, tier, business status, capability,
provider, model, knowledge-review state, and request-created time window. It
supports newest/oldest ordering with request ID as deterministic tie-breaker.
Each request list item also carries its SQL-aggregated known input/output/total
tokens and unknown-token invocation count so UI clients never load invocation
rows or duplicate token aggregation logic.

Request detail exposes bounded input metadata/reference without dereferencing raw
content; up to 500 invocation summaries and 500 artifact references with explicit
truncation flags; result/Markdown/artifact references; and knowledge-review
metadata. Invocation summary exposes the minimal safe persisted projection:
profile, provider/model, status, tokens, cost provenance, latency, and normalized
safe error. It never exposes prompt, response body, raw exception, credential,
or trace body.

Knowledge `future_allowed_actions` is descriptive metadata only;
`write_enabled=false`. No ACCEPT, REJECT, or knowledge-base write exists.

## Pagination

v0.1 uses controlled offset pagination: default `50`, maximum `500`, negative
offset or limit above `500` is rejected. `has_more` is determined by fetching one
extra row; `next_offset` is returned only when more data exists.

Offset pagination was selected because the local single-writer SQLite ledger is
small, it supports arbitrary combined filters and both sort directions with
clear semantics, and it avoids prematurely freezing a large composite cursor.
Stable tie-breakers prevent duplicate/missing rows in an unchanged snapshot.
Concurrent inserts can shift offsets; a future internet-scale API may add a
snapshot/cursor contract without changing these projection models.

## Cost correctness

Cost is `COMPLETE`, `PARTIAL`, `UNAVAILABLE`, or `MIXED_CURRENCY`.

- Known values in one currency expose a labelled subtotal.
- Any unknown invocation makes completeness `PARTIAL` and reports the unknown
  count; the subtotal is never labelled as an exact total.
- Multiple known currencies expose per-currency subtotals, set
  `mixed_currency=true`, and leave the single subtotal/currency null.
- Missing cost is never converted to zero.

Tier success rate is `SUCCEEDED / concluded outcomes`; running/accepted/validating
requests are excluded from the denominator. Average latency is present only when
at least one known latency sample exists, with sample count reported.

## Model, tier, review, and activity views

Model usage groups by exact `provider + model` and reports distinct requests,
invocations, known tokens, cost completeness, failures, sampled average latency,
and last use. Optional tier filtering is display-only and never changes routing.

Tier usage always returns FREE, BASIC, PRO, PREMIUM, OWNER rows, including zero
rows. OWNER is not merged into CUSTOMER usage.

Knowledge queue contains CUSTOMER requests in `NOT_REVIEWED` or
`PENDING_REVIEW` only. Recent activity is derived on demand with a bounded SQL
`UNION` over existing request/invocation state; no event store is created.

## SQLite and migration boundary

The repository opens the existing ledger with SQLite `mode=ro` and
`PRAGMA query_only=ON`. Aggregation/filter/order/limit run in SQL rather than
loading complete tables into memory. No summary database or cache exists.

The ledger's repeatable schema-open step adds only five nullable bounded
invocation projection columns (`input_tokens`, `output_tokens`, `total_tokens`,
`latency_ms`, `safe_error`) and five query indexes for request time/actor/
capability and invocation time/provider/model. Existing v0.1 databases reopen;
running the migration again is a no-op. Existing rows may keep newly added fields
null when the older ledger never stored that diagnostic.

## Explicit exclusions

No Refine/React/Electron/HTML UI, Langfuse, OpenMeter, HTTP server, Provider call,
credential, Production database row, Production n8n write, workflow activation
or execution, form submission, cross-module write, payment, registration, cache,
or model-routing change is authorized by v0.1.
