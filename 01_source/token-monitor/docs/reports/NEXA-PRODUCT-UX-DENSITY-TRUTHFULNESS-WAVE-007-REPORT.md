# NEXA Product UX Density & Truthfulness — Wave 007 Report

## 结论

- 实现状态：`IMPLEMENTED_AND_PACKAGED`
- 产品验收状态：`READY_WITH_DECLARED_HUMAN_ACCEPTANCE_GAPS`
- `NEXA_PRODUCT_UX_WAVE007_READY = true`
- Creator 旧所有者已由用户通过应用正常退出；未 Kill、未改端口、未越权接管。端口释放后，正式 Desktop 生命周期自然启动唯一 Python Host，所有权握手、`GET /api/v1/host-status`、作品集页面和退出清理均通过。
- 首页与 Creator 页面能区分“服务未启动 / 正在启动 / 可用 / 启动失败”；最终打包验收状态为“可用”。
- 真实手机未用于验收。手机通知权限、Notification Listener 与真实支付通知导入仍是人工验收缺口；界面保持“未知/未配对/不在线”，没有把 `0 条` 冒充为采集正常。

## 九项产品问题处理结果

1. 全局 Shell：移除顶部全局“今日/本月/累计”；时间范围回归各模块。Windows 最小化、最大化/还原、关闭和常驻置顶控制永久可见，业务区保持 no-drag。
2. 首页布局：1600×900 下完整展示主要区域；较小高度使用页面唯一自然滚动。卡片内部不滚动、不裁切、不用缩放作弊。
3. 今日中枢：收起态即显示 6×7 完整月历；今天蓝色高亮；提供上月、下月、回到今天、所选日期新增、事项列表与卡片内展开。展开不改变卡片外部占位。
4. 消费与手机账单：消费页改为紧凑数据工作区，支持今日/本周/本月/本年/自定义、历史月份切换、趋势与分类占比；手机链路逐项展示配对、在线、通知权限、Listener、最近通知、支付候选、待确认数和失败原因。
5. 日历详情：删除巨型 Hero，首屏使用紧凑工具栏、月历、所选日期面板和本地 AI 输入；本地模型配置未提供前仅显示未配置，不调用外部 AI。
6. 自动化中心：首屏直接显示任务、启用数、下一次运行、最近失败、创建、搜索、筛选和运行状态。
7. 学习中心：首页只展示两张丰富词卡；完整页首屏展示当前内容、今日新学、待复习、Collection、美音/英音、音标、多义项、真实例句、词组、词形、同反义词与来源，不伪造缺失字段。
8. 设备与网络：恢复真实 CPU、RAM、GPU、磁盘、温度、上传/下载历史与接口数据。修复中文 `netsh` 默认路由解析；当前主路径为“以太网 2”（物理网卡，metric 0，下一跳脱敏），Radmin VPN 为 `Up + virtual + metric 9256`，不是主路径。
9. Creator 作品集：最终 r2 打包应用内的一级导航、内嵌 Creator 页面、作品集查询和真实空状态均已打开并截图；“作品集”具有蓝色选中态、`aria-pressed=true`，标题为“我的作品集”。生命周期保持 `src/index.mjs → createCreatorOpsUIHost() → python -m creator_ops.ui.host`，owner-crash 自停逻辑与 247 项模块回归通过。

## 关键验收值

- `GLOBAL_PERIOD_FILTER_REMOVED = YES`
- `WINDOW_CONTROLS_VISIBLE = YES`
- `WINDOW_CONTROLS_CLICKABLE = YES`
- `HOME_CONTENT_CLIPPED = 0`
- `HOME_NESTED_SCROLL = 0`
- `HOME_ALL_SECTIONS_REACHABLE = YES`
- `HOME_CALENDAR_FULL_MONTH_COLLAPSED = YES`
- `HOME_CALENDAR_TODAY_AGENDA = PASS`
- `HOME_CALENDAR_ANY_DATE_CREATE = PASS`
- `HOME_CALENDAR_EXPANSION_REFLOW_OUTSIDE_CARD = 0`
- `CONSUMPTION_DEFAULT_MONTH = PASS`
- `CONSUMPTION_CUSTOM_RANGE = PASS`
- `CONSUMPTION_VISUALIZATION = PASS`
- `CONSUMPTION_FONT_UNIFIED = YES`
- `MOBILE_BILL_PIPELINE_STATUS_TRUTHFUL = YES`
- `CALENDAR_DETAIL_DENSITY = PASS`
- `CALENDAR_SELECTED_DATE_PANEL = PASS`
- `CALENDAR_AI_INPUT_COMPACT = YES`
- `AUTOMATION_ABOVE_FOLD_CORE_ACTIONS = PASS`
- `LEARNING_ABOVE_FOLD_CONTENT = PASS`
- `LEARNING_US_UK_VOICE = PASS`
- `LEARNING_RICH_DETAILS = PASS`
- `DEVICE_ACTIVE_PATH_TRUTHFUL = YES`
- `RADMIN_FALSE_PRIMARY_PATH = 0`
- `DEVICE_REFRESH_FRESHNESS = PASS`
- `DEVICE_VISUALIZATION = PASS`
- `CREATOR_COLLECTION_OPEN = PASS_IN_FINAL_PACKAGED_DESKTOP`
- `CREATOR_LIFECYCLE_NATURAL_START = PASS`
- `CREATOR_HOST_OWNERSHIP_HANDSHAKE = PASS`
- `CREATOR_HOST_STATUS_HTTP_200 = PASS`
- `CREATOR_LIFECYCLE_STOP_RELEASE = PASS`
- `CORE_NEW_REGRESSION_FAILURES = 0`
- `MODULE_NEW_REGRESSION_FAILURES = 0`
- `PRODUCTION_BUILD = PASS`

## 真实运行时状态

### 手机链路

- 配对：未配对（当前手机状态合同未提供）
- 在线：不在线
- 通知使用权：未知
- Notification Listener：未知
- 最近通知：时间未知
- 最近支付候选：无候选
- 待确认：`0`，但界面明确说明链路未就绪，不能解释为正常采集结果
- 失败原因：无法确认手机是否配对、在线或允许通知采集

### 设备与网络

- 采集刷新：UI 每 5 秒刷新；硬件 fast lane 5 秒；默认路由 slow lane 在 Desktop 组合中为 10 秒；提供手动刷新和最后更新时间。
- 当前主接口：`以太网 2`
- 主接口分类：`physical`
- 当前状态：`Up`
- 默认路由 metric：`0`
- 下一跳：仅保存和显示脱敏值 `10.17.*.*`
- Radmin VPN：`Up / virtual / metric 9256 / recent upload 0 / recent download 0`，非主路径。
- 未修改 VPN、路由、防火墙、代理或 DNS。

### Creator Ops

- 初始审计更新已采纳：`CREATOR_PORT_CONFLICT = RESOLVED_BY_CURRENT_STATE`，`CREATOR_SERVICE_STATE = NOT_RUNNING`。
- 中途检测到的旧所有者为 `python 21088 → Python Manager 66160 → NEXA Electron 58428`；新候选 PID `57184` 收到 HTTP `403 / FORBIDDEN` 后安全拒绝接管。用户随后从原应用正常退出，旧 PID 与 8765 均自然释放。
- 释放后的正式生命周期 smoke：`lifecycle=READY`、`ready=true`、endpoint `127.0.0.1:8765`、`ownershipHandshakeVerified=true`、监听者为 Python、`GET /api/v1/host-status=200`、Host 状态 `READY`。
- `stopAll()` 完成后 `listenerReleasedAfterStop=true`；最终 r2 桌面验收也通过公开 Creator stop API返回 `STOPPED`，随后浏览器级正常关闭，应用进程为 0、8765 无监听。
- 最终 r2 页面：route `#/creator-ops`、状态“可用”、标题“我的作品集”、作品集按钮 `aria-pressed=true`；生产库当前 0 项，界面如实显示“作品集中尚无作品”。
- 未使用 `taskkill`、`Stop-Process` 或手动 Python 命令。
- 正式生命周期仍是唯一入口；没有第二套 Host。

## 测试

- Core lint：PASS
- Core full test：`2957 tests / 2955 pass / 0 fail / 2 skipped`
- 设备与网络：`927 / 927 pass`
- 设备重点回归（本地化路由、Radmin 分类、产品 DTO）：`164 / 164 pass`
- 学习中心：`267 / 267 pass`
- 学习词库 Python 源工具：`4 / 4 pass`
- Creator Ops：`247 / 247 pass`
- Core `git diff --check`：PASS

## 构建

最终新构建：

- `<PROJECT_ROOT>\01_source\token-monitor\dist-product-ux-wave007-final-r2`
- EXE SHA-256：`7CCFB2C95557332A8486EC4BC217720759C3CA1B7EDEA2950C763F776B99244F`
- app.asar SHA-256：`86982A4FB7E6A6A74BE127B87C75797D2B376E63D193A7B16047A553FD9F10C8`

保留构建（存在且哈希未变）：

- `dist-daily-use-rc-final-001` — EXE `D2A466A05BEA187BBDD77F4FD7E14F8B25E994C3D384BF96994EBA225E2DA543`
- `dist-visual-daily-use-wave004` — EXE `A67340C7E6453884C60667B8BE05DD2EAA0D9F48AD1029F81A4CB2F81F634C02`
- `dist-daily-capability-wave006` — EXE `7DBF28511D804E47FEF9ED2AA7BAB92B28EFF1D01D850A0B18CF38E67785C559`

## 截图证据

目录：`<PROJECT_ROOT>\01_source\token-monitor\docs\acceptance\wave007`

1. `01-windows-titlebar-controls.png`
2. `02-home-complete-state.png`
3. `03-home-natural-scroll-all-sections.png`
4. `04-home-full-month.png`
5. `05-home-calendar-expanded.png`
6. `06-consumption-current-month.png`
7. `07-consumption-custom-range.png`
8. `08-mobile-bill-pipeline-status.png`
9. `09-calendar-month-selected-date.png`
10. `10-automation-first-screen.png`
11. `11-learning-first-screen.png`
12. `12-learning-rich-word-detail.png`
13. `13-device-performance-charts.png`
14. `14-device-radmin-primary-path-truth.png`
15. `15-creator-portfolio.png`
16. `16-creator-portfolio-final.png`
17. `17-creator-portfolio-final-r2.png`（最终权威 Creator 桌面证据）

截图 1–11、13–17 为 1600×900；词汇详情为真实本地学习页 1570×805。第 17 张明确来自 `dist-product-ux-wave007-final-r2`，其余全部来自真实打包应用或正式本地模块 Host，不是 mock。

## 合规

- `OPENCODE_CALLS = 0`
- `DEEPSEEK_CALLS = 0`
- `COMPUTER_USE_CALLS = 0`
- `SECRET_EXPOSURE = 0`
- `UNAUTHORIZED_WRITES = 0`
- 外部 AI 调用：0
- 真实手机操作：0
- 系统网络设置写入：0

## 已声明的人工验收缺口

1. `HUMAN_ACCEPTANCE_GAP_ANDROID_NOTIFICATION = OPEN`：提供真实 Android 手机后，在系统设置中授予通知使用权并启用 NEXA Notification Listener，再发送一条真实支付通知，验证候选进入待确认区；确认前不会计入消费。
2. `HUMAN_ACCEPTANCE_GAP_LOCAL_CALENDAR_MODEL = OPEN`：提供本地日历模型的地址、模型名、协议和授权引用后，再完成模型连通性与真实草稿验收；当前实现保持零外部 AI 调用。

以上两项依赖用户尚未提供的真实设备/模型信息，界面和合同均保持未配置/未知状态，不伪造通过；Wave 007 其余代码、回归、构建、安全与产品验收均已完成。
