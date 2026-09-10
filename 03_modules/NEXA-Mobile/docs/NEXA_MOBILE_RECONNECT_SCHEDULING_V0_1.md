# NEXA Mobile reconnect scheduling v0.1

Contract: `NEXA_MOBILE_RECONNECT_SCHEDULING_V0_1`

## Unique work audit

| Trigger | Unique work | Policy |
| --- | --- | --- |
| Queue available / sync now | `nexa.mobile.sync.immediate.v1` | `KEEP` |
| First reconnect target | `nexa.mobile.sync.immediate.v1` | `KEEP` enqueue |
| Equivalent discovery/network/control event | `nexa.mobile.sync.immediate.v1` | `KEEP` |
| Endpoint/network/route/device/trust target change | `nexa.mobile.sync.immediate.v1` | `REPLACE` |
| Pairing/configuration change | `nexa.mobile.sync.immediate.v1` | `REPLACE` |
| Periodic safety sync | `nexa.mobile.sync.periodic.v1` | `KEEP`, 15 minutes |

No path uses `APPEND` or `UPDATE`. The periodic unique work name is separate and is
never cancelled or replaced by immediate recovery.

## Merge identity

Equivalent reconnect work is identified by a persisted SHA-256 fingerprint over
the installation device identity, candidate endpoint, relevant Wi-Fi/VPN/default
network snapshot, route policy, and existing certificate-trust fingerprint. Raw
credentials, authorization headers, private keys, and pairing secrets are not read,
stored, or logged by the scheduling model.

The persisted fingerprint survives process restart. Re-submitting the same target
uses WorkManager `KEEP`, so an `ENQUEUED` or `RUNNING` worker is not cancelled. A
completed worker can still be enqueued again under WorkManager's existing unique
work semantics. Only a materially different target uses `REPLACE`.

## Lifecycle

Initialization remains owned by `NexaMobileApplication`; it does not depend on an
Activity, scanner, USB, ADB, or diagnostics screen. The existing WorkManager,
ConnectivityManager callbacks, sync runtime, TLS pin, credential authority, wire
contracts, and bounded queue model are reused. No foreground service or second
scheduler is introduced.
