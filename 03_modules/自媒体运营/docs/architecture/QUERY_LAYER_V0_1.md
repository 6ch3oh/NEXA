# Creator Ops Query Layer V0.1

`CreatorOpsQueryService` returns hydrated Domain entities and read-only
application views. It supports:

- active content, content by state and detailed aggregate lookup;
- accounts and account workload inputs;
- recent publication and publication by content;
- published records missing Metrics and latest metric snapshot;
- content awaiting post-publish Review;
- Work Queue re-derivation;
- Operator Dashboard re-derivation.

Dashboard recovery follows the complete persisted route:

`SQLite rows → Repository hydration → Domain collections → Work Queue / Dashboard`

Tests seed a temporary SQLite database, close it, reopen it, then build the
Dashboard without directly injecting fixture collections. ViewModels never
execute SQL.

## Persistent application coordination

`PersistentCreatorOpsService` loads Domain objects, invokes the already-tested
002 Pipeline or 003B manual-publish workbench, and persists results inside one
transaction. It does not repeat state transitions or publish rules.

Manual publish atomically updates Content, saves PublishRecord, and persists the
operator overlay marking the prior manual-publish work DONE. Metrics atomically
updates Content and saves a snapshot. Review completion atomically updates
Content and saves Review.

Metrics edits after the first snapshot use repository update semantics and do
not replay the PUBLISHED → METRICS_PENDING transition.
