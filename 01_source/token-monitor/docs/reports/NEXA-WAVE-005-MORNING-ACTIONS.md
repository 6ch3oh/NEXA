# NEXA Wave005 晨间人工待办

## 当前结论

Phase7 A–E 的产品实现与安全 UI 验证已完成到当前证据范围；本清单只保留需要用户、真实设备、真实内容源或真实外部服务的事项。它们不能被截图、fixture 或单元测试替代。

| 项目 | 当前值 |
|---|---|
| OVERALL_STATUS | PARTIAL_COMPLETE / BLOCKED_BY_HUMAN_E2E_GATES |
| DESIGN_QA | PASS_WITH_KNOWN_LOW_PRIORITY_DENSITY_DEBT_AND_HUMAN_BLOCKERS |
| NEXA_FULL_SURFACE_DAILY_USE_READY | false |
| 冻结合同 | Gate 4 / 5 / 6 / 9 BLOCKED |
| Phase7 首页操作 | 已验证新增/完成事项、知识卡切换、逐卡刷新、状态跳转 |
| Phase7 首页布局 | 固定分区内密度、隐藏/显示、排序、恢复默认已验证 |
| 规则型晨间摘要 | 已实现六源确定性聚合；不调用 AI；消费提醒源未接入时显式降级 |
| 学习完整页 | 本地真实词条页可用；Study → Home 丰富学习卡的最终包 E2E PASS |
| 最终 exact-build 证据 | artifacts/NEXA-WAVE-005-QA/final-exact-build；runtime-evidence.jsonl 共 46 行 |
| 当前最终构建 | <PROJECT_ROOT>\01_source\token-monitor\dist-full-surface-wave005\win-unpacked\Token Monitor.exe |
| EXE | 225,671,680 bytes；SHA256 595C36D64A15E3DD5A89404C779C8A38183E661BD57B6A7A69C52BA787C0DE3E |
| app.asar | 19,212,105 bytes；SHA256 7CC1E2F3CB476D0AC839FB034DC8103CE0CA03643BE22CD5E48A407DB2B955AA |
| Core final verify | 2935 total；2933 passed；0 failed；2 skipped |
| 旧构建保护 | Wave004 与 daily-use RC 哈希最终复核未变化 |

## 1. 日历管家：用户稍后提供本地模型信息

- 状态：`HUMAN_BLOCKED`；不阻断手工日历。
- 已完成：provider-neutral Adapter、未配置态、最小上下文、草稿预览、冲突/差异、确认、取消、撤销、高风险二次确认。
- 当前边界：真实本地模型调用为 0；没有猜测服务地址、协议、模型名或授权。
- 用户动作：双方确认数据边界后，由用户在产品安全设置中提供实际端点、协议、模型名和授权方式。不要把密钥贴到聊天、截图或报告。
- 复验：用无破坏性测试日程生成草稿，分别验证取消、确认、撤销；删除、批量移动或覆盖冲突必须二次确认。

## 2. Android：真机配对、通知权限与受控通知

- 状态：`HUMAN_BLOCKED`；Gate 4 BLOCKED。
- 已完成：Notification Listener、认证传输边界、稳定指纹、Desktop 接收、去重、待确认草稿、编辑、确认、忽略和撤销的代码与隔离测试。
- 安装包：`<PROJECT_ROOT>\03_modules\NEXA-Mobile\app\build\outputs\apk\debug\app-debug.apk`，`com.xingshu.nexa.mobile` / `0.1.0` / versionCode 1，SHA-256 `6F77161735521BC6D519FE7E3209994395A9B1DA0B1B8C5726219E4579FE9BDD`。
- 当前发现：`E:\Android\Sdk\platform-tools\adb.exe` 存在，但 2026-09-03 的 `adb devices -l` 与 `adb mdns services` 均未发现设备；因此没有执行安装、授权或配对。
- 未完成：当前没有真实 Android 配对、Notification Listener 系统授权或一条真实支付通知的端到端证据。
- 用户动作：先通过 USB 调试或 Android“无线调试”让 `adb devices -l` 显示一台状态为 `device` 的手机；由用户本人接受调试指纹、安装 APK、授予通知使用权，再从 Desktop 发起二维码配对并在两端核对六位 SAS。最后只用一条用户认可的低风险、可识别通知复验；本清单不要求发起付款。
- 验收：同一通知只产生一个草稿；草稿未确认前不计入消费；确认、忽略和撤销均可追踪；普通通知不被误判成支付。

消费中心的手机待确认草稿流程可以工作，但晨间摘要目前没有独立结构化消费告警 API。因此 UI 会显示“消费提醒源未接入”，不会从空数据或旧数据捏造提醒。

## 3. 学习中心：真实内容源与物理发音复验

- 状态：`HUMAN_BLOCKED`；Gate 5 BLOCKED。
- 已完成：真实本地词条页、英/美发音入口、音标、释义与丰富字段投影；缺失字段有来源缺席说明；学习页 loading 表面与路由生命周期有回归覆盖。Bridge 对 `APPLICATION_NOT_STARTED`、`CONTROLLER_NOT_RUNNING`、`STALE_GENERATION`、`STOP_INCOMPLETE` 做一次有界重试，Home 只做一次延迟读取重试。覆盖审计确认 5,311 条正式词条中 4,546 个词条含 13,156 条来源词形；CET6 267/267 与 Core Study 20/20 通过；本机 US Zira / UK Hazel SAPI 能生成有效 WAV。
- 最终包证据：`artifacts/NEXA-WAVE-005-QA/packaged-phase7-final-e2e/study-word.png` 与 `home-learning-rich-after-route.png`，证明 Study 真实词条返回 Home 后丰富学习卡仍可读。
- 未完成：现有 ECDICT 源的例句、独立词组、同反义词均为 0（原始 SQLite `detail=0`、`audio=0`），不是当前前端漏传字段；自动 WAV 生成仍不能证明目标电脑实体扬声器的听感。
- 用户动作：提供或批准可追溯、许可明确且包含例句/词组/同反义词的本地内容源，并在目标电脑实际点击一次英音与美音确认听感。
- 验收：同一词条两种口音可区分；例句、短语、变形、同反义词均带来源；没有模型或手写样例冒充词库内容。

## 4. 设备与网络：真机/Wi-Fi 与完整 freshness

- 状态：`HUMAN_BLOCKED`；Gate 6 BLOCKED。
- 已完成：设备页把本机地址采集从公网 provider 解耦；最终 EXE 已读取本机 IPv4/IPv6、2 个活动接口及非空状态/说明；紧凑卡片显示主地址和数量，全部地址按需展开；无手机时明确提示“安装手机端 NEXA → 开启通知使用权 → 扫描二维码并确认六位 SAS”。设备模块 888/888、Core Device 聚焦 106/106 通过。
- 路由实证：只读 APEX 审计为 Core 运行、系统代理关闭、TUN 仅候选、`route_model=UNKNOWN` / `confidence=LOW`；境内 `CONTRACT_READY`、境外 `DEFERRED`、双路径证明 `NOT_READY`，本次网络外连与系统/APEX 修改均为 0。
- 未完成：公网身份来源、可归因的境内/境外延迟、手机在线、手机采集与 freshness 端到端实证。当前不能把普通默认路由访问两个站点的耗时冒充双路径延迟。
- 边界：公网 IP、位置、ISP、ASN、延迟或手机在线未知时保持未知/不可用，不填 0、不宣称正常。
- 用户动作：在实际 Wi-Fi 环境连接手机并复验采集；若涉及 DDNS、路由器或跨网，必须先明确授权。

## 5. 市场、Creator 与 DDNS

| 分支 | 当前状态 | 需要的用户动作 |
|---|---|---|
| 股票市场本地核心操作 | PASS | 封板 EXE 隔离 profile 已完成加入/移出 AAPL 并恢复空态；无须用户动作，真实用户自选未改 |
| 股票市场真实数据 | HUMAN_ACTION_PENDING | 明确数据源、账号和授权；仅做只读连接测试，交易必须另行授权 |
| Creator owner / 端口 | HUMAN_ACTION_PENDING / GATE 9 ONLY REMAINDER | 复核时 `127.0.0.1:8765` 由一个已运行的 Python 进程监听；隔离 Core 生命周期与 Works handoff 2/2 已通过，但封板 EXE 因 owner 不匹配只能诊断。请明确该实例是否应保留，以及合法 owner、目标工作区和端口恢复范围；本轮未停止或接管现有服务，发布 0 |
| DDNS / 跨网 | HUMAN_CONFIRMATION_REQUIRED | 明确域名、记录、DNS 提供商、凭据输入位置和可回退方案后再改动 |

## 6. 执行边界与完成条件

- 不调用未授权外部 AI，不猜测本地模型端点。
- 不读取或展示真实 Credential；秘密只进入产品安全输入。
- 不替用户授予 Android 权限，不远控手机，不发起付款、交易或发布。
- 不修改 Wi-Fi、路由器、DNS 或 DDNS，除非用户明确授权具体目标与回退方式。
- 首页布局只能在固定分区内调整；不允许任意自由排版破坏一页约束。
- 非首页页面可以在工作区内滚动；“固定一页”只约束首页。

Gate 9 已收敛到 Creator 单一阻断；只有 Gate 4、5、6 和 Creator 封板业务操作取得真实运行证据，最终构建/哈希完成复核后，才可重新评估：

> OVERALL_STATUS = PARTIAL_COMPLETE / BLOCKED_BY_HUMAN_E2E_GATES

> NEXA_FULL_SURFACE_DAILY_USE_READY = false
