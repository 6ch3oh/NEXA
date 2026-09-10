# Automation Result Intake Contract V0.1

## 1. Purpose

本合同定义 NEXA 自动化中心如何只读消费既有、机器可读的历史 execution/business result，并将其转换为安全、provider-neutral 的 Result Intake Record。它解决结果摄取边界，不解决当前 Runtime 观测。

## 2. Result-Only Architecture

正式架构为 `RESULT_ONLY`，允许一个薄 `EXECUTION_RESULT_READ` adapter：

```text
existing machine-readable result
  -> allowlist normalization
  -> AutomationExecutionResultRecord
  -> historical result query/projection
```

Result Record 不等于 Runtime Observation，也不等于当前 Workflow Status。

## 3. Source Types

V0.1 接受明确传入的 final machine-readable result artifact 与对应 run summary artifact。报告可作为逻辑 reference。raw logs、SQLite、Runtime API、Docker、webhook、scheduler、workflow invocation 和生产 credential 不属于输入类型。

## 4. Result Record

最小记录为 `AutomationExecutionResultRecord`，安全表达：

- provider kind 与可选 provider instance context；
- workflow external ID 与 execution external ID；
- execution status 与 source execution status；
- business status 与 source business status；
- result type、固定格式 safe summary、可选 observed timestamp；
- ResultSourceEvidence、source integrity、sanitized result integrity；
- provenance completeness 与 bounded diagnostics。

该记录属于 Intake/Application boundary，不是第二套长期核心 Domain Evidence 或 AutomationRun。

## 5. Execution Status Axis

Execution Engine Status 描述 execution 层是否完成：

- `SUCCESS`
- `FAILED`
- `UNKNOWN`
- `NOT_OBSERVED`

V0.1 可从明确 execution status 或 CLI exit code 进行窄映射。未观测不能伪装为失败；未知不能猜测。

## 6. Business Status Axis

Business Result Status 描述采集、Knowledge 或 workflow 业务结果：

- `SUCCESS`
- `PARTIAL`
- `FAILED`
- `UNKNOWN`
- `NOT_REPORTED`

业务状态只从既有机器字段映射。仅存在于叙述性报告中的 `BLOCKED`、`PARTIAL` 或 `UNKNOWN` 不自动注入某次 execution。

## 7. Status Independence

Execution success and business success are independent facts.

`execution_status = SUCCESS` 与 `business_status = PARTIAL` 或 `FAILED` 均可能合法：workflow 可以捕获下游业务失败并正常到达终点。禁止用一个轴自动覆盖另一个轴。

## 8. Provider Instance Context

Provider instance identity 只能来自调用方显式提供的 local intake context，并标记 `CALLER_DECLARED`；这不是 Legacy execution 自证。未提供时必须保持 `PROVIDER_INSTANCE_UNRESOLVED`，禁止从文件路径、容器名、workflow 名或 hash 猜测 production provider instance。

## 9. Execution Identity

可拼接的完整 execution identity 是：

```text
(provider_kind, provider_instance_id, execution_external_id)
```

provider instance unresolved 时不得建立该 identity，也不得只凭 execution ID join 到已有 Workflow。查询必须 fail closed。

## 10. Workflow Identity

`workflow_external_id` 必须存在于 machine-readable result，并作为来源事实保留。它不携带 provider instance，因此不能单独升级为完整 NEXA Workflow identity。缺失 workflow ID 时整个 intake fail closed。

## 11. Sandbox Provenance

Legacy V1.4.1 结果分类为：

```text
SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES
```

维度必须同时保留：`REAL_N8N_ENGINE`、`SANDBOX_ISOLATED`、`SYNTHETIC_OR_STUBBED`。

Sandbox real execution with synthetic dependencies must not be presented as production execution.

该分类也不能被简化成纯 synthetic fixture，因为真实 n8n engine 确实执行过。

## 12. Intake Evidence

`ResultSourceEvidence` 是轻量 Intake Boundary Evidence，记录 source artifacts、report ref、分类与 provenance completeness。它不进入被冻结的 `AutomationEvidence`，不提供 Runtime/Execution authority，也不触发 Domain promotion。

## 13. Source Integrity

每份实际读取的 source artifact 必须记录 artifact kind、逻辑 reference、byte size 与 SHA-256。多份 artifact 的 bundle hash 必须按固定字段、固定顺序确定性计算。任务前后必须验证实际 Legacy source 的 size/SHA，要求 0 mismatch。

## 14. Sanitized Result Integrity

每条安全 normalized result 必须有独立 SHA-256。该 hash 只覆盖 allowlist 后的稳定标量与分类，不覆盖被排除的 raw payload。sanitized hash 与 source artifact hash 含义不同，禁止互换。

## 15. Safe Summary

safe summary 必须是由 normalized enum 和安全布尔值生成的 bounded 固定格式文本。禁止复制 source URL、网页正文、error payload、prompt、LLM output、日志片段、路径、credential 或 Secret。diagnostic 也只能使用固定消息，不能回显源值。

## 16. Legacy Parser Boundary

NEXA must consume existing result artifacts instead of rebuilding the legacy execution evidence parser.

Legacy 专项 parser 继续负责 raw execution evidence 的 forensic extraction。NEXA reader 只消费最终 machine-readable artifacts，允许很小且确定的格式 normalization；不得复制 47 份 execute logs 的解析逻辑，也不得把 raw logs 变成日常输入。

## 17. V1.4.1 Mapping

V1.4.1 可映射 workflow ID、execution ID、execution outcome、`webpage_read_status`、可选 `web_checked_at`、有限安全 scalar 与是否到达测试输出节点。业务值 `success` 映射 `SUCCESS`；`empty`、`forbidden`、`rate_limited`、`not_provided` 映射 `PARTIAL`；`failed` 映射 `FAILED`。

完整网页正文、source URL、完整 error message、node path、raw runData 与日志路径必须剔除。

## 18. V2.0 Boundary

V2.0 Knowledge Collector 当前是结果合同候选/静态验证设计，不是 production execution verified。V0.1 可以保留 provider-neutral `ResultType` 和 future-safe envelope，但不建立 V2 完整业务模型，不为未执行的真实搜索/模型/文件输出链生成 execution evidence。

## 19. Historical Result Semantics

Historical execution result is not current workflow runtime state.

Result Record 表达某一次已经发生的 execution/business processing 留下的历史结果证据。历史 success 不得显示为 workflow currently active、healthy、running 或 fresh。所有 list/summary projection 必须标记 `historical_result_only = true` 与 `current_runtime_inference_allowed = false`。

## 20. Runtime Non-goals

V0.1 不提供 Workflow Runtime Reader、Runtime status、Runtime Overview、freshness、polling、run query、FakeRuntimeProvider、n8n API、Docker、execute、webhook 或 scheduler。不得修改冻结的 Runtime/Run authority 语义，也不得恢复 001F。

## 21. Promotion to Domain Rules

Result Intake Record、ResultSourceEvidence 和 result status enum 只属于本边界。禁止 promotion 到 `AutomationRun`、`AutomationEvidence`、Domain status 或 provider capability。未来只有在总控明确授权 Domain contract correction/version 后，才能定义正式 promotion 规则。

## 22. Security

实现必须 allowlist-first，并阻断 credential、credentials、password、secret、token、API key、Authorization、Cookie、headers、raw payload、prompt、full content、binary、完整 URL/正文/error/log。Result Record、serialization、repr、diagnostics、summary 均不得出现源敏感值；synthetic 测试使用 `FAKE_SECRET_VALUE` 证明这一性质。

逻辑 references 不得是 URL 或绝对路径。reader 不记录 source path；调用者负责提供明确只读文件，record 只保存安全逻辑 reference 与 integrity。

## 23. Determinism

同一字节输入与同一 context 必须产生相同：

- record ordering；
- record ID；
- source artifact hash 与 bundle hash；
- sanitized result hash；
- serialization 与 projections。

JSON object 的字段顺序不得改变结果；case 输出按名称稳定排序。provider instance unresolved 时，record ID 可使用 source bundle hash 防止不安全的跨来源碰撞，但仍不得建立 execution join identity。

## 24. Known Limitations

- Legacy machine result 没有统一 provider instance identity；
- `web_checked_at` 对部分 case 缺失，因此 provenance 可能是 `PARTIAL`；
- engine/business vocabularies 尚不是上游版本化 contract；
- run summary 的 exit code 是专项脚本结果，不是 current Runtime observation；
- sandbox marker 来自已完成 intake 的上下文，不代表 production；
- V0.1 不表示 `RUNNING` 或 freshness；
- V0.1 只支持当前两类 final artifact 的窄格式；
- 本合同不修复 001F 已登记的 frozen Domain evidence/authority gap。
