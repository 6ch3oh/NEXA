# NEXA Daily Capability Unblock and Build — Wave 006 最终报告

日期：2026-09-03  
状态：`COMPLETE_WITH_DOCUMENTED_HUMAN_ACCEPTANCE_GAPS`

## 产品结论

Wave 006 已把用户指出的日用能力从占位或模糊状态推进到可验证产品路径：

- 日历现在有固定在自身模块内的 6 周/42 天完整月历、蓝色今日、返回今日、自然语言 AI 区域，以及 provider-neutral 的本地模型配置、健康检查、建议预览、增删改查分类、前后差异、冲突、逐项确认、执行结果和撤销。没有猜模型，没有调用外部 AI，真实运行只等用户提供本地模型配置。
- 手机与电脑完成首次 QR/SAS 配对后会持久化可信身份，后续启动读取原身份，自动发现、认证和指数退避重连；撤销后不会重连。日常不依赖 USB、无线 ADB 或反复扫码。真实 Android 后台权限、重启和局域网仍需一次真机验收。
- Android 支付通知可经既有 TLS/Pin Transport 转为标准化消费草稿，包含金额、币种、商户、时间、渠道、来源应用、置信度、安全摘要引用和去重身份；非支付通知被排除，模糊项待确认，合成 Fixture 不进入真实统计。
- 六级学习为 5,311 个目标词加入 14,431,065-byte 开放 sidecar：US IPA 5,279、英文义项 5,288、真实例句 4,300、关联短语 2,567、词形 3,255、派生词 4,590、近义词 4,766、反义词 1,123、用法标签 144。来源为 Open English WordNet 2025、固定提交 UniMorph English 和固定提交 CMUdict；没有商业词典抓取、AI 编造或整套语音下载。
- 英美发音按钮、播放状态和本地 Windows SAPI 调用路径已接通；最终 QA 能识别 US/UK 本地声音身份，但物理“实际听到并区分声音”仍诚实列为人验缺口。
- APEX 没有第二套测速引擎。新编排器复用现有 `DualPathProbeHarness`，提供 light、quality、用户主动 full 三档；Target 必须来自项目 allowlist 且仅 HTTPS。当前正式 Target 为 0，因此显示“探针待配置”、真实请求 0，full 不能后台自动运行。
- 电脑页已经显示普通用户权限下真实可读的 Windows 版本/build、CPU 型号/使用率/逻辑与物理核心、内存、磁盘、GPU 可用指标、活动网络接口与连接状态；本机地址默认脱敏，只显示网关/DNS存在状态。CPU 温度无身份可靠来源时明确显示“当前硬件或驱动未提供该数据”，不伪造 0°C。
- Creator 8765 的旧冲突已由当前状态解除。唯一正式链路仍是 `src/index.mjs → createCreatorOpsUIHost() → python -m creator_ops.ui.host`：自然启动后由正确 Python Host 监听 `127.0.0.1:8765`，安全状态接口返回 HTTP 200/READY，正式 stop 后实例数为 0，最终产品退出后无监听。没有手工启动 Python、Kill 进程、改端口或创建第二套 Host。
- 首页在 1600×900 验收视口中 document/workspace overflow 均为 0，不再要求上下翻动；完整月历展开仍局限在自身模块。相关页面继续使用现有浅色东方未来视觉壳和明确中文状态，Fixture 与真实数据严格区分。

## 关键实现与合同证据

- 日历配置要求：`E:/星枢NEXA/03_modules/日历与星枢管家/docs/contracts/CALENDAR_LOCAL_AI_CONFIGURATION_REQUIREMENTS.md`
- 词汇许可：`E:/星枢NEXA/03_modules/六级词汇/LICENSES_AND_ATTRIBUTIONS.md`
- 词汇施工记录：`E:/星枢NEXA/03_modules/六级词汇/docs/OPEN-VOCABULARY-ENRICHMENT-WAVE006.md`
- APEX Target/隐私合同：`E:/星枢NEXA/03_modules/设备与网络/docs/APEX_NETWORK_PROBE_WAVE006.md`
- APEX 验收：`docs/reports/NEXA-WAVE-006-APEX-NETWORK-PROBE.md`
- 电脑本机数据验收：`docs/reports/NEXA-WAVE-006-PC-LOCAL-DATA.md`
- Creator 生命周期验收：`docs/reports/NEXA-WAVE-006-CREATOR-LIFECYCLE.md`
- 截图索引：`artifacts/NEXA-WAVE-006-QA/report.md`
- 用户后续操作：`docs/reports/NEXA-WAVE-006-MORNING-ACTIONS.md`

## 测试、构建与运行证据

- Core：2,955 total；2,953 pass；0 fail；2 skipped。
- Calendar：331/331 PASS。
- NEXA Mobile：66 suites；397 tests；0 failures（既有本地 JBR + offline Gradle cache；没有安装依赖或修改系统）。
- Consumption：223/223 PASS。
- Learning：267 Node + 4 Python；0 failures。
- Device & Network：最终 921/921 PASS；UI 定向 40/40 PASS。
- Creator：Python 247/247 PASS；Node Home Widget 8/8 PASS；Core Creator 定向 40/40 PASS。
- 新构建 EXE：225,671,680 bytes；SHA-256 `7DBF28511D804E47FEF9ED2AA7BAB92B28EFF1D01D850A0B18CF38E67785C559`。
- 新构建 app.asar：19,253,423 bytes；SHA-256 `F8C805558DCC5D306AE09BCE9D0F7269D899FA525B8469FC94FD5533DFF6B0C3`。
- 保留构建 `dist-daily-use-rc-final-001` EXE SHA-256：`D2A466A05BEA187BBDD77F4FD7E14F8B25E994C3D384BF96994EBA225E2DA543`。
- 保留构建 `dist-visual-daily-use-wave004` EXE SHA-256：`A67340C7E6453884C60667B8BE05DD2EAA0D9F48AD1029F81A4CB2F81F634C02`。
- 最终截图 12/12；产品退出后 8765 和 9387 的 LISTENING 数均为 0。

## 网络与安全边界

本轮资料获取实际使用的官方/固定来源域名为 `en-word.net`、`github.com` 与 `raw.githubusercontent.com`。source manifest 中四个生产资料文件合计 38,799,789 bytes；连同许可与 README 快照约 38.8 MB。APEX 真实探针请求为 0，运行时词汇网络依赖为 0。

没有读取或写入真实 Credential，没有保存明文密钥，没有输出 Secret，没有未授权写入，没有外部 AI 调用，没有 OpenCode、DeepSeek 或 Computer Use 调用，没有修改 VPN、代理、DNS、路由、防火墙或校园网配置。

## 人工验收缺口

剩余事项都只依赖用户环境，不阻塞 Wave 006 的代码、测试和独立构建：本地日历模型配置；Android 首次真实配对/通知权限/后台存活/重启回连；Windows 登录启动开关选择；APEX 国内外 Target allowlist；US/UK 实体听音。逐项操作与影响见 `NEXA-WAVE-006-MORNING-ACTIONS.md`。

## 冻结状态块

```text
TASK: NEXA-DAILY-CAPABILITY-UNBLOCK-AND-BUILD-WAVE-006
STATUS: COMPLETE_WITH_DOCUMENTED_HUMAN_ACCEPTANCE_GAPS

CALENDAR_LOCAL_AI_ADAPTER: PASS
CALENDAR_LOCAL_AI_RUNTIME: PENDING_USER_CONFIG

TRUSTED_DEVICE_PERSISTENCE: PASS
AUTO_DISCOVERY: PASS
AUTO_RECONNECT: PASS
WINDOWS_AUTO_START_SETTING: PASS_USER_OPT_IN
ANDROID_BACKGROUND_STATUS: AUTOMATED_PASS_PHYSICAL_DEVICE_GAP

NOTIFICATION_TO_CONSUMPTION: PASS
REAL_ANDROID_ACCEPTANCE: HUMAN_GAP

LEXICAL_DATA_SOURCES: OPEN_ENGLISH_WORDNET_2025 + UNIMORPH_66e0e9e8e2dcd196da081a25a48e5c1fe3d8b49b + CMUDICT_74790861f652b15e4ac49015a90074ad62a27690
LEXICAL_FINAL_SIZE: 14431065_BYTES
US_VOICE: PASS_AUTOMATED_PHYSICAL_LISTENING_GAP
UK_VOICE: PASS_AUTOMATED_PHYSICAL_LISTENING_GAP
VOCAB_RICH_DETAILS: PASS

APEX_REUSE: YES
LIGHT_NETWORK_PROBE: TARGET_PENDING
FULL_SPEEDTEST: USER_GATED
NETWORK_TARGET_STATUS: PENDING_USER_ALLOWLIST

PC_DEVICE_DATA: PASS
PC_NETWORK_INTERFACE_DATA: PASS
UNSUPPORTED_SENSOR_STATUS: PASS

PORT_8765_OWNER: CORRECT_CREATOR_OPS_PYTHON_HOST_DURING_LIFECYCLE; NONE_AFTER_STOP
PORT_8765_RECOMMENDATION: KEEP_127.0.0.1:8765
CREATOR_PORT_CONFLICT: RESOLVED_BY_CURRENT_STATE
CREATOR_SERVICE_STATE: NOT_RUNNING
CREATOR_LIFECYCLE_START: PASS
CREATOR_PORT_OWNER_AFTER_START: CORRECT_CREATOR_OPS_PYTHON_HOST
CREATOR_HOST_STATUS_ENDPOINT: PASS_HTTP_200_READY
CREATOR_LIFECYCLE_STOP: PASS
CREATOR_MANUAL_PYTHON_REQUIRED: NO
CREATOR_HOME_SUMMARY_STATES: PASS

CORE_TESTS: 2955_TOTAL / 2953_PASS / 0_FAIL / 2_SKIPPED
MODULE_TESTS: CALENDAR_331_PASS; MOBILE_397_PASS; CONSUMPTION_223_PASS; LEARNING_267_NODE_PLUS_4_PYTHON_PASS; DEVICE_921_PASS; CREATOR_247_PYTHON_PLUS_8_NODE_PASS
PRODUCTION_BUILD: PASS

NEW_BUILD_PATH: <PROJECT_ROOT>\01_source\token-monitor\dist-daily-capability-wave006\win-unpacked\Token Monitor.exe
PRESERVED_BUILD_PATHS: dist-daily-use-rc-final-001; dist-visual-daily-use-wave004

SCREENSHOTS: 12/12_PASS_AT_artifacts/NEXA-WAVE-006-QA/screenshots
MORNING_ACTIONS_PATH: <PROJECT_ROOT>\01_source\token-monitor\docs\reports\NEXA-WAVE-006-MORNING-ACTIONS.md
FINAL_REPORT_PATH: <PROJECT_ROOT>\01_source\token-monitor\docs\reports\NEXA-DAILY-CAPABILITY-UNBLOCK-AND-BUILD-WAVE-006-REPORT.md

NETWORK_DOMAINS_ACCESSED: en-word.net; github.com; raw.githubusercontent.com
ESTIMATED_DOWNLOAD_SIZE: 38,799,789_BYTES_SOURCE_ARTIFACTS; APPROX_38.8_MB_WITH_LICENSE_SNAPSHOTS

OPENCODE_CALLS: 0
DEEPSEEK_CALLS: 0
COMPUTER_USE_CALLS: 0
REAL_EXTERNAL_AI_CALLS: 0

REAL_CREDENTIAL_READS: 0
REAL_CREDENTIAL_WRITES: 0
SECRET_EXPOSURE: 0
UNAUTHORIZED_WRITES: 0

NEXA_DAILY_CAPABILITY_WAVE006_READY: true
KNOWN_LIMITATIONS: CALENDAR_LOCAL_MODEL_NOT_CONFIGURED; REAL_ANDROID_AND_BACKGROUND_PERMISSION_NOT_YET_HUMAN_ACCEPTED; APEX_TARGET_PENDING; US_UK_PHYSICAL_LISTENING_PENDING; CPU_TEMPERATURE_UNSUPPORTED_BY_CURRENT_HARDWARE_OR_DRIVER_SOURCE
NEXT_USER_ACTION: FOLLOW_NEXA-WAVE-006-MORNING-ACTIONS.md; START_DIST_DAILY_CAPABILITY_WAVE006_EXE
```
