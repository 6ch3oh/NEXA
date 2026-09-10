# NEXA Customer Request Ledger v0.1

Status: `FROZEN_CONTRACT / MODULE-LOCAL OFFLINE VALIDATED`

## Purpose and authority

The Request Ledger is Automation Center's compact record of a customer or OWNER
request from intake through its final business result. It wraps and observes the
existing automation and LiteLLM assets; it is not a workflow engine, model
router, billing service, knowledge base, trace backend, or replacement for n8n.

`CustomerRequestRecord` and `ModelInvocationRecord` are different contracts:

`1 CustomerRequestRecord -> 0..N ModelInvocationRecord references`

The ledger stores deterministic invocation references and the minimum projection
needed for request/OWNER read summaries: model/status, token fields, cost
provenance, latency, and normalized safe error. It never copies a complete
invocation record, prompt, response body, raw exception, workflow definition, or
n8n data.

## OWNER and CUSTOMER boundary

- OWNER uses stable identity `owner:nexa` and `UserTier.OWNER`.
- CUSTOMER uses its stable `customer_id` and cannot use OWNER identity or tier.
- `actor_type` is always `OWNER` or `CUSTOMER`; it is never inferred from free
  text.
- Customer rows are queried by exact `customer_id`. No implicit cross-customer
  aggregation is exposed.

## Request state

The stable lifecycle states are `RECEIVED`, `VALIDATING`, `ACCEPTED`, `RUNNING`,
`SUCCEEDED`, `PARTIAL_SUCCESS`, `FAILED`, `REJECTED`, and `CANCELLED`.

Transitions fail closed. `RUNNING` requires `started_at`; terminal states require
`completed_at`. Request/business failure remains independent from the normalized
status and error category of any linked model invocation.

## Stored fields

| Group | Fields and rule |
| --- | --- |
| Identity | `request_id`, `actor_type`, `customer_id`, `user_tier`, `capability_id`; stable and immutable. |
| Correlation | Optional safe `workflow_id`, `execution_id`, and `trace_id`; references only. |
| Time | Aware `created_at`, `started_at`, `completed_at`, `updated_at`; update time cannot move backwards. |
| Input | `input_type`, bounded `input_summary`, optional logical `input_ref`, safe HTTP(S) `source_url`; no unbounded raw body. |
| Result | `result_status`, bounded `result_summary`, optional `result_ref`, `artifact_refs`, and `markdown_ref`; references only. |
| Knowledge | `knowledge_review_state`, optional accepted destination reference, data classification. |
| Retention | One metadata policy record for each frozen retention data class. |

Identifiers, summaries, references, and URLs reject credential-like content.
URLs reject userinfo and credential-like query keys. Logical references reject
absolute filesystem paths.

## Result and knowledge review

Result availability is `NOT_AVAILABLE`, `AVAILABLE`, `PARTIAL`, or `FAILED`.
The result layer is linked using bounded summaries and logical references rather
than copied artifacts.

Knowledge review is `NOT_APPLICABLE`, `NOT_REVIEWED`, `PENDING_REVIEW`,
`ACCEPTED`, or `REJECTED`. A CUSTOMER request defaults to `NOT_REVIEWED` and
`CUSTOMER_PRIVATE`; it is never auto-accepted into knowledge. An accepted
destination is valid only with `ACCEPTED` review state. Authorization for the
review action is a future application-layer concern and is not fabricated here.

## Storage and queries

The reference adapter uses one Python-stdlib SQLite file, local to this module's
caller-selected path. It requires no server, background process, or external
database service. Foreign keys, unique constraints, and `BEGIN IMMEDIATE`
transactions protect request/invocation/outbox consistency.

Every list query has a required bounded limit (`1..500`). v0.1 supports exact
queries by actor, customer, time range, tier, failed request, pending knowledge
review, request summary, and resolved model. Model query uses the minimal linked
invocation projection and remains provider-neutral.

The separately frozen `NEXA_OWNER_READ_PROJECTION_V0.1` opens this same file in
read-only mode and performs on-demand SQL projection. It creates no summary
database or cache and is the only supported data boundary for a future OWNER UI.

## Explicit exclusions

No production n8n connection, workflow activation/execution, provider call,
Core or ExecutionHub change, cross-module write, PostgreSQL/MySQL service,
physical deletion worker, or second automation platform is part of v0.1.
