# NEXA-AUTO-001C｜n8n Export Adapter V0.1 验收报告

## Task ID

- Task：`NEXA-AUTO-001C`
- 前置：`NEXA-AUTO-001A`、`NEXA-AUTO-001B`
- 日期：2026-08-10（Asia/Shanghai）
- 模块：`<PROJECT_ROOT>\03_modules\自动化中心`

## Status

**PASS**

`N8nExportAdapter V0.1`、Mapping Contract、synthetic mapping fixtures 与离线测试已完成。首轮实现即通过全部测试，未进行第二轮重构或美化。

## Preflight Baseline

施工前已完整读取 001A/001B 审计报告、Automation Domain Contract V0.1、现有 `src/`、`tests/` 与 `fixtures/`。

- `src/automation_center/__init__.py`：真实存在。
- `src/automation_center/domain/__init__.py`：真实存在。
- Package import 正常，无 Markdown 转义导致的磁盘结构问题，执行 **NO ACTION**。
- 施工前测试：001A 6/6、001B 21/21，共 **27/27 PASS**。
- 5 个授权主导出施工前均记录 relative path、size 与 SHA-256。

## 001B Contract 是否修改

**0（未修改）**。

- `src/automation_center/domain/models.py` LastWrite 仍为 `2026-08-10T21:01:36.6300727+08:00`。
- `docs/contracts/AUTOMATION_DOMAIN_CONTRACT_V0.1.md` LastWrite 仍为 `2026-08-10T21:02:12.4528404+08:00`。
- Adapter 依赖 Domain；Domain 不 import Adapter，回归测试对此有显式检查。
- Contract correction：不需要。

## Adapter API

```python
N8nExportAdapter.map_export(
    raw_export: str | bytes,
    context: N8nExportContext,
) -> N8nExportMappingResult

N8nExportAdapter.map_export_file(
    path: str | Path,
    context: N8nExportContext,
) -> N8nExportMappingResult
```

核心 `map_export` 是单输入、纯内存转换。File wrapper 只读取调用方明确给出的一个文件；不会扫描或发现目录，也不会从物理路径生成 identity/locator。

`N8nExportContext` 强制调用方显式提供：`provider_kind="n8n"`、`provider_instance_id`、安全逻辑 `source_locator`、timezone-aware `captured_at` 和可选 synthetic 标记。

成功返回 Workflow、Evidence 和 diagnostics；失败抛出不携带 raw payload 的 `N8nExportMappingError`。

## Workflow Identity Mapping

```text
WorkflowRef = (provider_kind, provider_instance_id, export.id)
```

- `export.id` 必须是非空 string。
- name 仅进入 `display_name`，不参与 identity。
- name、filename、path、content hash、随机 UUID、当前时间都不作为 fallback identity。
- id 缺失时返回 `missing_workflow_identity` 并 fail closed。
- 相同 external id 在不同 provider instance 下不冲突。

## Definition Status Mapping

| export active | Domain Definition status |
|---|---|
| `true` | `DEFINITION / ACTIVE` |
| `false` | `DEFINITION / INACTIVE` |
| missing | `DEFINITION / UNKNOWN` |
| 非 boolean | `malformed_export`，fail closed |

## Runtime Boundary

Adapter 永远返回 `runtime_status=None`。Static export 的 active 不会生成 Runtime authority、Runtime ACTIVE 或 n8n 正在运行的暗示。本任务没有 Runtime API、Run query 或 health observation。

## Trigger Mapping

- `n8n-nodes-base.formTrigger` → `FORM`
- `n8n-nodes-base.errorTrigger` → `ERROR`
- 明确的 Manual/Schedule/Webhook 类型可映射到对应轻量枚举，但没有任何执行/调度能力。
- 未识别的 trigger-like type → `OTHER` + `unknown_trigger` diagnostic。
- 映射只依据 node type，不依据 node display name。
- Trigger metadata 只保留 `provider_node_type`；node parameters 不传播。

## Evidence Mapping

普通 export 产生：

- kind：`STATIC_EXPORT`
- authority：`STATIC_EXPORT`
- source：显式 ProviderRef
- locator：调用方提供的安全逻辑 label
- integrity：原始 bytes 的完整 SHA-256
- `sanitized=true`、`synthetic=false`
- 固定安全 summary

Synthetic fixture 会被自动降权为 `SYNTHETIC_FIXTURE`/`SYNTHETIC`，`synthetic=true` 且不声明 Provider source。

Evidence id 由固定 mapping version、provider identity、external workflow id、safe locator、content hash 与 evidence kind 确定性派生；不使用随机数或当前时间。Hash 只用于 integrity，不用于 Workflow identity。

## Diagnostics

最小 diagnostics 已建立：

- `malformed_export`
- `missing_workflow_identity`
- `unknown_trigger`
- `sensitive_field_sanitized`
- `mapping_success`

Diagnostics 不进入 Domain Contract，不包含原参数、Secret、真实 id 或路径。

## Sensitive-field Policy

- credentials/credential、password、secret、token、apiKey、authorization、cookie、header、authentication 类字段只触发通用 sanitization diagnostic。
- 其值不进入 Workflow、Trigger、ProviderMetadata、Evidence summary、diagnostics 或 result repr。
- Node parameters、完整 nodes、connections、settings、pinData、execution/binary payload 与 raw JSON 不保存在 Domain/Adapter result。
- Workflow metadata whitelist：`export_format`、`node_count`、`trigger_count`、可选安全 `provider_version_id`。
- Trigger metadata whitelist：`provider_node_type`。
- 继续受 Domain V0.1 的最多 16 项、浅层 string/string 和 Secret pattern 防线约束。

## Synthetic Fixtures

永久测试仅使用：

1. 001A `workflow.synthetic.json`：Form Trigger、synthetic/inactive 基线。
2. `workflow.mapping_cases.json`：最小集合覆盖 Error Trigger、missing active、unknown trigger、missing id 和完全虚构的 sensitive raw case。

虚构 marker 仅使用 `FAKE_TEST_TOKEN`/`FAKE_TEST_COOKIE`，没有复制真实 credential 名称或值。

## 真实 Export 只读兼容验证

只读取 001A 已确认的 5 个主导出，各一次，使用固定 captured time、安全 locator `authorized-export:001..005` 和明确的非 Runtime 验证实例别名 `authorized-static-export-set-001`。没有把真实 raw payload 保存到 NEXA。

结果：**成功 5，失败 0；唯一 identity 别名 2**。

| Export alias | Workflow alias | Definition | Triggers | Diagnostics | SHA-256 prefix |
|---|---|---|---|---|---|
| EXPORT-001 | WF-001 | inactive | form | sanitized, success | `c63cc3c95c28` |
| EXPORT-002 | WF-001 | inactive | form, error | sanitized, success | `b99305226761` |
| EXPORT-003 | WF-001 | inactive | form | sanitized, success | `86e8226bc373` |
| EXPORT-004 | WF-001 | inactive | form | sanitized, success | `493f29e08a98` |
| EXPORT-005 | WF-002 | inactive | form | sanitized, success | `52b64da644ba` |

表中不含真实 workflow id、name、node parameters、credential reference 或绝对路径。首次验证命令在读取任何文件前因 PowerShell 中文管道编码失败；改用 UTF-8 管道后 5 个授权 export 均一次映射成功，该 shell 编码事件不计为 export mapping failure。

## 真实 Export 前后完整性检查

**PASS**。

| Relative path | Size | SHA-256 prefix | 前后匹配 |
|---|---:|---|---|
| `input/...V1.4...json` | 20,466 | `C63CC3C95C28` | 是 |
| `output/...V1.4.1...json` | 44,675 | `B99305226761` | 是 |
| `output/...DeepSeek...json` | 22,310 | `86E8226BC373` | 是 |
| `output/...V1.4...fixed.json` | 22,287 | `493F29E08A98` | 是 |
| `output/...V2.0.json` | 23,207 | `52B64DA644BA` | 是 |

前后 size/hash mismatch：**0**。外部 export 内容修改：**0**。

## 测试结果

执行：

```text
python -m unittest discover -s <PROJECT_ROOT>\03_modules\自动化中心\tests -p test_*.py -v
```

- 新增 Adapter tests：**27/27 PASS**
- Regression：**27/27 PASS**
- 总计：**54/54 PASS**
- 用时：约 0.016 秒
- 施工轮次：1（首轮通过，未开启第二轮）

覆盖 provider-scoped identity、name/path 不回退、Definition/Runtime 边界、Form/Error/unknown trigger、Evidence/hash/确定性、synthetic 降权、Secret/parameters/raw payload 隔离、metadata whitelist、malformed fail closed、无网络/Runtime/commands 依赖与无 Domain 反向耦合。

## 创建/修改文件

本任务只创建：

1. `src/automation_center/adapters/__init__.py`
2. `src/automation_center/adapters/n8n_export.py`
3. `fixtures/n8n/workflow.mapping_cases.json`
4. `tests/test_n8n_export_adapter.py`
5. `docs/contracts/N8N_EXPORT_MAPPING_V0.1.md`
6. `docs/audits/NEXA_AUTO_001C_N8N_EXPORT_ADAPTER.md`

没有修改已有 Domain、fixture、tests、001A/001B 报告或其他 NEXA 模块。没有保留 `__pycache__`。

## 副作用计数

| 项目 | 结果 |
|---|---:|
| Network | 0 |
| n8n Runtime calls | 0 |
| Automation executions | 0 |
| webhook/schedule | 0 |
| Docker/Database | 0 |
| 外部 n8n 修改 | 0 |
| 其他 NEXA 模块修改 | 0 |
| OpenCode | 0 |
| DeepSeek | 0 |
| 其他外部模型 | 0 |

## Contract Correction

不需要。`CONTRACT_CORRECTION_REQUIRED = false`。

## Known Limitations

1. 仅映射已确认的静态 workflow export 形状，不是完整 n8n schema validator。
2. 不映射 tags、description、connections、settings、pinData 或 node parameters。
3. Trigger 只保留统一类型与最小 provider node type metadata。
4. 没有 Runtime freshness、Run、health、webhook registration、schedule next-run 或 command 能力。
5. File wrapper 只处理显式单文件，不提供目录发现、批处理、watcher 或写回。

## 下一任务建议

人工评审 Adapter/Mapping Contract 后，可为静态 Workflow 建立只读 Application Query/ViewModel contract；Runtime API、Execute、Trigger、scheduler 与 credential 能力继续保持独立并等待明确授权。

