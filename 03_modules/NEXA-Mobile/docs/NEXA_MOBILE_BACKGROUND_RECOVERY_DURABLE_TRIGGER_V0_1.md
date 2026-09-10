# NEXA Mobile background recovery durable trigger v0.1

Task: `NEXA-MOBILE-BACKGROUND-RECOVERY-DURABLE-TRIGGER-V0_1-001`

## Root cause

The earlier reconnect change only coalesced repeated discovery work. It did not make the recovery
execution durable:

- network callbacks were registered by the application process and could not by themselves survive
  process death;
- the scheduler persisted only a target fingerprint, not the desired recovery generation and safe
  target summary;
- a worker did not consume desired generation state;
- WorkManager retries skipped the Business Sync recovery stage because it was guarded by
  `runAttemptCount == 0`;
- reconnect diagnostics existed only in Logcat, so a process restart erased the evidence needed to
  distinguish scheduling, TCP, TLS, authentication, Status and Business stages;
- the existing periodic specification was retained verbatim by `KEEP`, so an already-installed old
  periodic request could not acquire new safe input metadata.

## Background owners

- `NexaMobileApplication`: initializes the existing recovery coordinator and discovery/control
  runtimes whenever Android creates the process.
- `NexaNotificationListenerService`: existing system-managed notification capture component; reused
  only to attach the existing recovery coordinator and request recovery on listener lifecycle events.
- WorkManager: the only durable scheduler. No second scheduler or foreground service was added.
- `ConnectivityManager.NetworkCallback`: process-local signal source. Each callback first updates
  durable desired state and then requests the existing unique WorkManager job.

## WorkManager audit

| Logical path | Unique name / type | Constraint | Policy | Input | Backoff | Trigger owner |
| --- | --- | --- | --- | --- | --- | --- |
| Immediate / reconnect / discovery / configuration / queue | `nexa.mobile.sync.immediate.v1`, one-time | connected | `KEEP` | `nexa_work_kind=IMMEDIATE` | exponential, existing orchestration base | application, listener, queue, discovery and network callbacks |
| Periodic recovery | `nexa.mobile.sync.periodic.v1`, 15-minute periodic | connected | `UPDATE` in place | `nexa_work_kind=PERIODIC` | exponential, existing orchestration base | application and every scheduler safety check |

All immediate logical paths converge on the same unique work. A real endpoint/network/route change
updates persistent desired generation but does not cancel an ENQUEUED or RUNNING worker. Periodic
`UPDATE` preserves the unique periodic job while migrating an installed old request to the new input
contract.

## Durable desired state

SharedPreferences `nexa.mobile.recovery.desired.v0_1` contains only:

- generation;
- SHA-256 target fingerprint;
- endpoint `host:port` summary;
- bounded network and route summaries;
- last safe trigger code and timestamp.

It contains no credential, Authorization header, private key or application payload. Official
credential, certificate trust, endpoint candidates and pairing identity remain in their existing
stores.

At every start, `BackgroundSyncWorker` reads current official configuration, identity, network and
route state through `AndroidRecoveryTargetReader`. It then constructs the existing Auto transport,
which reads the existing credential store, certificate pin, trusted endpoint candidates and route
policy. It does not require an Activity, ViewModel or discovery memory map.

## Recovery execution

Every immediate, periodic and retry attempt performs:

1. self-bootstrap from persisted official stores;
2. current candidate and route selection through the existing Auto transport;
3. bounded Business Sync through the existing `SyncCoordinator`;
4. Status Sync;
5. generation convergence check.

If desired generation advances while a worker is running, the same WorkManager execution requests a
retry instead of relying on callback replacement.

## Safe persistent diagnostics

SharedPreferences `nexa.mobile.recovery.diagnostics.v0_1` records the requested safe fields:
trigger, generation, enqueue policy/time, work start/finish/result, candidate summary, TCP, TLS,
authentication, Status, Business, cancellation, and periodic start/finish timestamps. The existing
“同步状态与诊断” screen exposes these local details. No wire contract or Desktop Core change is
required.

## Automated acceptance mapping

- Periodic independent recovery and full stage order: focused durable recovery execution tests.
- Process restart / no Activity / no memory candidate: recreated scheduling model over the same
  persistent-store fixture plus source contract for worker self-bootstrap.
- Wi-Fi unavailable to available: desired network generation test and no-debounce source contract.
- Repeated discovery and running work: 100-trigger pressure test; identical replacement count zero.
- Endpoint/network/route/security change: generation advances with WorkManager `KEEP`.
- Delayed worker: generation convergence policy test.
- Periodic preserved: source contract requires same unique periodic name and in-place `UPDATE`.
- VPN: network summary and existing Auto route policy are reread at worker start.
- TLS and credential failures: existing transport/status policies remain unchanged and now persist
  their safe stage result.
- Business bounded: existing `SyncCoordinator` and `MAX_BATCH_SIZE` remain the only Business sender.
- Diagnostics restart: persisted snapshot fixture is readable after recorder recreation.

## Security and product constraints

- No foreground service.
- No second scheduler, transport, endpoint store or credential store.
- No pairing, TLS, Status or Business wire contract changes.
- No Core modification.
- Installation remains `adb install -r` so device identity, pairing, credential, pin, endpoint and
  queue are preserved.
