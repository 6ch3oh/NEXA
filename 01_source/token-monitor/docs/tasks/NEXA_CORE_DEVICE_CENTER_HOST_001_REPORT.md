# NEXA Core Device Center Host 001

TASK: `NEXA-CORE-DEVICE-CENTER-HOST-001`  
PROJECT_ID: `NEXA-CORE`  
STATUS: `PASS`

## Reconciliation

- Core: `<PROJECT_ROOT>\01_source\token-monitor`
- Device Center, read only: `<PROJECT_ROOT>\03_modules\设备与网络`
- Branch: `main`
- Start HEAD: `eec5cde769fc66852b198d741bebc96a136cd58e`
- Final HEAD: `eec5cde769fc66852b198d741bebc96a136cd58e`
- `527b7d1` established the Device Center consumer seam.
- `eec5cde` is the existing `feat(nexa): host Device Center` implementation commit.
- The pre-existing dirty worktree was preserved. No Node writer, Git lock, staged change, or overlapping worktree was present at the continuation gate.

## Authoritative boundary

- Entrypoint: `<PROJECT_ROOT>\03_modules\设备与网络\src\public-api.mjs`
- Public API version: `0.1`
- Factory: `createDeviceCenterApplication`
- Core validates the version and factory before creation and fails soft to an unavailable application.
- Core does not deep-import a Collector, Provider, Runtime, History, Store, Anomaly, Outbox, adapter, or Device Center ViewModel implementation.

## Host composition

- Core owns one Device Center application for the lifetime of the NEXA Shell Host.
- The stable data root is derived from Electron `userData` under `nexa/device-center`; it is not a source, install, temporary, or disk-root path.
- Reads demand-start the resident application once. Concurrent reads share the same lifecycle.
- Renderer reload reuses the Main-owned application.
- Shell Host shutdown awaits the Device Center stop path; the verified result is zero timer leaks and zero orphan child processes.
- Main-to-renderer traffic uses the existing `window.tokenMonitor.nexa['device-center']` namespace and static guarded IPC channels.
- Results are cloned and recursively filtered; raw errors, secret-bearing keys, local absolute paths, provider objects, functions, stores, and application objects do not cross IPC.

## Product acceptance

| Contract | Result |
|---|---|
| Device Center route and seven bounded subviews | `READY` |
| Existing Home/status-slot placement contract | `READY` |
| Overview and runtime status | `READY` |
| History and curve DTOs (`1h`, `24h`, `7d`, `30d`) | `READY` |
| CPU Top5 / RAM Top5 | `READY` |
| Network Top5 | `UNAVAILABLE_CORRECTLY` |
| GPU / GPU temperature | `READY` |
| CPU temperature | `UNAVAILABLE_CORRECTLY` |
| Public IP / approximate Geo / ISP / ASN | `READY` |
| APEX runtime | `READY` |
| APEX route model | `UNKNOWN_CORRECTLY` |
| Domestic/foreign dual-path proof | `DEFERRED_CORRECTLY` |
| DeviceHealth | `READY` |
| Active and resolved anomalies | `READY` |
| Alert Outbox reads and delivered/dismissed acknowledgements | `READY` |
| Windows Notification Host | `EXPLICIT_DEFERRED` |
| Fresh/stale/unavailable semantics | `PASS` |
| Renderer safe DTO | `PASS` |

The renderer does not execute PowerShell, GPU helpers, network collectors, process enumeration, route probes, Geo providers, or other system operations. It does not convert unavailable values into zero, stale values into fresh values, or unknown/deferred facts into proven facts.

## Verification

Focused Device Center, composition, preload, renderer, UI host, and Extension Guard run:

```text
tests 137
pass 137
fail 0
```

Real Windows Core + Device Center host-contract smoke:

```text
NEXA_DEVICE_CENTER_CORE_SMOKE=PASS
PUBLIC_API_VERSION=0.1
READ_ENDPOINTS=10
STATIC_IPC=PASS
SINGLE_RUNTIME=PASS
CLEAN_STOP=PASS
TIMER_LEAKS=0
ORPHAN_CHILD_PROCESSES=0
NETWORK_BUSINESS_CALLS=0
ADMIN_REQUIRED=NO
```

Current full Core verification, run outside the filesystem sandbox so the suite could create and clean its own temporary fixtures:

```text
npm run verify
lint PASS
tests 2607
pass 2605
fail 0
skipped 2
exit 0
```

## Write accounting for this continuation

- Device Center module writes: `0`
- Other NEXA module writes: `0`
- ExecutionHub writes: `0`
- New network probes: `0`
- Administrator or driver use: `NO`
- Secret reads: `0`
- Git push: `NO`
- Device Center Core source changes in this continuation: `0`
- Created: `docs/tasks/NEXA_CORE_DEVICE_CENTER_HOST_001_REPORT.md`
- Modified: `tests/electron/nexaStarBenchRenderer.test.js` (one behavior-preserving regex-literal lint correction required for the current full regression)

## Final

```text
DEVICE_CENTER_CONTRACT_GAP=NONE
DEVICE_CENTER_CORE_HOST_READY=YES
```

The remaining Windows notification delivery host is explicitly deferred; pending Outbox records and bounded acknowledgement actions remain available without introducing a second notification policy.

Next recommendation: rerun `NEXA-CORE-DEVICE-CENTER-CSP-RUNTIME-RETEST-001` in an Electron environment that can start a renderer/GPU process and expose the authorized observation channel.
