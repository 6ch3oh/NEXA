# Real Data Requirement Matrix V0.1

This matrix is derived from product questions, not from any candidate provider’s current fields. “Freshness” means the UI must know the source timestamp and state explicitly; it does not promise live data. Final provider remains unselected.

| Page / surface | Required data | Target update | Acceptable freshness presentation | Markets | Required provider capability |
|---|---|---|---|---|---|
| Home / selected indices | index identity, status, price, change, percent, source timestamp | session-aware intraday or EOD | live/delayed/EOD/stale/unavailable | CN/HK/US | INDEX_QUOTE, MARKET_STATUS, PROVENANCE |
| Home / Attention | quote freshness, missing fields, research quality, evidence conflicts, invalidated journal, events, risks | on local refresh; event-driven where available | each item carries reason and evidence time | CN/HK/US | QUOTE, EVENT, FUNDAMENTAL, SOURCE_REFERENCE |
| Watchlist | instrument master, quote/change, exchange, events | quotes intraday/EOD; events daily/event-driven | delayed/stale/missing visible per row | CN/HK/US equities, ETF, index | SYMBOL_MASTER, QUOTE, EVENT |
| Portfolio | quote, currency, split-adjusted identity metadata | quote intraday/EOD; actions event-driven | missing or stale quote makes PnL partial | CN/HK/US | QUOTE, CURRENCY, CORPORATE_ACTION |
| Detail / Header | instrument identity, quote, market timestamp | intraday/EOD | exact source timestamp and availability | CN/HK/US | SYMBOL_MASTER, QUOTE |
| Detail / Fundamentals | revenue, net profit, gross margin, EPS, PE, PB, ROE, FCF, debt, dividend yield, market cap, period, units | filing/statement cycle; valuation daily/EOD | reporting period plus retrieved time; stale policy by metric | CN/HK/US | FUNDAMENTALS, VALUATION, FILING_REFERENCE |
| Detail / Events | occurred time, published time, title, summary, source, related instruments | event-driven or daily | distinguish occurred/published/retrieved | CN/HK/US | COMPANY_EVENT, NEWS_OR_FILING_REF |
| Detail / Evidence | normalized fact, raw reference, as-of, retrieved-at, units, provenance | with every underlying update | accepted/stale/rejected/conflicting | CN/HK/US | RAW_REFERENCE, TIMESTAMP, LICENSING_METADATA |
| Detail / Dividend | dividend yield, declaration/ex/date/pay date, amount, currency | action-driven | future/confirmed/historical explicitly labelled | CN/HK/US | DIVIDEND, CORPORATE_ACTION |
| Research Center | all evidence inputs plus stable identities | user-triggered local workflow | quality gate reflects stale/missing/conflict | CN/HK/US | same capabilities as Evidence; no AI provider mandated |
| Performance history (deferred) | adjusted prices, actions, total-return series | daily | revision/adjustment provenance | CN/HK/US | PRICE_HISTORY, ADJUSTMENT, CORPORATE_ACTION |
| Benchmark (deferred) | selected benchmark and aligned adjusted history | daily | matched calendars and currencies | CN/HK/US | INDEX_HISTORY, PRICE_HISTORY, FX if cross-currency |
| Activity history (deferred) | user-entered or broker-authorized immutable ledger | on explicit user action/import | origin and edit history required | account-dependent | MANUAL_LEDGER or later explicit broker scope |

## Cross-cutting acceptance

Every real-data adapter must provide stable instrument identity, source and raw reference, observed/source/retrieved timestamps, market and currency, capability declaration, licensing notes, explicit missing semantics, and deterministic normalization. The product must continue to work when a capability is absent. FX is required before any global multi-currency total or allocation. Corporate actions are required before claiming adjusted performance. Network integration, provider selection, credentials, and paid access require a separate user-approved goal.
