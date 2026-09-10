# NEXA-AUTO-001I｜Automation Read Application API V0.1 审计报告

## Task

- Task ID: `NEXA-AUTO-001I`
- Date: 2026-08-11 (Asia/Shanghai)
- Module: `<PROJECT_ROOT>\03_modules\自动化中心`
- Status: **PASS**
- API Version: `0.1`
- Layer: Public Application Facade
- 001F: `DEFERRED_CONTRACT_CORRECTION`

本任务建立了自动化中心唯一稳定的内部 Public Read Facade。它仅包装 001H 冻结的 `UnifiedAutomationQueryService`，未改变 Domain、Static、Result Intake 或 Unified Read Model 语义，未进入 UI、Core、IPC、HTTP、Runtime 或 Execute。

## Preflight

施工前完整读取六份冻结合同、当前 `src/tests/fixtures`，并运行磁盘测试：

```text
Ran 195 tests
OK
```

基线为 **195/195 PASS**。

## Public API Surface

新增 `src/automation_center/public_api.py`，公开：

- `AUTOMATION_READ_API_VERSION = "0.1"`
- `AutomationReadAPI`
- `WorkflowIdentityInput` / `ExecutionIdentityInput`
- success/error TypedDict contracts 与 `ReadAPIErrorCode`
- `build_read_api(explicit_query_service)`
- `serialize_read_api_response(response)`

模块顶层 `automation_center.__init__` 仅增加上述 Public API export，没有导出 Adapter、Snapshot、Result Intake 或 Unified implementation。

## Bootstrap Boundary

`AutomationReadAPI` 只接受已准备好的 `UnifiedAutomationQueryService`。API 自身没有 `os`、`pathlib`、glob、scanner、network、server、Runtime 或 execution bootstrap；不包含 Legacy 路径。真实 Smoke 的显式 file loading、snapshot selection 与 provider context 均在外围 composition 中完成。

## Query API

实现并验证：

1. `get_overview()`
2. `list_workflows(...)`
3. `get_workflow(full_workflow_identity)`
4. `list_results(...)`
5. `get_result(full_execution_identity)`
6. `list_unresolved_results(...)`
7. `list_orphan_results()`

Workflow detail 与 Result detail 只接受完整 provider-scoped identity；显示名称不是 identity lookup。Facade 复用 Unified 查询和排序，只做已有安全字段的过滤与 JSON projection。

## Response Contracts

Success：

```json
{"api_version":"0.1","ok":true,"data":{}}
```

Error：

```json
{"api_version":"0.1","ok":false,"error":{"code":"not_found","message":"safe message","details":{"operation":"get_workflow"}}}
```

错误 code 覆盖 `not_found`、`invalid_identity`、`invalid_query`、`ambiguous`、`internal_invariant_violation` 与预留的 `unresolved_identity`。测试确认 traceback、exception repr、绝对路径、raw payload 与 Secret 不进入错误响应。

## Serialization and Mutable Isolation

所有响应经 Application primitive projection 和 JSON round-trip 创建新对象，只含 dict/list/scalar/None。datetime 转 ISO-8601，Enum 转稳定 string；dataclass、Enum、datetime、Path、set、tuple、custom instance 均不跨越边界。

测试修改第一次返回的嵌套 dict/list 后，内部 Workflow、Unified Read Model、Result Record 与第二次响应保持不变，确认 mutable reference isolation。

## Filtering and Ordering

- Workflow：provider kind、provider instance、definition status、trigger type、bounded text。
- Result：execution status、business status、sandbox、完整 workflow identity。
- Unresolved：provider kind、execution status、business status。
- 无 SQL-like query、regex、任意 expression、pagination 或 cursor。
- Workflow/Result ordering 沿用 001D/001H；Result tie-breaker 只决定展示顺序，不建立 latest。

## Static / Historical / Runtime

继续保持：

```text
STATIC DEFINITION != HISTORICAL RESULT != CURRENT RUNTIME
```

Historical success 不推断 Runtime；Static definition 不被 Result 覆盖。所有 V0.1 Runtime projection 保持 `not_observed`，真实 Smoke 的 Runtime observed count 为 0。

## UI Compatibility Synthetic Fixture

新增 `fixtures/read_api/responses.synthetic.json`，只表达 schema/shape，包含 Overview、Workflow list/detail、Result list/detail、Unresolved result。Fixture 完全 synthetic，没有复制真实 Legacy 内容、路径、Secret 或 raw provider payload。

## Offline Tests

新增 51 项测试，覆盖授权列出的 37 类要求及额外的 fail-closed、error-code freeze、determinism 和 fixture 验证：

```text
Ran 51 tests
OK

Ran 246 tests
OK
```

| Suite | Result |
|---|---:|
| Original regression | 195/195 PASS |
| New Read API tests | 51/51 PASS |
| Total | 246/246 PASS |

## Real Read-only Smoke

Smoke 仅使用此前确认的 5 个显式 n8n Export 与 2 个 machine-readable Result artifacts；没有目录扫描、raw log 读取、Runtime connection 或 workflow execution。

外围 composition 对 5 个 Export 做既有 Adapter mapping，并按 `EXPLICIT` snapshot policy 选择授权的 V1.4.1 与 V2.0；2 个 Result artifacts 通过既有 Result Intake 形成 6 条历史结果。Static 使用 `authorized-static-export-set-001`，Historical Result 保留 caller-declared `legacy-sandbox-result-set-001`，两者 provider instance 不同，因此 full-identity fail-closed 的正确结果为 orphan，不是 joined。

| Safe aggregate | Result |
|---|---:|
| API Version | 0.1 |
| Response sets | 7 |
| Workflow count / list count | 2 / 2 |
| Historical result count / list count | 6 / 6 |
| Unresolved count | 0 |
| Orphan workflow count | 1 |
| Runtime observed count | 0 |
| All envelopes valid | PASS |
| JSON serialization | PASS |
| Secret/path leak scan | PASS |

## Legacy Source Integrity

七份显式输入的 before/after size 与 SHA-256 全部一致：

| Alias | Size | SHA-256 | Mismatch |
|---|---:|---|---:|
| EXPORT-001 | 20,466 | `C63CC3C95C280661DDAD1356018225C29C985CB62719A6CFE908851258C6CDDA` | 0 |
| EXPORT-002 | 44,675 | `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514` | 0 |
| EXPORT-003 | 22,310 | `86E8226BC3732EEFAA0ED50037DBFD179AA92ADCE64F88EF1324D673F8775C5A` | 0 |
| EXPORT-004 | 22,287 | `493F29E08A98EBCAE1B32464195CB412040624578BF12A0507580E69F1248B00` | 0 |
| EXPORT-005 | 23,207 | `52B64DA644BAC218BA92B0847C2F61254237E8394C86126E6801FED25E7701AB` | 0 |
| RESULT-001 | 5,170 | `D269B69796F7544D787359EB1E4787618B8DBCEA91A7689BA8ACDD50B8378B33` | 0 |
| RESULT-002 | 2,699 | `597FBF61DCA418D13178BCEFA9E8DB36A0CA7EF7EB7303E6B3FA6F1DF7F10039` | 0 |

Total mismatch: **0**。Legacy modification: **0**。

## Created / Modified Files

Created：

1. `src/automation_center/public_api.py`
2. `tests/test_read_api.py`
3. `fixtures/read_api/responses.synthetic.json`
4. `docs/contracts/AUTOMATION_READ_API_V0.1.md`
5. `docs/audits/NEXA_AUTO_001I_READ_API.md`

Modified only for stable top-level exports：

6. `src/automation_center/__init__.py`

其他自动化中心 frozen implementation/contract 与其他 NEXA 模块均未修改。

## Frozen Semantics

| Semantic plane | Modification |
|---|---:|
| Domain V0.1 | 0 |
| Export Mapping V0.1 | 0 |
| Static Snapshot V0.1 | 0 |
| Static ViewModel V0.1 | 0 |
| Result Intake V0.1 | 0 |
| Unified Read Model V0.1 | 0 |

001F 的 Domain Evidence/authority correction 保持延期，没有建立 Domain V0.2 或 Runtime capability。

## Side Effects

| Item | Count / State |
|---|---:|
| Runtime Reader | NO |
| Domain V0.2 | NO |
| Network | 0 |
| n8n Runtime | 0 |
| Automation executions | 0 |
| HTTP / IPC / UI / Core integration | 0 |
| Docker | 0 |
| Database | 0 |
| Credential/Secret reads | 0 |
| Legacy modifications | 0 |
| Other NEXA module modifications | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |

## Acceptance

34 项验收标准全部满足：Public Read API、version、Overview、Workflow/Result list/detail、Unresolved API、full identity、success/error envelope、JSON safety、ISO time、Enum string、mutable isolation、provider neutrality、安全边界、三平面分离、Runtime observed 0、显式 bootstrap、real read-only smoke、Legacy mismatch 0、195 regression、51 新测试、合同与正式报告均完成。

## Known Limitations

- 当前仅为内存 facade，无 persistence、database、cache、pagination 或 transport。
- caller-declared provider context 仍不是 Legacy self-confirmed identity。
- 当前真实 Static 与 sandbox Result provider instance 不同，安全结果为 orphan。
- 部分 Result 无可信 timestamp，不参与 latest。
- 没有 Runtime freshness/health、online/offline 或 execute capability。
- 001F correction 继续延期。

## Recommended Next Task

返回 00-01 审核并冻结 Automation Read Application API V0.1，然后停止。不得自行进入真实 UI、Core Integration、Runtime Read、Domain V0.2 或 Execute。
