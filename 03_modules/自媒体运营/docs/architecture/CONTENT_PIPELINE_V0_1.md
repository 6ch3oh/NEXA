# Content Pipeline V0.1

## State authority

The service reuses the NEXA-CREATOR-001 state machine as the only state-change
authority. Every pipeline operation that changes `current_state` calls
`transition`; invalid edges propagate `InvalidTransition`.

Supported flow:

`IDEA → DRAFT → ASSET_PREPARATION → REVIEW → READY_TO_PUBLISH → PUBLISHED → METRICS_PENDING → REVIEWED`

Blocking, rejection, and archiving also use the declared state-machine edges.

## Ready-to-publish gate

The gate checks only information already represented by the V0.1 contracts:

- current state is `REVIEW` and not blocked;
- body or script reference exists;
- review is approved;
- every target account exists and is active;
- every declared asset reference resolves to `AVAILABLE` or `REFERENCE_ONLY`;
- content provenance is complete.

It returns explicit failure codes and does not mutate content. Successful gate
evaluation is required before the state machine can enter `READY_TO_PUBLISH`.

## Manual publication boundary

`record_manual_publish` records a user's already-completed platform action. It
requires `manual_confirmation=True`, an active target account, and a
`READY_TO_PUBLISH` item. It creates only a `PublicationMode.MANUAL` record and
moves the domain item to `PUBLISHED` through the state machine.

There is no platform API client, browser control, credential/session storage,
automatic publish action, or engagement action.

## Metrics and review loop

Metrics input is restricted to `MANUAL`, `FIXTURE`, or `FUTURE_ADAPTER` modes.
Optional numeric values pass through unchanged, preserving `None != 0`.
Recording metrics advances `PUBLISHED → METRICS_PENDING`; completing a review
requires matching Content, PublishRecord, and Metrics identities and advances
to `REVIEWED`. The Review stores a metric snapshot and asset ID references.

## Content Package and Overview

`ContentPackageV01` is an immutable aggregation/transport view over an existing
ContentItem, Accounts, Assets, readiness fields, and provenance. It does not
duplicate or replace the core domain.

The Overview adds derived properties for ideas, drafts, asset preparation,
under review, ready, published, metrics/review pending, blocked, recent activity,
and warnings. It remains a read-only projection with no business-state writes.
