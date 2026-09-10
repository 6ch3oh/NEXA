# Legacy AI Asset Mapping — token-monitor -> NEXA AI Asset Center V0.1

Task: `NEXA-AI-002-R1B-002-R1` — Evidence-only Legacy Mapping recovery.
Sentinels: `NEXA_AI_002_R1B_002_R1`, `OUTBOUND_EVIDENCE_AUTHORIZED`, `EVIDENCE_ONLY`,
`NO_LEGACY_REPOSITORY_ACCESS`, `NO_SECRET`, `EVIDENCE_IMMUTABLE`, `MAPPING_REQUIRED`,
`STOP_AFTER_FULL_TESTS`.

## Permanent historical boundary

The formal Legacy baseline is exactly:

```text
source_type: git_commit
commit: 7d4e3830ddf5e786d85499571e10086a9cc518f4
working_tree_used: false
accident_preimage_status: UNKNOWN
mapping_verification_scope: committed_baseline_only
```

This mapping is derived exclusively from the sanitized, immutable Evidence under
`.nexa/evidence/legacy-token-monitor/` for that committed baseline. It never
claims that accident-era unstaged files were recovered, that the commit equals
the pre-accident working tree, or that unknown unstaged changes were verified.
Mapping rules and the Legacy Adapter must only consume Evidence-shaped or
project-local data; no Git, filesystem discovery, Legacy repository reading,
HTTP, provider SDK, network, environment-secret, or credential-store access.

## Classification legend

- **A — Direct semantic reuse**: legacy field is consumed verbatim as a NEXA contract field with no conversion.
- **B — Legacy Adapter conversion**: legacy field is converted by `src/adapters/legacy_token_monitor.py` into a NEXA contract.
- **C — Missing / not provable from the committed baseline**: the value exists in Evidence but lacks the contract-required semantics; it must not enter the NEXA contract.
- **D — Must not enter the NEXA contract**: raw secret, credential material, or provider-private implementation detail.

## Source fields (Evidence index)

Every fact below is backed by a file under `.nexa/evidence/legacy-token-monitor/`:

| Evidence file | Legacy source | `observed_fields` |
| --- | --- | --- |
| `provider/token-monitor-src_shared_limits.js-provider-f243375d3f9f.json` | `src/shared/limits.js` | `accountKey`, `accountLabel`, `provider`, `source`, `sourceDetail`, `status`, `updatedAt`, `windows` |
| `provider/token-monitor-src_shared_limitCollector.js-provider-a73158e8ea8b.json` | `src/shared/limitCollector.js` | `provider`, `source`, `sourceDetail`, `status`, `updatedAt` |
| `token_metadata/token-monitor-src_shared_limits.js-token_metadata-f243375d3f9f.json` | `src/shared/limits.js` | `accountKey`, `accountLabel`, `status` |
| `credential_metadata/token-monitor-src_shared_hashKey.js-credential_metadata-e9f27306d14b.json` | `src/shared/hashKey.js` | `hash` (`createHash`, `hashKey`, `sha256`) |
| `credential_metadata/token-monitor-src_shared_credentialStore.js-credential_metadata-5caf436ff8ed.json` | `src/shared/credentialStore.js` | `credential` (`CREDENTIAL_SETTING_PATHS`) |
| `usage/token-monitor-src_shared_usage.js-usage-cc43baa0cd45.json` | `src/shared/usage.js` | `cacheReadTokens`, `cacheWriteTokens`, `costUsd`, `inputTokens`, `outputTokens`, `totalTokens`, `updatedAt`, `windows` |
| `balance/token-monitor-src_shared_limits.js-balance-f243375d3f9f.json` | `src/shared/limits.js` | `amount`, `balance`, `credits`, `currency`, `quota`, `remaining`, `trackingSince`, `updatedAt` |
| `balance/token-monitor-src_shared_deepseekBalanceHistory.js-balance-ffe4a4242d28.json` | `src/shared/deepseekBalanceHistory.js` | `amount`, `balance`, `currency`, `trackingSince` |
| `pricing/token-monitor-src_shared_tokscaleCustomPricing.js-pricing-50d9d699d9db.json` | `src/shared/tokscaleCustomPricing.js` | `cacheReadPerM`, `inputPerM`, `modelId`, `outputPerM` |
| `cost/token-monitor-src_shared_usage.js-cost-cc43baa0cd45.json` | `src/shared/usage.js` | `cost`, `costUsd`, `totalCost`, `updatedAt` |
| `cost/token-monitor-src_shared_deepseekBalanceHistory.js-cost-ffe4a4242d28.json` | `src/shared/deepseekBalanceHistory.js` | `amount`, `balance`, `currency`, `trackingSince` |
| `provenance/token-monitor-src_shared_limits.js-provenance-f243375d3f9f.json` | `src/shared/limits.js` | `source`, `sourceDetail`, `trackingSince`, `updatedAt` |
| `provenance/token-monitor-src_shared_limitCollector.js-provenance-a73158e8ea8b.json` | `src/shared/limitCollector.js` | `derived`, `source`, `sourceDetail`, `updatedAt` |

`manifest.json` locks `legacy_source_type: git_commit`,
`legacy_source_repository: token-monitor`,
`legacy_source_commit: 7d4e3830ddf5e786d85499571e10086a9cc518f4`,
`working_tree_used: false`, `accident_preimage_status: unknown`, and reports
all eight categories as `present` with `raw_source_included: false`.

## Provider

Distinguish Provider identity (the NEXA `Provider` contract) from `SourceTag`
provenance. Provider-private implementation details (the body of
`normalizeLimitProvider`, `limitCollector.js` internals) are **D**.

| Legacy capability/field | Evidence | NEXA contract | NEXA field | Classification | Conversion rule | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| provider identity (`provider`) | limits.js / limitCollector.js provider evidence | `Provider` | `key`, `id` | B | `_normalize_provider_id` lower-cases and whitelists against `LEGACY_PROVIDER_IDS`; `id = legacy:<code>` or `legacy:<code>:sha256:<fingerprint>` when a validated accountKey is present | Rejects unknown provider codes (fail closed). |
| `accountKey` | limits.js provider evidence | `Provider` | `id` (suffix) | B | Validated SHA-256 fingerprint only (`_normalize_account_fingerprint`); never the raw value | The raw `accountKey` value is D; only `sha256:<digest>` participates in identity. |
| `accountLabel` | limits.js provider evidence | `Provider` | `display_name` | B | `_optional_str(accountLabel) or provider_code` | |
| `status` | limits.js provider evidence (safe literals: `ok`, `rateLimited`, `sourceRateLimited`, `disabled`, `notConfigured`, `unauthorized`, `unavailable`, `error`) | `Provider` | `status` | B | `_STATUS_TO_PROVIDER` (ok/rateLimited/sourceRateLimited -> ACTIVE, disabled -> DISABLED, notConfigured/unauthorized/unavailable/error -> INACTIVE) | Unknown status raises `ValueError`. |
| `source` | limits.js / limitCollector.js provider evidence | `SourceTag` | `source_reference` | B | carried into `legacy_source_tag(..., source=...)` | Provenance, distinct from Provider identity. |
| `sourceDetail` | limits.js / limitCollector.js provider evidence | `SourceTag` | `source_reference` | B | carried into `legacy_source_tag(..., source_detail=...)` | |
| `updatedAt` | limits.js provider evidence | `SourceTag` | `captured_at` | B | `_parse_iso(updatedAt)` | |
| `windows` | limits.js provider evidence | — | — | B (indirect) | consumed only by balance mapping for the credits window | Not a Provider field. |
| `normalizeLimitProvider` body / provider-private normalization | limits.js / limitCollector.js | — | — | D | not converted | Provider-private implementation detail. |

## Token and credential

Allowed: configured metadata, `accountLabel`, masked identifier, validated
SHA-256 fingerprint, and status. The fingerprint accepts 64 hexadecimal
characters with an optional `sha256:` prefix and normalizes to lowercase
`sha256:<digest>`. Raw Secret is **D**; plaintext `accountKey` fails closed.

| Legacy capability/field | Evidence | NEXA contract | NEXA field | Classification | Conversion rule | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `accountKey` (fingerprint) | token_metadata limits.js; credential_metadata hashKey.js (`hash`, `createHash`, `hashKey`, `sha256`) | `Token` | `masked_identifier` (`fp:sha256:<digest>`) | B | `_normalize_account_fingerprint` -> `sha256:<lowercase digest>`; rendered as `fp:sha256:<digest>` | Accepts bare 64-hex or `sha256:`-prefixed; upper-case hex is normalized to lowercase. |
| `accountKey` (plaintext secret) | token_metadata limits.js | `Token` | — | D | rejected by `_reject_plaintext_values` / `_ensure_not_plaintext` | Plaintext accountKey must fail closed. |
| `accountLabel` | token_metadata limits.js | `Token` | `label` | B | `_optional_str(accountLabel) or planLabel or provider_code` | |
| `status` | token_metadata limits.js | `Token` | `status` | B | `_STATUS_TO_TOKEN` (ok/rateLimited/sourceRateLimited/unavailable/error -> ACTIVE, unauthorized -> REVOKED, disabled -> SUSPENDED) | `notConfigured` yields no Token (`configured = False`). |
| configured metadata | token_metadata limits.js | `Token` | (presence) | B | `configured` flag or `_configured_from_status`; unconfigured -> `None` | No Token is emitted for unconfigured/disabled providers. |
| `credential` / `CREDENTIAL_SETTING_PATHS` | credential_metadata credentialStore.js (classification **D**) | `Token` | — | D | raw credential field names rejected via `_SECRET_FIELD_NAMES` | Raw credential material must not enter the NEXA contract. |
| `secret_ref` | (project-local configured metadata) | `Token` | `secret_ref` | B | non-secret reference (e.g. vault path) only | Empty or secret-bearing refs are rejected. |

## Usage

Evidence covers `totalTokens`, `inputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheWriteTokens`, `windows`, `updatedAt`, and `costUsd`.
**V0.1 has no Usage contract**; the limitation is recorded here without adding a
large Usage architecture. Token quantities alone must never create a monetary
`CostRecord`.

| Legacy capability/field | Evidence | NEXA contract | NEXA field | Classification | Conversion rule | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `totalTokens` | usage.js usage evidence | (no Usage contract in V0.1) | — | C | surfaced only via `legacy_usage_tokens` helper (token count); no contract object | V0.1 limitation: Usage is not represented as a contract. |
| `inputTokens`, `outputTokens` | usage.js usage evidence | — | — | C | summed only as token components | Token quantities alone never become Cost. |
| `cacheReadTokens`, `cacheWriteTokens` | usage.js usage evidence | — | — | C | token components only | Usage is not Cost; do not derive pricing/cost from token counts. |
| `windows` | usage.js usage evidence | — | — | C | not consumed for usage contract | |
| `updatedAt` | usage.js usage evidence | `CostRecord` | `occurred_at` (when costUsd present) | B | `_usage_timestamp(updatedAt)` | Shared by the Cost mapping below. |
| `costUsd` | usage.js usage evidence | — | — | (see Cost) | — | Monetary meaning is handled under Cost, not Usage. |

## Balance

Map `balance`, `amount`, `currency`, `credits`, `quota`, `remaining`,
`updatedAt`, and `trackingSince` to `BalanceSnapshot` where supported. Preserve
snapshot semantics; never reinterpret balance as cost.

| Legacy capability/field | Evidence | NEXA contract | NEXA field | Classification | Conversion rule | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `balance.amount` | limits.js balance evidence | `BalanceSnapshot` | `value` | B | `_extract_balance` -> Decimal | Snapshot, not a running total. |
| `balance.currency` | limits.js balance evidence | `BalanceSnapshot` | `unit` | B | `_balance_unit` (usd/cny/eur/credits/credit/quota/token_quota/points; else OTHER) | |
| `remaining` (credits window) | limits.js balance evidence | `BalanceSnapshot` | `value` | B | credits window fallback (`metric == "credits"`) | Provider-private window naming normalized to `BalanceUnit`. |
| `credits`, `quota` | limits.js balance evidence | `BalanceSnapshot` | `unit` | B | `_CURRENCY_TO_UNIT` | `credits` -> CREDITS, `quota` -> QUOTA. |
| `balanceUsd` (project-local shape) | limits.js balance evidence | `BalanceSnapshot` | `value`/`unit` | B | `balanceUsd` -> USD | |
| `updatedAt` / `snapshotDate` / `trackingSince` | limits.js balance evidence | `BalanceSnapshot` | `observed_at` | B | `_balance_observed_at` | A valid timestamp is required; missing timestamp fails closed. |
| `trackingSince` | deepseekBalanceHistory.js balance evidence | `SourceTag` | `captured_at`/`source_reference` | B | preserved in provenance | Snapshot observation time semantics preserved. |
| balance-history spend (`todaySpend`, `weekSpend`, `monthSpend`, `allTimeSpend`) | limits.js balance evidence (project-local fixture) | `CostRecord` | — | C | not converted to CostRecord | Spend inference would require a `derived` basis and must never be presented as provider-reported cost. |

## Pricing

| Legacy capability/field | Evidence | NEXA contract | NEXA field | Classification | Conversion rule | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `inputPerM` | tokscaleCustomPricing.js pricing evidence | `PricingSnapshot` | `price_per_unit` | B | `PriceDimension.INPUT` + `PricingUnit.PER_1M_TOKENS` | Price, separate from Cost. |
| `outputPerM` | tokscaleCustomPricing.js pricing evidence | `PricingSnapshot` | `price_per_unit` | B | `PriceDimension.OUTPUT` + `PricingUnit.PER_1M_TOKENS` | |
| `cacheReadPerM` | tokscaleCustomPricing.js pricing evidence | `PricingSnapshot` | `price_per_unit` | B | `PriceDimension.CACHE_READ` + `PricingUnit.PER_1M_TOKENS` | |
| `modelId` | tokscaleCustomPricing.js pricing evidence | `PricingSnapshot` | `model` | B | `_optional_str(modelId)`; empty/invalid rows skipped | |
| CACHE_WRITE pricing (`cacheWritePerM`) | — (baseline proves `cacheWriteTokens` usage only) | `PricingSnapshot` | — | C | not fabricated | The committed baseline does not prove `cacheWritePerM`; do not invent it. |

## Cost

Convert explicit `costUsd` only, with explicit monetary, currency/basis, and
time semantics required by the contract. Generic `cost`/`totalCost` is **C** or
fails closed unless Evidence proves monetary and temporal meaning. Balance-history
spend inference must use a `derived` basis and must not be represented as
provider-reported cost.

| Legacy capability/field | Evidence | NEXA contract | NEXA field | Classification | Conversion rule | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `costUsd` | usage.js cost evidence | `CostRecord` | `amount`/`currency`/`cost_basis`/`kind` | B | `_first_cost` over USD-explicit keys; `currency="USD"`, `cost_basis="legacy:costUsd"`, `kind=ACTUAL` | Requires a valid legacy timestamp (`occurred_at`); missing timestamp fails closed. |
| `costUsd` time semantics | usage.js cost evidence | `CostRecord` | `occurred_at` | B | `_usage_timestamp` from `lastUsedAt`/`updatedAt`/etc. | |
| `cost`, `totalCost`, `total_cost` | usage.js cost evidence (`observed_fields`: `cost`, `costUsd`, `totalCost`, `updatedAt`) | `CostRecord` | — | C | not converted; `cost_from_legacy` returns `None` | Evidence does not prove monetary/currency meaning for generic cost fields; fails closed. |
| balance-history `amount`/`balance`/`currency`/`trackingSince` | deepseekBalanceHistory.js cost evidence | `CostRecord` | — | C | not converted as provider-reported cost | Balance snapshots are not cost; spend inference (if any) would require a `derived` basis. |
| token-only usage | usage.js usage evidence | `CostRecord` | — | C | `cost_from_legacy` returns `None` when no USD-explicit cost key | Token quantities alone never create a monetary CostRecord. |

## Provenance

Preserve `source`, `sourceDetail`, `updatedAt`, `trackingSince`, derived status,
and conversion provenance. Legacy source facts and the Adapter-added
`LEGACY_IMPORT` layer are distinct.

| Legacy capability/field | Evidence | NEXA contract | NEXA field | Classification | Conversion rule | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `source` | limits.js / limitCollector.js provenance evidence | `SourceTag` | `source_reference` | B | `legacy_source_tag(..., source=...)` | |
| `sourceDetail` | limits.js / limitCollector.js provenance evidence | `SourceTag` | `source_reference` | B | `legacy_source_tag(..., source_detail=...)` | |
| `updatedAt` | limits.js provenance evidence | `SourceTag` | `captured_at` | B | `_parse_iso(updatedAt)` | |
| `trackingSince` | limits.js provenance evidence | `SourceTag` | `captured_at`/`source_reference` | B | preserved in `SourceTag` | |
| `derived` | limitCollector.js provenance evidence | `SourceTag` | — | C | `derived` status is not re-created; adapter provenance is `LEGACY_IMPORT` | Legacy `derived` facts are not claimed as contract-level derived values. |
| Adapter provenance layer | `LEGACY_LOCATION = "legacy:token-monitor"` | `SourceTag` | `source_type`/`source_reference` | A | every converted contract gets `SourceType.LEGACY_IMPORT` | Distinct from the legacy source facts embedded in `source_reference`. |

## Adapter boundary

`src/adapters/legacy_token_monitor.py` only converts sanitized Evidence-shaped or
local data into NEXA contracts. It has no Git, filesystem discovery, Legacy
repository reading, HTTP, provider SDK, network access, environment-secret
lookup, credential-store lookup, or subprocess behavior.

Required safety behavior (enforced):

- valid SHA-256 fingerprints are accepted and normalized to lowercase `sha256:<digest>`;
- plaintext `accountKey` is rejected (fail closed);
- token-only usage does not generate a `CostRecord`;
- explicit `costUsd` is required for explicit monetary cost conversion; generic `cost`/`totalCost` fail closed;
- INPUT, OUTPUT, and CACHE_READ pricing remain separate with `PER_1M_TOKENS`;
- CACHE_WRITE pricing is not fabricated;
- raw credential fields and secret-bearing values never enter NEXA contracts.

## V0.1 limitations recorded

- No Usage contract exists in V0.1; token counts are surfaced only through the
  `legacy_usage_tokens` helper and are never converted into monetary Cost.
- Generic legacy cost fields (`cost`, `totalCost`, `total_cost`) are not
  provable as monetary from the committed baseline and fail closed.
- Balance-history spend inference is not represented as provider-reported cost;
  any future derived spend must use a `derived` basis.
- CACHE_WRITE usage is evidenced, but CACHE_WRITE pricing is not; no CACHE_WRITE
  price dimension is fabricated.

## Offline Pricing Cache (NEXA-AI-011 intake)

This intake is locked to commit
`7d4e3830ddf5e786d85499571e10086a9cc518f4`; the Legacy working tree was not
used and `accident_preimage_status` remains `UNKNOWN`.

Primary Evidence:
`.nexa/evidence/legacy-token-monitor/pricing_cache/` records the committed blob
`src/shared/tokscalePricingCacheFallback.js` without storing its source text.
The same commit was also inspected at the explicitly related integration points
`tests/shared/tokscalePricingCacheFallback.test.js` and
`src/shared/collector.js`.

### Legacy implementation

| Concern | Committed behavior |
| --- | --- |
| Inputs | Windows platform, two catalog source descriptors, cache paths, current time, TTL, and a reachability probe |
| Output | Deterministic per-source result carrying action (`preserved`, `preserved-expired-online`, `wrote`, `failed`), reason, path, and whether real data existed |
| Disk schema | JSON object `{timestamp, data}`; `data` is an external catalog-shaped object |
| Freshness | Disk cache TTL is 24 hours; valid files are untouched |
| Fallback | Expired + reachable leaves the file for Tokscale to refresh; expired + unavailable rewrites the current timestamp while retaining data; missing/damaged becomes a legal empty cache |
| Persistence | Yes: local JSON, written by temporary file plus atomic rename |
| Network | Conditional HTTPS reachability probe for expired disk cache; collector pricing lookup invokes Tokscale separately |
| Sources | `models-dev` and `litellm` catalog identifiers/filenames; no canonical NEXA `SourceTag` is produced |
| Provider logic | No canonical Provider identity logic; it is catalog/source-specific infrastructure |
| Additional cache | `collector.js` also has a distinct six-hour in-process model-pricing lookup cache keyed by model and custom-pricing revision; it is not the disk offline fallback |

### NEXA decision

| Legacy element | Classification | Decision |
| --- | --- | --- |
| Disk cache orchestration, filesystem paths, probing, invalidation, Tokscale preparation | D `DO_NOT_REUSE` | Infrastructure/network behavior must not enter AI Asset domain core or Application Read Service. |
| Sanitized non-empty cached pricing rows with explicit dimension/unit/currency/effective-time semantics | B `ADAPTER` — NEXA-AI-012 Adapter implemented | `OfflinePricingAdapter` converts caller-supplied sanitized rows to `PricingSnapshot`; it never consumes the external cache schema or path directly. |
| Missing, damaged, or empty cache as pricing truth | C `MISSING` | Empty cache means pricing unavailable; do not fabricate zero pricing. |
| Direct cache-object reuse as a canonical contract | A `DIRECT_REUSE`: none | The external `{timestamp,data}` object is not a NEXA contract. Existing custom-pricing conversion remains the verified B path. |

Current NEXA handling is therefore: use the NEXA-AI-012 read-only adapter only
after a caller has supplied sanitized rows with explicit provider, source,
currency, model, and timezone-aware effective time. Keep SQLite
`PricingSnapshot` persistence and Query resolution; do not implement a pricing
fetcher, network cache, TTL, Tokscale refresh, or Legacy cache-file reader in
this module. The committed-baseline verification scope above remains unchanged.

## Preload API (NEXA-AI-011 intake)

Primary Evidence:
`.nexa/evidence/legacy-token-monitor/preload_surface/` records the committed
`src/electron/preload.js` blob. The explicit handlers in
`src/electron/main.js` and the committed aggregate shape in
`src/shared/usage.js` were inspected only to avoid inferring payload semantics
from method names.

The namespace is `tokenMonitor`, exposed through Electron `contextBridge` and
`ipcRenderer`. It is a transport surface, not a domain contract.

| Capability | Legacy status | Classification | Current NEXA handling |
| --- | --- | --- | --- |
| Provider list | No explicit canonical provider-list preload method is proven; aggregate stats may embed provider limits | C `MISSING` for a standalone list | Use canonical Provider records through Query/Consumption/Application Read Service. |
| Provider status | Present through `getServiceStatus` and aggregate `getStats` limits | D `DO_NOT_REUSE` transport | Domain status is already represented by `Provider`; external adapters may call the NEXA read service. |
| Token/configured/masked state | Selected profile getters expose redacted/enabled/configured metadata, but no canonical Token list is proven | B only for already-verified safe metadata; preload transport is D | Reuse current Token contract and verified Legacy Adapter. Never copy sensitive write surfaces. |
| Usage | Present through `getStats` periods/session detail | D `DO_NOT_REUSE` transport | Already covered by UsageRecord, Query, Analytics, Consumption, and Application Read Service. |
| Balance | Present indirectly in aggregate stats `limits`; no independent canonical balance endpoint | D `DO_NOT_REUSE` transport | Already covered by BalanceSnapshot and consumer views. |
| Pricing | `lookupModelPricing(modelId)` is directly exposed | D for IPC transport; B only for a future sanitized adapter | Already covered by PricingSnapshot and Query pricing resolution. Do not copy the Tokscale invocation. |
| Cost | Aggregate periods expose explicit `costUsd` alongside usage | D `DO_NOT_REUSE` transport | Already covered by CostRecord, ACTUAL/ESTIMATED separation, Analytics, and Consumption. |
| Sensitive profile/session writes | Present for several integrations | D `DO_NOT_REUSE` | Never enter Evidence, contracts, the Application Read Service, or future thin read adapters. |

### Transport versus domain conclusion

- The preload object is Electron/UI transport and must not be copied into `03`.
- Query Service, Consumption Contract 0.1, and Application Read Service replace
  its read-side aggregation role with provider-neutral, storage-backed models.
- SQLite Store replaces ad-hoc UI persistence concerns for canonical records and
  BudgetPolicy, but it does not adopt the Legacy network cache.
- No new Provider, Token, Pricing, or Credential core is required. Apply
  **REUSE BEFORE REBUILD** and keep any future Electron/API layer thin.
