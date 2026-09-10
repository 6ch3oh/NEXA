# NEXA-DESKTOP-CALENDAR-TODAY-SLOT-ASSEMBLY-001

## Execution contract — superseded route applied

- Mode: `CODEX_DIRECT_IMPLEMENTATION`
- Primary implementation agent: Codex GPT-5.6 Sol
- ExecutionHub required: `NO`
- ExecutionHub writes: 0
- OpenCode processes: 0
- DeepSeek rounds: 0
- External AI providers: 0
- Automatic retries: 0
- Project: `<PROJECT_ROOT>\01_source\token-monitor`
- Calendar module: read-only at `<PROJECT_ROOT>\03_modules\日历与星枢管家`
- This route supersedes the earlier ExecutionHub/OpenCode/DeepSeek requirement for the same Task ID.

## Frozen goal

Complete the first real NEXA Desktop v0.1 Home Widget chain:

```text
Calendar Application
→ Calendar Home Widget Adapter
→ NEXA Desktop Composition
→ existing Widget Host
→ Home `today` slot
```

The Home today slot must render real calendar summary data and offer a safe Butler parsing preview. This task does not redesign Home or develop calendar business logic.

## Proven baseline

- Git HEAD at dispatch preparation: `eec5cde769fc66852b198d741bebc96a136cd58e`
- Branch: `main`
- The worktree is already dirty with prior authorized Core assembly work. Preserve all pre-existing changes and do not reset, overwrite, or reformat unrelated files.
- Calendar public contract focused test: `6 PASS / 0 FAIL`.
- Core Widget/Composition/Renderer focused baseline: `34 PASS / 0 FAIL`.
- No parallel Core writer or active `ExecutionHub`, `OpenCode`, or `DeepSeek` process was detected during precheck.

## Existing assets to reuse

- Calendar public entrypoint: `<PROJECT_ROOT>\03_modules\日历与星枢管家\src\index.mjs`
- Calendar exports:
  - `CALENDAR_HOME_WIDGET_CONTRACT_VERSION`
  - `createCalendarHomeWidgetAdapter({ calendarApplication, timezone, clock })`
- Widget operations:
  - `getTodaySummary()` → `{ date, events, next_event, todo_count, timeline }`
  - `parseButlerInput(userInput)` → deterministic parse preview only
- Core public ESM loader and static module-root-relative entrypoint in `src/electron/nexaAppComposition.js`
- Existing Today/Tomorrow lifecycle, configuration injection, Registry, Controller, Host and IPC in:
  - `src/electron/nexaAppComposition.js`
  - `src/electron/nexaTodayTomorrowBridge.js`
  - `src/electron/preload.js`
- Existing Widget Foundation:
  - `src/shared/nexaDesktopComposition.js`
  - `src/shared/nexaModulePresentationAdapter.js`
  - `src/electron/renderer/nexaWidgetHost.js`
  - `src/electron/renderer/nexaRendererIntegration.js`
- Existing full Calendar renderer: `src/electron/renderer/nexaTodayTomorrowRenderer.js`
- Existing Home `today` slot placement for module `today-tomorrow`.

## Current real gap

The Home today slot currently receives a generic module-status card. It does not yet project all five Calendar Home Widget summary fields and has no safe Butler parse-preview UI. The full Today/Tomorrow route already exists and must remain intact.

## Allowed writes

Only inside `<PROJECT_ROOT>\01_source\token-monitor`, and only as required for:

- existing Desktop Composition;
- existing Widget Host wiring;
- existing Renderer integration;
- minimal Home today-slot presentation;
- necessary Core configuration/module assembly;
- directly related Core tests;
- this task's files under `docs/tasks`.

## Read-only Calendar allowance

Only these Calendar files may be read:

- `src/index.mjs`
- `src/application/calendar-home-widget-adapter.mjs`
- `docs/contracts/CALENDAR_HOME_WIDGET_PUBLIC_CONTRACT_V0.1.md`
- `tests/calendar-home-widget-adapter.test.mjs`

Do not scan other Calendar paths. Do not write any Calendar file.

## Implementation requirements

1. Import Calendar Widget functionality only through `src/index.mjs`; do not deep-import production code.
2. Reuse the existing Core ESM public-loader allowlist and module-root-relative path construction; never hardcode a machine-specific absolute runtime path.
3. Reuse the existing Today/Tomorrow Application instance/lifecycle. Do not create a second calendar application, loader, registry, Widget Host, Home page, UI framework, or state framework.
4. Provide the minimum safe Core bridge needed for:
   - read-only `getTodaySummary()`;
   - read-only `parseButlerInput(userInput)` preview.
5. Do not expose or invoke Calendar mutation/command operations from the Home Widget path.
6. Render, with this priority:
   - `next_event`;
   - `timeline`;
   - `todo_count`;
   - `date`;
   - all `events` remain explicitly represented.
7. Add the exact user-facing notice or an equivalent unambiguous Chinese notice:

   > 输入一段时间安排，星枢将先为你解析，不会自动创建日程。

8. Butler preview must display only parse output or a safe parse-failure message. It must never create/update an event, execute a command, auto-submit, call a network/AI provider, or claim that a schedule was added.
9. When the summary is empty, show a truthful Chinese empty state and no fabricated events.
10. Isolate Calendar loading, summary, and parse failures to the today slot. Show safe Chinese unavailable/error copy without stack traces, filesystem paths, or internal implementation details. Shell, navigation, full Calendar route, and other Widget Host capabilities must continue working.
11. Hide/collapse unregistered `data` and `activity` slots through existing Widget Host behavior. Do not add fake data. The status slot may show only real readiness already available from Core.
12. Repeated initialization must not duplicate the Calendar Widget; teardown/unregister must not retain stale listeners.
13. Preserve all existing module behavior and all pre-existing dirty-worktree changes.

## Forbidden

- Any Calendar module write, database/SQLite/WAL/SHM/storage change, Calendar business logic change, Calendar public-contract change, event creation/editing, command execution, parser expansion, relative-time guessing, network request, AI provider request, background subprocess, dependency upgrade, unrelated refactor, or other business-module write.
- Direct Calendar database access or private production imports.
- Runtime machine-absolute paths.
- Changes to ExecutionHub, Queqiao, StarBench, or the global AI execution center.
- Installing browsers, test frameworks, or system dependencies.

## Required tests

Run at least:

1. Read-only Calendar contract test:
   `node --test tests/calendar-home-widget-adapter.test.mjs`
2. Core Widget Host focused tests.
3. Desktop Composition focused tests.
4. Renderer Shell/Home focused tests.
5. New Calendar Today Slot integration tests.
6. `npm run lint`.
7. Full `npm test`.
8. Existing Electron visual smoke only if already available and runnable without installation.

Tests must cover normal summary, no events, next event, todo count, timeline, Butler success/failure, not-ready state, error isolation, no fake data in unregistered data/activity slots, idempotent initialization, and listener cleanup after teardown/unregister.

## Stop conditions

Stop without retry if any required implementation needs a Calendar/other-module write, direct database read, Widget Foundation rewrite, new loader/host/home, unavailable configuration injection, unrelated-module change, conflicting parallel writer, unauthorized write, or unexplained related baseline failure.

## Execution result required

Return:

- execution mode and terminal status;
- proof that ExecutionHub/OpenCode/DeepSeek/provider usage remained zero;
- modified/new/deleted file list;
- scoped diff summary;
- command-by-command test results;
- proof of zero Calendar/other-business-module writes;
- proof of zero network, AI-provider, and storage changes;
- any remaining gap or stop reason.
