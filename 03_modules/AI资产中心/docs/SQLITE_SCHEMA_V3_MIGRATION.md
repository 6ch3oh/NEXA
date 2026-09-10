# SQLite Canonical Store Schema V3

V3 is the single Goal A schema upgrade. It adds:

- `pricing_authorities`, referencing persisted PricingSnapshot fingerprints;
- `entitlements`, including typed limits and Authority metadata;
- project/module/task/run attribution columns on `usages`;
- optional `usage_id` on `costs` for evidence-backed cost attribution.

Fresh databases initialize directly at V3. Complete V1 databases migrate
transactionally through V2 and then V3; complete V2 databases migrate directly
to V3. Provider, Token, Balance, Usage, Pricing, Cost, and Budget data are
preserved. V3 recomputes Usage/Cost content fingerprints after adding default or
nullable fields so replay remains idempotent rather than duplicating history.

Reopen is supported. Missing tables, invalid metadata, inconsistent schemas,
and unsupported future versions fail closed. Migration failures roll back both
schema objects and metadata version. Tests cover fresh V3, V1→V3, V2→V3,
reopen, preserved records, replay idempotency, rollback, and future-version
rejection.

Decimal values remain TEXT, timestamps remain timezone-aware ISO-8601, enums
remain stable string values, and event fingerprints remain replay keys rather
than credential fingerprints.
