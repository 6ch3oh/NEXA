# NEXA-DEVICE-NET-011 Audit

## 1. TASK STATUS

PASS. Implementation, offline verification, and explicitly authorized live Windows smoke are complete.

## 2. PRECHECK

010 was PASS. Module baseline was 264/264 PASS. Existing EgressIdentity V0.1, GeoIpProvider boundary, ApplicationNetworkSnapshot, APEX presence, contracts, tests, and documentation were read before implementation.

## 3. PROVIDER STUDY

Official sources were reviewed for ipify, ipapi.co, IPinfo, and MaxMind. The agent-reach skill was selected, but its CLI was unavailable; research therefore used official Provider web documentation only.

## 4. PUBLIC IP PROVIDER

READY: ipify universal JSON endpoint. It is HTTPS, structured, dual-stack, keyless for this endpoint, replaceable, and returns only an IP field used by the adapter.

## 5. GEO PROVIDER

READY: ipapi.co specified-IP JSON endpoint. It documents IPv4/IPv6, country, region, city, ASN, and organization. Optional data remains absent. It is replaceable and receives only the current public egress IP.

## 6. REJECTED PROVIDERS

IPinfo city/region requires a token. MaxMind local GeoLite2 requires account/license acceptance and a database download. Neither was silently installed or credentialed. Random sites and HTML scraping were rejected.

## 7. EGRESS IDENTITY CONTRACT

Existing V0.1 was extended, not replaced. It supports public IP, country/country code, region, city, ISP, ASN, optional coordinates/accuracy, observation time, availability, provider, source type, Geo provider, cache status, freshness, and mandatory approximate semantics.

## 8. ROUTE KIND

The contract now explicitly supports DEFAULT, DOMESTIC, FOREIGN, and UNKNOWN. A normal single observation is DEFAULT. V0.1 does not claim domestic or foreign route causality.

## 9. LOCAL IP

`LocalNetworkIdentity` separately exposes active non-loopback local IPv4/IPv6 arrays. It never calls them public IPs and does not include hostname, MAC, or SSID.

## 10. IPv4/IPv6

Valid public IPv4 and IPv6 are accepted through one shared canonicalization/public-range authority used by both providers and the formal contract. Private, loopback, link-local, documentation, multicast, unspecified, benchmark, CGNAT, and unique-local addresses are rejected as public identity; IANA public exceptions remain accepted. Equivalent compressed IPv6 representations compare equal. IPv6 scope suffixes are normalized only in the local-interface model.

## 11. CACHE

PASS: default fresh TTL 5 minutes; maximum stale window 1 hour; configurable validation; hit has zero requests; expiration refreshes; concurrent refreshes coalesce; mutations are isolated.

## 12. FRESHNESS

PASS: fresh/stale/unknown state, age, stale threshold, and cache status are exposed. Age is based on provider `observedAt`, not cache insertion time. Far-future and older-than-stale-window replacement-provider observations are rejected.

## 13. STALE FALLBACK

PASS: failed refresh within stale window returns stale cached identity. Expired-beyond-window cache is discarded and failure returns unavailable.

## 14. FAILURE

DNS, timeout, network, non-2xx, 429, malformed JSON, oversized response, invalid IP, provider IP mismatch, and missing Geo are handled without leaking raw response/errors or crashing snapshots. Arbitrary replacement-provider error codes are reduced to the formal failure enum; malformed Geo preserves the proven public IP and degrades Geo only.

## 15. TIMEOUT

PASS: default 5 seconds, range-checked, AbortController-backed. The initial 3-second live threshold was increased after an authorized ipify request timed out despite successful DNS/TCP/HTTP-status diagnostics. External refresh remains independent from local snapshots.

## 16. PRIVACY

Public provider receives no domain payload. Geo provider receives one argument: the current public IP. Tests prove process/application data externalization count is zero. Provider response extras are ignored by whitelist mapping. The generic HTTP helper is not exported from the public domain index.

## 17. RESPONSE BOUNDARY

GET only, HTTPS constants, JSON accept header, redirects rejected, no request body, 64 KiB cap, and no arbitrary URL supplied by UI/snapshot.

## 18. PROVIDER PROVENANCE

Public provider ID, Geo provider ID, source type, observation time, cache status, and freshness survive normalization. Raw Provider JSON does not.

## 19. APEX RELATION

APEX presence coexists in the read model. Causality is always UNKNOWN. No APEX control, config, directory, credential, proxy, node, or account operation occurred.

## 20. DOMESTIC/FOREIGN BOUNDARY

Dual egress is DEFERRED. Domestic/foreign placeholders are null. No second exit, target, route, or APEX behavior was fabricated.

## 21. APP BYTE ACCOUNTING

Remains DEFERRED_WITH_EVIDENCE. Network Top5 and domestic/foreign byte attribution remain DEFERRED.

## 22. SNAPSHOT IMPACT

DeviceNetworkSnapshot remains unchanged. ApplicationNetworkSnapshot can consume already cached identity through `peek()` only and never starts public requests. Empty cache preserves prior shape.

## 23. HOME FOOTER IMPACT

UNCHANGED. An explicit regression test proves egress fields are ignored.

## 24. LOCAL GEOIP FUTURE

Documented as `LOCAL_GEO_PROVIDER_FUTURE` for bulk remote-IP classification. No database or third-party package was downloaded or installed.

## 25. WINDOWS LIVE SMOKE

PASS. After explicit user authorization, the final run made one ipify request and one ipapi.co request. It returned masked IPv6 `2409:8a00:xxxx:xxxx`, approximate China / Beijing / Beijing, China Mobile Communications Corporation, AS56048; contract and leakage checks passed; APEX was RUNNING with causality UNKNOWN. Earlier attempts reached ipify only and either failed or timed out at the initial three-second bound. DNS/TCP 443 and a body-free ipify HTTP-status diagnostic passed, so the production bound was adjusted to five seconds before the passing final run.

## 26. NETWORK EGRESS

Final acceptance run: ipify 1 successful request; ipapi.co 1 successful request. Across the authorized troubleshooting period, ipify had three smoke attempts total (two failed/time-limited and one passed) plus one HTTP-status-only diagnostic that did not read response content; ipapi.co was called once, only by the passing run. Authorized DNS/TCP diagnostics targeted each approved domain once. Process/application data sent: 0.

## 27. ADMIN CHECK

Administrator required: NO. System modifications: 0.

## 28. FILES CREATED

- `src/providers/egressIdentityProviders.js`
- `src/ipAddress.js`
- `src/egressIdentityService.js`
- `tests/egressIdentityService.test.js`
- `scripts/windowsEgressIdentitySmoke.js`
- `docs/EGRESS_IDENTITY_AND_GEO_V0.1.md`
- `docs/audits/NEXA_DEVICE_NET_011.md`

## 29. FILES MODIFIED

- `src/applicationNetworkContracts.js`
- `src/applicationNetworkSnapshot.js`
- `src/index.js`
- `package.json`

## 30. TESTS

Dedicated 011 offline tests: 77/77 PASS, exceeding the required 35 and covering every named task case plus replacement-provider authority, canonical IPv6, strict contract invariants, response bounds, failure-code whitelisting, provider-time freshness, request coalescing, stale-window eviction, optional-enrichment fail-soft behavior, and the final five-second timeout policy.

## 31. REGRESSION

Baseline 264/264 PASS. Final module regression: 341/341 PASS (264 retained + 77 new).

## 32. DEPENDENCIES

Third-party dependencies added: 0. Implementation uses Node built-ins only.

## 33. CORE WRITE CHECK

Core writes by 011: 0. Precheck saw HEAD `6635ed6b8c925178e7d4d323c6214a2c81f1c1c7` with nine pre-existing/concurrent Electron entries. Final review saw externally advanced HEAD `9f1fb724a86d32db8666f57e0f6755bd817d10b0` with a clean worktree. 011 did not author, touch, revert, commit, or claim that external transition.

## 34. CROSS MODULE CHECK

Cross-module writes: 0. All task writes are within `<PROJECT_ROOT>\03_modules\设备与网络`.

## 35. OPEN MODELS

OpenCode calls: 0. DeepSeek calls: 0.

## 36. BLOCKERS

NONE.

## 37. NEXT

After live-smoke approval and PASS, the single recommended next task is `DOMESTIC_FOREIGN_DUAL_EGRESS_DISCOVERY_V0_1`. Do not start automatically.
