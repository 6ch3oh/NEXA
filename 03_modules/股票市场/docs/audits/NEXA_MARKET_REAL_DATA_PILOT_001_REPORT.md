# NEXA-MARKET-REAL-DATA-PILOT-001 Final Audit Report

Goal：NEXA-MARKET-REAL-DATA-PILOT-001

Status：PASS

Codex：GPT-5.6 Sol / High

Baseline：286/286 PASS

SEC Authorization：YES

Company：Apple Inc.

Ticker：AAPL

CIK：0000320193

Canonical Instrument：US.XNAS.AAPL

Provider：official.sec-edgar / OFFICIAL_PUBLIC_SOURCE

Final Provider Selected：NO

User-Agent：PRESENT（NEXA Market Research &lt;REDACTED_CONTACT&gt;）

Real GET Count：2 / 4

Submissions：PASS

CompanyFacts：PASS

Raw Capture：PASS

Raw SHA-256：PASS

Real Capture Replay：PASS

Filing Normalization：PASS

Fundamental Normalization：PASS

Period Safety：PASS

Unit Safety：PASS

Duplicate Fact Safety：PASS

Provenance：PASS

Local Cache：PASS

Evidence：PASS

Evidence Pack：PASS / PARTIAL as designed because Quote is missing

Beginner Explanation：PASS

Research Input：PASS / deterministic / REAL_LLM_CALLS=0

Product API：PASS

Restart：PASS

Real Product Smoke：PASS

Focused Tests：5/5 PASS

Full Regression：291/291 PASS

Real Network Calls：2

Yahoo Calls：0

AKShare Calls：0

Other Provider Calls：0

API Keys：0

Accounts：0

Paid Services：0

Broker：NO

Trading：NO

Real Account：NO

Core Modified：NO

ExecutionHub Modified：NO

Cross-module Modified：NO

Third-party Runtime Added：NONE

## End-to-end acceptance

The pilot proved this real, official-data path without bypassing the provider-neutral ingestion architecture:

```text
SEC HTTPS GET
→ sealed REAL_PROVIDER_CAPTURE RawEnvelope
→ SEC capture adapter
→ raw/schema/identity validation
→ canonical filing and fundamental normalization
→ domain validation
→ provenance and lineage
→ durable Local Market Cache
→ durable Evidence
→ process recreation and reload
→ MarketEvidencePack (PARTIAL: Quote=MISSING)
→ deterministic Research input
→ Beginner Indicator explanation
→ Apple Instrument Detail
→ JSON product projection
```

The full smoke produced 1,001 canonical filings, 876 contextual fundamental facts, one FY2025 annual `FundamentalSummary`, 1,878 durable cache records, and 1,881 durable Evidence records. Recreating the repositories from disk retained all records. The offline consumer reconstructed the annual fundamental and 1,001 filing-backed market events. No ordinary test performs a network request.

## Network audit

| GET | Capability | Official endpoint | HTTP | Response bytes | Retry | User-Agent |
|---:|---|---|---:|---:|---:|---|
| 1 | Company Submissions / FILINGS | `https://data.sec.gov/submissions/CIK0000320193.json` | 200 | 164,531 | 0 | present, contact redacted |
| 2 | XBRL Company Facts / FUNDAMENTALS | `https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json` | 200 | 3,789,099 | 0 | present, contact redacted |

The requests were sequential and more than one second apart. No optional third or fourth GET was necessary. There were no redirects, retries, 403/429 responses, credentials, accounts, keys, payment, login, or filing submission.

## Real captures

### Company Submissions

- File: `tests/raw_fixtures/sec_edgar_real/apple_submissions_capture.json`
- Classification: `REAL_PROVIDER_CAPTURE`
- Payload SHA-256: `cfb523130eb737106361d6b5d4897842161ab85b310d4d8462c355d41c0f3eab`
- Response-body SHA-256: `705a5cb6e9c7b8b2490a0cdac53645cbfbfe6401e4042c36717eeecf5c175d9c`
- Sealed fixture file SHA-256: `a24f22bce9da164784e554cf2097719979c3276a3ac2e82d58222f32c6bcdd5b`
- Schema snapshot: `sec.submissions.company.v1`
- Captured: `2026-08-13T13:05:24.446577+00:00`

### Company Facts

- File: `tests/raw_fixtures/sec_edgar_real/apple_companyfacts_capture.json`
- Classification: `REAL_PROVIDER_CAPTURE`
- Payload SHA-256: `2d1974cf68b105aa4ae1a9da58bc95488993216dde40f8470bcf17eef4c8a472`
- Response-body SHA-256: `73a86c6aedc31f77cac2ea4df5f80f0b3bd7e6eb58bb4e01444fbedf3afb9c43`
- Sealed fixture file SHA-256: `329565c4fee5ffa0ed3787581c64e0b5849e9111aad31abfff946840ea28daa7`
- Schema snapshot: `sec.xbrl.companyfacts.v1`
- Captured: `2026-08-13T13:05:42.403906+00:00`

The artifact stores only `NEXA Market Research <REDACTED_CONTACT>`. The supplied contact is used transiently by the one-shot transport and is absent from fixtures, source, tests, Golden files, and this report.

## Identity and normalization

Identity is an explicit effective-dated mapping, not a symbol guess:

```text
NEXA Instrument: US.XNAS.AAPL / AAPL / XNAS
SEC Identity: official.sec-edgar / CIK 0000320193
Mapping confidence: VERIFIED
```

The Submissions response validated CIK, company name, `AAPL`, Nasdaq exchange metadata, filing dates, report dates, forms, accession numbers, acceptance timestamps, and source references. Every recent entry became a provider-neutral `CorporateFiling`; the Product API receives canonical fields rather than the SEC parallel-array schema.

Company Facts normalization uses an explicit concept allowlist and retains all observation contexts. No `last-wins` merge occurs. Each fact identity includes taxonomy, concept, unit, reporting end, accession, form, fiscal context, frame, and value. Annual, quarterly, instant, and duration classifications remain distinct.

Normalized FY2025 annual values selected from the real payload were:

| Canonical metric | SEC taxonomy / concept | Reporting period | Unit | Value |
|---|---|---|---|---:|
| Revenue | `us-gaap / RevenueFromContractWithCustomerExcludingAssessedTax` | `ANNUAL:FY2025`, end `2025-09-27` | USD | 416,161,000,000 |
| Net profit | `us-gaap / NetIncomeLoss` | `ANNUAL:FY2025`, end `2025-09-27` | USD | 112,010,000,000 |
| Assets | `us-gaap / Assets` | instant at `2025-09-27` | USD | 359,241,000,000 |
| Stockholders' equity | `us-gaap / StockholdersEquity` | instant at `2025-09-27` | USD | 73,733,000,000 |

These values are official historical filing facts, not current prices and not investment advice.

## Period, unit, duplicate, and provenance safety

- Duration facts require a real start and end; instant facts prohibit a fabricated start.
- Fiscal year, fiscal period, reporting scope, filed date, accession, form, and optional frame are preserved per observation.
- Annual and quarterly observations never share a canonical fact identity.
- All 876 selected observations use their actual SEC unit (`USD` in this capture). Missing or unsupported units cannot enter normalization silently.
- Duplicate concepts across filings, periods, accessions, amendments, and frames are retained as independent lineage-bearing facts.
- Each Filing/Fundamental Evidence record traces to SEC, CIK, taxonomy/concept where applicable, form, accession, filed date, reporting period, unit, raw capture reference, payload SHA-256, and transform version.

## Evidence, explanation, research, and Product API

- Filing Evidence and Fundamental Evidence are created by the ingestion pipeline and durably reloaded.
- `MarketEvidencePack` correctly returns `PARTIAL`; Quote remains missing because no quote provider was authorized.
- The Revenue beginner card exposes the real value, `ANNUAL:FY2025`, plain-language meaning, why it matters, limitations, Evidence references, and `END_OF_DAY` freshness.
- Deterministic Research accepted the SEC Evidence Pack as input. No real LLM was called and no BUY/SELL action was produced.
- Apple Instrument Detail returns `Apple Inc.`, `AAPL`, SEC-backed filings/fundamentals/evidence provenance, beginner cards, and research availability. Price is explicitly `UNAVAILABLE`; no market price was invented.
- JSON serialization completes without exposing the raw SEC payload or SEC-specific response arrays.

## Schema Corrections

1. The real Submissions payload contained forward-compatible fields beyond the documentation-derived minimum, including `core_type` and `isXBRLNumeric`. The adapter now validates a stable required column subset and safely ignores unknown additive columns.
2. Company Facts confirmed that a single concept has multiple filings, periods, accessions, fiscal contexts, amendments, and frames. Normalization was corrected to retain every context instead of collapsing observations.
3. SEC facts required first-class instant/duration, annual/quarterly/other, unit, accession, filed-date, fiscal, and frame fields. These were added to the provider-neutral canonical contract and durable lineage.
4. The historical generic US fixture identity was rejected for product acceptance. The pilot now uses the explicit canonical mapping `US.XNAS.AAPL ↔ CIK 0000320193`, and the smoke test asserts `Apple Inc. / AAPL`.
5. Product evidence cards gained structured provenance, and beginner indicator cards gained reporting-period projection. The two affected deterministic Product Golden digests were regenerated and then revalidated.

No unresolved SEC schema field was guessed. Unsupported concepts remain outside Evidence.

## Tests

- Construction baseline: `python -m unittest discover -s tests` → 286/286 PASS
- SEC Adapter and real-capture replay: `python -m unittest tests.test_sec_edgar_pilot -v` → 5/5 PASS
- Product/real-data Golden plus SEC pilot: 9/9 PASS
- Final full offline regression: `python -m unittest discover -s tests` → 291/291 PASS

Focused coverage includes sealed-hash replay, explicit identity, Submissions normalization, Company Facts normalization, period/unit/duplicate safety, fail-closed schema/identity drift, durable cache/evidence restart, partial Evidence Pack, beginner explanation, deterministic research, Apple Product API, and JSON projection.

## Files Created

- `scripts/capture_sec_pilot.py`
- `nexa_market/providers/sec_capture.py`
- `nexa_market/providers/sec_edgar.py`
- `tests/test_sec_edgar_pilot.py`
- `tests/raw_fixtures/sec_edgar_real/README.md`
- `tests/raw_fixtures/sec_edgar_real/apple_submissions_capture.json`
- `tests/raw_fixtures/sec_edgar_real/apple_companyfacts_capture.json`
- `docs/audits/NEXA_MARKET_REAL_DATA_PILOT_001_REPORT.md`

## Files Modified

- `nexa_market/providers/identity.py`
- `nexa_market/cache/models.py`
- `nexa_market/cache/repositories.py`
- `nexa_market/repositories/collection.py`
- `nexa_market/ingestion/contracts.py`
- `nexa_market/ingestion/pipeline.py`
- `nexa_market/ingestion/consumer.py`
- `nexa_market/evidence/models.py`
- `nexa_market/evidence/repositories.py`
- `nexa_market/evidence/serialization.py`
- `nexa_market/product/models.py`
- `nexa_market/product/cards.py`
- `tests/product_golden/instrument_detail.json`
- `tests/real_data_golden/product_detail.json`

## Remaining Real Data Gaps

- Quote, price history, intraday price, market status, and current-price freshness remain unavailable; no quote provider was authorized.
- This first capture is a fixed Apple snapshot. Incremental SEC refresh, amendments since last accession, and capture-retention policy are not yet automated.
- Only four high-value `us-gaap` canonical concepts are enabled. Additional concepts require explicit semantics, unit, period, and product-need review.
- Filing document text and individual inline-XBRL filing documents were not fetched; the two authorized company endpoints were sufficient.
- SEC is not selected as a final all-purpose provider and cannot satisfy Quote capability.

## Recommended Next Pilot

Recommend `NEXA-MARKET-SEC-INCREMENTAL-REFRESH-PILOT-001`: with separate explicit authorization, perform a bounded two-GET Apple refresh, compare payload/capture hashes and latest accession, prove idempotent no-change ingestion plus append-only new-filing handling, and document fixture-retention policy. Keep Quote selection as an independent later pilot so SEC is never misclassified as a quote provider.
