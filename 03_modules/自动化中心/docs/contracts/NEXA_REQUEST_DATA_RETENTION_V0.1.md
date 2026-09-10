# NEXA Request Data Retention v0.1

Status: `FROZEN_METADATA_CONTRACT / NO PHYSICAL DELETION`

## Purpose

Retention metadata makes the intended lifecycle of each request data class
explicit without pretending that v0.1 has a deletion worker or authority over
referenced external artifacts.

Every request carries exactly one policy record for each class:

| Data class | v0.1 storage boundary |
| --- | --- |
| `REQUEST_METADATA` | Bounded Request Ledger identity, state, summaries, and references. |
| `RAW_INPUT` | Lifecycle metadata for the input class; raw body is not copied into the ledger. |
| `RESULT` | Lifecycle metadata for result summary/reference; result body is not copied. |
| `ARTIFACT` | Lifecycle metadata for logical artifact references only. |
| `TRACE` | Lifecycle metadata for an optional trace reference only. |

## State contract

Each policy has `created_at`, optional `retain_until`, `deletion_state`, and
optional `deleted_at`.

- `RETAIN -> DELETE_SCHEDULED`
- `DELETE_SCHEDULED -> RETAIN` (schedule cancelled)
- `DELETE_SCHEDULED -> DELETED`
- `DELETED` is terminal and requires `deleted_at`

`DELETED` in v0.1 is a metadata observation supplied by an authorized future
deletion mechanism. The ledger itself performs no file, artifact, trace, result,
or SQLite-row deletion. Updating retention metadata leaves the request record
present and queryable.

## Boundaries

Retention status does not grant access to raw content and does not override the
OWNER/CUSTOMER or Knowledge Review boundary. Actual deletion schedules,
jurisdictional policy, legal hold, external artifact ownership, backup behavior,
and physical deletion require later architecture and policy decisions.

