# Creator Ops Composition Root V0.1

`CreatorOpsCompositionRoot` is the one assembly location for V0.1. It resolves
and validates the database path, inspects lifecycle state, creates the SQLite
store/repositories, then constructs query, persistent application, pipeline,
workbench, activity services, and finally the public facade.

The public factory delegates facade construction to this root. ViewModels do not
open databases, Domain objects do not create repositories, and callers cannot
assemble repository-plus-service graphs through the top-level exports.

Dependency injection is deliberately small: the factory accepts an optional
absolute local database path. Tests inject a system-temporary path. No DI
framework, ORM, cloud database, or service locator is introduced.

`close()` closes the connection, clears every assembled reference, and is safe
to repeat. An existing compatible database can subsequently be reopened and the
work queue is re-derived from persisted Domain state plus operator overlays.

Assembly flow:

```text
create_creator_ops_application
  -> CreatorOpsCompositionRoot
  -> read-only lifecycle inspection
  -> SQLite store and repositories (only when allowed)
  -> query/application/workbench services
  -> CreatorOpsApplication
```

