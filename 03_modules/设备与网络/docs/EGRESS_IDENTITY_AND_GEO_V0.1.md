# Public Egress Identity & GeoIP V0.1

## 1. Product Goal

This foundation answers which public IP an approved external observer sees and, when available, its approximate country, region, city, ISP, and ASN. It does not identify a GPS position, household, LAN address, or application destination.

## 2. Public IP Semantics

`public_ip` is accepted only from an external HTTPS observation. Local adapter addresses, APEX configuration, proxy settings, DNS, routes, and old cache entries are never promoted into a fresh public-IP fact.

## 3. Local vs Public IP

`LocalNetworkIdentity` lists non-loopback addresses assigned to active local interfaces. `EgressIdentity` represents the address visible to an external provider. They are separate objects and UI labels should say “局域网 IP” and “公网 IP”.

## 4. IPv4 and IPv6

The public provider uses the ipify universal endpoint and accepts either public IPv4 or public IPv6. Private, loopback, link-local, documentation, multicast, unspecified, benchmark, carrier-grade NAT, and unique-local ranges are rejected as public identities. Dual-stack availability is not mandatory.

Public-range validation is a shared contract authority rather than a provider-only check, so a replacement Provider cannot promote a private address. IPv6 values are canonicalized for equality checks while the originally observed textual address remains the displayed fact.

## 5. GeoIP Semantics

GeoIP maps the single current public egress IP to network-location metadata. Country, region, city, ISP, ASN, coordinates, and accuracy are optional. Missing data stays absent and `geo_availability` becomes unavailable when no meaningful geographic/network field is returned.

## 6. Approximate Location

Every EgressIdentity has `approximate: true`. IP-derived coordinates are often population or network centers and cannot identify a precise address. Approved labels are “IP 位置”, “出口位置”, or “网络位置”; GPS and precise/home location labels are prohibited.

## 7. Provider Design

The flow is `External Provider → provider adapter → EgressIdentity V0.1`. The service depends on replaceable provider interfaces, and snapshots/UI never parse third-party JSON fields.

## 8. Public IP Provider

Selected authority: ipify `GET https://api64.ipify.org?format=json`. Its official documentation defines a JSON `ip` result and a universal IPv4/IPv6 endpoint. It requires no key for this endpoint. Only the whitelisted `ip` value survives normalization.

Official reference: <https://www.ipify.org/>

## 9. Geo Provider

Selected authority: ipapi.co `GET https://ipapi.co/{public-ip}/json/`. Its official API documents HTTPS JSON, IPv4/IPv6, city, region, country, ASN, and organization fields. Basic fields are available without sign-up for trial/testing; rate limits and structured errors remain possible. Only the current public egress IP is sent.

Official references: <https://ipapi.co/api/> and <https://ipapi.co/faq/>

## 10. Provider Study Alternatives

IPinfo documents dual-stack APIs and strong schemas, but current city/region services require a token. MaxMind GeoLite2 supports a future local database direction, but download/use requires account and license acceptance. Neither credential nor database is silently added. Random IP websites, HTML scraping, advertising pages, and anonymous undocumented APIs were rejected.

## 11. Privacy

The ipify request contains normal HTTPS request metadata and no application payload. The ipapi.co request contains only the current public IP in the path. Process lists, application names, remote connection lists, hostname, MAC, SSID, account, cookie, token, file, APEX directory, and device identifier are never sent.

## 12. HTTP Safety

Requests are GET-only HTTPS calls, accept JSON, reject redirects, cap responses at 64 KiB, and default to a five-second timeout. The initial three-second live threshold proved too aggressive on the actual Windows path, while five seconds remains a short bounded request. DNS, timeout, network, non-2xx, 429, malformed JSON, oversized response, invalid IP, and provider mismatch failures are normalized to bounded codes.

## 13. Cache

`EgressIdentityService` uses an in-memory TTL cache: five minutes fresh and one hour maximum stale by default. Fresh hits perform no request. Concurrent refreshes coalesce. Cache values are cloned on input/output, so callers cannot mutate stored evidence.

Freshness age is calculated from the external Provider observation time. Replacement-provider timestamps beyond the stale window or more than one minute in the future are rejected rather than made fresh by cache insertion.

## 14. Freshness

Freshness records state, age, and stale threshold. A successful refresh records provider observation time. An expired-but-usable value is explicitly `stale` and `stale_fallback`; it is never described as live.

## 15. Failure and Stale Fallback

Public-IP failure with no cache returns unavailable with a sanitized code. Geo failure after a valid public-IP observation returns public identity as available and Geo as unavailable. Failed refresh with usable old evidence returns stale evidence; beyond the stale window, old evidence is discarded.

## 16. Provenance

Normalized results preserve public `provider`, `source_type`, observation time, cache status, and optional `geo_provider_id`. Raw provider responses and internal exception messages do not enter the domain model.

## 17. Snapshot Integration

Public APIs are never bound to the regular DeviceNetworkSnapshot or Home Footer path. ApplicationNetworkSnapshot may consume an already cached identity through synchronous `peek()` only. Empty cache means no egress section; it never triggers network I/O while collecting CPU/RAM/process/connection data.

## 18. APEX Relation

The read model can display APEX runtime presence beside the current observed egress identity. `apex_egress_causality` is always `unknown` in V0.1. Running APEX does not prove the observed IP was produced by APEX; no APEX configuration or control operation occurs.

## 19. Domestic/Foreign Future Routing

V0.1 reports `route_kind: default` for an ordinary system-routed observation. It does not fabricate domestic and foreign exits. True dual-egress work must separately freeze targets, routing/proxy behavior, provider regions, and causality; `domestic_egress` and `foreign_egress` remain null.

## 20. Local GeoIP Future Plan

Bulk application remote-IP classification should use an approved local GeoIP database adapter (`LOCAL_GEO_PROVIDER_FUTURE`) instead of uploading every destination. 011 neither downloads nor installs a database. Licensing, updates, attribution, integrity, footprint, and privacy require a separate decision.

## 21. History Readiness

EgressIdentity is versioned, deterministic, serializable, timestamped, provenance-aware, and freshness-aware. A future history service can detect changes in public IP, country, city, ISP/ASN, and APEX state. V0.1 creates no database.

## 22. Deferred Capabilities

Application byte accounting remains `DEFERRED_WITH_EVIDENCE`; Network Top5 and domestic/foreign byte attribution remain deferred. This task does not change routes, DNS, system proxy, APEX, or application traffic.

## 23. Live Smoke Authorization

The smoke is designed to make exactly one ipify request and, after success, exactly one ipapi.co lookup containing that public IP. It prints only a masked IP plus normalized Geo/ISP/ASN fields. Execution requires explicit approval because it discloses the observed public IP to the Geo provider.
