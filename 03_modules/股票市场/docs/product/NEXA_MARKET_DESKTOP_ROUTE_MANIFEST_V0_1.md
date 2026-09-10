# NEXA Market Desktop Route Manifest V0.1

The manifest is returned by `MarketDesktopBridge.get_route_manifest()` and is
independent of a browser/router framework.

| Route ID | Title | Parent | Icon semantic | Parameter | Badge source |
|---|---|---|---|---|---|
| `market` | 股票市场 | none | `market-chart` | none | `attention_today` |
| `market/watchlist` | 自选 | `market` | `bookmark` | none | `watchlist_count` |
| `market/portfolio` | 持仓 | `market` | `portfolio` | none | `open_position_count` |
| `market/research` | 研究 | `market` | `research` | none | `research_attention_count` |
| `market/instrument/:instrument_id` | 股票详情 | `market` | `instrument-detail` | `instrument_id` | none |
| `market/journal` | 决策日志 | `market` | `journal` | none | `journal_review_count` |

## Navigation state

`set_navigation_state(route_id, instrument_id=None, back_target=None)` records
selected route/instrument/back metadata only. It does not navigate, render, keep a
browser history or own URL parsing. Core remains the router.

Instrument detail requires an explicit provider-neutral NEXA `instrument_id` such
as `US.XNAS.AAPL`; the bridge never guesses identity from `AAPL` alone.

## Route-to-method mapping

| Route | Bridge read |
|---|---|
| `market` | `get_market_home()` / first-load `get_desktop_snapshot()` |
| `market/watchlist` | `get_watchlist(...)` |
| `market/portfolio` | `get_portfolio()` |
| `market/research` | `get_research_center()` |
| `market/instrument/:instrument_id` | `get_instrument_detail(instrument_id)` |
| `market/journal` | `get_decision_journal()` |

Evidence and explanations are contextual overlays/actions, not extra top-level
routes. Core may render them as panels or dialogs using `list_evidence` and
`explain_term`.

## Availability

All V0.1 routes are registered even when data is empty. Empty/missing/read-only
states are rendered from the returned product/problem projection; routes are not
silently removed. Badge counts are nonnegative integers generated from local
state. Mutating a returned route list cannot affect the bridge manifest.
