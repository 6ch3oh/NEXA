# NEXA-DAILY-CAPABILITY-UNBLOCK-AND-BUILD-WAVE-006

## 0. 任务身份

TASK:

NEXA-DAILY-CAPABILITY-UNBLOCK-AND-BUILD-WAVE-006

PROJECT_ID:

NEXA-DAILY-CAPABILITY-WAVE-006

MODEL:

GPT-5.6 Sol

REASONING:

HIGH

EXECUTION_MODE:

CODEX_DIRECT_IMPLEMENTATION

MAX_CODEX_MAJOR_CYCLES:

24

OPENCODE_CALLS_MAX:

0

DEEPSEEK_CALLS_MAX:

0

COMPUTER_USE_CALLS_MAX:

0


==================================================
1. 当前最新用户授权
==================================================

本任务直接继承 Wave 005 的源码、报告、截图、测试和构建结果。

Wave 005 被 BLOCKED，不代表全部功能施工停止。

用户现已明确要求继续建设。

以下决定已经冻结：

1. 日历本地 AI：
   - 用户正在向本地 AI 管理 GPT 获取实际模型信息。
   - 在模型信息返回前，先完成 provider-neutral Adapter、UI、预览、确认、撤销和错误状态。
   - 不得猜测模型、端点、协议或凭据。

2. 手机和电脑：
   - 目标是首次人工配对后长期信任。
   - 以后电脑和手机重新启动不应再次扫码配对。
   - 必须实现可信设备身份持久化、自动发现、自动认证和自动重连。
   - 真机权限或手机在线只影响真实验收，不阻塞代码与测试施工。

3. 英语学习数据：
   - 用户同意使用权威、开放授权、可本地保存的数据源补充例句、词组、词形、音标和语义关系。
   - 必须验证许可证、记录来源、控制下载和最终存储体积。
   - 禁止抓取商业词典网页或复制受限制内容。

4. APEX：
   - 保留并优先复用现有测速能力。
   - 允许建设轻量网络探针、线路质量探针和用户主动完整测速三层产品模型。
   - 不得创建第二套网络中心。
   - 不得修改 VPN、代理、DNS、路由、防火墙或校园网设置。

5. Creator 8765：
   - `NEXA-CREATOR-PORT-8765-OWNER-AUDIT-001` 已完成。
   - 当前 `127.0.0.1:8765` 没有 TCP/UDP 活跃监听者。
   - `CREATOR_PORT_CONFLICT = RESOLVED_BY_CURRENT_STATE`
   - `CREATOR_SERVICE_STATE = NOT_RUNNING`
   - 不允许 Kill、Stop、Restart、替换未知进程或修改端口。
   - 不允许人工启动未知 Python 服务，也不得创建第二套 Creator Host。
   - 必须继续复用正式生命周期：`src/index.mjs` → `createCreatorOpsUIHost()` → `python -m creator_ops.ui.host`。
   - 正式预期监听地址为 `127.0.0.1:8765`。

6. 电脑性能数据：
   - 本机可稳定读取的数据必须接通。
   - 硬件或驱动不提供的数据必须显示真实原因。
   - 不得将未知显示为 0。

用户继续明确禁止：

OPENCODE_CALLS = 0
DEEPSEEK_CALLS = 0
COMPUTER_USE_CALLS = 0


==================================================
2. 项目路径
==================================================

主要 Core：

<PROJECT_ROOT>\01_source\token-monitor

设计权威，只读：

<PROJECT_ROOT>\02_product_design

允许按依赖顺序修改：

<PROJECT_ROOT>\03_modules\日历与星枢管家
<PROJECT_ROOT>\03_modules\六级词汇
<PROJECT_ROOT>\03_modules\设备与网络
<PROJECT_ROOT>\03_modules\消费中心
<PROJECT_ROOT>\03_modules\NEXA-Mobile
<PROJECT_ROOT>\03_modules\自媒体运营

ExecutionHub：

<PROJECT_ROOT>\04_automation\ExecutionHub

ExecutionHub 默认只读。

只有现有公开统计、设备连接或自动化投影存在直接阻断时，才允许最小兼容修改。

禁止：

- 枚举 <PROJECT_ROOT> 根目录
- 扫描未列出的项目
- 访问项目上级目录
- 同一项目并发写入


==================================================
3. 已有稳定基线
==================================================

不得重新建设：

- NEXA Desktop Daily-Use RC
- Owner Runtime
- Automation Registry
- Scheduler
- Dispatch
- Result/Evidence
- Hub Secret安全修复
- Wave 004 首页视觉骨架
- 牛郎织女、星桥、浅色东方未来首页方向
- 顶部横向全局导航
- 已有手机配对、TLS、证书 Pin 和 Transport 底座
- 已有六级英音、美音和本地语音缓存

必须保留以下稳定构建：

dist-daily-use-rc-final-001
dist-visual-daily-use-wave004

不得删除、覆盖或移动。

新构建使用：

dist-daily-capability-wave006


==================================================
4. 总目标
==================================================

完成以下日用能力：

A. 日历本地 AI 接口和界面准备完成。

B. 手机和电脑首次配对后能够长期信任、自动发现和自动重连。

C. 为六级词汇补充可靠、可追溯的学习数据，并接入英美发音和丰富详情。

D. 完善 APEX 网络测速产品模型，优先复用现有能力。

E. 验证现有正式生命周期能够自然启动、验证并停止 `127.0.0.1:8765` Creator Ops Python Host。

F. 补齐电脑本地可读取的性能、硬件和网络接口信息。

G. 将上述结果接入当前新视觉首页和对应模块页面。

H. 完成测试、独立生产构建、截图和晨间操作清单。

最终目标：

NEXA_DAILY_CAPABILITY_WAVE006_READY = true


==================================================
5. Phase 0：预检
==================================================

必须首先：

1. 读取 Wave 005 封板报告。
2. 读取 Wave 005 MORNING_ACTIONS。
3. 检查当前 Core 和相关模块是否有活动写入任务。
4. 检查 Writer Lock 和 Workbench Lease。
5. 确认稳定构建仍存在且哈希未变。
6. 冻结新构建目录。
7. 记录每个项目施工前测试基线。

如果同一项目存在活动 Writer：

不得并发施工。

可以先处理其他独立项目。


==================================================
6. Phase 1：日历本地 AI Adapter
==================================================

项目：

<PROJECT_ROOT>\03_modules\日历与星枢管家
<PROJECT_ROOT>\01_source\token-monitor

实现 provider-neutral：

Calendar Local AI Assistant Adapter v0.1

必须提供：

- 模型 Provider 配置合同
- Base URL
- Protocol
- Model ID
- Authorization mode
- Credential reference
- Health check
- Chat/Generate endpoint
- Streaming capability
- Structured JSON capability
- Timeout
- 最大并发数
- 本地模型 readiness

产品界面必须提供：

- 自然语言输入
- “本地日历助手尚未配置”状态
- 配置入口
- 解析中状态
- 结构化日历操作建议
- 新增 / 修改 / 删除 / 查询分类
- 修改前后差异
- 冲突提示
- 用户逐项确认
- 执行后结果
- 撤销入口
- 错误状态

所有日历写入：

必须由用户确认。

不得：

- 默认接入任意模型
- 调用外部 AI
- 将模型建议直接写入日历
- 伪造 AI 返回
- 保存明文密钥
- 创建第二套日历存储

用户的本地模型管理 GPT 返回信息后，应能仅通过配置完成接入，而不重写日历业务层。

输出：

CALENDAR_LOCAL_AI_CONFIGURATION_REQUIREMENTS.md


==================================================
7. Phase 2：可信设备自动连接
==================================================

项目：

<PROJECT_ROOT>\03_modules\NEXA-Mobile
<PROJECT_ROOT>\01_source\token-monitor

目标：

第一次二维码/SAS 配对完成后，双方长期保存可信关系。

后续手机或电脑重新启动时：

- 不重新扫码
- 不重新人工配对
- 读取既有设备身份
- 验证既有证书和 Pin
- 优先尝试最近成功 Endpoint
- 同网段自动发现
- 已知校园网 Endpoint 自动尝试
- 使用既有 Direct / Reverse Transport
- 指数退避重连
- 网络切换后重连
- PC 恢复运行后重连
- Mobile 后台服务恢复后重连
- 证书撤销时停止连接
- 用户主动撤销设备后不得重连

必须区分：

PAIRED
OFFLINE
DISCOVERING
CONNECTING
AUTHENTICATING
CONNECTED
RECONNECTING
REVOKED
BACKGROUND_RESTRICTED

不得要求日常使用依赖：

- USB 调试
- 无线 ADB
- 每次扫码
- 每次输入 SAS

开机启动：

- 在 Desktop 中提供“Windows 登录后启动星枢”设置
- 不得未经用户选择静默启用
- 设置开启后，Desktop/Gateway 启动并自动恢复已信任设备连接

Android 真机不在线时：

- 完成代码、状态机和自动测试
- 记录真机验收步骤
- 不得让整个 Wave BLOCKED


==================================================
8. Phase 3：通知到消费中心
==================================================

复用已有：

- Android NotificationListener
- 手机配对
- TLS/Pin
- Direct/Reverse Transport
- Desktop Intake
- 消费中心存储
- 去重能力

完成：

Android 支付通知
→ 安全传输
→ Desktop 标准化
→ 支付候选识别
→ 去重
→ 消费草稿
→ 用户确认或现有高置信度策略
→ 消费中心

识别字段：

- amount
- currency
- merchant
- timestamp
- payment channel
- source application
- confidence
- raw-notification reference，不含敏感全文
- deduplication identity

安全要求：

- 非支付通知不得进入消费中心
- 模糊记录进入待确认
- 不得使用外部 AI
- 不得保存验证码、聊天正文或其他无关通知内容
- 不得伪造真机通知
- 测试必须使用合成通知 Fixture

真机和通知权限不可用时：

输出真实 HUMAN_ACCEPTANCE_GAP。

继续后续阶段。


==================================================
9. Phase 4：英语学习开放数据
==================================================

项目：

<PROJECT_ROOT>\03_modules\六级词汇

先审计现有本地词库字段。

不得重复下载已有内容。

允许网络访问仅用于：

- 开放英语词汇数据
- 许可证和 Attribution 信息
- 项目依赖的官方发布资源

候选数据源：

- Open English WordNet
- Wiktionary/Kaikki 机器可读数据
- Tatoeba 经过许可的例句
- UniMorph
- CMUdict

Codex 必须先验证：

- 官方来源
- 当前许可证
- 是否允许本地处理和再分发
- Attribution 要求
- 数据大小
- 所需字段

禁止：

- 抓取牛津、剑桥、柯林斯等商业词典页面
- 下载未经确认许可证的数据
- 下载整套语音音频
- 将来源丢失的数据写入生产库
- 用 AI 编造例句或词组

存储要求：

- 以现有约 5,311 个六级词为目标集
- 优先流式筛选
- 原始大文件完成提取后删除
- 最终紧凑数据不超过 300MB
- 临时下载前检查磁盘
- 临时占用默认不得超过 4GB
- 超过限制则停止该数据源，不阻塞其他来源
- 每个字段保存 source 和 license identity
- 输出 LICENSES_AND_ATTRIBUTIONS.md

优先补充：

- US IPA
- UK IPA
- definitions
- senses
- example sentences
- Chinese translation，只有可信来源存在时
- common phrases
- inflections
- derivatives
- synonyms
- antonyms
- usage labels

页面必须接入：

- 美音按钮
- 英音按钮
- 播放状态
- Hover/点击详情
- 音标
- 多义项
- 例句
- 常用词组
- 词形变化
- 同义/反义/易混词
- 来源
- 掌握状态

数据缺失时必须显示：

“该项资料暂缺”

不得伪造。


==================================================
10. Phase 5：APEX 网络测速
==================================================

项目：

<PROJECT_ROOT>\03_modules\设备与网络
<PROJECT_ROOT>\01_source\token-monitor

先只读审计现有 APEX：

- 当前测速入口
- 当前探针
- 当前 Target
- 当前路由判断
- 当前延迟/抖动/失败率实现
- 当前下载/上传能力
- 当前数据合同

必须优先复用。

不得建立第二套测速引擎。

产品分为三档：

A. 轻量健康检查

- DNS
- TCP/TLS connect
- HTTP 小响应
- latency
- timeout/failure
- 极低流量
- 可低频运行

B. 线路质量检查

- 多次 latency
- jitter
- failure rate
- 路由可信度
- 用户手动或低频运行

C. 完整带宽测速

- download
- upload
- latency under load
- 只能用户主动点击
- 不得后台自动跑满带宽

允许研究和复用开源协议或组件。

不得直接替换 APEX。

真实网络请求只允许：

1. 现有 APEX 已批准 Target；
2. 项目内明确配置的白名单；
3. 当前任务明确用于下载开放学习数据的官方域名。

如果 APEX 没有正式国内/国外目标：

- 建立可配置 Target 合同
- 输出推荐候选和隐私说明
- 不自行对未知目标执行探测
- 页面显示“探针待配置”
- 不把它标记为系统异常

不得修改：

- VPN
- DNS
- 路由
- 防火墙
- 代理
- 校园网配置


==================================================
11. Phase 6：电脑本地数据补齐
==================================================

项目：

<PROJECT_ROOT>\03_modules\设备与网络
<PROJECT_ROOT>\01_source\token-monitor

必须在普通用户权限下接通可用数据：

- 电脑名称
- Windows 版本
- Windows build
- CPU 型号
- CPU 使用率
- 逻辑/物理核心
- 总内存
- 已用内存
- 可用内存
- GPU 型号
- GPU 使用率，有可靠来源时
- GPU 温度，有可靠来源时
- 磁盘卷
- 总容量
- 可用容量
- 当前网络接口
- 接口类型
- 本机地址的安全投影
- 当前连接方式
- 网关/DNS存在状态，不输出敏感完整配置
- 已配对手机
- 当前连接状态
- 最后活动时间

禁止为获取数据：

- 安装内核驱动
- 使用管理员权限
- 修改系统
- 安装未经审计的硬件监控服务

CPU 温度等标准接口不可用时：

必须明确显示：

“当前硬件或驱动未提供该数据”

不得显示：

0°C
异常
采集失败

除非它确实是采集错误。

必须区分：

UNSUPPORTED
UNAVAILABLE
NOT_PROBED
NO_DEVICE
COLLECTOR_ERROR
PERMISSION_RESTRICTED


==================================================
12. Phase 7：Creator 8765 正式生命周期验收
==================================================

审计基线：

- `NEXA-CREATOR-PORT-8765-OWNER-AUDIT-001 = COMPLETE`
- `PORT_8765 = NO_ACTIVE_LISTENER`
- `CREATOR_PORT_CONFLICT = RESOLVED_BY_CURRENT_STATE`
- `CREATOR_SERVICE_STATE = NOT_RUNNING`

正式生命周期：

`src/index.mjs`
→ `createCreatorOpsUIHost()`
→ `python -m creator_ops.ui.host`

正式预期端口：

`127.0.0.1:8765`

在 Wave 006 正常产品验收过程中必须验证：

1. NEXA Desktop / Creator Ops 正式生命周期能够自然启动 Creator Host。
2. 启动后 `127.0.0.1:8765` 由正确的 Creator Ops Python Host 监听。
3. `GET /api/v1/host-status` 通过现有安全合同返回正常状态。
4. 页面退出或 lifecycle stop 时按现有合同处理。
5. 用户不需要手动运行 Python。
6. 首页 Creator Ops 摘要必须区分：
   - 服务未启动
   - 正在启动
   - 可用
   - 启动失败
7. 首页不得将以上状态笼统显示为“读取失败”或“异常”。

如果正式 lifecycle 无法启动服务：

只允许修复现有生命周期的明确、小范围缺陷；不得建立第二套 Host。

继续禁止：

- Kill、Stop、Restart 任何未知进程
- 修改 Creator 正式端口
- 人工启动未知 Python 服务
- 创建第二套 Creator Host
- 修改无关配置
- 输出未脱敏完整 CommandLine
- 读取环境变量或 Secret


==================================================
13. Phase 8：产品接入与视觉收尾
==================================================

将本轮成果接入：

- 首页
- 日历管家
- 学习中心
- 设备与网络
- 消费中心
- 自媒体运营
- 设置

必须保持：

- 牛郎织女、星桥、浅色东方未来方向
- 顶部横向导航
- 统一 Semantic Tokens
- 中文产品状态
- 页面内不出现 raw exception
- 无 Secret
- 无假数据

产品状态不得简单写“异常”。

应区分：

- 待配置
- 尚未探测
- 尚未连接
- 已配对但离线
- 数据暂缺
- 当前硬件不支持
- 服务暂不可用
- 需要用户操作
- 真实运行异常


==================================================
14. 人工事项处理
==================================================

涉及以下情况时，不得等待用户，不得整体停止：

- 本地模型信息尚未返回
- 手机不在线
- Android 通知权限
- 真机二维码/SAS 配对
- 开机启动开关需要用户确认
- APEX Target 需要用户选定
- Creator 旧进程需要用户关闭
- 登录
- 验证码
- API Key
- Credential
- 防火墙
- 路由
- DDNS
- 付款
- 发布

必须记录到：

<PROJECT_ROOT>\01_source\token-monitor\
docs\reports\NEXA-WAVE-006-MORNING-ACTIONS.md

记录：

- 问题
- 用户需要做什么
- 不做会影响什么
- 完成后从哪项继续

随后继续其他独立任务。


==================================================
15. 网络权限
==================================================

NETWORK_ACCESS:

LIMITED_ALLOWLISTED

允许：

- 验证开放数据源的官方网站和许可证
- 下载已批准的英语开放数据
- 使用既有 APEX 已批准探针目标进行最低必要测试
- 项目依赖的官方包源，只在现有构建确有需要时

禁止：

- 任意网络浏览
- 商业词典抓取
- 高频网络探测
- 后台带宽测速
- 外部 AI 调用
- 上传项目、设备或用户数据
- 修改系统网络配置

必须记录所有实际访问域名和传输量估算。


==================================================
16. 测试
==================================================

每个修改项目必须：

- 记录施工前 baseline
- focused tests
- 受影响回归
- 权威全量测试，时间允许时

必须增加：

- 日历 AI Adapter 合同测试
- 自动重连状态机测试
- 可信设备重启测试
- 合成通知消费测试
- 通知去重测试
- 非支付通知排除测试
- 英语来源和许可证测试
- 美音/英音调用测试
- 词汇详情字段测试
- APEX Probe 合同测试
- 用户主动测速 Gate 测试
- Windows 本机数据 Collector 测试
- 未知/不支持状态投影测试
- 8765 审计安全测试

真实手机、实体听音和真实模型不可用时：

使用自动化证据证明代码路径，并登记人工验收，不得伪造真机 PASS。


==================================================
17. 构建和截图
==================================================

新构建目录：

<PROJECT_ROOT>\01_source\token-monitor\
dist-daily-capability-wave006

必须保留旧稳定构建。

最终至少生成：

1. 首页
2. 完整月历
3. 日历 AI 待配置状态
4. 日历 AI 建议预览 Fixture
5. 学习知识卡
6. 单词 Hover/点击详情
7. 英美发音按钮
8. 设备本机数据
9. 网络探针状态
10. 已配对/离线/在线设备状态
11. 消费通知草稿
12. Creator 服务状态

禁止 Computer Use。

只能使用项目已有的 Electron 自动化、DOM 和截图管线。


==================================================
18. 时间
==================================================

HARD_DEADLINE:

开始后 8 小时

FEATURE_FREEZE:

开始后 6 小时 15 分

FINAL_CLOSEOUT:

最后 105 分钟

进入 Closeout 后不得增加功能。


==================================================
19. 禁止事项
==================================================

禁止：

1. OpenCode
2. DeepSeek
3. Computer Use
4. 外部真实 AI
5. 读取或输出 Secret
6. 修改 Windows Credential Manager
7. 操作真实手机
8. 代替用户开启 Android 权限
9. 使用管理员权限
10. 修改 VPN、路由、防火墙、DNS或代理
11. 强制结束 8765 服务
12. 抓取商业词典
13. 伪造学习内容
14. 伪造设备或通知数据
15. 创建第二套日历存储
16. 创建第二套设备身份
17. 创建第二套网络测速中心
18. 大规模无边界重构
19. 删除稳定构建
20. 扫描整个 NEXA 根目录


==================================================
20. 验收标准
==================================================

只有以下全部有真实证据时才允许：

NEXA_DAILY_CAPABILITY_WAVE006_READY = true

必须：

CALENDAR_LOCAL_AI_ADAPTER = PASS
CALENDAR_LOCAL_AI_RUNTIME = PENDING_USER_CONFIG_OR_PASS

TRUSTED_DEVICE_PERSISTENCE = PASS
AUTO_DISCOVERY = PASS
AUTO_RECONNECT = PASS
REPAIR_EVERY_BOOT_REQUIRED = NO

NOTIFICATION_EXPENSE_CONTRACT = PASS
NOTIFICATION_DEDUPLICATION = PASS
REAL_ANDROID_ACCEPTANCE = PASS_OR_HUMAN_GAP

LEXICAL_SOURCE_PROVENANCE = PASS
LEXICAL_LICENSE_MANIFEST = PASS
US_PRONUNCIATION = PASS
UK_PRONUNCIATION = PASS
VOCAB_RICH_DETAILS = PASS

APEX_EXISTING_CAPABILITY_REUSED = YES
APEX_LIGHT_PROBE = PASS_OR_TARGET_PENDING
APEX_FULL_SPEEDTEST_USER_GATED = YES

PC_LOCAL_DEVICE_DATA = PASS
PC_OS_CPU_MEMORY_DISK_NETWORK = PASS
UNSUPPORTED_SENSOR_REASON = PASS

PORT_8765_OWNER_AUDIT = PASS
CREATOR_PORT_CONFLICT = RESOLVED_BY_CURRENT_STATE
CREATOR_SERVICE_STATE = NOT_RUNNING
CREATOR_LIFECYCLE_START = PASS
CREATOR_PORT_OWNER_AFTER_START = CORRECT_CREATOR_OPS_PYTHON_HOST
CREATOR_HOST_STATUS_ENDPOINT = PASS
CREATOR_LIFECYCLE_STOP = PASS
CREATOR_MANUAL_PYTHON_REQUIRED = NO
CREATOR_HOME_SUMMARY_STATES = PASS

CORE_NEW_REGRESSION_FAILURES = 0
MODULE_NEW_REGRESSION_FAILURES = 0
PRODUCTION_BUILD = PASS
OLD_STABLE_BUILDS_PRESERVED = YES

OPENCODE_CALLS = 0
DEEPSEEK_CALLS = 0
COMPUTER_USE_CALLS = 0
REAL_EXTERNAL_AI_CALLS = 0
SECRET_EXPOSURE = 0
UNAUTHORIZED_WRITES = 0


==================================================
21. 停止条件
==================================================

只有以下情况停止整个 Wave：

- Secret 泄露
- 未授权写入
- 稳定构建被破坏
- 写锁或项目身份不可信
- 磁盘不足
- 到达硬截止时间
- 所有剩余任务均依赖同一个人工事项
- 全部任务和 Closeout 完成

单个模型、手机、网络目标或 Creator 服务事项需要人工时：

不得停止整个 Wave。


==================================================
22. 输出
==================================================

最终先用普通中文说明：

- 日历 AI 建到了什么程度
- 以后手机和电脑是否需要反复配对
- 手机通知记账建到了什么程度
- 英语学习新增了哪些真实资料
- APEX 测速现在如何工作
- 8765 服务到底是谁
- 电脑哪些数据已经显示
- 哪些事项明早还需要用户做
- 启动哪个新版 EXE
- 是否有任何安全或越权问题

然后输出：

TASK:
STATUS:

CALENDAR_LOCAL_AI_ADAPTER:
CALENDAR_LOCAL_AI_RUNTIME:

TRUSTED_DEVICE_PERSISTENCE:
AUTO_DISCOVERY:
AUTO_RECONNECT:
WINDOWS_AUTO_START_SETTING:
ANDROID_BACKGROUND_STATUS:

NOTIFICATION_TO_CONSUMPTION:
REAL_ANDROID_ACCEPTANCE:

LEXICAL_DATA_SOURCES:
LEXICAL_FINAL_SIZE:
US_VOICE:
UK_VOICE:
VOCAB_RICH_DETAILS:

APEX_REUSE:
LIGHT_NETWORK_PROBE:
FULL_SPEEDTEST:
NETWORK_TARGET_STATUS:

PC_DEVICE_DATA:
PC_NETWORK_INTERFACE_DATA:
UNSUPPORTED_SENSOR_STATUS:

PORT_8765_OWNER:
PORT_8765_RECOMMENDATION:
CREATOR_PORT_CONFLICT:
CREATOR_SERVICE_STATE:
CREATOR_LIFECYCLE_START:
CREATOR_PORT_OWNER_AFTER_START:
CREATOR_HOST_STATUS_ENDPOINT:
CREATOR_LIFECYCLE_STOP:
CREATOR_MANUAL_PYTHON_REQUIRED:
CREATOR_HOME_SUMMARY_STATES:

CORE_TESTS:
MODULE_TESTS:
PRODUCTION_BUILD:

NEW_BUILD_PATH:
PRESERVED_BUILD_PATHS:

SCREENSHOTS:
MORNING_ACTIONS_PATH:
FINAL_REPORT_PATH:

NETWORK_DOMAINS_ACCESSED:
ESTIMATED_DOWNLOAD_SIZE:

OPENCODE_CALLS:
DEEPSEEK_CALLS:
COMPUTER_USE_CALLS:
REAL_EXTERNAL_AI_CALLS:

REAL_CREDENTIAL_READS:
REAL_CREDENTIAL_WRITES:
SECRET_EXPOSURE:
UNAUTHORIZED_WRITES:

NEXA_DAILY_CAPABILITY_WAVE006_READY:
KNOWN_LIMITATIONS:
NEXT_USER_ACTION:


==================================================
23. 当前动作
==================================================

将本任务合同保存为：

<PROJECT_ROOT>\01_source\token-monitor\
docs\tasks\
NEXA-DAILY-CAPABILITY-UNBLOCK-AND-BUILD-WAVE-006.md

本条只冻结任务合同，不开始施工。

完成后只返回：

TASK_CONTRACT_FROZEN
READY_FOR_NEW_GOAL
