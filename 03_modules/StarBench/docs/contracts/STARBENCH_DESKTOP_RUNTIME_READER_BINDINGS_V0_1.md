# StarBench Desktop Runtime Reader Bindings V0.1

Task: `NEXA-STARBENCH-DESKTOP-RUNTIME-READER-BINDING-HANDOFF-V0.1-001`

The existing stable public entrypoint now exports
`createStarBenchDesktopRuntimeReaderBindings`. Core supplies at most one opaque
runtime `dataRoot` plus optional read-only clock/paging configuration. StarBench
owns all internal Store selection and file layout.

The factory returns exactly the six reader function names frozen by Desktop
Handoff V0.1. It never returns a Store, path, writer, Ledger implementation,
adapter, credential accessor, Provider, or execution operation.

## Existing sources reused

- Evaluation history: existing `EvaluationStore` read path.
- Evaluation results and evidence: existing `ScoreStore` read path.
- Token/Cost observations: existing `HistoricalUsageStore` read path. Unknown
  cost remains null; no price lookup or inference occurs.
- Request records: `unavailable` until StarBench has a production-persisted
  Request Ledger read source.
- External identity evidence: `unavailable` until StarBench has a
  production-persisted Canonical Identity Observation read source.

Absent files are `empty`, not errors. Storage and validation failures are
projected to `error` without a private path, stack, cause, raw internal error,
or implementation term in user copy. A missing production source remains
`unavailable` and explicitly requires no user configuration.
Bounded paging produces `partial`; optional age policy produces `stale`.

The reader bindings are consumed by the existing
`createStarBenchDesktopApplication({ readers })` factory, whose safe projection
boundary additionally rejects secrets, absolute paths, unsafe headers, stacks,
cycles, and malformed output.

StarBench remains the Canonical Identity Authority. External engines remain
`UNTRUSTED_EXTERNAL_EVIDENCE`, and officiality inference remains `NOT_ALLOWED`.
No Store, Evidence system, Request Ledger, Token Accounting system, or historical
record is created or modified by this handoff.
