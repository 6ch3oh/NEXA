# Creator Ops Phase 1 Architecture Baseline V0.1

## Boundary

Phase 1 is an offline record-and-presentation layer:

`IDEA → DRAFT → ASSET_PREPARATION → REVIEW → READY_TO_PUBLISH → PUBLISHED → METRICS_PENDING → REVIEWED`

`BLOCKED`, `ARCHIVED`, and `REJECTED` are explicit exceptional states. A
transition function rejects any edge not declared by the state machine.
Publishing remains a human action; the code only records manual confirmation.

## Domain contracts

`Creator`, `Account`, `ContentItem`, `Asset`, `PublishRecord`, `Metrics`, and
`Review` are frozen, versioned dataclasses. Each carries identity, status or
type, timestamps, source, provenance, optional legacy reference, extension
fields, and contract version. Content text, assets, and publication records are
separate objects joined by IDs.

Unknown metrics remain `None`; a measured zero remains `0`. Provenance may be
incomplete and is surfaced as a warning rather than silently invented.

## Compatibility layer

`LegacyCompatibilityMapper` accepts detached mappings supplied by a future
reader/adapter. The core domain never imports a Notion schema, old JSON schema,
or directory layout. The mapper covers:

- Account
- Content
- Content Package
- Manifest envelope
- Publish Record
- Metrics
- Review / Case
- Prompt Asset

Unknown legacy keys remain in extension fields where applicable. Original
content-state labels remain in `extension_fields["legacy_state"]`; canonical
state is derived through a mapping and the source data is never rewritten.

## Fixture and presentation

The fixture is synthetic and includes all A/B account codes, representative
pipeline states, linked media, manually confirmed publication, nullable metrics,
a completed review, a legacy adapter case, and incomplete provenance.

`build_overview` is a pure function that returns an immutable presentation
snapshot containing account, pipeline, publication, metrics, review, activity,
asset-readiness, recent-content, and warning summaries. It performs no I/O.

## Explicit non-capabilities

- platform login or session handling
- cookie, token, or password handling
- automatic publishing or social engagement
- network metrics collection
- browser automation
- AI-provider calls
- mutation or migration of external historical assets
