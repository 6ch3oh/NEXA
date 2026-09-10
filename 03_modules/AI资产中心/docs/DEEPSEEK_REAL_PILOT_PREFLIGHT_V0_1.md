# DeepSeek Real Pilot Preflight V0.1

Status: `DEEPSEEK_REAL_PILOT_PREFLIGHT_READY = YES`

Final gate: `WAITING_USER_REAL_API_AUTHORIZATION`

## Safety state

- Credential configured: **NO**
- Credential safe path: **EXPLICIT_NO**
- Real API calls: **0**
- Real cost: **0**
- Secret exposure: **NO**
- HTTP transport implementation: none

The pure preflight boundary accepts only a future non-secret availability
attestation: configured, safe mechanism available, runtime access ready, and an
optional opaque mechanism name. It never inspects environment variables,
credential stores, or secret text.

## Future authorized two-request pilot

1. `GET https://api.deepseek.com/user/balance`
   - Purpose: credential/account availability and official Balance.
   - Failure or `is_available=false` stops before request 2.
2. `POST https://api.deepseek.com/chat/completions`
   - Model: `deepseek-v4-flash`
   - Payload: `{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"ping"}],"thinking":{"type":"disabled"},"max_tokens":1,"stream":false}`
   - Purpose: provider/model identity and prompt/cache/output/total usage.

Shared constraints: HTTP Bearer authentication, timeout `30s` per request,
planned requests `2`, retry `0`, maximum generated tokens `1`, and stop on the
first failure.

Maximum estimated cost is `UNKNOWN`: precise prompt tokens and cache hit/miss
classification are returned only after execution. Preflight does not present a
character approximation as a reliable maximum.

## Capability paths

- Official Pricing: READY via official DeepSeek pricing documentation.
- Balance: READY via `/user/balance`.
- Usage: READY via Chat Completion `usage`.
- Entitlement/quota/reset: UNKNOWN; no independent official endpoint is proven.
- Attribution: local project/module/task/run; missing identity is UNATTRIBUTED.
- Existing Canonical Adapter, Atomic Intake, SQLite V3, Authorities, and Resource
  Overview are reused; synthetic data is never presented as a real result.

Execution remains denied unless the user again authorizes exactly two requests,
accepts the UNKNOWN maximum cost, endpoint and payload values remain unchanged,
retry remains zero, secret logging remains disabled, and safe runtime credential
availability is proven.
