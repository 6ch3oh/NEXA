# KBF Adoption Audit

## Fixed subject

- Repository: `https://github.com/Ooo0ption/KBF.git`
- Commit: `b789b4b7abe119e28ec6260142564b2189ff5449`
- License: Apache License 2.0 (`Apache-2.0`)
- Candidate status: `READ_ONLY_REFERENCE`, `NOT_PRODUCTION`
- Code/probes executed: `NO`

## Architectural finding

KBF is a compact black-box identity-testing engine. It compares a target API's
answers against a previously generated reference probe set, measures target error
against the reference consensus, accounts for the reference model's own self-error,
and emits `SAME`, `DIFF`, `UNDETERMINED`, or `UNKNOWN`.

The current implementation supports `openai-chat`, `openai-responses`, and
`anthropic-messages` protocol handlers. It can pin an OpenRouter provider by sending
an ordered provider selection with fallbacks disabled. These are execution details,
not stable StarBench contracts.

## Reference and target records

The documentation defines required reference fields (`reference_model`, `probes`,
`self_error`, `target_results`) and a target result containing reference/target
identities, reference path, test configuration, returned values, match vector,
correct/total counts, Hamming/error rate, usage, self-test coverage, Clopper-Pearson
upper bound, binomial p-value, and verdict.

The data is semantically documented but is not a formally versioned JSON Schema.
The reader accepts both a richer legacy probe layout and a slimmer layout, and
self-test results may be appended to the reference artifact. Therefore the format is
not stable enough to consume directly as a StarBench canonical contract. A future
adapter must validate a pinned KBF version, hash the immutable input, normalize both
layouts, and preserve the original artifact as external provenance.

## Statistical verdict

At this commit, the evaluator:

- returns `UNKNOWN` when the required reference self-test is absent;
- returns `UNDETERMINED` when self-test coverage is below its configured minimum
  (default `0.5`);
- calculates a 99% Clopper-Pearson upper bound for reference self-error;
- applies a one-sided binomial survival test to target errors; and
- returns `DIFF` below alpha `0.05`, otherwise `SAME`.

The implementation comments make a combined false-positive claim. That claim was
not independently validated in this audit and must not become a StarBench guarantee
without statistical review and fixture-based conformance tests.

## Offline re-evaluation

KBF's evaluate-only path can recompute a verdict from an existing reference and
target result without a Provider call. This is suitable for a future external
identity engine behind a port. Its normalized verdict and statistical facts may
enter StarBench as Canonical Evaluation/Evidence only after schema, provenance,
integrity, and admission checks. A KBF result is not automatically a StarBench
`RAW_RESULT`; only individually attributable observed Provider executions can be
considered for RAW_RESULT conversion.

## Cost and execution controls

The bundled reference sets contain roughly 105–681 probes, and generation defaults
to at least 100 candidates. Identity testing can therefore be request/token
intensive. Thinking-suppression discovery itself may send probe batches and retry
variants. The README describes one fallback multiplier while current code defines a
different multiplier (`50`), which is documentation/code drift. The optional
thinking fallback is off by default, but enabling it can materially expand cost.

Conclusion: the default/full probe behavior is too costly to become StarBench's
default verification path. Exact request and token caps remain
`TBD_BY_MEASUREMENT`; StarBench must impose its own preflight authorization, hard
budget, early-stop, and evidence-sufficiency gates.

## Eight required judgments

1. **Independent External Identity Engine:** yes, conditionally. Use a pinned,
   sandboxed process/file boundary; do not designate it as a StarBench authority.
2. **Adapter without broad source copying:** yes. A narrow request-bundle/result-file
   port is sufficient.
3. **Stable reference format:** no, not canonical as-is. It is documented but
   unversioned and dual-layout; adapter normalization and immutable hashing are
   required.
4. **Offline re-evaluation into Evidence Pipeline:** yes, after StarBench admission,
   provenance, contract validation, and sealing. Preserve original inputs and emit a
   new evaluation identity; never rewrite raw evidence.
5. **Default cost:** potentially high relative to a quick verification. It must not
   run implicitly or without an explicit measured budget.
6. **Quick/Standard/Full/Forensic:** feasible as StarBench-owned profiles. Statistical
   meaning must be validated per profile; no unmeasured reduced probe set may inherit
   the full test's error guarantees.
7. **Concepts StarBench should canonicalize:** external engine/version identity;
   reference identity/hash/provenance/provider pin; probe schema/profile/version;
   observed values/match vector; target and self-test coverage; error counts/rates;
   confidence method/level; bound and p-value; verdict/reason; usage; protocol;
   execution/evidence references; and budget/early-stop facts.
8. **Details that must not leak into core:** CLI flags/config, HTTP library and
   provider payload construction, request retries, thinking-suppression discovery,
   SciPy-specific implementation, raw probe generator, environment-variable lookup,
   provider registry, and KBF's mutable file layout.

## Profile implications

KBF can supply the identity component of `QUICK`, `STANDARD`, `FULL`, and
`FORENSIC`, but StarBench owns those profile definitions. `QUICK` must use a measured
minimal discriminating subset and may only claim the validated confidence of that
subset. `STANDARD` adds core compatibility evidence. `FULL` uses sealed reference
and target A/B coverage. `FORENSIC` permits stratified repetitions and progressive
context only after explicit authorization.

## Decision

Overall decision: `ADAPT_BEHIND_PORT`.

Do not copy KBF wholesale. First build a no-network adapter contract and offline
fixture conformance test; only a later separately authorized integration may execute
the external engine.
