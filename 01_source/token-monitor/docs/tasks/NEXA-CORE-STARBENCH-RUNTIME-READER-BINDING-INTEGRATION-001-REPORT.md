# NEXA-CORE-STARBENCH-RUNTIME-READER-BINDING-INTEGRATION-001

## Status

PASS

## Result

The existing StarBench Desktop Assembly now receives its six runtime reader ports from the frozen public `createStarBenchDesktopRuntimeReaderBindings(options?)` factory. Core supplies only one stable opaque module `dataRoot`; StarBench owns its internal reader and Store composition.

The existing Registry, route, lifecycle, IPC, preload, renderer, error isolation, stale-read protection, and shutdown integration were not rebuilt. Each application start creates fresh runtime bindings, stop clears the owned application reference, and re-entry creates a new valid binding/application lifecycle.

## Contract

- Public entrypoint: `03_modules/StarBench/src/public/starbench-desktop-entry.mjs`
- Runtime binding version: `0.1.0`
- Runtime binding factory: `createStarBenchDesktopRuntimeReaderBindings`
- Ownership: `STARBENCH_INTERNAL_COMPOSITION`
- Private Store exposure: false
- Write capability exposure: false
- Canonical Identity Authority: `STARBENCH`
- External Identity Engine role: `UNTRUSTED_EXTERNAL_EVIDENCE`
- Officiality inference: `NOT_ALLOWED`

Core resolves the production root with the established module data convention:

`app.getPath('userData') / nexa / starbench`

Core does not know or construct any StarBench internal Store, file, Ledger, repository, or adapter.

## Runtime reader results

The minimum runtime smoke used a fresh empty opaque root and observed:

- `evaluation_results`: `empty`
- `evaluation_history`: `empty`
- `evidence`: `empty`
- `request_records`: `unavailable / REQUEST_LEDGER_RUNTIME_SOURCE_NOT_AVAILABLE`
- `token_cost_observations`: `empty`
- `external_identity_evidence`: `unavailable / EXTERNAL_IDENTITY_RUNTIME_SOURCE_NOT_AVAILABLE`

No data was fabricated. The public binding keeps every unknown token cost as `null`; Core adds no price inference.

## Verification

- Focused Core StarBench/composition/renderer/host tests: 39/39 PASS
- Targeted ESLint: PASS
- Core lint: PASS
- Full Core regression: 2640 total / 2638 PASS / 0 FAIL / 2 SKIP
- Electron executable runtime-binding smoke: PASS
- Lifecycle stop/re-enter: PASS
- Stale renderer write protection regression: PASS
- Error isolation regression: PASS

## Scope audit

- StarBench module writes: 0
- Other business module writes: 0
- Private Store deep imports: 0
- New Store: 0
- New Ledger: 0
- New Evidence Store: 0
- OpenCode processes: 0
- DeepSeek turns: 0
- Provider calls: 0
- Network changes/calls: 0
- Automatic retries: 0
- Unauthorized writes: 0
