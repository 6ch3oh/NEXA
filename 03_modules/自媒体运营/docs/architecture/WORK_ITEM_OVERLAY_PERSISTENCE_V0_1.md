# WorkItem Overlay Persistence V0.1

## Persisted operator state

Only these fields are stored:

- work_item_id
- content_id
- status
- due_at
- blocked_reason
- operator_notes
- updated_at
- overlay version

The table contains no work type, priority, next action, blocker collection,
account collection, Domain state or complete WorkItem snapshot.

## Recovery

After restart:

1. repositories hydrate Domain entities;
2. Work Queue derives a fresh WorkItem from Domain truth;
3. overlay rows convert to `OperatorWorkState`;
4. matching status/due/block reason fields are applied;
5. priority and next action remain freshly derived.

Operator notes remain available through the overlay repository. They are not
promoted into ContentItem or used to determine lifecycle state.

There is deliberately no authoritative `work_queue` database table.
