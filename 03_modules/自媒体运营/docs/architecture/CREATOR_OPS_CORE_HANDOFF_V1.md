# Creator Ops Core Handoff Contract V1

Status: `READY / IMPLEMENTED`  
Task: `NEXA-CREATOR-OPS-CORE-HANDOFF-001`  
Public API version: `0.2`  
UI host contract version: `1.0`

## Decision

The existing `CreatorOpsApplication` and Local UI V0.1 are retained. The integration path is `DIRECT_REUSE → CONTINUE_EVOLUTION`: a lifecycle/status contract was added around the existing host, and a thin Node ESM facade now owns the Python child process. No second UI, database, repository, workflow, or publishing path was created.

## Frozen public identity

| Contract | Authoritative value |
|---|---|
| entrypoint | `src/index.mjs` |
| moduleId | `creator-ops` |
| routeId | `creator-ops` |
| public API | `0.2` |
| Python application factory | `creator_ops.create_creator_ops_application` |
| Core host factory | `createCreatorOpsUIHost` |
| Core controller factory | `createCreatorOpsController` |
| UI host contract | `1.0` |
| manifest | `creator-ops.integration.json` |

`routeId=creator-ops` freezes the module-owned route identity. It does not choose Core navigation placement, menu ordering, presentation shell layout, or activation timing.

## Core consumer contract

Core loads only `src/index.mjs`. The loader-visible module descriptor is:

```json
{
  "contractVersion": 1,
  "moduleId": "creator-ops",
  "invokeChannels": [],
  "pushChannels": []
}
```

The returned host/controller exposes `start()`, `stop()`, `getReadiness()`, `getSnapshot()`, and the bounded `execute({type: "GET_READINESS"})` operation. Core does not import `src/core-integration/**` directly.

Minimal consumption:

```js
import { createCreatorOpsUIHost } from './src/index.mjs';

const host = createCreatorOpsUIHost();
const readiness = await host.start();
// readiness.endpoint is the authoritative loopback surface.
await host.stop();
```

## Lifecycle and readiness

The machine-readable states are `CREATED`, `STARTING`, `READY`, `STOPPING`, `STOPPED`, and `ERROR`.

Every readiness result contains:

- `contractVersion`
- `state`
- `ready`
- `errorCode`
- `message`
- `endpoint`
- `runtimeInstanceCount`
- `generation`

`start()` is idempotent while ready. Concurrent or repeated calls share one start promise and one child runtime. `stop()` uses a private random control token over loopback, waits for process exit, and is idempotent after stop. A subsequent start increments `generation`. The Python host also waits for its shutdown worker to finish before restart, preventing rebind/cleanup races.

Errors exposed to Core use stable codes and safe messages. Raw causes, stacks, private server objects, tokens, and paths are not returned.

## Endpoint policy

The factory default is `127.0.0.1:8765`, preserving the operator UI baseline. The contract policy is `FACTORY_RETURNED_LOOPBACK`: Core uses `readiness.endpoint.host`, `.port`, and `.url`; it does not hardcode or infer the endpoint and never parses stdout.

The public factory accepts only stable host options:

- `host` (must remain `127.0.0.1`)
- `port`
- `startupTimeoutMs`

No configuration is required when the controlled default endpoint is available.

## Ownership and security boundary

Production DB, schema, migrations, queries, recovery, and all business semantics remain entirely owned by Creator Ops. The child process calls the existing `creator_ops.ui.host`, which creates the established `CreatorOpsApplication`; Core never receives a DB path, DB handle, repository, or source-import location.

The Core facade uses Node/Python standard libraries only. Child stdout/stderr are ignored, not parsed. The only network activity is loopback HTTP between the facade and the local UI host. External providers, platform APIs, OAuth, login, automatic publishing, and credentials remain absent.

## Core required configuration

`CORE_REQUIRED_CONFIGURATION = NONE` for the default host. Optional stable host configuration is limited to `host`, `port`, and `startupTimeoutMs`. Core separately owns route placement and shell presentation; those are not Creator Ops runtime settings.

## Core does not need to know

- Production DB schema, path, or lifecycle implementation
- SQLite or repository types
- `source_import`
- private services and internal HTTP handlers
- the Python executable command or child control token
- host implementation classes below `src/index.mjs`
- stdout messages or startup scripts
- publishing/platform credentials (none exist)

## Verification

`tests/test_creator_ops_core_handoff.py` proves identity, manifest equivalence, stable factories, structured readiness, repeated start/stop, one runtime, controlled shutdown, restart, endpoint release, boundary protection, safe validation errors, product Dashboard access, and unchanged Production DB bytes. Existing UI regression covers Dashboard, Work Queue, Content Detail, Health, and Recovery through the same application route.