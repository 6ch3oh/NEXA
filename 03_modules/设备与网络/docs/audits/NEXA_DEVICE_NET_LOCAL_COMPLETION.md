# Device / Network Local Completion Audit

Date: 2026-08-13  
Scope: `<PROJECT_ROOT>\03_modules\设备与网络` only  
Authority: non-admin, read-only Windows collection; no driver, packet capture, WFP, firewall/route/DNS/proxy mutation, or cross-module write

## Result

`PASS` for every remaining capability that can be proven locally under the stated authority.

## Requirement Evidence Matrix

| Requirement | Result | Authoritative evidence |
|---|---|---|
| 264/264 and 010/011 baseline do not regress | PASS | 365/365 full `npm.cmd test` and syntax check; existing tests remain green |
| Application Network Observatory closure | PASS | real Windows process/connection smoke plus deterministic contracts |
| Application byte truth boundary | PASS | strict `ApplicationByteBatch`; default stays `DEFERRED_WITH_EVIDENCE` |
| Network Top5 | CONDITIONAL READY | complete byte batches produce deterministic Top5; real default remains unavailable |
| Top active connections | READY | real PID/socket observation; UI labels it as connections, not bytes |
| Long-term observation | READY | start/stop observer, overlap coalescing, failure recovery, bounded retention |
| Durable history | READY | atomic local JSON store, restart/read-back smoke, 30-day/10,000 defaults |
| History semantic separation | PASS | explicit exclusions: AI-tool usage, device usage history, hardware history |
| Read API V0.1 | READY | latest/list/window/per-application transport-neutral read service |
| UI-ready ViewModel | READY | typed units, cards, rankings, history and honest empty states |
| Privacy | PASS | persisted projection excludes raw endpoints, PIDs, commands, environment, payload |
| Home Footer isolation | PASS | existing regression test; Home Footer source unchanged |
| Legacy Device Snapshot Bridge dependency | FROZEN SUBITEM | only Core-projected whitelist may be consumed; missing Core data is not inferred |
| Admin/high-authority work | NOT PERFORMED | no elevation, driver, ETW session, WFP or packet capture |

## Real Windows Evidence

`npm.cmd run smoke:application-history` performed two independent local snapshot collections, wrote them to a temporary JSON history file, opened a new store instance, read both samples through the Read API, and built the detail ViewModel. Acceptance output:

- `WINDOWS_APPLICATION_NETWORK_PERSISTENCE_SMOKE=PASS`
- `PERSISTED_SAMPLE_COUNT=2`
- `LATEST_APPLICATION_COUNT=114`
- `LATEST_CONNECTION_COUNT=974`
- `APP_BYTE_ACCOUNTING=DEFERRED_WITH_EVIDENCE`
- `NETWORK_TOP5=UNAVAILABLE`
- `TOP_ACTIVE_CONNECTIONS=AVAILABLE`
- `READ_API=PASS`
- `UI_READY_VIEW_MODEL=PASS`
- `AI_TOOL_USAGE_AS_NETWORK_BYTES=NO`
- `DEVICE_USAGE_AS_HARDWARE_HISTORY=NO`
- `ADMIN_REQUIRED=NO`
- `NETWORK_EGRESS=0`
- `SYSTEM_MODIFICATIONS=0`

The temporary smoke directory was removed after verification; no runtime history was installed or left running.

## Byte Accounting Decision

Current built-in sources prove processes, PIDs, sockets/endpoints, and host-wide interface counters. They do not prove complete live per-application TX/RX bytes under the non-admin/read-only/no-driver boundary. Process I/O includes non-network activity; connection counts and endpoint counts have no byte semantics; interface counters have no PID/application attribution. None may promote Network Top5.

The module now accepts a future provider only through a strict batch contract identifying Windows application network counters, provider identity, observation window, full application coverage, and finite non-negative cumulative/rate values. This closes the software integration path without fabricating a live provider.

## Created Files

- `src/applicationNetworkHistory.js`
- `src/applicationNetworkReadService.js`
- `src/applicationNetworkViewModel.js`
- `scripts/windowsApplicationNetworkPersistenceSmoke.js`
- `tests/applicationNetworkProductization.test.js`
- `docs/audits/NEXA_DEVICE_NET_LOCAL_COMPLETION.md`

## Modified Files

- `src/applicationNetworkContracts.js`
- `src/applicationNetworkSnapshot.js`
- `src/index.js`
- `tests/applicationNetworkObservatory.test.js`
- `docs/APPLICATION_NETWORK_OBSERVATORY_V0.1.md`
- `package.json`

## Commands

- `npm.cmd run check`
- `node --test tests/applicationNetworkObservatory.test.js tests/applicationNetworkProductization.test.js`
- `npm.cmd run smoke:application-history`
- `npm.cmd test`
- `npm.cmd run smoke:applications`
- `npm.cmd run smoke:windows`

Final regression: `365 tests / 365 PASS / 0 FAIL`. This consists of the preserved 341-test post-011 baseline plus 24 productization tests. New runtime dependencies: 0.

Core was treated as read-only. At final audit its observed HEAD was `56817cca721b08fffab75f88057179dd57acbdf6`; three pre-existing/unrelated untracked Core files were present. This task did not read their contents, modify them, or clean them.

## Remaining Legal Boundary

No additional local code can truthfully produce real per-application TX/RX bytes or live Network Top5 from the currently approved built-in evidence. Doing so requires an approved stronger data source and may require ETW/native/high-authority work. Legacy fields absent from the Core projection similarly remain frozen. These are explicit dependencies, not incomplete local implementations.
