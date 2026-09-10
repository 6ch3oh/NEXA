# Creator Ops Work Queue V0.1

## Boundary

WorkItem represents human work around a ContentItem. It is not a replacement
for ContentItem and owns no parallel content lifecycle. Current content state,
relations, assets, publication, metrics, and review remain domain truth.

The queue derives one operational item per content snapshot with:

- work type, content/account identity, blockers, next action and provenance;
- explainable priority and priority reason;
- OPEN / IN_PROGRESS / BLOCKED / DONE / CANCELLED execution status;
- explicit field ownership metadata.

Work type, priority, accounts, next action and provenance are `DERIVED`.
Only `status`, `due_at`, and `blocked_reason` accept an `OPERATOR_STATE`
overlay. Applying an overlay never writes `ContentItem.current_state`.

## Deterministic mapping

The queue interprets the existing state machine:

| Content evidence | Derived work |
|---|---|
| IDEA | DRAFT / WRITE_DRAFT |
| DRAFT | ASSET / PREPARE_ASSETS |
| ASSET_PREPARATION | ASSET / PREPARE_ASSETS |
| REVIEW | REVIEW / REVIEW_CONTENT |
| REJECTED | DRAFT / REVISE_DRAFT |
| READY_TO_PUBLISH | MANUAL_PUBLISH |
| published without Metrics | METRICS_BACKFILL |
| Metrics without Review | POST_PUBLISH_REVIEW |
| REVIEWED | DONE |
| ARCHIVED | CANCELLED |

There is no AI resolver. `NextActionResolver` is a total, deterministic mapping
over content state plus Metrics/Review presence and blockers.

## Blockers and priority

The common blocker contract carries code, message, source, and blocking flag.
It covers missing content/assets, review requirements/rejection, invalid or
inactive accounts, incomplete provenance/package, manual confirmation, missing
metrics and unknown blockers.

Priority has four levels and always includes a reason:

1. BLOCKED or overdue → URGENT;
2. manual publish, metrics backfill or review → HIGH;
3. other active pipeline work → NORMAL;
4. initial/terminal work → LOW.

No platform-performance recommendation or opaque score is used.

## Read-only aggregates

`OperatorDashboard` aggregates queue, actions, publish workbenches, blocked
items, metric backfill, review pending, recent publication, account workload,
activity and warnings. Account workload covers A1/A2/B1/B2/B3/B4 from the
synthetic fixture and is explicitly labeled `TEST / SYNTHETIC`.

Activity events are a display projection over existing timestamps and records,
not an Event Sourcing store.
