# Calendar Local AI Configuration Requirements

```text
CONTRACT: Calendar Local AI Assistant Adapter v0.1
CONFIG_VERSION: 1
DEFAULT_PROVIDER: NONE
DEFAULT_BASE_URL: NONE
DEFAULT_MODEL: NONE
DEFAULT_EXTERNAL_CALLS: 0
PLAINTEXT_CREDENTIAL_STORAGE: FORBIDDEN
CALENDAR_STORAGE: EXISTING_APPLICATION_ONLY
```

## 目的与边界

该配置合同位于本地模型协议层和既有 `createCalendarLocalAiAdapter()` 之间。日历业务层只接收经过校验的结构化操作草稿；更换本地 Provider、协议、端点或模型时，不得重写日历存储与命令执行层。

当前没有填入任何真实 Provider、地址、模型或凭据。用户提供本地模型管理信息之前，产品状态必须是“本地日历助手尚未配置”，不得猜测、发现或自动连接模型。

## 配置字段

| 字段 | 类型与范围 | 要求 |
| --- | --- | --- |
| `version` | 整数，当前为 `1` | 配置合同版本 |
| `enabled` | 布尔值 | 关闭时不得健康检查或生成草稿 |
| `providerId` | 1–100 字符 | 本地 Provider 的非敏感标识 |
| `baseUrl` | HTTP(S) URL | 只允许 `localhost`、loopback、私有 IPv4、link-local/ULA IPv6；禁止用户名、密码、query 和 fragment |
| `protocol` | `openai-chat` / `ollama-chat` | Provider 协议适配器；无默认值 |
| `modelId` | 1–200 字符 | 本地模型 ID；无默认值 |
| `authorizationMode` | `none` / `bearer-env` | 不需要授权，或通过环境变量引用 Bearer 凭据 |
| `credentialReference` | `env:NAME` | 仅保存引用名，不保存或回传凭据值；`none` 模式必须为空 |
| `healthCheckEndpoint` | 同源绝对路径 | GET 健康检查路径；不得是完整 URL、协议相对 URL、query 或 fragment |
| `generationEndpoint` | 同源绝对路径 | POST Chat/Generate 路径；规则同上 |
| `streamingCapability` | `unknown` / `supported` / `unsupported` | 能力声明；v0.1 始终以 `stream: false` 请求 |
| `structuredJsonCapability` | `unknown` / `native` / `prompt-only` / `unsupported` | `unknown` 或 `unsupported` 时不得进入可生成状态 |
| `timeoutMs` | 1,000–120,000 | 单次本地请求超时，默认 30,000 ms |
| `maxConcurrency` | 1–8 | 同时生成请求上限，默认 1；超出时安全拒绝 |

## Readiness 状态

| 状态 | 含义 | 是否发起请求 |
| --- | --- | --- |
| `unconfigured` | 未填写 Provider 身份、地址、协议、模型与端点 | 否 |
| `disabled` | 用户已明确停用 | 否 |
| `configuration_incomplete` | 字段缺失、地址不是本地范围、端点或凭据引用非法、结构化 JSON 不可用 | 否 |
| `ready_for_health_check` | 配置完整，可由用户主动执行健康检查 | 仅在用户点击后 |
| `ready` | 运行时允许生成结构化草稿 | 是，仅由用户提交日历请求后 |
| `error` | 健康检查或本地 Provider 请求失败 | 不自动重试写入；页面显示安全错误状态 |

健康检查不得提交日历文本、事件或任务；只允许对配置的同源本地健康路径执行 GET。健康检查结果只能返回是否可用、稳定错误码、耗时和安全状态，不得返回响应正文、URL、凭据、环境变量值或异常堆栈。

## 协议映射

- `openai-chat`：POST 配置的 generation endpoint，发送 `model`、`messages`、`stream: false`；原生 JSON 能力使用 `response_format: { type: "json_object" }`。
- `ollama-chat`：POST 配置的 generation endpoint，发送 `model`、`messages`、`stream: false`；原生 JSON 能力使用 `format: "json"`。
- 不支持的协议必须失败关闭，不得回退到外部服务或猜测默认端点。

响应大小上限为 1,000,000 字符。响应只投影为 `calendar-ai-proposal-v0.1`，随后仍由日历 Adapter 校验命令类型、字段、风险和确认要求。

## 日历安全生命周期

```text
自然语言输入
→ 本地 Provider 生成结构化草稿
→ 新增 / 修改 / 删除 / 查询分类
→ 变更前后与冲突预览
→ 用户逐项勾选
→ 普通写入确认 / 高风险二次确认
→ 既有 Calendar command executor
→ 执行结果与显式撤销
```

- `propose()` 不写日历。
- 每个写操作都带 `requires_confirmation: true`。
- 查询操作分类为 `query`，不写日历；执行草稿仍要求用户选择该项。
- 删除及其他高风险操作需要第二次确认。
- 未选择的操作不得执行。
- 取消的草稿不得执行；撤销也需要显式确认。
- 模型响应中的未知字段、Secret、路径和额外上下文不得进入公开提案。
- 日历数据继续使用现有 Application、Repository 和 Command 边界；禁止第二套日历存储。

## Credential reference

`bearer-env` 只允许形如 `env:NEXA_CALENDAR_AI_TOKEN` 的引用。设置文件和 Renderer 只保存/显示引用名；运行时仅在用户主动生成草稿时按引用解析值，且不得记录、回传或插入错误消息。当前任务不会读取任何实际凭据。

## 当前交付状态

```text
CONFIGURATION_UI: AVAILABLE
PROVIDER_RUNTIME: IMPLEMENTED_WITHOUT_DEFAULT_ENDPOINT
HEALTH_CHECK: USER_GATED
REAL_MODEL_CONFIGURATION: PENDING_USER_INPUT
REAL_EXTERNAL_AI_CALLS: 0
```
