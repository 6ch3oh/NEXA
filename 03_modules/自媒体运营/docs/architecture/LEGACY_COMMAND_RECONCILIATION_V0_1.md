# Legacy Command Reconciliation V0.1

| Legacy command | Disposition | NEXA command | Reason |
| --- | --- | --- | --- |
| `generate_daily_brief.py` | `KEEP_LEGACY_TOOL` | none | Topic/research generation is outside current NEXA API |
| `create_selection.py` | `WRAP_APPLICATION_API` | `record_selection` (future) | Selection should eventually cross an explicit command boundary |
| `validate_selection.py` | `KEEP_LEGACY_TOOL` | none | Read-only validation remains useful during transition |
| `run_selected.py` | `REPLACE_BY_COMMAND_API` | `create_content_from_selection` (future) | Direct filesystem mutation is the partially replaced 005 path |
| `run_research_once.cmd` | `KEEP_LEGACY_TOOL` | none | Research execution is outside the current Creator Ops API |
| `run_semantic_search_smoke.cmd` | `KEEP_LEGACY_TOOL` | none | Environment smoke testing has no domain command equivalent |
| `run_local_validation.cmd` | `KEEP_LEGACY_TOOL` | none | Historical validation remains evidence and is not deleted |

`REPLACE_BY_COMMAND_API` is a reconciliation decision, not an execution in 006. No legacy command was invoked, edited, deleted or wrapped at runtime.

The future `record_selection` and `create_content_from_selection` names document capability gaps only; they are not added to Public API V0.1 in this task.

## 005 conclusion

- Application API, Facade, Composition Root, DB lifecycle and Core contract: `KEEP`.
- UI/static Notion surface, DTO field mapping, Read API and backup evidence: `KEEP_WITH_ADAPTER`.
- Direct legacy mutation path: `REPLACE_PARTIALLY` through a future Command API compatibility boundary.
- Overall 005: `KEEP_WITH_ADAPTER`; no rollback and no second publish path.
