# Device Center Product Contract V0.1

Status: frozen for `NEXA-DEVICE-NET-017`.

## Consumer surface

The default screen is Overview. Stable read-only screens are Overview, Performance, Network, Applications, History, Anomalies, and Diagnostics / Recovery. The bounded home snapshot is `get_dashboard_snapshot`; detailed reads are `get_overview_product`, `get_performance_product`, `get_network_product`, `get_applications`, `get_application_detail`, `get_history_product`, `get_anomalies_product`, `get_alerts`, `get_diagnostics`, and `get_recovery`.

Read methods only project already-observed state. They must not start collectors, create timers, make network calls, or require administrator privileges.

## Shared semantics

- Availability: `available`, `partial`, `unavailable`, `unsupported`, `deferred`, `unknown`.
- Freshness: `fresh`, `stale`, `unknown`.
- Severity: `info`, `normal`, `warning`, `critical`, `unknown`.
- Every scalar metric carries value, unit, availability, freshness, observation time, and safe reason where applicable.
- Empty states are structured objects with stable codes. `null`, zero, and failure are never interchangeable.
- DTOs are plain JSON and use schema version `0.1`.

## Product decisions

- CPU temperature is `unsupported` with `CPU_TEMPERATURE_UNAVAILABLE_WITH_EVIDENCE`; it is not a device failure.
- Application network byte Top 5 is unavailable with `APPLICATION_BYTE_ACCOUNTING_NOT_AVAILABLE`. Active connection count remains a separate observation and is never labelled traffic volume.
- An unknown APEX route model means limited visibility, not a route error.
- Public IP may be shown in the Network UI. Diagnostics expose only a masked identity.
- History windows are `one_hour`, `one_day`, `seven_days`, and `thirty_days`, capped at 300 consumer points per metric. Per-volume disk curves remain an explicit empty state in V0.1.
- Dashboard payload contains only overview, Top 5 summaries, latest anomaly, runtime and recovery headline. It must not embed history curves or full connection lists.

## Compatibility

Existing collectors, snapshot contracts, history persistence, anomaly lifecycle and runtime remain authoritative producers. This contract is a consumer projection and does not reopen deferred CPU temperature, application byte accounting, or APEX route attribution work.
