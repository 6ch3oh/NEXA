# NEXA-AUTO-001H｜Automation Unified Read Model V0.1 审计报告

## Task

- Task ID：`NEXA-AUTO-001H`
- Date：2026-08-10（Asia/Shanghai）
- Module：`<PROJECT_ROOT>\03_modules\自动化中心`
- Status：**PASS**
- Layer：Application Composition
- Baseline：145/145 PASS
- 001F：`DEFERRED_CONTRACT_CORRECTION`

本任务已把冻结的 Static Definition Plane 与 Historical Result Plane 安全组合为 provider-neutral Unified Read Model。没有修改冻结语义，没有进入 Runtime Reader、Domain V0.2、Execute、UI 或跨模块接线。

## Preflight and Frozen Inputs

施工前完整读取六份合同、三份审计报告及当前 `src/tests/fixtures`，并运行磁盘真实测试：

```text
Ran 145 tests
OK
```

终态冻结输入 SHA-256：

| Frozen input | SHA-256 |
|---|---|
| Domain V0.1 | `EF86FC7760DC047A7F2323328F7CE0E56560A8734716BF2252C6C070097F7F86` |
| n8n Export Mapping V0.1 | `E7672A208705F827AEE38F7F2144E0145EB82FB8585128387CCC3F35AD5321E1` |
| Static ViewModel V0.1 | `2E9F2A0BCEC6C2E2330BBC201DC77684D4AF5D05E3F01AD81E649C2BE2BCB8C2` |
| Static Snapshot V0.1 | `A5D619CFC71E6647CE8464B567B95AD057FA752A7B87EFC382F2DFAB37612EB1` |
| Legacy Intake Map V0.1 | `FAF1E5A6DC1FF94B6E8386BC6238E776348317E0B0BA25CDCFDFAA9EF9018BD0` |
| Result Intake V0.1 | `8D0B97A07247783281DCE3253ACBF1C98ECAF740B237A8736513DC1AC88D127F` |
| 001E audit | `79C3DAFA2E69FC11F89110C87297340F1921F67F7AD7DDF1D29A8D87023370F1` |
| Legacy Intake audit | `20684F34023ACCD6A969AE7152CA4A34037AF3AF1993E1F7B68A34F195EBC19E` |
| 001G audit | `AA867903AADAF00622EE7E608E015D870E369027124A29D99ED74B2C9A855001` |

上述输入均未修改。无需 contract correction。

## Unified Architecture

```text
Selected Static Workflow ViewModel
        +
Historical Result Intake Records
        |
full provider-scoped identity join
        v
UnifiedAutomationQueryService
        |
Workflow Read Model / Result Detail / Unresolved / Orphan / Overview
```

Unified 层只组合已经验证的 Application objects，不读取 Adapter source、raw Export 或 raw Result。

## Static / Historical / Runtime Separation

实现持续保持：

```text
STATIC DEFINITION != HISTORICAL RESULT != CURRENT RUNTIME
```

- Definition status 原样来自 Static ViewModel；
- execution 与 business status 原样来自 Result Intake；
- Runtime 固定 `not_observed`；
- historical success/failed 不改变 Runtime；
- Definition active/inactive 不改变 historical result；
- Unified V0.1 对携带 Runtime observation 的 Static input fail closed。

## Workflow Read Model

`AutomationWorkflowReadModel` 表达：

- full Workflow identity、display/provider presentation；
- Definition、Trigger、Static Evidence；
- Snapshot selection policy/state；
- Runtime non-observation；
- historical summary、deterministic result list、latest state/result；
- latest execution 与 business 双轴值；
- caller-declared result identity marker；
- provenance completeness 与 bounded diagnostics。

## Join Identity

唯一 join key：

```text
(provider_kind, provider_instance_id, external_workflow_id)
```

测试确认 name 不参与 join、external ID 不能单独 join、不能跨 provider instance。provider instance unresolved 的 Result 不建立 WorkflowRef。

## Caller-declared Provenance

001G resolved Result 的 provider instance context 继续标记：

```text
provider_instance_context_source = caller_declared
caller_declared_context = true
```

Workflow Read Model 登记 `CALLER_DECLARED_RESULT_IDENTITY` diagnostic。没有升级成 Legacy-confirmed、Runtime authority 或 production identity。

## Historical Latest

latest 只读取现有 `observed_at`：

- 单一最大时间：selected；
- 全部无时间：none；
- 多条并列最大时间：ambiguous + `AMBIGUOUS_LATEST_RESULT`；
- undated 计数但不参与 latest。

Result list 先按 timestamp descending，undated 固定置后；完整 execution identity 仅作为稳定展示 tie-breaker，不建立 recency。

## Execution / Business Axes

两轴持续独立：

| Axis | Values |
|---|---|
| Execution | success / failed / unknown / not_observed |
| Business | success / partial / failed / unknown / not_reported |

`execution success + business partial` 在 Unified projection 中原样保留。没有 overall single-axis status 覆盖它们。

## Unresolved Results

provider instance unresolved 的 Result 进入 `UnresolvedAutomationResultViewModel`，保留 known provider kind、workflow/execution external ID、安全双轴状态、timestamp 与 provenance；完整 workflow/execution identity 为 `None`。它不会按同名 Workflow 或 external ID 吸附。

## Orphan Results

拥有完整 provider-scoped identity 但没有 supplied Static Definition 的 Result，按 Workflow identity 分组为：

```text
RESULT_ONLY_ORPHAN_STATIC_NOT_OBSERVED
```

Orphan 保留历史 summary/list/latest 与 Runtime non-observation，但没有伪造 Definition status、display name 或 Static Evidence。

## Static-only Workflows

没有匹配 Result 的 Static Workflow 仍生成 Read Model：result count 0、latest None、Runtime not_observed，并分类 `static_only_no_recorded_results`。

diagnostic 明确：“No historical result is recorded; this does not prove the workflow never executed”。输出不使用 `never_run` 声明。

## Historical Result Detail

`UnifiedHistoricalResultViewModel` 是 UI-safe list/detail：

- 可选完整 Workflow/Execution identity；
- 双轴 status、timestamp、safe summary；
- sandbox/source classification 与 provenance completeness；
- source artifact kind/count；
- source/sanitized integrity 12-character prefix；
- caller-declared marker 与安全 diagnostic codes；
- `historical_result_only=true`；
- `current_runtime_inference_allowed=false`。

## Overview

`UnifiedAutomationOverviewViewModel` 嵌套保留原 Static Overview，并增加 joined/static-only、unresolved、orphan、历史双轴、sandbox、undated 统计。

Runtime observed 始终为 0，不提供 currently healthy/failed、online/offline 等无证据指标。

## Query Surface

`UnifiedAutomationQueryService` 提供：

- `list_workflow_read_models`
- `get_workflow_read_model`
- `list_historical_results`
- `get_result_by_execution_identity`
- `list_unresolved_results`
- `list_orphan_results`
- `get_overview`

没有搜索 DSL、database、pagination、cache 或 mutation command。

## V1.4.1 and V2.0

V1.4.1 Result 只投影 identity、双轴 status、safe summary、timestamp、sandbox provenance 与 bounded integrity。正文、URL、error payload 和 raw log 不传播。

V2.0 仍是 `RESULT_CONTRACT_CANDIDATE / STATIC_VALIDATED_ONLY`。没有真实 Result 时保持 static-only，不计入 historical executed workflow，也不生成假 execution。

## Security

Unified serialization 不包含 raw n8n JSON、node parameters、raw logs、raw execution payload、URL、完整网页正文、prompt、LLM output、credential、Secret、Authorization、Cookie、headers、binary 或绝对 source path。

既有 synthetic fixture 的 `FAKE_SECRET_VALUE` 未进入 Workflow Read Model、Result Detail、Overview、serialization 或 diagnostics。

## Offline Tests

新增 50 项离线测试，覆盖附件列出的 37 类要求及额外 fail-closed/确定性边界：

```text
Ran 50 tests
OK
```

完整终态：

```text
Ran 195 tests
OK
```

| Suite | Result |
|---|---:|
| Original regression | 145/145 PASS |
| New Unified tests | 50/50 PASS |
| Total | 195/195 PASS |

## Real Read-only Smoke

只使用 001C 已确认的 5 个显式 Export 与 001G 已确认的 2 个 machine-readable Result artifacts；没有目录扫描、raw log 读取、Runtime connection 或 workflow execution。

五个 Export 形成 2 个 snapshot groups。调用方通过 `EXPLICIT` policy 选择已授权的 V1.4.1 与 V2.0 Evidence，避免使用 filename/mtime/hash 猜 latest。

Static plane 使用 `authorized-static-export-set-001`；Historical Result plane 保留 001G caller-declared `legacy-sandbox-result-set-001`。两者 provider instance 不同，因此全部 Result 安全保留为 orphan。`joined=0` 是正确的 full-identity fail-closed 结果。

安全聚合：

| Metric | Result |
|---|---:|
| Explicit Export inputs | 5 |
| Snapshot groups | 2 |
| Selected Static workflows | 2 |
| Static identity set SHA-256 | `D66681940EB95C571029FEF3EEA771C109DD335DD3F546050A6204734857DDE5` |
| Joined workflows | 0 |
| Static-only workflows | 2 |
| Orphan result workflows | 1 |
| Unresolved results | 0 |
| Historical results | 6 |
| Execution success / failed | 6 / 0 |
| Business success / partial / failed | 1 / 4 / 1 |
| Sandbox results | 6 |
| Undated results | 1 |
| Runtime observed | 0 |

前两次 smoke wrapper 在打开任何 Export 前因 PowerShell stdin 中文路径编码被替换为 `?` 而停止。最终通过 Unicode environment variables 传递同一组七个显式路径后成功。该 shell transport 事件没有读取、输出或修改 Legacy 内容。

## Legacy Source Integrity

七份实际输入的 before/after size 与 SHA-256 全部一致：

| Alias | Size | SHA-256 | Mismatch |
|---|---:|---|---:|
| EXPORT-001 | 20,466 | `C63CC3C95C280661DDAD1356018225C29C985CB62719A6CFE908851258C6CDDA` | 0 |
| EXPORT-002 | 44,675 | `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514` | 0 |
| EXPORT-003 | 22,310 | `86E8226BC3732EEFAA0ED50037DBFD179AA92ADCE64F88EF1324D673F8775C5A` | 0 |
| EXPORT-004 | 22,287 | `493F29E08A98EBCAE1B32464195CB412040624578BF12A0507580E69F1248B00` | 0 |
| EXPORT-005 | 23,207 | `52B64DA644BAC218BA92B0847C2F61254237E8394C86126E6801FED25E7701AB` | 0 |
| RESULT-001 | 5,170 | `D269B69796F7544D787359EB1E4787618B8DBCEA91A7689BA8ACDD50B8378B33` | 0 |
| RESULT-002 | 2,699 | `597FBF61DCA418D13178BCEFA9E8DB36A0CA7EF7EB7303E6B3FA6F1DF7F10039` | 0 |

Total mismatch：**0**。Legacy modification：**0**。

## Created / Modified Files

Created：

1. `src/automation_center/application/unified.py`
2. `tests/test_unified_read_model.py`
3. `docs/contracts/AUTOMATION_UNIFIED_READ_MODEL_V0.1.md`
4. `docs/audits/NEXA_AUTO_001H_UNIFIED_READ_MODEL.md`

Modified only for Application exports：

5. `src/automation_center/application/__init__.py`

Adapter、Domain、Static contracts、Result Intake contract、fixtures 与其他 NEXA 模块均未修改。

## Side Effects

| Item | Count |
|---|---:|
| Domain semantic modifications | 0 |
| Result Contract semantic modifications | 0 |
| Static Contract semantic modifications | 0 |
| Adapter semantic modifications | 0 |
| Domain V0.2 | 0 |
| Runtime Reader | 0 |
| Network | 0 |
| n8n Runtime | 0 |
| Automation executions | 0 |
| Docker | 0 |
| Credential/Secret reads | 0 |
| Legacy modifications | 0 |
| Other NEXA module modifications | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |

## Acceptance

32 项验收标准全部满足：Unified Read Model 与 Query Service 已建立；三平面语义、完整 identity join、caller declaration、unresolved/orphan/static-only、latest/undated/ambiguity、双轴状态、Runtime non-observation、Overview、V1.4.1/V2.0、安全与确定性均经测试；真实 smoke、Legacy integrity、145 regression、50 新测试、合同和正式报告均完成。

## Known Limitations

- Result provider instance 仍是 caller-declared，不是 Legacy self-confirmed；
- 至少一条真实 Result 无 timestamp；
- 真实 Static 与 sandbox Result provider instances 不同，因此当前正确结果是 orphan 而非 joined；
- Unified V0.1 只有内存只读 composition，没有 persistence、database、pagination、cache 或 UI；
- 没有 current Runtime、freshness、health、online/offline 或 execution capability；
- 001F correction 继续延期。

## Recommended Next Task

返回 00-01 审核/冻结 Unified Read Model V0.1，并停止。不得自行进入 UI、Runtime Read、Domain V0.2、Execute 或跨模块接线。
