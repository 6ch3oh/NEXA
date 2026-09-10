# UI Consumption Contract V0.1

This is a future UI contract; no production UI was implemented in task 005.

The UI may render these public reads:

- Operator Dashboard and Work Queue
- Content Detail and content/account lists
- Manual Publishing Workbench
- Metrics Backfill Workbench
- Review Workbench
- Account Workload
- Activity feed
- Runtime information and health

The UI sends commands and renders `CommandResult`. It does not transition
content state, derive readiness, calculate work items/priority, write repository
records, or open SQLite itself. Confirmation controls must pass explicit booleans;
opening a missing database is not consent to initialize, and a manual publish
button records an already-completed human publish only after
`manual_confirmation=True`.

Recommended UI handling:

- `INITIALIZATION_REQUIRED`: show a separate, explicit local-store setup action.
- `CONFIRMATION_REQUIRED`: keep the action pending and request human confirmation.
- `REJECTED`/`VALIDATION_ERROR`: show the sanitized message and retain form input.
- `NOT_FOUND`/`CONFLICT`: refresh the relevant public read before retrying.
- `STORAGE_ERROR`/`UNSUPPORTED_SCHEMA`: stop writes and show recovery/backup help.

The UI must not imply platform login, API access, browser automation, automatic
publishing, network collection, cloud backup, or resolved historical assets.

