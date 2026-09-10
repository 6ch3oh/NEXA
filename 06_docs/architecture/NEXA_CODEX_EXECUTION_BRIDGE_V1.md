# NEXA Codex–ExecutionHub Bridge V1

- 文档状态：架构设计，不是实现
- 项目 ID：`NEXA-BRIDGE-ARCH-001`
- 适用范围：灵鹊、鹊桥、Codex Connector、ExecutionHub
- 强制顺序：`GPT → 灵鹊 → 鹊桥 → Codex → 鹊桥 → ExecutionHub → OpenCode + DeepSeek`
- 第一阶段：只开放`health`和`preflight`，不开放`prepare`和`execute`

## 1. 目标与不可变边界

本桥接层的目标是让鹊桥可靠传输任务、Codex作工程决策、ExecutionHub执行确定性安全检查。它不把鹊桥变成规划器，不把ExecutionHub变成自然语言代理，也不允许任何一层以普通哈希冒充身份认证。

不可变规则：

1. GPT任务必须先经Codex结构化决策；只有`decision=delegate`才可能进入ExecutionHub。
2. 鹊桥只做协议、持久化、幂等、路由和证据转运，不拆解工程任务、不选择执行模型、不修复结果。
3. Codex决定“是否委派、委派什么、边界多大”，但不能绕过ExecutionHub的Schema、preflight、锁、Permit或路径权限。
4. ExecutionHub只接收结构化Task和认证后的决策证据，不解释自然语言产品目标。
5. 第一阶段不获取正式写锁、不签发Permit、不生成handoff、不启动Worker。
6. ChatGPT网页登录态、浏览器Origin、Windows交互登录和本机回环地址都不能单独代表本地执行身份。

## 2. 现状资产复用表

| 资产 | 已确认状态 | 复用方式 | 不可误用 |
| --- | --- | --- | --- |
| 鹊桥`QUEQIAO_TASK_V1/RESULT_V1` | 严格字段、持久幂等、原子文件存储已存在 | 作为外层任务线程和回传协议 | 不能替代ExecutionHub Task Schema |
| 鹊桥FileTaskStore | task/state/result/log/outbox可持久恢复 | 保存请求摘要、决策、调用回执和回传状态 | 不保存密钥、Permit正文或完整重复上下文 |
| 鹊桥本地HTTP/SSE | 固定`127.0.0.1`、Origin限制、请求大小限制 | 灵鹊传输和状态订阅 | 回环与Origin不是充分身份认证 |
| Codex connector | 当前只有`FakeCodexConnector`；真实connector未实现 | 保留`invoke`端口思想，后续换为真实受信connector host | fake结果不能授权真实ExecutionHub |
| ExecutionHub CLI | 单stdin JSON、单stdout JSON、stderr诊断 | 作为鹊桥唯一ExecutionHub入口 | 鹊桥不得导入内部锁/Permit/Runner模块 |
| `health` | 仅检查CLI/AJV边界 | 第一阶段能力探测 | 不携带任务、不产生执行授权 |
| `preflight` | Schema、路径、模式和锁可用性探测；不分配Worker/run_id | 第一阶段唯一任务接口 | 通过不等于执行许可 |
| `prepare` | 无持久文件/正式锁/Permit/Worker进程；但生成进程内run_id并选择Worker | 后续阶段单独开放 | 不能称为纯只读查询或执行授权 |
| CLI Mock生命周期 | 锁、Permit、消费、handoff、claim、回执同run_id已通过 | 作为未来真实execute的安全基线 | mock通过不代表生产execute已开放 |
| Permit v0.2与项目写锁 | 所有权、完整性、单次消费已验证 | 真实execute阶段的执行授权 | Permit不是调用方身份认证 |

## 3. 正确调用顺序

### 3.1 任务路径

```text
GPT确认任务
  → 灵鹊只采集可见任务与context_reference
  → 鹊桥校验、去重并持久化任务线程
  → 受信Codex Connector Host调用Codex
  → Codex返回CODEX_DECISION_V1
  → Connector Host校验决策并生成带时效的决策证明
  → 鹊桥只转运决策证明与最小ExecutionHub请求
  → ExecutionHub验证证明、nonce、正文绑定和命令权限
  → 第一阶段仅执行health或preflight
  → 鹊桥持久化结构化结果并经灵鹊回传GPT
```

`health`是运维能力探测，可由已认证鹊桥服务直接调用，不需要每次消耗Codex调用；它不得携带Task，也不得转化为任何执行状态。所有来自GPT的任务型`preflight`必须先有有效的Codex决策证明。

### 3.2 禁止路径

- `GPT → 灵鹊 → 鹊桥 → ExecutionHub`：缺少Codex决策，拒绝。
- `鹊桥自然语言 → ExecutionHub`：ExecutionHub不解释目标，拒绝。
- `Codex决定delegate → 鹊桥直接启动OpenCode`：绕过ExecutionHub，拒绝。
- `preflight accepted → 自动prepare/execute`：权限升级，拒绝。

## 4. 组件责任矩阵

| 能力 | 灵鹊 | 鹊桥 | Codex | ExecutionHub |
| --- | --- | --- | --- | --- |
| 用户可见任务采集 | 负责 | 接收 | 不负责 | 不负责 |
| 去重、任务线程、outbox | 不负责 | 负责 | 不负责 | 仅自身request幂等 |
| 工程目标理解与拆解 | 禁止 | 禁止 | 负责 | 禁止 |
| 风险发现与委派决策 | 禁止 | 只执行确定性策略上限 | 负责 | 只执行安全拒绝规则 |
| Task Schema/路径安全 | 不负责 | 不复制权威规则 | 提出候选边界 | 权威校验 |
| Worker、锁、Permit、Runner | 禁止 | 禁止 | 禁止直接操作 | 唯一负责方 |
| API Key | 禁止 | 禁止 | 不接触 | 仅安全启动链处理 |
| 结果验收 | 展示 | 汇总证据 | 按授权审查 | 确定性校验与回执 |

## 5. Queqiao → Codex请求草案

建议名称：`CODEX_TASK_REQUEST_V1`。安全边界对象使用严格Schema并拒绝未知字段。

```json
{
  "schema_version": "1.0",
  "task_id": "task-...",
  "project_id": "project-...",
  "project_path": "<absolute-local-path>",
  "goal": "结构化、单一目标",
  "inputs": [{"kind":"context_reference","reference":"queqiao-context://ctx-...","sha256":"..."}],
  "allowed_scope": {"read_paths":[],"write_paths":[],"execution_modes":["readonly"]},
  "prohibited_actions": ["execute","credential_access","permanent_environment_change"],
  "acceptance_criteria": [{"type":"structured_condition","description":"..."}],
  "risk_level": "low",
  "model_budget": {"max_codex_calls":1,"max_delegated_model_calls":0,"timeout_seconds":120},
  "context_reference": "queqiao-context://ctx-...",
  "context_hash": "sha256:<64-hex>"
}
```

`context_hash`用于内容寻址、去重和变更检测，不是认证凭据。Codex只读取解决决策所必需的引用片段；未读取引用必须在证据中保持未使用状态。

## 6. CODEX_DECISION_V1草案

```json
{
  "schema_version": "1.0",
  "decision_id": "decision-...",
  "task_id": "task-...",
  "decision": "delegate",
  "codex_work": {
    "operations_performed": ["plan"],
    "summary": "决定摘要，不复制完整上下文"
  },
  "delegated_work": {
    "target": "executionhub",
    "allowed_commands": ["preflight"],
    "task_contract_reference": "queqiao-task://task-.../executionhub-task",
    "task_contract_hash": "sha256:<64-hex>"
  },
  "requires_user_confirmation": {
    "required": false,
    "operations": []
  },
  "risk_findings": [],
  "delegation_plan": {
    "reason": "...",
    "execution_mode_ceiling": "readonly",
    "next_gate": "executionhub_preflight"
  },
  "execution_limits": {
    "max_model_calls": 0,
    "timeout_seconds": 120,
    "automatic_retry": false,
    "expires_at": "2026-08-06T00:02:00Z"
  },
  "evidence_references": [
    {"reference":"queqiao-context://ctx-...","sha256":"...","usage":"decision_input"}
  ],
  "timestamps": {
    "requested_at": "2026-08-06T00:00:00Z",
    "decided_at": "2026-08-06T00:00:10Z"
  }
}
```

`decision`枚举及路由：

| decision | 行为 |
| --- | --- |
| `codex_only` | Codex自行完成只读分析；不得调用ExecutionHub任务接口 |
| `delegate` | 仅允许按`allowed_commands`和限制转交；第一阶段最多`preflight` |
| `needs_user` | 鹊桥进入`needs_user`并回传确认项；不得预先调用ExecutionHub |
| `rejected` | 终止；保留原因和证据摘要 |
| `blocked` | 资源、认证或证据不足；不得降级绕过Codex |

调用方不得覆盖`delegated_work`、路径、模型上限或确认要求。Codex决策不能降低ExecutionHub确定性拒绝规则。

## 7. 第一阶段只读接口范围

| 命令 | 第一阶段 | 原因 |
| --- | --- | --- |
| `health` | 允许 | 无Task、无Worker/run_id/锁/Permit；仅能力探测 |
| `preflight` | 允许 | dry-run；验证Schema、路径与锁可用性，不分配Worker/run_id，不持正式锁 |
| `prepare` | 不开放 | 当前实现不持久写状态，但会生成进程内run_id、选择Worker并产生handoff plan，具有资源分配意图，超出只读探测 |
| `execute` | 禁止 | 生产真实执行仍未授权；test mode只对固定测试入口开放 |

因此prepare在“文件系统副作用”意义上是无持久写的，但在“调度语义”上不是纯只读。它必须等Worker租约、调用认证、决策绑定与审计规则完成后单独开放。

## 8. 认证、完整性、防重放、授权与审计

### 8.1 概念分离

| 属性 | 回答的问题 | 推荐机制 |
| --- | --- | --- |
| 身份认证 | 谁发起/谁证明Codex已被调用？ | 受信Codex Connector Host + 独立密钥身份 |
| 请求完整性 | 请求或决策是否被改动？ | canonical JSON + HMAC-SHA-256 |
| 防重放 | 合法旧请求是否被再次使用？ | 一次性nonce、短TTL、原子nonce ledger |
| 权限授权 | 这个身份可以执行什么？ | 决策`allowed_commands` + ExecutionHub Schema/preflight；后续Permit |
| 审计证据 | 事后能否关联整条链？ | task/decision/request/run ID、哈希、key_id、时间和结果路径 |

普通SHA-256只能证明“与某个已知摘要一致”；如果摘要和正文由攻击者一起提供，它不能认证身份。Permit证明ExecutionHub内部执行授权，也不能证明调用请求来自Codex。

### 8.2 方案比较

| 方案 | 结论 |
| --- | --- |
| 仅本机用户身份 | 不足；同一用户的其他进程也可调用 |
| 固定CLI路径和父进程限制 | 仅纵深防御；路径/PID可变化，不能单独认证 |
| 一次性nonce | 必需防重放，但不认证签发者 |
| 本地共享密钥HMAC | 推荐的请求完整性与实体认证基础；密钥必须隔离于鹊桥普通业务进程 |
| Windows凭据存储 | 推荐保存HMAC密钥；使用Credential Manager/DPAPI并以专用服务身份/ACL限制 |
| Codex决策正文哈希绑定 | 必需绑定，但必须置于HMAC覆盖范围内 |
| ExecutionHub Permit | 后续execute授权必需；不是上游身份认证替代品 |

### 8.3 推荐证明信封

受信`Codex Connector Host`调用已配置的真实Codex接口、校验`CODEX_DECISION_V1`后生成：

```json
{
  "attestation_version": "1.0",
  "issuer": "nexa-codex-connector-host",
  "key_id": "codex-bridge-key-01",
  "nonce": "<128-bit-random>",
  "issued_at": "...",
  "expires_at": "...",
  "task_id": "...",
  "decision_id": "...",
  "decision_hash": "sha256:...",
  "executionhub_request_hash": "sha256:...",
  "allowed_command": "preflight",
  "hmac": "base64url(HMAC-SHA-256(canonical-fields))"
}
```

HMAC密钥不交给灵鹊、GPT、普通鹊桥路由逻辑、CLI参数、环境变量或日志。ExecutionHub验证器按`key_id`从Windows安全存储读取验证密钥，恒定时间比较HMAC，核对TTL/命令/任务/决策/请求哈希，并以`key_id + nonce`原子登记已用nonce。验证失败一律在preflight前拒绝。

这里证明的是“请求经过受信Connector Host并绑定了其捕获的Codex决策”，不是ChatGPT网页身份，也不是模型提供商级远程签名。真实Codex connector的认证来源、计费、线程恢复和无UI调用仍必须单独验证。

## 9. 状态机

```text
received
  → codex_pending
  → decision_recorded
      ├─ codex_only → codex_completed → delivery_pending
      ├─ needs_user → needs_user
      ├─ rejected → rejected
      ├─ blocked → blocked
      └─ delegate → attestation_issued
                       → executionhub_preflight
                           ├─ accepted → preflight_accepted
                           ├─ rejected → rejected
                           └─ blocked → blocked
```

第一阶段`preflight_accepted`是终点之一，不自动进入prepare。未来每次权限升级都要求新状态、新决策/用户确认（如适用）和新防重放证明。

## 10. 失败处理

- Codex connector不可用：`blocked_codex_unavailable`；不绕过Codex。
- 决策Schema或哈希不一致：`rejected_decision_invalid`。
- HMAC、TTL或nonce失败：`rejected_authentication`或`rejected_replay`；不暴露内部密钥状态。
- context hash不一致：`blocked_context_changed`；要求生成新决策，不能沿用旧签名。
- ExecutionHub rejected/blocked：原样映射，不提升、不自动修改Task。
- stdout不是单JSON、版本不兼容或超时：`blocked_executionhub_protocol`。
- 鹊桥/灵鹊回传失败：只进入`delivery_deferred`，不重新调用Codex或ExecutionHub。
- 第一阶段禁止自动重试；人工重试必须新nonce，正文变化必须新decision_id。

## 11. Token成本控制

1. **共享上下文引用**：GPT背景只落一次内容寻址存储，传`context_reference + context_hash`，不在鹊桥、Codex、Worker间复制全文。
2. **增量任务包**：Codex请求只含目标、边界、变更后的上下文片段和验收条件；引用未变材料。
3. **按需读取**：Codex先读摘要/索引，只有决策需要时读取指定片段并记录`evidence_references`。
4. **决策缓存**：缓存键至少包含`task_id + goal_hash + context_hash + policy_version + connector_version`；同文幂等返回原决策，不新增调用。
5. **Worker最小包**：DeepSeek只接收已授权文件列表、直接任务、必要模板和校验，不读取GPT全背景。
6. **结构化摘要**：跨层传递状态、原因码、哈希和报告路径；不传完整stdout、内部prompt或重复自然语言复盘。
7. **预算与停止**：`max_codex_calls`、`max_model_calls`、timeout和stop_conditions在决策中固定；失败不得隐式增加预算。
8. **一次规划多子任务**：Codex在一个decision中给出有界`delegation_plan`，后续确定性子任务只引用该计划；边界变化才重新规划。

## 12. 分阶段实施计划与允许修改范围

| 阶段 | 目标 | 建议允许修改范围 | 明确禁止 |
| --- | --- | --- | --- |
| 0（本文件） | 边界设计 | 两份文档 | 所有代码/Schema |
| 1 | 固化`CODEX_TASK_REQUEST_V1`与`CODEX_DECISION_V1` | 鹊桥新增Schema、validator、fixtures、tests、报告 | ExecutionHub、真实connector、模型调用 |
| 2 | Connector Host证明与nonce ledger | 鹊桥connector host、安全存储适配、测试；ExecutionHub新增认证验证门面/Schema | prepare/execute、真实密钥写盘 |
| 3 | 只读适配器 | 鹊桥ExecutionHub adapter；ExecutionHub CLI认证请求版本；只开放health/preflight | Worker、锁、Permit、prepare/execute |
| 4 | prepare评估 | Worker租约/可用性快照、审计、显式能力授权 | 自动execute |
| 5 | 真实execute闸门 | 同进程锁/Permit/消费/handoff/Runner；人工授权和密钥注入 | 绕过Codex、自动重试、鹊桥持密钥 |

每阶段必须独立授权、独立验收；不得因前阶段通过自动进入下一阶段。

## 13. 真实execute开放前置条件

1. 真实Codex connector接口、认证来源、线程模型、额度和失败语义已本地验证；fake connector不参与生产授权。
2. HMAC密钥在Windows安全存储中，由专用身份隔离；轮换、撤销、key_id和日志脱敏已测试。
3. nonce ledger原子、跨进程有效、TTL和时钟偏差策略已测试；重放不能到达preflight。
4. ExecutionHub验证决策证明并将decision/request/task哈希绑定到审计链；普通SHA不被当认证。
5. `needs_user`操作具有不可伪造的用户确认收据，且确认范围/期限明确。
6. prepare的Worker选择/资源语义和并发租约已单独验收。
7. 生产execute同进程持锁、Permit v0.2、原子消费、claim、回执、失败释放和幂等链完成生产模式测试。
8. API Key仍只由ExecutionHub安全启动器注入目标子进程；鹊桥和Codex不读取。
9. 审计、熔断、取消、失败停止与人工恢复规则完成；陈旧锁/nonce不自动删除。
10. test mode、mock和生产模式不可由外部请求切换。

## 14. 风险清单

| 风险 | 当前判断 | 控制 |
| --- | --- | --- |
| 鹊桥当前MVP先fake preflight再fake Codex | 与目标真实顺序不兼容 | 新真实路径必须先决策后preflight；不得复用MVP顺序 |
| 当前Codex connector仅为fake | 不能证明真实Codex调用 | 真实connector验证是execute硬前置 |
| loopback服务无完整配对token/HMAC | 本机其他进程可能调用 | 阶段2补齐身份与消息认证 |
| Origin允许无Origin本机请求 | Origin不能保护CLI/本机进程边界 | token/HMAC与专用身份；Origin仅浏览器层防护 |
| context_reference指向越界路径 | 可能扩大读取范围 | 内容寻址存储、根目录allowlist、realpath和hash复核 |
| 决策过期后复用 | 权限陈旧 | 短TTL、nonce ledger、新decision_id |
| prepare被误当只读 | 提前产生Worker/run计划 | 第一阶段禁用；单独授权评估 |
| Plain SHA冒充认证 | 可同时伪造正文与摘要 | HMAC覆盖哈希和身份字段 |
| 鹊桥获得HMAC密钥 | 可伪造Codex证明 | Connector Host与ExecutionHub专用安全身份隔离 |
| 重复上下文造成Token膨胀 | 成本和一致性风险 | 内容引用、增量包、决策缓存、Worker最小包 |

## 15. 推荐的下一项最小开发任务

`NEXA-BRIDGE-DEV-001：CODEX_TASK_REQUEST_V1 / CODEX_DECISION_V1契约与纯本地验证器`

范围仅在鹊桥新增两份Schema、canonical序列化/哈希、validator、正反fixtures和测试；使用fake decision fixture，不调用真实Codex，不调用ExecutionHub，不实现HMAC密钥存储。验收应覆盖未知字段、decision路由、context hash绑定、`delegate`必须含delegated_work、非delegate不得进入ExecutionHub，以及同文幂等/异文冲突。该任务完成后，再单独设计Connector Host与HMAC/nonce实现。
