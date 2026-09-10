# NEXA-MARKET-REAL-DATA-READINESS-001 Final Report

Goal：NEXA-MARKET-REAL-DATA-READINESS-001

Status：PASS_WITH_PILOT_AUTHORIZATION_REQUIRED

Codex：GPT-5.6 Sol / High

Major Cycles：14/14

Additional Models：0/60

Baseline：263/263 PASS

Final Regression：286/286 PASS

Provider Evaluation：PASS

Provider Candidates：official.sec-edgar, official.hkex-disclosure, official.hkex-market-data, official.sse-disclosure, official.szse-disclosure, official.cninfo-disclosure, official.sse-market-data, official.szse-market-data, candidate.yahoo-validation, candidate.akshare, official.fred, candidate.commercial

CN Coverage：PARTIAL — official disclosure candidates exist; automated terms need review; official quote/history/index is paid/licensed; AKShare optional only.

HK Coverage：PARTIAL — official disclosures require reuse review; official quote/history/index is paid/licensed.

US Coverage：FILINGS/FUNDAMENTALS COVERED via SEC candidate; quote/history remains PARTIAL.

Global Coverage：PARTIAL — FRED macro candidate needs API key and per-series terms review.

Official Sources：SEC EDGAR, HKEX/HKEXnews, SSE, SZSE, CNInfo, FRED

Aggregator Candidates：AKShare

Provider Selection Policy：PASS

Identity Mapping：PASS

Ingestion Pipeline：PASS

Cache Integration：PASS

Evidence Integration：PASS

Product Integration：PASS

Schema Drift：PASS

Failure / Fallback：PASS

Dry Run：PASS

Golden：PASS

Restart：PASS

Network Research：READ_ONLY / official documentation only

Real Market Network Calls：0

API Keys Used：0

Accounts Created：0

Paid Services：0

Final Provider Selected：NO

Broker：NO

Trading：NO

Core Modified：NO

ExecutionHub Modified：NO

Cross-module Modified：NO

Third-party Runtime Added：NONE

## Created files

- `nexa_market/ingestion/{__init__,contracts,pipeline,consumer}.py`
- `nexa_market/providers/{selection,identity,coverage,optional}.py`
- `tests/test_real_data_readiness.py`
- `tests/test_real_data_golden.py`
- `tests/real_data_golden/{provider_registry,refresh_dry_run,quote_ingestion_receipt,product_detail}.json`
- `tests/raw_fixtures/real_data_ready/README.md` and 16 synthetic documentation-derived JSON fixtures
- `docs/data/NEXA_MARKET_PROVIDER_EVALUATION_MATRIX_V0_1.md`
- `docs/data/NEXA_MARKET_PROVIDER_SELECTION_POLICY_V0_1.md`
- `docs/data/NEXA_MARKET_PROVIDER_TERMS_AND_LICENSE_REVIEW_V0_1.md`
- `docs/data/NEXA_MARKET_REAL_DATA_INGESTION_ARCHITECTURE_V0_1.md`
- `docs/data/NEXA_MARKET_REAL_DATA_PILOT_PLAN_V0_1.md`
- `docs/audits/NEXA_MARKET_REAL_DATA_READINESS_001_REPORT.md`

## Modified files

- `nexa_market/providers/capabilities.py`
- `nexa_market/providers/__init__.py`
- `nexa_market/cache/models.py` (adds FILING cache type to the existing cache)
- `nexa_market/research/models.py` (adds provider-neutral MACRO evidence kind)
- `tests/test_provider_capabilities.py`
- `README.md`

## Contract Corrections

- Separated software licence from upstream data terms, caching, attribution, credentials, and cost.
- Expanded three placeholder candidates to a deterministic 12-provider registry with all entries disabled by default.
- Selection now prioritizes source tier before applying paid/credential/terms/enablement gates; fallback cannot silently lower freshness.
- Added explicit provider identity/effective period/alias resolution; ambiguous symbols are never guessed.
- Added SHA-256 raw envelope, synthetic/captured acquisition classification, transform version, schema-drift failure, quality state and deterministic receipt.
- Hardened the raw boundary so the declared hash must match JSON-safe content, nested values are recursively immutable, and non-success envelopes cannot enter normalization.
- Added canonical history, filing, news and macro contracts while reusing existing Quote, FundamentalSummary, Event, Cache and Evidence contracts.
- Canonical history, filing, news and macro records now validate their own identifiers, timestamps, numeric bounds, source/provenance agreement and period ordering; malformed domain data returns a stable rejection receipt instead of escaping the pipeline.
- Missing numeric data remains unavailable/partial, never zero; annual and quarterly periods cannot collapse into one identity.
- Cache is local-first and multi-source; identical ingestion is idempotent, different providers coexist, and Evidence Pack reports conflicts.
- Cache and Evidence identities include Provider identity, every cache item retains its own source timestamp/provenance, and Quote, Price History, Fundamental, Filing, Event, News and Macro all receive ingestion-owned Evidence records.
- Idempotency, ingestion, cache and evidence identities use a fixed-length SHA-256 over Provider + operation + raw hash + transform version; long Provider identifiers cannot overflow IDs and Provider/raw collisions cannot alias records.
- Provider failures become plain-language Risk/Attention inputs; Product API receives canonical values and exposes no raw Provider schema.
- All 14 Provider failure states have stable plain-language Risk/Attention projections.
- Refresh is DRY_RUN-only and always reports zero planned network calls; credential permission is distinct from credential availability, terms approvals are explicit, and a strict freshness request cannot silently choose a delayed source. Optional provider dependency absence does not break startup.

## Rejected / restricted providers

- Yahoo validation: production use rejected/restricted pending a documented authorized API and storage/display rights; retained only as pre-existing temporary validation implementation.
- AKShare: rejected as a core dependency or universal production source; optional per-function adapter evaluation remains possible after upstream terms review.
- Unselected commercial provider: cannot be selected without vendor, contract, cost, credential and redistribution decisions.
- Official CN/HK real-time data: not rejected, but paid/licensed and therefore gated.

## Remaining Technical Gaps

- No real Provider adapter has been enabled; only a fixture-only adapter exists by design.
- Provider-specific real schema snapshots and HTTP transport policy await pilot authorization.
- Quote/history production candidate remains unresolved across CN/HK/US.
- Corporate-action adjusted history, FX, benchmark and transaction ledger remain deferred.
- Full terms approval for CN/HK automated disclosure access and FRED individual series remains outstanding.

## User Decisions Required

- Approve at most two public SEC read-only GETs, a test CIK/instrument, and an identifying SEC User-Agent contact string.
- Later: exact CN/HK disclosure source terms approval.
- No AKShare installation, API key, account, or paid decision is required for Pilot A/B.

REAL_NETWORK_PILOT_READY：YES

Requested Pilot Authorizations：`ALLOW_PUBLIC_SEC_READ_ONLY_GET`; approved test CIK; approved SEC User-Agent application/contact string. Separate future `DATA_TERMS_REVIEW` for CN/HK.

Recommended Next Goal：NEXA-MARKET-REAL-DATA-PILOT-001
