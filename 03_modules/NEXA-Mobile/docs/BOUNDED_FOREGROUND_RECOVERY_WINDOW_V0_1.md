# Bounded foreground recovery window v0.1

## Frozen architecture

- WorkManager remains the only scheduler.
- `BackgroundSyncWorker` promotes its existing attempt with `setForeground` only when a
  persisted trusted target is offline and an Android network is available.
- One persisted owner guards both periodic and immediate work. A different owner retries
  instead of starting a parallel transport attempt.
- The fixed window is 180 seconds. Success, retryable failure, terminal failure, expiry,
  cancellation, pairing loss, or network loss ends the worker and therefore the WorkManager
  foreground execution.
- The same Worker holds a partial wake lock for at most 185 seconds. The five-second grace lets the
  180-second coroutine deadline complete first, while Android's timed acquire still guarantees
  release if an OEM freezes the process. It is not a scheduler and cannot outlive the window.
- No custom service, permanent foreground service, second scheduler, second transport, or
  second pairing/credential store exists.

## Android contract

Target SDK is 36 and WorkManager is 2.11.2. Android's official data-transfer guidance classifies
local-device transfer over a local network under the `connectedDevice` foreground-service type.
The app therefore merges that type onto WorkManager's existing `SystemForegroundService` and
declares `FOREGROUND_SERVICE_CONNECTED_DEVICE`. `CHANGE_NETWORK_STATE` is the manifest prerequisite
used by the existing Android Network selection/binding behavior.

Primary references:

- https://developer.android.com/develop/background-work/background-tasks/data-transfer-options
- https://developer.android.com/develop/background-work/services/fgs/service-types
- https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start

## User-visible notification

Channel: `nexa_connectivity_recovery_v0_1` (`NEXA 连接恢复`)

- Title: `星枢正在恢复电脑连接`
- Body: `正在通过校园网络重新连接你的NEXA电脑`

The notification contains no endpoint, device ID, certificate fingerprint, credential,
authorization value, stack trace, or internal reason code.

On Android 13 and newer, the launcher requests the standard `POST_NOTIFICATIONS` runtime
permission so the bounded recovery is actually user-visible. Denial does not change pairing or
network settings, but OEM background policy may be more restrictive when the notification is not
visible.

## Safe diagnostics

Diagnostics persist request/start/deadline timestamps, lifecycle, stop reason, result, and whether
pre-start OEM freezing was observable. Android app code cannot safely inspect Vivo's private freeze
state, so that field is explicitly stored as `UNOBSERVABLE_FROM_APP_PROCESS` rather than guessed.
