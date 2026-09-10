# Automation Control Foundation V0.1

- Contract ID: `AUTOMATION_CONTROL_FOUNDATION_V0.1`
- Version: `0.1`
- Layer: Provider-neutral Control Foundation
- Status: Frozen milestone

## 1. Purpose

本合同为手动运行、结果动作、健康观察、AI 诊断/维修、Workflow 建设与发布门禁建立稳定控制面基础。它不实现 Workflow Engine；n8n 继续是现有 n8n Workflow 的唯一执行引擎。

## 2. Architecture

```text
Future UI / Butler AI
        |
Capability Registry + AutomationControlAPI
        |
Validated request / candidate / gate contracts
        |
Future explicitly authorized provider adapter
        |
n8n Workflow Engine
```

`AutomationControlAPI` 与 `AutomationReadAPI` 独立。Read API 继续负责无副作用查询；Control API 只准备意图和合同，不调用 Read API，也不自行执行。

## 3. Non-execution Guarantee

V0.1 不包含 execute、dispatch、trigger、schedule 或 publish 方法。Run Request 固定 `execution_authorized=false`、`dispatched=false`；Deployment Gate 固定 `production_action_performed=false`。

Foundation must never be presented as an execution adapter.

## 4. Capability Registry

`CapabilityRegistry` 是未来星枢管家 AI 的唯一 Automation capability discovery surface。AI 不读取 raw Workflow JSON，不依赖 n8n node schema，也不猜 provider instance。

`AutomationCapability` 表达 capability ID、AI 描述、Workflow identity、input/output schema、risk、confirmation、availability、invocation mode、provenance 与 execution engine。

## 5. Provider-neutral Identity

Capability ID 不嵌入 provider 名称。Workflow identity 包含 `provider_kind`、`external_workflow_id` 与可选 `provider_instance_id`。缺少 provider instance 时 identity 明确 unresolved；禁止从路径、文件名、容器、workflow name 或 hash 猜测。

## 6. V1.4.1 Pilot

首个真实候选 capability：

```text
capability_id = knowledge.collect
provider_kind = n8n
external_workflow_id = ymYh8t76VP3jGPbr
provider_instance_id = unresolved
canonical version = V1.4.1
execution engine = n8n
availability = configuration_required
```

Canonical source 是 `source_import/n8n_工作流开发/output/中国AI知识库采集器_V1.4.1_网页失败兜底版.json`，SHA-256 为 `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514`。

隔离测试 source 的 ID 是 `V141Final403429`，不得与 canonical workflow identity 合并。其六条真实 sandbox execution 证据不代表生产 target 或 production Runtime。

## 7. Input Schema

V1.4.1 输入来自已核验 Form Trigger：

- `ai_name`: required text, max 128;
- `source_text`: optional long text, max 12000;
- `source_url`: optional safe HTTP(S) URL, max 2048.

Additional fields fail closed。URL 禁止 userinfo 和非 HTTP(S) scheme；所有文本拒绝固定 Secret pattern。

## 8. Output and Result Type

V1.4.1 safe result type 是 `knowledge_markdown_document`，media type 是 `text/markdown`。Primary action 是 `COPY_MARKDOWN`。

这表示未来 provider adapter 必须产生经过验证的 Markdown result projection。Raw n8n execution payload、runData、网页正文缓存、error payload 或 logs 不是默认结果。

## 9. Risk and Confirmation

`knowledge.collect` 风险为 `MEDIUM`，confirmation policy 为 `ALWAYS`。即使调用方声明确认，provider instance、target 或 adapter blocker 仍不能被绕过。

## 10. Run Preparation

`validate_input` 产生 deterministic input hash；`prepare_run` 产生 risk、confirmation、availability 与 blockers；`create_run_request` 产生不可变请求；`retry_request` 仅建立原请求关系。

V0.1 对 V1.4.1 固定 blocker：

- `provider_instance_unresolved`
- `production_target_unresolved`
- `capability_not_available_for_execution`
- `execution_adapter_not_implemented`

因此当前 request state 为 `BLOCKED`。

## 11. Run State

UI-friendly control states：

- `NOT_RUNNING`
- `RUNNING`
- `SUCCEEDED`
- `PARTIAL`
- `FAILED`
- `NEEDS_ATTENTION`
- `UNKNOWN`

它们是 presentation vocabulary，不覆盖已有 execution/business 双轴真相。没有 current observation 时不得从 historical result 生成当前 `RUNNING/SUCCEEDED/FAILED`。

## 12. Result Actions

合同支持：

- `COPY_TEXT`
- `COPY_MARKDOWN`
- `COPY_JSON`
- `OPEN_FILE`
- `COPY_FILE_PATH`
- `OPEN_URL`
- `COPY_URL`

所有 action 必须基于 safe projection。JSON canonicalize；file/path 使用逻辑引用而非绝对路径；URL 只允许无 userinfo 的 HTTP(S)。

## 13. Workflow Health

Health 表达 last observed execution、last success/failure、可信 consecutive failures、latest safe error、needs attention、evidence basis 与 diagnostics。

Historical failure does not represent current Runtime failure.

V0.1 固定 `current_runtime_observed=false`、`current_runtime_inference_allowed=false`、current run state `UNKNOWN`。`needs_attention` 只表示最新唯一可信历史观察需要人工关注。Undated 或并列 latest 不被猜测。

## 14. Diagnosis Request

Diagnosis Request 包含完整 Workflow identity、problem statement、安全 source refs、relevant execution IDs、safe evidence、expected behavior 与 observed behavior。

它不包含 raw payload/log、绝对路径、Secret，也不直接 dispatch 到 05 鹊桥或任何外部 AI。

## 15. Repair Request and Candidate

Repair Request 绑定 Diagnosis Request、Workflow identity、requested change、constraints 与 source revision hash。

Repair Candidate 包含 candidate identity、source revision、modified logical artifact/hash、change summary、tests、sandbox validation、risk 与 lifecycle state。Candidate 自身不能设置 publish eligible。

## 16. Candidate Lifecycle

```text
DRAFT -> VALIDATION_PENDING -> SANDBOX_PENDING -> VALIDATED
```

任一活动状态可以按合同进入 `REJECTED` 或 `SUPERSEDED`。进入 sandbox 前 static tests 必须 PASS；进入 validated 前 static 和 sandbox 必须同时 PASS。禁止跳级。

## 17. Workflow Build

`WorkflowBuildRequest` 必须描述 capability intent、input/output requirements、existing-source reuse refs 与 reuse assessment。`WorkflowBuildCandidate` 保留复用来源、candidate artifact/hash、change summary 和同一验证 lifecycle。

AI must assess reuse before proposing a new workflow.

## 18. Deployment Gate

Gate states：

- `DRAFT`
- `TESTING`
- `VALIDATED`
- `READY_TO_PUBLISH`
- `PUBLISHED`
- `PUBLISH_FAILED`
- `ROLLBACK_REQUIRED`

V0.1 只计算 `TESTING / VALIDATED / READY_TO_PUBLISH`。其他状态为未来 provider adapter 的受控 observation vocabulary。

## 19. Publish Eligibility

`READY_TO_PUBLISH` 必须同时满足：source identity resolved、target resolved、backup、restore instructions、static tests PASS、sandbox PASS、Secret safety confirmed、user approval granted。

Ready to publish does not publish anything.

实际生产更新仍需要未来显式授权的 provider adapter 和用户确认。

## 20. Legacy Reuse

复用：

- canonical V1.4.1 export identity/hash；
- Form input schema；
- sandbox workflow/evidence identity；
- existing parsed result/run summary integrity；
- deployment precheck、isolated import/export、人工确认与不执行生产的安全原则。

不复制：Docker/CLI runner、raw log parser、Credential System、Scheduler、Runtime Engine、deployment implementation 或 AI bridge。

## 21. Security

禁止进入 Control contracts：Secret、credential、Authorization、Cookie、raw execution payload、raw log、absolute path、database content、provider-specific internal object 或 exception repr。

Public facade 返回 JSON-safe defensive copy，错误只包含固定 code/message/operation。

## 22. Public API

Top-level public exports：

- `AUTOMATION_CONTROL_API_VERSION`
- `AutomationControlAPI`
- `ControlAPIErrorCode`
- `build_control_api`
- `serialize_control_api_response`

Application control contracts 供模块内部 composition 使用，不是跨模块 stable public import surface。

## 23. Known Limitations

- production n8n provider instance unresolved；
- production target unresolved；
- no provider execution adapter；
- no current Runtime Reader；
- no safe final Markdown result artifact association yet；
- existing historical Result Intake 只含 bounded summary，不包含最终生成文档；
- no cross-module AI dispatch；
- no production publisher/rollback adapter；
- 001F Domain Evidence/authority correction remains deferred。

## 24. Non-goals

V0.1 不建立第二套 Workflow Engine、Scheduler、Credential System、n8n Runtime、HTTP/IPC server、真实 UI、鹊桥修改、日历管家修改、ExecutionHub 修改、真实 execute、production publish 或跨模块 wiring。

