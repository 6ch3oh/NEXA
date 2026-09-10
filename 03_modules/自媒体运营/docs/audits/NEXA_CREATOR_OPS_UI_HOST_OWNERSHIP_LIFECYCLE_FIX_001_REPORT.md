# NEXA Creator Ops UI Host Ownership Lifecycle Fix 001

## Result

- `CREATOR_OPS_UI_HOST_OWNERSHIP_V0_1 = READY`
- `SINGLE_ACTIVE_OWNER = YES`
- `READINESS_VALIDATES_OWNER = YES`
- `CONTROL_TOKEN_OWNER_MATCH = PASS`
- `STALE_HOST_ACCUMULATION = 0`
- `RESTART_ACCUMULATION = 0`
- `WORKS_REAL_READ = PASS`
- `FORBIDDEN_OWNER_MISMATCH = 0`
- `LOCAL_HOST_ONLY = PASS`
- `CORE_WRITES = 0`

## Starting baseline and runtime evidence

- Mandatory Creator Ops baseline before edits: `243 tests`, `PASS`, `70.683s`.
- Initial OS audit: `12` distinct listeners on `127.0.0.1:8765`.
- All 12 listener processes had the exact command `python -m creator_ops.ui.host --host 127.0.0.1 --port 8765`.
- Their original lifecycle parent processes no longer existed. They were therefore proven Creator Ops orphan hosts, not unknown Python processes.
- Safely cleaned: `12`; unknown processes killed: `0`; unknown hosts left: `0`.
- Real default-entry runtime: start `1`, stop `0`, restart `1`, final clean stop `0`.
- Real Works query used the active facade token/owner handshake and returned an honest empty result (`items = 0`) without `FORBIDDEN`.

## Root cause

1. NEXA main-process composition loads `src/index.mjs` and calls `createCreatorOpsUIHost()`; the returned Node facade spawns the Python Host.
2. The pre-fix Python server enabled `allow_reuse_address = True`. On Windows this allowed multiple processes to bind the same address/port concurrently.
3. Old Python Hosts had no liveness relationship with the Node owner, so an abnormal owner exit could leave the Host running.
4. Every new facade generated a different control token but polled only unauthenticated `/api/v1/host-status` at fixed port 8765.
5. A response from any old listener was treated as readiness for the new child. Subsequent Works calls carried the new token and could be routed to another listener, producing `FORBIDDEN`.
6. Normal Core shutdown already invokes module stop. Renderer reload does not own or spawn the Host. Module stop and Desktop normal quit are cleaned by the Core controller/facade; abnormal NEXA owner exit is now cleaned by the Python owner-process monitor; Python process exit is reflected by the facade as `ERROR`, and the next start creates a new owner/token/generation.

## Ownership model

One facade lifecycle now creates exactly one tuple:

`ownerId + ownerGeneration + controlToken + ownerProcessId + endpoint + spawned child`

The facade passes the tuple to the original Python Host through its private process environment. The authenticated `GET /api/v1/host-ownership` handshake returns owner identity, owner generation, Host PID, runtime generation, readiness, and endpoint without returning the control token.

The facade declares `READY` only when:

- its spawned child is still alive;
- the authenticated control token is accepted;
- owner ID and generation match the current lifecycle;
- the returned endpoint is exactly the configured loopback endpoint;
- the Python Host reports `READY`.

An occupied endpoint owned by another instance is `OWNER_MISMATCH`, never `READY`. Shutdown first repeats the owner handshake and then sends the owner-bound shutdown request. Works requests carry the same owner/token/generation tuple.

## Port and cleanup strategy

The existing public contract declares default port 8765, and the current Core normal path calls the factory without a port override. Changing the default to dynamic would either break that contract or require a Core change. The selected minimal strategy is therefore:

- keep `127.0.0.1:8765` as the compatible default;
- retain explicit custom-port support;
- use `SO_EXCLUSIVEADDRUSE` on Windows;
- reject an existing different owner instead of accepting its status;
- monitor the NEXA owner process so abnormal owner death shuts down its Python Host;
- never enumerate or force-kill unknown Python from production code.

## Verification

- Ownership-focused tests: `4/4 PASS`.
- Creator UI/ownership/Core-handoff/Works focused tests: `30/30 PASS`.
- Read-only Core bridge suite: `9/9 PASS`, including real NEXA controller/Shell Host lifecycle and real Core-to-Creator Works handoff.
- Crash recovery: owner process killed; port released; next owner started; Works read passed; clean stop passed.
- Restart sequence: `start → stop → start → stop → start`; generations `1 → 2 → 3`; active instance count never exceeded `1`.
- Port conflict: candidate returned `OWNER_MISMATCH`; the existing listener remained alive and was not killed.

## Boundaries

- No Creator business data migration or cleanup.
- No Core source modification.
- No other module modification.
- No public API removal or incompatible shape change; ownership metadata is additive.
- No external network, login, publishing, AI workflow, or second UI Host.
