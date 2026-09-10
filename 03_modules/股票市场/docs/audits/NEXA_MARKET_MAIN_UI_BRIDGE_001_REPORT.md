# NEXA-MARKET-MAIN-UI-BRIDGE-001 Final Audit Report

Goal：NEXA-MARKET-MAIN-UI-BRIDGE-001

Status：PASS

Codex：GPT-5.6 Sol / High

Major Cycles：5/12

Baseline：301/301 PASS

Desktop Bridge：PASS

Bridge Version：`nexa.market.desktop-bridge.v0.1`

Composition Root：PASS

Lifecycle：PASS

Market Home：PASS

Watchlist：PASS

Portfolio：PASS

Instrument Detail：PASS

Research Center：PASS

Decision Journal：PASS

Evidence：PASS

Beginner Explanation：PASS

Risk：PASS

Attention Today：PASS

User Actions：PASS

Refresh Contract：PASS

Module Status：PASS

Route Manifest：PASS

Core UI Integration Contract：PASS

Real Apple Local Projection：PASS

Demo Mode：PASS

Empty Mode：PASS

Partial / Error Mode：PASS

Fixture Leakage Guard：PASS

JSON-safe：PASS

Mutable Isolation：PASS

Restart：PASS

Golden Contracts：PASS

Desktop Acceptance Smoke：PASS

IPC Readiness：PASS

Focused Tests：129/129 PASS

Full Regression：312/312 PASS

Network：0

Broker：NO

Trading：NO

Core Modified：NO

ExecutionHub Modified：NO

Cross-module Modified：NO

Core Handoff Ready：YES

## Outcome

Module 14 now has one complete framework-neutral host entry:

```text
NEXA Desktop Host
→ create_market_application(MarketModuleConfig)
→ MarketDesktopBridge
→ MarketProductAPI / MarketReadAPI / application services
→ module-owned repositories, cache, evidence, research and journal
```

Core supplies only the market data root, timezone, aware clock, runtime mode and
an optional future refresh capability flag. It does not construct or understand
repositories, SEC, Yahoo, cache, Evidence, research internals, journal storage or
provider raw schemas.

The public host boundary is JSON-safe, deep-isolated and has no HTTP/IPC/network
transport. It is directly mappable to future IPC under
`nexa.market.desktop-ipc.v0.1`.

## Public Core imports

Exactly five symbols are exported by `nexa_market.desktop`:

1. `DESKTOP_BRIDGE_VERSION`
2. `MARKET_ROUTE_MANIFEST`
3. `MarketModuleConfig`
4. `MarketDesktopBridge`
5. `create_market_application`

Static inspection found no Core, ExecutionHub or other-module import in
`nexa_market/desktop`.

## Lifecycle and recovery

Verified lifecycle behavior:

- create → start → ready;
- repeated start is idempotent;
- stop before start is safe;
- repeated stop is idempotent;
- stopped instance may restart;
- new host instance reloads the same durable state;
- malformed local state enters `READ_ONLY` rather than crashing;
- read-only mode returns `MarketUserFacingProblem` and blocks writes;
- internal exceptions/invalid raw records do not cross the Bridge.

Store health covers state, cache, Evidence, Research and Journal. Detailed
recovery remains inside module 14; the host receives a stable diagnostic reference
instead of an internal diagnostics dump.

## Runtime modes and reality

| Mode | Data behavior | Fixture fallback |
|---|---|---|
| `LOCAL_REAL` | replays/reads sealed real-derived local SEC + Yahoo data | forbidden |
| `DEMO` | explicitly uses synthetic persona state | allowed and labelled |
| `EMPTY` | initializes an empty durable user state | forbidden |

Home and Instrument Detail expose `desktop_data_reality`, full trust summary and
data health. `LOCAL_REAL` returned 1,887 direct real Evidence records and 1,884
real-derived Cache records, with documentation-derived count zero.

## Real Apple local projection

Using network zero and the existing sealed captures, the Bridge verified:

- Apple Inc. / `US.XNAS.AAPL` explicit identity;
- cached quote `305.26 USD`;
- quote freshness `STALE` at the deterministic acceptance clock;
- delay and market status remain conservative `UNKNOWN`;
- stale nonempty price remains visible, not incorrectly replaced by “unavailable”;
- five chronological Price History points;
- SEC Filing/Fundamental Evidence and provenance;
- Product trust classified as `CACHED_REAL`;
- fixture fallback false;
- no Yahoo raw keys in Product JSON.

## Routes

Recommended top-level Core route: `market` / `股票市场`.

Child routes:

- `market/watchlist`
- `market/portfolio`
- `market/research`
- `market/instrument/:instrument_id`
- `market/journal`

The Bridge stores selected route, selected instrument and back target metadata.
Core remains responsible for actual navigation/rendering.

## Commands and safety

Implemented unified `ActionResult` commands:

- Watchlist add/remove/update;
- manual Position create/update/close;
- Observation create;
- Research draft/validate/publish with quality gate;
- Journal create/review/retrospective;
- Evidence/Explanation views;
- local projection refresh;
- future market refresh command envelope.

`BUY`, `SELL`, `ORDER` and `TRANSFER` return `FORBIDDEN`. Positions remain manual
records only. `REFRESH_MARKET_DATA` returns `NETWORK_NOT_AUTHORIZED` while keeping
the local projection usable; Core never calls a Provider.

## Desktop acceptance smoke

The final smoke completed:

```text
create → start
→ Market Home → Watchlist → Portfolio → Apple Detail
→ Beginner Explanation → Evidence
→ Research Draft → Validate → Publish
→ Journal → Review / Retrospective
→ local user actions → stop
→ recreate host → start → durable state/revisions reload
→ Module Status → stop
```

All host payloads passed strict JSON serialization. Host mutations to returned
dictionaries did not affect later projections or internal state.

## Performance correction

The first real snapshot measurement was about 16 seconds because Market Home
constructed all 1,887 full Evidence cards merely to detect conflict attention.
This was replaced with one linear `fact_key/value/unit` scan. The same snapshot
test then completed in about 1.6 seconds in the focused environment, without a
complex cache or Evidence-page behavior change.

## Golden contracts

Deterministic compact SHA-256 seals exist for:

- `desktop_snapshot_empty`
- `desktop_snapshot_beginner`
- `desktop_snapshot_real_apple`
- `desktop_snapshot_partial`
- `route_manifest`
- `user_action_result`

## Contract corrections

1. Timezone configuration no longer requires the optional Python `tzdata`
   package. `UTC`/IANA-style names remain in the contract and the injected aware
   clock remains authoritative.
2. Existing Product display now treats a nonempty `STALE`, `DELAYED` or `UNKNOWN`
   quote as displayable while retaining its explicit freshness/status label.
3. Desktop trust-summary composition now passes the required unavailable count and
   exposes correct real/cached-real counts.
4. Market Home conflict attention was changed from full-card construction to a
   linear raw Evidence classification scan.

## Static boundary audit

| Boundary | Result |
|---|---|
| Desktop network primitives / URLs | 0 |
| New SEC/Yahoo/other GET | 0 |
| Core import path | 0 |
| ExecutionHub import path | 0 |
| Other-module import path | 0 |
| API keys/accounts/payment | 0 |
| Broker/Trading | NO |

Only files under `<PROJECT_ROOT>\03_modules\股票市场` were modified.

## Core required inputs

- absolute module-specific `data_root`;
- timezone identifier;
- timezone-aware clock callable;
- runtime mode: `LOCAL_REAL`, `DEMO`, or `EMPTY`;
- optional future refresh capability configuration, which is not authorization.

## Core forbidden responsibilities

- provider selection or SEC/Yahoo calls;
- repository/cache/evidence file management;
- PnL/allocation/freshness/conflict calculation;
- research construction or quality validation;
- financial-term explanation;
- store repair/deletion;
- fixture-to-real promotion;
- Broker, Trading or execution.

## Files created

- `nexa_market/desktop/__init__.py`
- `nexa_market/desktop/contracts.py`
- `nexa_market/desktop/composition.py`
- `nexa_market/desktop/bridge.py`
- `scripts/generate_desktop_golden.py`
- `tests/test_desktop_bridge.py`
- `tests/desktop_golden/desktop_snapshot_empty.json`
- `tests/desktop_golden/desktop_snapshot_beginner.json`
- `tests/desktop_golden/desktop_snapshot_real_apple.json`
- `tests/desktop_golden/desktop_snapshot_partial.json`
- `tests/desktop_golden/route_manifest.json`
- `tests/desktop_golden/user_action_result.json`
- `docs/product/NEXA_MARKET_CORE_UI_INTEGRATION_CONTRACT_V0_1.md`
- `docs/product/NEXA_MARKET_DESKTOP_ROUTE_MANIFEST_V0_1.md`
- `docs/product/NEXA_MARKET_DESKTOP_BRIDGE_API_V0_1.md`
- `docs/audits/NEXA_MARKET_MAIN_UI_BRIDGE_001_REPORT.md`

## Files modified

- `nexa_market/product/api.py`

## Remaining module-14 gaps

- A documented/licensed final production Quote provider remains unselected.
- Real delay/market-state evidence was absent in the pilot capture and remains
  `UNKNOWN`.
- Price History adjustment semantics and exchange-calendar gap classification are
  still incomplete.
- Extended automatic recovery for every Evidence/Research/Journal corruption case
  remains outside this Bridge Goal; current behavior is safe read-only/problem.
- Full Evidence/filing lists will eventually benefit from host pagination/windowing
  for UI rendering, although snapshot generation is now bounded and linear.
- Network refresh remains an unimplemented, separately authorized module action.
- Only AAPL real local projection is validated; no market/symbol expansion occurred.

## Recommended next

`01-01 CORE MARKET DESKTOP HOST INTEGRATION`

Core may now register the route and render/forward this contract. That separate
task should consume only the five public imports, keep network/provider logic in
module 14, and preserve `LOCAL_REAL`/`DEMO`/`EMPTY` reality labels.
