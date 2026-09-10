# NEXA Campus Cross-Subnet Endpoint Rendezvous V0.1 — Hold Record

## Control decision

- Task: `NEXA-CAMPUS-CROSS-SUBNET-ENDPOINT-RENDEZVOUS-V0_1-001`
- Decision: `HOLD / PUBLIC_DEPLOYMENT_NOT_AUTHORIZED`
- Rendezvous code state: `SEALED / READY_FOR_FUTURE_DEPLOYMENT`
- Public deployment state: `NOT_DEPLOYED`
- Recorded on: 2026-08-31 (Asia/Shanghai)

No Core or Mobile source was changed during this hold operation. No Relay, server, DNS, public port, public certificate, firewall, or route was deployed or modified.

## Frozen verification baseline

- Mobile full regression: `400/400 PASS`
- Mobile debug APK build: `PASS`
- Core full regression: `2771 PASS / 0 FAIL / 2 SKIP`
- Core lint: `PASS`
- Public deployment executed: `NO`

These are the completed implementation baselines. This hold operation did not rerun or replace them.

## No-Relay configuration behavior

The sealed implementation is dormant and fail-soft when no public Relay is configured:

- Desktop `mobileRelayEnvironmentConfiguration()` returns `null` when `NEXA_MOBILE_RELAY_HOST` is absent.
- Desktop does not create Relay transports or schedule Relay retry work when that configuration is `null`.
- Mobile parses empty Relay host/server-name resources as `NOT_CONFIGURED` and creates no `MobileRelayRouteBroker` or Relay route provider.
- A Mobile endpoint-rendezvous lookup without a Relay provider returns `RENDEZVOUS_NOT_CONFIGURED` as a bounded temporary result. AUTO retains the last real local/routed network result and does not manufacture a public route.
- Existing same-LAN discovery, known trusted candidates, Direct, Reverse, and available Campus Routed behavior remain active independently of public Relay configuration.
- The Desktop endpoint handler remains credential-bound and HTTPS-only; the absence of a public Relay does not expose it publicly.

Therefore normal runtime does not require a public Relay. Only the cross-subnet rendezvous capability—after local, reverse, and known routed candidates are unavailable—remains dormant until an explicitly authorized Relay deployment is configured.

## Wake-up condition

Resume only after an explicit control decision authorizes public Rendezvous deployment and supplies an approved deployment target, DNS/certificate ownership, and network/security change scope. Until then, this implementation remains sealed and no further public Rendezvous construction or acceptance is authorized.
