# NEXA-DESKTOP-FULL-SURFACE-AND-DAILY-CAPABILITY-NIGHT-WAVE-005

## 0. 文档状态

```text
CONTRACT_STATUS = FROZEN
CONTRACT_VERSION = 1.0
SOURCE_THREAD = Wave 004 同一 Codex 聊天
EXECUTION_MODE = CODEX_DIRECT_IMPLEMENTATION
MODEL = GPT-5.6 Sol
REASONING = HIGH
THIS_TURN = CONTRACT_FREEZE_ONLY
IMPLEMENTATION_STARTED = false
NEW_GOAL_STARTED = false
```

本合同合并以下权威输入：

- 用户 2026-09-02 的 Wave 005 验收反馈与三张真实应用截图；
- `NEXA-WAVE-005-SAME-THREAD-CONTINUATION-CONTRACT-001`；
- Wave 004 源码、当前 diff、测试、截图、生产构建与最终报告；
- `<PROJECT_ROOT>\02_product_design` 内的只读设计权威。

本轮只冻结合同，不修改产品代码、不启动服务、不运行生产 AI、不创建新构建。后续必须在新的、最长 8 小时 Goal 中执行本合同。

---

## 1. Wave 004 继承基线与用户验收覆盖

### 1.1 必须继承，不得重做

- 继承 Wave 004 当前源码、未提交 diff、测试、截图、报告与独立生产构建。
- 继承用户已接受的首页浅色东方未来方向、牛郎织女星桥母题、顶部横向导航和既有真实 Home Summary 公共边界。
- 不从零重建首页，不另造第二套首页、第二套模块 Host、第二套 Right Drawer 或第二套拖拽系统。
- 保留 Wave 004 的真实数据/产品空态原则；示例数据不得进入生产 UI。

### 1.2 Wave 004 工程结果

```text
ENGINEERING_RC_READY = true
HOME_VISUAL_DIRECTION = ACCEPTED
WAVE004_CORE_FOCUSED = 293/293 PASS
WAVE004_CORE_FULL_VERIFY = 2840 PASS / 0 FAIL / 2 SKIP
WAVE004_EXTERNAL_MODULE_EFFECTIVE_FULL = 1675/1675 PASS
WAVE004_OLD_STABLE_BUILD_PRESERVED = YES
```

### 1.3 用户验收的最高优先级覆盖

Wave 004 的狭义 `NEXA_VISUAL_DAILY_USE_READY=true` 不再代表全产品通过。用户实际验收覆盖为：

```text
FULL_APP_VISUAL_ACCEPTANCE = FAILED
NEXA_FULL_SURFACE_DAILY_USE_READY = false
```

Wave 005 只有在本合同全部硬门槛通过后，才允许重新给出：

```text
FULL_APP_VISUAL_ACCEPTANCE = PASS
NEXA_FULL_SURFACE_DAILY_USE_READY = true
```

---

## 2. 用户验收证据与当前缺口

### 2.1 真实截图证据

- `codex-clipboard-0f761d4b-a19d-44d4-a62e-6758328cd48d.png`：设备与网络一级页仍是旧深灰视觉，品牌不完整，虽有部分 CPU/内存/GPU 数据，但网络、设备与真实状态呈现不完整。
- `codex-clipboard-c3e03c6d-956c-46c8-81be-37ca1ecc37c8.png`：首页仍需纵向滚动，设备底栏不在首屏；日历默认只有一周；学习卡缺少发音与丰富详情；其他模块仍暴露不统一状态。
- `codex-clipboard-3072ddc5-8a31-4335-a60b-97e12d18a4e9.png`：月历展开后增加首页整体高度并挤压下方模块；缺少明确“回到今天”；月历必须被限制在今日中枢卡片内部。

### 2.2 缺口定性

- “页面可进入”不等于“可日用”。
- “旧深灰页换成白底”不等于完成设计迁移。
- Wave 005 必须同时修复真实能力、产品状态、信息架构、视觉统一和多尺寸布局，不能只增加入口或空态。

---

## 3. 设计权威与不可偏离的视觉合同

设计权威目录只读：

`<PROJECT_ROOT>\02_product_design`

至少以以下文件作为实现依据：

- `NEXA_DESIGN_SYSTEM_V0.1.md`
- `NEXA_DESKTOP_V0_1_SHELL_SPEC.md`
- `NEXA-DESIGN-LAYOUT-GRID-CONTRACT.md`
- `NEXA-DESIGN-INTERACTION-CONTRACTS.md`
- `MODULE_STATE_CONTRACT.md`
- `NAVIGATION_SPEC.md`
- `prototype/styles.css`
- `prototype/components.html`

全产品统一要求：

- 浅色 Fresh / Mint Editorial OS 与已接受的东方未来首页方向兼容落地；
- 完整“星枢 NEXA”品牌；
- 顶部横向全局导航为唯一 L1 权威；
- 组件只消费 Semantic Token，不新增散落硬编码颜色；
- 统一 Button、Input、Select、Tabs、Table、List、Status、Empty、Error、Permission、Stale、Toast、Dialog 与唯一 RightDrawer；
- 状态必须按“状态 → 原因 → 影响 → 下一步”表达；颜色不能是唯一信息；
- 正文不小于 14px，辅助文字不小于 12px；不得用 `zoom`、`scale` 或极小字号伪造单屏；
- 列表与表格保持连续表面，不把所有内容变成等权卡片墙；
- 每个模块保留适合自身业务的信息结构，不得仅将旧深灰样式改成白色。

硬指标：

```text
DEFAULT_LEGACY_DARK_L1_SURFACES = 0
FULL_BRAND_VISIBLE = YES
TOP_HORIZONTAL_NAVIGATION = PASS
SEMANTIC_TOKEN_MIGRATION = PASS
UNIFIED_RIGHT_DRAWER = PASS
```

---

## 4. 工作范围与写入边界

主要项目：

`<PROJECT_ROOT>\01_source\token-monitor`

允许按依赖顺序最小修改：

- `<PROJECT_ROOT>\03_modules\日历与星枢管家`
- `<PROJECT_ROOT>\03_modules\六级词汇`
- `<PROJECT_ROOT>\03_modules\设备与网络`
- `<PROJECT_ROOT>\03_modules\消费中心`
- `<PROJECT_ROOT>\03_modules\NEXA-Mobile`
- `<PROJECT_ROOT>\03_modules\股票市场`
- `<PROJECT_ROOT>\03_modules\自媒体运营`
- `<PROJECT_ROOT>\03_modules\Dashi任务板`
- `<PROJECT_ROOT>\03_modules\StarBench`

ExecutionHub 只读；只有现有统计公共投影直接阻断时，才允许最小、无凭据修复。

禁止枚举整个 `<PROJECT_ROOT>`。同一项目同一时间只允许一个写入任务。必须保留所有不属于 Wave 005 的用户改动和历史产物。

---

## 5. Phase 0：预检、冻结与基线复核

1. 读取本合同、Wave 004 最终报告、模块矩阵、Design QA、相关 diff 与截图。
2. 精确确认允许写入的项目和当前 dirty 状态；不得清理、重置或覆盖其他任务改动。
3. 记录旧稳定构建与 Wave 004 构建的大小、修改时间和 SHA256。
4. 用现有 Electron/无障碍自动化逐页复现用户截图问题，建立 Wave 005 before 证据。
5. 输出可测的逐模块迁移清单；实现期间一次只写一个项目。

Phase 0 不得调用真实 AI、读取 Secret、操作手机或修改网络。

---

## 6. Phase 1：首页固定一屏与月历重构

### 6.1 完整月历

- 今日中枢默认显示当前完整月份，不再只显示一周。
- 采用稳定 6 行 × 7 列、42 个日期单元；相邻月日期可见但弱化。
- 今天使用明确蓝色高亮，并同时具有文字/`aria-current="date"` 等非颜色语义。
- 提供“回到今天”按钮；当前已经在今天时仍可见但状态明确。
- 日期下方显示真实待办数量、事件或节日副标签；没有真实数据时显示明确空态，不伪造节日或事项。
- 支持前月/后月、键盘方向/Home/End、点击日期。

### 6.2 卡片内布局约束

- 月历展开只替换今日中枢卡片内部的待办/详情区域。
- 今日中枢卡片外框高度固定；展开前后不得改变首页栅格行高。
- 不得侵入、覆盖或挤压 AI、消费、自媒体、学习、系统状态或设备与网络区域。
- 内容超过卡片能力时使用卡片内分页、分段或进入完整日历页，不增加首页整体高度。
- 点击日期打开统一 RightDrawer 或进入完整日历页，可查看与编辑该日真实内容；保存、取消、dirty confirmation 与焦点恢复必须遵循统一交互合同。

### 6.3 首页无纵向滚动硬验收

```text
HOME_VERTICAL_SCROLL_1600x900 = 0
HOME_VERTICAL_SCROLL_1440x900 = 0
EXPANDED_CALENDAR_PAGE_HEIGHT_DELTA = 0
DEVICE_NETWORK_FOOTER_VISIBLE_IN_FIRST_VIEW = YES
FONT_SIZE_CHEAT = 0
ZOOM_SCALE_CHEAT = 0
```

- 1600×900 与 1440×900 必须在一个固定页面内完成首页核心浏览和直接操作。
- 窄窗口使用折叠、分页或重新排版；不得无限向下延伸。
- 首页固定一屏不等于全部模块详情也禁止滚动；详情页按设计系统正常使用独立内容滚动。

---

## 7. Phase 2：日历本地 AI 助手的可插拔合同

用户将在双方确认交互、数据边界和安全方式后，另行提供本地模型信息。Wave 005 在获得这些信息前只允许完成：

- `CalendarLocalAiAdapter` 或等价稳定公共接口；
- 禁用/未配置状态；
- 配置入口与连接状态 UI，但不写入猜测地址或模型名；
- 自然语言日程草稿、差异预览、冲突说明、确认后写入、取消与撤销流程；
- 结构化输入/输出 schema、超时/取消、错误归一化、审计元数据与日志脱敏；
- AI 只能生成草稿，未经用户确认不得修改日历；
- 删除、批量移动、覆盖冲突等高风险操作必须二次确认并可撤销；
- 所有模型上下文只包含完成当前日历任务所需的最小字段。

在用户尚未提供本地模型地址、模型名、协议与授权方式时：

```text
LOCAL_CALENDAR_AI_ADAPTER = IMPLEMENTABLE
LOCAL_CALENDAR_AI_UI = IMPLEMENTABLE
LOCAL_CALENDAR_AI_RUNTIME_CONNECTION = HUMAN_BLOCKED
DEFAULT_MODEL_GUESSED = NO
REAL_MODEL_CALLS = 0
```

不得自动连接 Ollama、LM Studio、OpenAI-compatible endpoint 或任何默认地址。

---

## 8. Phase 3：Android 通知、Wi-Fi 链路与消费采集

必须对现有实现做端到端只读审计并尽可能打通：

```text
Android Notification Listener
→ existing Wi-Fi / encrypted transport
→ Desktop authenticated receiver
→ payment notification recognizer
→ idempotent deduplication
→ consumption draft or confirmed record
→ Consumption Center
```

验收要求：

- 明确回答当前 Android 与电脑 Wi-Fi 连接、加密传输和通知采集哪些部分已存在、哪些不可用、为什么；
- 手机未在线或权限未授予时，Desktop 显示可理解的 Permission/Offline/No Device 状态，而不是“0 条”或假正常；
- 只识别真实收到的支付通知；保留来源、接收时间、支付平台、金额/币种、商户摘要和稳定去重键；
- 不把通知正文、账号、订单号或其他敏感字段暴露到不必要的日志/Renderer；
- 相同通知重放不得重复记账；不确定解析进入“消费草稿”，不得自动成为已确认支出；
- 草稿必须可查看、编辑、确认、忽略和撤销；确认后才进入消费统计；
- 非支付通知不得进入消费中心；
- 不操作手机、不远程点击权限、不修改防火墙/路由/DDNS/校园网配置。

如果需要用户在手机端授予通知访问、保持应用在线或完成配对，记录到 Wave 005 晨间待办并继续其他阶段。

---

## 9. Phase 4：学习中心发音与丰富词汇详情

必须复用六级词汇已有的英音、美音和本地语音缓存，不得另造重复语音服务。

首页知识卡与完整学习中心均需支持：

- 美音播放按钮；
- 英音播放按钮；
- 加载、播放、暂停/结束和不可用状态；
- Hover 与键盘 focus 可触发摘要详情；点击可固定详情或进入完整学习页；
- 音标、多义项、真实例句、常用词组、词形变化；
- 有真实数据时显示近义词/易混词，没有时明确省略；
- “已掌握/待复习”状态与现有学习进度合同一致；
- “进入完整学习页”动作始终明确。

产品真值要求：

- 不得由 UI 编造例句、词组、变形或同义词；
- 字段缺失必须逐项缺席或标注“暂无数据”，不得把未知展示为空字符串、0 或伪完整；
- Hover 浮层不得遮挡主要操作、不得超出视口，键盘与触控板用户必须有等价入口；
- 音频播放不触发外部网络请求；本地缓存缺失时显示可理解状态。

---

## 10. Phase 5：设备与网络真实观测恢复

必须恢复并产品化以下真实字段：

- 当前电脑名称；
- Windows 版本；
- CPU 型号与使用率；
- 内存容量与使用率；
- GPU 型号、使用率与可支持的温度；
- CPU 温度（仅在真实支持时）；
- 磁盘容量、已用/可用与健康状态；
- 网络接口、连接状态、当前连接方式；
- 国内网络状态、延迟、最后验证时间；
- 国外网络状态、延迟、最后验证时间；
- 已配对手机；
- 当前在线设备；
- 最后活动时间。

必须区分并可测试：

```text
NO_DEVICE
NO_DATA
COLLECTOR_UNAVAILABLE
NETWORK_UNREACHABLE
PERMISSION_UNSUPPORTED
SOURCE_NOT_CONFIGURED
STALE
PARTIAL
READY
```

未知值不得变成 `0`、`正常` 或 `可用`。网络不可达不得被误报为采集器故障；权限不支持不得被误报为无设备。页面必须提供最近更新时间、刷新入口、失败原因和下一步诊断/设置入口。

---

## 11. Phase 6：所有非首页一级页面的视觉与信息架构迁移

必须将以下 10 个页面迁移到同一设计系统：

1. 消费中心
2. 日历管家
3. 自动化中心
4. 学习中心
5. 设备与网络
6. 股票市场
7. 自媒体运营
8. Dashi 任务板
9. StarBench / 星测
10. 设置

每页都必须完成：

- 完整“星枢 NEXA”品牌和顶部 L1 导航；
- 页面 Header：标题、导语、状态/更新时间和最多一个主操作；
- 合理的模块 L2 导航或 context rail；
- 业务适配的信息结构，而不是统一指标卡墙；
- 统一列表、表格、筛选、状态、空态、错误态、权限态、陈旧态和 RightDrawer；
- 1440×900 与 1024×768 布局；
- 键盘焦点、accessible name、最小点击目标与 reduced-motion；
- 不改变真实业务含义、不复制假数据、不深导入模块私有实现。

逐页最低业务目标：

- 消费：总览、真实记录/草稿、分类、来源、详情与导入/确认路径；
- 日历：月/日上下文、事项/事件编辑、AI 草稿状态；
- 自动化：任务、运行状态、最近执行、失败原因与安全重试；
- 学习：集合、今日学习、词汇详情、发音与进度；
- 设备：概览、性能、网络、应用、历史、异常、诊断；
- 市场：数据源/网络配置态、列表或行情证据、错误与设置入口；
- 自媒体：账号、内容/作品、状态、活动与 owner conflict 处理；
- Dashi：任务列表、状态、筛选、详情与返回上下文；
- StarBench：能力、运行/空态、有效性、详情与设置路径；
- 设置：分组、搜索/定位、保存反馈、危险项确认与 Credential 不暴露。

验收不得只看 CSS 背景色；必须逐页做信息层级、交互、状态和响应式检查。

---

## 12. Phase 7：基础问题通过后的预批准改进

按价值顺序继续，且不得危及最终封板：

### A. 首页直接操作

- 新增今日事项；
- 完成待办；
- 修改当天日程；
- 切换知识卡；
- 刷新单个摘要；
- 从系统状态直接进入处理页面。

### B. 首页可调能力

复用现有 preferences / drag-sort：

- 显示/隐藏首页区域；
- 首页区域顺序；
- 紧凑/舒适密度；
- 恢复默认布局。

禁止第二套拖拽系统和任意自由布局。

### C. 统一首次使用体验

所有无数据或未配置模块必须说明：模块用途、当前无内容原因、下一步路径，以及明确的进入/设置按钮。

### D. 数据新鲜度

首页和模块摘要统一展示最近更新时间、是否过期、手动刷新与失败原因。

### E. 规则型晨间摘要

不调用 AI，只聚合今日事项、下一日程、自动化失败、消费提醒、学习内容、设备与模块异常。

---

## 13. 人工阻断与晨间待办

遇到以下情况不得替用户执行：

- 本地模型地址、模型名、协议或授权；
- 手机在线、Android 通知访问、配对或用户点击；
- 登录、验证码、API Key、账号授权；
- 外部数据源配置；
- 防火墙、路由、校园网、DDNS；
- 付款、交易、公开发布或其他不可逆操作。

必须记录：模块、当前已完成部分、用户需要做什么、不做的影响、完成后如何复验，并保存到：

`<PROJECT_ROOT>\01_source\token-monitor\docs\reports\NEXA-WAVE-005-MORNING-ACTIONS.md`

单个人工阻断只暂停该支线，不得结束整个 Wave。

---

## 14. 安全硬边界

```text
OPENCODE_CALLS = 0
DEEPSEEK_CALLS = 0
COMPUTER_USE_CALLS = 0
UNAPPROVED_REAL_AI_CALLS = 0
REAL_CREDENTIAL_READS = 0
REAL_CREDENTIAL_WRITES = 0
SECRET_EXPOSURE = 0
UNAUTHORIZED_WRITES = 0
FAKE_PRODUCTION_DATA = 0
PHONE_REMOTE_ACTIONS = 0
NETWORK_CONFIGURATION_CHANGES = 0
```

- 不得通过其他工具或子进程变相调用被禁工具。
- 不得读取、输出或截图 Secret；测试使用合成值和隔离 profile。
- 不得启动交易、付款、发布、账号授权或手机权限操作。
- 不得杀死未知/既有用户进程；只能精确清理本轮启动并已核对路径的 QA 进程。

---

## 15. 测试、截图与真实应用验收

允许：源码检查、DOM 测试、现有 Electron 自动化、Accessibility-safe 自动化、现有截图管线、focused tests、full regression、production pack。

禁止 Computer Use。

每个修改项目必须运行：

- focused tests；
- 受影响回归；
- 项目权威全量测试（存在且时间允许）；
- lint/type/static check（项目存在时）。

Core 最终必须运行：

- Wave 005 focused tests；
- lint；
- full `npm run verify`；
- production pack。

必须从真实 Wave 005 应用生成，不得使用 mock 截图冒充：

1. 1600×900 首页；
2. 1440×900 首页；
3. 默认完整月历；
4. 月历展开且页面高度不变；
5. 日历管家页与日期编辑；
6. 日历本地 AI 未配置/草稿确认界面；
7. 消费中心页与 Android 通知链路状态；
8. 学习中心与单词详情/英美发音状态；
9. 设备与网络页；
10. 自动化中心页；
11. 股票市场页；
12. 自媒体运营页；
13. Dashi 页；
14. StarBench 页；
15. 设置页；
16. 1024×768 至少覆盖所有迁移页的代表性状态。

视觉验收必须把设计权威、用户截图和真实实现截图放入同一比较输入，检查布局、字体、间距、颜色、品牌、状态、响应式和交互；截图本身不等于 QA。

---

## 16. 构建与回退

必须保留且不得覆盖或删除：

- `dist-daily-use-rc-final-001`
- `dist-visual-daily-use-wave004`

Wave 005 新构建目录：

`dist-full-surface-wave005`

最终必须记录三套构建的路径、大小、修改时间和 SHA256。旧构建哈希变化即为硬失败。

如果 Wave 005 未完成最终封板，晨间说明必须指向最近一个真正稳定的旧版本，不能把未完成构建交给用户日用。

---

## 17. 时间盒与停止条件

新 Goal 最长 8 小时：

- `T+00:00`：开始；
- `T+06:15`：功能冻结；
- 最后 105 分钟：只做测试、构建、截图、报告和封板，不新增功能。

只有以下情况可以停止整个 Goal：

- 到达 8 小时截止时间；
- 全部验收完成；
- 发现 Secret 泄露；
- 写入范围失控；
- 稳定构建被破坏；
- 所有剩余任务均被同一个人工步骤阻断。

单个模块失败、单个人工阻断或单个测试环境限制不得直接结束 Goal。

---

## 18. Wave 005 最终硬门槛

只有以下全部通过，才允许 `NEXA_FULL_SURFACE_DAILY_USE_READY=true`：

1. 首页 1600×900、1440×900 无纵向滚动，设备底栏首屏可见；
2. 完整月历默认可见，今天蓝色高亮，“回到今天”可用，展开不改变首页高度；
3. 日期查看/编辑可用；本地 AI Adapter/UI/确认/撤销已完成，未配置模型时不调用任何模型；
4. Android → Desktop → 消费链路能力与阻断已被真实证明，支付通知去重和草稿确认边界通过；
5. 学习中心英美发音、详情、真实例句/词组/变形与学习状态通过；
6. 设备与网络真实电脑、硬件、磁盘、网络、延迟、设备和 freshness 状态通过；
7. 10 个非首页一级页面完成设计系统迁移，默认旧深灰一级页为 0；
8. 全局品牌、导航、Semantic Token、组件状态和唯一 RightDrawer 通过；
9. 所有一级模块可进入、可返回、无白屏、无 raw error，并至少完成一个真实核心操作；
10. focused、受影响回归、Core lint、Core full verify 和 production pack 无新增失败；
11. 真实截图与 Design QA 通过，无未解决 P0/P1/P2；
12. 新构建独立，两个旧稳定构建哈希保持不变；
13. 禁用工具调用、真实外部 AI、Secret 暴露、假生产数据与未授权写入均为 0；
14. 人工阻断已进入晨间待办，不被隐瞒或误报为完成。

---

## 19. 最终交付

至少生成：

- `docs\reports\NEXA-WAVE-005-MORNING-ACTIONS.md`
- `docs\reports\NEXA-WAVE-005-FULL-SURFACE-MATRIX.md`
- `artifacts\NEXA-WAVE-005-QA\report.md`
- 项目根 `design-qa.md` 的 Wave 005 结果
- `docs\tasks\NEXA-DESKTOP-FULL-SURFACE-AND-DAILY-CAPABILITY-NIGHT-WAVE-005-REPORT.md`
- `dist-full-surface-wave005\win-unpacked\Token Monitor.exe`
- 本合同要求的真实截图集合。

最终报告至少包含：

```text
TASK
STATUS
STARTED_AT
ENDED_AT
TOTAL_DURATION
HOME_FIXED_VIEWPORT
CALENDAR_MONTH_VIEW
CALENDAR_LOCAL_AI_ADAPTER
CALENDAR_LOCAL_AI_RUNTIME
ANDROID_NOTIFICATION_PIPELINE
CONSUMPTION_NOTIFICATION_INGEST
LEARNING_AUDIO_AND_DETAIL
DEVICE_NETWORK_REAL_OBSERVATION
FULL_SURFACE_DESIGN_MIGRATION
LEGACY_DARK_L1_SURFACES
PRIMARY_MODULE_ENTRY_COVERAGE
CORE_TESTS
MODULE_TESTS
DESIGN_QA
PRODUCTION_BUILD
NEW_BUILD_PATH
WAVE004_BUILD_PATH
DAILY_USE_RC_BUILD_PATH
OLD_BUILDS_PRESERVED
SCREENSHOT_PATHS
MORNING_ACTIONS_PATH
FINAL_REPORT_PATH
OPENCODE_CALLS
DEEPSEEK_CALLS
COMPUTER_USE_CALLS
UNAPPROVED_REAL_AI_CALLS
REAL_CREDENTIAL_READS
REAL_CREDENTIAL_WRITES
SECRET_EXPOSURE
UNAUTHORIZED_WRITES
FAKE_PRODUCTION_DATA
NEXA_FULL_SURFACE_DAILY_USE_READY
HUMAN_SETUP_REQUIRED_MODULES
KNOWN_LIMITATIONS
RECOMMENDED_NEXT_WAVE
```

---

## 20. 本合同冻结结果

```text
TASK_CONTRACT_FROZEN = true
READY_FOR_NEW_GOAL = true
IMPLEMENTATION_STARTED = false
```
