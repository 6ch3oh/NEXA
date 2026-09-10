# NEXA-DESKTOP-CALENDAR-TODAY-SLOT-ASSEMBLY-001 — Final Report

## TASK

`NEXA-DESKTOP-CALENDAR-TODAY-SLOT-ASSEMBLY-001`

## STATUS

`BLOCKED`

The Calendar-to-Today implementation and every task-focused test pass. Final `PASS` is blocked only by one independently reproducible, pre-existing Device Center full-regression failure outside this task's authorized scope.

## EXECUTION_MODE

`CODEX_DIRECT_IMPLEMENTATION`

- ExecutionHub required: `NO`
- ExecutionHub writes: `0`
- OpenCode processes: `0`
- DeepSeek turns: `0`
- External AI provider calls: `0`
- Automatic implementation retries: `0`

## PROJECT_PATH

`<PROJECT_ROOT>\01_source\token-monitor`

Read-only Calendar dependency:

`<PROJECT_ROOT>\03_modules\日历与星枢管家`

## EXISTING_ASSETS_REUSED

- Existing allowlisted ESM Public API Loader.
- Existing Today/Tomorrow Application lifecycle and the same Application instance.
- Existing Module Registry, Controller Binding, Shell Host and Module Control.
- Existing `dataRoot`, `timezone` and `clock` injection.
- Existing Today/Tomorrow full route, IPC and renderer.
- Existing Desktop Composition and `today-tomorrow → today` placement.
- Existing Module Presentation Adapter and Widget Host.
- Existing four Core-owned Home slots.

No second Calendar Application, Widget Host, module loader, Registry, Home page, UI framework or state framework was created.

## CALENDAR_PUBLIC_ENTRYPOINT

`<PROJECT_ROOT>\03_modules\日历与星枢管家\src\index.mjs`

Core validates and consumes both:

- `TODAY_TOMORROW_PUBLIC_API_VERSION = 0.1.0`
- `CALENDAR_HOME_WIDGET_CONTRACT_VERSION = 0.1.0`

Production code does not deep-import the Calendar adapter. Runtime entrypoint construction remains repository/module-root-relative and contains no machine-specific absolute path.

## CALENDAR_MODULE_WRITES

`0`

## WIDGET_REGISTRATION_PATH

```text
Calendar Public Entrypoint
→ createTodayTomorrowApplication(...)
→ createCalendarHomeWidgetAdapter({ same calendarApplication, timezone, clock })
→ two read-only Core IPC handlers
→ frozen Preload NEXA namespace
→ NexaCalendarHomeWidgetRenderer
→ existing Module Presentation Adapter
→ existing `today-tomorrow → today` Desktop Composition placement
→ existing Widget Host `register()`
→ existing Home `today` container
```

Repeated Home composition first clears the existing Host registration and re-registers the same stable Widget element. Concurrent Calendar summary initialization is coalesced to one request.

## TODAY_SLOT_RENDER_PATH

The dedicated Calendar Home renderer projects real Calendar Widget summary data into the existing Today slot. Information order is:

1. next event;
2. timeline;
3. todo count;
4. date;
5. explicit events list/count.

The full Calendar route and renderer remain intact.

## BUTLER_PARSE_BOUNDARY

```text
Home input
→ preload.parseHomeInput(input)
→ read-only IPC handler
→ controller.parseHomeInput(input)
→ Calendar Home Widget Adapter.parseButlerInput(input)
→ safe preview text
```

This path never calls the Calendar Application `execute()` operation. It neither creates nor modifies events, never auto-submits, and does not call a network or AI provider. The UI states: `这里只进行解析，不会自动创建日程。`

## TODAY_SUMMARY_FIELDS

All five required fields have an explicit renderer projection:

- `date`: summary metadata;
- `events`: explicit Today event list and event count;
- `next_event`: highest-priority next-event row or truthful `暂无`;
- `todo_count`: explicit pending item count;
- `timeline`: ordered Today timeline list.

## ERROR_ISOLATION

- Loading renders only inside the Calendar Widget.
- Disabled/offline Calendar renders a safe Chinese not-ready state.
- Invalid or failed summary renders a safe Chinese local error.
- Butler failures render a safe Chinese parse error.
- Error payloads, stack traces, database paths and internal messages are not rendered.
- Summary loading uses `Promise.allSettled` beside the existing full Calendar renderer, so one Calendar Home failure cannot reject the surrounding route load.
- Shell, L1 navigation, the full Calendar route and other Widget Host registrations remain independent.
- Renderer disposal removes its form and navigation listeners; stale async generations are ignored.

## MODIFIED_FILES

- `src/electron/nexaTodayTomorrowBridge.js`
- `src/electron/nexaAppComposition.js`
- `src/electron/preload.js`
- `src/electron/renderer/index.html`
- `src/electron/renderer/nexaRendererIntegration.js`
- `src/electron/renderer/styles.css`
- `tests/electron/nexaTodayTomorrowBridge.test.js`
- `tests/electron/nexaTodayTomorrowIntegration.test.js`
- `tests/electron/nexaAppComposition.test.js`
- `tests/electron/nexaPreloadNamespace.test.js`
- `tests/electron/coreExtensionCompatibilityGuard.test.js`
- `tests/electron/nexaRendererShell.test.js`
- `docs/tasks/NEXA-DESKTOP-CALENDAR-TODAY-SLOT-ASSEMBLY-001-TASK.md`

Several listed tracked files already contained prior authorized dirty-worktree changes. This task preserved them and changed only the Calendar Home Widget wiring/test sections.

## NEW_FILES

- `src/electron/renderer/nexaCalendarHomeWidgetRenderer.js`
- `tests/electron/nexaCalendarHomeWidgetRenderer.test.js`
- `docs/tasks/NEXA-DESKTOP-CALENDAR-TODAY-SLOT-ASSEMBLY-001-TASK.md`
- `docs/tasks/NEXA-DESKTOP-CALENDAR-TODAY-SLOT-ASSEMBLY-001-REPORT.md`

## DELETED_FILES

`0`

## OTHER_BUSINESS_MODULE_WRITES

`0`

## EXECUTIONHUB_WRITES

`0`

## OPENCODE_PROCESSES

`0`

## DEEPSEEK_TURNS

`0`

## NETWORK_CHANGES

`0`

No network dependency or runtime network behavior was added.

## STORAGE_CHANGES

`0` product/runtime storage changes.

No database, SQLite, WAL, SHM, Calendar storage schema or new storage dependency was added. Existing tests used isolated temporary fixtures and cleaned them through their normal teardown.

## FOCUSED_TESTS

### Calendar Public Widget Contract — read-only

Command: `node --test tests/calendar-home-widget-adapter.test.mjs`

Result: `6 PASS / 0 FAIL / 0 SKIP`

### Core Calendar/Home/Widget focused suite

Covered real Calendar Public Entrypoint integration; all five summary fields; next event and timeline; empty/not-ready/error states; Butler success, unresolved input and safe failure; no Calendar `execute()` on the Butler/Home path; coalesced initialization; unique repeated Host registration; listener cleanup; Preload/IPC compatibility; Desktop Composition, Widget Host and Renderer Shell.

Result: `45 PASS / 0 FAIL / 0 SKIP`

## CORE_LINT

Command: `npm run lint`

Result: `PASS`

## FULL_CORE_REGRESSION

Initial sandbox run:

- `2571 PASS / 5 FAIL / 2 SKIP`
- Four Expense failures were `EPERM` when the sandbox denied creation below the repository `tmp` directory.
- One Device Center UI integration assertion failed.

Required non-sandbox verification after that diagnosis:

- `2575 PASS / 1 FAIL / 2 SKIP`
- Only remaining failure: `tests/electron/nexaDeviceCenterUiIntegrationHost.test.js`
- Expected `常驻 · 只读`; actual `只读`.

The Device Center source/test files were already dirty or untracked at the task's opening baseline. This task did not modify them. The failure reproduces when that test file runs alone (`5 PASS / 1 FAIL`) and is therefore safely attributed to the pre-existing Device Center worktree state.

Result: `BLOCKED_BY_PREEXISTING_DEVICE_CENTER_BASELINE_FAILURE`

## VISUAL_SMOKE

`NOT AVAILABLE`

No existing Electron visual-smoke test or package script matching the task was found. No browser, framework or system dependency was installed.

## UNAUTHORIZED_WRITES

`0`

## ACCEPTANCE AUDIT

| # | Criterion | Result |
|---:|---|---|
| 1 | Calendar uses formal Public Entrypoint | PASS |
| 2 | Today Slot reads real `getTodaySummary()` | PASS |
| 3 | Five summary fields explicitly projected | PASS |
| 4 | Butler is parse-only | PASS |
| 5 | No Calendar event creation | PASS |
| 6 | Calendar writes zero | PASS |
| 7 | Other business-module writes zero | PASS |
| 8 | ExecutionHub writes zero | PASS |
| 9 | OpenCode calls zero | PASS |
| 10 | DeepSeek calls zero | PASS |
| 11 | New network dependencies zero | PASS |
| 12 | New storage dependencies zero | PASS |
| 13 | No machine-absolute runtime path | PASS |
| 14 | No second Widget system | PASS |
| 15 | Local error isolation | PASS |
| 16 | No fake data in unintegrated regions | PASS |
| 17 | Focused tests | PASS |
| 18 | Core lint | PASS |
| 19 | Full Core regression | BLOCKED — one pre-existing Device Center failure |
| 20 | Unauthorized writes zero | PASS |

Because criterion 19 is not satisfied, final `STATUS = PASS` is not permitted.

## REMAINING_GAPS

One pre-existing Device Center UI integration expectation must be resolved by its owning authorized task. No Calendar or Today Slot implementation gap remains in the focused test scope.

## NEXT_ALLOWED_GOAL

Resolve or formally rebaseline the Device Center assertion in the Device Center/Core integration owner task, then rerun the complete Core regression and resume only the final acceptance step for this Task ID. Do not change the Calendar module.
