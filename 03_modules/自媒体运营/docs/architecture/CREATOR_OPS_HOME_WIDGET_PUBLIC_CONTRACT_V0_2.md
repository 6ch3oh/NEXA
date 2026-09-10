# Creator Ops Home Widget Public Contract V0.2

`CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION = 0.2.0`

V0.2 is an additive read-only contract. The existing account matrix, activity, performance, freshness, and safety fields remain available for compatibility. Desktop Home should consume `selected_window`, `availability`, and `account_summaries`.

## Supported windows

`getHomeSummary({ window })` accepts exactly `1h`, `5h`, `1d`, `3d`, or `1w`. Legacy `windowDays` remains supported, but the two options cannot be combined.

Window delta semantics are evidence-gated:

- each publish record uses one latest cumulative metric snapshot;
- a delta exists only when that publish record has a baseline at or before the window start and a newer observation inside the selected window;
- missing baseline, missing window observation, and no metrics are distinct availability states;
- genuine zero and negative deltas are preserved;
- `plays` is `null / UNSUPPORTED_SOURCE_FIELD` because the authoritative MetricsDTO has no independent plays field;
- `followers_or_new` projects recorded `followers_delta`; it is never described as a follower total.

## Account summary

Each account exposes only the public account identifier/name/platform, an allowlisted `icon_key`, account status, latest observed views/likes/follower delta, nullable window delta, metric freshness, availability, and a bounded Creator Ops handoff.

When the public dashboard classification is not `PRODUCTION`, account metric values are withheld with `NON_PRODUCTION_DATA`. When the production database has accounts but no metrics, each account and the overall summary report `NO_METRICS`; numeric values remain `null`, never zero.

The adapter reuses the already-running loopback UI Host with GET-only requests. It does not start or stop the Host, execute commands, publish content, mutate SQLite, or access any external network.
