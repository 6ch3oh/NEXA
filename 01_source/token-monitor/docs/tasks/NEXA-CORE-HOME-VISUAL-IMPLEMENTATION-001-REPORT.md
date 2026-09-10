# NEXA-CORE-HOME-VISUAL-IMPLEMENTATION-001

## Architecture summary

The existing NEXA Desktop Shell and route lifecycle remain authoritative. Home is composed through the existing renderer integration and WidgetHost slots rather than a second Shell or registry. The new overview renderer owns only presentation orchestration for the four existing Home areas: `today`, `data`, `activity`, and `status`.

The Today hub stays primary. Its calendar expands in place and selecting a day hands the ISO date to the existing Calendar route. AI usage reads the existing Core statistics boundary. Consumption, Creator Ops, Calendar, and device/network content continue to enter through their current public Core bridges or preload APIs. The Home layer does not take business data ownership.

## Implemented Home sections

- Today hub with real date context, compact task summary, expandable month calendar, and selected-day handoff.
- AI usage overview with real aggregate token/application statistics, bounded rows and bars, and truthful cost availability.
- Consumption overview with real period total, top-category share ring, and newest-first recent records.
- Creator Ops overview with named accounts, public metrics, fixed supported window, and explicit unavailable metrics/range controls.
- Study overview prepared as knowledge-card presentation with an explicit contract-missing state instead of sample content.
- Compact system, network, and paired-device status with localized bounded states and unknown distinct from an empty result.

## Removed or excluded Home blocks

- Project/task progress presentation.
- Dashi Home widget/status projection.
- Large AI chart treatment.
- Study time donut.
- Duplicate full Calendar surface on Home.
- Reference-image example values and other synthetic production data.

## Real data and truthful fallback behavior

- AI: existing `getStats` / stats-push renderer boundary.
- Calendar: existing Calendar Home summary and Today/Tomorrow public handoff.
- Consumption: existing Consumption Home summary bridge.
- Creator Ops: existing Creator Ops Home summary bridge.
- Devices/network: existing network and paired-device preload APIs.
- Study: no suitable Home summary contract is currently available, so Home renders an explicit unavailable state.

Independent public reads settle independently so one optional module failure does not block Calendar or the rest of Home. Core module readiness is projected into WidgetHost status, and unavailable device reads remain unknown rather than becoming a false zero-device claim.

## Remaining contract gaps and follow-up prompts

### Calendar

> Provide a versioned read-only `CalendarHomeSummary v0.2` public contract for Core Home: batch month-day summaries keyed by ISO date, at most one display sublabel per day, explicit holiday/festival/event priority, and arbitrary-day summary/detail/edit handoff identifiers. Preserve the existing Home summary contract, keep Calendar data ownership inside the module, and represent unavailable fields as nullable/unknown rather than fabricated values.

### Study Center

> Add a read-only `HomeLearningSummary v0.1` public contract with up to four knowledge cards `{ id, type, title, summary, detailHandoff }` and aggregate progress `{ completed, total, unit, updatedAt }`. Include explicit availability and freshness. Do not emit sample cards or turn missing data into zero.

### Devices and Network

> Add a read-only compact `HomeDeviceNetworkSummary v0.1` public contract containing bounded, localized domestic/foreign path status, optional latency and freshness, plus paired devices `{ idSummary, displayName, type, connectionState, lastSeen }`. Do not expose credentials, secrets, or unapproved network identifiers; distinguish unknown from an empty device list.

### Consumption Center

> Extend the existing Home summary with a reconciled category distribution `{ category, amountCents, share }[]` for the selected period and newest-first recent records. Define empty and unavailable semantics explicitly; keep all financial derivation and data ownership inside Consumption Center.

### Creator Ops

> Extend the Home summary with a bounded window enum `1h | 5h | 1d | 3d | 1w`, per-account nullable plays/views/likes/new metrics, and freshness metadata. Return an explicit unsupported-window result where needed and never fabricate zero metrics.

### Core AI statistics

> Add a bounded read-only per-client trend summary to the existing public statistics/history boundary for Home. Do not expose raw sessions, prompts, credentials, or user identities, and represent unavailable cost as `null`.

## Verification

- Focused Home tests: 47 total, 47 passed, 0 failed.
- Core lint: passed.
- Full Core verification: 2830 total, 2824 passed, 4 failed, 2 skipped. The four failures were sandbox-only `EPERM` temporary-directory failures in `tests/shared/expense.test.js`; the exact file passed 28/28 outside the sandbox, leaving zero attributable functional regression.
- Electron packaging: passed; `dist/win-unpacked/Token Monitor.exe` was produced from the current Core tree.
- Real Electron smoke: passed for Home load, calendar expand/collapse, date navigation, return-to-Home cleanup, responsive widths, visible keyboard focus, and Home-scoped accessibility.

## Evidence

- `artifacts/NEXA-CORE-HOME-VISUAL-IMPLEMENTATION-001/home-1600x900.png`
- `artifacts/NEXA-CORE-HOME-VISUAL-IMPLEMENTATION-001/home-1440x960.png`
- `artifacts/NEXA-CORE-HOME-VISUAL-IMPLEMENTATION-001/home-default-1186x804.png`
- `artifacts/NEXA-CORE-HOME-VISUAL-IMPLEMENTATION-001/home-468x720.png`
- `artifacts/NEXA-CORE-HOME-VISUAL-IMPLEMENTATION-001/home-calendar-expanded-1600x900.png`

## Scope declaration

Business-module writes: 0. ExecutionHub writes: 0. Mobile writes: 0. OpenCode calls: 0. DeepSeek calls: 0. Unauthorized writes: 0.
