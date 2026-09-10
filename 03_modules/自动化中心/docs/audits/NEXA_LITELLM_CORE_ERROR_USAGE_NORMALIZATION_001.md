# NEXA LiteLLM Core Error and Usage Normalization 001

Task: `NEXA-LITELLM-CORE-ERROR-USAGE-NORMALIZATION-001`

Status: `PASS / MODULE-LOCAL OFFLINE VALIDATED`

## Plain-language conclusion

Automation Center can now produce one stable record showing which customer and
tier used which OWNER-configured profile, provider, and physical model; how many
tokens were reported; whether cost was Provider-reported, LiteLLM-calculated,
NEXA-estimated, or unavailable; the latency and provider correlation IDs; and a
stable safe error category when a call fails.

Unknown token/cost data remains `null`, not fake zero. A trusted reported zero
cost remains zero. Prompt/response bodies, raw exceptions, API keys, Authorization
headers, and traceback are excluded from the invocation record.

The 13-case acceptance matrix entered LiteLLM Core 1.98.0 once per case using its
offline mock path or a post-Core synthetic boundary failure. No real model,
credential, Provider network, production workflow, retry engine, or automatic
model decision was used. Real API cost was zero.

## Completed contracts

- `ModelInvocationRecord v0.1`: 32 frozen fields covering request/execution/model
  identity, status/timing, usage, cost provenance, provider correlation, bounded
  result reference, and normalized error.
- `ModelErrorCategory v0.1`: 12 stable categories independent of upper-layer
  LiteLLM exception classes.
- `AI_USAGE_EVENT`: content-free `CANDIDATE_ONLY / NO_WRITE` projection for a
  future cross-module contract with 03 AI Asset Center.

## Usage and cost semantics

- Usage: `COMPLETE`, `PARTIAL`, or `UNAVAILABLE` based only on present trusted
  fields; totals are never inferred.
- LiteLLM-synthesized zero for an omitted token field becomes `null` unless raw
  presence is explicitly known.
- Cost sources: `PROVIDER_REPORTED`, `LITELLM_CALCULATED`, `NEXA_ESTIMATED`, and
  `UNAVAILABLE`.
- Missing/invalid/NaN/infinite/negative cost becomes `null / UNAVAILABLE`.
- Trusted Provider-reported zero remains `0 / PROVIDER_REPORTED`.

## Runtime matrix

All 13 cases passed:

1. success + complete usage + LiteLLM-calculated cost;
2. success + complete usage + unavailable cost;
3. success + partial usage;
4. success + no usage;
5. Rate Limit → `RATE_LIMITED / retryable=true`;
6. Authentication → `AUTHENTICATION_FAILED / retryable=false`;
7. Timeout → `TIMEOUT / retryable=true`;
8. Provider 5xx → `PROVIDER_UNAVAILABLE / retryable=true`;
9. Context Limit → `CONTEXT_LIMIT_EXCEEDED / retryable=false`;
10. unknown failure → `UNKNOWN_PROVIDER_ERROR`;
11. fake secret exception → fixed safe message, secret absent;
12. Provider-reported zero cost retained;
13. explicit NEXA estimate labelled `NEXA_ESTIMATED`.

Machine evidence:
`fixtures/model_gateway/litellm_core_normalization.evidence.json`.

## Secret and content safety

- Raw exception persisted: `NO`.
- Fake `sk-...` marker in record/evidence: `0 occurrences`.
- Prompt or mock response content in records/evidence: `NO`.
- Record validators reject secret-like text in all persisted string fields.
- Provider error IDs are optional and allow-list formatted; unsafe values become
  `null`.

## Verification

- Normalization contract/evidence focused tests: `13/13 PASS`.
- Broader Core-focused tests: `18/18 PASS`.
- Full module regression: `587/587 PASS`.
- LiteLLM runtime dependency check: `PASS`; Enterprise and Proxy extras absent.
- System Python: `17` distributions; LiteLLM absent; freeze SHA-256 unchanged at
  `734bae15cbdad6d3e41b1e55e593afe61c9863595fc5841d60294e681bfcccb7`.
- n8n Legacy: `294` files, `15,680,304` bytes, latest write unchanged at
  `2026-08-05T08:07:02.9397592Z`.
- LiteLLM upstream audit reference: `8` files; HEAD unchanged at
  `b9bff0998c9c89034314a81000ff8f9ff9158a01`.
- Production active/write/execution: `false / false / false`.

## Scope boundary and next goal

No file outside Automation Center was read for domain construction or modified.
03/04/12, Core, ExecutionHub, Langfuse, OpenMeter, Production n8n, and other
modules remain untouched.

Next recommended goal: freeze the module-local invocation-record persistence
outbox/idempotency contract and retention/redaction rules, still without writing
03 AI Asset Center or running Langfuse. A cross-module transport requires project
control approval.
