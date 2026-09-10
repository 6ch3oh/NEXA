# NEXA Core Automation Center Daily Ops Bridge Integration 001 — HOLD Report

## Decision

| Field | Result |
| --- | --- |
| `TASK` | `NEXA-CORE-AUTOMATION-CENTER-DAILY-OPS-BRIDGE-INTEGRATION-001` |
| `STATUS` | `STOPPED_BY_REQUIRED_PUBLIC_COMPOSITION_DEPENDENCIES` |
| `CORE_PROJECT_PATH` | `<PROJECT_ROOT>\01_source\token-monitor` |
| `EXECUTIONHUB_READ_ONLY_PATH` | `<PROJECT_ROOT>\04_automation\ExecutionHub` |
| `STOP_CONDITIONS` | `4, 11, 12` |
| `CORE_CODE_WRITES` | `0` |
| `EXECUTIONHUB_WRITES` | `0` |
| `CROSS_MODULE_WRITES` | `0` |

No Core integration code was added. Producing a Loader/IPC shell with fixture-only ports would not establish the required production path and would incorrectly report the acceptance criteria as satisfied.

## Evidence

The frozen public entrypoint is:

`<PROJECT_ROOT>\04_automation\ExecutionHub\runner\daily-ops-desktop-bridge-v0.1.mjs`

It exports version `NEXA_DAILY_OPS_DESKTOP_BRIDGE_V0_1`, but its only production factory requires all of the following host-provided values:

- an existing `registry_store` with `load`;
- `task_contract_factories` backed by existing target-specific Task Contract authorities;
- an existing `dispatch_submitter` callback.

The Core-scoped read-first audit found the established `Registry -> Controller Binding -> Shell/IPC -> Preload` integration pattern and a strict ESM public-entry allowlist. It found no existing ExecutionHub/Automation Center Task Contract adapter, Dispatch submission callback, or Automation Registry store provider in `src/electron`, `src/shared`, `tests/electron`, or `tests/shared`.

The frozen Bridge contract explicitly defines Task Contract factories and Dispatch submission as host-provided ports. The frozen public entrypoint does not export a production composition provider for these mandatory values. Supplying invented Core Task formats, a second target registry, a second Dispatch, or deep-importing ExecutionHub internals would violate the task boundary.

## Starting baseline

Before any task write, `npm run verify` completed with:

- tests: `2773`;
- pass: `2767`;
- fail: `4`;
- skipped: `2`.

All four failures were pre-existing filesystem permission failures (`EPERM`) while tests attempted to create `tmp\expense-test` or `tmp\expense-runtime-*`. No Automation Center integration files existed or were changed when this baseline was recorded.

## Frozen dependency integrity baseline

| Asset | SHA-256 |
| --- | --- |
| `runner/daily-ops-desktop-bridge-v0.1.mjs` | `19ECE16AAA418D565C6699E909E0A859B4E1E763CD7C6B8F2709743F6C5E498E` |
| `config/daily-ops-desktop-bridge-v0-1.schema.json` | `5FC6FBFD93D7F8E5530BEBB012CCB6CD3D7CA7457AAC2AB55A0AD231F9AC1942` |
| `docs/architecture/AUTOMATION_CENTER_DAILY_OPS_DESKTOP_BRIDGE_V0_1.md` | `BC6AD9C7DF80795AE0F45210DD489B559588271B61D2B4851EC9B52BD802A92F` |
| `docs/audits/NEXA_AUTOMATION_CENTER_DAILY_OPS_V0_1_DESKTOP_BRIDGE_001_REPORT.md` | `E7AC06933CE6C802B366A72B7CCD357A6500B8354751769087236F5A6BB0F105` |

## Required upstream decision

Total control must identify or freeze one existing production composition boundary that provides, without exposing ExecutionHub internals to Core:

1. the existing Automation Registry store provider;
2. approved `target_id` to existing Task Contract factory adapters;
3. the existing Dispatch submission callback.

After those authoritative ports are named, this task can resume and implement the already-identified Core Registry/Controller/IPC/Preload/lifecycle pattern plus the 60-second in-process scheduler host. No UI or real Runtime recovery is required for that resumed offline integration.
