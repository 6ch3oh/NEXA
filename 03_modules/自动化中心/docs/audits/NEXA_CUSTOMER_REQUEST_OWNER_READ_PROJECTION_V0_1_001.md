# NEXA Customer Request OWNER Read Projection v0.1 001

Task: `NEXA-CUSTOMER-REQUEST-OWNER-READ-PROJECTION-V0.1-001`

Status: `OWNER_READ_PROJECTION_V0.1_READY`

## Plain-language conclusion

The module now has the stable read-only data layer needed by a future OWNER
operations dashboard. OWNER can query daily users/requests/outcomes, tiers,
tokens, cost completeness, model/provider usage, pending knowledge review, and
recent activity; inspect one CUSTOMER's exact history; and open one Request to
see safe input metadata, all bounded invocation summaries, result/Markdown/
artifact references, and review state.

Unknown cost is never shown as zero or as an exact total. A partial one-currency
set exposes a labelled known subtotal plus unknown invocation count. Mixed
currencies expose separate subtotals and no combined amount.

No formal UI was built. The projection reads the existing Request Ledger on
demand using SQL filters/aggregates/limits. There is no cache, summary database,
second event store, HTTP server, Refine runtime, Langfuse runtime, or content
copy. The completed contract is ready for the separately authorized OWNER Admin
UI phase.

## Read-first and architecture decision

The completed ledger already held request identity/state/result/review, minimal
model/cost linkage, and a content-free usage outbox. It did not yet retain the
token, latency, or normalized safe-error fields needed after a process restart
for Request Detail. The existing Invocation link table was therefore extended
with five nullable bounded projection columns only; no full
`ModelInvocationRecord` or prompt/response body was copied.

The public chain is:

`SQLite Request Ledger -> SQLiteOwnerReadRepository -> OwnerReadQueryService -> future UI`

The repository opens the existing file with `mode=ro` and
`PRAGMA query_only=ON`. Application code and future UI contain no SQL and do not
depend on internal schema or LiteLLM objects.

The requested global execution hub/OpenCode/DeepSeek interfaces were not callable
in this session. Participation was not fabricated. DeepSeek calls: `0`; no
DeepSeek failure or retry occurred.

## Stable read contract

Nine read-only application methods are frozen: overview, customer list/detail,
request list/detail, knowledge-review queue, model usage, tier usage, and recent
activity. Canonical dataclass serialization is available for a future UI adapter.
No write method exists.

Overview separates OWNER from CUSTOMER and reports request status, invocation,
known token, unknown token, cost completeness, review counts, and bounded recent
requests. Customer history uses exact identity. Request Detail caps invocation
and artifact lists at 500 and reports explicit truncation.

## Time and pagination

Time presets are `TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, and
`CUSTOM`, resolved as half-open local-calendar windows and stored as UTC bounds.
Asia/Shanghai day-boundary acceptance passed in a Windows runtime without IANA
tzdata. Other installed IANA zones and explicit `UTC±HH:MM` offsets remain
supported; UTC+8 is not a global assumption.

Controlled offset pagination uses default 50, maximum 500, one-row lookahead,
`has_more`, `next_offset`, and deterministic tie-breakers. It fits the current
small local SQLite deployment and arbitrary combined filters. A future
internet-scale service may add snapshot cursors if concurrent inserts make
offset drift material.

## Query and storage impact

Filters, aggregation, sort, and limit execute in SQLite. Typical projection code
does not load full tables into application memory. Five new indexes were added:

- request actor/time;
- request capability/time;
- request time;
- invocation provider/model/time;
- invocation time.

Schema reopen detects columns with `PRAGMA table_info` and runs only missing
`ALTER TABLE ADD COLUMN`; repeat open is a no-op. Old rows retain null where a
diagnostic was never persisted. Existing request/invocation/outbox identities and
cost data are unchanged.

The six-request/four-invocation synthetic fixture SQLite file was 110,592 bytes.
Runtime growth remains linear in existing ledger rows/index entries and contains
no duplicated raw input/result body. No Production database or Production row
was created.

## Acceptance and verification

All 15 required cases passed:

1. mixed OWNER/CUSTOMER overview;
2. Asia/Shanghai TODAY/YESTERDAY boundary;
3. customer pagination;
4. exact customer-detail isolation;
5. combined request filters;
6. one Request with multiple safe invocations and result references;
7. provider/model usage;
8. BASIC/PRO/OWNER tier separation;
9. partial cost with known subtotal and unknown count;
10. mixed currencies not added;
11. read-only pending-review queue;
12. request pagination without duplicate/missing rows on unchanged data;
13. fake-secret zero projection occurrences;
14. large input reference returned without content read;
15. limit above 500 rejected.

Additional tests cover recent activity derivation, customer search/tier/activity
filters, migration idempotency, and three machine-evidence assertions.

- Focused OWNER read tests: `21/21 PASS`.
- Full module regression: `624/624 PASS`.
- Offline acceptance evidence: `15/15 PASS`; network attempts `0`.
- Real Provider calls / real API cost: `0 / 0`.
- Production database rows / n8n write / workflow activate / workflow execute:
  `0 / false / false / false`.
- UI / Refine / Langfuse / cross-module write: `not started / false / false / false`.

Machine evidence:
`fixtures/owner_read_projection/owner_read_projection.evidence.json`.

## Unchanged authorities and next boundary

n8n remains the sole workflow engine. Request Ledger remains business authority;
Model Invocation Record remains invocation authority; OWNER manual policy remains
model-selection authority. Review queue metadata authorizes no ACCEPT/REJECT or
knowledge-base write.

The next recommended task is
`NEXA-COMMERCIAL-OWNER-ADMIN-UI-V0.1-001`, consuming only
`OwnerReadQueryService`. Whether it is standalone or embedded in Desktop Shell
remains a project-control/UI architecture decision. This task stops before UI.

