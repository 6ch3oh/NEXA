# NEXA-CORE-MOBILE-STATUS-V0_1-RECEIVER-001

## Status

PASS

## Result

Core now accepts the frozen 06 Capture Desktop status projection at `PUT /nexa/mobile/sync/status`. The route runs in the existing Hub, uses the existing `mobileDeviceCredentialAuthority`, and persists one latest accepted snapshot per device under `latest_status_by_device` in the existing atomic `mobile-sync.json` authority.

The implementation keeps Mobile Business Sync unchanged at `POST /nexa/mobile/sync`. Status snapshots do not create business events, batches, or business acknowledgements, and the retired `/api/mobile-sync/v1/batches` route remains unavailable.

## Frozen contract

- Contract: `nexa.mobile.capture.desktop-handoff.v0.1`
- Content-Type: `application/json; charset=utf-8`
- Ordering scope: per `device_id`
- Ordering field: `captured_at_epoch_ms`
- Fingerprint: deterministic canonical request JSON encoded as UTF-8, then SHA-256 lowercase hex
- 06 golden fingerprint: `1d3edd3d55799a3958d88e641ba8422ab3aa9832a7858fbdf11eacfed4fe35b5`
- ACK statuses: `APPLIED`, `DUPLICATE`, `STALE_IGNORED`, `TIMESTAMP_CONFLICT`

Only APPLIED snapshots persist. Duplicate, stale, and timestamp-conflicting requests perform no logical application and no disk write. Persistence failure returns a bounded `503 persistence_failure` response and does not advance the in-memory latest authority.

## Security boundary

- The authenticated device must exactly equal `identity.device_id`.
- Missing and invalid credentials fail closed.
- The Hub secret cannot impersonate a Mobile device credential.
- Unknown request fields and alternate wire shapes fail closed.
- Raw credentials and Authorization headers are neither logged nor persisted.
- Status persistence contains only the frozen safe projection, `captured_at_epoch_ms`, and the snapshot fingerprint.
- Notification/business payloads, event/queue IDs, endpoint configuration, certificates, Android repository objects, and scheduler commands are not persisted.
- A received snapshot is not treated as online, reachable, paired, or healthy authority.

## Verification

- Focused Status, credential, Business Receiver, store, and Hub tests: 58/58 PASS
- Core lint: PASS
- Full Core regression: 2636 total / 2634 PASS / 0 FAIL / 2 SKIP

The first sandboxed full-test run reported four existing expense-test `EPERM` failures while creating the repository-local `tmp` directory. The same unmodified test command passed outside that filesystem sandbox; no permission or test changes were made.

## Scope audit

- 06 Mobile module writes: 0
- 11 Device Center writes: 0
- Other business module writes: 0
- Second Hub/server: 0
- Second Mobile protocol authority: 0
- Second device credential authority: 0
- Second Mobile database: 0
- OpenCode processes: 0
- DeepSeek turns: 0
- Provider calls: 0
- Unauthorized writes: 0

The 06 Status Sender runtime remains unwired, so Desktop transport is not yet available.
