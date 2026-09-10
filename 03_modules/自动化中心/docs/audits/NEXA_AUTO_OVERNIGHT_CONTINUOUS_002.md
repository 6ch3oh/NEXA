# NEXA-AUTO-OVERNIGHT-CONTINUOUS-002｜最终审计

## Goal Status

- Status: `PASS_WITH_EXTERNAL_BLOCKERS`
- Product backend: `AUTOMATION_LOCAL_PRODUCT_BACKEND_V0.2_READY`
- Date: 2026-08-13 (Asia/Shanghai)
- Scope: `<PROJECT_ROOT>\03_modules\自动化中心` only
- Workflow execution authority: n8n only
- Second Workflow Engine: **NO**

本 Goal 已完成 Automation Center 内所有获准且无需外部授权的高价值本地工作。剩余事项都依赖显式 Provider identity、Auth、外部 Artifact 读取授权、跨模块接线或 production write/approval；没有因单一 blocker 提前停止其他里程碑。

## Final Architecture

```text
Legacy n8n canonical/result/evidence (authority, read-only)
    -> existing NEXA Adapter / Snapshot / Result Intake
    -> Unified Read Model
    -> AutomationReadAPI (sole read facade)

Capability / diagnosis / repair / build / run preparation
    -> AutomationControlAPI (sole control-intent facade)

AutomationProviderConfig + loopback Health observation
    -> product projection / readiness matrix / UI reference

n8n remains the only executor. NEXA does not schedule, execute, store credentials,
manage Docker, or claim current Workflow Runtime without evidence.
```

## Provider

`AutomationProviderConfig` now carries provider kind, optional confirmed instance identity, display label, approved endpoint descriptor, provenance/source, confirmation state, last Health observation and capability bindings. The default is a visible candidate (`本机 n8n / 待确认实例名称`, `confirmed=false`), never the historical candidate silently promoted to a production identity.

Without a confirmed identity, product discovery continues while provider-scoped Workflow/Result joins fail closed. With an explicit confirmed identity, the existing Legacy-to-NEXA composition chain is available.

`N8nProviderHealthReader` is constrained to one surface: `GET http://127.0.0.1:5678/healthz`, at most 256 response bytes, no Auth and no Credential. It supports deterministic fake transport and the states `HEALTHY`, `UNREACHABLE`, `UNKNOWN`, `STALE` with timestamp, endpoint ID, source and freshness.

One real minimum smoke was performed:

| Field | Observation |
|---|---|
| Endpoint | approved loopback `/healthz` |
| Observed at | `2026-08-13T02:36:31.873130+08:00` |
| State | `HEALTHY` |
| HTTP | `200` |
| Freshness | `fresh` |

This proves only that the Provider process was healthy at that instant. It does not prove any Workflow was running. Workflow Runtime remains `NOT_OBSERVED`; metadata remains `AUTH_REQUIRED`.

## knowledge.collect

V1.4.1 is the first complete local product sample. The Read API exposes its name, purpose, capability ID, provider-scoped identity state, canonical/static evidence, sandbox evidence, `ai_name` / `source_text` / `source_url`, `knowledge_markdown_document`, Provider Health, Workflow Runtime `NOT_OBSERVED`, historical result summary, health/attention and action readiness.

| Concern | State |
|---|---|
| Read | `READY` |
| Provider Health | `READY` when a fresh healthy observation is injected; otherwise `NOT_READY` with explicit observed state |
| Run | `CONFIG_REQUIRED` before identity confirmation; then `AUTH_REQUIRED` |
| Result copy backend | `IMPLEMENTATION_READY` |
| Diagnosis | `READY` |
| Repair | `IMPLEMENTATION_READY` / cross-module handoff required |
| Build | `IMPLEMENTATION_READY` / cross-module handoff required |
| Publish | `BLOCKED_EXTERNAL` |

## Capability Registry

`AI_TOOL_DISCOVERY_READY = PASS`. `AutomationReadAPI.list_ai_callable_capabilities()` exposes only provider-neutral capability ID, description, input/output schema, risk, confirmation policy, availability/readiness, blockers, result type and execution-engine label. It does not expose raw Workflow JSON, nodes/connections, Legacy paths, Docker metadata, credentials or internal dataclasses.

## Result / Copy

`ProductResultArtifact` supports `TEXT`, `MARKDOWN`, `JSON`, `FILE`, `URL` and safe actions `COPY_TEXT`, `COPY_MARKDOWN`, `COPY_JSON`, `OPEN_FILE`, `COPY_FILE_PATH`, `OPEN_URL`, `COPY_URL`. JSON is canonicalized. Credential-bearing URLs, absolute/traversing file locators and invalid JSON fail closed. Copy payloads represent the final useful result, not raw execution JSON.

`MarkdownArtifactResolver` completes filename, root, relative-path, traversal, `.md`, UTF-8, 1 MiB, control-character, read-only and copy-payload handling. A synthetic Markdown artifact is fully read and copied in tests. Real external knowledge content was not read; therefore copy backend is `IMPLEMENTATION_READY`, not content `READY`.

## Health

Product projections keep three truths separate:

1. Provider Health: loopback process reachability/response.
2. Workflow Runtime: `NOT_OBSERVED` until an authorized runtime source provides current evidence.
3. Historical Result: sandbox success/partial/failure, never promoted to current Workflow state.

UI-safe attention states are `OK`, `NEEDS_CONFIGURATION`, `NEEDS_ATTENTION`, `FAILURE_OBSERVED`, `RUNTIME_UNKNOWN`, `AUTH_REQUIRED`. A healthy Provider with unavailable metadata is correctly `AUTH_REQUIRED`, not Workflow `RUNNING`.

## Run Lifecycle

The public control projection now carries the complete vocabulary `PREPARED`, `VALIDATED`, `WAITING_CONFIRMATION`, `READY_TO_DISPATCH`, `DISPATCH_BLOCKED`, `DISPATCHED`, `RUNNING`, `SUCCEEDED`, `PARTIAL`, `FAILED`, `CANCELLED`, `UNKNOWN`. Local pre-dispatch transitions are validated without side effects. The backend explicitly rejects attempts to manufacture `DISPATCHED` or `RUNNING`.

Blockers remain machine-readable, including `PROVIDER_UNCONFIRMED`, `AUTH_REQUIRED`, `INPUT_INVALID`, `TARGET_UNRESOLVED` and `EXECUTION_SURFACE_UNCONFIRMED` through the existing preparation/control contracts.

## Sandbox

Existing Legacy evidence remains reference authority: real isolated n8n engine, synthetic/stub dependencies, Workflow ID distinct from production, executions 42–47, and machine-readable success/partial/failure outcomes. Candidate contracts chain static validation, sandbox validation and safety report while requiring `TEST_ONLY`, no credential, no external network, no production target and no production Docker modification.

No Legacy runner was re-executed because it can write evidence into the frozen Legacy tree. The current Goal instead retained the already verified real sandbox evidence and tested the NEXA candidate lifecycle/policy offline. This preserves Legacy integrity while making future candidate validation locally executable inside an authorized NEXA candidate workspace.

## Repair / Build

Diagnosis/Repair contract:

`Failure -> Diagnosis -> Repair Request -> Repair Candidate -> Validation -> Sandbox Evidence -> Ready to Publish`

Build contract:

`Requirement -> Build Request -> LEGACY_REUSE_FIRST -> Candidate -> Validation -> Sandbox -> Publish Gate`

Candidate payloads retain source hash, base revision, changed artifact/hash, change summary, validation results, sandbox result, safety report and rollback requirement. Publish gate requires source/target identity, backup, restore instructions, static/sandbox pass, secret safety and user approval.

`prepare_queqiao_handoff()` reaches `QUEQIAO_HANDOFF_READY` with logical references, hash and bounded safe evidence; it performs no cross-module dispatch. Build is forced to consider existing Workflow, node patterns, error handling, result output and sandbox patterns before creation.

## UI Integration

`UI_DATA_READY = PASS`. `get_ui_reference_payload()` supplies synthetic Overview, three Workflow cards (`knowledge.collect`, success fixture, failure fixture), Workflow detail, Markdown Result with copy action, and Failure detail with retry/AI-diagnosis actions. The fixture is explicitly synthetic and side-effect-free.

Future UI/Core should call only:

- `AutomationReadAPI` for product backend, workflows, AI capabilities, readiness and UI projection;
- `AutomationControlAPI` for run preparation/lifecycle, result action, diagnosis/repair/build candidates and handoff preparation.

## Read API / Control API

- Sole public read facade: `AutomationReadAPI`
- Sole public control-intent facade: `AutomationControlAPI`
- Adapter, Domain, Snapshot, Result Intake, Unified Query and composition remain internal implementation details.
- n8n remains the sole Workflow executor; neither facade performs execution.

## Production Readiness Matrix

| Capability | Read | Provider Health | Run | Result Copy | Diagnose | Repair | Build | Publish |
|---|---|---|---|---|---|---|---|---|
| `knowledge.collect` | `READY` | `READY` with current injected Health; otherwise `NOT_READY` | `CONFIG_REQUIRED` / after identity `AUTH_REQUIRED` | `IMPLEMENTATION_READY` | `READY` | `IMPLEMENTATION_READY` | `IMPLEMENTATION_READY` | `BLOCKED_EXTERNAL` |

Machine responses use only the permitted readiness vocabulary: `READY`, `READY_WITH_CONFIRMATION`, `AUTH_REQUIRED`, `CONFIG_REQUIRED`, `IMPLEMENTATION_READY`, `NOT_READY`, `BLOCKED_EXTERNAL`.

## Tests

| Suite | Result |
|---|---:|
| Baseline at Goal start | `422/422 PASS` |
| New V0.2 tests | `25/25 PASS` |
| Targeted product/UI/control regression | `137/137 PASS` |
| Final full regression | `447/447 PASS` |
| Existing regression loss | `0` |

New coverage locks configuration candidate/confirmed behavior, Health four-state semantics and fake transport, Product view/attention, all Artifact types/actions, safe Markdown fixture read, complete Run lifecycle, safe 鹊桥 handoff, Repair/Build candidate contracts, AI discovery, readiness vocabulary, UI fixture parity, unique facades, no raw/secret exposure and no second engine.

## Legacy Integrity

| Metric | Final |
|---|---:|
| Recursive directories | `51` |
| Files | `294` |
| Bytes | `15,680,304` |
| Files modified during Goal | `0` |
| Latest Legacy file timestamp | `2026-08-05T16:07:02.9397592+08:00` |
| Legacy modification | `0` |

The frozen canonical Workflow hash test still passes, as do all source-reconciliation and six sandbox outcome tests. Legacy authority and effective ability are unchanged.

Frozen V0.1 contracts were not edited. Final SHA-256 values:

| Contract | SHA-256 |
|---|---|
| Automation Domain V0.1 | `EF86FC7760DC047A7F2323328F7CE0E56560A8734716BF2252C6C070097F7F86` |
| n8n Export Mapping V0.1 | `E7672A208705F827AEE38F7F2144E0145EB82FB8585128387CCC3F35AD5321E1` |
| Static Snapshot V0.1 | `A5D619CFC71E6647CE8464B567B95AD057FA752A7B87EFC382F2DFAB37612EB1` |
| Result Intake V0.1 | `8D0B97A07247783281DCE3253ACBF1C98ECAF740B237A8736513DC1AC88D127F` |
| Unified Read Model V0.1 | `A517AF9FC1471764354C7D4DFAB1100817215AA6D2DF68BFFA62E23EF8C3B1B9` |
| Read API V0.1 | `62F76BF82A1C71E4A1252E4D2C5B025E959DD4A6B40A52CB669A50EC481E9D5A` |
| UI Integration V0.1 | `56DE8418C618AE188CBE4C8277823E167BD2BCB2AEA52E5B121AACCB82782AD8` |

## Side Effects

| Item | Final |
|---|---:|
| External Network | `0` |
| Loopback Health GET | `1` successful request |
| Credential / Secret Read | `0` |
| Workflow Execution | `0` |
| Webhook / Form Submit | `0` |
| Production Import/Update/Activation | `0` |
| Production Publish | `0` |
| Docker Modification | `0` |
| 05 / 08 / Core / ExecutionHub Modification | `0` |
| Legacy Modification | `0` |
| Git push / public release | `0` |
| Second Workflow Engine | `NO` |

## Modified Files

Created:

1. `src/automation_center/product.py`
2. `tests/test_product_backend.py`
3. `fixtures/product_backend/v02.reference.json`
4. `docs/contracts/AUTOMATION_LOCAL_PRODUCT_BACKEND_V0.2.md`
5. `docs/audits/NEXA_AUTO_OVERNIGHT_CONTINUOUS_002.md`

Modified:

6. `src/automation_center/public_api.py`
7. `src/automation_center/control_api.py`
8. `src/automation_center/composition.py`
9. `src/automation_center/__init__.py`
10. `tests/test_ui_integration.py`

The workspace is not a Git repository, so this list is derived from task timestamps and the known edit set rather than `git diff`.

## External Blockers

Only genuine external blockers remain:

1. User/configuration confirmation of the formal Provider instance identity.
2. Auth-isolated Workflow metadata/revision and execution surface confirmation.
3. Authorization to associate and read the real external knowledge Markdown artifact.
4. Cross-module dispatch/wiring for 05 鹊桥, 08 星枢管家 and Core UI.
5. Production execution/import/update/activation/publish permission, credentials and final user approval.

## Next Cross-module Handoff

- **05 鹊桥:** consume the `QUEQIAO_HANDOFF_READY` logical payload and return bounded diagnosis/repair/build candidate material; never receive credentials or raw execution payload from Automation Center.
- **08 星枢管家:** discover tools with `list_ai_callable_capabilities()`, obtain reasons/blockers from Read/Control APIs, and submit only validated product inputs/control intents.
- **Core UI:** render `get_product_backend()`, `list_product_workflows()`, `get_production_readiness_matrix()` and UI projections; call Control API for intent actions. Do not import adapters, Domain internals, snapshots, Legacy paths or n8n node data.

No cross-module file was modified in this Goal.
