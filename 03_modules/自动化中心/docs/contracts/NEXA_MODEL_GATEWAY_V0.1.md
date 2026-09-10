# NEXA Model Gateway Contract v0.1

Status: `FROZEN_CONTRACT / NONPROD IMPLEMENTATION`

## Purpose

Future n8n workflows call one NEXA-owned gateway contract and do not bind business
logic to an AI provider or physical model. n8n remains the only workflow engine;
LiteLLM Core is only an in-process OSS library behind a thin Automation Center
adapter. It executes the provider model projected from an alias already selected
by the OWNER policy.

The v0.1 flow is:

`caller -> NEXA ModelGatewayRequest -> explicit tier/profile policy -> thin adapter -> LiteLLM Core -> provider`

This contract contains no automatic model decision engine. Price, StarBench,
AI-asset cost data, and external model intelligence may inform the OWNER but may
not mutate a profile or binding.

## Request

`ModelGatewayRequest` fields:

| Field | Type | Rule |
| --- | --- | --- |
| `request_id` | string | Caller-generated correlation ID. |
| `customer_id` | string | Customer correlation; not a billing database. |
| `user_tier` | enum | `FREE`, `BASIC`, `PRO`, `PREMIUM`, or `OWNER`. |
| `capability_id` | string | Stable workflow capability, e.g. `knowledge.collect`. |
| `model_profile` | string/null | Normally null; a supplied value must match the OWNER binding and cannot override it. |
| `input` | string | Capability input for the gateway request. |
| `metadata` | object | Safe observability metadata; secrets are forbidden. |

The authoritative adapter target is the official LiteLLM Core Python
`completion()` function in a module-local isolated runtime. The caller supplies
the NEXA request; the policy resolves the alias; the thin adapter projects that
alias to an explicit provider model and invokes Core. Provider credentials must
remain behind a future NEXA adapter credential boundary and must not be passed in
the business request. Proxy/server mode is not part of v0.1.

## Result

`ModelGatewayResult` fields:

| Field | Rule |
| --- | --- |
| `request_id` | Echoes the NEXA correlation ID. |
| `requested_profile` | The explicit OWNER-maintained profile resolved from tier/capability. |
| `resolved_alias` | LiteLLM model alias sent by the adapter. |
| `resolved_provider` | Core-adapter-observed provider label when available. |
| `resolved_model` | Physical model reported by the downstream response when available. |
| `status` | `success` only after a successful downstream response; errors are not silently rerouted. |
| `usage` | Prompt, completion, and total tokens when reported. |
| `estimated_cost` / `actual_cost` | Nullable observability fields, not a billing engine. |
| `latency_ms` | Adapter-observed latency. |
| `provider_request_id` | Nullable downstream response ID. |

For usage/accounting/diagnostic consumers, the Core adapter additionally emits
the content-free `ModelInvocationRecord v0.1`. Its usage availability, cost
provenance, error taxonomy, secret boundary, and `AI_USAGE_EVENT` candidate are
defined in `NEXA_MODEL_INVOCATION_RECORD_V0.1.md` and
`NEXA_MODEL_ERROR_TAXONOMY_V0.1.md`. This does not change the frozen request or
result fields above.

## Fail-closed rules

- Missing or disabled tier/capability binding: reject before LiteLLM.
- Missing or disabled profile: reject before LiteLLM.
- Tier not allowed by profile: reject before LiteLLM.
- Caller profile override: reject before LiteLLM.
- Unknown tier: reject policy loading/request construction.
- Fallback is explicitly `OFF` in v0.1 non-production config.
- No default or expensive model is selected on an error.

## Reserved policy fields

`max_cost_per_request`, `daily_budget`, `monthly_budget`, and `rate_limit` are
nullable configuration placeholders. v0.1 does not implement charging, a ledger,
OpenMeter, or a billing engine.

## Production boundary

This contract does not authorize editing, activating, publishing, or executing any
Production n8n workflow. Production adoption requires a separate approved task.
