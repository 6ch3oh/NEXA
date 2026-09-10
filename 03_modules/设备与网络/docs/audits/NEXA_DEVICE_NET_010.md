# NEXA-DEVICE-NET-010 Audit

## 1. TASK STATUS

PASS — `APPLICATION_NETWORK_OBSERVATORY_FOUNDATION_V0_1` is complete. Byte accounting is deferred with evidence and does not block the Foundation acceptance criteria.

## 2. PRECHECK

Read the current contracts, adapters, index, snapshot, health evaluator, footer view model, Windows collectors, legacy adapter/host binding, fixtures, tests, and audit documents 001–008 before implementation.

## 3. BASELINE

Module baseline: 210/210 PASS. Core baseline: HEAD `6635ed6b8c925178e7d4d323c6214a2c81f1c1c7`, clean status, 10,621 files. The previously referenced root-level manifest path did not exist at this baseline and was not created or changed. At final review the Core HEAD was unchanged, but nine Electron-side working-tree changes had appeared concurrently outside this task; they were not authored, touched, reverted, or claimed by 010.

## 4. EXECUTION MODE

Used plan, one explicit active goal, and sustained local construction. OpenCode calls: 0. DeepSeek calls: 0. ExecutionHub calls: 0.

## 5. PROCESS COLLECTOR

READY. `WindowsProcessCollector` uses one bounded non-interactive PowerShell child for a two-point `Get-Process` sample. Real smoke observed 269 processes.

## 6. PROCESS FIELDS

PID, normalized executable name, optional start time, sampled CPU, working-set bytes, availability, timestamp, and source are represented. Display name is nullable.

## 7. PROCESS PRIVACY

No command line, environment, window text, account, process memory, token, secret, or executable path is requested. Path-shaped process names are rejected.

## 8. CPU SAMPLE

CPU delta uses process time, wall time, and logical processor count. Missing first points produce unavailable CPU rather than zero. Values are finite and bounded.

## 9. CPU TOP5

READY. Real application aggregates are sorted descending, stable-tied, and limited to five. Smoke returned five entries.

## 10. RAM TOP5

READY. Current working-set bytes are aggregated per exact executable identity, sorted descending, and limited to five. Smoke returned five entries.

## 11. CONNECTION COLLECTOR

READY. Default backend is built-in `netstat.exe -ano`, selected after actual non-admin NetTCPIP commands returned access denied. It makes no network request.

## 12. TCP OBSERVATION

TCP protocol, local/remote endpoints, state, address family, PID, and timestamp are parsed. TCP PID mapping passed fixture and real smoke checks.

## 13. UDP OBSERVATION

UDP local endpoint and PID are parsed. Remote endpoint is null because `netstat` does not provide a truthful remote peer for unconnected UDP endpoints. UDP PID mapping passed.

## 14. IPV4 AND IPV6

Both bracketed IPv6 and IPv4 endpoint formats are parsed. Mixed live inventory completed without crash. Private and public classification tests passed.

## 15. PID MAPPING

READY. Connection PID maps only to a contemporaneously observed PID. Unknown/missing PIDs are not guessed or assigned.

## 16. EXITED PROCESS RACE

A PID missing from the first CPU point retains current memory but has unavailable CPU. A connection whose process disappeared is omitted from application attribution.

## 17. APPLICATION GROUPING

READY with V0.1 limitation. Only exact case-folded normalized executable names group. Individual process observations remain distinct. Stronger package/signature/parent evidence is not claimed.

## 18. DETERMINISM

Groups, PIDs, collector rows, and Top5 ties have stable sorting. Reversed fixture input produces identical aggregation.

## 19. BYTE ACCOUNTING CAPABILITY STUDY

`APP_BYTE_ACCOUNTING = DEFERRED_WITH_EVIDENCE`. Evaluated: netstat/NetTCPIP endpoints, adapter/interface counters, process I/O counters, TCP extended statistics, SRUM, ETW, packet capture/WFP/driver approaches. No evaluated built-in source gives complete, stable, live, non-admin, read-only PID TX/RX bytes within the V0.1 constraints.

## 20. REJECTED BYTE SUBSTITUTES

Connection count, socket count, host traffic proportional allocation, CPU, token usage, and process I/O are not treated as network bytes. Default application observations contain no traffic object.

## 21. NEXT BYTE SPIKE

Lowest-risk candidate: an isolated user-mode ETW/TDH feasibility spike with explicit permission, completeness, event-loss, TCP/UDP, lifecycle, and cleanup evidence. Stop if elevation, driver installation, WFP modification, or persistent system tracing is required.

## 22. APPLICATION NETWORK OBSERVATION

READY. Contract includes application identity, PIDs, connection/protocol counts, endpoint classifications, observed time, freshness, availability, and attribution quality. Byte and location fields are optional.

## 23. ATTRIBUTION QUALITY

READY: CONNECTION_ONLY, BYTE_ATTRIBUTED, PARTIAL, UNKNOWN. Live default is CONNECTION_ONLY; validated injected byte-provider tests exercise BYTE_ATTRIBUTED.

## 24. NETWORK TOP5 STATUS

DEFERRED in live mode. It is empty/unavailable without real application byte rates. A separately named Top Active Connections view remains available. Injected validated byte rates prove descending Network Top5 behavior without changing the default claim.

## 25. DOMESTIC/FOREIGN CLASSIFICATION

READY contract. LOCAL/DOMESTIC/FOREIGN/UNKNOWN exist. Only address classes provably local are LOCAL; public addresses are UNKNOWN without GeoIP.

## 26. GEOIP BOUNDARY

READY. `GeoIpProvider` is provider-neutral and unimplemented by default. No remote IP was sent to an external provider.

## 27. EGRESS IDENTITY CONTRACT

READY. V0.1 supports route kind, optional public IP/geographic/network fields, provider, availability, timestamp, confidence, and mandatory approximate semantics. No live egress query occurred.

## 28. APEX STATUS

READY. Exact process presence is reported for Apex.exe, ApexCore.exe, and ApexHelperService.exe. Real smoke overall: RUNNING. No APEX control or directory inspection occurred.

## 29. APEX IMPLEMENTATION BOUNDARY

No assumption was made that APEX is Mihomo, Clash, Xray, sing-box, or any other proxy core. Presence only is observed.

## 30. SNAPSHOT IMPACT

An independent `ApplicationNetworkSnapshotCollector` was added. Existing `DeviceNetworkSnapshot` source and behavior were not modified. Application detail scans are not placed on its refresh path.

## 31. HOME FOOTER IMPACT

UNCHANGED. Source was not modified. A new explicit regression test proves an added application summary is ignored and raw connection/application data is absent from the footer model.

## 32. RAW DATA EXPOSURE

The independent snapshot returns aggregated application endpoint summaries, counts, and Top5 views, not the raw connection array. Smoke/audit output prints counts and states only, never actual remote IP lists.

## 33. PERFORMANCE

Process and connection collectors run concurrently. Three real complete smoke runs: 2966 ms, 2189 ms, 2810 ms. Because this is an independent on-demand/low-frequency entry, the existing fast snapshot path is unaffected.

## 34. WINDOWS SMOKE

PASS. Process count 269; CPU Top5 5; RAM Top5 5; connection count 947; network-observed applications 36; PID/application mapping PASS; IPv4/IPv6 parse PASS; APEX RUNNING; byte accounting DEFERRED_WITH_EVIDENCE.

## 35. ADMIN CHECK

Administrator required: NO. The access-denied NetTCPIP result was handled by moving to non-admin `netstat -ano`, not by requesting elevation.

## 36. NETWORK EGRESS CHECK

Product network egress: 0. No public-IP, GeoIP, probe, DNS, package, or external model request was made.

## 37. SYSTEM CHANGE CHECK

System modifications: 0. No service/process/firewall/WFP/route/DNS/proxy/configuration change, driver, capture component, or administrator action.

## 38. THIRD-PARTY DEPENDENCIES

Added dependencies: 0. Only Node built-ins and Windows built-ins are used.

## 39. FILES CREATED

- `src/applicationNetworkContracts.js`
- `src/applicationNetworkSnapshot.js`
- `src/providers/windowsProcessCollector.js`
- `src/providers/windowsApplicationConnectionCollector.js`
- `tests/applicationNetworkObservatory.test.js`
- `scripts/windowsApplicationNetworkSmoke.js`
- `docs/APPLICATION_NETWORK_OBSERVATORY_V0.1.md`
- `docs/audits/NEXA_DEVICE_NET_010.md`

## 40. FILES MODIFIED

- `src/index.js`
- `package.json`

No existing footer, snapshot, collector, legacy adapter, fixture, or Core file was modified.

## 41. TEST COMMANDS

- `npm.cmd test`
- `node --test tests/applicationNetworkObservatory.test.js`
- `npm.cmd run smoke:applications`
- `npm.cmd run verify`
- three direct `node scripts/windowsApplicationNetworkSmoke.js` timing runs

## 42. REGRESSION

Original baseline before construction: 210/210 PASS. Final complete module regression: 264/264 PASS (210 retained + 54 new).

## 43. 010 TEST RESULTS

Dedicated test file contains 54 tests, exceeding the required 35. All pass after implementation.

## 44. CROSS MODULE CHECK

Core modifications by this task: 0. Cross-module modifications by this task: 0. All 010 writes were restricted to `<PROJECT_ROOT>\03_modules\设备与网络`. Final Core status contained nine externally concurrent Electron-side entries while HEAD remained the baseline commit; they were preserved untouched.

## 45. BLOCKERS

NONE for the Foundation. Real per-application bytes, real GeoIP/egress identity, and stronger identity are intentional remaining gaps, not fabricated or silently promoted.

## 46. REMAINING GAPS

Per-application TX/RX bytes, domestic/foreign traffic byte attribution, real egress identity, approved GeoIP data, signed/package grouping, history, anomalies, and deeper APEX discovery.

## 47. NEXT RECOMMENDED TASK

One recommendation: `APP_BYTE_ACCOUNTING_LOW_RISK_ETW_FEASIBILITY` for an isolated non-admin ETW/TDH evidence spike. Do not start it automatically.

## 48. FINAL ACCEPTANCE

Process Collector READY; CPU Top5 READY; RAM Top5 READY; Connection Collector READY; PID mapping READY; ApplicationNetworkObservation READY; region/GeoIP/egress contracts READY; APEX presence READY; Footer unchanged; zero fake bytes.
