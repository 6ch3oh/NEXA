# NEXA Core Device Center CSP Runtime Retest 001

TASK: `NEXA-CORE-DEVICE-CENTER-CSP-RUNTIME-RETEST-001`  
PROJECT_ID: `NEXA-CORE`  
STATUS: `ENVIRONMENT_BLOCKED`

## PRECONDITIONS

- Core: `<PROJECT_ROOT>\01_source\token-monitor`
- Module 11, read only: `<PROJECT_ROOT>\03_modules\设备与网络`
- Start HEAD: `eec5cde769fc66852b198d741bebc96a136cd58e`, branch `main`
- Existing dirty worktree preserved.
- Public API V0.1 and static UI integration entry are present.
- `device-center-ui.css` exists (5,856 bytes; SHA-256 `2F7344DB34A412757D3EFD9AC295E882B0547D2EC515B3031327F2C503C4B6AD`).
- Its exported URL resolves to the expected Module 11 `file:///.../src/device-center-ui.css` resource.
- Core CSP remains `style-src 'self'`; no `unsafe-inline` was added.

## RUNTIME RESULTS

CORE_HOST_START: `PARTIAL / ENVIRONMENT_BLOCKED`  
DEVICE_CENTER_APPLICATION_CREATE: `NOT_PROVEN_IN_REAL_RUNTIME`  
DEVICE_CENTER_ROUTE: `NOT_REACHED`  
DEVICE_CENTER_MOUNT: `NOT_REACHED`  
DEVICE_CENTER_NAVIGATION: `NOT_REACHED`  
DEVICE_CENTER_REMOUNT: `NOT_REACHED`

STATIC_CSS_RESOURCE: `STATIC_PASS`  
STATIC_CSS_LOAD: `NOT_PROVEN_IN_RENDERER`  
STATIC_CSS_APPLIED: `NOT_PROVEN_IN_RENDERER`

DEVICE_CENTER_STYLE_CSP_VIOLATION_COUNT: `NOT_MEASURABLE`  
OTHER_DEVICE_CENTER_CSP_VIOLATIONS: `NOT_MEASURABLE`

RENDERER_CONSOLE_ERRORS: `ENVIRONMENT_FATAL_PRESENT`  
UNCAUGHT_EXCEPTIONS: `NO_DEVICE_CENTER_EVIDENCE`  
UNHANDLED_REJECTIONS: `NO_DEVICE_CENTER_EVIDENCE`

Two controlled Electron launches failed before Device Center routing:

1. CDP port `9333`, normal launch.
2. CDP port `9222`, localhost binding plus `--disable-gpu`.

Both produced:

```text
bind() returned an error: 以一种访问权限不允许的方式做了一个访问套接字的尝试。 (0x271D)
Cannot start http server for devtools.
GPU process exited unexpectedly: exit_code=-1073741515
GPU process isn't usable. Goodbye.
[window] renderer load failed: ERR_FAILED (-2)
```

No Device Center stylesheet request or CSP console event could occur. A zero violation count is not inferred.

## CSS AND CSP STATIC EVIDENCE

Module 11 exports `new URL('./device-center-ui.css', import.meta.url).href`. Its mount path creates a `<link rel="stylesheet">` and assigns that URL. The integration entry contains no `document.createElement('style')` or `style.textContent` injection. This proves the static integration shape, not successful Electron resource loading.

## TRUTHFULNESS

TRUTHFULNESS_CHECK: `STATIC_CONTRACT_PASS / RUNTIME_NOT_REACHED`  
CPU_TEMPERATURE_SEMANTICS: `STATIC_PASS / RUNTIME_NOT_REACHED`  
NETWORK_TOP5_SEMANTICS: `STATIC_PASS / RUNTIME_NOT_REACHED`  
APEX_ROUTE_SEMANTICS: `STATIC_PASS / RUNTIME_NOT_REACHED`

The UI consumes the supplied `cpu_temperature`, `network_top5`, and APEX projections directly. It introduces no `0°C` fallback, byte-ranking synthesis, or SOCKS/TUN inference.

## TESTS

FOCUSED_TESTS: `115/115 PASS`

```text
node --test tests/electron/nexaDeviceCenterIntegration.test.js tests/electron/nexaDeviceCenterBridge.test.js tests/electron/nexaDeviceCenterUiIntegrationHost.test.js tests/electron/nexaDeviceCenterRenderer.test.js
```

CORE_SCOPED_REGRESSION: `35/35 PASS`

```text
node --test tests/electron/nexaAppComposition.test.js tests/electron/nexaPreloadNamespace.test.js tests/electron/nexaRendererModuleHost.test.js tests/electron/nexaRendererShell.test.js tests/electron/coreExtensionCompatibilityGuard.test.js
```

Core host-contract smoke: `PASS` (`PUBLIC_API_VERSION=0.1`, 10 read endpoints, static IPC, single runtime, clean stop, zero timer leaks, zero orphan processes).

This Node smoke is not treated as the real Electron runtime smoke.

REAL_ELECTRON_RUNTIME_SMOKE: `ENVIRONMENT_BLOCKED`

## WRITE ACCOUNTING

CORE_MODIFIED_FILES: `0 source files`  
MODULE_11_WRITES: `0`  
CSP_CHANGED: `NO`  
UNSAFE_INLINE_ADDED: `NO`  
CROSS_MODULE_WRITES: `0`  
UNAUTHORIZED_WRITES: `0`

This report is the only task artifact added.

## ROOT CAUSE IF FAILED

Classification: `CURRENT_EXECUTION_ENVIRONMENT / ELECTRON_RENDERER_STARTUP`.

The last proven stage is Core main-process startup plus static Public API/UI/CSS contract validation. The failure precedes Device Center activation and is not evidence of a Core integration defect or a Module 11 defect. A valid retest requires an environment where Electron can create a usable renderer/GPU process and expose localhost CDP, or another authorized renderer-observation channel.

## FINAL

```text
DEVICE_CENTER_CSP_RUNTIME_COMPATIBLE = NO (NOT PROVEN; ENVIRONMENT BLOCKED)
DEVICE_CENTER_CORE_RUNTIME_READY = NO (NOT PROVEN IN THIS ENVIRONMENT)
```

No Core fix, Module 11 change, or CSP weakening is justified by this run.
