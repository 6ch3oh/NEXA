TASK:
NEXA-PRODUCT-UX-DENSITY-TRUTHFULNESS-WAVE-007

PROJECT_ID:
NEXA-PRODUCT-WAVE-007

MODEL:
GPT-5.6 Sol

REASONING:
HIGH

EXECUTION_MODE:
CODEX_DIRECT_IMPLEMENTATION

OPENCODE_CALLS_MAX:
0

DEEPSEEK_CALLS_MAX:
0

COMPUTER_USE_CALLS_MAX:
0

MAX_CODEX_MAJOR_CYCLES:
20


==================================================
1. 最新产品判定
==================================================

Wave 006 的工程能力和自动化测试继续有效。

但用户对真实界面进行验收后，发现九项重要产品问题。

因此：

ENGINEERING_CAPABILITY_READY = true
WAVE006_BASELINE_REUSED = true
USER_PRODUCT_ACCEPTANCE = FAILED
NEXA_FULL_PRODUCT_READY = false

不得用 Wave 006 的自动化 PASS 覆盖用户真实产品验收。


==================================================
2. 项目路径
==================================================

主要 Core：

<PROJECT_ROOT>\01_source\token-monitor

设计权威，只读：

<PROJECT_ROOT>\02_product_design

允许最小修改：

<PROJECT_ROOT>\03_modules\日历与星枢管家
<PROJECT_ROOT>\03_modules\消费中心
<PROJECT_ROOT>\03_modules\六级词汇
<PROJECT_ROOT>\03_modules\设备与网络
<PROJECT_ROOT>\03_modules\自媒体运营
<PROJECT_ROOT>\03_modules\NEXA-Mobile

ExecutionHub：

<PROJECT_ROOT>\04_automation\ExecutionHub

默认只读。

不得枚举整个 <PROJECT_ROOT>。
不得访问未列出的项目。
同一项目同一时间只允许一个写入任务。


==================================================
3. 权威输入
==================================================

必须使用：

1. 本聊天中用户最新的全部真实截图；
2. 用户最新九项逐条反馈；
3. Wave 006 源码、报告、测试和构建；
4. 02_product_design 中已冻结的设计系统；
5. 用户认可的牛郎织女首页视觉方向。

不得重新设计第三套视觉。


==================================================
4. 总目标
==================================================

完成：

A. 修复全局标题栏和时间范围归属。
B. 消除首页内容裁切。
C. 重做首页月历、今日事项和任意日期新增。
D. 重做消费中心的信息架构和可视化。
E. 压缩日历、自动化、学习等详情页顶部。
F. 接入学习中心英美发音和丰富词汇内容。
G. 修复设备中心数据真实性、刷新和可视化。
H. 修复自媒体作品集无法打开。
I. 完成测试、截图和独立生产构建。

最终：

NEXA_PRODUCT_UX_WAVE007_READY = true


==================================================
5. Phase 1：全局 Shell
==================================================

从全局标题栏移除：

今日
本月
累计

这些不是全局范围。

各模块必须使用自己的范围控制。

恢复并验证：

- 最小化
- 最大化/还原
- 关闭
- 标题栏拖动
- 业务按钮 no-drag
- Windows 100% 和 125% 缩放
- 业务控件不得覆盖窗口按钮

左侧完整保留：

星枢 NEXA

不得把模块筛选放入 Windows 控制区。


==================================================
6. Phase 2：首页布局
==================================================

优先在 1600×900 和 1440×900 完整容纳：

第一行：
今日中枢 / AI / 消费

第二行：
自媒体 / 学习 / 系统状态

底部：
设备与网络

如较小尺寸无法完整容纳：

允许整个首页单一自然滚动。

强制：

HOME_CONTENT_CLIPPED = 0
HOME_NESTED_SCROLL = 0
HOME_ALL_SECTIONS_REACHABLE = YES

禁止：

- overflow hidden 裁切
- 卡片内部滚动
- 极小字号
- zoom/scale 作弊

每日学习首页只展示 1～2 个词汇，
并利用剩余区域展示例句、词组、固定搭配和词形。

设备与网络必须完整显示或通过页面自然滚动到达。


==================================================
7. Phase 3：首页今日中枢
==================================================

收起状态也必须显示完整月份。

布局：

左侧：
- 完整 6×7 月历
- 上月/下月
- 回到今天
- 今天蓝色高亮
- 每日待办数量/事件/节日副标签

右侧：
- 今天的事项列表
- 按时间从早到晚
- 无时间待办排在有时间事项之后
- 点击查看
- 点击编辑
- 新增事项

“新增事项”支持任意日期。

底部：
- 紧凑本地 AI 输入
- 解析按钮
- 配置状态
- 不使用巨型 textarea

展开日历：

- 只能在今日中枢卡片内部
- 卡片外部尺寸不变
- 左侧月历
- 右侧所选日期内容
- 不挤压其他首页区域


==================================================
8. Phase 4：消费中心与手机账单状态
==================================================

删除巨型标题和无用介绍。

默认范围：

本月 1 日至今天。

模块内范围：

今日
本周
本月
本年
自定义

自定义支持：

- 开始日期
- 结束日期
- 开始日期默认所选月份 1 日
- 上月/下月快速切换
- 查看任意历史月份

首屏必须优先显示：

- 总支出
- 总收入
- 结余
- 日均支出
- 上一周期对比
- 支出趋势
- 分类占比环
- 待确认手机草稿
- 最近明细

金额和中文使用统一无衬线字体。
使用 tabular numeric alignment。
不得使用巨型衬线数字。

增加手机账单链状态：

- 是否配对
- 是否在线
- 通知使用权
- Notification Listener 状态
- 最近通知时间
- 最近支付候选时间
- 待确认数量
- 最近失败原因

不得将“已配对”冒充“通知入账已工作”。

真实手机不可用时：
登记 HUMAN_ACCEPTANCE_GAP，
但必须完成状态诊断和产品解释。


==================================================
9. Phase 5：日历管家详情页
==================================================

删除或压缩巨型页面标题和说明。

主体使用可用宽度，不保留无意义左右空白。

布局：

顶部紧凑工具栏
左侧完整月历
右侧所选日期小窗
底部紧凑本地 AI 输入栏

点击日期后右侧显示：

- 日期
- 事项
- 时间
- 状态
- 新增
- 编辑
- 删除/归档遵循现有合同

本地 AI：

- 一行或两行输入
- 配置、解析、确认位于输入旁
- 未配置只显示状态标签
- 不重复大段说明

日期操作不得依赖页面向下滚动后才能使用。


==================================================
10. Phase 6：自动化中心
==================================================

删除巨型 Hero 和介绍。

首屏直接显示：

- 自动化任务列表
- 启用数量
- 下一次运行
- 最近失败
- 创建按钮
- 搜索
- 筛选
- 运行状态

首次无数据时才显示简短引导。

核心操作不得位于首屏以下。


==================================================
11. Phase 7：学习中心
==================================================

删除占据上半屏的大 Hero。

首屏优先：

- 当前学习内容
- 今日新学
- 待复习
- 美音
- 英音
- 词汇详情
- Collection 入口

统计压缩为紧凑摘要条。

每个词汇支持：

- US voice
- UK voice
- 音标
- 多义项
- 真实例句
- 常用词组
- 固定搭配
- 词形变化
- 同义词/反义词
- 来源
- 掌握状态

Hover 或点击打开浮层/右侧抽屉。

不得伪造缺失资料。


==================================================
12. Phase 8：设备与网络真实性
==================================================

首先对当前 Radmin VPN 退出后的状态做只读真值对照：

- 网卡列表
- physical / virtual
- operational status
- IP interface
- 默认路由
- next hop
- route metric
- 最近流量
- Collector 当前输出
- UI 当前显示

当前主连接不能仅根据 Ethernet 类型判断。

必须根据真实默认路由和流量判断。

Radmin、Hyper-V、WSL、Loopback：

- 默认不作为主链路
- 可显示为其他适配器
- 只有承担默认路由时才显示为当前路径

修复缓存和刷新：

- CPU/内存/GPU：刷新间隔不超过 5 秒
- 主路由和接口：不超过 10 秒或事件驱动
- 显示最后更新时间
- 提供手动刷新
- 停止刷新时必须说明

页面加入：

- CPU 趋势
- 内存趋势
- GPU 趋势
- 磁盘容量条
- 上传/下载趋势
- 主网络路径
- 物理/虚拟接口分类
- 已连接设备
- 国内/国外探针状态

不得修改系统网络设置。


==================================================
13. Phase 9：自媒体作品
==================================================

将“作品集打不开”作为 P0 Bug。

必须真实复现并修复：

- 作品集入口
- Route
- IPC
- Creator Host
- 数据读取
- 页面挂载
- 返回路径

不得只修改视觉绕过功能 Bug。

页面压缩：

- 标题
- 介绍
- 上下空白
- 卡片高度

首屏优先显示：

- 作品集
- 最近作品
- 账号
- 状态
- 播放/浏览/点赞
- 打开作品操作


==================================================
14. 全局密度规则
==================================================

所有工具型页面：

- 不使用 48px 以上巨型标题占首屏
- 页面标题建议 24–32px
- 模块标题 18–24px
- 正文 14–16px
- 状态文字不少于 12px
- 数据数字使用统一无衬线字体
- 左右边距使用流式布局
- 桌面宽屏边距建议 24–40px
- 不使用营销式 Hero
- 不用大段解释重复模块用途

完整说明只在首次使用或帮助页展示。


==================================================
15. 允许修改范围
==================================================

允许修改：

Core 中的：
- Shell
- titlebar
- renderer
- navigation
- module hosts
- styles
- IPC/preload
- tests

以及上述已授权模块中与本任务直接相关的：
- public summary
- UI host
- renderer
- routing
- collectors
- focused tests

禁止大规模重构业务核心。


==================================================
16. 禁止事项
==================================================

禁止：

1. OpenCode
2. DeepSeek
3. Computer Use
4. 真实外部 AI
5. Secret 读取或输出
6. 修改 Windows Credential Manager
7. 操作真实手机
8. 修改 VPN、路由、防火墙、代理或 DNS
9. 伪造账单、设备和网络数据
10. 抓取商业财务产品资源
11. 删除稳定构建
12. 第二套设计系统
13. 第二套日历/消费/设备存储
14. 扫描整个 NEXA 根目录
15. 同一项目并发写入


==================================================
17. 测试和截图
==================================================

必须运行：

- 每个受影响项目 focused tests
- 受影响回归
- Core lint
- Core full verify
- production pack

截图至少包括：

1. Windows 标题栏及窗口控制
2. 首页完整状态
3. 首页自然滚动或一屏完整状态
4. 首页完整月历
5. 首页日历展开
6. 消费中心本月
7. 消费中心自定义日期
8. 手机账单链状态
9. 日历管家月历和所选日期窗
10. 自动化中心首屏
11. 学习中心首屏
12. 单词丰富详情
13. 设备中心图表
14. Radmin 退出后的真实主链路
15. 自媒体作品集成功打开

禁止 mock 截图。


==================================================
18. 构建
==================================================

保留：

dist-daily-use-rc-final-001
dist-visual-daily-use-wave004
dist-daily-capability-wave006

新构建：

dist-product-ux-wave007

不得覆盖稳定构建。


==================================================
19. 验收标准
==================================================

全部满足才能：

NEXA_PRODUCT_UX_WAVE007_READY = true

GLOBAL_PERIOD_FILTER_REMOVED = YES
WINDOW_CONTROLS_VISIBLE = YES
WINDOW_CONTROLS_CLICKABLE = YES

HOME_CONTENT_CLIPPED = 0
HOME_NESTED_SCROLL = 0
HOME_ALL_SECTIONS_REACHABLE = YES

HOME_CALENDAR_FULL_MONTH_COLLAPSED = YES
HOME_CALENDAR_TODAY_AGENDA = PASS
HOME_CALENDAR_ANY_DATE_CREATE = PASS
HOME_CALENDAR_EXPANSION_REFLOW_OUTSIDE_CARD = 0

CONSUMPTION_DEFAULT_MONTH = PASS
CONSUMPTION_CUSTOM_RANGE = PASS
CONSUMPTION_VISUALIZATION = PASS
CONSUMPTION_FONT_UNIFIED = YES
MOBILE_BILL_PIPELINE_STATUS_TRUTHFUL = YES

CALENDAR_DETAIL_DENSITY = PASS
CALENDAR_SELECTED_DATE_PANEL = PASS
CALENDAR_AI_INPUT_COMPACT = YES

AUTOMATION_ABOVE_FOLD_CORE_ACTIONS = PASS

LEARNING_ABOVE_FOLD_CONTENT = PASS
LEARNING_US_UK_VOICE = PASS
LEARNING_RICH_DETAILS = PASS

DEVICE_ACTIVE_PATH_TRUTHFUL = YES
RADMIN_FALSE_PRIMARY_PATH = 0
DEVICE_REFRESH_FRESHNESS = PASS
DEVICE_VISUALIZATION = PASS

CREATOR_COLLECTION_OPEN = PASS

CORE_NEW_REGRESSION_FAILURES = 0
MODULE_NEW_REGRESSION_FAILURES = 0
PRODUCTION_BUILD = PASS

OPENCODE_CALLS = 0
DEEPSEEK_CALLS = 0
COMPUTER_USE_CALLS = 0
SECRET_EXPOSURE = 0
UNAUTHORIZED_WRITES = 0


==================================================
20. 停止条件
==================================================

停止整个任务仅限：

- Secret 泄露
- 写入范围失控
- 稳定构建被破坏
- 需要管理员权限
- 需要修改系统网络
- 到达已执行的本地 deadline gate
- 所有剩余工作受同一人工阻断

真实手机验收缺失不得阻止其他页面整改。


==================================================
21. 模型调用上限
==================================================

CODEX_MAJOR_CYCLES_MAX = 20
OPENCODE_CALLS_MAX = 0
DEEPSEEK_CALLS_MAX = 0
COMPUTER_USE_CALLS_MAX = 0


==================================================
22. 输出
==================================================

最终先用普通中文逐条回答用户的九个问题解决结果。

然后返回：

TASK:
STATUS:

GLOBAL_SCOPE_FILTER:
WINDOW_CONTROLS:

HOME_LAYOUT:
HOME_SCROLL:
HOME_CALENDAR:
HOME_LEARNING:

MOBILE_CONNECTION_STATE:
NOTIFICATION_PERMISSION_STATE:
NOTIFICATION_LISTENER_STATE:
MOBILE_BILL_IMPORT_STATE:

CONSUMPTION_PAGE:
CONSUMPTION_TIME_RANGES:
CONSUMPTION_CUSTOM_RANGE:
CONSUMPTION_VISUALS:

CALENDAR_PAGE:
AUTOMATION_PAGE:
LEARNING_PAGE:

DEVICE_ACTIVE_INTERFACE:
RADMIN_ADAPTER_STATE:
DEVICE_REFRESH_INTERVAL:
DEVICE_VISUALS:

CREATOR_COLLECTION:

CORE_TESTS:
MODULE_TESTS:
PRODUCTION_BUILD:

NEW_BUILD_PATH:
PRESERVED_BUILD_PATHS:
SCREENSHOTS:
FINAL_REPORT_PATH:

OPENCODE_CALLS:
DEEPSEEK_CALLS:
COMPUTER_USE_CALLS:
SECRET_EXPOSURE:
UNAUTHORIZED_WRITES:

NEXA_PRODUCT_UX_WAVE007_READY:
HUMAN_ACCEPTANCE_GAPS:
NEXT_USER_ACTION:

本条只冻结任务合同，不施工。

保存后只返回：

TASK_CONTRACT_FROZEN
READY_FOR_NEW_GOAL
