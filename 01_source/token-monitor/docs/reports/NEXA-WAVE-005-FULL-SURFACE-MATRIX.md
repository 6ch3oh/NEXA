# NEXA Wave005 全表面矩阵

## 证据口径

- 当前 final exact-build 视口与交互 QA：`artifacts/NEXA-WAVE-005-QA/final-exact-build`；机器可读指标为同目录 `runtime-evidence.jsonl`。
- Study → Home 最终包 E2E：`artifacts/NEXA-WAVE-005-QA/packaged-phase7-final-e2e`。
- 首页固定一页在 1600×900、1440×900 与 1024×768 的页面/工作区滚动均为 0。
- 非首页一级页允许在工作区内部滚动；验收重点是可进入、可返回、无白屏、无 raw error 和安全可观察交互。
- 截图与安全 UI 操作不是付款、发布、交易、真机、模型或外部账号 E2E。
- 最终构建：`dist-full-surface-wave005/win-unpacked/Token Monitor.exe`；EXE/app.asar 哈希已收口。
- 总体状态：`PARTIAL_COMPLETE / BLOCKED_BY_HUMAN_E2E_GATES`；Design QA 为 `PASS_WITH_KNOWN_LOW_PRIORITY_DENSITY_DEBT_AND_HUMAN_BLOCKERS`。

## 首页与 10 个非首页一级页

| 一级入口 | 当前能力 | Phase7 证据 | 真实边界 |
|---|---|---|---|
| 首页 | 固定四分区；42 天月历；今天；回到今天；底部设备区；直接操作；布局设置；晨间摘要 | final-exact-build `home-1600x900.png`、`home-1440x900.png`、`home-1024x768.png`、三张 calendar 与三张 interaction 图 | 布局仅支持固定分区内排序；不是任意自由布局 |
| 日历管家 | 月历、日期上下文、手工事项、本地 AI 草稿安全边界 | `l1-calendar-1440x900.png`；隔离事项新增/完成闭环 | `HUMAN_BLOCKED`：用户尚未提供真实模型配置，真实 AI 调用 0 |
| 消费中心 | 消费总览、Android 待确认草稿、确认后入账边界 | `l1-cost-1440x900.png` | `HUMAN_BLOCKED`：无真机 E2E；无结构化消费告警 API；晨间显示源未接入 |
| 自动化中心 | 列表、状态、首次使用/失败原因、刷新；晨间读取最新运行引用 | `l1-automation-center-1440x900.png`；object/string run reference 回归测试 | 不代表真实自动化任务执行成功 |
| 学习中心 | 真实本地词条、英/美入口、学习状态、4,546 个词条 / 13,156 条来源词形 | `l1-study-center-1440x900.png`；CET6 267/267、Core Study 20/20、US/UK SAPI/WAV PASS | `HUMAN_BLOCKED`：当前源不含例句/独立词组/同反义词；目标电脑实体扬声器听感未由用户确认；Gate 5 BLOCKED |
| 设备与网络 | 实际 host 读数、本机 IPv4/IPv6、接口状态/说明、概览/网络、首次使用与 freshness 状态 | `device-network-local-identity-compact-1440x900.png`；APEX route-binding smoke | 本机实况 PASS；APEX 为 `UNKNOWN/LOW`、境内 `CONTRACT_READY`、境外 `DEFERRED`、双路径 `NOT_READY`；公网/ISP/ASN/延迟/手机在线未知时不伪造；Gate 6 仍 BLOCKED |
| 股票市场 | 市场页、自选切换与本地自选增删 | `market-watchlist-packaged-ui-1440x900.png`；封板 EXE 隔离 profile 加入/移出 AAPL 并恢复空态 | 本地核心操作 PASS；真实行情/账号未接入；用户数据未改；交易 0 |
| 自媒体运营 | 诊断/受限状态和明确下一步；隔离 Core 生命周期与 Works handoff | `l1-creator-ops-1440x900.png`；Creator 聚焦 2/2 PASS | 封板 EXE 因固定 8765 owner 不匹配只能诊断；未接管服务；发布 0 |
| Dashi任务板 | 概览/项目切换、连接/陈旧提示 | `l1-dashi-1440x900.png` | 状态查看不等于真实任务写入 |
| 星测 | 公开数据刷新、首次使用与 freshness | `l1-starbench-1440x900.png` | 只证明公开读取/状态交互 |
| 设置 | 设置表面可进入 | `l1-settings-1440x900.png` | 未改写秘密或外部配置 |

## Phase 7 A–E

| 子项 | 当前状态 | 说明 |
|---|---|---|
| A. 首页直接操作 | PASS_WITH_SAFE_SCOPE | 新增/完成事项、知识卡切换、AI/学习/晨间/设备刷新、系统状态跳转已验证 |
| B. 首页可调能力 | PASS_WITH_FIXED_PARTITIONS | 密度、显示/隐藏、分区内排序、恢复默认并持久化；禁止任意自由布局 |
| C. 首次使用 | PASS_FOR_REVIEWED_CORE_SURFACES | 自动化、StarBench、Study、Device UI host 与首页关键状态已补齐；不声称覆盖每个模块的全部细分空态 |
| D. 数据新鲜度 | PASS_FOR_HOME_AND_REVIEWED_SURFACES | 更新时间、未知/陈旧、刷新、失败原因按真实来源显示；未知时间不伪装为更新 |
| E. 规则型晨间摘要 | IMPLEMENTED_WITH_PARTIAL_SOURCE | 六类来源确定性聚合，不调用 AI；消费提醒源缺失时部分成功并显式标注 |

学习页退出后首页摘要的 stop/start 生命周期竞态由 Bridge 一次有界重试处理，错误码限定为 `APPLICATION_NOT_STARTED`、`CONTROLLER_NOT_RUNNING`、`STALE_GENERATION`、`STOP_INCOMPLETE`；Home 另做一次延迟读取重试。最终包已完成 Study 真实词条 → Home 丰富学习卡 E2E。

## 页面与响应式矩阵

| 检查 | 结果 |
|---|---|
| Home 1600×900 document overflow | 0；`final-exact-build/home-1600x900.png`；指标见 `runtime-evidence.jsonl` |
| Home 1600×900 workspace overflow | 0；四个固定分区全部在视口内；状态区内部 overflow 亦为 0 |
| Home 1440×900 document overflow | 0；`final-exact-build/home-1440x900.png` |
| Home 1440×900 workspace overflow | 0 |
| Home 1024×768 document overflow | 0；`final-exact-build/home-1024x768.png` |
| Home 1024×768 workspace overflow | 0 |
| Home 四个固定分区 | 三个视口均完整落在视口内 |
| Home 月历 | 42 天；todayCount = 1；回到今天存在 |
| Home 1024 状态区 | 48px 有界内部溢出，不推动页面或工作区滚动 |
| Home 交互审计 | 三个视口均为 114 个可交互元素；undersized = 0；sub-12px = 0；焦点轮廓为 2px 实线蓝色 |
| Calendar / Consumption / Automation / Device / Market / Creator / Dashi / StarBench / Settings | 1440×900 路由 smoke 已保存 |
| Study | loading 与真实 `abandon` 词条页均已保存 |
| 非首页工作区滚动 | ALLOWED；不是首页固定一页验收失败 |

## 构建与验证

| 项目 | 当前结果 |
|---|---|
| Phase7 focused regression | 238/238 PASS |
| Security subset | 67/67 PASS |
| 最新 Home/Morning/responsive focused | 51/51 与 33/33 PASS |
| ESLint / diff-check | PASS |
| Core final `npm run verify` | 2935 total；2933 passed；0 failed；2 skipped |
| Device & Network module verify | 888/888 PASS；Core Device focused 106/106 PASS |
| Final exact-build EXE | `dist-full-surface-wave005/win-unpacked/Token Monitor.exe`；225,671,680 bytes |
| Final exact-build EXE SHA256 | 595C36D64A15E3DD5A89404C779C8A38183E661BD57B6A7A69C52BA787C0DE3E |
| Final exact-build app.asar | 19,212,105 bytes；SHA256 7CC1E2F3CB476D0AC839FB034DC8103CE0CA03643BE22CD5E48A407DB2B955AA |
| Wave004 基线 | A67340C7E6453884C60667B8BE05DD2EAA0D9F48AD1029F81A4CB2F81F634C02 |
| Daily-use RC 基线 | D2A466A05BEA187BBDD77F4FD7E14F8B25E994C3D384BF96994EBA225E2DA543 |

两个旧构建已最终复核，哈希与上述基线完全一致。

## 冻结合同最终判定

| Gate | 状态 |
|---:|---|
| 1–3 | PASS |
| 4 | HUMAN_BLOCKED：无真实 Android → Desktop → 消费链路 |
| 5 | HUMAN_BLOCKED：US/UK SAPI/WAV 与来源词形已实证；当前源的例句/独立词组/同反义词为 0，实体扬声器听感未由用户确认 |
| 6 | BLOCKED：本机 IPv4/IPv6 与 2 个接口的状态/说明已实证；APEX 路由归因为 `UNKNOWN/LOW` 且双路径未证明，公网身份、可归因的境内/境外延迟、手机在线与 freshness 仍未闭环 |
| 7–8 | PASS |
| 9 | HUMAN_BLOCKED（仅 Creator）：其隔离 Core 操作已通过，但封板 EXE 的业务操作仍被固定 8765 owner 不匹配阻断；其余 L1 均已有真实读取或安全本地写操作，Market 已补齐封板 UI 增删闭环 |
| 10–14 | PASS_WITH_DISCLOSED_LIMITS |

本地日历模型配置同样为 `HUMAN_BLOCKED`；在用户提供模型资料并授权真调用前保持未配置安全态。

> OVERALL_STATUS = PARTIAL_COMPLETE / BLOCKED_BY_HUMAN_E2E_GATES

> NEXA_FULL_SURFACE_DAILY_USE_READY = false
