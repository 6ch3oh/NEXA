# Automation Unified Read Model V0.1

- Contract ID：`AUTOMATION_UNIFIED_READ_MODEL_V0.1`
- Layer：Application Composition
- Inputs：Frozen Static Definition Plane + Frozen Historical Result Plane
- Status：V0.1

## 1. Purpose

本合同定义 NEXA 自动化中心如何在 Application 层组合已经验证的静态 Workflow Definition 与历史 Execution/Business Result，为未来 UI 提供 provider-neutral、只读、安全且确定性的 Workflow + Historical Result projection。

本合同不改变 Domain、Export Mapping、Snapshot、Static ViewModel 或 Result Intake V0.1 的语义。

## 2. Data Planes

允许组合的数据面：

```text
Static Definition Plane
n8n Export -> Export Adapter -> Domain -> Snapshot Selection -> Static Query/ViewModel

Historical Result Plane
Legacy machine result -> Result Adapter -> Result Intake -> Historical Result Query

Application Composition
Static ViewModel + Historical Result Record -> Unified Read Model
```

Runtime Plane 在 V0.1 中没有 reader 或 observation。

## 3. Static vs Historical vs Runtime

必须始终保持：

```text
STATIC DEFINITION != HISTORICAL RESULT != CURRENT RUNTIME
```

Historical result is not runtime state.

Definition `INACTIVE` 与 latest historical execution `SUCCESS` 可以同时成立。历史 success/failed 不表示当前 healthy/failed；Definition active/inactive 也不表示当前 Runtime active/inactive。

## 4. Workflow Read Model

`AutomationWorkflowReadModel` 至少表达：

- 完整 provider-scoped Workflow identity；
- display name 与 provider presentation；
- Definition status、Trigger summary 与静态 Evidence summary；
- Snapshot selection state；
- Runtime `NOT_OBSERVED` presentation；
- 历史 Result summary 与安全 Result list；
- latest selection state、latest双轴状态；
- caller-declared result identity marker；
- provenance completeness 与 bounded diagnostics。

Workflow Read Model 不包含 raw export、node parameters、raw logs、execution payload、credential、Secret、正文、URL 或完整 LLM output。

## 5. Join Identity

Static Workflow 与 Result Record 只能按完整 identity join：

```text
(provider_kind, provider_instance_id, external_workflow_id)
```

禁止按 workflow name、display name、仅 external workflow ID、文件名、路径、hash、execution ID 或数组位置 join。禁止跨 provider instance join。

## 6. Caller-declared Identity

Result 使用 `CALLER_DECLARED` provider instance context 建立完整 identity 时，Unified Read Model 必须保留：

```text
provider_instance_context_source = caller_declared
caller_declared_context = true
```

Workflow projection 同时登记 caller-declared join diagnostic。该身份来源不得升级为 `LEGACY_CONFIRMED`、Runtime authority 或 production provenance。

## 7. Historical Result Model

`UnifiedHistoricalResultViewModel` 是 UI-safe detail/list projection，表达：

- 可选完整 execution identity；
- 可选完整 workflow identity 与已知 identity components；
- execution status 与 business status；
-可信 timestamp（若存在）；
- fixed safe summary；
- sandbox/source classification 与 provenance completeness；
- source artifact kind/count、source hash prefix、sanitized hash prefix；
- caller-declared marker 与安全 diagnostic codes。

它始终标记 `historical_result_only=true`、`current_runtime_inference_allowed=false`。

## 8. Latest Result Rules

Latest historical result 只使用 Result Record 已有的 timezone-aware `observed_at`：

- 只有一个最大可信时间候选：`SELECTED`；
- 没有 dated candidate：`NONE`；
- 最大可信时间存在多条 Result：`AMBIGUOUS` + `AMBIGUOUS_LATEST_RESULT`，不选择任何一条。

禁止使用文件顺序、execution ID、hash、文件 mtime、数组位置、record ID 或当前时间建立 recency。

## 9. Undated Results

无 timestamp 的 Result 是合法 `UNDATED HISTORICAL RESULT`：

- 计入 historical result/status/sandbox/provenance counts；
- 计入 `undated_result_count`；
- 在 deterministic list 中置于 dated 区域之后；
- 不参与 latest selection；
- 产生 `UNDATED_RESULT_EXCLUDED_FROM_LATEST` diagnostic。

## 10. Execution / Business Status Independence

Execution success and business success remain separate axes.

Execution axis：`SUCCESS / FAILED / UNKNOWN / NOT_OBSERVED`。

Business axis：`SUCCESS / PARTIAL / FAILED / UNKNOWN / NOT_REPORTED`。

`execution=SUCCESS + business=PARTIAL` 是合法组合。Unified/Application/ViewModel 不提供替代双轴语义的单一 status 字段。

## 11. Historical Summary

每个静态 Workflow 或 orphan result workflow 的最小 summary 包括：

- historical result count；
- execution success/failed/unknown/not-observed counts；
- business success/partial/failed/unknown/not-reported counts；
- sandbox result count；
- undated result count；
- provenance complete/partial counts 与 aggregate completeness。

没有数据时计数为 0，provenance 为 `not_observed`。

## 12. Runtime Non-observation

Unified V0.1 固定表达：

```text
runtime_status = not_observed
runtime_observed = false
runtime_available = false
current_runtime_inference_allowed = false
```

Runtime observed count 必须为 0。Unified constructor 对携带 Runtime observation 的 Static input fail closed，避免把 001H composition 与未授权 Runtime plane 混合。

## 13. Unresolved Results

provider instance unresolved 的 Result 不得丢失，也不得 join。它进入 `UnresolvedAutomationResultViewModel`，保留 known provider kind、workflow/execution external ID、安全双轴状态、timestamp、provenance 与 unresolved reason。

Unresolved provider instance must not be guessed.

该 Result 的 execution/workflow complete identity 均为 `None`。

## 14. Orphan Results

Result 拥有完整 provider-scoped Workflow identity，但 supplied Static Definition 集中不存在该 identity 时，进入：

```text
RESULT_ONLY_ORPHAN_STATIC_NOT_OBSERVED
```

它保留历史 summary、latest rules、Result list 与 Runtime `NOT_OBSERVED`，但不伪造 Static definition、display name、Definition status 或静态 Evidence。

## 15. Static-only Workflow

Static Workflow 没有匹配 Result 时仍生成正常 Read Model：

```text
historical_result_count = 0
latest_historical_result = None
runtime_status = not_observed
classification = static_only_no_recorded_results
```

No recorded result does not prove a workflow has never executed.

diagnostic 只能说明当前未提供历史记录，不得显示 `NEVER RUN`。

## 16. Overview

Unified Overview 嵌套并保留原 `AutomationOverviewViewModel`，同时增加：

- total static workflows；
- workflows with/without supplied historical results；
- unresolved result count；
- orphan result workflow/result counts；
- total historical result count；
- historical execution/business 双轴 counts；
- sandbox 与 undated counts；
- Runtime observed/not-observed counts。

Overview 禁止提供 currently healthy/failed、online/offline 或从历史推断的 Runtime 指标。

## 17. V1.4.1

001G 的 V1.4.1 安全 Result Record 可以进入 Unified Read Model，只投影 workflow/execution identity、双轴 status、safe summary、timestamp、sandbox provenance 和 integrity prefix。

正文、raw URL、error payload、node path、raw log 与完整 input/output 仍不得传播。

## 18. V2.0 Boundary

V2.0 继续保持 `RESULT_CONTRACT_CANDIDATE / STATIC_VALIDATED_ONLY`。静态定义存在但没有真实 Result Record 时，它是 static-only，不计入 historical executed workflow，不生成 synthetic/fake execution result。

## 19. Security

Unified 层只组合已经安全验证的 Static ViewModel 与 Result Record，不读取 Adapter source 或 Provider raw data。输出禁止 credential、Secret、token、Authorization、Cookie、headers、raw payload/log、完整网页正文、URL、prompt、LLM output、binary 和绝对路径。

Evidence/source integrity 只显示 bounded prefix、artifact kind/count；source locator 与 raw report content 不传播。

## 20. Determinism

- Workflow join/group 只使用完整 identity；
- Workflow list 采用 display name + 完整 identity 稳定排序；
- dated Result 按 timestamp descending；
- 相同 timestamp 的展示 tie-breaker 使用完整 execution identity，且只影响展示顺序；
- undated Result 使用完整 identity 稳定排序并置后；
- tie-breaker 不建立 recency；
- dict/set/filesystem traversal/current time 不影响输出；
- deterministic JSON 使用 UTF-8、sorted keys 与 compact separators。

Snapshot selection context若提供，selected identities 必须与 Static Query identities 完全一致，否则 fail closed。

## 21. Known Limitations

- 当前 Legacy Result provider instance 来自 caller declaration，不是 Legacy self-confirmed；
- 至少一条 V1.4.1 Result 无 timestamp，不能参与 latest；
- 当前真实 Static exports 与隔离 sandbox Result 使用不同 provider instance context，因此安全结果可以是 orphan 而非 joined；
- Unified V0.1 仅做内存只读 composition，无 persistence、database、pagination、cache、UI 或跨模块 wiring；
- 没有 Runtime Reader、freshness、health、online/offline 或 execute capability；
- 001F Domain Evidence/authority correction 仍继续延期。
