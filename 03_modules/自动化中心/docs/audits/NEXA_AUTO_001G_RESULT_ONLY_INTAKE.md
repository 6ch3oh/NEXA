# NEXA-AUTO-001G｜Result-Only Intake Contract + Execution Result Read Adapter V0.1 审计报告

## Task

- Task ID：`NEXA-AUTO-001G`
- Date：2026-08-10（Asia/Shanghai）
- Module：`<PROJECT_ROOT>\03_modules\自动化中心`
- Status：**PASS**
- Architecture：**RESULT_ONLY**
- Allowed implementation：thin **EXECUTION_RESULT_READ** adapter
- Legacy：**STRICT READ ONLY**
- 001F：`ACCEPTED_AS_CONTRACT_CORRECTION_REQUIRED / DEFERRED_CONTRACT_CORRECTION`
- Static Chain：`SEALED`

本任务已建立最小历史 Result Intake boundary，并对既有 Legacy machine-readable final results 完成严格只读 smoke。未恢复 001F，未创建 Runtime Reader、FakeRuntimeProvider 或 Domain V0.2。

## Preflight

实施前完整运行原测试：

```text
Ran 115 tests
OK
```

预检确认 `N8N_LEGACY_INTAKE_MAP_V0.1.md` 缺失，因此只依据已完成的 `NEXA_AUTO_LEGACY_INTAKE_001.md` 确定性结论补建，没有重新进行 Legacy 大范围审计。

冻结文件预检/终检 SHA-256：

| Frozen input | SHA-256 |
|---|---|
| Legacy Intake report | `20684F34023ACCD6A969AE7152CA4A34037AF3AF1993E1F7B68A34F195EBC19E` |
| 001F report | `9FB060B833C6CC536B2E8574C115C98C4673F2628A9E295EAD3BADE850CA11DC` |
| Domain V0.1 | `EF86FC7760DC047A7F2323328F7CE0E56560A8734716BF2252C6C070097F7F86` |
| n8n Export Mapping V0.1 | `E7672A208705F827AEE38F7F2144E0145EB82FB8585128387CCC3F35AD5321E1` |
| Static ViewModel V0.1 | `2E9F2A0BCEC6C2E2330BBC201DC77684D4AF5D05E3F01AD81E649C2BE2BCB8C2` |
| Static Snapshot V0.1 | `A5D619CFC71E6647CE8464B567B95AD057FA752A7B87EFC382F2DFAB37612EB1` |

以上文件均未修改。

## Architecture Delivered

```text
existing Legacy machine-readable final result
  -> LegacyExecutionResultAdapter (thin, allowlist-first)
  -> AutomationExecutionResultRecord
  -> HistoricalResultQueryService
  -> historical-only list/summary projection
```

明确没有建立：

- raw execute-log parser；
- Workflow Runtime Reader / Runtime Overview；
- AutomationRun 或 Domain Evidence promotion；
- n8n API、Docker、execute、webhook、scheduler；
- UI 或跨模块接线。

## Legacy Parser Boundary

Legacy 专项 parser 只作为字段含义、状态判断、provenance 与限制的参考。NEXA adapter 直接读取两份 existing machine-readable artifacts，只完成确定性窄 normalization。

没有复制 47 份 raw execute logs 的 forensic parsing logic，没有读取 raw logs 作为 NEXA 正式输入，也没有修改 Legacy parser。

## Result Contract

新增 `AUTOMATION_RESULT_INTAKE_V0.1.md`，包括要求的 24 个章节，并明确：

- Historical execution result is not current workflow runtime state.
- Execution success and business success are independent facts.
- Sandbox real execution with synthetic dependencies must not be presented as production execution.
- NEXA must consume existing result artifacts instead of rebuilding the legacy execution evidence parser.

合同只定义 Result Intake/Application boundary，不更改 `Automation Domain Contract V0.1`。

## Result Record and Evidence

`AutomationExecutionResultRecord` 安全表达：

- provider kind 与 caller-declared/unresolved provider instance context；
- workflow/execution external identity；
- 独立 execution 与 business status；
- result type、bounded safe summary、可选 timestamp；
- sandbox source classification；
- source artifact size/hash、bundle hash、sanitized result hash；
- provenance completeness 与固定 diagnostic。

`ResultSourceEvidence` 是轻量 Intake Boundary Evidence，不是 `AutomationEvidence`，不承担 Runtime/Execution authority。

## Execution and Business Status Separation

Execution axis：

- `SUCCESS`
- `FAILED`
- `UNKNOWN`
- `NOT_OBSERVED`

Business axis：

- `SUCCESS`
- `PARTIAL`
- `FAILED`
- `UNKNOWN`
- `NOT_REPORTED`

`execution SUCCESS + business PARTIAL` 已由 fixture 与测试证明是合法组合。business failed 不会被转换成 n8n execution failed；missing/unknown 值均 fail closed 或显式降级并登记 diagnostic。

## Provider Instance Gap

调用方显式提供 local intake context 时标记 `CALLER_DECLARED`，这不是 Legacy execution 自证。未提供时保持 `PROVIDER_INSTANCE_UNRESOLVED`，不生成 `ResultExecutionIdentity`，也不能按 execution ID join。

未从路径、容器名、workflow name 或 hash 猜测 provider instance。

## Sandbox Provenance

真实 Legacy smoke 中每条记录均保持：

| Dimension | Value |
|---|---|
| source classification | `SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES` |
| execution engine reality | `REAL_N8N_ENGINE` |
| environment class | `SANDBOX_ISOLATED` |
| dependency class | `SYNTHETIC_OR_STUBBED` |

结果没有被简化为纯 synthetic，也没有被升级为 production execution evidence。

## V1.4.1 Mapping

既有机器结果能够安全映射 workflow ID、execution ID、engine outcome、业务状态码、有限 timestamp 和 terminal-output-reached boolean。

实际业务状态映射：

| Legacy value | NEXA business status |
|---|---|
| `success` | `SUCCESS` |
| `empty` | `PARTIAL` |
| `forbidden` | `PARTIAL` |
| `rate_limited` | `PARTIAL` |
| `failed` | `FAILED` |
| `not_provided` | `PARTIAL` |

完整网页正文、source URL、error message、node path 与 raw payload 未进入记录。

## V2.0 Boundary

V2.0 Knowledge Collector 仍保持 `RESULT_CONTRACT_CANDIDATE / STATIC_VALIDATED_ONLY` 边界。只预留 provider-neutral result type/envelope；没有描述为 production execution verified，也没有建立新的完整 V2 业务模型。

## Real Legacy Result Smoke

只读输入：

```text
_system/n8n_runtime_test/evidence/authbridge5_parsed_results.json
_system/n8n_runtime_test/evidence/authbridge5_run_summary.json
```

输出只记录安全聚合：

| Metric | Result |
|---|---:|
| Result records | 6 |
| Distinct execution IDs mapped | 6 |
| Workflow IDs present | 6/6 |
| Execution SUCCESS | 6 |
| Execution FAILED | 0 |
| Execution UNKNOWN | 0 |
| Execution NOT_OBSERVED | 0 |
| Business SUCCESS | 1 |
| Business PARTIAL | 4 |
| Business FAILED | 1 |
| Business UNKNOWN / NOT_REPORTED | 0 |
| Sandbox classified | 6 |
| Provenance COMPLETE | 5 |
| Provenance PARTIAL | 1 |
| Unique sanitized result SHA-256 | 6 |
| Unresolved provider context | 0（smoke 使用显式 caller-declared local context） |

PARTIAL provenance 对应 source timestamp 缺失；没有猜测或补造 timestamp。

## Source Integrity

本任务实际读取的两份 Legacy artifacts 在预检与终检的 size/SHA-256 完全一致：

| Artifact | Size before/after | SHA-256 before/after | Mismatch |
|---|---:|---|---:|
| parsed results | 5,170 | `D269B69796F7544D787359EB1E4787618B8DBCEA91A7689BA8ACDD50B8378B33` | 0 |
| run summary | 2,699 | `597FBF61DCA418D13178BCEFA9E8DB36A0CA7EF7EB7303E6B3FA6F1DF7F10039` | 0 |

Adapter 记录的 source bundle SHA-256：

```text
E0EE844F0D29FB3FD0E300FED9EB1FDFA79C9281C64F38BFCDD00A06483538EB
```

（hash 大小写不承载语义；实现序列化为 lowercase。）

Legacy 整体 inventory 仍为 51 directories、294 files、15,680,304 bytes，root LastWriteTimeUtc 仍为 `2026-08-04T07:17:14.5234225Z`。本任务对 Legacy 的写入为 0。

## Sanitization

实现使用 allowlist-first。被排除的类型包括 raw execution payload/log、URL、网页正文、完整 error、node path、credential、Secret、Authorization、Cookie、headers、prompt、LLM content、binary 和日志路径。

Synthetic fixture 含 `FAKE_SECRET_VALUE`。30 项新测试验证该字符串没有进入 Result Record serialization、repr、diagnostics、summary 或 Application projection。发现非 allowlist 内容仅登记固定 `SANITIZED_FIELD_REMOVED` diagnostic，不回显源值。

## Diagnostics

已实现最小 diagnostic vocabulary：

- `RESULT_READ_SUCCESS`
- `MALFORMED_RESULT`
- `MISSING_EXECUTION_ID`
- `MISSING_WORKFLOW_ID`
- `PROVIDER_INSTANCE_UNRESOLVED`
- `BUSINESS_STATUS_UNRECOGNIZED`
- `EXECUTION_STATUS_UNRECOGNIZED`
- `SANITIZED_FIELD_REMOVED`
- `PROVENANCE_INCOMPLETE`

没有引入 logging framework。

## Application Query / Projection

`HistoricalResultQueryService` 提供：

- `list_results`
- `get_result_by_execution_identity`
- `summarize_results`

list/summary 明确包含：

```text
historical_result_only = true
current_runtime_inference_allowed = false
```

没有 Runtime Overview，也不从 result history 推断 current Runtime。

## Tests

新增离线 tests：

```text
Ran 30 tests
OK
```

完整 regression：

```text
Ran 145 tests
OK
```

| Suite | Result |
|---|---:|
| Original baseline | 115/115 PASS |
| New Result Intake tests | 30/30 PASS |
| Total | 145/145 PASS |

测试未连接网络、n8n Runtime 或 Docker，也未执行 workflow。

## Files Created / Modified

Created：

1. `src/automation_center/adapters/result_intake.py`
2. `src/automation_center/application/results.py`
3. `tests/test_result_intake.py`
4. `fixtures/result_intake/result.synthetic.json`
5. `docs/contracts/N8N_LEGACY_INTAKE_MAP_V0.1.md`
6. `docs/contracts/AUTOMATION_RESULT_INTAKE_V0.1.md`
7. `docs/audits/NEXA_AUTO_001G_RESULT_ONLY_INTAKE.md`

Modified only for exports：

8. `src/automation_center/adapters/__init__.py`
9. `src/automation_center/application/__init__.py`

没有修改其他 NEXA 模块。

## Side Effects

| Item | Count |
|---|---:|
| Domain semantic modifications | 0 |
| Static contract semantic modifications | 0 |
| Domain V0.2 | 0 |
| Runtime Reader | 0 |
| Network | 0 |
| n8n Runtime connections | 0 |
| Automation executions | 0 |
| Webhook/scheduler | 0 |
| Docker operations | 0 |
| Secret/credential reads | 0 |
| Legacy modifications | 0 |
| Other NEXA module modifications | 0 |
| OpenCode calls | 0 |
| DeepSeek calls | 0 |

## Acceptance

30 项验收标准全部满足：RESULT_ONLY 已落地；thin Result Adapter 直接消费 existing result；未重写 Legacy parser；双轴状态完全分离；sandbox provenance 不失真；provider identity 缺口 fail closed；historical result 不冒充 Runtime；raw/Secret 不进入 NEXA；source 与 sanitized integrity 已建立；V1.4.1 可安全映射；V2.0 未夸大；真实只读 smoke、回归、新测试、Intake Map 与正式报告均完成。

## Known Limitations

- Legacy result 本身未统一 provider instance；当前真实 smoke 的 instance 是 caller-declared local context；
- 一条真实 case 缺 timestamp，因此 provenance 是 PARTIAL；
- 当前格式是两份专项 machine-readable artifacts 的窄 contract，不是通用 n8n Runtime API；
- upstream engine/business vocabulary 尚未版本化；
- 本任务不表示 RUNNING、freshness 或 current workflow health；
- 001F 的 Domain evidence/authority gap 仍真实存在并继续延期。

## Recommended Next Task

返回 00-01 并停止，由总控决定是否冻结/评审 Result Intake V0.1 或选择下一项明确任务。不要自行进入 `WORKFLOW_RUNTIME_READ`、Domain V0.2、Execute、UI 或跨模块接线。
