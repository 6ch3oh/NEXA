# NEXA Desktop Real Content and Module Usability Night Wave 004 — Final Report

今晚已在前序 PASS 首页骨架上完成六条正式 Home Summary 接入，并对所有现有一级模块完成入口、返回、空态/错误态和最低安全核心操作验收。首页现在使用真实的本地 AI Token/成本聚合、真实日历日期状态、真实 CET-6 词库、真实设备/网络观测；没有数据或尚未配置的消费、自媒体、市场状态均使用明确产品态，没有填入示例生产数据。

明早请只启动 `<PROJECT_ROOT>\01_source\token-monitor\dist-visual-daily-use-wave004\win-unpacked\Token Monitor.exe`。首页、消费中心、日历管家、自动化中心、学习中心、设备与网络、Dashi、星测和设置均可直接使用；股票市场需要用户侧网络/数据源配置，自媒体运营需要先通过原应用正常退出占用 8765 的既有本地服务。具体步骤见晨间待办。

本轮未调用 OpenCode、DeepSeek 或 Computer Use，未发起真实外部 AI 请求，未读取/写入/输出真实 Credential 或 Secret，未进行未授权写入，也没有终止既有 Creator 服务。旧 Daily-Use RC 稳定构建的大小和 SHA256 均保持冻结值；Wave004 使用独立构建目录。

## Structured result

TASK = NEXA-DESKTOP-REAL-CONTENT-AND-MODULE-USABILITY-NIGHT-WAVE-004
STATUS = PASS
STARTED_AT = 2026-09-02T02:01:27.9797643+08:00
ENDED_AT = 2026-09-02T04:46:27.5037326+08:00
TOTAL_DURATION = 02:44:59

CALENDAR_HOME_SUMMARY = PASS — CalendarHomeSummary v0.2 real date/no-arrangement state, expanded month and date handoff verified
LEARNING_HOME_SUMMARY = PASS — HomeLearningSummary v0.1 real local CET-6 collection and cards; 5,311-word collection observed
DEVICE_NETWORK_HOME_SUMMARY = PASS — HomeDeviceNetworkSummary v0.1 bounded real observation; unknown stays unknown
CONSUMPTION_HOME_SUMMARY = PASS — real no-record state; no fabricated amount/category/detail
CREATOR_OPS_HOME_SUMMARY = PASS — frozen safe projection and productized owner-conflict/unavailable state; no raw error leakage
AI_USAGE_HOME_SUMMARY = PASS — real local Token Monitor aggregation, attribution, cost and freshness; external AI calls 0

HOME_REAL_DATA_INTEGRATION = PASS — six summaries mounted into the inherited Home skeleton; fake production data 0; raw Home read-error labels 0
HOME_VISUAL_FINALIZATION = PASS — Design QA passed; 1600/1440/default/1024/narrow viewports verified; P0/P1/P2 open findings 0
HOME_CUSTOMIZATION = PASS — reused existing show/hide, ordering and restore-default Home preference assets; no second free-layout system or business-data mutation

MODULE_USABILITY_MATRIX = PASS — <PROJECT_ROOT>\01_source\token-monitor\docs\reports\NEXA-WAVE-004-MODULE-USABILITY-MATRIX.md
PRIMARY_MODULE_ENTRY_COVERAGE = 100% (11/11 entered, 11/11 returned, white screens 0, raw page errors 0, final console errors 0)

COMPLETED_MODULES = Home; Consumption; Calendar; Automation; Learning; Device & Network; Dashi; StarBench; Settings; Market and Creator product-state flows
HUMAN_SETUP_REQUIRED_MODULES = Market (user network/data-source configuration); Creator Ops (normally close prior service owning 127.0.0.1:8765); Device & Network only if fuller paired-device observation is desired
BLOCKED_MODULES = NONE — human-only branches are isolated and the corresponding modules remain enterable with productized states

CORE_TESTS = PASS — focused 293/293; lint PASS; full npm run verify 2,840 pass, 0 fail, 2 documented skip, 2,842 total
MODULE_TESTS = PASS — Calendar effective 322/322; Consumption 220/220; Learning 261/261; Device & Network 872/872; Creator no-service public contract 1/1; new regression failures 0
PRODUCTION_BUILD = PASS — Windows x64 unpacked build, 225,671,680 bytes, SHA256 A67340C7E6453884C60667B8BE05DD2EAA0D9F48AD1029F81A4CB2F81F634C02

NEW_BUILD_PATH = <PROJECT_ROOT>\01_source\token-monitor\dist-visual-daily-use-wave004\win-unpacked\Token Monitor.exe
OLD_STABLE_BUILD_PATH = <PROJECT_ROOT>\01_source\token-monitor\dist-daily-use-rc-final-001\win-unpacked\Token Monitor.exe
OLD_STABLE_BUILD_PRESERVED = YES — 225,671,680 bytes; SHA256 D2A466A05BEA187BBDD77F4FD7E14F8B25E994C3D384BF96994EBA225E2DA543 unchanged

SCREENSHOT_PATHS = <PROJECT_ROOT>\01_source\token-monitor\artifacts\NEXA-WAVE-004-QA\screenshots (20 PNG); home-final-1600x900.png; home-calendar-expanded-1600x900.png; learning-center-today-real-data-1600x900.png; consumption-empty-1600x900.png; creator-ops-owner-conflict-1600x900.png; home-device-network-bottom-1180x800.png; device-network-final-1600x900.png; dashi-tasks-real-data-1600x900.png; market-setup-required-1600x900.png; starbench-empty-1600x900.png; responsive Home evidence at 1440/default/1024/800-wide
MORNING_ACTIONS_PATH = <PROJECT_ROOT>\01_source\token-monitor\docs\reports\NEXA-WAVE-004-MORNING-ACTIONS.md
FINAL_REPORT_PATH = <PROJECT_ROOT>\01_source\token-monitor\docs\tasks\NEXA-DESKTOP-REAL-CONTENT-AND-MODULE-USABILITY-NIGHT-WAVE-004-REPORT.md

OPENCODE_CALLS = 0
DEEPSEEK_CALLS = 0
COMPUTER_USE_CALLS = 0

PRODUCT_RUNTIME_REAL_AI_CALLS = 0
REAL_CREDENTIAL_READS = 0
REAL_CREDENTIAL_WRITES = 0
SECRET_EXPOSURE = 0
UNAUTHORIZED_WRITES = 0

NEXA_VISUAL_DAILY_USE_READY = true
KNOWN_LIMITATIONS = Market still needs user network/data-source setup; Creator remains unavailable while an older service owns port 8765; Consumption has no real records; Device & Network keeps unobserved fields unknown; Creator service-starting tests were not run against the occupied port; reference-only toolbar branding/search differences remain frozen Shell scope, not a Wave004 regression
RECOMMENDED_NEXT_WAVE = After the user completes the morning actions, capture real Market and Creator data-state evidence, observe paired-device freshness under normal use, and keep all new summaries on the frozen public-contract/product-truth boundary without introducing fake data or a second Home layout system
