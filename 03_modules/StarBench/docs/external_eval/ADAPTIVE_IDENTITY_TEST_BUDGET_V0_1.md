# Adaptive Identity Test Budget V0.1

Status: `LOCAL_CONTRACT_AND_SYNTHETIC_ACCEPTANCE`

## Boundary

```text
User-selected mode -> Adaptive Planner -> StarBench Budget Contract
  -> Existing External Identity Runner -> Existing External Identity Port
  -> Canonical Identity Observation
```

The Planner can suggest escalation but cannot execute it. FULL requires an
explicit user selection. FORENSIC requires explicit authorization and remains
contract-only in V0.1. REAL_PROVIDER remains disabled.

## Modes

| Mode | Request ceiling | Evidence target | Escalation |
| --- | ---: | --- | --- |
| QUICK | 4 | SUFFICIENT_FOR_SCREENING | Suggest STANDARD only |
| STANDARD | 8 | SUFFICIENT_FOR_STANDARD_ASSESSMENT | Suggest FULL only |
| FULL | 16 | SUFFICIENT_FOR_FULL_ASSESSMENT | Explicit selection required |
| FORENSIC | 16 | Contract reservation only | Explicit authorization required |

Request ceilings are execution-safety limits within the existing Runner's
audited 1–16 range. They are not Token estimates. All real input, output,
reasoning, total Token, and monetary ceilings remain
`TBD_BY_MEASUREMENT`. Numeric Token or money limits are admitted only with
`TEST_FIXTURE` provenance during this offline acceptance.

## Accounting and early stop

Only explicitly supplied usage is recorded. Total-only usage preserves every
component as null. Missing usage stays UNKNOWN. Malformed or arithmetically
conflicting usage fails closed. Request, explicit synthetic Token, and explicit
synthetic money limits stop at the ceiling; insufficient evidence remains
INSUFFICIENT.

Execution stops for an unavailable endpoint, incompatible format, inconsistent
identity evidence, invalid artifact, budget violation, a reached evidence
target, or a failed previous progressive long-context stage. Budget is never
spent merely because it is available.

## Reference, context, and cost

A cached reference is reusable only when model, engine, source commit, engine
version, probe version, raw hash, freshness, trust, and provenance all match.
QUICK excludes long context. Other modes require a model capability contract
and progress from its declared smaller stages; the first failure stops later
stages. No universal 8K/32K/64K/128K ladder is hard-coded.

Resolved price calculation delegates to the existing consumer of
`03-01 AI资产成本` snapshots. Missing pricing withholds money without blocking
Token accounting. Subscription/quota usage always retains monetary cost as
null and is never converted using API Token prices.

V0.1 makes zero real Provider calls, reads zero Credentials, incurs zero model
API Token cost, and does not implement real mixed-routing or forensic sampling.
