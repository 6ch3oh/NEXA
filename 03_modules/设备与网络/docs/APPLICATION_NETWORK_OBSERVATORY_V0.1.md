# Application Network Observatory V0.1

## 1. Current Product Goal

V0.1 establishes a truthful, read-only Windows observation chain from process to PID to local TCP/UDP endpoint. It is an independent device-center detail capability, not part of the Home Footer refresh path.

## 2. Scope

The foundation includes process inventory, sampled process CPU, working-set RAM, connection inventory, PID mapping, application summaries, CPU/RAM Top5, an APEX presence summary, and contracts for region, GeoIP, egress identity, attribution quality, and optional application traffic.

## 3. Process Observation

`WindowsProcessCollector` invokes Windows PowerShell with `-NoProfile -NonInteractive`. A single bounded process performs both points of the CPU sample. Each observation contains PID, executable name, optional start time, CPU availability/value, working-set bytes, timestamp, availability, and provider identity.

## 4. Process Privacy

The collector does not request command lines, environment variables, window text, account information, executable paths, process memory, secrets, cookies, or tokens. A value containing path separators is rejected as a process name. Full executable paths are not part of the public contract.

## 5. CPU Sampling

CPU is calculated as the change in `TotalProcessorTime` divided by elapsed wall time and logical processor count. PIDs absent from the first point are retained with CPU unavailable; their current RAM can still be reported. Values are bounded to 0–100 and tests inject samples without real waiting.

## 6. Application Identity

The V0.1 stable identity is `process-name:<case-folded exact executable name>`. Only exact normalized executable-name matches are grouped. This safely collapses common same-name multi-process applications without path collection. It can still collide when unrelated installations use the same basename; stronger signed/package/parent evidence remains future work.

## 7. Application Grouping

Every process remains an independent process observation. An application group contains its exact executable identity and sorted PIDs. `Apex.exe`, `ApexCore.exe`, and `ApexHelperService.exe` remain separate application/process identities; APEX is only an additional higher-level presence summary.

## 8. Connection Observation

The default Windows backend executes built-in `netstat.exe -ano`. It yields TCP/UDP, local endpoint, remote endpoint when defined, TCP state, and owning PID without administrator rights. IPv4 and IPv6 endpoints are parsed locally. UDP has no truthful connected remote endpoint in this snapshot and therefore uses null remote address/port.

## 9. NetTCPIP Fallback Evidence

`Get-NetTCPConnection` and `Get-NetUDPEndpoint` were evaluated. In the actual non-admin smoke session both returned access denied. Their structured parser is retained as an injectable alternative, but the production default uses non-admin `netstat -ano`.

## 10. PID Mapping

Connections are mapped only when the owning PID exists in the same process observation. Missing PIDs and exited-process races are omitted from application attribution rather than guessed. Connections are never assigned by name, port, timing, or proportional estimates.

## 11. Application Network Contract

`ApplicationNetworkObservation V0.1` includes application identity, sorted PIDs, active connection count, TCP/UDP counts, remote endpoint summary, timestamp, freshness, availability, and attribution quality. Byte/rate and geographic distribution fields are optional and are present only when an approved provider supplies evidence.

## 12. Attribution Quality

The contract defines `CONNECTION_ONLY`, `BYTE_ATTRIBUTED`, `PARTIAL`, and `UNKNOWN`. Default local enumeration is `CONNECTION_ONLY`; this prevents a connection count from being mistaken for byte usage.

## 13. Byte Attribution Capability

`APP_BYTE_ACCOUNTING = DEFERRED_WITH_EVIDENCE`. The evaluated built-in paths are insufficient:

- `netstat -ano` and NetTCPIP cmdlets expose PID/endpoints/state, not bytes.
- `Get-NetAdapterStatistics` and .NET interface statistics expose host/interface totals, not PID totals.
- process I/O counters combine file/device I/O and are not network bytes.
- TCP extended statistics require native integration and may require enabling collection; they are TCP-only and not a stable built-in JavaScript snapshot source.
- SRUM is historical/coarse and its protected database is not a safe non-admin live collector.
- packet capture, WFP drivers, Npcap/WinPcap, interception, and content capture are prohibited.
- ETW may offer PID-tagged events, but session permissions, completeness, lifecycle, event loss, and native TDH decoding need a separate bounded capability task.

## 14. Lowest-Risk Byte Next Step

The next byte-specific investigation should prototype a user-mode ETW/TDH helper in isolation, with a documented non-admin permission matrix, TCP/UDP coverage, loss accounting, process-lifetime handling, and cleanup guarantees. It must stop if elevation, a driver, WFP changes, or persistent tracing is required.

## 15. Top5 Policy

CPU Top5 and RAM Top5 sort real application aggregates descending with stable identity tie-breaking. Network Top5 exists only when an injected approved byte provider returns validated upload/download bytes and rates. `top_active_connections` is separately named and never presented as network usage.

## 16. Domestic/Foreign Contract

`NetworkRegionClassification` defines `LOCAL`, `DOMESTIC`, `FOREIGN`, and `UNKNOWN`. Loopback, private, link-local, unique-local, multicast, unspecified, and other clearly non-public ranges are LOCAL. A public address without trusted geographic data is UNKNOWN. Port, language, address appearance, and prefix folklore are never used to guess geography.

## 17. GeoIP Boundary

`GeoIpProvider.classifyMany` is provider-neutral and has no default network implementation. V0.1 makes zero GeoIP requests. A future provider should prefer a local database or an explicitly approved, cached, privacy-bounded batch provider; it must not send every live remote IP to an arbitrary public service.

## 18. Egress Identity Contract

`EgressIdentity V0.1` represents route kind, optional public IP/country/region/city/ISP/ASN/confidence, timestamp, availability, provider, and mandatory `approximate: true`. It describes approximate Internet egress identity, never GPS, a home address, or precise physical location.

## 19. APEX Runtime Presence

The observer matches exactly `Apex.exe`, `ApexCore.exe`, and `ApexHelperService.exe`, case-insensitively. Each component is RUNNING, NOT_RUNNING, or UNKNOWN; overall is RUNNING if any component is present, NOT_RUNNING when a valid inventory contains none, and UNKNOWN when process observation is unavailable. It does not inspect implementation, directories, credentials, configuration, proxy state, or endpoints.

## 20. Snapshot Boundary

`ApplicationNetworkSnapshotCollector` is independent from `DeviceNetworkSnapshot`. It returns compact counts, application observations with endpoint summaries, Top5 summaries, and APEX presence. It does not return a raw connection list. `DeviceNetworkSnapshot` and Home Footer remain unchanged.

## 21. Performance Boundary

Process and connection collection execute in parallel. The real three-run smoke elapsed 2966 ms, 2189 ms, and 2810 ms on the current machine. This cost is isolated from the existing roughly 1.4-second device snapshot and must be invoked on demand or at low frequency, not bound to every footer refresh.

## 22. Failure Semantics

Collectors return unavailable with bounded reasons for platform mismatch, command failure, malformed JSON/output, or invalid providers. Partial protocol availability is representable. Missing/racing records are dropped or marked unavailable; zero, NaN, Infinity, fabricated traffic, and guessed location are not used as substitutes.

## 23. History Readiness

All new observations have schema version, stable application identity, timestamps, freshness, and serializable deterministic shapes. V0.1 creates no database and keeps no connection history.

## 24. Security and Side Effects

Collection is read-only. It requests no elevation, installs no dependency or driver, changes no process/service/firewall/WFP/route/DNS/proxy, performs no network request, decrypts no TLS, and records no application payload.

## 25. Remaining Gaps

Real per-application byte accounting, signed/package application identity, domestic/foreign byte distribution, anomaly alerts, and deeper APEX discovery remain deliberately separate tasks. Public egress identity and GeoIP were completed by NEXA-DEVICE-NET-011; the productization addendum below completes local application-observation history without relabelling it as hardware history.

## 26. Productization Addendum (2026-08-13)

The module now includes an opt-in long-term observation chain:

`ApplicationNetworkSnapshotCollector -> ApplicationNetworkObservationRecorder -> ApplicationNetworkHistoryStore -> ApplicationNetworkReadService -> ApplicationNetworkViewModel`

The observer is explicitly started and stopped by its host, prevents overlapping collections, remains reusable after a failed sample, and does not create a background service by itself. In-memory and atomic JSON-file stores share the same contract. Default retention is 30 days with a 10,000-entry ceiling; both are configurable. File persistence is local and contains no raw local/remote endpoint, PID, command line, environment, payload, account, hostname, MAC, or SSID.

## 27. History Semantics

Every stored entry is labelled `windows_application_network_observation`. It is an application-observation history of process-group resource summaries, active-connection counts, protocol/endpoint-class counts, and only when proven, application traffic counters. It is not hardware history. It does not consume or relabel Legacy/Core `usage`, `limits`, `periods`, device usage history, or AI-tool token/request usage.

Absent an approved byte source, history entries contain no `traffic` field and preserve `DEFERRED_WITH_EVIDENCE`. The window summary reports ready/deferred sample counts and declares exclusions for `ai_tool_usage`, `device_usage_history`, and `hardware_history`.

## 28. Application Byte Evidence Gate

`ApplicationByteBatch V0.1` is the sole promotion gate from `DEFERRED_WITH_EVIDENCE` to `READY`. A batch must declare:

- source type `windows_application_network_counters`;
- semantics `tx_rx_bytes_by_windows_application`;
- a non-empty provider ID and observation window;
- `complete: true`;
- exactly one finite, non-negative upload/download cumulative and rate record for every current application ID.

AI-tool usage, device usage, process I/O, connection/socket counts, host interface counters, CPU/RAM shares, and partial application coverage fail this gate. Therefore the default Windows collector still cannot claim application bytes.

## 29. Network Top5 and Active Connections

Network Top5 means descending per-application upload plus download rate in `bytes_per_second`. It is available only after the byte evidence gate passes. The independent `Top Active Connections` ranking remains usable from PID/socket evidence, has unit `connections`, and is explicitly labelled “not traffic bytes.” Neither view substitutes for the other.

## 30. Read API V0.1

`ApplicationNetworkReadService` is a transport-neutral, read-only service boundary suitable for an HTTP/IPC host. It exposes latest observation, bounded/time-window observation list, window summary, and per-application history. It returns clones, never mutates the store, defaults to bounded reads, and validates query limits/application IDs. No HTTP listener, administrator privilege, external network request, or Core integration is created by this module.

## 31. UI-ready ViewModel

`buildApplicationNetworkViewModel()` provides cards, CPU/RAM/Network rankings, active-connection ranking, history availability/window, APEX state, units, empty states, and anti-confusion disclosures. It is for the independent Application Network Observatory detail screen. `HomeFooterViewModel` remains unchanged and continues to ignore this data.

## 32. Current Local Completion Boundary

Locally complete: process/connection observation, deterministic aggregation, CPU/RAM Top5, APEX presence, persistent application-observation history, periodic orchestration, Read API, UI-ready ViewModel, strict application-byte promotion gate, and honest Network Top5 unavailable state.

Still blocked by stronger authority or a future approved source: real live per-application Windows TX/RX bytes, live Network Top5, domestic/foreign application byte distribution, driver/WFP/packet capture, and Legacy Device Snapshot Bridge fields not projected by Core. These gaps must not be filled by approximation.
