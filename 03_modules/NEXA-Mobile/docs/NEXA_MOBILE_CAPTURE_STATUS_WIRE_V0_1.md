# NEXA Mobile Capture Status Wire V0.1

This document freezes the Mobile-owned status semantics for the existing NEXA Mobile LAN protocol
family. It does not define a second transport, credential, trust model, or device identity.

## Request

- Method/path: `PUT /nexa/mobile/sync/status`
- Content-Type: `application/json; charset=utf-8`
- Contract version: `nexa.mobile.capture.desktop-handoff.v0.1`
- Canonical representation: the deterministic snake_case JSON emitted by
  `CaptureDesktopStatusWireJsonCodec.encodeRequest`.

The immutable request is ordered independently per `identity.device_id` using
`captured_at_epoch_ms`. That timestamp is Android snapshot time; it is not server receive time,
heartbeat authority, or proof that either device is online.

## Fingerprint and ordering

`snapshot_fingerprint` is the lowercase SHA-256 digest of the UTF-8 canonical request JSON. It is
internal ordering/idempotency evidence and is not an additional request identity or request field.
It cannot contain credentials, authorization headers, certificate material, or transport secrets
because those are not part of the status request model.

For the same `device_id`:

| Incoming snapshot | Result | Apply/store |
| --- | --- | --- |
| No stored snapshot | `APPLIED` | Yes |
| Newer timestamp | `APPLIED` | Yes, replace latest |
| Older timestamp | `STALE_IGNORED` | No |
| Equal timestamp and equal fingerprint | `DUPLICATE` | No |
| Equal timestamp and different fingerprint | `TIMESTAMP_CONFLICT` | No; fail closed |

Different devices have independent latest-snapshot authorities. Core only needs the safe snapshot,
capture timestamp, and fingerprint for each authenticated device.

## Response

Every recognized result uses a single status ACK object with exactly:

- `contract_version`
- `device_id`
- `captured_at_epoch_ms`
- `status`
- `reason` (explicit JSON null when absent)

`APPLIED`, `DUPLICATE`, and `STALE_IGNORED` return HTTP 200 and are terminal sender success.
`TIMESTAMP_CONFLICT` returns HTTP 409 and is a terminal semantic failure. It must not be retried
automatically. Malformed, unknown, request-mismatched, or HTTP-mismatched ACKs fail closed.

Transient transport failures may use the existing bounded retry authority. Authentication or
configuration failures enter the existing configuration/diagnostic flow and must not fast-loop.
This contract does not create a Status-specific retry engine.

## Android sender runtime

`BackgroundSyncWorker` is the single trigger for both the existing periodic lifecycle and the
existing queue-available lifecycle. A normal worker round runs Business Sync once, then obtains a
fresh immutable snapshot through `CaptureDesktopHandoff.readStatus()` and sends it through the same
`LanHttpSyncTransport` instance type and `LanSyncTransportFactory` security composition.

Status temporary failures use WorkManager's existing exponential backoff and the existing
`SyncOrchestrationPolicy.MAX_AUTOMATIC_ATTEMPTS` bound. A WorkManager retry round is Status-only and
does not run Business Sync again, preventing Business retry multiplication. Configuration, trust,
credential, malformed ACK, protocol mismatch, and timestamp-conflict results are terminal and do
not request automatic retry.

The sender reuses the configured PC host/port, per-device Bearer credential, stable device identity,
and certificate pin. It creates no polling cadence, scheduler, queue, database, credential store, or
online/heartbeat assertion.

## Boundaries

The ACK is a Mobile LAN Status Transport contract and is not part of
`CaptureDesktopStatusV0_1` or `CaptureDesktopHandoff.readStatus()`. It never carries business event
ACK arrays, notification content, business payload, queue/event IDs, credentials, authorization,
certificate material, endpoint internals, scheduler commands, or repository capabilities.
