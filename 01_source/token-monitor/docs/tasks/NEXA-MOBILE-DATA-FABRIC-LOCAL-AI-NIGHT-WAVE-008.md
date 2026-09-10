# NEXA-MOBILE-DATA-FABRIC-LOCAL-AI-NIGHT-WAVE-008

## 0. 执行位置与模型

**Codex 聊天：** `00-08 移动端、数据中枢与本地AI`

**工作区：** `<PROJECT_ROOT>`

**模型：** `GPT-5.6 Sol`

**推理程度：** `High`

**执行模式：** `CODEX_DIRECT_IMPLEMENTATION`

```text
OPENCODE_CALLS_MAX = 0
DEEPSEEK_CALLS_MAX = 0
COMPUTER_USE_CALLS_MAX = 0
CODEX_MAJOR_CYCLES_MAX = 16
```

不得把本任务转交 OpenCode、DeepSeek 或 Computer Use。

---

## 1. 当前唯一正式项目身份

### 允许写入

```text
CORE_PROJECT:
<PROJECT_ROOT>\01_source\token-monitor

MOBILE_PROJECT:
<PROJECT_ROOT>\03_modules\NEXA-Mobile

CALENDAR_PROJECT:
<PROJECT_ROOT>\03_modules\日历与星枢管家

CONSUMPTION_PROJECT:
<PROJECT_ROOT>\03_modules\消费中心

AI_ASSET_PROJECT:
<PROJECT_ROOT>\03_modules\AI资产中心

DEVICE_PROJECT:
<PROJECT_ROOT>\03_modules\设备与网络
```

### 默认只读

```text
EXECUTIONHUB_PROJECT:
<PROJECT_ROOT>\04_automation\ExecutionHub

PRODUCT_DESIGN_PROJECT:
<PROJECT_ROOT>\02_product_design
```

### 禁止作为写入目标

```text
E:\AI工作台\个人控制台\01_desktop-hub\token-monitor
E:\AI\本地AI
```

附件中出现的 `E:\AI工作台\个人控制台\01_desktop-hub\token-monitor` 只允许做一次精确身份核对。当前正式 NEXA Core 以已经通过 Wave 007/r4 的 `<PROJECT_ROOT>\01_source\token-monitor` 为唯一权威写入目录。

若旧路径存在且不是 junction/symlink/same-file identity：

```text
LEGACY_OR_DUPLICATE_COPY_DETECTED = YES
```

不得写入、同步或自动合并旧副本。

严禁扫描 `<PROJECT_ROOT>` 整个根目录或任何项目上级目录。只允许直接访问本合同列出的路径。

同一项目同一时间只允许一个写入任务。各项目按依赖顺序施工，不并发写入。

---

## 2. 当前真实基线

必须继承，不得重做：

- NEXA Desktop Daily-Use RC；
- Wave 007 及 r4 全宽页面基线；
- Owner Runtime、Dispatch、Result/Evidence；
- NEXA Mobile 已有二维码/SAS 配对、TLS、Pin、可信设备、Direct/Reverse Transport、自动发现与重连；
- Android Notification Listener、Desktop Intake、消费草稿、去重与正式消费库；
- 日历完整月历、任意日期编辑、本地 AI provider-neutral Adapter；
- Token Monitor 现有 Token 统计；
- 设备与网络现有本机采集；
- Hub secret 安全修复。

当前已知真实消费链：

- 手机已配对并在线；
- Notification permission 已授权；
- Listener active；
- Desktop 已接收大量真实通知；
- 支付候选、消费草稿链已工作；
- 正式消费写入仍遵循现有确认合同。

不得以本任务为由清空、重置或替换用户当前数据。

---

## 3. 总目标

在一个最长 8 小时的夜间施工窗口内，完成以下五条产品主线：

1. **NEXA Mobile 更新通道**：以后绝大多数配置、数据、主题和内容更新无需重新安装 APK；原生 Android 代码更新由电脑构建并通过已授权 USB/Wi-Fi ADB 覆盖安装，尽可能减少人工步骤，但不得绕过 Android 系统安全确认。
2. **手机端日历、账单与命令入口**：手机成为 NEXA 的安全薄客户端，命令发送到电脑，由电脑本地 AI 生成结构化建议；手机和电脑实时同步。
3. **本地 4B AI 正式接入**：真实确认 LM Studio、Exact Model ID 和 localhost API；共享给日历与消费中心；失败时记录后绕过，不阻塞其他主线。
4. **本地数据中枢与时间索引**：盘点并整理 Token、消费、通知、日历、设备和自动化数据；同时支持“按种类看时间序列”和“按日期看多种数据”。
5. **完整通知归档与消费智能整理**：保留可追溯的原始通知证据，使用确定性规则优先、本地 AI 兜底，对收入/支出、商户、分类和跨 App 重复通知进行整理。

最终目标：

```text
NEXA_MOBILE_DATA_FABRIC_WAVE008_READY = true
```

若本地模型或 OEM 安装确认需要人工，允许对应子项为 `HUMAN_GAP`，但其余可独立能力必须继续完成并封板。

---

## 4. 时间与本地强制截止

不得只在自然语言里写截止时间。

开始后必须创建或复用一个本地只读可审计的 Wave 状态文件，记录：

- start_at；
- hard_deadline_at；
- feature_freeze_at；
- closeout_at；
- current_phase；
- completed/blocked tasks；
- active project/writer；
- last checkpoint。

时间：

```text
HARD_DEADLINE = 实际开始后 8 小时
FEATURE_FREEZE = 实际开始后 6 小时 30 分
FINAL_CLOSEOUT = 最后 90 分钟
```

每次开始新 Phase 前必须重新读取本地时间并校验 Gate。

到达 FEATURE_FREEZE 后禁止新增功能，只允许测试、修复直接回归、构建、安装验收、备份和报告。

到达 HARD_DEADLINE 后不得创建新写入任务。

---

## 5. Phase 0：预检、锁与真实状态

必须先完成：

1. 检查所有允许写项目的 Git/worktree/未提交修改；
2. 检查当前写入任务、Writer Lock、Workbench Lease；
3. 确认没有另一项 NEXA 写任务并发；
4. 记录各项目施工前测试基线；
5. 检查磁盘空间；
6. 记录当前 Desktop 与 Mobile 稳定构建；
7. 精确确认 Android package、版本、签名身份、安装路径和应用数据状态；
8. 通过 USB ADB 确认真实设备已授权；
9. 禁止卸载、清除应用数据或更换签名；
10. 检查当前 Wi-Fi ADB/无线调试状态；
11. 读取附件中的 4B AI 接入要求，但不得把候选显示名称当成真实 Model ID；
12. 建立数据源盘点清单。

若手机弹出系统授权或安装确认：

- 不使用 Computer Use；
- 不模拟点击；
- 记录最小人工动作；
- 继续不依赖该确认的工作。

---

## 6. Phase 1：NEXA Mobile Update Coordinator V0.1

### 6.1 更新分层

必须明确区分：

#### A. 无 APK 的运行时同步

允许同步：

- 页面布局配置；
- 主题 Token；
- 首页卡片配置；
- 文案与非敏感提示；
- 词库和本地数据包；
- 日历/消费查询 Schema；
- 允许的图标和静态资源；
- 功能开关；
- 服务 Endpoint 引用；
- 数据保留策略。

必须使用：

- 版本化 manifest；
- SHA-256；
- 签名或现有可信设备认证；
- 原子写入；
- 失败回滚；
- 最近一个可用版本保留；
- 明确 allowed resource types。

严禁通过运行时同步下发：

- 任意 DEX；
- 任意可执行代码；
- 任意未经约束的脚本；
- Credential/Secret；
- 可绕过 Android 权限边界的载荷。

#### B. Android 原生代码更新

Kotlin/Java/Compose/Manifest/原生依赖变化必须：

```text
PC 修改源码
→ 使用现有签名构建 APK
→ 验证 package/signature/version
→ USB 或 Wi-Fi ADB install -r
→ 保留数据与可信配对
→ 启动并验收
```

不得卸载后重装。
不得使用 `pm clear`。
不得更换 package name 或签名。

如果 Vivo/OEM 强制用户确认：

```text
NATIVE_UPDATE_OEM_CONFIRMATION_REQUIRED = YES
```

不得自动点击或绕过。

#### C. 非 ADB 自更新

允许建设：

- PC 向手机推送已签名 APK；
- 手机校验版本、签名和哈希；
- 调起系统 Package Installer；
- 显示清楚的更新说明与回滚信息。

但不得把“调起安装器”虚报为“完全静默安装”。

### 6.2 更新产品界面

PC 与手机都应显示：

- 当前 Mobile 版本；
- 可用更新；
- 更新类型（运行时包/原生 APK）；
- 下载/传输/校验/安装状态；
- 是否需要用户确认；
- 最近成功更新时间；
- 回滚状态。

### 6.3 验收

```text
RUNTIME_BUNDLE_SYNC = PASS
RUNTIME_BUNDLE_ATOMIC_ROLLBACK = PASS
NATIVE_APK_USB_UPDATE = PASS_OR_HUMAN_CONFIRMATION_GAP
NATIVE_APK_WIFI_UPDATE = PASS_OR_HUMAN_CONFIRMATION_GAP
APP_DATA_PRESERVED = YES
PAIRING_IDENTITY_PRESERVED = YES
SILENT_INSTALL_BYPASS_ATTEMPT = 0
```

---

## 7. Phase 2：手机日历、账单与电脑 AI 命令入口

### 7.1 手机端初版信息架构

在 NEXA Mobile 中增加：

- 首页；
- 日历；
- 账单；
- 命令；
- 连接与同步状态。

保持移动端布局，不照搬 Desktop 页面。

### 7.2 日历

手机端至少支持：

- 月视图；
- 今日高亮；
- 返回今日；
- 日期事项；
- 新增、编辑、删除/归档遵循现有合同；
- 任意日期新增；
- 同步状态；
- 离线变更队列；
- 冲突提示。

### 7.3 账单

手机端至少支持：

- 本月总额；
- 今日/本周/本月/本年/自定义；
- 最近明细；
- 分类占比；
- 待确认手机草稿；
- 草稿确认、编辑、忽略；
- 收入/支出/退款/转账状态；
- 原始证据引用；
- 与 Desktop 实时刷新。

### 7.4 命令入口

正确链路：

```text
手机输入自然语言
→ 现有加密设备通道
→ 电脑 NEXA Command Gateway
→ 电脑本地 AI
→ Structured Proposal
→ 手机显示修改前后差异
→ 用户确认
→ 电脑确定性业务逻辑执行
→ Result/Evidence
→ 手机和电脑同步更新
```

手机不得直接访问 LM Studio 的局域网 API。
LM Studio 必须保持 localhost-only，由电脑 NEXA 代为调用。

所有日历写入、消费永久分类覆盖、批量修改都必须用户确认。

### 7.5 实时同步

必须建立或复用：

- version/revision；
- idempotency key；
- client request id；
- server event id；
- ACK；
- 断线重放；
- 冲突检测；
- PC 作为权威数据源；
- 用户人工修改优先。

不得创建第二套设备身份、第二套 TLS 或第二套消息队列。

---

## 8. Phase 3：NEXA Shared Local AI Provider（LM Studio 4B）

附件是实施约束，不是已经验证的 Runtime 配置。

### 8.1 真实确认

必须只读确认：

- LM Studio 是否安装；
- 当前版本；
- `lms` CLI 是否可用；
- 已下载模型列表；
- 已加载模型；
- Local Server 状态；
- 实际 bind address；
- 实际 port；
- `/v1/models`；
- `/v1/chat/completions`；
- auth mode；
- Exact Model ID；
- streaming；
- JSON Object；
- JSON Schema/grammar constrained output。

允许：

- 启动已经安装的 LM Studio Server；
- 加载已经下载的 4B 模型。

禁止：

- 下载新模型；
- 更新 LM Studio；
- 安装新 Runtime；
- 删除模型；
- 修改 AirLLM 30B；
- 进入 `E:\AI\本地AI` 施工；
- 绑定 `0.0.0.0`。

若标准 `Qwen3-4B-Instruct-2507` 与 abliterated 版本同时存在，优先实测标准 Instruct；不得删除任何一个。

### 8.2 共享 Provider

优先形成一个共享配置：

```text
NEXA Shared Local AI Provider
├─ Calendar
├─ Expense
└─ Notification/Day Summary（仅后续受控使用）
```

设置一次：

- provider；
- protocol；
- base_url；
- model_id；
- auth mode；
- credential reference；
- structured output；
- timeout；
- concurrency。

不得复制两套连接配置。

### 8.3 日历边界

模型只负责：

```text
Natural Language → Intent → Structured Proposal
```

程序负责：

- CURRENT_DATE/CURRENT_TIME/TIMEZONE；
- 真实事件查询；
- event_id；
- 日期校验；
- 冲突检测；
- diff；
- 写入；
- undo。

模型不得编造 target_event_id。
含糊输入必须 `clarify`。
create/update/delete 默认 `needs_confirmation=true`。

必须实测 Calendar A-F，并使用真实 JSON Schema 能力；不得仅凭 Prompt 声称支持 Schema。

### 8.4 消费边界

确定性字段永远以真实数据为准：

- amount；
- currency；
- timestamp；
- platform；
- raw notification/record；
- card tail/order id（若真实存在）。

AI 仅允许：

- 模糊分类；
- 商户 display name 建议；
- 标签建议；
- 低置信度 fallback；
- 自然语言查询转 filter；
- 对本地聚合结果作解释。

AI 不得修改金额、时间、平台、订单号或原始证据。
用户手工分类永久优先。

### 8.5 失败绕过

若不存在可调用的 4B Runtime：

```text
LOCAL_4B_AI_RUNTIME = HUMAN_OR_RUNTIME_GAP
```

保留 Adapter、队列、设置状态和测试，不阻塞后续数据中枢、Mobile UI、Token 和通知工作。

---

## 9. Phase 4：本地数据盘点与 NEXA Temporal Index V0.1

### 9.1 必须盘点的数据种类

- Token 调用与成本；
- 消费正式记录；
- 手机消费草稿；
- Android 原始通知；
- 日历事项；
- 设备性能样本；
- 网络状态；
- 自动化 Run/Result/Evidence；
- 手机/电脑连接事件。

### 9.2 每个数据源必须报告

- 权威 store/path；
- schema/version；
- 数据格式；
- 记录数量；
- 最早时间；
- 最晚时间；
- 当前 retention；
- 是否存在重复 store；
- 是否存在旧版 store；
- 是否能迁移；
- 缺口和不可恢复区间。

不得为了盘点打印真实敏感通知正文或 Secret。

### 9.3 整理原则

优先：

```text
保留现有 source-of-truth
→ 新增稳定 Adapter
→ 建立统一时间索引/查询目录
→ 双读验证
→ 再决定是否迁移
```

禁止直接把所有源数据强行搬进一个新库。
禁止删除旧库。
禁止覆盖原始证据。

如现有技术栈没有合适查询索引，允许建立一个本地、版本化、可重建的 SQLite Temporal Index，但它是查询索引，不是第二套业务权威库。

### 9.4 统一事件索引至少包含

```text
event_id
occurred_at
recorded_at
source_module
event_type
category
subject_id
title
summary
source_record_ref
provenance
sensitivity
confidence
dedup_group_id
schema_version
```

### 9.5 双向查询

必须支持：

#### 按种类

- Token 时间序列；
- 消费时间序列；
- 设备性能时间序列；
- 通知；
- 日历；
- 自动化历史。

#### 按时间

点击任意日期后，能查看该日：

- 日历事项；
- 消费/收入；
- Token 使用与成本；
- 设备关键状态与日汇总；
- 网络事件；
- 通知摘要；
- 自动化执行。

页面命名建议：

```text
NEXA Day Lens / 当日视图
```

不得把所有原始数据直接堆在日历格中。日历格只显示摘要，点击后进入当日视图。

### 9.6 高频数据存储

必须审计存储能力并避免无限膨胀。

推荐但不得盲目硬编码：

- 设备 5 秒级原始样本：短期保留；
- 小时汇总：中期；
- 日汇总：长期；
- Token、消费、日历：保留可用历史；
- 通知文本：完整本地归档，但不保存通知图片/附件，除非已有明确合同。

最终保留策略必须可配置并报告预计增长量。

---

## 10. Phase 5：Token 历史范围与数据位置

必须查清现有 Token 数据实际存在哪里。

最终产品范围：

- 今日；
- 最近 24 小时；
- 最近 7 天；
- 最近 30 天；
- 最近 1 年；
- 全部；
- 自定义起止时间。

“今日”与“最近 24 小时”不得混为一谈。

必须输出：

- Token 权威 store/path；
- 现有最早记录；
- 可用历史范围；
- 是否存在旧版历史；
- 是否有数据缺口；
- 1 年/全部是否来自真实留存数据。

历史未保存时不得重建或猜测。
页面必须显示：

```text
数据从 YYYY-MM-DD 开始可用
```

Token 计数、成本和日期聚合必须由确定性代码完成，本地 AI 不参与计数。

---

## 11. Phase 6：完整通知归档与消费交易归并

### 11.1 原始通知归档

在用户已授权的 Notification Listener 范围内，保留可追溯的原始通知 envelope。

至少包括真实可获得字段：

- package/app；
- notification key/id；
- post time；
- title；
- text；
- big text；
- sub text；
- channel/category；
- group；
- ingestion time；
- content hash；
- source device；
- parser/version；
- sensitivity flag。

不得保存通知图片、附件或与产品无关的大二进制资源，除非已有明确合同。

不得把 Secret、验证码、一次性口令、密码重置码进入普通搜索索引或本地 AI 输入。若原始 envelope 已留存，必须进入受限敏感层，默认 UI 和 AI 均不可见。

所有数据保持本地，不发送云端。

### 11.2 交易识别与跨应用去重

优先顺序：

```text
确定性 parser
→ 订单号/卡尾号/金额/币种/商户/时间窗口匹配
→ 已有映射
→ 本地 4B AI 仅作语义辅助
→ 低置信度待确认
```

必须支持把同一笔交易的多条通知归入一个 canonical transaction，例如：

- 支付宝/微信支付通知；
- 银行扣款通知；
- 商户订单通知。

不能简单删除重复通知。

正确结构：

```text
Canonical Transaction
├─ Primary normalized record
└─ Evidence refs[]（保留所有来源通知）
```

必须处理：

- 支出；
- 收入；
- 退款；
- 转账；
- 信用卡还款；
- 非交易通知；
- 模糊候选。

### 11.3 AI 输出

AI 输出至少保存：

- suggested_category；
- suggested_display_name；
- tags；
- confidence；
- reason/source；
- model_id；
- model/runtime version；
- reviewed/confirmed state。

不得覆盖 raw fields。

### 11.4 历史批处理

若已有大量历史通知：

- 使用 checkpoint；
- 可暂停、恢复；
- newest/high-value payment candidates 优先；
- 不一次把全部正文塞进模型上下文；
- 记录 processed/pending/failed；
- 模型不可用时保留 deterministic 处理结果和 AI pending queue。

不得承诺在没有实测吞吐前一夜完成全部历史 AI 分类。

---

## 12. Phase 7：产品 UI 接入

### 12.1 Desktop

至少增加或完善：

- 数据存储与来源总览；
- Token 范围选择和自定义区间；
- Day Lens；
- 通知归档状态；
- 交易证据与去重组；
- 本地 AI 状态；
- Mobile Update 状态；
- 同步状态与冲突；
- 数据更新时间与缺口说明。

### 12.2 Mobile

至少完成：

- 日历月视图和日详情；
- 账单月视图和草稿确认；
- 命令输入与 Proposal 确认；
- PC/AI/同步状态；
- 实时更新；
- 断线/离线状态。

不得把手机变成 Desktop 的缩小复制品。

---

## 13. Phase 8：真实设备、构建与安装验收

用户今晚会通过 USB 连接手机。

允许：

- ADB 只读设备检查；
- 使用现有项目构建；
- `adb install -r` 覆盖安装；
- 使用现有 Wi-Fi ADB；
- ADB 截图、日志和测试；
- 启动 NEXA Mobile；
- 验证配对/同步/版本。

禁止：

- 卸载应用；
- 清除应用数据；
- 更换签名；
- 绕过系统安装确认；
- 自动点击系统界面；
- 修改手机安全设置；
- Root；
- Device Owner/MDM 配置；
- 使用 Computer Use。

真实验收至少覆盖：

1. USB 覆盖安装保留数据；
2. Wi-Fi 连接和版本检测；
3. 运行时数据/主题包同步无需 APK；
4. 手机日历读取；
5. 手机新增一个测试日历 Proposal，确认后同步到 PC；
6. 手机账单读取；
7. 消费草稿状态同步；
8. 手机命令到电脑本地 AI（若 Runtime ready）；
9. AI 不可用时产品状态正确；
10. 断线重连后增量同步；
11. 无重复事件；
12. app restart 后配对与数据保留。

不得用 mock UI 冒充真实设备链路。

---

## 14. 人工阻断处理

遇到以下情况：

- Android 安装确认；
- USB 调试授权；
- LM Studio GUI 必须手动启动；
- 模型必须手动加载；
- 本地 AI Runtime 不可用；
- 手机系统权限；
- 真实支付通知；
- 登录/验证码；
- Credential；
- 不可逆操作。

必须：

1. 记录最小人工步骤；
2. 不使用 Computer Use；
3. 不反复等待用户；
4. 保存到：

```text
<PROJECT_ROOT>\01_source\token-monitor\docs\reports\NEXA-WAVE-008-MORNING-ACTIONS.md
```

5. 跳过该验收点；
6. 继续所有独立施工。

---

## 15. 测试要求

### Mobile

- Update manifest/signature/hash；
- atomic apply/rollback；
- trusted pairing persistence；
- reconnect/replay/idempotency；
- calendar sync；
- bill sync；
- command/proposal confirmation；
- offline queue；
- APK update preserves app data。

### Local AI

- LM Studio health/models/chat；
- Exact Model ID；
- localhost-only；
- Calendar A-F；
- strict JSON Schema；
- Expense fixtures；
- deterministic fields preserved；
- manual override preserved；
- no real record mutation。

### Data Fabric

- source inventory；
- rebuildable index；
- category query；
- date query；
- Day Lens；
- timezone；
- duplicate event prevention；
- migration backup/rollback；
- missing history truthful projection。

### Token

- today；
- rolling 24h；
- 7d；
- 30d；
- 1y；
- all；
- custom range；
- earliest data boundary。

### Notifications/Consumption

- raw envelope retention；
- sensitive-field exclusion from AI/index；
- deterministic parsing；
- cross-app duplicate grouping；
- income/refund/transfer；
- low confidence review；
- human override priority；
- checkpoint resume。

每个修改项目必须运行 focused tests 和受影响回归。最终运行 Core/Mobile/Calendar/Consumption 的权威测试与构建，时间不足时优先 P0 聚焦回归和可运行产物。

---

## 16. 构建与回退

必须保留当前稳定 Desktop 和 Mobile 构建。

新构建使用独立目录：

```text
Desktop:
dist-mobile-data-wave008

Mobile:
app/build/outputs/apk/...（按现有构建规范）
```

记录：

- package/versionCode/versionName；
- signing identity（不输出私钥）；
- APK SHA-256；
- Desktop EXE SHA-256；
- 安装结果；
- 回滚路径。

---

## 17. 安全与禁止事项

禁止：

1. OpenCode；
2. DeepSeek；
3. Computer Use；
4. 外部真实 AI；
5. 日历或消费数据发送云端；
6. 读取或输出 Secret；
7. 修改 Windows Credential Manager；
8. 下载或删除模型；
9. 修改 AirLLM 30B；
10. 绑定本地模型 API 到 `0.0.0.0`；
11. 卸载/清除 Mobile App；
12. 绕过 Android 安装确认；
13. Root/Device Owner/MDM；
14. 修改防火墙、VPN、DNS、代理、路由；
15. 删除原始通知或消费记录；
16. 破坏已有数据 store；
17. 无备份迁移；
18. 伪造历史 Token、消费、通知、设备或 AI 结果；
19. 扫描整个磁盘或项目父目录；
20. 同一项目并发写入。

---

## 18. 验收标准

全部 P0 通过，人工缺口被准确隔离，才允许：

```text
NEXA_MOBILE_DATA_FABRIC_WAVE008_READY = true
```

必须至少满足：

```text
MOBILE_RUNTIME_SYNC = PASS
MOBILE_RUNTIME_ROLLBACK = PASS
MOBILE_NATIVE_UPDATE_CHANNEL = PASS_OR_OEM_HUMAN_GAP
APP_DATA_PRESERVED = YES
PAIRING_PRESERVED = YES

MOBILE_CALENDAR = PASS
MOBILE_BILLS = PASS
MOBILE_COMMAND_RELAY = PASS_OR_LOCAL_AI_RUNTIME_GAP
REALTIME_SYNC = PASS
OFFLINE_REPLAY = PASS

LOCAL_4B_RUNTIME = PASS_OR_DOCUMENTED_RUNTIME_GAP
EXACT_MODEL_ID = CONFIRMED_OR_NOT_AVAILABLE
LOCALHOST_ONLY = PASS_OR_NOT_STARTED
CALENDAR_AI_NO_DIRECT_WRITE = PASS
EXPENSE_DETERMINISTIC_FIELDS_PRESERVED = PASS

DATA_STORE_INVENTORY = PASS
TEMPORAL_INDEX = PASS
TYPE_FIRST_QUERY = PASS
DATE_FIRST_QUERY = PASS
DAY_LENS = PASS
NO_DESTRUCTIVE_MIGRATION = YES

TOKEN_TODAY = PASS
TOKEN_24H = PASS
TOKEN_7D = PASS
TOKEN_30D = PASS
TOKEN_1Y = PASS_OR_TRUE_HISTORY_GAP
TOKEN_ALL = PASS_OR_TRUE_HISTORY_GAP
TOKEN_CUSTOM_RANGE = PASS

RAW_NOTIFICATION_ARCHIVE = PASS
SENSITIVE_NOTIFICATION_AI_EXCLUSION = PASS
CROSS_APP_TRANSACTION_RECONCILIATION = PASS
MANUAL_OVERRIDE_PRIORITY = PASS
RAW_EVIDENCE_PRESERVED = YES

OPENCODE_CALLS = 0
DEEPSEEK_CALLS = 0
COMPUTER_USE_CALLS = 0
EXTERNAL_AI_CALLS = 0
SECRET_EXPOSURE = 0
UNAUTHORIZED_WRITES = 0
```

---

## 19. 停止条件

停止整个 Wave 仅限：

- Secret 泄露；
- 未授权写入；
- 真实数据损坏风险；
- 签名不一致会导致卸载/清数据；
- 写锁或项目身份不可信；
- 磁盘不足；
- 到达本地硬截止；
- 所有剩余任务均依赖同一人工阻断。

单个 LM Studio、手机系统确认或真机权限阻断不得停止其余独立任务。

---

## 20. 最终报告

最终必须先用普通中文说明：

- 手机以后哪些更新不需要 APK；
- 哪些原生更新仍可能需要系统确认；
- 日历和账单在手机上能做什么；
- 手机命令如何经电脑本地 AI 执行；
- 本地 4B 模型是否真实接通；
- Token 历史实际保存到哪里、最早从何时开始；
- 消费、通知、设备、日历、自动化数据分别存在哪里；
- 是否进行了迁移、备份与回滚；
- 按种类和按日期如何查看；
- 历史通知处理了多少、剩余多少；
- 跨 App 重复交易如何归并；
- 哪些人工动作留到明天；
- 启动哪个 Desktop EXE 和 Mobile 版本；
- 是否发生安全或越权问题。

工程输出：

```text
TASK:
STATUS:

CANONICAL_CORE_PATH:
LEGACY_COPY_STATUS:

MOBILE_UPDATE_COORDINATOR:
RUNTIME_BUNDLE_SYNC:
NATIVE_APK_USB_UPDATE:
NATIVE_APK_WIFI_UPDATE:
OEM_CONFIRMATION_REQUIRED:
APP_DATA_PRESERVED:
PAIRING_PRESERVED:

MOBILE_CALENDAR:
MOBILE_BILLS:
MOBILE_COMMAND_RELAY:
REALTIME_SYNC:
OFFLINE_REPLAY:

LM_STUDIO_VERSION:
LOCAL_4B_SERVER:
EXACT_MODEL_ID:
BASE_URL:
LOCALHOST_ONLY:
STRUCTURED_OUTPUT:
CALENDAR_TESTS:
EXPENSE_AI_TESTS:

TOKEN_STORE_PATH:
TOKEN_EARLIEST_AT:
TOKEN_RANGES:
TOKEN_HISTORY_GAPS:

CONSUMPTION_STORE_PATH:
DRAFT_STORE_PATH:
RAW_NOTIFICATION_STORE_PATH:
DEVICE_DATA_STORE_PATH:
CALENDAR_STORE_PATH:
AUTOMATION_EVIDENCE_STORE_PATH:

DATA_STORE_INVENTORY:
TEMPORAL_INDEX_PATH:
TYPE_FIRST_QUERY:
DATE_FIRST_QUERY:
DAY_LENS:

RAW_NOTIFICATION_COUNT:
PROCESSED_NOTIFICATION_COUNT:
AI_PENDING_NOTIFICATION_COUNT:
CANONICAL_TRANSACTION_COUNT:
DUPLICATE_EVIDENCE_GROUP_COUNT:

CORE_TESTS:
MOBILE_TESTS:
CALENDAR_TESTS:
CONSUMPTION_TESTS:
PRODUCTION_BUILD:
APK_INSTALL_RESULT:

DESKTOP_BUILD_PATH:
MOBILE_APK_PATH:
REPORT_PATH:
MORNING_ACTIONS_PATH:
DATA_STORAGE_MAP_PATH:
MIGRATION_REPORT_PATH:

OPENCODE_CALLS:
DEEPSEEK_CALLS:
COMPUTER_USE_CALLS:
EXTERNAL_AI_CALLS:
REAL_CREDENTIAL_READS:
REAL_CREDENTIAL_WRITES:
SECRET_EXPOSURE:
UNAUTHORIZED_WRITES:

NEXA_MOBILE_DATA_FABRIC_WAVE008_READY:
HUMAN_ACCEPTANCE_GAPS:
KNOWN_LIMITATIONS:
NEXT_USER_ACTION:
```

报告必须包含精确修改文件、测试命令、测试结果和 diff stat。

---

## 21. 当前动作

先将本合同保存到：

```text
<PROJECT_ROOT>\01_source\token-monitor\docs\tasks\NEXA-MOBILE-DATA-FABRIC-LOCAL-AI-NIGHT-WAVE-008.md
```

本条只冻结合同，不开始施工。

完成后仅返回：

```text
TASK_CONTRACT_FROZEN
READY_FOR_NEW_GOAL
```
