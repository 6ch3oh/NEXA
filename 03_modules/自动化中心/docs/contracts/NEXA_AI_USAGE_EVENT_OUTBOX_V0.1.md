# NEXA AI Usage Event Outbox v0.1

Status: `FROZEN_CONTRACT / MODULE-LOCAL ONLY / NO EXTERNAL DELIVERY`

## Purpose

The outbox makes an accepted `ModelInvocationRecord` observable as one compact
`AI_USAGE_EVENT` candidate in the same SQLite transaction as its invocation
link. It prevents a crash between linkage and event creation from leaving one
without the other.

This is local persistence only. v0.1 has no transport, subscriber, message
broker, retry scheduler, 03 AI Asset Center write, billing authority, or
cross-module API.

## Stable envelope

Each row contains:

- deterministic `event_id` and `invocation_id`;
- stable `idempotency_key`;
- `request_id`, UTC `created_at`, and `event_type=AI_USAGE_EVENT`;
- compact JSON payload from `ModelInvocationRecord.to_ai_usage_event_candidate()`;
- delivery state `PENDING`, `DELIVERED`, or `FAILED`.

The payload includes request/customer/tier/capability identity, optional
workflow/execution references, model profile, provider/model, invocation status,
reported token fields, cost amount/currency/provenance, latency, and occurrence
time. It excludes prompt, response body, raw exception, traceback, credential,
artifact body, entitlement decision, invoice, and retry instruction.

## Idempotency and conflict behavior

The key is `AI_USAGE_EVENT:<deterministic invocation_id>`. The invocation ID is
derived from stable invocation correlation data, not a random retry token.

- Same key and same canonical payload: no-op; no second invocation link or event.
- Same deterministic identity with different linkage or payload: explicit
  `IdempotencyConflictError`; existing data is not overwritten.
- `invocation_id` and `idempotency_key` are both unique in SQLite.

`PENDING` may become `FAILED` or `DELIVERED`; `FAILED` may later become
`DELIVERED`. `DELIVERED` is terminal, and no state returns to `PENDING`.

## External boundary

Reading and marking the local outbox does not authorize sending it anywhere.
Transport, authentication, acknowledgement semantics, consumer idempotency, and
financial interpretation require a separate project-control decision and a
separately approved cross-module contract.

