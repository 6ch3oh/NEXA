# Automation Read Application API V0.1

- Contract ID: `AUTOMATION_READ_API_V0.1`
- Layer: Public Application Facade
- Version: `0.1`
- Status: Frozen

## 1. Purpose

本合同定义自动化中心唯一稳定的只读 Application Facade。未来 UI、Core composition、IPC 或其他只读消费者只依赖本 API，不直接依赖 Adapter、Snapshot、Result Intake、Unified Read Model 的内部模块或 dataclass 布局。

## 2. Scope

V0.1 提供 Overview、Workflow list/detail、Historical Result list/detail、Unresolved Result list，以及辅助的 Orphan Result list。它是 provider-neutral、read-only、deterministic、serialization-safe、side-effect-free 的内存查询边界。

## 3. Architecture

```text
Adapters -> Domain / Result Intake -> Application Query
         -> Unified Read Model -> AutomationReadAPI -> Future Consumers
```

Public Facade 只包装已经准备好的 `UnifiedAutomationQueryService`，不重写其 identity、join、latest、ordering 或三平面语义。

## 4. Public API Version

稳定版本常量为：

```text
AUTOMATION_READ_API_VERSION = "0.1"
```

每个顶层 success/error response 都包含 `api_version: "0.1"`。V0.1 不建立 migration framework。

## 5. Bootstrap Boundary

`build_read_api(query_service)` 只接受外围 composition root 显式准备并注入的 `UnifiedAutomationQueryService`。静态对象、Result Record、provider context 与 snapshot policy 的加载和选择发生在 API 外部。

The API never scans or executes the legacy n8n project.

API 初始化与调用均不得扫描文件、连接 Runtime、访问网络、读取数据库或触发 workflow。

## 6. Overview API

`get_overview()` 返回 Unified Overview 的 JSON-safe 投影，保留 static workflow/definition counts、historical result 双轴状态统计、sandbox、undated、unresolved、orphan 以及 Runtime observed/not-observed counts。V0.1 的 Runtime observed count 为 0。

## 7. Workflow List API

`list_workflows(...)` 返回稳定的 Workflow Read DTO 列表，包括完整 identity、display/provider presentation、definition status、trigger summary、snapshot state、Runtime non-observation、historical summary、latest historical summary 与 bounded diagnostics。

## 8. Workflow Detail API

`get_workflow(identity)` 仅按完整 `(provider_kind, provider_instance_id, external_workflow_id)` 查询。名称可以参与 list text filter，但不是 identity。不存在时返回 `not_found`；内部重复或其他不变量破坏不得任意选择记录，并应安全映射为 invariant error。

## 9. Result List API

`list_results(...)` 只返回 Unified Historical Result 的安全投影，保留 execution/workflow identity context、execution status、business status、timestamp、sandbox provenance、safe summary、bounded integrity 与 provenance completeness。

## 10. Result Detail API

`get_result(identity)` 仅按完整 `(provider_kind, provider_instance_id, execution_external_id)` 查询。不存在时返回 `not_found`；不得按 execution ID 单字段或数组位置猜测记录。

## 11. Unresolved Results

`list_unresolved_results(...)` 保留无法形成完整 provider-scoped workflow identity 的 Result，包括 known provider kind、workflow/execution external ID、双轴状态、timestamp、unresolved reason 与 provenance completeness。API 不丢弃记录、不猜 provider instance、不自动 join。

`list_orphan_results()` 提供已有完整 identity、但 supplied Static Definition 中未出现的历史 Result workflow projection。

## 12. Identity Input

调用方使用简单、可序列化 object 输入，不必构造内部 `ProviderRef`、`WorkflowRef` 或 Application dataclass：

```json
{"provider_kind":"n8n","provider_instance_id":"instance-001","external_workflow_id":"workflow-001"}
```

Execution identity 使用 `execution_external_id` 代替 `external_workflow_id`。字段集合不完整、多余、类型错误或空字符串时返回 `invalid_identity`，Python exception 不得逃逸。

## 13. Success Envelope

```json
{"api_version":"0.1","ok":true,"data":{}}
```

`data` 只包含 JSON-compatible projection，不携带内部对象引用。

## 14. Error Envelope

```json
{"api_version":"0.1","ok":false,"error":{"code":"not_found","message":"safe message","details":{"operation":"get_workflow"}}}
```

稳定错误 code 至少包含 `not_found`、`invalid_identity`、`invalid_query`、`ambiguous`、`internal_invariant_violation`；保留 `unresolved_identity` 作为窄扩展。message/details 不得包含 traceback、exception repr、绝对路径、raw payload 或 Secret。

## 15. Serialization

Response 只允许 `dict`、`list`、`str`、`int`、`float`、`bool`、`None`。datetime 输出明确 ISO-8601 字符串，Enum 输出稳定 string value。禁止返回 dataclass、Enum、datetime、Path、set、tuple 或 custom class instance。

`serialize_read_api_response` 使用 UTF-8 语义、sorted keys、compact separators 与 `allow_nan=False` 生成确定性 JSON。

## 16. Mutability Isolation

每次 API 调用都从内部 immutable/application object 生成 primitive，并经过 JSON round-trip 创建新的 dict/list。调用方修改返回值不会修改 Workflow、Unified Read Model、Result Record 或后续 response。

## 17. Filtering

Workflow list 只支持 provider kind、provider instance、definition status、trigger type 与 bounded text。Result list 只支持 execution status、business status、sandbox 与完整 workflow identity。Unresolved list 只支持 provider kind 与双轴 status。

V0.1 不支持 SQL-like query、regex、任意表达式、dynamic Python filter、pagination 或 cursor。

## 18. Ordering

Workflow ordering 沿用 001D/001H 的 display name + 完整 identity 稳定排序。Result ordering 沿用可信 timestamp descending；undated 固定置后；完整 execution identity 只作稳定展示 tie-breaker。Tie-breaker 不建立 recency，也不能在并列最大 timestamp 中宣称唯一 latest。

## 19. Static / Historical / Runtime Semantics

```text
STATIC DEFINITION != HISTORICAL RESULT != CURRENT RUNTIME
```

The public read API does not represent historical execution as current runtime state.

Historical success/failed 不改变 Runtime，Definition active/inactive 不覆盖 Historical Result。V0.1 Runtime 始终为 `not_observed` / observed false / available false，且不生成 online、offline、healthy now、failed now 或 currently running。

## 20. Security

Consumers must not depend on provider-specific raw payloads.

API 不传播 raw export、node parameters、raw execution payload/log、网页正文、敏感 URL、prompt、LLM raw output、credential、Secret、Authorization、Cookie、headers、binary 或绝对 Legacy path。只允许已经验证的 safe summary、bounded diagnostics 与 integrity prefix。

## 21. Non-goals

V0.1 不建立 HTTP server、Flask/FastAPI、IPC、Electron preload、UI、Core Extension、Runtime Reader、Fake Runtime Provider、Execute/Trigger/Scheduler、n8n API、Docker、database、network、Legacy scanner、raw log parser、cache 或跨模块 wiring。

## 22. Future Integration

未来 UI/Core/IPC composition root 可以准备 Application data context，再调用 `build_read_api`。任何 transport 只序列化本合同 envelope，不得把内部 Query Service、Adapter 或 provider-specific payload 暴露为新公共合同。

## 23. Compatibility Rules

- `api_version`、`ok`、success `data` 与 error `code/message/details` 是 V0.1 稳定顶层结构。
- 完整 provider-scoped identity、双轴 status、三平面分离与 Runtime non-observation 是兼容性语义。
- 已有字段不得在 V0.1 内被重解释；安全的 additive 字段需保持 JSON-safe 与 provider-neutral。
- breaking field/identity/semantic 变更需要新 API version 与总控授权。
- 消费者不得依赖内部文件路径、class 名称、dataclass field order 或 provider raw schema。

## 24. Known Limitations

- 仅内存只读 facade，无 persistence、database、cache 或 pagination。
- Result provider instance 仍可来自 caller-declared context，并不等于 Legacy self-confirmed identity。
- 当前真实 Static 与 sandbox Result 使用不同 provider instance，正确结果可以是 orphan 而非 joined。
- 部分 Result 可以无可信 timestamp，因此不参与 latest。
- 无 Runtime Reader、freshness、health、online/offline 或 execution capability。
- 001F Domain Evidence/authority correction 继续延期，本合同不修正 Domain V0.1。
