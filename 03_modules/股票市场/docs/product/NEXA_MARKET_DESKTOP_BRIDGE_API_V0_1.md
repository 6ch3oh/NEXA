# NEXA Market Desktop Bridge API V0.1

Version: `nexa.market.desktop-bridge.v0.1`

Transport: in-process Python today; payloads are strict JSON-safe and can map to
future IPC without changing domain semantics. No HTTP server or IPC transport is
implemented by this Goal.

## Lifecycle and status

- `start() -> ModuleStatus`
- `stop() -> ModuleStatus`
- `dispose() -> ModuleStatus`
- `get_module_status() -> ModuleStatus`
- `get_desktop_snapshot() -> MarketDesktopSnapshot`

Lifecycle values: `CREATED`, `STARTING`, `READY`, `READ_ONLY`, `STOPPED`,
`FAILED`. Status includes store/cache/evidence/research/journal health, last local
refresh, refresh state, real-data availability, network capability, warnings and
an optional diagnostic reference.

## Page reads

- `get_market_home()`
- `get_watchlist(search=None, priorities=(), held_only=False,
  attention_only=False, sort_by="PRIORITY")`
- `get_portfolio()`
- `get_instrument_detail(instrument_id)`
- `get_research_center()`
- `get_decision_journal()`
- `list_evidence(instrument_id=None, evidence_ids=())`
- `explain_term(term, instrument_id=None)`
- `get_route_manifest()`
- `set_navigation_state(route_id, instrument_id=None, back_target=None)`

Reads are side-effect free. Every returned payload is a deep isolated JSON value;
host mutation cannot alter repositories, later reads or route metadata.

## Commands

`execute_action(action: str, payload: object) -> ActionResult`

Allowed actions:

- `ADD_WATCHLIST`, `REMOVE_WATCHLIST`, `UPDATE_WATCHLIST`;
- `RECORD_POSITION`, `UPDATE_POSITION`, `CLOSE_POSITION` (manual only);
- `CREATE_OBSERVATION`;
- `CREATE_RESEARCH_DRAFT`, `VALIDATE_RESEARCH`, `PUBLISH_RESEARCH`;
- `CREATE_JOURNAL`, `REVIEW_JOURNAL`;
- `VIEW_EVIDENCE`, `VIEW_EXPLANATION`;
- `REFRESH_LOCAL_PROJECTION`, `REFRESH_MARKET_DATA`.

`BUY`, `SELL`, `ORDER` and `TRANSFER` always return `FORBIDDEN`. There is no
Broker or Trading command.

All writes go through existing application services/workflows. Core never mutates
a repository. Research publication still obeys the quality gate; a failed-quality
draft returns a user-facing failure and remains unpublished.

## ActionResult

```json
{
  "success": true,
  "status": "SUCCESS",
  "updated_projection": {},
  "warning": null,
  "problem": null,
  "generated_at": "2026-08-14T08:00:00+00:00",
  "bridge_version": "nexa.market.desktop-bridge.v0.1"
}
```

Internal exceptions never cross this envelope. On failure, `problem` is a stable
`MarketUserFacingProblem` and previously durable state remains usable.

## Refresh

`refresh_local_projection()` rereads durable local state/cache and regenerates the
Home projection. Refresh states are `IDLE`, `REFRESHING`, `SUCCESS`, `PARTIAL`,
`FAILED`, `NETWORK_NOT_AUTHORIZED`, `PROVIDER_UNAVAILABLE`.

V0.1 performs no network request. `REFRESH_MARKET_DATA` returns
`NETWORK_NOT_AUTHORIZED` plus the current local projection. A future authorized
module implementation may decide its provider internally; Core still sends the
same command and never calls SEC/Yahoo directly.

## IPC_READY_CONTRACT

Identifier: `nexa.market.desktop-ipc.v0.1`.

The methods above map directly to request/response IPC calls because:

- inputs are strings, booleans, numbers, arrays and JSON objects;
- outputs contain no datetime/Decimal/enum/custom repository object;
- payloads contain no raw provider response;
- errors use stable problem codes;
- no method requires a callback, stream or repository handle;
- repeated reads do not mutate state;
- commands return one unified result.

Lifecycle creation still occurs in the host process with `MarketModuleConfig`;
`clock` is injected at composition time and is not serialized over IPC.

## Performance and safety

Typical local snapshot construction performs one product Home projection and
linear counter/trust scans. It does not repeatedly construct all 1,000+ Evidence
cards merely to calculate conflict badges. Full Evidence cards are created only
when Evidence/Detail is requested. No hidden HTTP, network refresh, provider SDK,
account, credential, payment or execution transport exists in `nexa_market.desktop`.
