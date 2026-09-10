# NEXA-CORE-TODAY-TOMORROW-HOST-001 — Frozen Task Contract and Plan

## 1. Task Identity

- Task: `NEXA-CORE-TODAY-TOMORROW-HOST-001`
- Project: `<PROJECT_ROOT>\01_source\token-monitor`
- Mode of this document: `PLAN_ONLY / FROZEN`
- Freeze time: `2026-08-14T22:11:49+08:00`
- Baseline branch: `main`
- Baseline HEAD: `eec5cde769fc66852b198d741bebc96a136cd58e`
- Baseline working tree: `CLEAN`
- Dirty files at freeze: `NONE`
- Dirty overlap with Expected Write Set: `NO`
- Formal `/goal` started by this freeze: `NO`

This file freezes the Task Contract and prospective construction plan. It does not authorize or perform implementation. Any material change to scope, acceptance, or stop conditions must return to 00/04 before `/goal` begins.

## 2. Measurement Goal

The measured engineering Goal is the normal production task that would be performed without StarBench:

```text
NEXA-CORE-TODAY-TOMORROW-HOST-001
```

The eventual completion seal is:

```text
TODAY_TOMORROW_CORE_HOST_READY = YES
```

No forecast, Actual telemetry, Actual token/time result, postmortem, repair sequence, or future implementation report was used to shape this plan.

## 3. Baseline

```text
CORE_ROOT = <PROJECT_ROOT>\01_source\token-monitor
BASELINE_BRANCH = main
BASELINE_HEAD = eec5cde769fc66852b198d741bebc96a136cd58e
BASELINE_WORKTREE_STATUS = CLEAN
STAGED_FILES = NONE
TRACKED_DIRTY_FILES = NONE
UNTRACKED_FILES = NONE
DIRTY_OVERLAP = NO
```

The Core already provides controlled CommonJS-to-ESM loading, static module descriptors and registry, controller binding, module lifecycle control, Shell Host ownership, atomic static IPC registration/disposal, a frozen Preload namespace, Renderer Module Host, authoritative navigation, and a reusable Right Drawer Shell. The Goal must extend these assets and must not create parallel extension infrastructure.

## 4. Inputs

### 4.1 Product and interaction authority — 02

- `<PROJECT_ROOT>\02_product_design\NEXA-TODAY-UI-SPEC-V0.1.md`
- `<PROJECT_ROOT>\02_product_design\NEXA-TOMORROW-UI-SPEC-V0.1.md`
- `<PROJECT_ROOT>\02_product_design\NEXA-TODAY-TOMORROW-INTERACTION-CONTRACT-V0.1.md`
- `<PROJECT_ROOT>\02_product_design\NEXA-TODAY-TOMORROW-CORE-IMPLEMENTATION-CONTRACT-V0.1.md`
- `<PROJECT_ROOT>\02_product_design\NEXA-DESIGN-INTERACTION-CONTRACTS.md`

These frozen contracts own the Today execution workspace, Tomorrow planning workspace, state map, conflict UX, reminder UX, migration confirmation, unified Right Drawer behavior, accessibility, and 1440/1024 responsive rules.

### 4.2 Business authority — 08

- Authoritative Public API: `<PROJECT_ROOT>\03_modules\日历与星枢管家\src\index.mjs`
- Public API version: `0.1.0`
- Public factory: `createTodayTomorrowApplication({ dataRoot, timezone, clock })`
- Public contract: `<PROJECT_ROOT>\03_modules\日历与星枢管家\docs\contracts\TODAY_TOMORROW_PUBLIC_API_V0.1.md`
- UI consumer contract: `<PROJECT_ROOT>\03_modules\日历与星枢管家\docs\contracts\TODAY_TOMORROW_UI_CONSUMER_CONTRACT_V0.1.md`

Core may load only `src/index.mjs`. Service/ViewModel files may be read to verify the frozen contract but must never become Core import targets.

### 4.3 Dependency identity reference — 03

```text
03_MODULE = <PROJECT_ROOT>\03_modules\AI资产中心
03_PUBLIC_CONTRACT_PATH = <PROJECT_ROOT>\03_modules\AI资产中心\docs\AI_AUTHORITY_PUBLIC_READ_CONTRACT_V0_1.md
03_CONTRACT_VERSION = 0.1
03_CONTRACT_HASH = 9de54e55f4ebc68240fcfb9e097c3e515edbb2df7b15b53421b5425ed91134b6
```

The version and hash are the frozen values declared by the public contract and `tests/test_authority_contract_freeze.py`. Module 03 is identity reference only and adds no implementation work to this Goal. The obsolete `AI资产成本` path is forbidden.

## 5. Dependency Identity

The frozen authority chain is:

```text
02 frozen Today/Tomorrow UI and interaction contracts
        +
08 TODAY_TOMORROW_PUBLIC_API_VERSION = 0.1.0
08 createTodayTomorrowApplication(...)
        +
03 Public Authority Contract identity 0.1 / frozen hash (reference only)
        ↓
NEXA Core controlled host integration
```

08 owns Task/Plan/Calendar conflict/Reminder/carryover business truth and persistence. Core owns platform configuration, controlled loading, module lifecycle, static IPC/Preload, navigation, Renderer hosting, temporary UI draft state, and cleanup.

## 6. Frozen Business Invariants

```text
Deadline != Planned Time
Concrete Planned Time = USER_CONFIRMED
AI priority suggestion = ALLOWED
AI concrete-time confirmation = FORBIDDEN
Calendar conflict authority = 08
Reminder lifecycle ownership = 08
Today unfinished automatic migration = FORBIDDEN
Today → Tomorrow = USER_CONFIRMED
UI direct SQLite access = FORBIDDEN
Core duplicate 08 planning logic = FORBIDDEN
```

- Drop/AI time confirmation creates only an unsaved UI draft; persistence occurs only after explicit user Save.
- Scheduling payloads must not contain `deadline` or `due_at`.
- `CONFLICT_WARNING` leaves the existing plan unchanged; Core/UI do not recompute or auto-resolve conflict.
- Carryover suggestion does not migrate a task. Only an explicit user-confirmed 08 action may confirm carryover.
- Reminder reconciliation after scheduling or completion remains entirely inside 08.
- The unified Core Right Drawer is reused; no Today-specific drawer is permitted.

## 7. Expected Read Set

### Core

- `AGENTS.md`
- `package.json`
- `src/electron/nexaEsmPublicApiLoader.js`
- `src/electron/nexaAppComposition.js`
- `src/electron/nexaIpcRegistration.js`
- `src/electron/nexaCoreControlBridge.js`
- `src/electron/main.js`
- `src/electron/preload.js`
- `src/shared/nexaModuleDescriptor.js`
- `src/shared/nexaModuleRegistry.js`
- `src/shared/nexaModuleController.js`
- `src/shared/nexaControllerBinding.js`
- `src/shared/nexaModuleControl.js`
- `src/shared/nexaShellHost.js`
- `src/shared/nexaModulePresentationCatalog.js`
- `src/electron/renderer/nexaModuleHost.js`
- `src/electron/renderer/nexaRendererIntegration.js`
- `src/electron/renderer/nexaRightDrawer.js`
- `src/electron/renderer/index.html`
- `src/electron/renderer/styles.css`
- `tests/shared/nexaModuleDescriptor.test.js`
- `tests/shared/nexaModuleRegistry.test.js`
- `tests/shared/nexaModuleController.test.js`
- `tests/shared/nexaShellHost.test.js`
- `tests/shared/nexaModulePresentationCatalog.test.js`
- `tests/electron/nexaAppComposition.test.js`
- `tests/electron/nexaPreloadNamespace.test.js`
- `tests/electron/nexaRendererModuleHost.test.js`
- `tests/electron/coreExtensionCompatibilityGuard.test.js`

### 02 — frozen contracts only

- `<PROJECT_ROOT>\02_product_design\NEXA-TODAY-UI-SPEC-V0.1.md`
- `<PROJECT_ROOT>\02_product_design\NEXA-TOMORROW-UI-SPEC-V0.1.md`
- `<PROJECT_ROOT>\02_product_design\NEXA-TODAY-TOMORROW-INTERACTION-CONTRACT-V0.1.md`
- `<PROJECT_ROOT>\02_product_design\NEXA-TODAY-TOMORROW-CORE-IMPLEMENTATION-CONTRACT-V0.1.md`
- `<PROJECT_ROOT>\02_product_design\NEXA-DESIGN-INTERACTION-CONTRACTS.md`

### 08 — Public API and contract verification only

- `<PROJECT_ROOT>\03_modules\日历与星枢管家\src\index.mjs`
- `<PROJECT_ROOT>\03_modules\日历与星枢管家\docs\contracts\TODAY_TOMORROW_PUBLIC_API_V0.1.md`
- `<PROJECT_ROOT>\03_modules\日历与星枢管家\docs\contracts\TODAY_TOMORROW_UI_CONSUMER_CONTRACT_V0.1.md`
- `<PROJECT_ROOT>\03_modules\日历与星枢管家\src\services\today-tomorrow-planning-service.mjs` — read-only contract verification; never import from Core
- `<PROJECT_ROOT>\03_modules\日历与星枢管家\src\view-models\today-view-model.mjs` — read-only contract verification; never import from Core
- `<PROJECT_ROOT>\03_modules\日历与星枢管家\src\view-models\tomorrow-view-model.mjs` — read-only contract verification; never import from Core
- `<PROJECT_ROOT>\03_modules\日历与星枢管家\tests\today-tomorrow-public-api.test.mjs`
- `<PROJECT_ROOT>\03_modules\日历与星枢管家\tests\today-tomorrow-ui-consumer-contract.test.mjs`
- `<PROJECT_ROOT>\03_modules\日历与星枢管家\tests\today-tomorrow-application-composition.test.mjs`

Core dependencies on `src/application/**`, `src/services/**`, `src/storage/**`, `src/planning/**`, `src/reminders/**`, or `src/view-models/**` are forbidden. The three implementation files listed above are evidence reads only.

### 03 — identity only

- `<PROJECT_ROOT>\03_modules\AI资产中心\docs\AI_AUTHORITY_PUBLIC_READ_CONTRACT_V0_1.md`
- `<PROJECT_ROOT>\03_modules\AI资产中心\tests\test_authority_contract_freeze.py`

## 8. Expected Write Set

All writes are confined to `<PROJECT_ROOT>\01_source\token-monitor`.

### Production/Core

- `src/electron/nexaTodayTomorrowBridge.js`
- `src/electron/nexaAppComposition.js`
- `src/electron/main.js`
- `src/electron/preload.js`
- `src/shared/nexaModulePresentationCatalog.js`
- `src/electron/renderer/nexaTodayTomorrowRenderer.js`
- `src/electron/renderer/nexaRendererIntegration.js`
- `src/electron/renderer/index.html`
- `src/electron/renderer/styles.css`

### Tests

- `tests/electron/nexaTodayTomorrowBridge.test.js`
- `tests/electron/nexaTodayTomorrowIntegration.test.js`
- `tests/electron/nexaTodayTomorrowRenderer.test.js`
- `tests/electron/nexaAppComposition.test.js`
- `tests/electron/nexaPreloadNamespace.test.js`
- `tests/electron/nexaRendererModuleHost.test.js`
- `tests/electron/coreExtensionCompatibilityGuard.test.js`
- `tests/shared/nexaModulePresentationCatalog.test.js`

### Conditional Expected Write

- `src/electron/renderer/nexaRightDrawer.js` — only if an additive generic adapter hook is strictly required by the frozen 02 contract; changing existing Drawer semantics is forbidden.
- `tests/electron/nexaRightDrawer.test.js` — only when the corresponding generic Drawer change is required.

No file under 02, 08, 03, 06, another module, or ExecutionHub is in the Expected Write Set.

## 9. Planned Architecture

```text
02 frozen UI contract
        +
08 frozen Public API / business contract
        ↓
Core controlled native ESM loading of 08 src/index.mjs
        ↓
Today/Tomorrow Core Host Adapter
        ↓
Static NEXA descriptor / Registry / Controller / Binding / Shell Host
        ↓
Static IPC / frozen Preload namespace
        ↓
Renderer Module Host
        ↓
Today execution workspace / Tomorrow planning workspace
        ↓
Home navigation / L2 Today-Tomorrow switch / unified Right Drawer
        ↓
targeted tests / visual smoke / Extension Guard / full regression
```

The Host Adapter validates API version `0.1.0`, passes only `dataRoot`, IANA timezone, and deterministic clock, delegates lifecycle to the 08 application, exposes safe DTO/result envelopes, and fails closed on missing/invalid APIs. It never opens SQLite, imports a private 08 file, or reimplements planning rules.

## 10. Planned Implementation Sequence

1. Reconfirm branch/HEAD/worktree and verify no active writer or Expected Write Set overlap.
2. Read only the frozen 02/08 contracts and confirm 03 identity values remain unchanged.
3. Load exactly `08/src/index.mjs` through the existing controlled ESM loader and validate version/factory.
4. Create the Today/Tomorrow descriptor and controller over the public application surface; bind create/start/read/action/stop/restart to the existing NEXA lifecycle.
5. Register the exact static `nexa:today-tomorrow:*` invoke surface through the registry-generated atomic IPC plan; add only the matching frozen Preload namespace.
6. Add the authoritative module metadata and connect Today to Home plus Tomorrow as its L2 planning view without creating another L1 route.
7. Implement the Renderer adapter against returned DTOs. Keep Deadline and Planned Time visually and structurally separate; keep concrete time and migration in unsaved drafts until user Save.
8. Reuse the unified Right Drawer for Task detail/edit, focus return, dirty-close confirmation, Reminder projection, and conflict actions.
9. Implement loading, empty, error, offline/stale/partial states only where supported by the formal contract; do not fabricate freshness.
10. Run contract/lifecycle/renderer/business-boundary tests, then 1440×900 and 1024×768 visual smoke.
11. Run Extension Guard and the complete Core regression. Fix ordinary scoped defects inside the frozen Expected Write Set.
12. Confirm 02/08/03/06/other-module modifications are zero, Core working tree contains only the authorized Goal write set, then create one scoped local commit. Do not push.

## 11. Test Plan

### Contract and loader

- Load only the authoritative `08/src/index.mjs` through the controlled native ESM loader.
- Validate `TODAY_TOMORROW_PUBLIC_API_VERSION === "0.1.0"` and the public factory.
- Reject missing module, version mismatch, malformed factory/application, and unsafe paths without breaking Desktop startup.
- Prove no Core deep imports of 08 private implementation.
- Prove Windows Unicode path conversion/loading.

### Lifecycle

- Factory/create performs no persistence side effect.
- First start/init creates the 08-owned runtime through the public application.
- Repeated start returns the existing lifecycle and does not duplicate resources.
- Today/Tomorrow reads and actions work only while started.
- Stop/dispose closes the public application; repeated stop is safe.
- Stopped application can restart/reopen and recover 08-owned state.
- Core shutdown cleans up without duplicate lifecycle, open database handle, listener, timer, process, or residue.

### Today and Tomorrow

- Today read and Tomorrow read use public ViewModels.
- Fixed Calendar events remain read-only and distinct from task plans.
- Tasks, unplaced tasks, priority suggestions, reminders, attention and summaries map without recomputation.
- Concrete Planned Time supports draft, confirm/change, cancel/unschedule and Save semantics.
- Conflict warning displays both objects and leaves the plan unchanged until explicit acceptance.
- Reminder projection/action delegates lifecycle to 08.
- Carryover proposal requires explicit confirmation; reject/dismiss does not migrate.
- Completion uses the public execute/receipt route.

### Business invariants

- Deadline and Planned Time use separate labels, fields, payloads and tests.
- Concrete time requires `actor: "user"`; AI confirmation is rejected/not emitted.
- No automatic unfinished-task carryover.
- Core does not calculate conflict, priority score, Reminder state, or migration truth.
- UI/Preload/Bridge do not open SQLite or expose repository/storage objects.

### Renderer

- Today is the Home execution workspace; Tomorrow is the L2 planning workspace.
- Top navigation and Today/Tomorrow switching preserve context and focus.
- Unified Right Drawer handles details, actions, stale/error state and dirty-close confirmation.
- Loading, empty, error, permission/offline/stale/partial states are rendered according to contract applicability.
- Drag has keyboard/button equivalent; time is always textually available; status is not color-only.

### Visual

- 1440×900: Today 8/4, Tomorrow 7/5, navigation and review controls unobstructed.
- 1024×768: required single-column order, no page-level horizontal overflow, navigation preserved, Drawer within contract width.
- Inspect console/runtime errors, focus path, Drawer trap/return focus, labels, state copy and Deadline/Planned Time distinction.

### Regression

- NEXA Extension Guard and frozen legacy IPC/Preload counts.
- Registry/Controller/Binding/Shell Host and atomic IPC lifecycle.
- Existing Today/Tomorrow-adjacent Core modules and Renderer routes.
- Electron startup/quit lifecycle.
- Complete `npm run verify` with no regression.

## 12. Acceptance Criteria

```text
Today Page = REAL_HOSTED
Tomorrow Page = REAL_HOSTED
Core Navigation = PASS
08 Service Consumption = PASS
08 ViewModel Consumption = PASS
Direct SQLite Dependency = NO
Duplicate 08 Business Logic = NO
Deadline != Planned Time = PASS
Concrete Time = USER_CONFIRMED
Calendar Conflict = PASS
Reminder Ownership = 08
Today→Tomorrow = USER_CONFIRMED
Right Drawer Reuse = PASS
Loading / Empty / Error / Stale = PASS (按正式合同适用)
1440×900 = PASS
1024×768 = PASS
NEXA Extension Guard = PASS
Core Regression = PASS
02 modifications = 0
08 modifications = 0
03 modifications = 0
06 modifications = 0
Other module modifications = 0
Git push = NO
TODAY_TOMORROW_CORE_HOST_READY = YES
```

## 13. Stop Conditions

The future `/goal` must stop and return evidence when any of these conditions is true:

- an unexplained Core writer, Git lock, dirty overlap, or worktree conflict exists;
- completion requires modifying a frozen 02 contract;
- completion requires modifying the 08 Public Contract;
- 08 lacks a required formal Public API;
- Core would need to deep import an 08 private implementation;
- completion would change an 08 frozen business invariant;
- completion requires modifying 03, 06, another business module, or ExecutionHub;
- completion requires a second Planning, Conflict, Reminder, migration, Task, Calendar, repository, or SQLite route;
- completion would change Legacy core semantics or frozen NEXA extension architecture;
- a Secret, login, administrator/system permission, or external business network call is required;
- there is an unbounded or unprovably safe destructive-data risk.

Ordinary scoped implementation bugs, CSS defects, and test failures are handled inside the future `/goal` and are not Plan Freeze stop conditions.

## 14. Scope Boundaries

- Core is the only writable project during the future Goal.
- 02, 08, 03, 06, other modules, and ExecutionHub remain read-only.
- 03 is identity reference only; no Authority integration is added.
- No dependency installation, platform API, login, Secret, external business network, Git push, or unrelated refactor.
- No alternate Drawer, module host, IPC registration mechanism, Reminder engine, migration engine, Task/Calendar store, or Renderer business model.
- Draft state may exist only as non-authoritative UI/Host state and must never masquerade as persisted truth.

## 15. No-Actual / No-Forecast Declaration

```text
STARBENCH_FORECAST_READ = NO
ACTUAL_TELEMETRY_READ = NO
STAR_BENCH_PRODUCTION_FORECAST_READ = NO
SHADOW_FORECAST_READ = NO
FORECAST_SEAL_READ = NO
ACTUAL_TOKEN_USAGE_READ = NO
ACTUAL_DURATION_READ = NO
ACTUAL_POSTMORTEM_READ = NO
ACTUAL_REPAIR_SEQUENCE_READ = NO
```

This plan was not reduced, expanded, reordered, or otherwise altered to make forecasting easier. It is the production construction plan dictated by the frozen product, business, and Core contracts.

## 16. Freeze Evidence

- Git root: `E:/星枢NEXA/01_source/token-monitor`
- Branch: `main`
- HEAD: `eec5cde769fc66852b198d741bebc96a136cd58e`
- Worktree before Plan creation: `CLEAN`
- Dirty files before Plan creation: `NONE`
- Expected Write Set overlap before Plan creation: `NONE`
- 02 contract status: Today/Tomorrow implementation contracts `READY / IMPLEMENTATION_READY`
- 08 public entrypoint: `<PROJECT_ROOT>\03_modules\日历与星枢管家\src\index.mjs`
- 08 API version: `0.1.0`
- 03 contract version/hash: `0.1` / `9de54e55f4ebc68240fcfb9e097c3e515edbb2df7b15b53421b5425ed91134b6`
- Plan file is the sole authorized write in this session.
- Production source modifications: `0`
- Test modifications: `0`
- Config/package modifications: `0`
- Formal `/goal` started: `NO`

```text
TASK_CONTRACT_FROZEN = YES
PLAN_FROZEN = YES
NEXT_STATE = WAIT_FOR_STARBENCH_FORECAST_SEAL
```
