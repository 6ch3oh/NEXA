# Core Integration Contract V0.1

This document is a future integration contract only. NEXA 01 Core was not
modified by NEXA-CREATOR-005.

Future Core adapter code may depend on the controlled `creator_ops` public
surface: `create_creator_ops_application`, lifecycle/health/runtime results,
public DTOs, read models, `CommandResult`, and public enums.

Core must not depend on:

- SQLite tables, connections, schema scripts, or runtime database internals;
- repository contracts or implementations;
- serializers or transaction helpers;
- fixtures or synthetic test data;
- internal state-machine, work-queue derivation, or Pipeline implementation;
- paths under `creator_ops.persistence.*` or other internal packages.

Expected adapter sequence:

1. Construct the facade through the public factory.
2. Call `open()` and handle `INITIALIZATION_REQUIRED` without assuming consent.
3. Surface explicit initialization confirmation to the human operator if needed.
4. Consume read APIs and issue commands; never reproduce business transitions.
5. Display stable command/lifecycle errors without inspecting internal exceptions.
6. Call `close()` during adapter shutdown.

The adapter must preserve the truthful capability values: automatic publishing
and network are both `NONE`. Historical asset unresolved is informational or
degraded, not proof that the active Creator Ops path is unavailable.

