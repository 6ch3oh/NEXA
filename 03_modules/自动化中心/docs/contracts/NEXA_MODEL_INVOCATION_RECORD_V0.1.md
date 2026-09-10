# NEXA Model Invocation Record v0.1

Status: `FROZEN_CONTRACT / MODULE-LOCAL OFFLINE VALIDATED`

## Purpose and authority

`ModelInvocationRecord` is the stable, provider-neutral record emitted by the
Automation Center LiteLLM Core adapter. It records who invoked which configured
model profile, the normalized runtime outcome, usage, cost provenance, latency,
and safe diagnostics.

It is not a prompt/result store, trace backend, billing ledger, entitlement
engine, retry engine, or model decision engine. OWNER remains the final model
selection authority. The existing `ModelGatewayRequest`, `ModelGatewayResult`,
`ModelProfile`, and `TierModelBinding` contracts remain unchanged.

## Stable fields

| Group | Fields | Rule |
| --- | --- | --- |
| Identity | `request_id`, `customer_id`, `user_tier`, `capability_id` | Required and preserved from the NEXA request. |
| Execution correlation | `workflow_id`, `execution_id` | Optional safe identifiers. |
| Model | `model_profile`, `requested_alias`, `resolved_provider`, `resolved_model` | OWNER policy resolves profile/alias before Core. |
| Runtime | `status`, `started_at`, `completed_at`, `latency_ms` | UTC-aware timestamps; latency is non-negative. |
| Usage | `usage_availability`, `input_tokens`, `output_tokens`, `total_tokens` | Counts are non-negative integers or `null`. |
| Cost | `cost_amount`, `cost_currency`, `cost_source` | Amount is finite/non-negative or `null`; known currency is ISO 4217. |
| Provider identity | `provider_request_id`, `provider_response_id` | Optional safe correlation IDs only. |
| Result reference | `result_type`, `result_summary`, `artifact_ref` | Summary is bounded and content-free; artifact is an optional reference. |
| Error | `error_category`, `error_code`, `retryable`, `safe_message`, `provider_status_code`, `provider_error_id` | Required only when `status=ERROR`; raw exception text is forbidden. |

## Usage normalization

`usage_availability` is deterministic:

- `COMPLETE`: input, output, and total token counts are all present.
- `PARTIAL`: at least one count is present and at least one is unavailable.
- `UNAVAILABLE`: all three counts are `null`.

The adapter does not infer `total_tokens` and never fills a missing field with
zero. LiteLLM's response object may synthesize zero for an omitted usage field;
such a zero is treated as unavailable unless the transport boundary explicitly
records that the provider reported the field. A trusted reported zero remains
zero.

Invalid values (`NaN`, infinity, negative values, booleans, or non-integers) are
normalized to unavailable rather than raising or fabricating usage.

## Cost normalization

| `cost_source` | Meaning |
| --- | --- |
| `PROVIDER_REPORTED` | Provider supplied an explicit amount and currency. |
| `LITELLM_CALCULATED` | LiteLLM supplied `response_cost`; v0.1 records this in USD. |
| `NEXA_ESTIMATED` | NEXA supplied a separately identified estimate and currency. |
| `UNAVAILABLE` | Amount and currency are both `null`. |

Priority is Provider-reported, then LiteLLM-calculated, then explicitly supplied
NEXA estimate. Unknown cost is never changed to `0`. A trusted reported value of
`0` is preserved as a known zero cost. `NaN`, infinity, negative, or unlabelled
estimated cost is unavailable.

This provenance is observational. It is not an invoice, payment fact, commercial
balance, or 03 AI Asset Center ledger write.

## Content and secret boundary

The record must not contain:

- prompt or full response content;
- raw exception or traceback;
- API key, bearer token, Authorization header, secret, or credential-bearing
  metadata.

Full content belongs to separately approved Request/Result/Trace storage. The
record uses fixed safe result/error summaries and safe correlation identifiers.

## `AI_USAGE_EVENT` local outbox projection

`to_ai_usage_event_candidate()` exposes a content-free projection containing
identity, tier, profile, provider/model, status, tokens, cost provenance,
latency, and completion timestamp. The Customer Request Ledger v0.1 may persist
this projection in its module-local SQLite outbox in the same transaction as a
minimal invocation reference. It contains no prompt, response, credential,
billing decision, or retry instruction.

Local event idempotency and delivery-state semantics are frozen in
`NEXA_AI_USAGE_EVENT_OUTBOX_V0.1.md`. Whether 03 AI Asset Center consumes this
event, its transport, consumer acknowledgement, ledger semantics, and financial
authority still require a future cross-module contract. No external delivery or
cross-module read/write is performed.

## Downstream boundary

Langfuse may later consume the same safe correlation/usage projection for trace
metadata. It does not become CUSTOMER, Billing, Result, or Knowledge Review
authority. No Langfuse runtime is authorized here.
