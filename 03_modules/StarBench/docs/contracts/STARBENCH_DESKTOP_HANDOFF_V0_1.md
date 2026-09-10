# StarBench Desktop Entry Handoff V0.1

Task: `NEXA-STARBENCH-DESKTOP-ENTRY-HANDOFF-V0.1-001`

The stable module-side public entrypoint is
`src/public/starbench-desktop-entry.mjs`. It exports
`createStarBenchDesktopApplication` and a machine-readable contract matching
`contracts/starbench-desktop-handoff-v0.1.json`.

## Boundary

```text
NEXA Desktop / Core Assembly
  -> StarBench Desktop Public Entrypoint
  -> injected StarBench-owned safe reader ports
  -> existing Canonical Evaluation / Evidence / Request / Token assets
```

Core must not import Evaluation Store, Evidence implementation, Request Ledger,
Token Accounting, Canonical Identity algorithms, or external-engine adapters.
StarBench runtime composition binds those implementations to the named reader
ports. The Desktop contract exposes no execution operation.

The first Desktop placement is an independent module entry labelled `星测`.
The route is intentionally not frozen. There is no StarBench UI Host in V0.1;
Core Assembly owns the route and presentation host.

## Safe read surface

The public application exposes only evaluation results/history, evidence,
request records, Token/Cost observations, and read-only external identity
evidence. Reader results use `ready`, `empty`, `partial`, `unavailable`, `stale`,
or `error`. Responses are bounded to 200 items and fail closed on secret-shaped
data, absolute storage paths, stacks, causes, Cookie/Authorization fields, cyclic
values, malformed status envelopes, and oversized pages.

Reader failures are projected to stable public errors without the original
message, stack, path, or cause. Lifecycle is explicit: `start`, `stop`,
`getReadiness`, and `read`. Reads while stopped are unavailable.

Every response summary also carries a backward-compatible product projection.
`EMPTY` means the source is healthy but currently has no records;
`UNAVAILABLE` means no readable source exists and never asks the user to
configure one; `STALE` retains data plus its last update timestamp; and `ERROR`
means a normally readable source failed during this read. The Chinese user copy
contains no private reader, path, Store, Ledger, host, or authority
implementation terms.

## Authority

StarBench remains the Canonical Identity Authority. External identity engines
remain `UNTRUSTED_EXTERNAL_EVIDENCE`; `officiality_inference` remains
`NOT_ALLOWED`. The handoff neither executes a Provider/external engine nor adds
an Evidence Store, RAW_RESULT path, Request Ledger, Token Accounting system, or
UI framework.
