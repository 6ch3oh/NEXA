# Automation Domain Contract V0.1

- Owner：NEXA Automation Center
- Schema version：`0.1`
- Status：Frozen
- Task：`NEXA-AUTO-001B`

## 1. Purpose

本合同定义 NEXA 自有、Provider-neutral 的最小 Automation 领域语言。Provider Adapter 把外部 Provider 结构归一化为本合同，Application、ViewModel 与 UI 只依赖本合同。

```text
External Provider -> Provider Adapter -> Domain Contract V0.1 -> Application / ViewModel -> NEXA UI
```

## 2. Scope

V0.1 冻结以下核心模型：

1. `AutomationProvider`
2. `AutomationWorkflow`
3. `AutomationRun`
4. `AutomationStatus`
5. `AutomationTrigger`
6. `AutomationEvidence`

同时冻结 Provider-scoped identity、Evidence/Provenance、Definition/Runtime/Run 状态边界、安全扩展和确定性序列化规则。

## 3. Non-goals

V0.1 不实现 n8n Adapter、n8n API、workflow import、activate/deactivate、执行、webhook、scheduler、credential 管理、数据库、UI、ViewModel 或 migration framework。Capability 只是声明，不是命令接口。

## 4. Identity Contract

`ProviderRef = (provider_kind, provider_instance_id)`。

`WorkflowRef = (ProviderRef, external_workflow_id)`。

`RunRef = (ProviderRef, external_run_id)`。

`TriggerRef = (WorkflowRef, local_key)`。

规则：

- **Workflow name is not identity.**
- `display_name` 与 identity 分离，名称允许重复和变化。
- `external_id` 只在一个 Provider instance 内有意义，不要求跨 Provider 唯一。
- `provider_instance_id` 必须区分同类 Provider 的多个实例。
- 文件路径、URL、workflow name 都不得充当业务 identity。
- synthetic fixture 使用明确的 synthetic identity/evidence，不得冒充真实 Provider identity。

## 5. Provider Contract

`AutomationProvider` 包含：

- `ref: ProviderRef`
- `display_name: Optional[str]`
- `capabilities: FrozenSet[ProviderCapability]`
- `provenance: Provenance`
- `schema_version: "0.1"`

V0.1 capability 只有 `definition_read`、`run_read`、`trigger_execution`。`trigger_execution` 仅表达 Provider 理论能力；合同不提供执行方法。

## 6. Workflow Contract

`AutomationWorkflow` 包含：

- Provider-scoped `ref`
- 非唯一 `display_name`
- 独立的 `definition_status` 与可选 `runtime_status`
- `triggers`
- `evidence_refs` 与 `provenance`
- 可选 `description`、`tags`
- 可选、脱敏、有界的 `provider_metadata`
- `schema_version`

Workflow 不包含完整 n8n nodes、connections、execution payload、credential、数据库记录或 Provider 原始 JSON。

## 7. Run Contract

`AutomationRun` 是独立于 Workflow definition 的实体，包含：

- Provider-scoped `RunRef`
- `workflow_ref`
- RUN scope 的 `status`
- 可选 `started_at`、`finished_at`
- 可选 `trigger_ref`
- 仅字符串摘要形式的 `input_summary`、`output_summary`
- `evidence_refs` 与 `provenance`
- 可选安全 `provider_metadata`

摘要不得保存完整 input/output payload。`SUCCEEDED`、`FAILED` 等只属于 RUN scope，不能成为 Workflow definition 状态。

## 8. Status Contract

`AutomationStatus` 是 `(scope, value, provenance)`：

| Scope | 允许的 Value | 允许的 Evidence authority |
|---|---|---|
| `DEFINITION` | `UNKNOWN`, `UNAVAILABLE`, `ACTIVE`, `INACTIVE` | static export / synthetic / manual |
| `RUNTIME` | `UNKNOWN`, `UNAVAILABLE`, `ACTIVE`, `INACTIVE` | runtime |
| `RUN` | `UNKNOWN`, `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` | execution |

`UNKNOWN`、`INACTIVE`、`UNAVAILABLE` 是三个不同值。`None` 只表示“没有这类 observation 对象”，不得被解释为其中任一状态。

## 9. Trigger Contract

`AutomationTrigger` 包含 stable `TriggerRef`、`TriggerType`、可选 display label、Provenance 和可选安全 provider metadata。

V0.1 支持 `FORM`、`ERROR`，并保留轻量 `MANUAL`、`SCHEDULE`、`WEBHOOK`、`OTHER`、`UNKNOWN` 枚举。不实现调度或触发逻辑。

Provider node type 可以作为经过允许列表与脱敏处理的浅层 metadata 值进入 adapter diagnostics，但不能成为 UI 核心业务规则。

## 10. Evidence Contract

`AutomationEvidence` 包含：

- `evidence_id`
- `kind`
- `authority`
- 可选 Provider `source`
- 安全逻辑 `source_locator`（禁止 URL 与绝对路径）
- timezone-aware `captured_at`
- 可选 SHA-256 `content_hash`
- `sanitized`、`synthetic`
- 可选 `summary`
- `schema_version`

Evidence Kind：`STATIC_EXPORT`、`RUNTIME_API`、`EXECUTION_RECORD`、`SYNTHETIC_FIXTURE`、`MANUAL_IMPORT`。

Kind 与 authority 必须匹配。所有进入领域合同的 evidence 必须 sanitized。Synthetic fixture evidence 必须 `synthetic=true`、authority 为 synthetic，且不得声明真实 Provider source。

## 11. Provenance Rules

`Provenance` 包含 `evidence_ref`、`authority` 与 timezone-aware `observed_at`。Provider、Workflow、Definition status、Runtime status、Run status 和 Trigger 都必须有直接或可解析的 EvidenceRef 路径。

**Evidence source must not be upgraded beyond its authority.**

Static export evidence 只能支持 static definition observation；execution evidence 只能支持 run observation；runtime evidence 才能支持 runtime observation。

## 12. Static vs Runtime Boundary

**Static exported state is not runtime truth.**

`definition_status` 与 `runtime_status` 是不同字段和不同 scope：

- export 中的 `active=true` 只能映射为 DEFINITION/ACTIVE observation；
- 它不会自动生成 RUNTIME/ACTIVE；
- 没有 runtime observation 时，`runtime_status=None`；
- Provider 明确返回未知时，建立 `RUNTIME/UNKNOWN`，不得用 false 代替；
- Run 状态只存在于 `AutomationRun.status`。

## 13. Sensitive Data Rules

核心合同禁止 credential content、password、API key、token、cookie、Authorization header、完整 Provider payload、完整 execution input/output、日志正文、数据库原始记录和真实 webhook URL。

所有摘要与 metadata 必须在 Adapter 边界脱敏、限长。模型拒绝明显 Secret pattern；这只是最后防线，不能替代 Adapter 的严格 sanitization。

## 14. Provider-specific Extension Rules

`ProviderMetadata` 是唯一通用扩展容器：

- optional；
- `sanitized=true`；
- 最多 16 个浅层 string/string entry；
- key 唯一、排序、受格式约束；
- 禁止敏感 key 与明显 Secret value；
- 禁止 dict/list/任意深度 payload；
- 不得反向改变核心字段语义；
- 不得成为 NEXA UI 核心业务逻辑依据。

完整 n8n workflow/node/execution schema 必须停留在 n8n Adapter 内。

## 15. Schema Versioning

领域常量和核心实体字段均固定为 `schema_version = "0.1"`。V0.1 reader 只接受 `0.1`。当前不实现 migration framework。

## 16. Compatibility Rules

- patch 修正或新增 optional field 不应破坏旧 reader。
- 删除字段、把 optional 改为 required、改变 identity semantic 属于 breaking change。
- status scope/value/authority semantic 改变必须显式版本评审。
- Provider-specific metadata 不得改变、覆盖或推导出相反的核心字段含义。
- 序列化使用 UTF-8 JSON、排序 key、稳定集合顺序、timezone-aware ISO 8601 datetime；同一对象必须产生相同字节文本。
- 未知 optional field 的未来 reader/writer 策略应在下一版本评审，不在 V0.1 中猜测实现。

## 17. V0.1 Known Limitations

- 只基于静态 export 与历史脱敏结构证据，未连接真实 n8n Runtime/API。
- 没有获得权威 started/finished/duration 样例，因此时间字段保持 optional。
- 没有定义 Provider status normalization adapter。
- 没有定义分页、重试、binary payload、完整错误模型或运行指标。
- 没有执行 capability 的授权、命令或审计协议。
- 没有 UI/ViewModel 合同。
- **Synthetic fixture must never be represented as production evidence.**
