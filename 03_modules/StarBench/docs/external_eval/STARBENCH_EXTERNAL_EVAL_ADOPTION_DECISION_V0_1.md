# StarBench External Eval Adoption Decision V0.1

## Decision status

- Audit: `NEXA-STARBENCH-THIRD-PARTY-EVAL-ASSET-AUDIT-001`
- Status: `PASS`
- Production integration: `NO`
- Candidate authority: `NO`
- Production source modified: `NO`
- Real model/API calls: `0`
- Credential reads: `0`
- Model API token cost: `0`
- Current authoritative StarBench baseline: `598/598 PASS`
- External validation state preserved: `SEALED_AWAITING_EXTERNAL_GOAL_EXECUTION`

The candidates fill bounded gaps, but none should replace StarBench's canonical
pipeline. KBF is the strongest identity-engine candidate behind a port; CompatBench
is a design reference for a StarBench-owned compatibility matrix; Promptfoo is a
future isolated external eval runner behind a port.

## Capability mapping

`Partial` means a candidate implements part of the capability but does not satisfy
StarBench's authority/provenance contract. `No authority` means an output may be
evidence only after StarBench admission.

| Capability | StarBench Existing | KBF | CompatBench | Promptfoo | Adoption Decision |
| --- | --- | --- | --- | --- | --- |
| Provider Invocation | Authoritative adapter and credential boundary; current real path is one-shot non-stream DeepSeek Chat Completions | Three protocol handlers and provider pinning | OpenAI-compatible HTTP client | Broad provider ecosystem | `ALREADY_SUPERSEDED_BY_STARBENCH` |
| RAW Result | Canonical V0.1 schema, harness, writer, admission, importer | Target result is identity-specific and not RAW_RESULT-equivalent | Per-case report omits StarBench authority chain | Per-call response can be converted only with exact provenance | `ALREADY_SUPERSEDED_BY_STARBENCH` |
| Canonical Evaluation | Canonical schema/store with source boundaries | Statistical identity evaluation only | Compatibility status/grade | Rich assertions and grading | `ALREADY_SUPERSEDED_BY_STARBENCH` |
| Model Identity Fingerprint | Gap: no black-box fingerprint engine | Core strength: reference/target probe fingerprint | No | No equivalent identity statistic | `ADAPT_BEHIND_PORT` |
| Statistical Identity Verdict | Gap | SAME/DIFF/UNDETERMINED/UNKNOWN with CP bound/binomial test | No | Assertion framework, not this verdict | `ADAPT_BEHIND_PORT` |
| Capability Benchmark | Tasks/suites/scoring/profiles/evidence sufficiency exist | Identity probes are not broad capability tasks | Narrow API behavior tests | Broad configurable evals | `ALREADY_SUPERSEDED_BY_STARBENCH` |
| API Compatibility | Partial: adapter contract and harness, no full matrix | Protocol-specific request support only | Core design value | Provider behavior exists but is not a focused matrix | `BORROW_DESIGN_ONLY` |
| Streaming Validation | Not established by current real adapter | No core streaming verdict | Chat SSE and streaming usage; declared Responses-stream gap | Provider-dependent streaming support | `BORROW_DESIGN_ONLY` |
| Tool Calling Validation | Not established by current real adapter | No | Auto/required/forced; no implemented parallel case | Rich provider-dependent support | `BORROW_DESIGN_ONLY` |
| Structured Output | Not established by current real adapter | No | JSON response format plus fallback/partial semantics | Assertions/provider options | `BORROW_DESIGN_ONLY` |
| Usage Validation | Nullable usage capture and throughput source semantics | Captures usage when returned | Non-stream and stream usage checks | Token usage/cost fields | `BORROW_DESIGN_ONLY` |
| Offline Re-evaluation | Import/evaluation/scoring can be offline; no identity reevaluator | Explicit evaluate-only identity path | Report comparison/scoring | Cached/recomputed assertions/eval | `ADAPT_BEHIND_PORT` |
| Reference Caching | Evidence stores and frozen hashes; no identity-reference cache contract | Shipped/cached reference probes; mutable/dual layouts | No material reference cache | Broad disk/fetch caching with incompatible secret-hash risk | `BORROW_DESIGN_ONLY` |
| Eval Assertions | Deterministic scorers and task rules | Identity statistic only | Fixed compatibility checks | Mature assertion engine/model graders | `ADAPT_BEHIND_PORT` |
| Model Comparison | Scores/profiles/decisions with official-evidence gates | Pairwise identity result | Provider comparison grade | Multi-provider comparison | `ALREADY_SUPERSEDED_BY_STARBENCH` |
| Red Team | Outside current core purpose | No | No | Mature red-team extensions | `DEFER` |
| Evidence / Provenance | Canonical admission, source class, integrity, evidence sufficiency | Useful fields, but file/path provenance is not canonical | Per-case request/response summaries | Rich execution/config metadata | `ALREADY_SUPERSEDED_BY_STARBENCH` |
| Evidence Seal | Existing Forecast/experiment/external validation seals and immutable lineage patterns | No StarBench-equivalent seal | No | No StarBench-equivalent seal | `ALREADY_SUPERSEDED_BY_STARBENCH` |
| Project Token Forecast | Mature work graph, Forecast/Actual, calibration, resource assessment | No | No | Eval token usage, not project forecast | `ALREADY_SUPERSEDED_BY_STARBENCH` |
| Budget-aware Test Planning | Project/resource preflight exists; adaptive API verification profiles are a gap | Cost-sensitive probe mechanics but unsafe defaults for StarBench | Test matrix exposes request multiplicity | Configurable evals and cache, no StarBench budget authority | `BORROW_DESIGN_ONLY` |

No row authorizes direct source reuse. The exact candidate-level decisions are:

- KBF: `ADAPT_BEHIND_PORT`
- CompatBench: `BORROW_DESIGN_ONLY` (`DESIGN_REFERENCE_ONLY`, not dependency)
- Promptfoo: `ADAPT_BEHIND_PORT`

## Authority boundary

### StarBench owns

- canonical task, provider, model, reference, run, and evidence identities;
- credential access, network admission, request/token/cost budgets, and stop gates;
- Provider Adapter contract and supported-capability declarations;
- RAW_RESULT, Canonical Evaluation, scoring, profile, decision, and result stores;
- external artifact validation, provenance, integrity, admission, and seals;
- evidence sufficiency and official/ranking eligibility;
- Forecast/Actual, historical calibration, pricing/entitlement snapshot consumption,
  and resource advisory; and
- adaptive verification profiles and the right to claim what each profile proves.

### StarBench does not reimplement

- KBF's HTTP/CLI/provider map, thinking-suppression machinery, probe generator, or
  numerical library implementation;
- CompatBench's runtime client, aggregate grade, or package lifecycle;
- Promptfoo's provider ecosystem, dataset runner, assertion/model-grader engine,
  red-team infrastructure, UI/database/CLI, script runner, or cache; and
- a second RAW_RESULT, evaluation, evidence, scoring, or seal authority.

## ADAPTIVE_TEST_BUDGET_V0_1

### Status and invariants

This is a non-executable design. No profile may run until its hard request/token
caps and evidence thresholds have been empirically calibrated and sealed. Numeric
caps are intentionally `TBD_BY_MEASUREMENT`; Forecast values, vendor marketing, and
another profile's measurements may not substitute for measurement.

Common hard invariants:

1. Every run binds a provider/model/endpoint identity, adapter version, test-profile
   version, reference hash, request cap, token cap, optional monetary cap, allowed
   host, retry cap, and no-fallback/provider-pin policy before credential access.
2. `max_requests` is a finite hard counter including retries, fallback attempts,
   thinking-suppression discovery, structured-output fallback, judges, and tool
   follow-ups. Hidden/background calls are forbidden.
3. `max_provider_tokens` covers observed input, cached input when separately exposed,
   and output/reasoning categories without inventing unknown splits. The preflight
   conservative reservation must fit the authorization before the first request.
4. Missing price never becomes zero cost. A monetary claim is `UNKNOWN`; the run may
   proceed only if a separately authorized request/token cap does not depend on
   price.
5. Cache hits and offline re-evaluation are never counted as fresh Provider evidence.
6. Fixture/mocked evidence can validate mechanics, not a real endpoint or model.
7. No profile automatically promotes a model, ranks providers, consumes entitlement,
   or changes routing.

### Profile definitions

| Profile | Purpose | Required evidence shape | Maximum request budget | Maximum Provider-token budget | Long-context policy | Output claim |
| --- | --- | --- | --- | --- | --- | --- |
| `QUICK` | Detect an obvious identity mismatch or visibly stripped endpoint | Sealed minimal discriminating identity subset plus basic chat/usage/error-shape checks that are supported by the target adapter | `TBD_BY_MEASUREMENT`; must be the smallest calibrated non-zero hard cap | `TBD_BY_MEASUREMENT` | Disabled unless the suspected defect specifically requires one calibrated short-to-medium step | Screening result only; never a definitive SAME claim unless the reduced profile has separately validated statistics |
| `STANDARD` | Identity plus core capability and basic compatibility | Calibrated identity subset; basic/system/multi-turn; applicable usage; and adapter-supported streaming/tools/structured-output core cases | `TBD_BY_MEASUREMENT`; greater than or equal to QUICK only after measured marginal value | `TBD_BY_MEASUREMENT` | One progressive tier only when unresolved and pre-authorized | Core verification with explicit untested/unsupported fields |
| `FULL` | Formal sealed official-reference versus target A/B | Complete versioned identity profile and all required API matrix capabilities applicable to the declared endpoint, with repeats and evidence coverage | `TBD_BY_MEASUREMENT`; explicit user/run authorization required | `TBD_BY_MEASUREMENT` | Progressive tiers; each tier admitted separately inside the same hard envelope | Full-profile result for the pinned scope only |
| `FORENSIC` | Investigate suspected mixed routing/model substitution | Stratified sealed probes across authorized time/provider pins/context tiers plus targeted compatibility repetitions; every stratum separately attributable | `TBD_BY_MEASUREMENT`; never selected automatically | `TBD_BY_MEASUREMENT` | Progressive and stratified; stop as soon as the hypothesis is resolved or budget is exhausted | Forensic evidence for the investigated hypothesis, not a general ranking |

The unresolved caps are an execution blocker, not permission to run without a cap.
Calibration must measure actual call multiplication and token distribution for the
exact engine/profile/version using offline fixtures first and a later separately
authorized minimal real campaign.

### Token budget gate

Before credential access, compute a conservative reservation for every planned
Provider call:

`reserved = known_input_tokens + declared_max_output_tokens + declared_reasoning_reserve`

If tokenizer/model semantics are not trustworthy, use a sealed upper-bound method
and mark the estimate source. Admit only if the sum of reservations plus all allowed
retries/fallbacks fits both profile and user-authorized caps. If any hidden call,
unbounded output, unbounded retry, or unresolved multiplier exists, status is
`BLOCKED_BUDGET_UNBOUNDED`.

After each call, reconcile observed usage without fabricating missing components,
release only proven unused reservation, and evaluate whether the remaining planned
evidence can fit. Budget exhaustion produces a partial/incomplete result, never an
implicit cap increase.

### Early stop

Stop without consuming the remaining allowance when any sealed condition is met:

- a statistically valid `DIFF` or other terminal identity verdict is reached for the
  active profile;
- a required endpoint capability fails conclusively and later cases cannot change
  the profile-level conclusion;
- evidence sufficiency for the authorized claim is reached and remaining tests add
  no required coverage;
- a provider/model/pin response proves the target scope differs from the authorized
  scope; or
- an offline re-evaluation resolves the question without a new call.

A reduced subset may not inherit `SAME` confidence from KBF's full profile. Early
stop rules and their error properties must be calibrated and versioned.

### Failure stop

Immediately stop on credential/auth failure, unexpected host/redirect, provider pin
failure or fallback, adapter/model mismatch, secret/redaction failure, unknown
response schema that cannot be safely bounded, repeated parse failure at the sealed
retry cap, response-size limit, time limit, request/token/cost exhaustion, or loss of
provenance. Never rotate/read another credential, change provider, or silently retry
with a different protocol.

### Evidence sufficiency

Each profile owns a versioned contract defining required probe groups, distinct
tasks, repeats/strata, successful/partial/failed maxima, coverage, statistical
method/level/alpha, reference self-test coverage/freshness, required compatibility
features, and permissible unknowns. Sufficiency requires both mathematical criteria
and official source/provenance eligibility. `SKIPPED` cannot disappear from the
denominator when the feature is required. An unsupported feature is a recorded
finding, not a passing omission.

### Cached reference reuse

A cached reference is reusable only when its engine/version, schema/profile version,
reference provider/model/endpoint/provider-pin identities, probe identities, config,
license/provenance, content hash, self-test status, and freshness policy match the
run. It is immutable after sealing. A changed self-test creates a new reference
identity. Target responses, Promptfoo cache hits, or secret-derived cache keys cannot
serve as fresh references.

### Offline re-evaluation

Offline re-evaluation is the default response to a changed statistical rule or
parser when raw external evidence already exists. It makes zero Provider calls,
retains the original reference/target bundle, records evaluator code/config/hash,
emits a new Canonical Evaluation identity and lineage, and never rewrites RAW_RESULT
or the previous verdict. If required raw facts are absent, return insufficient
evidence rather than fetching them automatically.

### Progressive long-context test

Long-context testing begins disabled. When explicitly in scope, advance through
sealed context tiers from shortest to longest only if the previous tier succeeds,
the unresolved hypothesis needs the next tier, the remaining conservative token
reservation fits, and provenance remains complete. Stop on first conclusive failure,
evidence sufficiency, or budget pressure. Full advertised context is never the
default and context length is not inferred from output quality alone.

## Adoption roadmap

### Phase A — Identity port contract (recommended next node)

Create a StarBench-owned, offline-only `External Identity Engine Port V0.1` contract
and KBF fixture adapter specification. Define immutable input/reference identity,
normalized verdict facts, raw external artifact reference, provenance, budget facts,
and Canonical Evaluation mapping. Test only frozen synthetic bundles; do not install
or run KBF in production and do not access a Provider.

Acceptance: dual-layout KBF fixtures normalize deterministically; malformed,
mutable, cache-hit, secret-shaped, missing-self-test, low-coverage, and license/
provenance-incomplete bundles are rejected or downgraded; zero RAW_RESULT is invented.

### Phase B — StarBench API Compatibility Matrix V0.1

Borrow CompatBench's useful cases but define a StarBench-owned, versioned matrix.
Add explicit required/optional/unsupported/unknown/not-executed semantics, request
multiplicity, feature capability declarations, fixture parser tests, redaction, and
per-case evidence mapping. Include the gaps found at the pinned commit: Responses
streaming, parallel tools, auth error, and rate-limit error.

Acceptance: offline fixtures prove construction/parsing/status/evidence mechanics;
reports never claim real endpoint compatibility.

### Phase C — External Eval Port V0.1

Define a generic immutable runner/result-bundle contract and validate a synthetic
Promptfoo-shaped bundle. Keep Promptfoo outside StarBench runtime. Disable/reject
secret-derived cache fingerprints, arbitrary script execution, aggregate-to-raw
promotion, and cached-result-as-fresh behavior.

Acceptance: one attributable Provider observation can map through admission;
assertions/aggregates map only to evaluation/evidence; unknowns remain unknown; all
external content is bounded and secret-scanned.

### Phase D — Adaptive budget measurement and later controlled activation

Measure fixture-level call multiplication first. Any real calibration is a separate
goal requiring explicit provider/model/credential/network/request/token/cost
authorization. Seal measured caps and evidence thresholds before enabling profiles.
No default full run and no automatic FORENSIC selection.

## Risks

- KBF's unversioned dual reference layouts and documentation/code drift can make an
  adapter silently change statistical or cost behavior.
- Reduced KBF probe sets do not automatically preserve the full set's false-positive
  properties; profile statistics need independent validation.
- CompatBench's declared/implemented matrix drift and skip-denominator scoring can
  overstate compatibility.
- Promptfoo's very large runtime surface, arbitrary script provider, cache lifecycle,
  secret-derived cache fingerprint, public demo key material, and nested licenses
  require isolation and file-level review.
- External runners can produce aggregate results that look raw. Admission must reject
  ambiguous call boundaries, cache hits, missing provider identity, and missing
  provenance.
- All request/token caps are currently `TBD_BY_MEASUREMENT`; therefore no adaptive
  profile is execution-ready.

## Final architecture judgment

`WHAT_STARBENCH_SHOULD_OWN`: canonical identities, Provider/network/budget authority,
RAW_RESULT, Evaluation, evidence/provenance/integrity/seals, profile sufficiency,
Forecast/Actual, pricing/entitlement consumption, and resource advisory.

`WHAT_STARBENCH_SHOULD_NOT_REIMPLEMENT`: KBF's execution internals, CompatBench's
runtime/grade, or Promptfoo's provider/assertion/red-team/cache/script-runner
ecosystems; integrate bounded external engines only through versioned ports.
