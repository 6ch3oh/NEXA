# Promptfoo Adoption Audit

## Fixed subject

- Repository: `https://github.com/promptfoo/promptfoo.git`
- Commit: `127d90534b9c1b1ba4554f007dd4b5fd2c8bf1b4`
- Package version: `0.122.0`
- Runtime metadata: Node.js `>=22.22.0`
- License: root MIT (`MIT`), with nested attribution/license material in a red-team
  provider subtree
- Candidate status: `READ_ONLY_REFERENCE`, `NOT_PRODUCTION`
- Eval/providers executed: `NO`

## Architectural finding

Promptfoo is a mature, broad external evaluation system with a large provider
ecosystem, dataset/test-case configuration, assertions, scoring, comparison,
caching, persisted result lifecycle, CLI/library interfaces, and red-team
extensions. Its `ApiProvider` boundary returns output, error, latency, cost, token
usage, metadata/HTTP facts, and cache state. Evaluation rows attach provider, prompt,
variables, response, pass/score/reason, named scores, latency, cost, and token usage.

That breadth makes Promptfoo valuable as a future external runner, but unsuitable as
a StarBench runtime dependency or code-copy source. StarBench would otherwise gain a
second provider ecosystem, assertion authority, evaluation store, and red-team
infrastructure.

## Correct port boundary

Future shape:

`StarBench External Eval Port -> isolated Promptfoo runner -> immutable result bundle -> StarBench admission/import`

The boundary should be process/file based, pinned to an exact Promptfoo version and
configuration hash. StarBench supplies a non-secret immutable execution manifest;
the runner executes only under a separately authorized network/credential budget;
the runner emits a bounded bundle with per-call observations, config identity,
provider/model/method identity, timestamps, request counts, usage, latency, output or
safe reference, assertion/evaluation records, and runner provenance.

Promptfoo includes external/script execution using `execFile`. Even though it avoids
a shell by default, it still executes arbitrary local commands. That capability must
remain outside StarBench's core process and be denied unless explicitly allowed by a
future sandbox policy.

## Result mapping

Potentially convertible to StarBench `RAW_RESULT` only:

- a single observed Provider invocation with exact provider/model/endpoint-method
  identity;
- an attributable prompt/task identity and execution timestamp;
- observed success/failure, latency, usage/cost if actually returned or measured;
- safe output or immutable response reference; and
- complete runner/config/provenance, integrity, source-class, and admission evidence.

The converter must preserve unknowns as null/unknown and must not merge several
calls into one result. A cache hit is not a fresh Provider execution and cannot be
reported as a new RAW_RESULT.

Must map to Canonical Evaluation/Evidence rather than RAW_RESULT:

- assertion pass/score/reason and named scores;
- aggregate eval summaries and model comparison;
- LLM-as-judge/model-grader outputs;
- red-team findings, risk classifications, and attack success metrics; and
- externally recomputed or cached grading results.

These records remain external evidence until StarBench validates their contract,
provenance, integrity, and official eligibility.

## Cache and secret boundary

Promptfoo has a disk-cache lifecycle with a default retention window. Its fetch cache
can include a stable HMAC fingerprint derived from a secret. The raw secret is not
stored by that mechanism, but StarBench's stricter safety history prohibits isolated
secret-derived hashes. Therefore Promptfoo cache keys/files and cache semantics must
not be copied into StarBench. The external port should default to cache disabled for
official measurements, or import a cache hit only as explicitly marked non-fresh
evidence.

A targeted scan also found public test/example key-shaped material, including a demo
key. No value is reproduced and no live credential was identified. Keep the snapshot
quarantined and exclude all demo credentials and cache artifacts from future result
bundles.

## Capabilities not to copy

- provider adapters/ecosystem;
- assertion and model-grader engine;
- dataset/config execution engine;
- red-team plugins and attack infrastructure;
- CLI/web UI/database/result lifecycle;
- external script runner;
- disk/fetch cache implementation; and
- aggregate scoring/comparison authority.

## Capabilities StarBench must continue to own

- canonical task/provider/model/evidence identities;
- Provider credential and request-budget authority when StarBench authorizes a run;
- RAW_RESULT schema, writer, admission, and importer;
- Canonical Evaluation and Score/Profile/Decision boundaries;
- evidence sufficiency, provenance, integrity, and seals;
- external-runner port contract and import policy;
- project token forecast and forecast/actual governance; and
- pricing/entitlement consumption and resource advisory.

## License boundary

The root project is MIT-licensed. Distributed copies or substantial portions must
retain the copyright and permission notice. Any later selection from a nested
subtree must be rechecked for its own attribution file; the inspected red-team
provider subtree includes Microsoft/PyRIT-related MIT attribution. Running an
unmodified separately packaged dependency still requires preserving the dependency's
license in the distribution and notices.

## Decision

Overall future action: `ADAPT_BEHIND_PORT`.

No integration code is created in this audit. A future offline-only port proof should
consume a frozen synthetic Promptfoo result bundle and demonstrate safe admission
without installing Promptfoo into the StarBench runtime.
