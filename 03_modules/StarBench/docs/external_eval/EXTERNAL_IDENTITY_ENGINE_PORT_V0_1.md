# StarBench External Identity Engine Port V0.1

## Boundary

```text
KBF native evidence (untrusted external evidence)
  -> KBF Offline Adapter
  -> External Identity Engine Port V0.1
  -> StarBench Canonical Identity Observation V0.1
  -> existing StarBench provenance and integrity conventions
```

KBF remains `EXTERNAL_IDENTITY_ENGINE / READ_ONLY_REFERENCE / NOT_PRODUCTION`.
StarBench owns the canonical observation and is the only authority introduced by this Port.
The Port accepts JSON text plus caller-supplied immutable SHA-256 authorities. It never accepts an
executable, command, URL to fetch, Provider configuration, Credential, or path to open.

Pinned KBF source: `b789b4b7abe119e28ec6260142564b2189ff5449`.

## Supported KBF formats

- `KBF_LEGACY_CLOZE_CONSENSUS`: every probe carries `cloze_consensus`; richer generation metadata may be present.
- `KBF_SLIM_VALUE`: every probe carries `value`; slimmer generated-header metadata may be present.

Mixed probes, probes carrying both fields, and probes carrying neither field fail closed. Extra KBF
fields are excluded from canonical meaning, remain covered by the raw artifact hash, and produce an
explicit warning. Source-format identity remains in provenance; absent source information is never
fabricated.

## Canonical semantics

| KBF source verdict | StarBench normalized verdict | Sufficiency |
|---|---|---|
| `SAME` | `CONSISTENT_WITH_REFERENCE` | `SUFFICIENT` |
| `DIFF` | `INCONSISTENT_WITH_REFERENCE` | `SUFFICIENT` |
| `UNDETERMINED` | `INSUFFICIENT_EVIDENCE` | `INSUFFICIENT` |
| `UNKNOWN` | `INSUFFICIENT_EVIDENCE` | `INSUFFICIENT` |

`CONSISTENT_WITH_REFERENCE` means only that the target behavior is consistent with the named
reference under the pinned KBF probes and statistical rule. It is not evidence that the target is an
official model. Every observation fixes `officiality_inference = NOT_ALLOWED`; the contract contains
no Boolean official-model claim.

## Integrity and validation

The adapter reuses StarBench stable canonical hashing for `observation_id` and standard SHA-256 over
the exact UTF-8 artifact bytes for raw/reference integrity. Both expected hashes are mandatory and a
mismatch rejects admission. It also reconciles probe vectors, answered/correct/error counts,
coverage, reference self-test facts, the pinned `alpha = 0.05` verdict rule, timestamp, protocol,
reference path, model claims, and the pinned source commit.

All input is `UNTRUSTED_EXTERNAL_EVIDENCE`. Malformed JSON, non-finite values, unsafe traversal
references, unknown verdicts, mixed formats, sensitive fields, inconsistent aggregates, invalid
probabilities, and incomplete provenance fail closed. No fixture content is executed.

## V0.1 exclusions

- No KBF subprocess or runner.
- No Provider/API/network/Credential access.
- No conversion into `RAW_RESULT` or a second Evidence Store.
- No claim of officiality.
- No Promptfoo or CompatBench integration.
- No Production, Shadow, Conditional Estimator, Forecast, Seal, or Actual mutation.
