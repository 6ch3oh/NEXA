# NEXA-AUTO-001D｜Static Workflow Application Query + ViewModel V0.1 验收报告

## Task ID

- Task：`NEXA-AUTO-001D`
- 前置：`NEXA-AUTO-001A`、`001B`、`001C`
- 日期：2026-08-10（Asia/Shanghai）
- 模块：`<PROJECT_ROOT>\03_modules\自动化中心`

## Status

**PASS**

Provider-neutral Application Query Layer、Workflow List/Detail ViewModel、Automation Overview ViewModel、ViewModel Contract V0.1、离线测试与真实静态只读 Smoke 均已完成。没有实现 UI、Runtime API、Run Query、Execute 或跨模块接线。

## Preflight Baseline

已读取并核对：

- `NEXA_AUTO_001A_BASELINE.md`
- `NEXA_AUTO_001B_DOMAIN_CONTRACT.md`
- `NEXA_AUTO_001C_N8N_EXPORT_ADAPTER.md`
- `AUTOMATION_DOMAIN_CONTRACT_V0.1.md`
- `N8N_EXPORT_MAPPING_V0.1.md`
- 当前 `src/`、`tests/`、`fixtures/`

施工前真实基线：**54/54 PASS**，与 001C 回报一致。

冻结文档基线哈希：

- Domain Contract：`EF86FC7760DC047A7F2323328F7CE0E56560A8734716BF2252C6C070097F7F86`
- Mapping Contract：`E7672A208705F827AEE38F7F2144E0145EB82FB8585128387CCC3F35AD5321E1`

## Application Query

`StaticWorkflowQueryService` 只消费已经映射完成的：

- `AutomationWorkflow`
- `AutomationProvider`
- `AutomationEvidence`
- Workflow 内嵌的 Domain Status/Trigger/Provenance

API：

```python
list_workflows(
    provider_kind=None,
    provider_instance_id=None,
    definition_status=None,
    trigger_type=None,
    text=None,
)

get_workflow(identity: WorkflowRef)
get_overview()
```

Query Service 不读取文件、不 import Adapter、不扫描外部目录、不解析 n8n nodes、不访问 Runtime/Run/网络/数据库。

## ViewModels

### Workflow List

`AutomationWorkflowListItemViewModel` 表达：

- Provider-scoped stable identity
- display name
- Provider kind/instance/display name
- Definition status
- Runtime available/observed/status
- grouped Trigger summaries
- Evidence kind/authority/synthetic
- observed time 与 provenance label
- `last_run=None`

### Workflow Detail

`AutomationWorkflowDetailViewModel` 包含 list summary、可选 description/tags、安全 Evidence summaries 与已受 Domain 限制的 shallow ProviderMetadata。

不包含 source locator、raw export、nodes、connections、parameters、credential reference、Secret 或 execution payload。

### Automation Overview

`AutomationOverviewViewModel` 分别统计：

- total workflows
- Definition ACTIVE/INACTIVE/UNKNOWN/UNAVAILABLE
- Runtime observed/not-observed/ACTIVE/INACTIVE/UNKNOWN/UNAVAILABLE
- Provider count
- Trigger type counts

Definition 与 Runtime 计数完全独立。

## Identity 与 Duplicate Policy

唯一 identity 继续使用：

```text
(provider_kind, provider_instance_id, external_workflow_id)
```

- display name 不参与 identity。
- 两个同名不同 identity 的 Workflow 同时保留。
- `get_workflow` 只接受 `WorkflowRef`；按名称查询会拒绝。
- 重复完整 identity 在 Service 构造时抛出 `DuplicateWorkflowIdentityError`，不静默选取。

## Definition / Runtime Presentation

- Definition status 直接使用 Domain value，不改变语义。
- `runtime_status=None` 固定投影为：`runtime_observed=false`、`runtime_available=false`、`runtime_status="not_observed"`。
- `not_observed` 不会显示为 inactive、stopped 或 unavailable observation。
- Definition ACTIVE 不增加 Runtime ACTIVE count。
- 已测试未来 Runtime/UNKNOWN observation 可加入而不改变 Definition status。
- 无 Run 数据时 List/Detail `last_run` 都为 `None`，不从 active/updated/export metadata 推断。

## Sorting / Filtering

默认稳定排序：

```text
display_name.casefold()
+ provider_kind
+ provider_instance_id
+ external_workflow_id
```

V0.1 过滤仅支持 provider kind、provider instance、Definition status、Trigger type 和 display-name substring。没有 SQL、全文引擎、pagination 或 persistence。

## Trigger Presentation

只信任 Domain 已归一化的 `TriggerType`，投影为 provider-neutral label/count。覆盖 FORM、ERROR、OTHER，并为 MANUAL/SCHEDULE/WEBHOOK/UNKNOWN 保持稳定枚举空间。不读取 node name/parameters 重新猜类型。

## Evidence / Provenance Presentation

ViewModel 保留：Evidence kind、authority、synthetic/sanitized、captured/observed time、安全 source label 与可选 hash prefix。

- Static export 显示为 `Static export / captured evidence`，不称为 live/current/realtime。
- Synthetic fixture 显式展示 synthetic。
- source locator 本身不进入 ViewModel。
- Workflow provenance authority 与 Evidence authority 不一致时 fail closed。
- Evidence authority 不在 Application 层升级。

## Sensitive Data

- ViewModel 没有 raw export、node、parameter、credential、Secret、execution payload 或 absolute source path 字段。
- 只复制已通过 Domain V0.1 校验的最多 16 项 shallow ProviderMetadata。
- 测试确认 fake credential marker、authorization、parameters、nodes、raw 与 source locator 不出现在序列化 ViewModel。

## 真实静态 Smoke

链路：5 个已授权真实 export → 001C Adapter → Domain → Application Query → ViewModel。

所有读取均为单文件、只读、纯内存。没有保存真实 raw payload、id、name、parameters 或 credential reference。

5 个 export 中有 4 个共用同一 identity。Smoke 首先确认把 5 个 Domain Workflow 直接交给 Query Service 会触发明确 duplicate rejection；随后由调用方显式指定 EXPORT-002 与 EXPORT-005 作为两个 identity 的代表快照，避免静默去重。

安全聚合结果：

| 指标 | 结果 |
|---|---:|
| Mapped exports | 5 |
| Unique identities | 2 |
| Duplicate collection rejected | true |
| ViewModel workflows | 2 |
| Providers | 1 |
| Definition ACTIVE | 0 |
| Definition INACTIVE | 2 |
| Definition UNKNOWN | 0 |
| Runtime Observed | 0 |
| Runtime Not Observed | 2 |
| FORM triggers | 2 |
| ERROR triggers | 1 |
| Safe serialization check | true |

外部 5 个 export 前后 size/SHA-256 mismatch：**0**。

## Tests

最终结果：

- 新增 Application/ViewModel tests：**33/33 PASS**
- 001A–001C Regression：**54/54 PASS**
- 总计：**87/87 PASS**
- 最终用时：约 0.020 秒

首次全量验证为 86/87：唯一失败是静态依赖测试把合法相对 import `.viewmodels` 识别为不允许的根模块。仅修正测试允许列表，未修改 production code、Domain 或 Mapping 语义；随后 87/87 通过。整个任务仍在单次 Codex 施工内完成，未调用第二模型或外部模型。

## Domain / Mapping Contract Modification

- Domain Contract semantic 修改：**0**
- Mapping Contract semantic 修改：**0**
- Domain source 修改：**0**
- n8n Adapter 修改：**0**

最终哈希与 preflight 冻结文档哈希一致。

## 创建/修改文件

本任务创建：

1. `src/automation_center/application/__init__.py`
2. `src/automation_center/application/queries.py`
3. `src/automation_center/application/viewmodels.py`
4. `tests/test_application_viewmodels.py`
5. `docs/contracts/AUTOMATION_VIEWMODEL_V0.1.md`
6. `docs/audits/NEXA_AUTO_001D_APPLICATION_VIEWMODEL.md`

测试文件在首次验证后做 1 行 allowlist 修正。其他既有文件均未修改。

## 副作用计数

| 项目 | 结果 |
|---|---:|
| Network | 0 |
| n8n Runtime | 0 |
| Automation Execution | 0 |
| Run Query | 0 |
| UI | 0 |
| webhook/scheduler | 0 |
| Docker/Database | 0 |
| 外部 n8n 修改 | 0 |
| 其他 NEXA 模块修改 | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |
| 其他模型 | 0 |

## Contract Correction

不需要。`CONTRACT_CORRECTION_REQUIRED = false`。

## Known Limitations

1. 只做进程内静态 Domain collection 查询，没有 persistence、cache、pagination 或跨模块 wiring。
2. 没有真实 Runtime observation；当前真实 ViewModel 全部为 `not_observed`。
3. 没有 Run Query；`last_run` 固定为 `None`。
4. 同一 Workflow 的多份静态快照尚无版本选择/合并合同，调用方必须显式选代表，重复 identity 默认拒绝。
5. 没有 UI、Runtime Adapter、Execute、Trigger 或 scheduler。

## 下一任务建议

先人工评审 ViewModel Contract 与 duplicate snapshot policy。若后续授权，可单独冻结“静态快照选择/组合”Application Contract；在此之前不要接 UI、Runtime API、Run Query、Execute 或跨模块 wiring。

