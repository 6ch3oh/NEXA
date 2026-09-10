# NEXA-AUTO-001F｜Runtime Read Contract V0.1 + Fake Runtime Provider 审计报告

## Task

- Task ID: `NEXA-AUTO-001F`
- Date: 2026-08-10 (Asia/Shanghai)
- Module: `<PROJECT_ROOT>\03_modules\自动化中心`
- Status: **CONTRACT_CORRECTION_REQUIRED**
- `STATIC_CHAIN_STATUS = SEALED`

本任务在预检阶段触发附件规定的停止条件。冻结 Automation Domain Contract V0.1 无法同时表达本任务强制要求的 synthetic Runtime/Execution Evidence 与对应 Runtime/Run status authority。未创建 FakeRuntimeProvider、Runtime ViewModel、fixture 或测试，也未修改任何冻结实现/合同语义。

## Required Inputs and Baseline

已完整读取：

- `docs/contracts/AUTOMATION_DOMAIN_CONTRACT_V0.1.md`
- `docs/contracts/N8N_EXPORT_MAPPING_V0.1.md`
- `docs/contracts/AUTOMATION_VIEWMODEL_V0.1.md`
- `docs/contracts/AUTOMATION_STATIC_SNAPSHOT_V0.1.md`
- `docs/audits/NEXA_AUTO_001B_DOMAIN_CONTRACT.md`
- `docs/audits/NEXA_AUTO_001C_N8N_EXPORT_ADAPTER.md`
- `docs/audits/NEXA_AUTO_001D_APPLICATION_VIEWMODEL.md`
- `docs/audits/NEXA_AUTO_001E_STATIC_SNAPSHOT.md`
- 当前 `src/`、`tests/` 与 `fixtures/` inventory，以及相关 Domain/Application 实现。

施工前完整测试：

```text
Ran 115 tests in 0.033s
OK
```

因此静态链满足封板前提并记录为 `STATIC_CHAIN_STATUS = SEALED`。封板范围为 Export Adapter、Domain V0.1、Snapshot Selection、Static Query 和 Static ViewModel；这不表示 Runtime Read 已完成。

## Blocking Contract Conflict 1: Synthetic Runtime Evidence

001F 同时强制要求：

1. Fake Runtime observation 使用 `RUNTIME_API` / Runtime authority；
2. Fake Provider 数据必须 `synthetic=true`；
3. Synthetic Runtime evidence 不得表示为 production Runtime evidence；
4. Runtime status 必须复用冻结的 `StatusScope.RUNTIME`。

冻结 Domain 的实际约束为：

- `EvidenceKind.RUNTIME_API` 必须对应 `EvidenceAuthority.RUNTIME`；
- 任何非 `SYNTHETIC_FIXTURE` evidence 在 `synthetic=true` 时直接拒绝；
- `SYNTHETIC_FIXTURE` 必须使用 `EvidenceAuthority.SYNTHETIC`；
- `StatusScope.RUNTIME` 只接受 `EvidenceAuthority.RUNTIME` provenance。

因此不存在合法 Domain object 能同时满足：

```text
kind = RUNTIME_API
authority = RUNTIME
synthetic = true
supports StatusScope.RUNTIME
```

若把 fake evidence 改成 `synthetic=false`，会把测试数据包装为 production Runtime evidence，直接违反 001F。若改成 `SYNTHETIC_FIXTURE/SYNTHETIC`，又不能为 Runtime status 提供合法 provenance。Application wrapper、额外 marker 或两条 Evidence 的组合都不能修正底层 authority 声明，且会绕过冻结合同。

## Blocking Contract Conflict 2: Synthetic AutomationRun Evidence

同一冲突也阻止 Fake Provider 合法生成要求中的 `AutomationRun`：

- `AutomationRun.status` 必须是 `StatusScope.RUN`；
- `StatusScope.RUN` 只接受 `EvidenceAuthority.EXECUTION`；
- `EvidenceKind.EXECUTION_RECORD` 必须对应 `EvidenceAuthority.EXECUTION`；
- 非 `SYNTHETIC_FIXTURE` evidence 不能 `synthetic=true`；
- `SYNTHETIC_FIXTURE/SYNTHETIC` 不能支持 RUN status。

因此无法在不修改冻结 Evidence/authority semantics 的前提下生成既是 synthetic、又能合法支持 RUNNING/SUCCEEDED/FAILED 的 fake Run evidence。

## Blocking Contract Conflict 3: Provider Capability

001F 要求 Provider Runtime Reader 至少表达：

- `workflow_runtime_read`
- `run_read`

冻结 `ProviderCapability` 当前只有：

- `definition_read`
- `run_read`
- `trigger_execution`

`workflow_runtime_read` 不存在。新增第二套 capability model 违反 001F；给冻结 Domain enum 增加 capability 则属于 Domain semantic change，需要显式合同修正。把 `definition_read` 或 `run_read` 重新解释为 workflow Runtime read 也会改变冻结语义。

## Why Work Stopped

附件停止条件要求在“必须修改 Evidence authority semantic”或“Runtime 能力需要修改已冻结核心语义”时立即停止并返回 `CONTRACT_CORRECTION_REQUIRED`。上述冲突属于核心可表示性问题，不能通过普通 Python、fixture、test 或 Application 层最小修复解决。

继续施工会至少导致以下一种违规：

- synthetic fake observation 冒充 production Runtime/Execution Evidence；
- 使用 synthetic authority 支撑冻结合同明确禁止的 Runtime/Run status；
- 建立第二套冲突 capability/evidence model；
- 修改或重新解释冻结 Domain semantic；
- 部分实现后伪称 Runtime Read Contract 可用。

因此没有进行部分 Runtime 实现。

## Required Contract Correction Decision

下一步需要单独、明确授权的 Domain Contract 版本评审，至少决定：

1. Evidence source kind、authority 与 synthetic provenance 是否应成为可独立组合的维度；
2. synthetic Runtime observation 如何合法支持 `StatusScope.RUNTIME`，同时保持明显 synthetic 且不冒充 production；
3. synthetic execution record 如何合法支持 `StatusScope.RUN`；
4. `ProviderCapability` 是否新增 `WORKFLOW_RUNTIME_READ`；
5. 该修正是 V0.1 patch、V0.2，还是其他显式版本，以及旧 reader 的兼容规则。

在上述决定冻结前，不建议实现 FakeRuntimeProvider。

## Frozen Integrity

预检记录的冻结合同 SHA-256：

| Contract | SHA-256 |
|---|---|
| Domain V0.1 | `EF86FC7760DC047A7F2323328F7CE0E56560A8734716BF2252C6C070097F7F86` |
| n8n Mapping V0.1 | `E7672A208705F827AEE38F7F2144E0145EB82FB8585128387CCC3F35AD5321E1` |
| Static ViewModel V0.1 | `2E9F2A0BCEC6C2E2330BBC201DC77684D4AF5D05E3F01AD81E649C2BE2BCB8C2` |
| Static Snapshot V0.1 | `A5D619CFC71E6647CE8464B567B95AD057FA752A7B87EFC382F2DFAB37612EB1` |

本任务未修改上述合同或其既有实现。

## Tests

- New Runtime tests: **0/0**（因合同停止条件未创建）
- Regression: **115/115 PASS**
- Total executed: **115/115 PASS**

## Created / Modified Files

仅新增：

1. `docs/audits/NEXA_AUTO_001F_RUNTIME_READ_CONTRACT.md` — 本阻断报告。

没有修改 Domain、Adapter、Application、Snapshot、ViewModel、tests 或 fixtures。

## Side Effects

| Item | Result |
|---|---:|
| Domain Contract semantic changes | 0 |
| Static Contracts semantic changes | 0 |
| Network | 0 |
| Real n8n Runtime | 0 |
| Automation execution | 0 |
| webhook/scheduler | 0 |
| External n8n modification | 0 |
| Other NEXA module modification | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |

## Deliverable Status

| Requested deliverable | Status |
|---|---|
| Runtime Read Contract V0.1 | Blocked by frozen Domain representability |
| FakeRuntimeProvider | Not created |
| Runtime observation/application representation | Not created |
| Run read support | Not created |
| Runtime composition | Not created |
| Runtime ViewModel | Not created |
| Runtime Overview | Not created |
| Synthetic fixtures/tests | Not created |
| Formal report | Completed |

## Next Task Recommendation

Open a narrowly scoped Automation Domain Contract correction/version task for synthetic Runtime/Execution provenance and `WORKFLOW_RUNTIME_READ`. After that contract is reviewed and frozen, reissue Runtime Read Contract + Fake Runtime Provider as a new authorized task. Do not begin the real n8n Runtime Adapter, Execute Adapter, UI, or cross-module wiring.
