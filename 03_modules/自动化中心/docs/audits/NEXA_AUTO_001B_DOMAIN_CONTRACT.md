# NEXA-AUTO-001B｜Automation Domain Contract V0.1 验收报告

## Task ID

- Task：`NEXA-AUTO-001B`
- 前置任务：`NEXA-AUTO-001A`
- 日期：2026-08-10（Asia/Shanghai）
- 施工范围：`<PROJECT_ROOT>\03_modules\自动化中心`

## Status

**PASS**

Automation Domain Contract V0.1 已冻结。首轮实现后的完整测试一次通过，未开启第二轮修正。本任务没有实现 n8n Adapter、UI/ViewModel 或任何 Automation command。

## 读取的 001A 基线

已完整读取：

- `docs/audits/NEXA_AUTO_001A_BASELINE.md`
- `fixtures/n8n/workflow.synthetic.json`
- `tests/test_fixture.py`

采用的关键事实：2 个唯一 n8n workflow identity、5 个主导出、名称不唯一、Form/Error Trigger、static export 不代表 runtime truth、外部资产有 credential/日志/数据库风险、001A 测试 6/6 PASS、外部修改与真实执行均为 0。

001A 报告、fixture 和原测试均未修改。

## 创建/修改文件

本任务创建：

1. `src/automation_center/__init__.py`
2. `src/automation_center/domain/__init__.py`
3. `src/automation_center/domain/models.py`
4. `docs/contracts/AUTOMATION_DOMAIN_CONTRACT_V0.1.md`
5. `tests/test_domain_contract.py`
6. `docs/audits/NEXA_AUTO_001B_DOMAIN_CONTRACT.md`

没有修改已有文件，没有生成或保留 `__pycache__`，没有安装依赖。

## Domain Model 列表

核心模型全部建立：

| 模型 | 职责 |
|---|---|
| `AutomationProvider` | Provider instance、capability 与 provenance |
| `AutomationWorkflow` | Provider-scoped workflow、definition/runtime 状态、trigger 与 evidence refs |
| `AutomationRun` | 独立 run identity、RUN status、时间、摘要与 evidence refs |
| `AutomationStatus` | 强类型 scope/value/provenance 状态事实 |
| `AutomationTrigger` | Workflow-scoped trigger identity、统一类型与安全 provider metadata |
| `AutomationEvidence` | Evidence kind、authority、source、完整性与 synthetic/sanitized 标记 |

Supporting value objects/enums：`ProviderRef`、`WorkflowRef`、`RunRef`、`TriggerRef`、`EvidenceRef`、`Provenance`、`ProviderMetadata`、`ProviderCapability`、`StatusScope`、`StatusValue`、`TriggerType`、`EvidenceKind`、`EvidenceAuthority`。

## Identity 方案

V0.1 冻结：

```text
ProviderRef = (provider_kind, provider_instance_id)
WorkflowRef = (ProviderRef, external_workflow_id)
RunRef      = (ProviderRef, external_run_id)
TriggerRef  = (WorkflowRef, local_key)
```

- Workflow name/display_name 明确不属于 identity。
- 同名 workflow 可合法共存。
- 相同 external id 在不同 provider instance 下是不同 identity。
- `provider_instance_id` 可区分未来多个 n8n 实例。
- 文件路径、URL 不参与业务 identity。
- Synthetic evidence 不得声明真实 Provider source。

## Static / Runtime 状态边界

`AutomationWorkflow.definition_status` 与 `runtime_status` 是不同字段：

- `DEFINITION` scope 只接收 static/synthetic/manual authority。
- `RUNTIME` scope 只接收 runtime authority。
- `RUN` scope 只接收 execution authority。
- Static `ACTIVE` 不会自动产生 Runtime `ACTIVE`；缺少 runtime observation 时为 `runtime_status=None`。
- `UNKNOWN`、`INACTIVE`、`UNAVAILABLE` 是三个独立 enum value。
- `SUCCEEDED`、`FAILED` 等只能用于 `RUN` scope，并由 `AutomationRun` 持有。

## Evidence / Provenance 方案

`AutomationEvidence` 冻结：evidence id、kind、authority、可选 Provider source、安全逻辑 locator、timezone-aware captured time、可选 SHA-256、sanitized/synthetic、summary、schema version。

`Provenance` 冻结：`EvidenceRef + authority + observed_at`。Provider、Workflow、Definition/Runtime/Run Status、Trigger 均有直接 provenance path，Workflow/Run 还强制聚合必要 evidence refs。

Kind 与 authority 由模型校验，不允许 evidence source 超越其 authority。Synthetic fixture evidence 必须同时满足：

- kind = `SYNTHETIC_FIXTURE`
- authority = `SYNTHETIC`
- `synthetic=true`
- `sanitized=true`
- 不声明 Provider source

因此 synthetic evidence 不能冒充 Runtime API evidence 或 production evidence。

## Sensitive Data 处理

- 核心模型没有 credential、API key、token、cookie、Authorization header、password、完整 Provider payload、完整 execution input/output 或数据库记录字段。
- input/output 只接受限长字符串 summary，不接受任意 payload 对象。
- summary、display text、metadata value 对明显 bearer/API key/private-key pattern 有拒绝校验。
- `source_locator` 只允许安全逻辑 locator，拒绝 URL 和绝对路径。
- 所有 Evidence 必须 `sanitized=true` 才能进入合同。
- 这些校验是领域边界最后防线；Adapter 仍必须在映射前严格脱敏。

## Provider-specific 边界

完整 n8n workflow/node/execution JSON 不进入核心合同。可选 `ProviderMetadata` 被限制为：

- 最多 16 个 string/string entry；
- 单层、无 dict/list/任意深度结构；
- key 唯一并确定性排序；
- `sanitized=true`；
- 敏感 key 和明显 Secret value 被拒绝；
- 不得改变核心字段语义；
- 不作为 UI 核心业务逻辑依据。

Capability 是小型声明集，V0.1 只有 definition read、run read、trigger execution；源码不提供 execute/trigger/activate/deactivate/invoke/schedule command。

## Schema Version

- `CONTRACT_VERSION = "0.1"`
- 核心模型都带 `schema_version`，V0.1 只接受 `0.1`。
- 不实现 migration framework。
- 新增 optional field/patch 修正应保持旧 reader 兼容。
- identity semantic 改变属于 breaking change。
- status semantic 改变必须显式版本评审。
- provider metadata 不得反向改变核心字段含义。
- `serialize_contract` 使用排序 key、稳定集合顺序与 timezone-aware ISO 8601 datetime，保证确定性输出。

## 测试结果

执行：

```text
python -m unittest discover -s <PROJECT_ROOT>\03_modules\自动化中心\tests -p test_*.py -v
```

结果：

- 新增 Domain Contract：**21/21 PASS**
- 总计：**27/27 PASS**
- 用时：约 0.014 秒
- 施工/修正轮次：1（首轮通过，未开启第二轮）

新增测试覆盖：同名不同 identity、跨 instance identity、Static/Runtime 隔离、UNKNOWN/INACTIVE 区分、Run status scope、Form/Error Trigger、synthetic authority 防冒充、safe provider metadata、确定性序列化、时间约束、安全 locator、Secret pattern、防 command API、仅标准库依赖。

## 001A Regression

原 `test_fixture.py`：**6/6 PASS**。

原 synthetic fixture 保持 synthetic、inactive、sanitized、无 network/runtime/execution 权限标记；未作修改。

## 副作用与完整性计数

| 项目 | 结果 |
|---|---:|
| 网络调用 | 0 |
| n8n Runtime 启动/访问 | 0 |
| 真实 Automation 执行 | 0 |
| webhook/API 调用 | 0 |
| Docker/Database 操作 | 0 |
| 外部 n8n 修改 | 0 |
| 其他 NEXA 模块修改 | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |
| 其他外部 AI | 0 |

外部 n8n 元数据最终复核与 001A 基线完全一致：

- 递归项目数：345
- 文件数：294
- 根目录 LastWriteTimeUtc：`2026-08-04T07:17:14.5234225Z`
- 元数据 SHA-256：`BC81FC5112F125080F953C5CA57804885E81196788ED6D5EB6517134E2985A8B`

## Blockers

无。

## 主要限制

1. V0.1 没有连接真实 n8n Runtime/API，Runtime observation 仍需未来只读 Adapter 提供。
2. started/finished/duration 等 Run 时间字段缺少权威真实样例，因此保持 optional。
3. 未定义 Provider 状态 normalization、分页、重试、binary payload、完整错误模型或指标。
4. Capability 仅声明，不包含授权或 command protocol。
5. 未建立 n8n Adapter、Application Service、ViewModel 或 UI。

## 下一任务建议

在人工评审 V0.1 后，下一任务可建立**纯离线、只读的 n8n Export Adapter**，把 synthetic export 映射到本合同并增加 mapping contract tests。仍应禁止真实 API、Runtime、import、activate、execute、webhook、scheduler 和 credential 施工。

