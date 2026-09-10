# NEXA-DESKTOP-REAL-CONTENT-AND-MODULE-USABILITY-NIGHT-WAVE-004

## 0. 身份与执行模式

你是本次夜间波次的：

- 项目总调度
- Codex 直接施工者
- 工程验收员
- 产品可用性验收员
- 最终构建与封板负责人

执行方式：

ChatGPT 总控规划
→ Codex GPT-5.6 Sol / High 直接施工与验收

禁止使用：

- OpenCode
- DeepSeek
- Computer Use

强制：

OPENCODE_CALLS = 0
DEEPSEEK_CALLS = 0
COMPUTER_USE_CALLS = 0

不得尝试调用上述工具作为替代施工方式。


==================================================
1. 项目身份
==================================================

TASK:

NEXA-DESKTOP-REAL-CONTENT-AND-MODULE-USABILITY-NIGHT-WAVE-004

CONTROL_PROJECT:

<PROJECT_ROOT>\01_source\token-monitor

允许顺序施工的模块：

<PROJECT_ROOT>\03_modules\日历与星枢管家
<PROJECT_ROOT>\03_modules\消费中心
<PROJECT_ROOT>\03_modules\AI资产中心
<PROJECT_ROOT>\03_modules\六级词汇
<PROJECT_ROOT>\03_modules\设备与网络
<PROJECT_ROOT>\03_modules\股票市场
<PROJECT_ROOT>\03_modules\自媒体运营
<PROJECT_ROOT>\03_modules\Dashi任务板
<PROJECT_ROOT>\03_modules\StarBench

只读依赖：

<PROJECT_ROOT>\02_product_design
<PROJECT_ROOT>\04_automation\ExecutionHub

Workspace 虽然位于：

<PROJECT_ROOT>

但禁止：

- 枚举 NEXA 根目录
- 扫描所有项目
- 访问未列出的目录
- 搜索项目上级目录

同一个项目同一时间只允许一个写入任务。

本轮默认顺序施工，不并发写入。


==================================================
2. 当前权威基线
==================================================

前序任务：

NEXA-CORE-HOME-VISUAL-IMPLEMENTATION-001

状态：

PASS

前序权威报告：

<PROJECT_ROOT>\01_source\token-monitor\docs\tasks\
NEXA-CORE-HOME-VISUAL-IMPLEMENTATION-001-REPORT.md

前序已完成：

- 用户认可的浅色东方未来首页视觉已经落地
- 牛郎织女、星桥和星河母题已落地
- 顶部横向导航已保持
- 今日中枢已成为首页主区域
- 日历展开与日期 handoff 已建立
- 任务与项目进度已移除
- AI 区已聚焦 Token 使用
- 消费区已形成总额、占比环和明细结构
- 自媒体已形成账号级结构
- 每日学习已形成知识卡结构
- 设备与网络已移至底部
- Dashi 不在首页内容区
- 假生产数据为 0
- Core focused tests 47/47 PASS
- Core lint PASS
- 生产构建 PASS
- 未授权写入 0

不得重新设计首页。

不得重新实现上述已 PASS 结构。

只有发现真实回归时，才允许最小修复。


==================================================
3. 当前已知缺口
==================================================

前序报告已经冻结以下真实缺口：

1. 日历缺少：
   - 批量月份日期摘要
   - 节日和待办副标签优先级
   - 完整任意日期查看/编辑合同

2. 学习中心缺少：
   - 正式 Home knowledge-card summary

3. 设备与网络缺少：
   - 统一、中文化、紧凑的首页摘要

4. 消费中心缺少：
   - 完整分类占比分布
   - 稳定的最近明细摘要

5. 自媒体运营缺少：
   - 1h / 5h / 1d / 3d / 1w 时间范围
   - 账号级播放、浏览、点赞和新增指标
   - freshness

6. AI 区域缺少：
   - 按客户端、应用或模型的稳定 Token 趋势摘要

本轮必须真正实现这些公共摘要合同，并交给 Core 消费。

不得只生成提示词后停止。


==================================================
4. 总目标
==================================================

在最多 8 小时的夜间授权窗口中，将当前：

“视觉骨架已经正确，但大量内容仍为空态”

推进为：

“NEXA 新视觉日用候选版本”。

最终必须尽可能达到：

NEXA_VISUAL_DAILY_USE_READY = true

目标不仅是首页看起来更完整。

还必须做到：

- 首页使用真实模块数据或明确产品空态
- 所有一级模块入口可以正常进入
- 至少一个现有核心操作可用
- 错误状态说人话
- 需要人工操作的模块不会阻断整轮施工
- 新视觉版有独立生产构建
- 原有稳定 RC 保留不动
- 明早用户可以直接选择一个可用版本启动


==================================================
5. Phase 0：预检与基线冻结
==================================================

必须首先：

1. 读取前序实施报告。
2. 读取前序截图和 Design QA。
3. 检查当前 Core diff。
4. 检查是否存在活动 Writer Lock。
5. 检查是否存在未完成的 Core 写入进程。
6. 记录各允许模块的当前权威测试命令。
7. 确认旧稳定版本仍存在。

必须保留：

<PROJECT_ROOT>\01_source\token-monitor\
dist-daily-use-rc-final-001\win-unpacked\Token Monitor.exe

不得删除、覆盖或移动。

新版本必须使用独立目录，例如：

dist-visual-daily-use-wave004

如果发现活动 Core Writer：

不得并发写入。

等待其正常结束或准确报告 BLOCKED_BY_ACTIVE_WRITER。


==================================================
6. Phase 1：日历首页合同
==================================================

项目：

<PROJECT_ROOT>\03_modules\日历与星枢管家

建立或兼容扩展：

CalendarHomeSummary v0.2

至少提供：

- ISO 月份范围查询
- 日期数组
- 每日待办数量
- 每日事件数量
- 节日/纪念日简短标签
- 单行副标签
- 副标签优先级
- 下一事件
- 今日摘要
- 日期详情 handoff
- 日期编辑 handoff
- availability
- generated_at / freshness

优先级建议：

重要提醒
→ 固定日程
→ 待办数量
→ 节日
→ 普通事件
→ 暂无安排

要求：

- 只读 Summary 不得修改用户日历
- 日期点击进入既有查看/编辑路径
- 不建立第二套 Calendar Store
- 不建立第二套 Day Editor
- 不伪造节日或待办
- 使用已有日历数据和 Today/Tomorrow 能力

完成后：

- 模块 focused tests PASS
- Core 首页接入
- 日期小摘要真实显示
- 展开月历取代待办区域
- 日期点击和编辑 handoff 可用


==================================================
7. Phase 2：学习知识卡合同
==================================================

项目：

<PROJECT_ROOT>\03_modules\六级词汇

建立：

HomeLearningSummary v0.1

至少提供：

- 最多 4 张知识卡
- card_id
- 类型
- 标题
- 核心内容
- 简短解释
- 可选例句
- source
- availability
- 今日已学
- 待复习
- 总进度
- progress_current
- progress_total
- updated_at
- 学习中心 handoff

知识卡必须来自真实已有学习内容。

禁止：

- 使用 AI 临时生成假知识
- 写死预览稿示例
- 重复输出“等待真实摘要”

没有可用卡片时：

显示明确空态和进入学习中心的入口。


==================================================
8. Phase 3：设备与网络摘要
==================================================

项目：

<PROJECT_ROOT>\03_modules\设备与网络

建立：

HomeDeviceNetworkSummary v0.1

至少提供：

- 国内网络状态
- 国内网络延迟
- 国外网络状态
- 国外网络延迟
- network availability
- 当前已连接设备
- 设备名称
- 设备类型
- 本机/手机/平板/电脑分类
- 连接状态
- 最后活动时间
- 脱敏地址或安全标识
- paired / connected / unknown 区分
- generated_at

要求：

- 紧凑底栏使用
- 全中文产品状态
- 不泄露 IP、证书或敏感设备标识
- 区分“没有设备”和“暂时无法读取”
- 不把未知状态投影成 0
- 不修改手机端
- 不修改网络、路由、VPN 或防火墙


==================================================
9. Phase 4：消费首页摘要
==================================================

项目：

<PROJECT_ROOT>\03_modules\消费中心

扩展现有 Home Summary。

至少提供：

- 本月总额
- 今日总额
- 完整消费分类分布
- category_id
- category_name
- amount
- percentage
- 最近 5–8 条消费明细
- 时间
- 商户/标题
- 分类
- 金额
- 币种
- 由近到远稳定排序
- freshness
- availability

要求：

- 环形图表达真实分类占比
- 不再展示伪造分类
- 最近明细真实排序
- 没有记录时提供产品空态
- 不污染正式消费数据
- 测试使用隔离数据库或 fixture


==================================================
10. Phase 5：自媒体运营摘要
==================================================

项目：

<PROJECT_ROOT>\03_modules\自媒体运营

扩展既有 Home Summary。

支持时间范围：

- 1h
- 5h
- 1d
- 3d
- 1w

每个账号至少提供：

- account_id
- account_name
- platform
- icon / safe visual identity
- likes
- views
- plays
- followers_or_new
- delta
- freshness
- availability
- account handoff

要求：

- 首页显示账号名字
- 不使用一个大而泛的综合统计
- 没有连接账号时显示“尚未连接账号”
- 读取失败时显示产品原因
- 不展示 raw exception
- 不登录平台
- 不调用外部 API
- 不尝试代替用户授权账号
- 需要人工登录时记录 MORNING_ACTION


==================================================
11. Phase 6：AI Token 使用摘要
==================================================

优先顺序：

1. Core 已有 getStats / stats push
2. AI资产中心已有公开摘要
3. ExecutionHub 已有只读统计投影

不得建立第二套 Token 账本。

目标是形成稳定的首页 AI Usage Summary：

- client / app / model identity
- 今日 Token
- 时间窗口
- 当前用量
- 占比
- 简单趋势
- 今日成本数字
- 成本未知时明确 unknown
- freshness
- availability

禁止：

- 为生成摘要调用真实 AI
- 读取 Provider secret
- 修改 Credential
- 伪造成本
- 把未知值显示成 0

如果必须修改 ExecutionHub：

只允许最小、只读、无 Credential 的统计投影。

禁止修改 Owner Runtime、Dispatch、Credential 和模型路由。


==================================================
12. Phase 7：Core 首页最终接入
==================================================

项目：

<PROJECT_ROOT>\01_source\token-monitor

接入前述真实公共摘要。

必须完成：

- 今日中枢真实日期摘要
- 日历展开
- 日期点击
- AI 真实用量或明确状态
- 消费真实分类和最近明细
- 自媒体账号级摘要
- 每日学习真实知识卡
- 系统状态真实原因
- 设备网络底栏真实摘要

首页禁止出现：

- 读取失败
- undefined
- raw error
- stack trace
- 等待真实摘要
- 假数据
- 假成功状态

产品状态统一为：

- 可用
- 暂无数据
- 尚未配置
- 尚未同步
- 需要用户设置
- 服务暂不可用
- 查看原因


==================================================
13. Phase 8：一级模块可用矩阵
==================================================

依次检查：

- 首页
- 消费中心
- 日历管家
- 自动化中心
- 学习中心
- 设备与网络
- 股票市场
- 自媒体运营
- Dashi任务板
- StarBench
- 设置

每个模块最低要求：

1. 页面可以进入。
2. 不白屏。
3. 不出现原始工程错误。
4. 使用真实数据或产品化空态。
5. 至少一个已有核心操作可用。
6. 可以正常返回首页。
7. 不泄露 Secret。
8. 当前不可用时说明原因。

只允许修复：

- 明确的 P0/P1 用户可见 Bug
- 入口断链
- IPC 未注册
- 页面崩溃
- 错误状态误投影
- 无数据时没有入口
- 与新主题严重冲突的局部样式

禁止在本轮全面重做各模块 UI。


==================================================
14. Phase 9：在基础目标之外继续推进
==================================================

只有以下条件全部满足才进入：

- Phase 1–8 已通过或只有人工阻断
- 距最终封板至少还有 2 小时
- Core 和模块无新增回归
- 不影响生产构建

按价值顺序继续：

### P1-A：首页可调能力

复用现有 preferences / drag-sort / layout 资产。

允许提供：

- 显示/隐藏首页区域
- 首页区域顺序
- 紧凑 / 舒适密度
- 恢复默认布局

禁止：

- 创建第二套拖拽系统
- 任意自由布局导致首页失控
- 修改业务数据

### P1-B：晨间摘要

在首页增加一个轻量、非 AI 的“今日状态摘要”。

只聚合：

- 今日事件
- 下一项任务
- 自动化异常
- 消费提醒
- 设备连接
- 模块需要配置状态

不得调用 AI。

### P1-C：统一首次使用状态

为未配置模块提供：

- 这是什么
- 为什么没有数据
- 下一步去哪设置
- 进入模块按钮

### P1-D：全局数据新鲜度

在适当位置展示：

- 最近更新时间
- 是否过期
- 手动刷新
- 刷新失败原因

不得无边界增加功能。


==================================================
15. 人工阻断处理
==================================================

遇到以下情况：

- 登录
- 验证码
- 账号授权
- 手机连接
- API Key
- Credential
- 防火墙
- 校园网
- DDNS
- 付款
- 公开发布
- 不可逆操作

不得尝试执行。

必须：

1. 记录模块。
2. 记录用户需要做什么。
3. 记录不做会影响什么。
4. 保存到：

<PROJECT_ROOT>\01_source\token-monitor\
docs\reports\NEXA-WAVE-004-MORNING-ACTIONS.md

5. 暂停该支线。
6. 继续其他独立任务。

单个人工阻断不能结束整个 Goal。


==================================================
16. 视觉与尺寸验收
==================================================

继续以用户认可图和前序实现为视觉权威。

不得重新设计另一套首页。

必须检查：

- 1600×900
- 1440×900 或接近尺寸
- 默认 Electron 尺寸
- 1024×768
- 小窗口窄版

目标：

- 顶部品牌完整
- 导航可理解
- 核心内容在 1600×900 内完整可用
- 底部设备网络能够看到
- 不出现首页内部嵌套滚动
- 空态不产生巨大空白
- 日期、文字、数字不溢出
- 牛郎织女背景不过度遮挡内容


==================================================
17. 测试与构建
==================================================

每个修改项目都运行：

- focused tests
- 受影响回归
- 该项目权威全量测试（时间允许且存在）

Core 最终必须运行：

- focused tests
- lint
- full verify
- production pack

使用现有 Electron 自动化和截图管线。

禁止 Computer Use。

至少生成：

1. 1600×900 首页
2. 日历展开
3. 有真实知识卡的学习区域
4. 消费明细
5. 自媒体摘要
6. 设备与网络底栏
7. 一个模块详情页
8. 产品空态示例

截图不得包含 Secret。


==================================================
18. 构建与稳定版本
==================================================

必须保留旧稳定构建：

dist-daily-use-rc-final-001

新构建使用独立目录：

dist-visual-daily-use-wave004

不得覆盖旧稳定版本。

如果新构建未通过最终封板：

明早启动说明必须让用户继续使用旧稳定版本。


==================================================
19. 时间
==================================================

HARD_DEADLINE:

Goal 启动后 8 小时

FEATURE_FREEZE:

Goal 启动后 6 小时 30 分

FINAL_CLOSEOUT:

最后 90 分钟

进入 FINAL_CLOSEOUT 后：

不得增加新功能。


==================================================
20. 最大模型调用
==================================================

CODEX_MAJOR_CYCLES_MAX:

20

OPENCODE_CALLS_MAX:

0

DEEPSEEK_CALLS_MAX:

0

COMPUTER_USE_CALLS_MAX:

0

不得通过改变工具名称绕过这些限制。


==================================================
21. 禁止事项
==================================================

禁止：

1. OpenCode
2. DeepSeek
3. Computer Use
4. 真实外部 AI 调用
5. 读取或输出 Secret
6. 修改 Windows Credential Manager
7. 登录、验证码、付款、发布
8. 操作手机
9. 修改防火墙、路由、校园网、DDNS
10. 扫描整个 NEXA 根目录
11. 大规模重构 Core
12. 大规模重构业务模块
13. 第二套首页系统
14. 第二套 Registry
15. 第二套数据存储
16. 伪造生产数据
17. 删除旧稳定构建
18. 同一项目并发写入
19. 为耗满 8 小时制造任务


==================================================
22. 最终验收标准
==================================================

全部满足才能：

NEXA_VISUAL_DAILY_USE_READY = true

必须：

CALENDAR_HOME_SUMMARY = PASS
LEARNING_HOME_SUMMARY = PASS
DEVICE_NETWORK_HOME_SUMMARY = PASS
CONSUMPTION_HOME_SUMMARY = PASS
CREATOR_OPS_HOME_SUMMARY = PASS
AI_USAGE_HOME_SUMMARY = PASS

HOME_REAL_DATA_INTEGRATION = PASS
HOME_RAW_READ_ERROR_COUNT = 0
HOME_FAKE_DATA_COUNT = 0

PRIMARY_MODULE_ENTRY_COVERAGE = 100%
PRIMARY_MODULE_WHITE_SCREEN_COUNT = 0
PRIMARY_MODULE_RAW_ERROR_COUNT = 0

CORE_NEW_REGRESSION_FAILURES = 0
MODULE_NEW_REGRESSION_FAILURES = 0

PRODUCTION_BUILD = PASS
OLD_STABLE_BUILD_PRESERVED = YES

SECRET_EXPOSURE = 0
UNAUTHORIZED_WRITES = 0

OPENCODE_CALLS = 0
DEEPSEEK_CALLS = 0
COMPUTER_USE_CALLS = 0


==================================================
23. 停止条件
==================================================

停止整个波次，仅限：

- Secret 泄露
- 写入范围失控
- 旧稳定构建被破坏
- 磁盘不足
- 所有剩余工作均被同一人工阻断
- 到达 8 小时截止
- 所有任务与 Closeout 已完成

单个模块失败或需要人工：

不得直接停止整个波次。


==================================================
24. 最终输出
==================================================

最终先用普通中文说明：

- 今晚真正完成了什么
- 明早启动哪个 EXE
- 首页现在有哪些真实内容
- 哪些模块已经可以使用
- 哪些模块需要人工配置
- 是否出现安全或越权问题

然后返回：

TASK:
STATUS:

STARTED_AT:
ENDED_AT:
TOTAL_DURATION:

CALENDAR_HOME_SUMMARY:
LEARNING_HOME_SUMMARY:
DEVICE_NETWORK_HOME_SUMMARY:
CONSUMPTION_HOME_SUMMARY:
CREATOR_OPS_HOME_SUMMARY:
AI_USAGE_HOME_SUMMARY:

HOME_REAL_DATA_INTEGRATION:
HOME_VISUAL_FINALIZATION:
HOME_CUSTOMIZATION:

MODULE_USABILITY_MATRIX:
PRIMARY_MODULE_ENTRY_COVERAGE:

COMPLETED_MODULES:
HUMAN_SETUP_REQUIRED_MODULES:
BLOCKED_MODULES:

CORE_TESTS:
MODULE_TESTS:
PRODUCTION_BUILD:

NEW_BUILD_PATH:
OLD_STABLE_BUILD_PATH:
OLD_STABLE_BUILD_PRESERVED:

SCREENSHOT_PATHS:
MORNING_ACTIONS_PATH:
FINAL_REPORT_PATH:

OPENCODE_CALLS:
DEEPSEEK_CALLS:
COMPUTER_USE_CALLS:

PRODUCT_RUNTIME_REAL_AI_CALLS:
REAL_CREDENTIAL_READS:
REAL_CREDENTIAL_WRITES:
SECRET_EXPOSURE:
UNAUTHORIZED_WRITES:

NEXA_VISUAL_DAILY_USE_READY:
KNOWN_LIMITATIONS:
RECOMMENDED_NEXT_WAVE:

只保存任务合同，不开始施工。

保存完成后只返回：

TASK_CONTRACT_FROZEN
READY_FOR_GOAL
