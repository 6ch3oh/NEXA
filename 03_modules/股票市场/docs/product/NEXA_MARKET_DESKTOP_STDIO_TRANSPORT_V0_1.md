# NEXA Market Desktop stdio Transport V0.1

Protocol: `nexa.market.desktop-stdio.v0.1`

Start one long-running module process with:

```text
python -m nexa_market.transport.stdio_rpc
```

The process reads one UTF-8 JSON request per stdin line and writes exactly one
compact JSON response per stdout line. Requests are processed serially. Logs are
written only to stderr. One process owns at most one `MarketDesktopBridge`.

Requests contain exactly `protocol_version`, `id`, `method`, and `params`.
Responses contain the same request `id`, the protocol version, `ok`, and either
`result` or a sanitized `error` with stable `code` and `message` fields.

`initialize` accepts `data_root`, `timezone`, `runtime_mode`, and
`network_refresh_enabled`. It uses the existing Python-side default aware UTC
clock. Network enablement is rejected; the transport never authorizes network.

`shutdown` disposes the bridge, writes and flushes its success response, and then
exits. stdin EOF performs best-effort disposal. No HTTP server, socket, thread,
third-party dependency, Provider, Repository, Broker, or Trading surface is
introduced.

## Allowlist

`initialize`, `start`, `stop`, `dispose`, `get_module_status`,
`get_desktop_snapshot`, `get_route_manifest`, `set_navigation_state`,
`get_market_home`, `get_watchlist`, `get_portfolio`, `get_instrument_detail`,
`get_research_center`, `get_decision_journal`, `list_evidence`, `explain_term`,
`refresh_local_projection`, `execute_action`, and `shutdown`.
