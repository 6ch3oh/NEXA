# Device Center Recovery UX V0.1

## States

`healthy`, `recovering`, `degraded`, `recovered`, `action_required`, and `unavailable` are stable product states. A missing observation is `unavailable`; it must not be presented as an error or as healthy.

Each recovery issue contains a component, severity, safe title and summary, detected time, state, whether automatic recovery is available, whether user action is required, and an allowlisted action set. Raw exceptions, stack traces, filesystem paths, secrets and full public IP addresses are prohibited.

## Safe actions

The only exposed operations are refresh overview, run observation once, restart observation runtime, retry a failed component, retry history reopen, clear expired sensor cache, reread sensors, acknowledge a diagnostic or anomaly, dismiss an alert, and mark an alert delivered.

Delete history and reset store are hidden and are not executable through the product API. Unknown actions fail closed. A UI may still ask for confirmation before restart or dismiss operations, but confirmation does not expand the server allowlist.

## Presentation

- `recovering`: show progress without an error banner.
- `degraded`: explain which data is limited and preserve usable components.
- `recovered`: retain a quiet recovery record and allow retry if history remains limited.
- `action_required`: show the safe manual action and avoid technical internals.
- `unavailable`: show an empty state and start/retry affordance when allowed.
- Unsupported or deferred capabilities remain informational and never raise recovery alerts.
