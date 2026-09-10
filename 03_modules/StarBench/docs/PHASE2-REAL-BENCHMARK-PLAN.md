# StarBench Phase-2 Real Benchmark Coverage & Evidence Plan V0.1

Status: `PLANNED_NOT_AUTHORIZED`  
Task: `NEXA-SB-201`  
Network/API execution: none

## Decision summary

StarBench may move from abstention to a real Scenario recommendation only after at least two exact provider/model candidates have been measured on the same three-task Scenario surface, twice per task. That is six real observations per candidate and twelve per Scenario comparison. Each candidate must have all three distinct Task Scores, full required coverage, at least five successful observations, `HIGH` confidence, complete provenance, clean Secret status, V0.1 compatibility, and balanced comparison inputs.

The full three-Scenario ranking floor is stricter: nine distinct tasks and eighteen real observations per candidate, thirty-six observations for two candidates. Meeting one Scenario recommendation gate does not activate global ranking.

## Contract relationship

This plan is a new Phase-2 policy layer. It references but does not modify the Phase-1 V0.1 contracts. `contracts/phase1-v0.1-manifest.json` remains `FROZEN`; existing fixture Scenario definitions remain fixtures and are not promoted into real definitions.

Evidence units are deliberately distinct:

- A task is one versioned Benchmark Task and Prompt identity.
- A run observation is one admitted real provider execution for one candidate and task.
- A Scenario evidence count is the number of distinct required tasks with valid Task Scores, not the number of repeated runs.
- A candidate is one exact `provider + model` pair.

Real Benchmark Campaign V0.1 uses the lifecycle `DRAFT → REVIEWED → AUTHORIZED → RUNNING → STOPPED/COMPLETED → SEALED`. Execution is allowed only from `AUTHORIZED`. Before authorization, an immutable campaign snapshot must fix the campaign ID, candidate and Scenario allowlists, Task and Prompt identities, evaluation methods, parameters, request/cost limits, retries, and stop policy. The current campaign state is `DRAFT / NOT_AUTHORIZED` with execution disabled.

## Benchmark coverage matrix

| Scenario | Minimum task diversity | Distinct tasks | Runs/task/candidate | Observations/candidate | Successful observations | Required coverage | Evidence count | Confidence |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Coding | code generation; bug fix; instruction constraints | 3 | 2 | 6 | 5 | 1.0 | 3 | HIGH |
| Planning | multi-constraint; dependency ordering; resource/risk handling | 3 | 2 | 6 | 5 | 1.0 | 3 | HIGH |
| Instruction Following | format; multi-condition; prohibited-item compliance | 3 | 2 | 6 | 5 | 1.0 | 3 | HIGH |

Each diversity class contributes one task. This is the smallest set that covers the user-required breadth and reaches the existing Profile rule's `HIGH` confidence floor of at least three distinct evidence items at high coverage. One activation task or three variants of the same pattern do not satisfy diversity.

## Minimum real Benchmark set

Coding:

1. Generate a small function under a fixed interface and forbidden-operation constraints; score with bounded local tests and rule checks.
2. Repair a localized bug without changing the public contract; score regression and non-regression tests.
3. Produce a constrained code change with required and forbidden elements; score deterministic rule compliance.

Planning:

1. Produce a structured plan satisfying multiple hard constraints.
2. Order dependent steps while preserving prerequisites and stop conditions.
3. Allocate bounded resources and cover declared risks with explicit mitigations.

Instruction Following:

1. Return a short answer in an exact machine-checkable format.
2. Satisfy multiple simultaneous content and structure conditions.
3. Meet positive requirements while omitting explicitly prohibited content.

These are nine task definitions, not thirty-six different questions. Repetition produces thirty-six run observations for two candidates across all three Scenarios.

## Evidence sufficiency matrix

| Evidence state | Required interpretation | Decision behavior |
|---|---|---|
| One activation RAW_RESULT only | Pipeline intake evidence | `INSUFFICIENT_EVIDENCE`; no capability recommendation |
| Fewer than 3 distinct tasks for a Scenario | Missing diversity or Profile evidence | `INSUFFICIENT_EVIDENCE` |
| At least 3 tasks but fewer than 5/6 successful observations | Unstable or incomplete evidence | `INSUFFICIENT_EVIDENCE` |
| One candidate only | Candidate capability observation, not comparison | `ABSTAINED` for comparative recommendation |
| Candidate run/task surfaces differ | Incomparable evidence | `ABSTAINED` |
| All candidates fail hard constraints | No eligible candidate | `NO_ELIGIBLE_CANDIDATE` |
| Two balanced candidates pass all Scenario evidence and integrity gates | Scenario comparison is eligible | `RECOMMENDED` only with a unique winner and complete evidence refs |
| All three Scenarios pass for the same candidate set | Ranking evidence floor met | Ranking review may proceed; it is not automatically asserted |

## Repeat and stability requirement

A deterministic task may be scored after one run for preliminary inspection, but it cannot activate a formal recommendation. Formal Scenario evidence requires two runs for every task and candidate.

- Success rate is successful admitted runs divided by all attempted runs. PARTIAL, FAILED, and timeout results remain in the denominator.
- At most one combined PARTIAL or FAILED result is allowed among six observations per candidate and Scenario.
- Every required task must still have at least one successful observation.
- Numeric repeated scores report population variance; disagreement is retained and disclosed.
- Two runs are an instability screen, not a statistically strong performance estimate.
- Latency uses at least five successful observations per candidate and Scenario.

## Candidate comparison rules

Candidate identity is the exact pair `provider + model`. The same underlying model through two Providers remains two Candidates because latency, availability, billing, and rate limits can differ.

Fair comparison requires identical Benchmark Task identity, Prompt identity/version, evaluation method, required metrics, contract version, run count, sampling policy, and declared parameters. `temperature`, thinking mode, and stream mode must match. `max_tokens` must match or have a predeclared provider-limit justification; any truncation risk makes the affected task incomparable. Candidate runs are interleaved by task and run index within the same authorized campaign window.

Model A with ten tasks and Model B with two tasks cannot be compared. Unbalanced evidence results in `ABSTAINED`, not extrapolation or imputation.

## New candidate entry standard

A new model is always registered as an exact provider/model Candidate. Its Provider Adapter contract review must pass, Phase-1 intake compatibility must be `V0_1_COMPATIBLE`, and Admission/provenance prechecks must be complete before comparison. It must independently run the same immutable Task, Prompt, evaluation, parameter, and repetition surface as existing candidates. Historical unmatched observations remain observation-only; missing comparable evidence requires a separate authorized request budget and can never be backfilled with fixtures. The Candidate enters a Scenario recommendation or ranking only after satisfying every evidence and parity gate for that scope.

## Partial and missing evidence

PARTIAL and FAILED results are preserved for reliability evidence but do not count as successful capability observations. Unknown values remain `null`; they are never synthesized as zero. More than one combined non-success among six observations, any missing diversity class, incomplete required provenance, mixed sources, or fixture evidence forces `INSUFFICIENT_EVIDENCE` or `ABSTAINED` according to the reason.

## Cost evidence

| Source | Classification | Formal cost comparison | Allowed claim |
|---|---|---|---|
| billing export | REAL_SPEND_VERIFIED | Yes, with attribution and currency | Verified billed spend in the declared window |
| provider reported | OBSERVED_PROVIDER_COST | Yes, with request/usage reference | Provider-observed cost |
| locally calculated estimate | ESTIMATE_ONLY | No | Explicit estimate only |
| official price estimate | ESTIMATE_ONLY | No | Explicit estimate only |
| unknown | UNKNOWN | No | No cost claim |

When cost is UNKNOWN, StarBench may issue a capability-only recommendation only if cost hard gates and cost preference weights are disabled. It must not claim the winner is cheapest or most cost-efficient. Estimates never become provider-reported or billed cost.

## Latency evidence

Single-request latency is an observation, not a stable performance conclusion. For a Scenario comparison, each candidate needs at least five successful latency observations. Median is primary; mean, min, max, interquartile range, and coefficient of variation are diagnostic. FAILED and timeout requests are excluded from latency distribution statistics but remain in reliability rates. Successful observations are not removed as outliers in V0.1.

## REAL_RECOMMENDATION_READY conditions

For at least one named Scenario, every condition below must hold:

1. Two or more exact provider/model candidates.
2. Three distinct required tasks and six real observations per candidate.
3. At least five successful observations per candidate and evidence for every task.
4. Coverage `1.0`, evidence count `3`, confidence `HIGH`, and all required metrics.
5. Counted results are `RAW_RESULT/PROVIDER_EXECUTION`, Admission is `ADMITTED`, provenance is `COMPLETE`, Secret status is `CLEAN`, and compatibility is `V0_1_COMPATIBLE`.
6. No `TEST_FIXTURE`, `LEGACY_SUMMARY`, mixed source, or imputed missing value.
7. Candidate evidence surfaces and parameters pass parity rules.
8. Recommendation status is `RECOMMENDED`, the winner is non-null and unique, and evidence references are complete.

The rule `real_raw_result_count > 0` is explicitly insufficient.

## REAL_MODEL_RANKING_READY conditions

Ranking is stricter than Scenario recommendation. The same candidate set must pass the complete evidence gate in Coding, Planning, and Instruction Following. Each candidate therefore needs nine distinct tasks and eighteen real observations; two candidates need at least thirty-six observations. Scenario weights and ranking scope must be declared before aggregation, and unknown dimensions must be excluded with explicit claim limits. A recommendation in one Scenario can coexist with `REAL_MODEL_RANKING_READY = false`.

## Abstain rules

- `NO_ELIGIBLE_CANDIDATE`: all candidates fail an explicit hard constraint or allow/deny rule.
- `INSUFFICIENT_EVIDENCE`: candidates exist, but task diversity, run success, coverage, metrics, evidence count, repetition, or confidence is insufficient.
- `ABSTAINED`: required values are unknown, candidate evidence is incomparable/unbalanced, source classes are mixed, integrity is ambiguous, or policy explicitly requires abstention.
- `RECOMMENDED`: all hard, evidence, safety, provenance, compatibility, parity, and uniqueness conditions pass.

StarBench never has to choose a winner.

## Benchmark budget contract

The current next campaign has `budget_status = NOT_AUTHORIZED`. Its required data fields are `max_requests`, `max_estimated_cost`, `currency`, `allowed_models`, `allowed_providers`, `allowed_scenarios`, `stop_on_first_failure`, and `retry_budget`. Current limits and allowlists are null/empty and confer no permission. A future filled record remains a plan until separate explicit authorization moves a versioned Campaign instance into `AUTHORIZED`.

The mathematical minimum for a full two-candidate campaign is thirty-six requests. This number is a planning floor, not an authorized budget.

## Activation task classification

`deepseek-real-activation-instruction-v0.1` is `PIPELINE_ACTIVATION_EVIDENCE`. It counts toward verified real-result intake, but not Scenario capability coverage, recommendation evidence, or ranking evidence. The existing Task Score `1.0` has no broader capability meaning.

## Phase-2 execution order

0. Obtain a separate campaign authorization with immutable task/prompt snapshots, exact candidate allowlists, hard request/cost limits, and retry policy. Stop if absent.
1. Run the paired Instruction Following minimum Suite for both candidates, interleaved: twelve planned requests.
2. Perform a zero-network evidence review. Stop on any safety, provenance, parity, stability, or coverage failure.
3. Run the paired Coding minimum Suite: twelve planned requests.
4. Run the paired Planning minimum Suite: twelve planned requests.
5. Perform Scenario recommendation and global ranking readiness reviews without filling gaps from fixtures or unapproved requests.

This order obtains the cheapest deterministic Scenario comparison first, offers an early stop after twelve requests, and adds higher-complexity evidence only when preceding gates pass.

## Current conclusion

StarBench now has enough contract detail to design a separately authorized Phase-2 campaign, but no campaign is authorized by this document. Current flags remain `REAL_RECOMMENDATION_READY = false` and `REAL_MODEL_RANKING_READY = false`.
