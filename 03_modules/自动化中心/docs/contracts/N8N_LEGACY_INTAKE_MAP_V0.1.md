# N8N Legacy Intake Map V0.1

## 文档状态

- Contract ID：`N8N_LEGACY_INTAKE_MAP_V0.1`
- 来源：`NEXA_AUTO_LEGACY_INTAKE_001.md` 的确定性结论
- 架构选择：`RESULT_ONLY`
- 允许实现：薄 `EXECUTION_RESULT_READ` adapter
- 明确延期：`WORKFLOW_RUNTIME_READ`、Domain V0.2、001F contract correction

本文件只整理已经完成的 Legacy Intake 结论，不构成第二次 Legacy 大范围审计，也不授权执行 Workflow、连接 n8n Runtime、Docker 或网络。

## Legacy 资产基线

只读根目录：

```text
E:\个人数字资产中心\02_项目工作台\n8n_工作流开发
```

已审计基线：

| 项目 | 结果 |
|---|---:|
| Directories | 51 |
| Files | 294 |
| Bytes | 15,680,304 |
| Aggregate content/metadata SHA-256 | `0E65B779103A06D14AC7880347BDD527B908CAD6DC85F3F8B4C5727DBA9FF245` |
| Legacy writes | 0 |

## 推荐摄取链路

```text
Legacy sandbox execution
  -> Legacy 专项 forensic/parser
  -> existing machine-readable final result artifacts
  -> NEXA thin ExecutionResultRead adapter
  -> safe historical result record/projection
```

禁止链路：

```text
Legacy raw execute logs
  -> NEXA 重写 forensic parser
```

## 允许读取的结果资产

| Artifact | 用途 | NEXA 输入规则 |
|---|---|---|
| `_system/n8n_runtime_test/evidence/authbridge5_parsed_results.json` | workflow/execution identity、业务状态、有限结果字段 | 只读；allowlist-first；不复制正文、URL 或原始错误内容 |
| `_system/n8n_runtime_test/evidence/authbridge5_run_summary.json` | 每个 case 的执行命令退出结果 | 只读；只消费 case、exit code 或显式 execution status |
| Legacy intake/audit reports | 字段语义、provenance 与限制的参考 | 只作为 report reference，不转换成某次 execution 的机器状态 |

以下不是日常输入：47 份 raw execute logs、SQLite/WAL/SHM、n8n config、credential/config/cache、Docker 状态、容器状态、完整 workflow payload。

## Runtime Status 能力映射

| 能力 | Legacy 事实 | NEXA V0.1 决定 |
|---|---|---|
| Workflow Runtime Status Reader | 未发现成熟、可复用、带 freshness 的 reader | 不建立 `WORKFLOW_RUNTIME_READ` |
| n8n Runtime API helper | 未发现正式 helper | 不连接 API |
| CLI status helper | 有执行/部署脚本，不等于当前 Runtime reader | 不复用为 Runtime authority |
| status file | 有报告/摘要，但无统一当前状态文件 | 不推断 current Runtime |
| result file | 存在机器可读 final result | 作为 RESULT_ONLY 主输入 |
| result parser | 存在专项取证 parser | 仅参考契约；不搬入 NEXA |
| log/evidence reader | 能读取 execute evidence | raw log 不成为 NEXA 正式输入 |

## 双轴状态映射

Execution Engine Status 与 Business Result Status 是两条独立轴。

### Execution axis

| Legacy machine fact | NEXA result intake |
|---|---|
| explicit `success` / `succeeded` | `SUCCESS` |
| `execute_exit_code = 0` | `SUCCESS` |
| explicit `failed` / `failure` | `FAILED` |
| positive non-zero exit code | `FAILED` |
| missing observation / `-1` | `NOT_OBSERVED` |
| unrecognized value | `UNKNOWN` + diagnostic |

### Business axis

| Legacy business value | NEXA result intake |
|---|---|
| `success`, `completed`, `complete` | `SUCCESS` |
| `partial`, `empty`, `forbidden`, `rate_limited`, `not_provided`, `completed_with_insufficient_sources` | `PARTIAL` |
| `failed`, `failure` | `FAILED` |
| missing | `NOT_REPORTED` |
| `unknown` or unrecognized | `UNKNOWN`；unrecognized 同时产生 diagnostic |

`execution_status = SUCCESS` 与 `business_status = PARTIAL` 是合法组合。报告中的 `BLOCKED`、`PARTIAL` 或 `UNKNOWN` 若没有对应机器记录，不得自动注入某次 execution。

## Sandbox 与 synthetic 分类

Legacy V1.4.1 主证据必须分类为：

```text
SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES
```

组成维度：

| Dimension | Value |
|---|---|
| execution engine reality | `REAL_N8N_ENGINE` |
| environment class | `SANDBOX_ISOLATED` |
| dependency class | `SYNTHETIC_OR_STUBBED` |

原因是实际 n8n 2.32.7 引擎产生了 execution ID，但运行在隔离实例和测试 workflow 中，并使用本地模拟 HTTP、LLM/文件节点桩。它既不是纯 synthetic fixture，也不是 production execution evidence。

## Identity 与 provenance

已存在：workflow ID、execution ID、业务状态、engine outcome、部分 timestamp、报告上下文。

缺口：统一 provider instance identity、每条结果的 canonical Evidence ID、完整 started/finished timestamps、freshness、每条结果的冻结 provenance enum、既有 canonical result hash。

映射规则：

- 调用方显式提供本地 `provider_instance_context` 时，标记为 `CALLER_DECLARED`；
- Legacy 机器结果本身不自证该 provider instance；
- 未提供时保留 `PROVIDER_INSTANCE_UNRESOLVED`；
- unresolved 结果不得按 execution ID 拼接到正式 Workflow identity；
- 禁止从路径、容器名、workflow 名或 hash 猜测 provider instance。

完整 execution identity 为：

```text
(provider_kind, provider_instance_id, execution_external_id)
```

## Source integrity 与 sanitized integrity

NEXA 分开记录：

1. 每个 Legacy source artifact 的 size 与 SHA-256；
2. 两份 source artifacts 的确定性 bundle SHA-256；
3. 每条 allowlist 后 normalized result 的独立 SHA-256。

source hash 证明读取的输入字节；sanitized hash 证明 NEXA 安全结果。两者不得混用。

## 安全字段边界

允许进入安全结果的内容：provider/workflow/execution identity、独立状态码、result type、有限 timestamp、sandbox/provenance classification、逻辑 report reference、hash、固定格式安全摘要、diagnostics。

禁止进入 Result Record、serialization、repr、diagnostics 或 summary：

- raw execution payload / complete log；
- credential、password、secret、token、API key；
- Authorization、Cookie、headers；
- 完整网页正文或 URL；
- 完整 error payload；
- prompt、LLM input/output、full content；
- binary data、绝对本地路径。

实现必须 allowlist-first。发现非 allowlist 字段时只登记 `SANITIZED_FIELD_REMOVED`，不得把字段名对应的敏感值写入 diagnostic。

## V1.4 / V1.4.1 映射

V1.4 静态能力包括 Form Trigger、HTTP read、HTML extraction、source branch、LLM chain、text conversion 与 knowledge-directory write；这些是静态 workflow 能力，不是当前 Runtime 状态。

V1.4.1 结果可安全映射 workflow ID、execution ID、engine status、业务状态码、有限 HTTP/status scalar、timestamp 与是否到达测试输出节点。完整网页正文、URL、error message 和 raw node payload 不进入 NEXA。

## V2.0 Knowledge Collector 边界

V2.0 已有 provider normalization、source processing、业务状态、报告/来源/失败来源/任务元数据设计，但没有完成真实搜索/模型/文件输出链执行。本版本只预留 provider-neutral `ResultType` 与安全结果 envelope，不为 V2 建立完整业务模型，也不将其标记为 production execution verified。

## 最终 capability 结论

| Candidate | Decision |
|---|---|
| `RESULT_ONLY` | PRIMARY；当前最窄且证据最充分 |
| `EXECUTION_RESULT_READ` | ALLOWED；仅为现有 final results 的薄只读 normalization |
| `WORKFLOW_RUNTIME_READ` | DEFERRED；Legacy 资产不足以证明需要或已有该能力 |
| Domain V0.2 | DEFERRED；本文件不修改冻结 Domain |

## 非目标

本映射不授权 Runtime Reader、Runtime ViewModel、Run Query、FakeRuntimeProvider、AutomationRun promotion、Domain Evidence promotion、n8n API、Docker、Workflow execute、webhook、scheduler、UI 或跨模块接线。
