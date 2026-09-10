# NEXA-MARKET-LIVE-MARKET-DATA-001 Final Audit Report

Goal：NEXA-MARKET-LIVE-MARKET-DATA-001

Status：PASS

Codex：GPT-5.6 Sol / High

Baseline：298/298 PASS

SEC Incremental Architecture：PASS

SEC Unchanged Idempotency：PASS

SEC Accession Delta：PASS

SEC Amendment：PASS

SEC Fundamental Delta：PASS

SEC Real Refresh：NOT_AUTHORIZED（本次 0 GET；复用已密封 SEC capture）

Quote Provider Evaluation：PASS

Quote Pilot Candidate：`yahoo-finance-chart` / VALIDATED_TEMPORARY_CANDIDATE

Yahoo Undocumented Chart Terms Risk Acknowledged：YES

Final Provider Selected：NO

Quote Canonical Contract：PASS

Price History Contract：PASS

Quote Real Capture：PASS

Price History Real Capture：PASS

Raw Capture Seal / SHA-256：PASS

Real Capture Replay：PASS

Quote Ingestion：PASS / REAL_PROVIDER_CAPTURE

Quote Cache：PASS

Quote Evidence：PASS

Price History Cache / Evidence：PASS

MarketEvidencePack：PASS

Product API：PASS

Market Home Contract：PASS

Price History Projection：PASS

Data Reality Guard：PASS

Fixture Leakage Guard：PASS

Product Trust Summary：PASS

Combined SEC + Real Quote Smoke：PASS

Restart / Offline Startup：PASS

Focused Tests：42/42 PASS

Full Regression：301/301 PASS

SEC Real GET：0

Quote Real GET：2/2

Other Provider Network：0

Retries：0

API Keys：0

Accounts：0

Paid Services：0

Broker：NO

Trading：NO

Core Modified：NO

ExecutionHub Modified：NO

Cross-module Modified：NO

QUOTE_REAL_PILOT_READY：YES / COMPLETED

## End-to-end outcome

The authorized AAPL pilot completed the required local-first chain:

```text
Yahoo Chart HTTPS GET (AAPL only)
→ sealed RawPayloadEnvelope (REAL_PROVIDER_CAPTURE)
→ Yahoo capture adapter
→ MarketQuote / PriceHistoryRecord
→ domain validation
→ Local Market Cache
→ Quote / PriceHistory Evidence
→ MarketEvidencePack
→ durable repository restart
→ Apple Instrument Detail / PriceHistorySeries / JSON Product projection
```

The real quote capture reported `305.26 USD` with provider source timestamp
`2026-08-13T20:00:01Z`. The response did not provide usable
`exchangeDataDelayedBy` or `marketState` evidence. NEXA therefore correctly
projects delay and market status as `UNKNOWN`; it does not claim realtime merely
because the request just succeeded.

The short history capture normalized five chronological daily OHLCV points from
`2026-08-07T13:30:00Z` through `2026-08-13T13:30:00Z`. Adjustment status remains
`UNADJUSTED_OR_UNKNOWN` because the payload did not safely establish a stronger
semantic. No technical indicator or trading signal was created.

## Durable and product verification

- Quote ingestion wrote one Cache item and one Evidence item.
- Price History ingestion wrote five Cache items and five Evidence items.
- Replaying the identical quote produced zero additional Cache/Evidence writes.
- Direct Evidence is labeled `REAL_PROVIDER_CAPTURE`; Cache derived from it is
  labeled `LOCAL_CACHE_FROM_REAL`.
- After Cache and Evidence repositories were recreated, real-product mode still
  read the real Yahoo Quote, five-point history, real SEC fundamentals and filing
  events.
- The Evidence Pack no longer lists Quote as missing. It may remain partial when
  other components/conflicts are present; no data was fabricated for completeness.
- Apple Instrument Detail exposed price, currency, source timestamp, conservative
  delay/status, freshness, PriceHistorySeries, provenance and product trust.
- Recursive JSON-key inspection found no Yahoo raw keys such as
  `regularMarketPrice`, `exchangeDataDelayedBy`, `indicators` or `chart` in the
  Product projection.
- One hour after the five-minute Quote freshness window, the same local price
  remained readable with `STALE` freshness while SEC fundamentals remained usable.

## Network audit

| # | Capability | Fixed endpoint | HTTP | Response bytes | Retry | User-Agent |
|---:|---|---|---:|---:|---:|---|
| 1 | QUOTE | `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1m` | 200 | 35,621 | 0 | PRESENT |
| 2 | PRICE_HISTORY | `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d` | 200 | 1,582 | 0 | PRESENT |

Both requests were HTTPS GET, sequential, AAPL-only and executed through a
one-shot script that permits exactly one fixed URL per invocation. Redirects to
any host other than `query1.finance.yahoo.com` are rejected. The network window
closed at 2/2 requests; all subsequent tests replayed local capture files.

No SEC refresh, Yahoo expansion, AKShare, HKEX, other market provider, account,
credential, API key, payment, broker or trading network action occurred.

## Real captures

### Quote

- File: `tests/raw_fixtures/yahoo_chart_real/apple_quote_capture.json`
- Classification: `REAL_PROVIDER_CAPTURE`
- Requested: `2026-08-14T07:04:22.549913Z`
- Received: `2026-08-14T07:04:23.192495Z`
- Canonical payload SHA-256: `dda8aece555c7fcb3d37aa275e03ea7ce4618b97839aecd2c60d09e4afc06e99`
- Response-body SHA-256: `d5fb0fa3a19e17b7c04d0138cc36463c6cf5072b127b77fbf7bfb9ddb01d5dfc`
- Sealed-file SHA-256: `90febbd70dd6f0fbc991a45ee2f6a4d9431e86a5810b09444a67923c90e75558`

### Price History

- File: `tests/raw_fixtures/yahoo_chart_real/apple_price_history_capture.json`
- Classification: `REAL_PROVIDER_CAPTURE`
- Requested: `2026-08-14T07:04:36.920837Z`
- Received: `2026-08-14T07:04:37.221212Z`
- Canonical payload SHA-256: `78848190cd2aa1d39543f2260549c0e7746cab2877cbffe2a221e3f8b2110391`
- Response-body SHA-256: `9c4cb8e32e65d9721d92bf7ced9ec7f38c7e510b1b36cb65a37258c8bb075c29`
- Sealed-file SHA-256: `6645e42e58e6177aaec3ce6d99d9ab865ee968819cfe162eb5f8a72b4266d64d`

The strict loader verifies exact capture classification, provider, explicit AAPL
identity, operation, fixed request URL, HTTP/content metadata, schema snapshot,
User-Agent presence and canonical payload digest. A tampering replay test passes.

## Schema corrections

- None. The current real Chart payload was understood by the existing adapter.
- Missing delay and market-state metadata were handled by existing conservative
  `UNKNOWN` semantics, not guessed or patched.

## Files created by the authorized continuation

- `scripts/capture_yahoo_quote_pilot.py`
- `nexa_market/providers/yahoo_capture_file.py`
- `tests/raw_fixtures/yahoo_chart_real/apple_quote_capture.json`
- `tests/raw_fixtures/yahoo_chart_real/apple_price_history_capture.json`
- `tests/raw_fixtures/yahoo_chart_real/README.md`
- `tests/test_yahoo_real_pilot.py`

## Files modified by the authorized continuation

- `docs/audits/NEXA_MARKET_LIVE_MARKET_DATA_001_REPORT.md`

No file outside `<PROJECT_ROOT>\03_modules\股票市场` was modified.

## Remaining real-data gaps

- Yahoo Chart remains undocumented for this production use and is not the final
  provider despite this explicitly acknowledged bounded pilot.
- The captured response did not establish realtime/delayed or market-state
  semantics; both remain honestly `UNKNOWN`.
- History adjustment semantics remain unknown.
- Only AAPL was validated; no symbol or market expansion occurred.
- Exchange-calendar-aware session-gap classification is still future work.
- A documented/licensed production Quote provider still requires a separate final
  selection and legal/operational approval.

## Recommended next

Recommended next Goal: `NEXA-MARKET-MAIN-UI-REAL-DATA-001`. Integrate only the
durable product projection already proven here into the main local UI, preserving
cached/stale/unknown labels and the real-vs-fixture guard. Keep final production
Quote-provider selection as a separate gated decision; do not expand Yahoo usage
or instruments under this pilot authorization.
