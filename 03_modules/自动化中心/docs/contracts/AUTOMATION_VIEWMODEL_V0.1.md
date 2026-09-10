# Automation ViewModel Contract V0.1

- Owner：NEXA Automation Center
- Layer：Application Query / UI-safe projection
- Inputs：Automation Domain Contract V0.1 objects
- Status：Frozen

## 1. Purpose

为未来 NEXA UI 提供 provider-neutral、只读、可确定性序列化的静态 Workflow 列表、详情和 Overview。数据链路固定为：Provider raw → Adapter → Domain → Application Query → ViewModel → Future UI。

## 2. Inputs

`StaticWorkflowQueryService` 只接收已验证的 `AutomationWorkflow`、`AutomationProvider` 与 `AutomationEvidence`。它不读取 export 文件、不解析 n8n nodes、不扫描目录、不访问 Runtime、网络、数据库或 Run。

## 3. Workflow List Contract

`AutomationWorkflowListItemViewModel` 表达：Provider-scoped identity、display name、provider kind/instance/display、Definition status、Runtime availability/observation/status、分组 Trigger summary、Evidence source/authority/synthetic、observed time、provenance label、`last_run=None`。

默认排序：`display_name.casefold()` + provider kind + provider instance + external workflow id。

## 4. Workflow Detail Contract

`AutomationWorkflowDetailViewModel` 包含 list summary、可选 description/tags、UI-safe Evidence summaries 和已在 Domain 中受限的 shallow ProviderMetadata。

Detail 不包含 source locator、raw export、nodes、connections、parameters、credential reference、execution payload 或完整 Provider JSON。

## 5. Overview Contract

`AutomationOverviewViewModel` 包含：总 Workflow、Definition ACTIVE/INACTIVE/UNKNOWN/UNAVAILABLE、Runtime observed/not-observed/ACTIVE/INACTIVE/UNKNOWN/UNAVAILABLE、Provider count 和按类型排序的 Trigger counts。

Definition count 与 Runtime count 完全独立，任何 Definition ACTIVE 都不会增加 Runtime ACTIVE。

## 6. Identity Rules

Workflow identity 固定为 `(provider_kind, provider_instance_id, external_workflow_id)`。

**Workflow display name is not identity.**

同名 Workflow 均保留；重复的完整 identity 在 Query Service 构造时 fail closed。Detail 只接受 `WorkflowRef`，不支持按名称查询。

## 7. Status Presentation Rules

- Definition 直接展示 Domain status value，不改变其含义。
- Runtime observation 存在时，展示该 Domain Runtime status。
- `UNKNOWN` 不等于 `INACTIVE`。
- `NOT_OBSERVED` 不等于 `STOPPED`。
- **Definition ACTIVE is not Runtime ACTIVE.**

## 8. Runtime Unknown Rules

Domain `runtime_status=None` 投影为：

- `runtime_observed=false`
- `runtime_available=false`
- `runtime_status="not_observed"`

**No Runtime observation must not be presented as INACTIVE.**

若未来存在 Runtime/UNKNOWN observation，则 `runtime_observed=true`、status=`unknown`；不会改变 Definition status。

## 9. Trigger Presentation

Query 只相信 Domain `AutomationTrigger.trigger_type`，按 FORM、ERROR、MANUAL、SCHEDULE、WEBHOOK、OTHER、UNKNOWN 分组计数并使用通用 label。不得读取 node display name 或 parameters 重新猜类型。

## 10. Evidence / Provenance Presentation

ViewModel 保留 Evidence kind、authority、synthetic/sanitized、captured/observed time、安全 label 和可选 hash prefix。Source locator 本身不进入 ViewModel。

- STATIC_EXPORT 显示为 “Static export / captured evidence”，不得称为 live/current/realtime。
- SYNTHETIC_FIXTURE 显式显示 synthetic。
- RUNTIME_API 只有在真实 Runtime evidence 存在时才显示。
- Evidence authority 与 Workflow provenance 不一致时 fail closed。

**Synthetic evidence must remain visibly synthetic.**

## 11. Sensitive Data Rules

ViewModel 不定义 credential、Secret、API key、token、cookie、Authorization、raw payload、node parameters、execution input/output 或绝对 source path 字段。

ProviderMetadata 只能复制已经通过 Domain V0.1 校验的最多 16 项 shallow string/string entries。

**ViewModels must not expose raw n8n payload.**

## 12. Provider-neutral Boundary

Application/ViewModel 名称、identity、status、trigger、evidence 和 overview 均 provider-neutral。n8n-specific mapping 继续只存在于 `adapters/n8n_export.py`。Application 不 import Adapter。

## 13. Determinism

Query materialize 输入并按稳定 identity/sort key 处理；不依赖 set/filesystem/dict 偶然顺序或当前时间。Overview Trigger counts 按类型排序。`serialize_viewmodel` 使用 UTF-8 JSON、排序 key 与稳定 tuple 顺序。

## 14. Known Limitations

- V0.1 只做内存只读查询，不含 persistence、pagination、SQL、full-text engine 或缓存。
- 没有 Run query；`last_run` 固定为 `None`。
- 没有真实 Runtime observation 时全部显示 `not_observed`。
- 不实现 UI、Runtime Adapter、Execute、Trigger、webhook 或 scheduler。
- Evidence summary 不暴露完整 source locator 或完整 payload。
