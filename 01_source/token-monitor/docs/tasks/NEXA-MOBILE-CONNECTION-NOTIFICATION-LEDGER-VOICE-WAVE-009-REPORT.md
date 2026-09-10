# NEXA Mobile Connection / Notification Ledger / Voice Wave 009 Report

记录时间：2026-09-06（Asia/Shanghai）

当前状态：实现、构建、自动化门禁和可在既定权限内完成的真机验证均已通过；Mobile 已同签名升级到包含 Control Plane/Fast Path 的最新 APK，Desktop 已切换到 r11，真实“打开消费中心”已在 PC Core 完成确定性导航。r11 已修复后台本地 AI 工作占用唯一推理槽时交互命令立即 `AI_PROVIDER_BUSY` 的问题；仅等待手机回到可访问电脑的 Wi-Fi 后完成 r11 真机复测、renderer 实际切页确认与七页面刷新视觉 E2E。

## 用户可读结论

1. 手机此前显示 PC 离线，不是配对失效。Android 仍持有已经失效的显式 Network 399，绑定 socket 时返回 EPERM；同时可信 endpoint 提示过期后，候选选择错误地跳过了仍有效的配置地址，继而尝试已经过期的 DDNS 地址。
2. 现在会丢弃 stale/lost/EPERM 的显式 Network，优先使用当前 validated 物理网络，并在必要时回退系统默认网络；配置的可信 HTTPS endpoint 不再因发现提示 TTL 到期而消失。应用进程重启后会自动连接并从 ACK 断点继续上传，无需重新配对。
3. VPN 可以继续开启。真机验证时 VPN network 398 为 non-bypassable，底层物理 Wi-Fi 为 network 421；在该状态下可信连接、通知上传和 PC→手机控制均成功。
4. 手机通知先保存在 NEXA Mobile 的 Room `nexa-mobile.db`（schema V5）；PC 保存于 `%APPDATA%\Token Monitor\mobile-sync.json`（schema V3）。收到 ACK 后手机只更新队列状态，不删除通知历史。
5. 真机迁移后手机曾确认至少保存 72,442 条通知生命周期记录；截至本报告快照，PC 保存 18,532 条事件，其中 18,524 条原始通知、8 条支付事件，复合幂等键重复数为 0。数据仍在持续同步，所以总数会继续增长。
6. 业务时间以手机 Notification `postTime` 为准。抽样事件的手机 `posted_at`、PC `event_time` 与 PC payload `posted_at` 逐毫秒一致，listener 接收时间和 Desktop 接收时间另行保存。
7. App 分类首先依据 Android package/app identity 做确定性分类；POSTED、UPDATED、REMOVED 每个原始回调都独立持久化，REMOVED 保留审计但不进入消费解析。
8. 内容分类由 localhost Qwen3-4B 按通知逐条执行并保存 checkpoint；截至快照已有 131 条由 `qwen3-4b-instruct-2507` 实际处理。验证码、凭据等敏感内容由本地规则直接跳过，不进入 AI prompt；队列已证明可重启续跑。
9. 支付通知先做确定性字段抽取，再按时间窗和交易事实建立 canonical transaction；支付宝、微信、银行等多条证据可以合并关联到一笔交易，不按单条通知重复记账。
10. 当前消费草稿共 8 条：7 条已确认，其中 3 条由自动流程入账；最新一条真实支付事件经历离线积压、恢复上传和 PC 重放后，按低置信度进入待确认，没有被误自动入账。
11. 消费中心提供审计历史，并支持回顾、修改、手动合并、排除、移除和撤销；人工分类优先级永久高于后续自动分类，同时保留原始确定性事实与证据引用。
12. 全局刷新改为保存/恢复 route、scroll、selected date、filters、tab 和 expansion state，自动测试覆盖 Home、消费中心、日历管家、自动化中心、学习中心、设备与网络、自媒体运营。真人视觉回归仍待用户在七个页面各观察一次后台刷新。
13. Global Command Bar 已有麦克风入口、listening/transcribing/cancel 状态、可编辑 transcript 插入和禁止录音后自动执行的安全边界。本机没有可用离线 STT 引擎或模型，因此状态为 provider-ready gap；建议经用户批准后安装 whisper.cpp 与 ggml-small multilingual（约 466 MiB，建议至少预留 500 MiB，whisper.cpp 为 MIT）。未调用云 STT。
14. 用户首次从手机 Command 发送“打开消费中心”时，Core 正确生成了只读 `navigation/cost` 结果，但手机网关没有把该结果派发给桌面 renderer，因此电脑无反应。r3 补上主进程派发后，真实日志证明三次命令均到达 Core 并记录 `DISPATCHED`，但后加载的 NEXA renderer 监听器仍未执行切页。r4 改由稳定的主 renderer 入口接收 route-only envelope，再触发与用户点击顶部导航完全相同的路由按钮，并向主进程回报 `APPLIED/NOT_APPLIED`；同一幂等请求仍只派发一次，非导航结果不触发桌面路由。
15. Mobile r3 仍可能显示“离线”，原因是健康的后台长轮询在每次 TLS 探测时都会把 `CONNECTED` 短暂覆盖为 `AUTHENTICATING`，而 Command 页面会保留一次旧请求失败且成功请求不恢复在线状态。Mobile r5 保留已验证连接贯穿后续轮询探测、在真实网关 2xx 后写回 `CONNECTED`、进入 Command 页面主动刷新状态，并只在实际网络 I/O 失败时显示离线。真机覆盖安装后持久状态已验证为 `CONNECTED / CAMPUS_ROUTED`，认证与状态上报均为 PASS。
16. 用户还需：在 Desktop r5 + Mobile r5 上重发一次“打开消费中心”并确认 PC 实际切页；在 PC 七个业务页面非顶部位置等待后台刷新并确认状态不跳变；在消费中心回顾最新一条待确认记录。STT 模型下载为可选批准项。
17. Desktop r4 真机复测时出现 Electron 无响应。实测开发实例主进程持续占用约一个 CPU 核、私有内存约 1.1 GB。根因有两处：通知恢复队列在本地 AI 不可用时反复重试所有 `AI_PENDING`，并为每条记录同步重写 44 MB 通知库与 23 MB 时间索引；设备中心又每 5/30 秒深拷贝并整文件重写 66 MB 硬件历史与 377 MB 应用网络历史。Desktop r5 在能力不可用时跳过不可能成功的 AI 重试、每 100 条批量 checkpoint，并把设备历史改为近期原始样本加 5 分钟/小时级 30 天分层保留。原始 443 MB 文件已完整备份；迁移后文件为约 0.83 MB 与 6.21 MB。稳定采样时主进程 5 秒 CPU 增量从约 5 秒降至 0.266 秒，私有内存约 214 MB，句柄数无增长，控制面连续 `DELIVERED/SUCCEEDED`。
18. 23:39 后续部署使用历史同签名证书，经 Vivo 人工确认后 `adb install -r` 成功；`firstInstallTime` 仍为 2026-08-11，配对与数据未清除。Desktop 从 Wave 009 r5 切换到 Local AI Control Plane r7 后，手机在一次真实 `NETWORK_IO` 后自动恢复 `AUTH_RESULT=PASS / STATUS_RESULT=SUCCESS`。真机发送“打开消费中心”已记录为 `navigation.open.cost`、confidence 1、无需确认、status completed；复杂“本年支出”查询在 `AI_PROVIDER_BUSY` 时返回产品化 `LOCAL_AI_UNAVAILABLE`，保留原文本且真实写入 0。
19. `AI_PROVIDER_BUSY` 的真实根因不是模型停止，而是通知语义分类与 Runtime Coordinator 周期性多 Schema 深探针共享唯一推理槽，交互命令在槽位被占用时立即失败。Desktop r11 增加交互优先的有界队列，总排队与推理共用 120 秒预算；启动/恢复只做一次最小严格 JSON 生成，READY 周期检查只读 `/v1/models`，显式深诊断才执行完整 Schema 探针。精确模型仍在真实列表中，最小严格 JSON 生成返回 `{"status":"ok"}`。
20. 最后一次真机网络观察显示手机已从 Wi-Fi 切到蜂窝网络，VPN 仍为 non-bypassable 且 underlying 为 cellular；电脑仅在局域网监听，因此手机此时真实离线，不是配对丢失。不得修改系统网络；待用户把手机接回可访问电脑的 Wi-Fi 后自动重连并复测 r11。

## 工程字段

```text
TASK: NEXA-MOBILE-CONNECTION-NOTIFICATION-LEDGER-VOICE-WAVE-009
STATUS: IMPLEMENTED_AUTOMATED_GATES_PASS_AWAITING_RENDERER_VISUAL_AND_7_SURFACE_REFRESH_CHECKS

TRANSPORT_ROOT_CAUSE: STALE_EXPLICIT_NETWORK_399_BIND_EPERM + CONFIGURED_ENDPOINT_SKIPPED_AFTER_TRUSTED_HINT_TTL + STALE_DDNS
TRANSPORT_FIX: DISCARD_STALE_OR_EPERM_NETWORK + VALIDATED_PHYSICAL_NETWORK_SELECTION + SAME_PIN_AUTH_SYSTEM_DEFAULT_RETRY + CONFIGURED_TRUSTED_ENDPOINT_FALLBACK

TRUSTED_CONNECTION: PASS (CONNECTED / CAMPUS_ROUTED on Vivo)
AUTO_RECONNECT: PASS (Android process restart and resumable ACK verified)
VPN_COEXISTENCE: PASS (non-bypassable VPN 398, underlying Wi-Fi 421)

MOBILE_NOTIFICATION_STORE: Room nexa-mobile.db schema V5; ACK never deletes history
PC_NOTIFICATION_STORE: %APPDATA%\Token Monitor\mobile-sync.json schema V3
NOTIFICATION_COUNT: MOBILE >= 72442 lifecycle rows at measured checkpoint; PC = 18532 events at report snapshot and increasing
PENDING_UPLOAD_COUNT: 568 at device-status snapshot (4 pending + 564 retry-pending, 0 terminal failures)

POST_TIME_AUTHORITY: PASS; phone posted_at == PC event_time == PC payload posted_at in verified sample
APP_CLASSIFICATION: PASS; deterministic package/app identity
SEMANTIC_CLASSIFICATION: PASS; localhost qwen3-4b-instruct-2507, 131 real events at snapshot
AI_QUEUE: PASS; one-event durable checkpoint, restart resume, sensitive prompt exclusion

FINANCIAL_EXTRACTION: PASS
CROSS_APP_DEDUP: PASS; canonical transaction with multiple evidence references
AUTO_POST: PASS; 3 existing automatic confirmations, >= 0.9 threshold
PENDING_CONFIRMATION: PASS; newest real payment is DRAFTED / LOW_CONFIDENCE_PENDING_CONFIRMATION
AUDIT_TRAIL: PASS; review/edit/merge/exclude/remove/undo covered

SCROLL_PRESERVATION: AUTOMATED_PASS; 7-surface human visual E2E pending
MOBILE_COMMAND_DESKTOP_NAVIGATION: REAL_MOBILE_TO_PC_FAST_PATH_PASS; route=cost / confidence=1 / completed; renderer visual confirmation pending
ELECTRON_RESPONSIVENESS: PASS_AFTER_R5; AI_PENDING capability gate + batched checkpoints + tiered 30-day Device Center history

STT_PROVIDER: local adapter ready; recommended whisper.cpp + ggml-small multilingual after approval
STT_STATUS: PROVIDER_READY_GAP
VOICE_COMMAND_UI: PASS

DESKTOP_BUILD: <PROJECT_ROOT>\01_source\token-monitor\dist-mobile-notification-voice-wave009\win-unpacked\Token Monitor.exe
DESKTOP_EXE_SHA256: 33E8D1FDEE1F3C84008A26F650420CC3322FEEFF9533737322476EA676ECCC88
DESKTOP_ASAR_SHA256: 82A7040984CD3281996EA97DF943F30063E886D0C70A98B8C01869794E3BEC57
MOBILE_APK: <PROJECT_ROOT>\03_modules\NEXA-Mobile\dist-mobile-notification-voice-wave009\NEXA-Mobile-wave009-r5-debug.apk
MOBILE_APK_SHA256: 0CCE69CF1C30AC9C3A7EA6806EF52DBF73F0897D8687AED3AF73E083D3C99FC8
CURRENT_DESKTOP_RUNTIME: <PROJECT_ROOT>\01_source\token-monitor\dist-local-ai-control-plane-v0.1-r11\win-unpacked\Token Monitor.exe
CURRENT_DESKTOP_EXE_SHA256: 1D7B8F530AD8FF260156F1C7B569A5C47A070B60B01EFB55712A8096EE2733E2
CURRENT_DESKTOP_ASAR_SHA256: A43FDA36BBA57550A771219E0CD1A2EAEBBE965B357CAE977AD24BD948FF1E6F
CURRENT_MOBILE_APK: <PROJECT_ROOT>\03_modules\NEXA-Mobile\app\build\outputs\apk\debug\app-debug-same-signature.apk
CURRENT_MOBILE_APK_SHA256: 766A76991B70255B103956F83AC3E3574FD0D8201291EDD73946464E4C24AFA1
CURRENT_MOBILE_SIGNING_CERT_SHA256: 9D0DD431A078CBCB3ABD3AF9421AB5B773A710899D1EEFCBB50F2C4A812D8A27

DESKTOP_TESTS: focused 45/45 pass; full 3042 total / 3039 pass / 2 skipped / 1 unrelated concurrent timing threshold; isolated failing file 46/46 pass
MOBILE_TESTS: 416 pass / 0 fail
CONSUMPTION_TESTS: 241 pass / 0 fail
DEVICE_CENTER_TESTS: 929 pass / 0 fail

REAL_DEVICE_E2E: A PASS; B PASS; C PASS; D PASS (correct low-confidence pending); E CORE_FAST_PATH_PASS / RENDERER_VISUAL_CONFIRMATION_PENDING; F CORE_RESULT_PASS / PRODUCT_RESPONSE_PASS; G PROVIDER_READY_GAP

OPENCODE_CALLS: 0
DEEPSEEK_CALLS: 0
COMPUTER_USE_CALLS: 0
EXTERNAL_AI_CALLS: 0

SECRET_EXPOSURE: 0
UNAUTHORIZED_WRITES: 0 confirmed state changes; one idempotent notification-listener allow command was attempted without a pre-state snapshot, so no stronger claim is made

HUMAN_ACTIONS: reconnect Vivo to a Wi-Fi that can reach the Desktop; confirm r11 Consumption renderer page change; rerun one complex read-only AI query; seven-surface refresh visual check; review one pending expense; optional local STT model approval
REMAINING_GAPS: current cellular-only phone path; r11 complex-query physical retest; renderer visual page-change result; seven-surface visual refresh result; optional STT engine/model
```

## 构建与测试证据

- Desktop 最终目录包使用仓库现有 `node_modules/electron/dist` 离线封装，`electron-builder` 退出码 0；顶层交付包启动后 17321、17322 与 IPv6 17322 均监听，NEXA Shell 无 Public API 导入错误。
- Core 最新全量 `npm test`：3042 tests，3039 pass，2 skipped，1 个与本轮无关的 Antigravity `<250ms` 并发时序断言失败；该文件隔离复跑 46/46 pass，失败用例 47ms。最新 ESLint PASS；本轮 provider/coordinator/command 聚焦测试 45/45 PASS。
- Mobile `:app:testDebugUnitTest :app:assembleDebug --offline`：416 tests，0 fail；r5 同签名 `adb install -r` 成功，既有数据、配对与通知历史保留。安装后真机持久连接状态为 `CONNECTED / CAMPUS_ROUTED`，最近验证时间已刷新，后台日志为 `AUTH_RESULT PASS / STATUS SUCCESS`。
- 消费中心 `node --test`：241 tests，241 pass。
- 设备与网络 `npm test`：929 tests，929 pass；真实 443 MB 历史只读演算与原位迁移均通过，原文件备份位于 `artifacts/wave009-device-history-pre-compaction-20260906-1154`。
- Core 与 Mobile `git diff --check` 均通过。
