# NEXA Market Core UI Integration Contract V0.1

Contract version: `nexa.market.desktop-bridge.v0.1`

This document is the formal handoff from module 14 to NEXA Desktop Core. It is
framework-neutral and does not authorize Core, Electron, React, Vue, IPC or HTTP
changes inside this Goal.

## Stable Core imports

Core imports only from `nexa_market.desktop`:

```python
from nexa_market.desktop import (
    DESKTOP_BRIDGE_VERSION,
    MARKET_ROUTE_MANIFEST,
    MarketModuleConfig,
    MarketDesktopBridge,
    create_market_application,
)
```

No other market symbol is part of the Core contract. In particular, Core must not
import repositories, SEC/Yahoo adapters, cache, Evidence builder, research quality
gate, journal storage or provider raw contracts.

## Required Core inputs

| Input | Required | Meaning | Recommended value |
|---|---|---|---|
| `data_root` | yes | Absolute directory owned only by module 14 | `<NEXA data>/14-market` |
| `timezone` | yes | Host display timezone identifier | `Asia/Shanghai` |
| `clock` | yes in production composition | A callable returning an aware `datetime` | Core clock service |
| `runtime_mode` | yes | `LOCAL_REAL`, `DEMO`, or `EMPTY` | user/profile selection |
| `network_refresh_enabled` | optional | Reserved capability flag; does not authorize a GET | `False` |

Core supplies one market-specific root. The module owns the internal `state`,
`cache`, `evidence`, `research`, `journal` and future `diagnostics` layout. Core
must not depend on their filenames.

## Host lifecycle

```python
config = MarketModuleConfig(
    data_root=market_data_root,
    timezone="Asia/Shanghai",
    clock=core_clock,
    runtime_mode="LOCAL_REAL",
)
market: MarketDesktopBridge = create_market_application(config)
status = market.start()
snapshot = market.get_desktop_snapshot()
# render/forward actions
market.stop()  # or dispose()
```

`start()` and `stop()` are deterministic and idempotent. A stopped bridge may be
started again; normal host restart creates a new bridge against the same
`data_root`. A damaged store produces `READ_ONLY` plus a user-facing problem, not
an internal exception dump.

## What Core must do

1. Register one top-level route labelled `股票市场`.
2. Register the child route metadata returned by `get_route_manifest()`.
3. Provide the five configuration inputs above.
4. Call `create_market_application`, then `start` before reads/actions.
5. Render returned JSON-safe Product/Bridge projections without interpreting raw
   provider fields.
6. Forward user commands through `execute_action(action, payload)`.
7. Use `refresh_local_projection()` for a local re-read.
8. Treat `REFRESH_MARKET_DATA` as a module command; never call a provider itself.
9. Show `problem.title`, `problem.explanation`, severity and available actions.
10. Call `stop`/`dispose` when the module host closes.

## What Core must not do

- manage SEC, Yahoo, symbols, CIKs, provider selection or raw payloads;
- construct or repair repositories;
- calculate PnL, allocation, freshness, evidence conflicts or trust;
- construct Research, run its quality gate or explain financial indicators;
- write Evidence, cache, research or journal files directly;
- treat `DEMO` records as real data;
- infer realtime status from request time;
- expose BUY, SELL, ORDER, TRANSFER, Broker or Trading actions;
- perform automatic recovery or delete damaged stores;
- parse internal diagnostics beyond displaying `diagnostic_reference`.

## Rendering and data reality

Every augmented Home/Detail projection contains:

- `desktop_data_reality.runtime_mode`;
- `page_classification`: `CACHED_REAL`, `SYNTHETIC_DEMO`, or `MISSING`;
- real/cached-real/documentation-derived/synthetic counts;
- `fixture_fallback_allowed`;
- `trust_summary`;
- `data_health`.

`LOCAL_REAL` uses only Cache tagged `LOCAL_CACHE_FROM_REAL`; fixture fallback is
false. A nonempty stale/unknown quote remains displayable and is labelled stale or
unknown. `DEMO` is explicitly synthetic. `EMPTY` does not manufacture data.

## Recommended host layout

One top-level navigation item: `股票市场` (`market`). Internal sections are 首页,
自选, 持仓, 研究 and 决策日志. Instrument Detail is a second-level route. Core
owns actual navigation and presentation; the market module owns route metadata,
projections and commands.

## Error and recovery behavior

Host-facing failures are `MarketUserFacingProblem` projections with code, title,
explanation, severity, affected page, whether data remains usable, available
actions and an optional diagnostic reference. Internal exception class/message and
raw invalid records are not exposed. `READ_ONLY` blocks writes while allowing safe
reads. Manual recovery remains a separate operator workflow.

## Compatibility

The bridge composes the existing `MarketReadAPI` and `MarketProductAPI`; it does
not replace them. Bridge additions require backward-compatible V0.1 fields.
Breaking changes require a new desktop-bridge version and a Core migration review.

## Handoff status

Module-side Core handoff is ready. The next separate task may register this
contract in Core, but must not add provider/network responsibilities to Core.
