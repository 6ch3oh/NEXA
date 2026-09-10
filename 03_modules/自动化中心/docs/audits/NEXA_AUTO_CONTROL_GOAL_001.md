# NEXA-AUTO-CONTROL-GOAL-001｜Automation Control Foundation V0.1 审计报告

## Goal Status

- Goal: `NEXA-AUTO-CONTROL-GOAL-001`
- Milestone: `AUTOMATION_CONTROL_FOUNDATION_V0.1`
- Date: 2026-08-12 (Asia/Shanghai)
- Status: **PASS**
- Baseline: **246/246 PASS**
- New tests: **78/78 PASS**
- Final: **324/324 PASS**
- n8n remains the only Workflow Execution Engine: **YES**

本里程碑已建立控制基础，但没有建立执行器或生产发布器。Capability、请求、结果动作、Health、AI diagnosis/repair、Workflow build 与 deployment gate 均为 provider-neutral、不可变、JSON-safe、离线合同。

## Current Architecture

```text
AutomationReadAPI V0.1
  -> existing normalized read plane

AutomationControlAPI V0.1
  -> CapabilityRegistry
  -> validation/request/action/health/candidate/gate contracts
  -> NO dispatcher / NO executor / NO publisher

Future explicitly authorized adapter
  -> n8n (only execution engine)
```

Read API 与 Control API 没有互相 import。顶层 package 仅公开两个 facade；Control Application internals 不进入稳定跨模块 export。

## Phase 1: Authority and Entry Verification

### Canonical V1.4.1

| Fact | Value |
|---|---|
| Logical source | `source_import/n8n_工作流开发/output/中国AI知识库采集器_V1.4.1_网页失败兜底版.json` |
| Workflow name | 中国AI知识库采集器_V1.4_网页读取版 |
| External workflow ID | `ymYh8t76VP3jGPbr` |
| Version | V1.4.1（artifact/reconciled version） |
| Embedded versionId | `802897a6-0644-4927-9bad-3ecc34d8a28b` |
| Active in export | false |
| Node count | 21 |
| Trigger evidence | Form Trigger + Error Trigger |
| SHA-256 | `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514` |

正式 n8n provider instance/target 无法从当前项目确认，保持 unresolved。

### Sandbox/Test Source

| Fact | Value |
|---|---|
| External workflow ID | `V141Final403429` |
| Trigger | Manual Trigger + Error Trigger |
| SHA-256 | `F05B31D86EB0467946546557F71C5AEAC91D992451CB0E0000F7824725B9DDB6` |
| Execution IDs | 42, 43, 44, 45, 46, 47 |
| Classification | sandbox real execution with synthetic dependencies |

Sandbox identity 没有冒充 canonical/production identity。

### Existing Invocation/Deployment Mechanisms

- canonical export 的合法用户入口：n8n Form Trigger；
- sandbox 合法入口：Manual Trigger + n8n CLI `execute --id --rawOutput`；
- Legacy isolated runner 能启动本地模拟服务、Docker import 和 execute，但本 Goal 未调用；
- isolated deployment 能静态预检、Docker import/export、UI load 检查，但不执行 workflow；
- production script 即使输入 `DEPLOY` 也只记录人工确认，不包含生产连接或部署代码；
- 未发现安全、稳定、已解析 target 的 n8n API/production update adapter。

因此真实 execute/publish 未进入本里程碑。

## Capability Registry

建立：

- `AutomationCapability`
- `CapabilityRegistry`
- typed input/output schema
- risk/confirmation/availability/invocation/provenance
- deterministic serialization

Registry 当前包含一项：`knowledge.collect`。Capability ID provider-neutral，execution engine 单独声明为 `n8n`。未来管家只读取 Registry，不读取 raw Workflow JSON。

## V1.4.1 Pilot

`knowledge.collect` 已准备：

- canonical/sandbox identity and SHA-256；
- input schema：`ai_name` required，`source_text/source_url` optional；
- safe output：`knowledge_markdown_document` / `text/markdown`；
- primary result action：`COPY_MARKDOWN`；
- risk：MEDIUM；confirmation：ALWAYS；
- availability：CONFIGURATION_REQUIRED；
- safe historical Health template；
- Diagnosis payload template；
- Repair Candidate template；
- Deployment Gate；
- six-case sandbox evidence association。

当前真实 blocker：provider instance unresolved、production target unresolved、execution adapter absent、capability not available for execution。

## Control API

新增独立 `AutomationControlAPI V0.1`：

- `list_capabilities`
- `get_capability`
- `validate_input`
- `prepare_run`
- `create_run_request`
- `retry_request`
- `create_result_action`
- `project_health`
- `create_diagnosis_request`
- `create_repair_request/candidate`
- `create_workflow_build_request/candidate`
- `evaluate_deployment_gate`

API 返回 versioned success/error envelope 和 defensive JSON copy。没有 execute/dispatch/publish/schedule/trigger method。

## Run Request

Input validation fail closed，拒绝额外字段、危险 URL、Secret pattern 和过长内容。输入按稳定 JSON 生成 SHA-256。

Run Request 保留 risk、confirmation 与 blockers，固定 `execution_authorized=false`、`dispatched=false`。即使确认 granted，也不能绕过 architecture blocker。Retry 只建立 `retry_of_request_id`。

## Result Actions

支持七种授权 action vocabulary。V1.4.1 primary 是 `COPY_MARKDOWN`，不是 raw payload copy。JSON action canonicalize；absolute file path、URL userinfo、non-HTTP(S) URL 与 Secret 被拒绝。

现有 machine-readable Result 只有 bounded safe summary，尚未关联最终 Markdown artifact，因此 Pilot 只冻结 action/output contract，不伪造可复制正文。

## Health

Health projection 支持 last observed/success/failure、可信 consecutive failures、latest safe error 与 needs attention。

固定：

```text
current_run_state = unknown
current_runtime_observed = false
current_runtime_inference_allowed = false
evidence_basis = historical_result_only
```

Historical success/failure 不成为 current Runtime status。Undated 记录不参加 latest；最大 timestamp 并列时不任选。

## Diagnosis / Repair

Diagnosis Request 支持 Workflow identity、problem、logical source refs、execution IDs、safe evidence、expected/observed behavior，固定不跨模块 dispatch。

Repair Request 绑定 diagnosis 与 source revision hash。Repair Candidate 保留 modified candidate artifact/hash、summary、tests、sandbox、risk 与严格 lifecycle；Candidate 不能自行 publish eligible。

## Workflow Build

Build Request 强制 existing-source reuse assessment；Build Candidate 保留 reused refs，并沿用 `DRAFT -> VALIDATION_PENDING -> SANDBOX_PENDING -> VALIDATED` 生命周期。没有生成或修改新的真实 Workflow JSON。

## Deployment Gate

Gate 检查 source identity、target、backup、restore instructions、static tests、sandbox、Secret safety 与 user approval。只有全部满足才返回 `READY_TO_PUBLISH / publish_eligible=true`。

该结果只表示条件齐备；`production_action_performed` 始终 false。本 Goal 没有执行 production publish。

## Tests

新增 78 项，覆盖：

- capability identity/registry/duplicate guard；
- V1.4.1 identity/schema/hash/evidence；
- risk/confirmation/availability；
- input validation/hash；
- Read/Control separation；
- non-executable requests/retry；
- safe result actions；
- historical health semantics；
- diagnosis/repair safety；
- build/reuse lifecycle；
- deployment approval gate；
- JSON safety/mutable isolation；
- no network/process/filesystem execution imports；
- no execute/dispatch/publish/schedule method；
- no cross-module/absolute Legacy dependency。

```text
Baseline: 246/246 PASS
New:       78/78 PASS
Final:    324/324 PASS
```

## Modified Files

Created：

1. `src/automation_center/application/control.py`
2. `src/automation_center/control_api.py`
3. `tests/test_control_foundation.py`
4. `fixtures/control/control.synthetic.json`
5. `fixtures/control/v141_pilot.json`
6. `docs/contracts/AUTOMATION_CONTROL_FOUNDATION_V0.1.md`
7. `docs/audits/NEXA_AUTO_CONTROL_GOAL_001.md`

Modified only for exports：

8. `src/automation_center/application/__init__.py`
9. `src/automation_center/__init__.py`

Source import、Legacy baseline、Read API、Domain、Adapters、Unified、existing tests/fixtures/contracts 与其他 NEXA 模块均未修改。

## Legacy Reuse

复用了 canonical/test identity、Form schema、hash/evidence、isolated/deployment safety principles。没有复制或调用 Docker runner、raw log parser、AI bridge、Credential System、Scheduler 或 production script。

## Side Effects

| Item | Count / State |
|---|---:|
| Second Workflow Engine | NO |
| Second Scheduler | NO |
| Second Credential System | NO |
| Runtime Reader | NO |
| Real Workflow execution | 0 |
| n8n Runtime/API connection | 0 |
| Docker operation | 0 |
| Production publish/update | 0 |
| Secret/Credential read | 0 |
| Legacy/source_import modification | 0 |
| Other NEXA module modification | 0 |
| ExecutionHub modification | 0 |
| 鹊桥 modification | 0 |
| 日历管家 modification | 0 |
| Network | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |

## Remaining Gaps

1. 正式 n8n provider instance/target unresolved；
2. 尚无受控 provider execution adapter；
3. 尚无 current Runtime observation；
4. 尚无最终 Markdown artifact 的 safe result association；
5. production backup/restore source 未解析；
6. production publisher/rollback adapter 未实现；
7. 05 鹊桥 AI dispatch 尚未接线；
8. 001F Domain Evidence/authority correction 继续延期。

这些缺口均被 fail-closed blocker 表达，不影响 Control Foundation milestone 完成。

## Cross-module Requirements

未来 AI diagnosis/repair 如需运行，应由单独授权的 10 → 05 鹊桥 contract/wiring 任务完成。本 Goal 没有修改 05、08、ExecutionHub 或任何其他模块。

## Recommended Next Goal

建议下一 Goal 先解决 `NEXA-AUTO-PROVIDER-TARGET-RESOLUTION`：只读确认正式 n8n provider instance、目标标识、现有安全 invocation/update surface、backup/restore contract 与最终 Markdown result artifact association。

在这些事实解析前，不应实现 execute/publish adapter，也不应启动跨模块 AI wiring。
