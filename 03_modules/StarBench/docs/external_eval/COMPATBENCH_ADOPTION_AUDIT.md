# CompatBench Adoption Audit

## Fixed subject

- Repository: `https://github.com/RuizhangZhou/CompatBench.git`
- Commit: `40e2bcc1f2e6a566baa8cd3b5abf965c0a11245e`
- Package version: `0.1.0` (alpha metadata)
- License: MIT (`MIT`)
- Candidate status: `READ_ONLY_REFERENCE`, `NOT_PRODUCTION`
- Endpoint tests executed: `NO`

## Test-matrix value

CompatBench provides a useful, compact vocabulary for OpenAI-compatible endpoint
testing:

- Chat Completions: basic chat, system message, and multi-turn;
- Responses: basic request/response;
- streaming Chat Completions and streaming usage;
- tool calling: automatic, required, and forced named function;
- structured output: `response_format` JSON path plus a fallback path;
- non-stream token usage; and
- generic error-shape inspection.

Its HTTP client constructs OpenAI-style requests, parses server-sent events, and
produces structured per-case reports. It redacts authorization values and sensitive
URL data before reporting.

## Declared versus implemented coverage

The capability declarations mention Responses streaming, parallel tools, auth error
shape, and rate-limit error shape. At the pinned commit, the current suites do not
implement those declared checks. Responses coverage is only basic; streaming is
Chat Completions only; tools cover automatic/required/forced but not parallel; and
the error suite exercises a generic nonexistent-model error rather than dedicated
authentication and rate-limit behavior.

This drift is a reason to borrow and version the matrix rather than adopting the
package as a StarBench runtime dependency.

## Result and scoring semantics

Per-case statuses are `PASS`, `PARTIAL`, `FAIL`, `SKIPPED`, and `ERROR`. Provider and
comparison reports aggregate weighted scores and letter grades. Skipped cases are
excluded from the denominator. That can overstate compatibility when a required
feature is skipped, so the scoring and grade must not be imported as StarBench
canonical evidence.

The structured-output suite makes a primary request and may make a second fallback
request; fallback success is only `PARTIAL`. This is a good matrix concept, but the
actual request count must be visible to StarBench's budget ledger.

## StarBench coverage assessment

StarBench already owns the Provider Adapter contract, safe runtime-credential
boundary, Benchmark Harness, nullable usage/latency measurement, RAW_RESULT writer
and importer, admission/provenance, Canonical Evaluation, scoring, evidence
sufficiency, and result stores.

The present real adapter only implements a single, non-streaming DeepSeek Chat
Completions activation with a one-request cap. Fake local adapters support offline
harness tests. Current source does not establish native real-endpoint coverage for
Responses, streaming, streaming usage, tools/tool choice, forced functions, or
structured output. Those are real gaps, but they should be added later as
StarBench-owned test contracts and adapter capabilities, not inferred from the
existing activation.

## Real versus offline validation

Requires separately authorized real endpoint execution:

- actual support for Chat/Responses payloads;
- system/multi-turn semantics;
- SSE correctness, timing, termination, and streaming usage;
- tool selection and forced/parallel behavior;
- server-side structured-output enforcement;
- returned usage accuracy;
- real authentication, rate-limit, and error schemas; and
- provider-specific fallback/routing behavior.

Can be validated offline with fixtures/mocks:

- request construction and declared capability routing;
- SSE parser behavior across recorded fixtures;
- usage-field normalization;
- tool-call and structured-output response parsing;
- status/reason mapping and required-versus-optional semantics;
- secret/header/URL redaction;
- scoring arithmetic; and
- schema/admission conversion into StarBench evidence.

Offline parser success never proves that a real endpoint implements the feature.

## Dependency decision

Conclusion: `DESIGN_REFERENCE_ONLY`.

Adoption action: `BORROW_DESIGN_ONLY`. Port and extend the test matrix into a
StarBench-owned, versioned API compatibility contract with explicit required,
optional, unsupported, unknown, partial, and not-executed states. Retain per-case
raw provenance and request counts. Do not depend on CompatBench's runtime, aggregate
grade, or evolving declarations.
