# NEXA-AUTO-LEGACY-RECONCILE-001｜Source Reconciliation 审计报告

## Task

- Task ID: `NEXA-AUTO-LEGACY-RECONCILE-001`
- Date: 2026-08-11 (Asia/Shanghai)
- NEXA module: `<PROJECT_ROOT>\03_modules\自动化中心`
- Legacy source: `E:\个人数字资产中心\02_项目工作台\n8n_工作流开发`
- Legacy access: **STRICT READ ONLY**
- Status: **PASS**
- Baseline after 001I: **246/246 PASS**
- Final regression: **246/246 PASS**
- Production-code integration required: **NO**

本任务对完整 Legacy 源码/资产与 NEXA 自动化中心冻结链进行 source reconciliation。它只判断职责、重叠、复用方式和未来依赖边界；没有新增自动化中心功能，没有删除、重写或迁移冻结资产，也没有执行 Legacy workflow、Docker、n8n Runtime、网络或 API。

## Baseline Update

001I 已正式通过，因此本次基线不再使用 195：

```text
Ran 246 tests
OK
```

001I 历史报告中记录的 `195` 是该任务施工前的历史基线，本次不重写历史报告。Source Reconciliation 的 Baseline 与 Final 均以当前真实 `246` 为准。

## Reconciliation Method

只读取证包括：

- NEXA 当前 `src/`、`tests/`、`fixtures/`、七份冻结合同与既有审计报告；
- Legacy 全量 294 文件 inventory 和代码文件清单；
- Legacy `AGENTS.md`、README、Result extractor、isolated execution runner、deployment validator、V2 validator；
- 两份已授权 machine-readable Result artifacts 的 schema keys；
- NEXA package exports、module imports、Public API surface 与测试证据；
- 全量 Legacy 内容哈希聚合与关键 NEXA 文件 SHA-256。

未读取或输出 credential/Secret 值、环境变量值、SQLite 内容、raw execution payload、网页正文或 LLM raw output。

## Source Inventory Facts

Legacy 当前保持既有基线：

| Metric | Value |
|---|---:|
| Direct + recursive directories | 51 |
| Files | 294 |
| Total bytes | 15,680,304 |
| Python files | 16 |
| PowerShell files | 5 |
| JSON files | 74 |
| Markdown files | 50 |
| Log files | 123 |
| Importable Python package markers (`__init__.py`) | 0 |
| Relative-path + size + file-SHA256 aggregate | `2CBA45024734594BFF261A454DA9DD81E1FC8B8AB1B694AC1A3602134602CC6F` |

Legacy 是 workflow exports、专项脚本、deployment/runtime test tooling 与 evidence archive 的集合；不是供 NEXA consumer import 的 provider-neutral library/package。

## Direct Answers Required by 00-01

### 1. Legacy 是否存在等价统一只读消费 API

**NO.**

完整源码清单中没有 importable package，也没有 `AutomationReadAPI`、API version/envelope、`list_workflows`、`get_workflow`、`list_results`、`get_result`、`list_unresolved_results` 或 `get_overview` 的统一 consumer surface。

Legacy 的可读能力分散在：

- workflow JSON 本身；
- `deploy_validate.py` 静态预检；
- `extract_authbridge2_results.py` 专项执行日志解析；
- machine-readable parsed results/run summary；
- report 与部署/隔离测试脚本。

它们没有 provider-neutral identity、三平面 read contract、统一 JSON envelope、mutable isolation 或 consumer compatibility version。

### 2. AutomationReadAPI 是否只是薄 facade

**YES.**

源码证明构造函数只接收显式准备的 `UnifiedAutomationQueryService`。公开调用委托给：

- `get_overview`
- `list_workflow_read_models`
- `get_workflow_read_model`
- `list_historical_results`
- `get_result_by_execution_identity`
- `list_unresolved_results`
- `list_orphan_results`

Facade 自身只做简单 identity DTO 转换、已授权字段过滤、稳定 success/error envelope 和 JSON defensive copy。它不 import Adapter，不加载 Export/Result 文件，不扫描 Legacy，不解析 raw log，也不建立 join/latest/runtime 语义。

### 3. 是否重新实现 Legacy workflow/result/runtime 能力

**NO.**

- Workflow：NEXA Export Adapter 只把显式 n8n Export 映射到 provider-neutral Domain；没有复制 Legacy workflow node business logic。
- Result：NEXA Result Intake 直接读取既有两份 machine-readable artifacts，并用 allowlist 排除 `source_url`、`web_text`、`web_error_message`、`node_path` 和 log paths；没有复制 raw execute-log forensic parser。
- Runtime：NEXA 没有 Runtime Reader。`runtime=not_observed` 是明确非观察，不是 Legacy Runtime 的替代实现。
- Execute：NEXA 没有复制 `run_isolated_tests.ps1` 的本地 service、Docker import 或 `execute --rawOutput` 行为。
- Deploy：NEXA 没有复制 Legacy deployment/import/production confirmation scripts。
- Knowledge collector：NEXA 只保留 V2 静态候选与 result-contract 边界，没有重新实现其搜索、LLM、文件输出或业务 workflow。

### 4. 是否应成为未来 NEXA UI/Core 的稳定入口

**YES — `KEEP / NEXA_INTERNAL`.**

未来 NEXA UI/Core/IPC composition 应以顶层 `automation_center` package export 的 `AutomationReadAPI`、version、identity input helper、factory 与 response serializer 为稳定读取入口。外围 composition root 可以使用内部 bootstrap 组件准备 `UnifiedAutomationQueryService`，但普通消费者不应越过 facade。

该裁定不授权当前进行 UI、Core 或 IPC 接线。

### 5. 哪些内部 API 不应被未来消费者直接调用

普通 UI/Core read consumer 不应直接 import：

- `automation_center.adapters.n8n_export.N8nExportAdapter`
- `automation_center.adapters.result_intake.LegacyExecutionResultAdapter`
- `automation_center.domain.ProviderRef` / `WorkflowRef` 与其他 Domain dataclass
- `automation_center.application.StaticWorkflowSnapshotSelector`
- `automation_center.application.StaticWorkflowQueryService`
- `automation_center.application.HistoricalResultQueryService`
- `automation_center.application.UnifiedAutomationQueryService`
- `serialize_viewmodel` / `serialize_result_record` / `serialize_unified_read_model`
- `snapshots.py`、`viewmodels.py`、`results.py`、`unified.py` 中的具体 dataclass layout
- 任意 Legacy 文件路径、raw JSON schema、log parser 或 execution/deployment script

这些内部组件可以由自动化中心自己的 composition/bootstrap 层使用；它们不是跨模块 consumer contract。

## Capability Reconciliation

| Capability | Legacy evidence | NEXA implementation | Relationship |
|---|---|---|---|
| Workflow business logic | Real n8n exports/nodes/connections | None; only normalized definition projection | No reimplementation |
| Static export validation | `deploy_validate.py` and validators | `N8nExportAdapter` + Domain validation | Complementary; different output/consumer purpose |
| Snapshot/version choice | Historical copies, hashes and reports | Explicit provider-scoped snapshot contract | NEXA adds normalized deterministic boundary |
| Runtime execution | Docker/CLI isolated runner | None | Legacy-only; not merged |
| Current runtime read | No reusable reader | None, explicit `not_observed` | No duplication |
| Raw result extraction | Log/SQLite-oriented forensic helpers | None | Reference-only |
| Result artifact intake | Machine-readable JSON artifacts | Allowlist `LegacyExecutionResultAdapter` | Narrow merge through normalized boundary |
| Workflow + result composition | None | `UnifiedAutomationQueryService` | NEXA-only |
| Consumer read facade | None | `AutomationReadAPI V0.1` | NEXA-only |
| Knowledge collection | V2 n8n workflow candidate | Static/result-contract reference only | Not reimplemented |
| Deployment | Test/production scripts | None | Legacy-only; not a NEXA read concern |

## Classification Rules

- `KEEP`: current NEXA asset has a distinct required responsibility and valid tests/contracts.
- `MERGE`: retain Legacy facts through an existing narrow adapter; do not copy raw implementation.
- `REPLACE_PARTIALLY`: only if a current implementation must be narrowed or replaced in a later authorized task.
- `REFERENCE_ONLY`: retain as evidence/design/tooling reference; not part of NEXA runtime/read dependency graph.
- `DELETE_CANDIDATE`: potential removal only after a separate retention/deletion decision; never deleted here.

## Frozen NEXA Asset Classification

| NEXA asset | Classification | Scope | Source proof |
|---|---|---|---|
| Automation Domain V0.1 | `KEEP` | `NEXA_INTERNAL` | Provider-scoped identity/evidence semantics absent from Legacy consumer surface |
| n8n Export Mapping V0.1 + adapter | `KEEP` | `NEXA_INTERNAL_BOOTSTRAP` | Maps explicit raw export to normalized Domain; does not execute workflow |
| Static Snapshot V0.1 | `KEEP` | `NEXA_INTERNAL_BOOTSTRAP` | Deterministic full-identity selection not supplied by Legacy |
| Static ViewModel/Query V0.1 | `KEEP` | `NEXA_INTERNAL` | Provider-neutral UI-safe projection absent from Legacy |
| Result Intake V0.1 + adapter | `KEEP` | `NEXA_INTERNAL_BOOTSTRAP` | Consumes artifacts allowlist-first; does not rebuild Legacy parser |
| Unified Read Model V0.1 | `KEEP` | `NEXA_INTERNAL` | Only component composing static/historical/unresolved/orphan safely |
| Automation Read API V0.1 | `KEEP` | `NEXA_INTERNAL_PUBLIC_FACADE` | Only stable versioned consumer entry |

No frozen NEXA asset is classified `REPLACE_PARTIALLY`, `REFERENCE_ONLY` or `DELETE_CANDIDATE` by current source evidence. “Frozen” still does not promise permanent retention; a later task may revisit these classifications with new architecture evidence.

## 001I Asset Classification

| Asset | Classification | Decision |
|---|---|---|
| `src/automation_center/public_api.py` | `KEEP / NEXA_INTERNAL` | Thin facade; no Legacy equivalent |
| `docs/contracts/AUTOMATION_READ_API_V0.1.md` | `KEEP / NEXA_INTERNAL` | Freezes consumer/serialization/security boundary |
| `tests/test_read_api.py` | `KEEP / NEXA_INTERNAL` | Guards 51 API, isolation, safety and no-side-effect requirements |
| `fixtures/read_api/responses.synthetic.json` | `KEEP / NEXA_INTERNAL` | Synthetic consumer-shape compatibility evidence |
| `src/automation_center/__init__.py` export | `KEEP / NEXA_INTERNAL_PUBLIC_EXPORT` | Keeps consumers off internal modules |

Integrity at reconciliation start:

| Asset | SHA-256 |
|---|---|
| `public_api.py` | `AA8F3F97E5A5C642909852B202D4675CC993ED1ED18FD2703F349F687B682CBC` |
| Read API contract | `62F76BF82A1C71E4A1252E4D2C5B025E959DD4A6B40A52CB669A50EC481E9D5A` |
| Read API tests | `AD529FB805C23776A3382F7B0C6230E4EBCAB273C132DDA15E3B175F947FA533` |
| Read API fixture | `AD2A273EB1698D2085F2B699C00EF1AB6F0EFC8DDE7A70C0CC6E5ABCBD56D476` |
| Package export | `3E3F9AF183F996E3A3A78F6F3023B3B9B823F5C7A88CC88CF9189A87C7E9E7A1` |

## Legacy Asset Classification

| Legacy asset group | Classification | NEXA treatment |
|---|---|---|
| Five primary workflow exports | `MERGE` | Explicit-input-only mapping into Static plane; raw files remain Legacy |
| Final parsed result + run summary | `MERGE` | Allowlist intake into Historical Result plane; raw fields/paths excluded |
| Raw execute/import logs | `REFERENCE_ONLY` | Evidence archive; never a direct consumer input |
| `extract_authbridge2_results.py` and other forensic extractors | `REFERENCE_ONLY` | Field/status provenance reference; do not copy parser |
| `run_isolated_tests.ps1` / prepared test workflows | `REFERENCE_ONLY` | Legacy test executor; never call from Read API |
| `deploy_validate.py` and deployment scripts | `REFERENCE_ONLY` | Static/deployment reference; no merge into consumer facade |
| V1.4/V1.4.1 business workflow behavior | `REFERENCE_ONLY` | Product capability remains in n8n asset, not Python reimplementation |
| V2 Knowledge Collector candidate | `REFERENCE_ONLY` | Future capability/result-contract evidence only |
| OpenCode/DeepSeek hub and auth-bridge assets | `REFERENCE_ONLY` | Outside Automation Read consumer architecture |
| SQLite/WAL/SHM and duplicated historical evidence | `REFERENCE_ONLY` | Retention/archive concern; no direct NEXA intake |

No Legacy file is marked `DELETE_CANDIDATE` in this task because evidence retention requirements and authoritative ownership have not been separately adjudicated.

## Schema Boundary Proof

Legacy final parsed result contains top-level `phase/workflow_id/cases`; each case includes `execution_id/test_output_reached/node_path/fields`. Its fields include `source_url`, `web_text` and `web_error_message`. Legacy run summary includes `import_log` and `execute_log` paths.

The NEXA Result Intake intentionally retains only normalized identity, separate execution/business status, bounded timestamp/summary, explicit sandbox provenance, diagnostic codes and integrity hashes. The Public API then serializes the Unified projection without raw source fields or Legacy paths.

This proves the NEXA layers are a narrowing boundary, not a duplicated Legacy result/runtime implementation.

## Package Boundary Decision

Approved stable consumer imports are the top-level exports:

```text
AUTOMATION_READ_API_VERSION
AutomationReadAPI
WorkflowIdentityInput
ExecutionIdentityInput
ReadAPIErrorCode
build_read_api
serialize_read_api_response
```

`CONTRACT_VERSION` remains an existing Domain version export. All Application/Adapter internals remain implementation/bootstrap details even though Python currently permits importing them.

## Minimum Necessary Integration

**NONE.**

The existing architecture already has the correct narrow integrations:

```text
Explicit Legacy Export -> N8nExportAdapter -> Static plane
Explicit Legacy machine result -> LegacyExecutionResultAdapter -> Historical plane
Static + Historical -> UnifiedAutomationQueryService
Unified service -> AutomationReadAPI
```

Adding another adapter, copying Legacy validators/parsers, or exposing Unified internals would create duplication rather than reconciliation. Therefore this task changes no production code, package export, contract, fixture or test.

## Regression

```text
Baseline: Ran 246 tests — OK
Final:    Ran 246 tests — OK
```

No new functional test was needed because no implementation changed. Existing 51 Read API tests already cover version, full identity, envelopes, serialization, isolation, filtering, security, ordering, explicit bootstrap and absence of Runtime/network/execution behavior.

## Frozen Integrity

The following contract hashes remain unchanged:

| Contract | SHA-256 |
|---|---|
| Automation Domain V0.1 | `EF86FC7760DC047A7F2323328F7CE0E56560A8734716BF2252C6C070097F7F86` |
| n8n Export Mapping V0.1 | `E7672A208705F827AEE38F7F2144E0145EB82FB8585128387CCC3F35AD5321E1` |
| Static Snapshot V0.1 | `A5D619CFC71E6647CE8464B567B95AD057FA752A7B87EFC382F2DFAB37612EB1` |
| Static ViewModel V0.1 | `2E9F2A0BCEC6C2E2330BBC201DC77684D4AF5D05E3F01AD81E649C2BE2BCB8C2` |
| Result Intake V0.1 | `8D0B97A07247783281DCE3253ACBF1C98ECAF740B237A8736513DC1AC88D127F` |
| Unified Read Model V0.1 | `A517AF9FC1471764354C7D4DFAB1100817215AA6D2DF68BFFA62E23EF8C3B1B9` |
| Automation Read API V0.1 | `62F76BF82A1C71E4A1252E4D2C5B025E959DD4A6B40A52CB669A50EC481E9D5A` |

## Side Effects

| Item | Count / State |
|---|---:|
| NEXA production-code modifications | 0 |
| Frozen contract modifications | 0 |
| Test/fixture modifications | 0 |
| Legacy modifications | 0 |
| Other NEXA module modifications | 0 |
| Runtime Reader | NO |
| Domain V0.2 | NO |
| Network | 0 |
| n8n Runtime connections | 0 |
| Workflow executions | 0 |
| Docker operations | 0 |
| HTTP / IPC / UI / Core integration | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |

Only this audit report was created in the authorized NEXA automation-center documentation area.

## Final Decision

`AutomationReadAPI V0.1 = KEEP / NEXA_INTERNAL`.

There is no equivalent provider-neutral Legacy consumer facade. The API is a thin wrapper over NEXA normalized read models, does not reimplement Legacy workflow/result/runtime capabilities, and should remain the stable future UI/Core read entry. Internal Adapter/Domain/Snapshot/Query/Unified APIs must not become ordinary consumer dependencies.

Return this report to 00-01 and stop. Do not continue with new Automation Center functionality, UI/Core wiring, Runtime Read, Domain V0.2, Execute, migration, replacement or deletion.
