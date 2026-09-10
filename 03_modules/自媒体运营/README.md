# Creator Ops V0.2 Authoritative Runtime

This module is the single authoritative local runtime for NEXA Creator Ops.
Its Python application entry is `creator_ops.CreatorOpsApplication`; its sole
Core consumer entry is `src/index.mjs`. Both follow
`docs/architecture/UI_READY_CONTRACT.md` and must not expose repositories,
SQLite, `source_import`, or legacy executables to Core.

The final ownership map and code route are:

- `docs/architecture/FINAL_CREATOR_OPS_FUNCTION_MAP.md`
- `docs/architecture/AUTHORITATIVE_CREATOR_OPS_FINAL.md`

The runtime is offline and compatibility-first.
It models the path from idea through manual publication, metrics backfill, and
review. It intentionally contains no platform login, cookie/token handling,
browser automation, network collection, or automatic publishing.

## Local production UI

Creator Ops Local Production UI V0.1 is ready. On Windows, double-click:

```text
start_creator_ops_ui.cmd
```

The launcher opens `http://127.0.0.1:8765/` in the default browser. The UI is
local-only and uses the same `CreatorOpsApplication` facade; it never connects
directly to SQLite, repositories or `source_import`. Close it with `Ctrl+C` in
the launcher window. Architecture and operating details are in
`docs/architecture/CREATOR_OPS_LOCAL_UI_V0_1.md`. The versioned Core host contract is `docs/architecture/CREATOR_OPS_CORE_HANDOFF_V1.md`; its machine-readable manifest is `creator-ops.integration.json`.

## Home Widget adapter

The authoritative `src/index.mjs` also exports the read-only
`createCreatorOpsHomeWidgetAdapter(...)` contract for the future NEXA Desktop
dynamic Home activity slot. It consumes an already-running Creator Ops UI Host
through existing loopback GET routes only; it never owns host lifecycle, calls
an operating command, writes business data, or creates another UI/runtime.
The frozen summary and empty-state contract is documented in
`docs/architecture/CREATOR_OPS_HOME_WIDGET_PUBLIC_CONTRACT_V0_1.md`.

## Layout

- `src/creator_ops/domain`: versioned contracts
- `src/creator_ops/state`: canonical state machine and legacy-state mapping
- `src/creator_ops/compatibility`: detached legacy dictionary adapters
- `src/creator_ops/application`: derived work queue and operator workbenches
- `src/creator_ops/persistence`: repository contracts, SQLite adapter and read-only queries
- `src/creator_ops/services`: read-only historical intake and deterministic content pipeline
- `src/creator_ops/viewmodels`: read-only overview projection
- `tests/fixtures`: synthetic and desensitized fixtures
- `docs/architecture`: compatibility and asset-map baselines
- `docs/audits`: task audit reports

## Offline test

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONPATH='src'
python -m unittest discover -s tests -v
```

Python standard library only; no dependency installation is required.

Historical intake accepts only validated `READ_ONLY` Manifest entries with
explicit absolute local paths. `DRY_RUN` performs discovery and compatibility
classification without copying, migrating, or modifying any source file.

Local persistence uses the Python standard-library `sqlite3` adapter. The
formal default is `runtime/data/creator_ops_v0_1.sqlite3`; tests create temporary
databases only. No ORM or downloaded database dependency is required.
