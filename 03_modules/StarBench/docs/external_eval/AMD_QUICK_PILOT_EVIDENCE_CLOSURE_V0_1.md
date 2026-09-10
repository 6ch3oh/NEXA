# AMD QUICK Pilot Evidence Closure V0.1

Task: `NEXA-STARBENCH-AMD-QUICK-PILOT-EVIDENCE-CLOSURE-V0.1-001`

Status: `PASS — REAL_PILOT_EVIDENCE_READY`

This closure is entirely offline. It used localhost HTTP fixtures, a synthetic
one-shot access value, and synthetic Provider usage. Real AMD calls, real
Credential reads, and model API Token cost were all zero.

## Evidence path

Every accepted request now follows one StarBench-owned path:

`Transport → RAW_RESULT → Canonical Evaluation → Request Ledger → cumulative Token accounting → CONTINUE/STOP decision → raw evidence reference`

Preflight is request 1 and the three frozen Legacy Anchors are requests 2–4.
The sequence is contiguous and unique. A stopped entry cannot be followed by a
later entry, and request 4 must stop.

`AMD QUICK REQUEST LEDGER V0.1` records the Pilot/request/task identities,
timestamps, latency, frozen target/model claim, allowlisted HTTP evidence,
response shape, output limits, normalized Provider usage, per-request and
cumulative total Tokens, the 1800-Token operational ceiling, the continuation
decision and reason, and content-addressed RAW_RESULT/Canonical references.

HTTP evidence retains only status code, response timestamp, content type,
redirect status, and transport status. Authorization, Cookie, and arbitrary
response headers are not retained.

Provider `total_tokens` is authoritative for cumulative arithmetic. Component
fields remain null when the Provider reports only a total. Explicit reasoning
and cached input components are retained by the existing identity Token
accounting contract. No text-length estimate is used. `AFTER >= 1800` produces
`STOP_TOKEN_CEILING_REACHED` and forbids another request.

Ledger validation fails closed for sequence or request identity conflicts,
cumulative arithmetic conflicts, missing decision evidence, missing HTTP
status, missing references, modified RAW_RESULT content, Canonical identity
substitution, entry-hash mismatch, and unexpected fields.

## Frozen semantics

The AMD target, `DeepSeek-V4-Flash` claim, request maximum 4, output Token caps
8/128/384/384, 1800 observed-Token stop, no retry, no thinking fallback, no
redirect, `identity_verification = NOT_PERFORMED`, and
`officiality = NOT_ESTABLISHED` remain unchanged.

The prior real-run authorization remains `RECEIVED — NOT CONSUMED`. This PASS
does not execute it and does not authorize a real Pilot. A fresh exact user
instruction `开始真实AMD QUICK测试` is still required.

## Verification

- Evidence Closure tests: `58/58 PASS`.
- External Identity focused regression: `167/167 PASS`.
- Complete offline regression: `765/765 PASS`.
- Legacy baseline: all prior `707/707` tests retained; 58 additive tests pass.
- External Validation Seal SHA-256:
  `04F94D32A62CE193FDF87B20C5CAB61A8266112A84FDC2AD4B3E46224DFA10D6`.
- Credential leak checks: no synthetic access value in Ledger, RAW_RESULT,
  Canonical Evaluation, or Pilot report; no Pilot logging surface emits it.
- Production Estimator, Shadow V1, and Conditional Estimator were not modified.
