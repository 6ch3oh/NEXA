# NEXA Customer Request Ledger v0.1 001

Task: `NEXA-CUSTOMER-REQUEST-LEDGER-V0.1-001`

Status: `PASS / MODULE-LOCAL OFFLINE VALIDATED`

## Plain-language conclusion

Automation Center can now record who submitted a request, whether the actor was
OWNER or CUSTOMER, the customer/tier/time/capability, which model invocations
belong to it, the final result and artifact references, cost completeness, and
knowledge-review state. Exact customer history and the required operational
filters are available from bounded module-local queries.

One request supports zero, one, or many model invocations. Replaying the same
invocation creates no second usage event; the same deterministic identity with a
different payload fails as a conflict and does not overwrite the original.
CUSTOMER results start `NOT_REVIEWED` and never enter OWNER knowledge
automatically.

Data is stored in one service-free Python-stdlib SQLite file selected by the
module caller. The file contains bounded metadata, summaries, logical references,
minimal invocation/cost linkage, and compact usage events—not raw prompt,
response, webpage body, artifact body, trace body, or credentials. Growth is
linear in requests, references, invocations, and outbox events rather than source
content size: `O(requests + refs + invocations + events)`. The empty schema in
the acceptance environment was 90,112 bytes; actual per-row size depends on
bounded identifiers and summaries.

## Read-first decision

The existing Result layer already provided safe references, normalized summaries,
and in-memory historical queries. The completed `ModelInvocationRecord v0.1`
provided the authoritative usage/cost/error source and a content-free
`AI_USAGE_EVENT` projection. No reusable persistent request/outbox repository or
atomic JSON/JSONL/SQLite store existed in the production package.

Python-stdlib SQLite was selected because it adds no package, database service,
network, daemon, or workflow engine while providing atomic transactions, foreign
keys, unique idempotency constraints, and indexed bounded queries. Existing n8n
Legacy assets remain execution authority and were not rewritten or executed.

The requested OpenCode + DeepSeek execution interfaces were not callable in this
session. Their participation was not fabricated; Codex performed the local
implementation. DeepSeek calls: `0`.

## Frozen contracts

- `NEXA_CUSTOMER_REQUEST_LEDGER_V0.1`: OWNER/CUSTOMER identity, request lifecycle,
  input/result references, knowledge review, query and storage boundaries.
- `NEXA_AI_USAGE_EVENT_OUTBOX_V0.1`: compact local event, atomic linkage,
  idempotency, conflict and delivery-state semantics; no external transport.
- `NEXA_REQUEST_DATA_RETENTION_V0.1`: independent metadata policy for Request
  Metadata, Raw Input, Result, Artifact and Trace; no physical deletion.

## Request, invocation, and result authority

`CustomerRequestRecord` is business-request authority.
`ModelInvocationRecord` remains model-call authority. The ledger stores only a
deterministic invocation ID/reference plus model/status/cost fields needed for a
request summary; it does not copy the complete record. Result bodies and
artifacts remain behind `result_ref`, `artifact_refs`, and `markdown_ref`.

Business request status is independent from Provider/model error taxonomy.
Request cost summary is `COMPLETE`, `PARTIAL`, `UNAVAILABLE`, or
`MIXED_CURRENCY`. If any invocation cost is unknown, `total_amount` stays null and
only a labelled known subtotal is exposed.

## Acceptance matrix

All 12 required cases passed:

1. OWNER save/read/query with stable `owner:nexa` and zero invocations;
2. BASIC CUSTOMER plus one invocation;
3. PRO CUSTOMER plus multiple invocations;
4. exact isolation of two CUSTOMER identities;
5. successful request with result/artifact/Markdown references;
6. failed business request and failed model invocation kept distinct;
7. CUSTOMER knowledge default not accepted;
8. module-local `AI_USAGE_EVENT` outbox;
9. identical replay no-op and conflicting replay fail-closed;
10. partial/unknown request cost not claimed exact;
11. retention state transition without physical deletion;
12. secret and bounded-storage rejection.

An additional query-matrix test covers actor, customer, time, tier, failure,
pending review, request summary, and resolved model lookup.

Machine evidence:
`fixtures/customer_request_ledger/customer_request_ledger.evidence.json`.

## Verification and unchanged authorities

- Request Ledger focused tests: `16/16 PASS` (13 domain/storage/query plus 3
  machine-evidence tests).
- Full module regression: `603/603 PASS`.
- Offline acceptance runner: `12/12 PASS`; network attempts `0`.
- Real Provider calls / real API cost: `0 / 0`.
- Production write / workflow activate / workflow execute: `false / false / false`.
- n8n Legacy: unchanged at `294` files, `15,680,304` bytes, latest file write
  `2026-08-05T08:07:02.9397592Z`.
- LiteLLM upstream audit reference: `8` files; HEAD unchanged at
  `b9bff0998c9c89034314a81000ff8f9ff9158a01`.
- System Python: `17` distributions; newline-free freeze SHA-256 unchanged at
  `734bae15cbdad6d3e41b1e55e593afe61c9863595fc5841d60294e681bfcccb7`.
- LiteLLM Core authority remains `ADOPT_AS_LIBRARY / OSS CORE`, version `1.98.0`.

The earlier reconciliation test treated every SQLite import as equivalent to a
second engine. It now preserves the network/process/deployment prohibition and
allows `sqlite3` only in the single bounded Request Ledger adapter. No other
production source may import it under the invariant test.

## Scope and next goal

Only Automation Center files were changed. No 03/04/12, Core, ExecutionHub,
Production n8n, Langfuse, OpenMeter, payment, registration, or external user
system was read as an application dependency or written.

The next safe local phase is a read-only backend projection over the Request
Ledger for a future OWNER administration UI, including pagination and aggregate
views, still without authentication, payment, Langfuse runtime, external outbox
delivery, or production workflow action. Connecting Langfuse or delivering usage
events to 03 requires a separately approved integration contract.

