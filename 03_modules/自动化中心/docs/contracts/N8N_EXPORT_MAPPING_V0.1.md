# n8n Export Mapping Contract V0.1

- Owner：NEXA Automation Center
- Adapter：`N8nExportAdapter`
- Target：Automation Domain Contract `0.1`
- Status：Frozen

## 1. Purpose

把一个由调用方明确授权并显式提供的 n8n static workflow export，安全、确定性地映射为 NEXA `AutomationWorkflow`、`AutomationEvidence` 与 mapping diagnostics。

## 2. Supported Source

支持单个 UTF-8 JSON text/bytes，其根对象至少包含非空 `id` 和 `nodes` array。核心 mapper 是纯内存转换；`map_export_file` 只是读取一个明确路径的薄 wrapper，不发现或扫描目录。

## 3. Non-goals

不实现 n8n Runtime/API、workflow import、activate/deactivate、execute、webhook、schedule、database、credential retrieval、Run query、ViewModel 或 UI。

## 4. Provider Identity Input

调用方必须显式传入：

- `provider_kind = "n8n"`
- `provider_instance_id`
- 安全逻辑 `source_locator`
- timezone-aware `captured_at`
- 可选 `synthetic` 降权标记

`WorkflowRef = (provider_kind, provider_instance_id, export.id)`。

**Workflow display name is not identity.**

**Missing external workflow ID must not fall back to name/path.**

文件名、路径、hash、随机 UUID、当前时间都不得替代 `export.id`。

## 5. Workflow Mapping

| n8n export | NEXA domain | 规则 |
|---|---|---|
| `id` | `WorkflowRef.external_workflow_id` | 必须是非空 string，否则 fail closed |
| `name` | `display_name` | 仅展示；缺失或不安全时使用固定通用名称 |
| `active` | `definition_status` | 只映射 Definition scope |
| trigger nodes | `triggers` | 通过明确 node type 映射 |
| `versionId` | safe `provider_metadata` | 可选、string、通过领域安全校验后才保留 |
| node/trigger count | safe `provider_metadata` | 仅确定性 string summary |

Tags、description、connections、settings、pinData 与未知字段默认不传播。

## 6. Definition Status Mapping

| export `active` | Definition status |
|---|---|
| `true` | `DEFINITION / ACTIVE` |
| `false` | `DEFINITION / INACTIVE` |
| missing | `DEFINITION / UNKNOWN` |
| 非 boolean | malformed export，fail closed |

**Static n8n export is not runtime truth.**

## 7. Trigger Mapping

类型映射只依据 n8n node `type`，不依据 node display name：

| n8n node type | TriggerType |
|---|---|
| `n8n-nodes-base.formTrigger` | `FORM` |
| `n8n-nodes-base.errorTrigger` | `ERROR` |
| `n8n-nodes-base.manualTrigger` | `MANUAL` |
| `n8n-nodes-base.scheduleTrigger` | `SCHEDULE` |
| `n8n-nodes-base.webhook` | `WEBHOOK` |
| 其他 trigger-like type | `OTHER` + `unknown_trigger` diagnostic |

Trigger 必须有稳定 node id；parameters 和原 display name 不传播。Provider metadata 只保留 `provider_node_type`。

## 8. Evidence Mapping

普通 export 产生 `STATIC_EXPORT`/`STATIC_EXPORT authority` evidence。明确或内嵌标记为 synthetic 的 fixture 只能产生 `SYNTHETIC_FIXTURE`/`SYNTHETIC authority` evidence，且不声明真实 Provider source。

Evidence id 由固定 contract label、provider identity、external workflow id、安全 locator、content hash 与 evidence kind 确定性派生；不使用随机数或当前时间。

## 9. ProviderMetadata Whitelist

Workflow whitelist：`export_format`、`node_count`、`trigger_count`、可选 `provider_version_id`。

Trigger whitelist：`provider_node_type`。

继续遵守 Domain V0.1：最多 16 项、单层 string/string、sanitized、排序、禁止敏感 key/value。Provider metadata 不改变核心字段含义。

## 10. Sensitive Field Handling

检测到 credential(s)、password、secret、token、apiKey、authorization、cookie、header、authentication 类 key 时：

- 不访问其业务含义；
- 不复制其 value；
- 不进入 Workflow、Trigger、Evidence summary 或 metadata；
- 只产生通用 `sensitive_field_sanitized` diagnostic。

Node parameters、完整 nodes、execution/binary payload、connections、raw JSON 都不会存入 Domain 或 Adapter result。

**Raw n8n payload must not enter the NEXA domain model.**

## 11. Unknown/Missing Field Handling

- 未知非关键字段：忽略。
- name 缺失：使用固定 display placeholder，不影响 identity。
- active 缺失：Definition `UNKNOWN`。
- 未知 trigger：映射 `OTHER` 并产生 diagnostic。
- nodes 缺失/非 array、node 非 object/type 缺失：malformed，fail closed。
- external workflow id 缺失：fail closed。

## 12. Error Behavior

`N8nExportMappingError` 只返回安全 code/message/diagnostics，不包含 raw input。至少区分 `malformed_export` 与 `missing_workflow_identity`。成功结果 diagnostics 区分 unknown trigger、sensitive sanitization 与 mapping success。

## 13. Determinism

- 原始 bytes 以 SHA-256 建立 content integrity；hash 不是 Workflow identity。
- 同一 raw content 产生同一 content hash。
- Evidence identity 不使用 `datetime.now()`、随机数或文件系统状态。
- 调用方固定 provider context、locator 与 captured time 时，Domain serialization 与 diagnostics 完全确定。

## 14. Runtime Boundary

Adapter 永远返回 `runtime_status=None`。Export `active` 只映射 Definition observation，不创建 Runtime authority，不推断 n8n 是否运行或当前是否 active。

## 15. Known Limitations

- 只验证 001A 已确认的静态 export schema；不是通用 n8n schema validator。
- 不映射 tags、description、connections、settings、pinData 或 node parameters。
- 只保留最小 trigger 与 workflow metadata whitelist。
- 不读取 runtime freshness、Run、health、webhook registration 或 schedule next-run。
- 文件 wrapper 不提供目录发现、批处理、watcher 或写回能力。
