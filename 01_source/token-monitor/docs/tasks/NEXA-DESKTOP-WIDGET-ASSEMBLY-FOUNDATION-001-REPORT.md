# NEXA Desktop Widget Assembly Foundation 001

## Task

- Task: `NEXA-DESKTOP-WIDGET-ASSEMBLY-FOUNDATION-001`
- Project: `NEXA-CORE`
- Scope: Core Desktop Composition, Module Presentation Adapter, Renderer Widget Host
- Result: `PASS`
- Business-module source reads: `0`
- Business-module writes: `0`

## Outcome

NEXA Desktop v0.1 now has a Core-owned Widget assembly boundary on top of the existing Shell, Navigation, Module Registry, and Public API integration. Existing Home module cards are projected through a presentation adapter and mounted through a generic Widget Host instead of being appended directly by the renderer integration.

The foundation does not add module business logic, change module Public APIs, rewrite the Shell, or persist a layout policy.

## Architecture

```text
Module Registry / Control Snapshot
              |
              v
Existing Presentation Catalog
              |
              v
Module Presentation Adapter
  - bounded metadata only
  - readiness/status projection
  - slot/order/theme/visibility projection
              |
              v
Renderer Widget Host
  - register / unregister
  - show / hide
  - setStatus
  - move / setTheme
              |
              v
Core-owned Home Slots
  - today
  - data
  - activity
  - status
```

### Core Desktop Composition

`nexaDesktopComposition.js` freezes Widget contract version 1, the four Home slot identifiers, localized slot labels, and presentation-only default placements for the currently registered assembly modules. Unknown future modules fail into the bottom status slot unless Core supplies a valid layout override.

The composition contains no module snapshots, DTOs, repository paths, IPC calls, or domain calculations.

### Module Presentation Adapter

`nexaModulePresentationAdapter.js` converts existing catalog metadata plus the bounded Core control snapshot into frozen Widget presentations:

- widget and module identity;
- route target;
- slot and order;
- title and description;
- normalized presentation status;
- enabled/visible/theme state;
- movable/themable/removable capability declarations.

Unknown status values fail closed to `UNAVAILABLE`. Disabled modules project as `OFFLINE`. Detail values accept only bounded uppercase status/error codes. Module domain data is never copied into the Widget model.

### Renderer Widget Host

`nexaWidgetHost.js` owns only renderer container mechanics:

- unique Widget registration;
- slot validation;
- accessible show/hide state;
- status state and status-label rendering;
- relocation between registered slots;
- theme token assignment;
- unregister and clear lifecycle.

The host does not import or invoke any module API.

### Home Slots

The existing Home composition surface now exposes four explicit containers:

| Slot | Purpose |
| --- | --- |
| `today` | 今日区域 |
| `data` | 数据区域 |
| `activity` | 动态区域 |
| `status` | 底部状态区域 |

Existing module status cards retain their previous navigation and recovery behavior. Today/Tomorrow remains the existing Home-owned L2 surface; its Widget is only a presentation/status entry and does not duplicate its business UI.

## Future Extension Boundaries

- Drag layout: `WidgetHost.move()` and numeric order are available; persistence and drag interaction are intentionally deferred.
- Theme switching: every Widget carries an inherited theme token and supports `setTheme()`; no new theme system was introduced.
- Module plug/unplug: `register()` and `unregister()` are explicit lifecycle operations. Future modules still require an authorized Core catalog/route handoff.
- Layout overrides: the adapter accepts Core-owned slot, order, visibility, and theme overrides without changing a module contract.

## Public Contract Assessment

The existing Core control snapshot and presentation catalog are sufficient for this foundation. No business-module Public Contract change was required.

Future modules must hand Core at least a registered `moduleId`, route metadata, label/description presentation metadata, enabled state, and bounded readiness status. This task does not infer or create those contracts for unassembled modules.

## Modified Files

### New Core source

- `src/shared/nexaDesktopComposition.js`
- `src/shared/nexaModulePresentationAdapter.js`
- `src/electron/renderer/nexaWidgetHost.js`

### Updated Core renderer composition

- `src/electron/renderer/index.html`
- `src/electron/renderer/styles.css`
- `src/electron/renderer/nexaRendererIntegration.js`

### Tests

- `tests/shared/nexaDesktopWidgetComposition.test.js`
- `tests/electron/nexaWidgetHost.test.js`
- `tests/electron/nexaRendererShell.test.js`

### Report

- `docs/tasks/NEXA-DESKTOP-WIDGET-ASSEMBLY-FOUNDATION-001-REPORT.md`

No files under `03_modules`, or the 07/08/11/13/14/15/16 business-module projects, were read or modified by this task.

## Verification

### Focused foundation and renderer tests

```text
node --test tests/shared/nexaDesktopWidgetComposition.test.js tests/shared/nexaModulePresentationCatalog.test.js tests/electron/nexaWidgetHost.test.js tests/electron/nexaRendererModuleHost.test.js tests/electron/nexaRendererShell.test.js
```

Result: `26 PASS / 0 FAIL`.

### Core lint

```text
npm run lint
```

Result: `PASS`.

### Full existing Core test suite

```text
node --test "tests/**/*.test.js"
```

Result: `2571 PASS / 0 FAIL / 2 SKIP`.

The initial sandboxed full run had four unrelated `EPERM` failures because existing expense tests create fixtures under the project `tmp` directory. The affected test file passed `28/28` with fixture-write permission, and the subsequent complete suite passed in one run with the same permission. No expense source or test was changed.

## Acceptance

- Widget registration: `PASS`
- Widget display/hide: `PASS`
- Widget status display: `PASS`
- Module Presentation Adapter: `PASS`
- Four Home slots: `PASS`
- Future drag/theme/plug boundaries: `PASS`
- Existing Core lint/tests: `PASS`
- Business logic added: `NO`
- Business-module changes: `0`
